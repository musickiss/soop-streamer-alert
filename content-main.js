// ===== 숲토킹 - SOOP 스트리머 방송 알림 =====
// content-main.js - MAIN world Canvas 녹화 스크립트
// v3.5.8 - Canvas 우회 녹화 + AV1 기본값

(function() {
  'use strict';

  // 이미 로드된 경우 스킵
  if (window.__SOOPTALKING_RECORDER_LOADED__) {
    console.log('[숲토킹 Recorder] 이미 로드됨, 스킵');
    return;
  }
  window.__SOOPTALKING_RECORDER_LOADED__ = true;

  console.log('[숲토킹 Recorder] v3.5.8 로드됨');

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
    CANVAS_DRAW_INTERVAL: 16,     // ~60fps 그리기 체크
    MIN_RECORD_TIME: 2000,        // 최소 녹화 시간 2초
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
  let currentQuality = 'high';  // 'high' (AV1) 또는 'low' (VP9)

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

  // ===== 유틸리티 함수 =====

  // 최적 코덱 선택
  function getBestMimeType(quality) {
    const config = quality === 'high' ? CONFIG.HIGH_QUALITY : CONFIG.LOW_QUALITY;

    for (const codec of config.CODEC_PRIORITY) {
      // AV1 변형들 시도
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

    console.warn('[숲토킹 Recorder] 기본 코덱 사용');
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
    // 1순위: 재생 중인 큰 비디오
    const videos = document.querySelectorAll('video');
    let bestVideo = null;
    let maxArea = 0;

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
      // 트랙이 죽었으면 재연결 필요
      console.log('[숲토킹 Recorder] 오디오 트랙 무효, 재연결 시도');
      connectedVideo = null;
    }

    // Case 2: 다른 video거나 새 연결 필요
    try {
      // 기존 AudioContext 정리 (다른 video인 경우)
      if (audioCtx && connectedVideo !== video) {
        try {
          audioCtx.close();
        } catch (e) {}
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

      // MediaElementSource 생성 (한 번만 가능!)
      audioSource = audioCtx.createMediaElementSource(video);
      audioDest = audioCtx.createMediaStreamDestination();

      // 연결: 녹화용 + 스피커 출력
      audioSource.connect(audioDest);
      audioSource.connect(audioCtx.destination);

      connectedVideo = video;
      console.log('[숲토킹 Recorder] 오디오 연결 성공');

      return audioDest.stream.getAudioTracks()[0];

    } catch (e) {
      console.warn('[숲토킹 Recorder] 오디오 연결 실패:', e.message);

      // 이미 연결된 경우 기존 dest에서 트랙 반환 시도
      if (audioDest && connectedVideo === video) {
        const track = audioDest.stream.getAudioTracks()[0];
        if (track) return track;
      }

      return null;
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

    recordingCtx = recordingCanvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false
    });

    console.log(`[숲토킹 Recorder] Canvas 생성: ${width}x${height}`);
    return true;
  }

  // Canvas에 비디오 프레임 그리기 시작
  function startCanvasDrawing(video, targetFps) {
    sourceVideo = video;

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
          console.log('[숲토킹 Recorder] 새 video로 전환');
        } else {
          console.log('[숲토킹 Recorder] video를 찾을 수 없음, 녹화 중지');
          stopRecording();
          return;
        }
      }

      // video 상태 확인
      if (sourceVideo.paused || sourceVideo.ended ||
          sourceVideo.readyState < 2 || sourceVideo.videoWidth === 0) {
        console.log('[숲토킹 Recorder] video 종료/일시정지 감지');
        // 잠시 대기 후 재확인 (버퍼링일 수 있음)
        return;
      }

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
        // 그리기 실패는 무시 (일시적 오류)
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
      canvasStream.getVideoTracks().forEach(track => track.stop());
      canvasStream = null;
    }

    if (recordingCanvas) {
      recordingCanvas.width = 0;
      recordingCanvas.height = 0;
      recordingCanvas = null;
    }

    recordingCtx = null;
    sourceVideo = null;
  }

  // 탭 종료 시 모든 리소스 정리
  window.addEventListener('beforeunload', () => {
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

  // 백그라운드 탭 경고
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording) {
      console.warn('[숲토킹 Recorder] 탭이 백그라운드로 이동, 프레임 저하 가능');
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
      console.warn('[숲토킹 Recorder] 이미 녹화 중');
      return { success: false, error: '이미 녹화 중입니다.' };
    }

    console.log(`[숲토킹 Recorder] 녹화 시작 요청: ${streamerId}, 품질: ${quality}`);
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
        console.warn('[숲토킹 Recorder] 오디오 없이 녹화 진행');
      }

      // MediaRecorder 설정
      const mimeType = getBestMimeType(quality);
      const options = {
        mimeType: mimeType,
        videoBitsPerSecond: qualityConfig.VIDEO_BITRATE,
        audioBitsPerSecond: qualityConfig.AUDIO_BITRATE
      };

      mediaRecorder = new MediaRecorder(canvasStream, options);

      // 이벤트 핸들러
      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.onerror = (event) => {
        console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
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
      cleanupCanvas();
      isRecording = false;
      return { success: false, error: error.message };
    }
  }

  // 녹화 중지
  function stopRecording() {
    if (!isRecording || !mediaRecorder) {
      console.warn('[숲토킹 Recorder] 녹화 중이 아님');
      return { success: false, error: '녹화 중이 아닙니다.' };
    }

    // 저장 중이면 대기
    if (isSaving) {
      console.log('[숲토킹 Recorder] 저장 완료 대기 중...');
      setTimeout(() => stopRecording(), 500);
      return { success: true, pending: true };
    }

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
      return { success: false, error: error.message };
    }
  }

  // 데이터 청크 처리
  function handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      totalRecordedBytes += event.data.size;

      // 파일 크기 체크 (500MB 초과 시 분할)
      if (totalRecordedBytes >= CONFIG.MAX_FILE_SIZE && !isSaving) {
        console.log('[숲토킹 Recorder] 파일 크기 제한 도달, 분할 저장');
        splitAndSave();
      }
    }
  }

  // 파일 분할 저장
  async function splitAndSave() {
    if (recordedChunks.length === 0 || isSaving) return;

    isSaving = true;

    try {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;

      await saveRecording(blob, fileName);

      // 다음 파트 준비
      recordedChunks = [];
      totalRecordedBytes = 0;
      partNumber++;

    } finally {
      isSaving = false;
    }
  }

  // 녹화 종료 처리
  function handleRecordingStop() {
    console.log('[숲토킹 Recorder] MediaRecorder 중지됨');

    // 최종 저장
    finalizeRecording();

    // 정리 (오디오 연결은 유지)
    cleanupCanvas();
    mediaRecorder = null;
    isRecording = false;
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

    // 상태 초기화
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
        partNumber: partNumber
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
          params?.quality || 'high'  // 기본값: high (AV1)
        );
        break;

      case 'STOP_RECORDING':
        result = stopRecording();
        break;

      case 'GET_STATUS':
        result = {
          success: true,
          isRecording: isRecording,
          streamerId: currentStreamerId,
          totalBytes: totalRecordedBytes,
          elapsedTime: recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0,
          quality: currentQuality
        };
        break;

      case 'PING':
        result = { success: true, pong: true, version: '3.5.8' };
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
