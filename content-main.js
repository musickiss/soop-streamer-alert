// ===== 숲토킹 - SOOP 스트리머 방송 알림 =====
// content-main.js - MAIN world Canvas 녹화 스크립트
// v3.5.8.2 - MediaRecorder 재시작 분할 + 안정성 개선

(function() {
  'use strict';

  // 이미 로드된 경우 스킵
  if (window.__SOOPTALKING_RECORDER_LOADED__) {
    console.log('[숲토킹 Recorder] 이미 로드됨, 스킵');
    return;
  }
  window.__SOOPTALKING_RECORDER_LOADED__ = true;

  console.log('[숲토킹 Recorder] v3.5.8.2 로드됨');

  // ===== 설정 =====
  const CONFIG = {
    // 고사양 (AV1) - 기본값
    HIGH_QUALITY: {
      VIDEO_BITRATE: 8000000,     // 8 Mbps
      AUDIO_BITRATE: 192000,      // 192 kbps
      TARGET_FPS: 60,
      CODEC_PRIORITY: ['av01', 'av1', 'vp9', 'vp8']
    },
    // 저사양 (VP9)
    LOW_QUALITY: {
      VIDEO_BITRATE: 4000000,     // 4 Mbps
      AUDIO_BITRATE: 128000,      // 128 kbps
      TARGET_FPS: 30,
      CODEC_PRIORITY: ['vp9', 'vp8']
    },
    // 공통 설정
    TIMESLICE: 2000,              // 2초마다 데이터 청크
    MAX_FILE_SIZE: 500 * 1024 * 1024,  // 500MB
    PROGRESS_INTERVAL: 5000,      // 5초마다 진행 상황 보고
    CANVAS_DRAW_INTERVAL: 8,      // 8ms (FPS 타이밍 충돌 해결)
    MIN_RECORD_TIME: 2000,        // 최소 녹화 시간 2초
    MAX_VIDEO_UNAVAILABLE: 60,    // video 비정상 최대 허용 횟수 (~0.5초)
    MAX_STOP_RETRIES: 10,         // stopRecording 최대 재시도 횟수
    SPLIT_TRANSITION_DELAY: 300,  // 파트 전환 대기 시간 (ms)
  };

  // ===== 상태 변수 =====
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStartTime = null;
  let recordingStartTimestamp = null;
  let currentStreamerId = null;
  let currentNickname = null;
  let progressIntervalId = null;
  let totalRecordedBytes = 0;
  let partNumber = 1;
  let isRecording = false;
  let isSaving = false;
  let isSplitting = false;  // ⭐ 파트 전환 중 플래그
  let currentQuality = 'high';
  let currentMimeType = null;  // ⭐ 현재 사용 중인 mimeType 저장

  // ===== Canvas 관련 변수 =====
  let recordingCanvas = null;
  let recordingCtx = null;
  let canvasStream = null;
  let drawIntervalId = null;
  let sourceVideo = null;

  // ===== 오디오 관련 변수 (전역 - 재사용) =====
  let audioCtx = null;
  let audioSource = null;
  let audioDest = null;
  let connectedVideo = null;

  // ===== 안정성 관련 변수 =====
  let videoUnavailableCount = 0;
  let stopRetryCount = 0;

  // ===== 유틸리티 함수 =====

  // 메모리 사용량 로깅 (디버그용)
  function logMemoryUsage(context) {
    if (typeof performance !== 'undefined' && performance.memory) {
      const usedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
      const totalMB = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
      console.log(`[숲토킹 Recorder] 메모리 (${context}): ${usedMB}MB / ${totalMB}MB`);
    }
  }

  // 최적 코덱 선택
  function getBestMimeType(quality) {
    const config = quality === 'high' ? CONFIG.HIGH_QUALITY : CONFIG.LOW_QUALITY;

    for (const codec of config.CODEC_PRIORITY) {
      const variations = codec === 'av01' || codec === 'av1'
        ? ['video/webm;codecs=av01,opus', 'video/webm;codecs=av1,opus']
        : [`video/webm;codecs=${codec},opus`];

      for (const mime of variations) {
        if (MediaRecorder.isTypeSupported(mime)) {
          console.log(`[숲토킹 Recorder] 코덱 선택됨`);
          return mime;
        }
      }
    }

    console.log('[숲토킹 Recorder] 기본 코덱 사용');
    return 'video/webm';
  }

  // 파일명 생성
  function generateFileName(streamerId) {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    recordingStartTimestamp = timestamp;
    return `soop_${streamerId}_${timestamp}.webm`;
  }

  // 비디오 요소 찾기
  function findVideoElement() {
    const videos = document.querySelectorAll('video');
    let bestVideo = null;
    let maxArea = 0;

    // 1순위: 재생 중인 큰 비디오
    for (const v of videos) {
      if (v.readyState >= 2 && !v.paused && v.videoWidth > 0) {
        const area = v.videoWidth * v.videoHeight;
        if (area > maxArea) {
          maxArea = area;
          bestVideo = v;
        }
      }
    }
    if (bestVideo) return bestVideo;

    // 2순위: readyState가 높은 비디오
    for (const v of videos) {
      if (v.readyState >= 2 && v.videoWidth > 0) {
        return v;
      }
    }

    // 3순위: 아무 비디오나
    for (const v of videos) {
      if (v.videoWidth > 0) {
        return v;
      }
    }

    return null;
  }

  // ===== 오디오 관리 함수 =====

  // 오디오 트랙 획득 (재사용 로직 포함)
  async function getOrCreateAudioTrack(video) {
    // AudioContext가 닫혔으면 초기화
    if (audioCtx && audioCtx.state === 'closed') {
      audioCtx = null;
      audioSource = null;
      audioDest = null;
      connectedVideo = null;
    }

    // Case 1: 같은 video에 이미 연결됨 → 재사용
    if (connectedVideo === video && audioDest) {
      const track = audioDest.stream.getAudioTracks()[0];
      if (track && track.readyState === 'live') {
        console.log('[숲토킹 Recorder] 오디오 연결 재사용');
        return track;
      }
      console.log('[숲토킹 Recorder] 오디오 트랙 무효, 재연결 시도');
      connectedVideo = null;
    }

    // Case 2: 다른 video거나 새 연결 필요
    try {
      // 기존 AudioContext 정리 (다른 video인 경우)
      if (audioCtx && connectedVideo !== video) {
        try {
          audioCtx.close();
        } catch (e) {
          console.log('[숲토킹 Recorder] AudioContext close:', e.message);
        }
        audioCtx = null;
        audioSource = null;
        audioDest = null;
      }

      // 새 AudioContext 생성
      if (!audioCtx) {
        audioCtx = new AudioContext();
      }

      // suspended 상태면 resume
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log('[숲토킹 Recorder] AudioContext resumed');
      }

      // MediaElementSource 생성
      audioSource = audioCtx.createMediaElementSource(video);
      audioDest = audioCtx.createMediaStreamDestination();

      // 연결: 녹화용 + 스피커 출력
      audioSource.connect(audioDest);
      audioSource.connect(audioCtx.destination);

      connectedVideo = video;
      console.log('[숲토킹 Recorder] 오디오 연결 성공');

      return audioDest.stream.getAudioTracks()[0];

    } catch (e) {
      console.log('[숲토킹 Recorder] 오디오 연결 실패:', e.message);

      // 이미 연결된 경우 기존 dest에서 트랙 반환 시도
      if (audioDest && connectedVideo === video) {
        const track = audioDest.stream.getAudioTracks()[0];
        if (track) return track;
      }

      return null;
    }
  }

  // 새 video에 오디오 재연결 (비동기)
  async function reconnectAudioToNewVideo(newVideo) {
    if (connectedVideo === newVideo) {
      return;
    }

    console.log('[숲토킹 Recorder] 새 video 감지, 오디오 재연결 시도...');

    try {
      const track = await getOrCreateAudioTrack(newVideo);

      if (track && canvasStream) {
        // 기존 오디오 트랙 제거
        const oldAudioTracks = canvasStream.getAudioTracks();
        oldAudioTracks.forEach(t => {
          canvasStream.removeTrack(t);
          console.log('[숲토킹 Recorder] 기존 오디오 트랙 제거됨');
        });

        // 새 오디오 트랙 추가
        canvasStream.addTrack(track);
        console.log('[숲토킹 Recorder] 오디오 재연결 완료');
      }
    } catch (e) {
      console.log('[숲토킹 Recorder] 오디오 재연결 실패:', e.message);
    }
  }

  // ===== Canvas 관리 함수 =====

  // Canvas 생성 및 설정
  function setupCanvas(video) {
    cleanupCanvas();

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;

    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = width;
    recordingCanvas.height = height;

    // Canvas 컨텍스트 생성 (호환성 처리)
    try {
      recordingCtx = recordingCanvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false
      });
    } catch (e) {
      console.log('[숲토킹 Recorder] 고급 컨텍스트 옵션 미지원, 기본 옵션 사용');
      recordingCtx = recordingCanvas.getContext('2d', { alpha: false });
    }

    if (!recordingCtx) {
      console.error('[숲토킹 Recorder] Canvas 2D 컨텍스트 생성 실패');
      return false;
    }

    console.log(`[숲토킹 Recorder] Canvas 생성: ${width}x${height}`);
    return true;
  }

  // Canvas에 비디오 프레임 그리기 시작
  function startCanvasDrawing(video, targetFps) {
    sourceVideo = video;
    videoUnavailableCount = 0;

    if (drawIntervalId) {
      clearInterval(drawIntervalId);
    }

    const minInterval = Math.floor(1000 / targetFps);
    let lastDrawTime = 0;

    drawIntervalId = setInterval(() => {
      // video 유효성 검사
      if (!sourceVideo) {
        return;
      }

      // DOM에서 제거되었는지 확인
      if (!document.body.contains(sourceVideo)) {
        console.log('[숲토킹 Recorder] video 요소 DOM에서 제거됨, 새 video 탐색...');
        const newVideo = findVideoElement();

        if (newVideo && newVideo !== sourceVideo) {
          sourceVideo = newVideo;
          recordingCanvas.width = newVideo.videoWidth || recordingCanvas.width;
          recordingCanvas.height = newVideo.videoHeight || recordingCanvas.height;

          // 새 video에 오디오 재연결 (비동기로 처리)
          reconnectAudioToNewVideo(newVideo);

          console.log('[숲토킹 Recorder] 새 video로 전환');
          videoUnavailableCount = 0;
        } else {
          videoUnavailableCount++;
          if (videoUnavailableCount > CONFIG.MAX_VIDEO_UNAVAILABLE) {
            console.log('[숲토킹 Recorder] video를 찾을 수 없음, 녹화 중지');
            stopRecording();
            return;
          }
          return;
        }
      }

      // video 상태 확인
      if (sourceVideo.paused || sourceVideo.ended ||
          sourceVideo.readyState < 2 || sourceVideo.videoWidth === 0) {

        videoUnavailableCount++;

        // 연속 실패 횟수 체크
        if (videoUnavailableCount > CONFIG.MAX_VIDEO_UNAVAILABLE) {
          console.log('[숲토킹 Recorder] video 장시간 비정상 상태, 녹화 중지');
          stopRecording();
          return;
        }

        return;
      }

      // 정상 상태이면 카운터 리셋
      videoUnavailableCount = 0;

      // FPS 제한
      const now = performance.now();
      if (now - lastDrawTime < minInterval) {
        return;
      }

      try {
        // 해상도 변경 감지
        if (recordingCanvas.width !== sourceVideo.videoWidth ||
            recordingCanvas.height !== sourceVideo.videoHeight) {
          if (sourceVideo.videoWidth > 0 && sourceVideo.videoHeight > 0) {
            recordingCanvas.width = sourceVideo.videoWidth;
            recordingCanvas.height = sourceVideo.videoHeight;
            console.log(`[숲토킹 Recorder] 해상도 변경: ${recordingCanvas.width}x${recordingCanvas.height}`);
          }
        }

        // 비디오를 Canvas에 그리기
        recordingCtx.drawImage(sourceVideo, 0, 0, recordingCanvas.width, recordingCanvas.height);
        lastDrawTime = now;

      } catch (e) {
        console.log('[숲토킹 Recorder] drawImage 실패:', e.message);
      }
    }, CONFIG.CANVAS_DRAW_INTERVAL);

    console.log('[숲토킹 Recorder] Canvas 그리기 시작');
  }

  // Canvas 정리 (오디오는 유지)
  function cleanupCanvas() {
    if (drawIntervalId) {
      clearInterval(drawIntervalId);
      drawIntervalId = null;
    }

    if (canvasStream) {
      // 비디오 트랙만 정리 (오디오는 재사용)
      canvasStream.getVideoTracks().forEach(track => {
        track.stop();
      });
      canvasStream = null;
    }

    if (recordingCanvas) {
      recordingCanvas.width = 0;
      recordingCanvas.height = 0;
      recordingCanvas = null;
    }

    if (recordingCtx) {
      recordingCtx = null;
    }

    sourceVideo = null;
    videoUnavailableCount = 0;
  }

  // 탭 종료 시 모든 리소스 정리
  window.addEventListener('beforeunload', () => {
    console.log('[숲토킹 Recorder] 탭 종료, 리소스 정리');

    if (audioCtx) {
      try {
        audioCtx.close();
      } catch (e) {}
    }
    audioCtx = null;
    audioSource = null;
    audioDest = null;
    connectedVideo = null;
  });

  // ⭐ 백그라운드 탭 경고 (console.warn → console.log로 변경)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording) {
      console.log('[숲토킹 Recorder] 탭이 백그라운드로 이동, 프레임 저하 가능');
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_WARNING',
        warning: 'background_tab',
        message: '탭이 백그라운드로 이동하여 녹화 프레임이 저하될 수 있습니다.'
      }, '*');
    }
  });

  // ===== 녹화 제어 함수 =====

  // 녹화 시작
  async function startRecording(streamerId, nickname, quality = 'high') {
    if (isRecording) {
      console.log('[숲토킹 Recorder] 이미 녹화 중');
      return { success: false, error: '이미 녹화 중입니다.' };
    }

    console.log(`[숲토킹 Recorder] 녹화 시작 요청: ${streamerId}, 품질: ${quality}`);
    logMemoryUsage('녹화 시작 전');

    currentQuality = quality;

    try {
      // 비디오 요소 찾기
      const video = findVideoElement();
      if (!video) {
        throw new Error('비디오 요소를 찾을 수 없습니다.');
      }

      // 비디오 준비 상태 확인
      if (video.readyState < 2) {
        console.log('[숲토킹 Recorder] 비디오 로딩 대기...');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('비디오 로딩 타임아웃')), 10000);
          video.addEventListener('loadeddata', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }

      console.log(`[숲토킹 Recorder] 비디오 발견: ${video.videoWidth}x${video.videoHeight}`);

      // 품질 설정 가져오기
      const qualityConfig = quality === 'high' ? CONFIG.HIGH_QUALITY : CONFIG.LOW_QUALITY;

      // Canvas 설정
      if (!setupCanvas(video)) {
        throw new Error('Canvas 설정 실패');
      }

      // Canvas 그리기 시작
      startCanvasDrawing(video, qualityConfig.TARGET_FPS);

      // Canvas에 프레임이 그려지도록 대기
      await new Promise(r => setTimeout(r, 200));

      // Canvas에서 스트림 획득
      canvasStream = recordingCanvas.captureStream(qualityConfig.TARGET_FPS);
      console.log('[숲토킹 Recorder] Canvas 스트림 획득');

      // 오디오 트랙 추가
      const audioTrack = await getOrCreateAudioTrack(video);
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
        console.log('[숲토킹 Recorder] 오디오 트랙 추가됨');
      } else {
        console.log('[숲토킹 Recorder] 오디오 없이 녹화 진행');
      }

      // MediaRecorder 설정
      currentMimeType = getBestMimeType(quality);
      const options = {
        mimeType: currentMimeType,
        videoBitsPerSecond: qualityConfig.VIDEO_BITRATE,
        audioBitsPerSecond: qualityConfig.AUDIO_BITRATE
      };

      mediaRecorder = new MediaRecorder(canvasStream, options);

      // 이벤트 핸들러
      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.onerror = (event) => {
        console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
        console.error('[숲토킹 Recorder] 오류 스택:', event.error?.stack);
        notifyError(event.error?.message || '녹화 오류');
      };

      // 상태 초기화
      currentStreamerId = streamerId;
      currentNickname = nickname;
      recordedChunks = [];
      totalRecordedBytes = 0;
      partNumber = 1;
      recordingStartTime = Date.now();
      generateFileName(streamerId);
      isRecording = true;
      isSaving = false;
      isSplitting = false;
      stopRetryCount = 0;

      // 녹화 시작
      mediaRecorder.start(CONFIG.TIMESLICE);
      console.log('[숲토킹 Recorder] MediaRecorder 시작됨');

      // 진행 상황 보고 시작
      startProgressReporting();

      // 성공 알림
      notifyRecordingStarted(streamerId, nickname);

      return { success: true };

    } catch (error) {
      console.error('[숲토킹 Recorder] 녹화 시작 실패:', error);
      console.error('[숲토킹 Recorder] 오류 스택:', error.stack);
      cleanupCanvas();
      isRecording = false;
      return { success: false, error: error.message };
    }
  }

  // 녹화 중지
  function stopRecording() {
    if (!isRecording || !mediaRecorder) {
      console.log('[숲토킹 Recorder] 녹화 중이 아님');
      return { success: false, error: '녹화 중이 아닙니다.' };
    }

    // 파트 전환 중이면 대기
    if (isSplitting) {
      console.log('[숲토킹 Recorder] 파트 전환 중, 잠시 후 재시도');
      setTimeout(() => stopRecording(), 500);
      return { success: true, pending: true };
    }

    // 저장 중이면 대기 (최대 재시도 횟수 제한)
    if (isSaving) {
      stopRetryCount++;

      if (stopRetryCount > CONFIG.MAX_STOP_RETRIES) {
        console.log('[숲토킹 Recorder] 저장 대기 초과, 강제 종료');
        isSaving = false;
      } else {
        console.log(`[숲토킹 Recorder] 저장 완료 대기 중... (${stopRetryCount}/${CONFIG.MAX_STOP_RETRIES})`);
        setTimeout(() => stopRecording(), 500);
        return { success: true, pending: true };
      }
    }

    stopRetryCount = 0;

    // 최소 녹화 시간 체크
    const elapsed = Date.now() - recordingStartTime;
    if (elapsed < CONFIG.MIN_RECORD_TIME) {
      const remaining = CONFIG.MIN_RECORD_TIME - elapsed;
      console.log(`[숲토킹 Recorder] 최소 녹화 시간 대기: ${remaining}ms`);
      setTimeout(() => {
        if (isRecording && mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
      }, remaining);
      return { success: true, pending: true };
    }

    console.log('[숲토킹 Recorder] 녹화 중지 요청');
    logMemoryUsage('녹화 중지 전');

    try {
      // 진행 상황 보고 중지
      if (progressIntervalId) {
        clearInterval(progressIntervalId);
        progressIntervalId = null;
      }

      // MediaRecorder 중지
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }

      return { success: true };

    } catch (error) {
      console.error('[숲토킹 Recorder] 녹화 중지 실패:', error);
      console.error('[숲토킹 Recorder] 오류 스택:', error.stack);
      return { success: false, error: error.message };
    }
  }

  // 데이터 청크 처리
  function handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      totalRecordedBytes += event.data.size;

      // ⭐ 파일 크기 체크 (500MB 초과 시 MediaRecorder 재시작으로 분할)
      if (totalRecordedBytes >= CONFIG.MAX_FILE_SIZE && !isSaving && !isSplitting) {
        console.log('[숲토킹 Recorder] 파일 크기 제한 도달, MediaRecorder 재시작 분할');
        splitWithRecorderRestart();
      }
    }
  }

  // ⭐ MediaRecorder 재시작으로 분할 저장 (핵심 변경)
  async function splitWithRecorderRestart() {
    if (isSplitting || isSaving || !isRecording) return;

    isSplitting = true;
    console.log(`[숲토킹 Recorder] 파트 ${partNumber} 분할 시작...`);
    logMemoryUsage('분할 전');

    // UI에 파트 전환 알림
    notifySplitStart(partNumber);

    try {
      // 1. 현재 MediaRecorder 중지 (onstop 핸들러 실행 방지를 위해 플래그 설정)
      const currentChunks = [...recordedChunks];  // 청크 복사
      recordedChunks = [];  // 새 파트용으로 초기화

      // MediaRecorder 중지 (ondataavailable로 남은 데이터 수집)
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        // 임시로 onstop 핸들러 교체
        const originalOnstop = mediaRecorder.onstop;
        mediaRecorder.onstop = null;

        await new Promise(resolve => {
          mediaRecorder.addEventListener('stop', resolve, { once: true });
          mediaRecorder.stop();
        });

        mediaRecorder.onstop = originalOnstop;
      }

      // 2. 현재 파트 저장
      if (currentChunks.length > 0) {
        const blob = new Blob(currentChunks, { type: 'video/webm' });
        const fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;

        console.log(`[숲토킹 Recorder] 파트 ${partNumber} 저장: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
        saveRecording(blob, fileName);

        // 명시적 메모리 정리
        currentChunks.length = 0;
      }

      // 3. 파트 번호 증가
      partNumber++;
      totalRecordedBytes = 0;

      // 4. 잠시 대기 (안정성)
      await new Promise(r => setTimeout(r, CONFIG.SPLIT_TRANSITION_DELAY));

      // 5. 새 MediaRecorder 생성 및 시작
      if (isRecording && canvasStream) {
        const qualityConfig = currentQuality === 'high' ? CONFIG.HIGH_QUALITY : CONFIG.LOW_QUALITY;

        const options = {
          mimeType: currentMimeType,
          videoBitsPerSecond: qualityConfig.VIDEO_BITRATE,
          audioBitsPerSecond: qualityConfig.AUDIO_BITRATE
        };

        mediaRecorder = new MediaRecorder(canvasStream, options);
        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.onerror = (event) => {
          console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
          notifyError(event.error?.message || '녹화 오류');
        };

        mediaRecorder.start(CONFIG.TIMESLICE);
        console.log(`[숲토킹 Recorder] 파트 ${partNumber} 녹화 시작 (새 MediaRecorder)`);

        // UI에 파트 전환 완료 알림
        notifySplitComplete(partNumber);
      }

      logMemoryUsage('분할 후');

    } catch (error) {
      console.error('[숲토킹 Recorder] 분할 중 오류:', error);
      console.error('[숲토킹 Recorder] 오류 스택:', error.stack);
      notifyError('파트 분할 중 오류가 발생했습니다.');
    } finally {
      isSplitting = false;
    }
  }

  // 녹화 종료 처리
  function handleRecordingStop() {
    // 파트 전환 중이면 무시 (splitWithRecorderRestart에서 처리)
    if (isSplitting) {
      return;
    }

    console.log('[숲토킹 Recorder] MediaRecorder 중지됨');

    // 최종 저장
    finalizeRecording();

    // 정리 (오디오 연결은 유지)
    cleanupCanvas();
    mediaRecorder = null;
    isRecording = false;

    logMemoryUsage('녹화 종료 후');
  }

  // 최종 저장
  function finalizeRecording() {
    if (recordedChunks.length === 0) {
      console.log('[숲토킹 Recorder] 저장할 데이터 없음');
      notifyRecordingStopped(0, 0, false);
      return;
    }

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

    let fileName;
    if (partNumber > 1) {
      fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;
    } else {
      fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}.webm`;
    }

    saveRecording(blob, fileName);

    console.log(`[숲토킹 Recorder] 녹화 완료: ${fileName}, 크기: ${(blob.size / 1024 / 1024).toFixed(2)}MB, 시간: ${duration}초`);
    notifyRecordingStopped(blob.size, duration, true);

    // 명시적 메모리 정리
    recordedChunks.length = 0;
    recordedChunks = [];
    totalRecordedBytes = 0;
    partNumber = 1;
  }

  // 파일 저장 (Content Script로 전달)
  function saveRecording(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);

    window.postMessage({
      type: 'SOOPTALKING_SAVE_RECORDING',
      fileName: fileName,
      size: blob.size,
      blobUrl: blobUrl,
      streamerId: currentStreamerId,
      nickname: currentNickname
    }, '*');

    console.log(`[숲토킹 Recorder] 저장 요청: ${fileName}`);
  }

  // 진행 상황 보고
  function startProgressReporting() {
    if (progressIntervalId) {
      clearInterval(progressIntervalId);
    }

    progressIntervalId = setInterval(() => {
      if (!isRecording) {
        clearInterval(progressIntervalId);
        return;
      }

      const elapsedTime = Math.floor((Date.now() - recordingStartTime) / 1000);

      window.postMessage({
        type: 'SOOPTALKING_RECORDING_PROGRESS',
        streamerId: currentStreamerId,
        totalBytes: totalRecordedBytes,
        elapsedTime: elapsedTime,
        partNumber: partNumber,
        isSplitting: isSplitting  // ⭐ 파트 전환 중 여부
      }, '*');

    }, CONFIG.PROGRESS_INTERVAL);
  }

  // ===== 알림 함수 =====

  function notifyRecordingStarted(streamerId, nickname) {
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_STARTED',
      streamerId: streamerId,
      nickname: nickname,
      recordingId: Date.now().toString()
    }, '*');
  }

  function notifyRecordingStopped(totalBytes, duration, saved) {
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_STOPPED',
      streamerId: currentStreamerId,
      totalBytes: totalBytes,
      duration: duration,
      saved: saved
    }, '*');
  }

  function notifyError(message) {
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_ERROR',
      error: message
    }, '*');
  }

  // ⭐ 파트 전환 시작 알림
  function notifySplitStart(partNum) {
    window.postMessage({
      type: 'SOOPTALKING_SPLIT_START',
      partNumber: partNum,
      streamerId: currentStreamerId
    }, '*');
  }

  // ⭐ 파트 전환 완료 알림
  function notifySplitComplete(newPartNum) {
    window.postMessage({
      type: 'SOOPTALKING_SPLIT_COMPLETE',
      partNumber: newPartNum,
      streamerId: currentStreamerId
    }, '*');
  }

  // ===== 메시지 핸들러 =====

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = event.data;
    console.log('[숲토킹 Recorder] 명령 수신:', command);

    let result;
    switch (command) {
      case 'START_RECORDING':
        result = await startRecording(
          params?.streamerId,
          params?.nickname,
          params?.quality || 'high'
        );
        break;

      case 'STOP_RECORDING':
        result = stopRecording();
        break;

      case 'GET_STATUS':
        result = {
          success: true,
          isRecording: isRecording,
          isSplitting: isSplitting,
          streamerId: currentStreamerId,
          totalBytes: totalRecordedBytes,
          elapsedTime: recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0,
          quality: currentQuality,
          partNumber: partNumber
        };
        break;

      case 'PING':
        result = { success: true, pong: true, version: '3.5.8.2' };
        break;

      default:
        result = { success: false, error: '알 수 없는 명령' };
    }

    // 결과 전송
    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESPONSE',
      command: command,
      result: result
    }, '*');
  });

  console.log('[숲토킹 Recorder] 메시지 리스너 등록 완료');

})();
