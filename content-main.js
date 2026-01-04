// ===== 숲토킹 - SOOP 스트리머 방송 알림 =====
// content-main.js - MAIN world Canvas 녹화 스크립트
// v3.5.16 - 자동 녹화 즉시 종료 버그 수정 (비디오 상태 체크 완화)

(function() {
  'use strict';

  // 이미 로드된 경우 스킵
  if (window.__SOOPTALKING_RECORDER_LOADED__) {
    console.log('[숲토킹 Recorder] 이미 로드됨, 스킵');
    return;
  }
  window.__SOOPTALKING_RECORDER_LOADED__ = true;

  console.log('[숲토킹 Recorder] v3.5.10 로드됨');

  // ===== 설정 =====
  const CONFIG = {
    // ⭐ 원본급 (Ultra) - VP9 30Mbps - 기본값
    ULTRA_QUALITY: {
      VIDEO_BITRATE: 30000000,    // 30 Mbps
      AUDIO_BITRATE: 320000,      // 320 kbps
      TARGET_FPS: 60,
      CODEC_PRIORITY: ['vp9', 'vp8']
    },
    // ⭐ 고품질 (High) - VP9 15Mbps
    HIGH_QUALITY: {
      VIDEO_BITRATE: 15000000,    // 15 Mbps
      AUDIO_BITRATE: 192000,      // 192 kbps
      TARGET_FPS: 60,
      CODEC_PRIORITY: ['vp9', 'vp8']
    },
    // ⭐ 표준 (Standard) - VP8 8Mbps
    STANDARD_QUALITY: {
      VIDEO_BITRATE: 8000000,     // 8 Mbps
      AUDIO_BITRATE: 128000,      // 128 kbps
      TARGET_FPS: 30,
      CODEC_PRIORITY: ['vp8', 'vp9']  // VP8 우선
    },
    // 공통 설정
    TIMESLICE: 2000,
    MAX_FILE_SIZE: 500 * 1024 * 1024,  // 500MB 유지
    PROGRESS_INTERVAL: 5000,
    CANVAS_DRAW_INTERVAL: 8,
    MIN_RECORD_TIME: 2000,
    MAX_VIDEO_UNAVAILABLE: 750,  // 60 → 750 (약 6초로 확장)
    MAX_STOP_RETRIES: 10,
    MAX_SPLIT_WAIT: 20,           // ⭐ 분할 대기 최대 횟수 (10초)
    SPLIT_TRANSITION_DELAY: 300,
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
  let isSplitting = false;
  let currentQuality = 'high';
  let currentMimeType = null;

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
  let splitWaitCount = 0;  // ⭐ 분할 대기 카운터

  // ===== 유틸리티 함수 =====

  function logMemoryUsage(context) {
    if (typeof performance !== 'undefined' && performance.memory) {
      const usedMB = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024);
      const totalMB = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024);
      console.log(`[숲토킹 Recorder] 메모리 (${context}): ${usedMB}MB / ${totalMB}MB`);
    }
  }

  function getBestMimeType(quality) {
    const qualityConfig = getQualityConfig(quality);

    console.log(`[숲토킹 Recorder] getBestMimeType 호출: quality = "${quality}"`);
    console.log(`[숲토킹 Recorder]   코덱 우선순위: [${qualityConfig.CODEC_PRIORITY.join(', ')}]`);

    for (const codec of qualityConfig.CODEC_PRIORITY) {
      const mimeType = `video/webm;codecs=${codec},opus`;
      const isSupported = MediaRecorder.isTypeSupported(mimeType);
      console.log(`[숲토킹 Recorder]   - ${codec}: ${isSupported ? '지원됨 ✓' : '미지원 ✗'}`);

      if (isSupported) {
        console.log(`[숲토킹 Recorder] ★ 코덱 선택: ${codec.toUpperCase()}`);
        return mimeType;
      }
    }

    console.warn('[숲토킹 Recorder] 지원되는 코덱 없음, 기본 WebM 사용');
    return 'video/webm';
  }

  function generateFileName(streamerId, quality) {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    recordingStartTimestamp = timestamp;
    // ⭐ v3.5.11: 품질 정보 추가
    const qualityShort = getQualityShortName(quality);
    return `soop_${streamerId}_${timestamp}_${qualityShort}.webm`;
  }

  // ⭐ v3.5.9.1: 품질 설정 헬퍼 함수
  function getQualityConfig(quality) {
    switch (quality) {
      case 'ultra':
        return CONFIG.ULTRA_QUALITY;
      case 'high':
        return CONFIG.HIGH_QUALITY;
      case 'standard':
        return CONFIG.STANDARD_QUALITY;
      default:
        return CONFIG.ULTRA_QUALITY;
    }
  }

  // ⭐ v3.5.11: 품질 약어 변환 함수 (파일명용)
  function getQualityShortName(quality) {
    switch (quality) {
      case 'ultra':
        return 'ultra';
      case 'high':
        return 'high';
      case 'standard':
        return 'std';
      default:
        return 'ultra';
    }
  }

  // ⭐ v3.5.9.1: Promise 기반 MediaRecorder 종료 대기
  function stopMediaRecorderAndWait() {
    return new Promise((resolve) => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        console.log('[숲토킹 Recorder] MediaRecorder 이미 비활성 상태');
        resolve([...recordedChunks]);
        return;
      }

      console.log('[숲토킹 Recorder] MediaRecorder 종료 대기 시작...');

      // onstop 이벤트에서 청크 반환
      mediaRecorder.onstop = (event) => {
        console.log('[숲토킹 Recorder] MediaRecorder 종료 완료, 청크 수집');
        const allChunks = [...recordedChunks];
        resolve(allChunks);
      };

      // 마지막 데이터 요청
      try {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.requestData();
        }
      } catch (e) {
        console.log('[숲토킹 Recorder] requestData 실패 (무시):', e.message);
      }

      // 종료 요청
      try {
        mediaRecorder.stop();
      } catch (e) {
        console.log('[숲토킹 Recorder] stop 실패:', e.message);
        resolve([...recordedChunks]);
      }
    });
  }

  function findVideoElement() {
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

    for (const v of videos) {
      if (v.readyState >= 2 && v.videoWidth > 0) {
        return v;
      }
    }

    for (const v of videos) {
      if (v.videoWidth > 0) {
        return v;
      }
    }

    return null;
  }

  // ===== 오디오 관리 함수 =====

  async function getOrCreateAudioTrack(video) {
    if (audioCtx && audioCtx.state === 'closed') {
      audioCtx = null;
      audioSource = null;
      audioDest = null;
      connectedVideo = null;
    }

    if (connectedVideo === video && audioDest) {
      const track = audioDest.stream.getAudioTracks()[0];
      if (track && track.readyState === 'live') {
        console.log('[숲토킹 Recorder] 오디오 연결 재사용');
        return track;
      }
      console.log('[숲토킹 Recorder] 오디오 트랙 무효, 재연결 시도');
      connectedVideo = null;
    }

    try {
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

      if (!audioCtx) {
        audioCtx = new AudioContext();
      }

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
        console.log('[숲토킹 Recorder] AudioContext resumed');
      }

      audioSource = audioCtx.createMediaElementSource(video);
      audioDest = audioCtx.createMediaStreamDestination();

      audioSource.connect(audioDest);
      audioSource.connect(audioCtx.destination);

      connectedVideo = video;
      console.log('[숲토킹 Recorder] 오디오 연결 성공');

      return audioDest.stream.getAudioTracks()[0];

    } catch (e) {
      console.log('[숲토킹 Recorder] 오디오 연결 실패:', e.message);

      if (audioDest && connectedVideo === video) {
        const track = audioDest.stream.getAudioTracks()[0];
        if (track) return track;
      }

      return null;
    }
  }

  async function reconnectAudioToNewVideo(newVideo) {
    if (connectedVideo === newVideo) {
      return;
    }

    console.log('[숲토킹 Recorder] 새 video 감지, 오디오 재연결 시도...');

    try {
      const track = await getOrCreateAudioTrack(newVideo);

      if (track && canvasStream) {
        const oldAudioTracks = canvasStream.getAudioTracks();
        oldAudioTracks.forEach(t => {
          canvasStream.removeTrack(t);
          console.log('[숲토킹 Recorder] 기존 오디오 트랙 제거됨');
        });

        canvasStream.addTrack(track);
        console.log('[숲토킹 Recorder] 오디오 재연결 완료');
      }
    } catch (e) {
      console.log('[숲토킹 Recorder] 오디오 재연결 실패:', e.message);
    }
  }

  // ===== Canvas 관리 함수 =====

  function setupCanvas(video) {
    cleanupCanvas();

    const width = video.videoWidth || 1920;
    const height = video.videoHeight || 1080;

    recordingCanvas = document.createElement('canvas');
    recordingCanvas.width = width;
    recordingCanvas.height = height;

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

  function startCanvasDrawing(video, targetFps) {
    sourceVideo = video;
    videoUnavailableCount = 0;

    if (drawIntervalId) {
      clearInterval(drawIntervalId);
    }

    const minInterval = Math.floor(1000 / targetFps);
    let lastDrawTime = 0;

    drawIntervalId = setInterval(() => {
      if (!sourceVideo) {
        return;
      }

      if (!document.body.contains(sourceVideo)) {
        console.log('[숲토킹 Recorder] video 요소 DOM에서 제거됨, 새 video 탐색...');
        const newVideo = findVideoElement();

        if (newVideo && newVideo !== sourceVideo) {
          sourceVideo = newVideo;
          recordingCanvas.width = newVideo.videoWidth || recordingCanvas.width;
          recordingCanvas.height = newVideo.videoHeight || recordingCanvas.height;

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

      // ⭐ v3.5.16: 비디오 상태 체크 완화 - paused 상태는 자동재생 정책으로 인한 것일 수 있음
      const videoUnavailable = sourceVideo.ended ||
          sourceVideo.readyState < 2 || sourceVideo.videoWidth === 0;

      // paused 상태는 별도 처리 (자동재생 시도)
      if (sourceVideo.paused && !sourceVideo.ended && sourceVideo.readyState >= 2) {
        // 자동재생 시도 (Chrome 정책으로 실패할 수 있음)
        sourceVideo.play().catch(() => {});
      }

      if (videoUnavailable) {
        videoUnavailableCount++;

        // ⭐ 로그 추가 (디버깅용)
        if (videoUnavailableCount % 100 === 0) {
          console.log(`[숲토킹 Recorder] 비디오 상태 불안정 (${videoUnavailableCount}/${CONFIG.MAX_VIDEO_UNAVAILABLE}): ` +
            `paused=${sourceVideo.paused}, ended=${sourceVideo.ended}, readyState=${sourceVideo.readyState}, videoWidth=${sourceVideo.videoWidth}`);
        }

        if (videoUnavailableCount > CONFIG.MAX_VIDEO_UNAVAILABLE) {
          console.log('[숲토킹 Recorder] video 장시간 비정상 상태, 녹화 중지');
          stopRecording();
          return;
        }
        return;
      }

      videoUnavailableCount = 0;

      const now = performance.now();
      if (now - lastDrawTime < minInterval) {
        return;
      }

      try {
        if (recordingCanvas.width !== sourceVideo.videoWidth ||
            recordingCanvas.height !== sourceVideo.videoHeight) {
          if (sourceVideo.videoWidth > 0 && sourceVideo.videoHeight > 0) {
            recordingCanvas.width = sourceVideo.videoWidth;
            recordingCanvas.height = sourceVideo.videoHeight;
            console.log(`[숲토킹 Recorder] 해상도 변경: ${recordingCanvas.width}x${recordingCanvas.height}`);
          }
        }

        recordingCtx.drawImage(sourceVideo, 0, 0, recordingCanvas.width, recordingCanvas.height);
        lastDrawTime = now;

      } catch (e) {
        console.log('[숲토킹 Recorder] drawImage 실패:', e.message);
      }
    }, CONFIG.CANVAS_DRAW_INTERVAL);

    console.log('[숲토킹 Recorder] Canvas 그리기 시작');
  }

  function cleanupCanvas() {
    if (drawIntervalId) {
      clearInterval(drawIntervalId);
      drawIntervalId = null;
    }

    if (canvasStream) {
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

  // ⭐ Canvas 스트림 유효성 검증 및 재생성
  function ensureValidCanvasStream() {
    if (!canvasStream) {
      console.log('[숲토킹 Recorder] canvasStream 없음, 재생성 필요');
      return recreateCanvasStream();
    }

    // 비디오 트랙 유효성 검증
    const videoTracks = canvasStream.getVideoTracks();
    const hasActiveVideo = videoTracks.some(t => t.readyState === 'live');

    if (!hasActiveVideo) {
      console.log('[숲토킹 Recorder] 비디오 트랙 무효, 스트림 재생성');
      return recreateCanvasStream();
    }

    // 오디오 트랙 검증 (선택적)
    const audioTracks = canvasStream.getAudioTracks();
    const hasActiveAudio = audioTracks.some(t => t.readyState === 'live');

    if (!hasActiveAudio && audioDest) {
      console.log('[숲토킹 Recorder] 오디오 트랙 무효, 재연결 시도');
      const audioTrack = audioDest.stream.getAudioTracks()[0];
      if (audioTrack && audioTrack.readyState === 'live') {
        // 기존 무효 트랙 제거
        audioTracks.forEach(t => {
          try { canvasStream.removeTrack(t); } catch (e) {}
        });
        canvasStream.addTrack(audioTrack);
        console.log('[숲토킹 Recorder] 오디오 트랙 재연결됨');
      }
    }

    return true;
  }

  // ⭐ Canvas 스트림 재생성
  function recreateCanvasStream() {
    if (!recordingCanvas) {
      console.error('[숲토킹 Recorder] recordingCanvas 없음, 재생성 불가');
      return false;
    }

    try {
      // ⭐ 3단계 품질 설정
      let qualityConfig;
      switch (currentQuality) {
        case 'ultra':
          qualityConfig = CONFIG.ULTRA_QUALITY;
          break;
        case 'high':
          qualityConfig = CONFIG.HIGH_QUALITY;
          break;
        case 'standard':
          qualityConfig = CONFIG.STANDARD_QUALITY;
          break;
        default:
          qualityConfig = CONFIG.ULTRA_QUALITY;
      }

      // 새 Canvas 스트림 생성
      canvasStream = recordingCanvas.captureStream(qualityConfig.TARGET_FPS);
      console.log('[숲토킹 Recorder] Canvas 스트림 재생성됨');

      // 오디오 트랙 추가
      if (audioDest) {
        const audioTrack = audioDest.stream.getAudioTracks()[0];
        if (audioTrack && audioTrack.readyState === 'live') {
          canvasStream.addTrack(audioTrack);
          console.log('[숲토킹 Recorder] 오디오 트랙 재추가됨');
        } else {
          console.log('[숲토킹 Recorder] 오디오 트랙 무효, 영상만 녹화');
        }
      }

      return true;
    } catch (e) {
      console.error('[숲토킹 Recorder] Canvas 스트림 재생성 실패:', e.message);
      return false;
    }
  }

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

  // 백그라운드 탭 경고 (console.log 사용)
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

  async function startRecording(streamerId, nickname, quality = 'ultra') {
    // ⭐ v3.5.9.2: 최상단에 파라미터 로깅 추가
    console.log('=========================================');
    console.log('[숲토킹 Recorder] ★ startRecording 호출됨');
    console.log(`[숲토킹 Recorder]   streamerId: ${streamerId}`);
    console.log(`[숲토킹 Recorder]   nickname: ${nickname}`);
    console.log(`[숲토킹 Recorder]   quality: ${quality} (타입: ${typeof quality})`);
    console.log('=========================================');

    // ⭐ quality 유효성 검사 추가
    if (!quality || quality === 'undefined' || quality === 'null') {
      console.warn(`[숲토킹 Recorder] quality가 유효하지 않음 (${quality}), 기본값 'ultra' 사용`);
      quality = 'ultra';
    }

    if (isRecording) {
      console.log('[숲토킹 Recorder] 이미 녹화 중');
      return { success: false, error: '이미 녹화 중입니다.' };
    }

    console.log(`[숲토킹 Recorder] 녹화 시작 요청: ${streamerId}, 품질: ${quality}`);
    logMemoryUsage('녹화 시작 전');

    currentQuality = quality;

    try {
      const video = findVideoElement();
      if (!video) {
        throw new Error('비디오 요소를 찾을 수 없습니다.');
      }

      // ⭐ v3.5.16: 비디오 로딩 + 재생 대기 강화
      if (video.readyState < 2) {
        console.log('[숲토킹 Recorder] 비디오 로딩 대기...');
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('비디오 로딩 타임아웃')), 15000);  // 10초 → 15초
          video.addEventListener('loadeddata', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }

      // ⭐ v3.5.16: 비디오 재생 상태 확인 및 자동재생 시도
      if (video.paused) {
        console.log('[숲토킹 Recorder] 비디오가 paused 상태, 재생 시도...');
        try {
          await video.play();
          console.log('[숲토킹 Recorder] 비디오 재생 시작됨');
        } catch (e) {
          console.log('[숲토킹 Recorder] 자동재생 실패 (Chrome 정책), 녹화는 계속 시도:', e.message);
        }
        // 재생 시도 후 잠시 대기
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[숲토킹 Recorder] 비디오 발견: ${video.videoWidth}x${video.videoHeight}`);

      // ⭐ v3.5.9.2: 품질 설정 가져오기 (헬퍼 함수 사용 + 상세 로깅)
      const qualityConfig = getQualityConfig(quality);

      // ⭐ 녹화 설정 상세 로깅
      console.log('[숲토킹 Recorder] ========== 녹화 설정 ==========');
      console.log(`[숲토킹 Recorder]   품질: ${quality}`);
      console.log(`[숲토킹 Recorder]   비트레이트: ${(qualityConfig.VIDEO_BITRATE / 1000000).toFixed(0)} Mbps`);
      console.log(`[숲토킹 Recorder]   오디오: ${(qualityConfig.AUDIO_BITRATE / 1000).toFixed(0)} kbps`);
      console.log(`[숲토킹 Recorder]   FPS: ${qualityConfig.TARGET_FPS}`);
      console.log(`[숲토킹 Recorder]   코덱 우선순위: [${qualityConfig.CODEC_PRIORITY.join(', ')}]`);
      console.log('[숲토킹 Recorder] ================================');

      if (!setupCanvas(video)) {
        throw new Error('Canvas 설정 실패');
      }

      startCanvasDrawing(video, qualityConfig.TARGET_FPS);

      await new Promise(r => setTimeout(r, 200));

      canvasStream = recordingCanvas.captureStream(qualityConfig.TARGET_FPS);
      console.log('[숲토킹 Recorder] Canvas 스트림 획득');

      const audioTrack = await getOrCreateAudioTrack(video);
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
        console.log('[숲토킹 Recorder] 오디오 트랙 추가됨');
      } else {
        console.log('[숲토킹 Recorder] 오디오 없이 녹화 진행');
      }

      currentMimeType = getBestMimeType(quality);
      const options = {
        mimeType: currentMimeType,
        videoBitsPerSecond: qualityConfig.VIDEO_BITRATE,
        audioBitsPerSecond: qualityConfig.AUDIO_BITRATE
      };

      console.log(`[숲토킹 Recorder] 녹화 설정: ${(qualityConfig.VIDEO_BITRATE / 1000000).toFixed(0)}Mbps, ${qualityConfig.TARGET_FPS}fps`);

      mediaRecorder = new MediaRecorder(canvasStream, options);

      // ⭐ v3.5.9.2: 실제 적용된 설정 확인 로그
      console.log(`[숲토킹 Recorder] MediaRecorder 생성됨`);
      console.log(`[숲토킹 Recorder]   - mimeType: ${mediaRecorder.mimeType}`);
      console.log(`[숲토킹 Recorder]   - videoBitsPerSecond: ${options.videoBitsPerSecond / 1000000}Mbps`);
      console.log(`[숲토킹 Recorder]   - audioBitsPerSecond: ${options.audioBitsPerSecond / 1000}kbps`);

      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.onerror = (event) => {
        console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
        console.error('[숲토킹 Recorder] 오류 스택:', event.error?.stack);
        notifyError(event.error?.message || '녹화 오류');
      };

      currentStreamerId = streamerId;
      currentNickname = nickname;
      recordedChunks = [];
      totalRecordedBytes = 0;
      partNumber = 1;
      recordingStartTime = Date.now();
      generateFileName(streamerId, quality);
      isRecording = true;
      isSplitting = false;
      stopRetryCount = 0;
      splitWaitCount = 0;

      mediaRecorder.start(CONFIG.TIMESLICE);

      // ⭐ v3.5.9.2: 녹화 시작 완료 로그
      console.log(`[숲토킹 Recorder] ★ 녹화 시작 완료! (품질: ${quality}, ${(qualityConfig.VIDEO_BITRATE / 1000000).toFixed(0)}Mbps, ${qualityConfig.TARGET_FPS}fps)`);

      startProgressReporting();

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

  function stopRecording() {
    if (!isRecording || !mediaRecorder) {
      console.log('[숲토킹 Recorder] 녹화 중이 아님');
      return { success: false, error: '녹화 중이 아닙니다.' };
    }

    // ⭐ 파트 전환 중이면 대기 (최대 횟수 제한)
    if (isSplitting) {
      splitWaitCount++;

      if (splitWaitCount > CONFIG.MAX_SPLIT_WAIT) {
        console.log('[숲토킹 Recorder] 분할 대기 초과, 강제 종료');
        isSplitting = false;
      } else {
        console.log(`[숲토킹 Recorder] 파트 전환 중, 잠시 후 재시도 (${splitWaitCount}/${CONFIG.MAX_SPLIT_WAIT})`);
        setTimeout(() => stopRecording(), 500);
        return { success: true, pending: true };
      }
    }
    splitWaitCount = 0;

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
      if (progressIntervalId) {
        clearInterval(progressIntervalId);
        progressIntervalId = null;
      }

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

  function handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      totalRecordedBytes += event.data.size;

      if (totalRecordedBytes >= CONFIG.MAX_FILE_SIZE && !isSaving && !isSplitting) {
        console.log('[숲토킹 Recorder] 파일 크기 제한 도달, MediaRecorder 재시작 분할');
        splitWithRecorderRestart();
      }
    }
  }

  // ⭐ v3.5.9.1: MediaRecorder 재시작 분할 (Part2+ 재생 문제 해결)
  async function splitWithRecorderRestart() {
    if (isSplitting || isSaving || !isRecording) return;

    isSplitting = true;
    console.log(`[숲토킹 Recorder] 파트 ${partNumber} 분할 시작 (v3.5.9.1)...`);
    logMemoryUsage('분할 전');

    notifySplitStart(partNumber);

    try {
      // ===== 1단계: MediaRecorder 완전 종료 및 청크 수집 =====
      console.log('[숲토킹 Recorder] 1단계: MediaRecorder 종료 대기...');
      const allChunks = await stopMediaRecorderAndWait();
      console.log(`[숲토킹 Recorder] 수집된 청크: ${allChunks.length}개`);

      // ===== 2단계: 현재 파트 저장 =====
      if (allChunks.length > 0) {
        try {
          const blob = new Blob(allChunks, { type: 'video/webm' });
          // ⭐ v3.5.11: 품질 정보 포함
          const qualityShort = getQualityShortName(currentQuality);
          const fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_${qualityShort}_part${partNumber}.webm`;

          console.log(`[숲토킹 Recorder] 파트 ${partNumber} 저장: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
          saveRecording(blob, fileName);
        } catch (saveError) {
          console.error('[숲토킹 Recorder] 파트 저장 실패:', saveError);
          notifyError(`파트 ${partNumber} 저장 실패: ${saveError.message}`);
        }
      }

      // ===== 3단계: 상태 초기화 =====
      recordedChunks = [];  // 청크 배열 완전 초기화
      partNumber++;
      totalRecordedBytes = 0;

      console.log(`[숲토킹 Recorder] 상태 초기화 완료, 다음 파트: ${partNumber}`);

      // ===== 4단계: 잠시 대기 =====
      await new Promise(r => setTimeout(r, CONFIG.SPLIT_TRANSITION_DELAY));

      // ===== 5단계: 스트림 검증 및 새 MediaRecorder 생성 =====
      if (isRecording) {
        const streamValid = ensureValidCanvasStream();

        if (!streamValid) {
          console.error('[숲토킹 Recorder] 스트림 재생성 실패, 녹화 중지');
          notifyError('스트림 재생성 실패로 녹화가 중지되었습니다.');
          isRecording = false;
          isSplitting = false;
          cleanupCanvas();
          return;
        }

        // 새 MediaRecorder 생성 (헬퍼 함수 사용)
        const qualityConfig = getQualityConfig(currentQuality);
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
        console.log(`[숲토킹 Recorder] 파트 ${partNumber} 녹화 시작 (새 MediaRecorder, 새 WebM 헤더)`);

        notifySplitComplete(partNumber);
      }

      logMemoryUsage('분할 후');

    } catch (error) {
      console.error('[숲토킹 Recorder] 분할 중 오류:', error);
      console.error('[숲토킹 Recorder] 오류 스택:', error.stack);
      notifyError(`파트 분할 중 오류: ${error.message}`);

      // 분할 실패 시 복구 시도
      if (isRecording && !mediaRecorder) {
        console.log('[숲토킹 Recorder] 분할 실패 후 복구 시도...');
        try {
          if (ensureValidCanvasStream()) {
            const qualityConfig = getQualityConfig(currentQuality);
            const options = {
              mimeType: currentMimeType,
              videoBitsPerSecond: qualityConfig.VIDEO_BITRATE,
              audioBitsPerSecond: qualityConfig.AUDIO_BITRATE
            };
            mediaRecorder = new MediaRecorder(canvasStream, options);
            mediaRecorder.ondataavailable = handleDataAvailable;
            mediaRecorder.onstop = handleRecordingStop;
            mediaRecorder.start(CONFIG.TIMESLICE);
            console.log('[숲토킹 Recorder] 복구 성공, 녹화 재개');
          }
        } catch (recoveryError) {
          console.error('[숲토킹 Recorder] 복구 실패:', recoveryError);
          isRecording = false;
        }
      }
    } finally {
      isSplitting = false;
    }
  }

  function handleRecordingStop() {
    if (isSplitting) {
      return;
    }

    console.log('[숲토킹 Recorder] MediaRecorder 중지됨');

    finalizeRecording();

    cleanupCanvas();
    mediaRecorder = null;
    isRecording = false;

    logMemoryUsage('녹화 종료 후');
  }

  function finalizeRecording() {
    if (recordedChunks.length === 0) {
      console.log('[숲토킹 Recorder] 저장할 데이터 없음');

      // ⭐ v3.5.10: Background에 녹화 중지 알림 (저장 없음)
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_STOPPED_NOTIFY',
        streamerId: currentStreamerId,
        saved: false
      }, '*');

      notifyRecordingStopped(0, 0, false);
      return;
    }

    try {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

      // ⭐ v3.5.11: 품질 정보 포함
      const qualityShort = getQualityShortName(currentQuality);
      let fileName;
      if (partNumber > 1) {
        fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_${qualityShort}_part${partNumber}.webm`;
      } else {
        fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_${qualityShort}.webm`;
      }

      saveRecording(blob, fileName);

      console.log(`[숲토킹 Recorder] 녹화 완료: ${fileName}, 크기: ${(blob.size / 1024 / 1024).toFixed(2)}MB, 시간: ${duration}초`);
      notifyRecordingStopped(blob.size, duration, true);
    } catch (error) {
      console.error('[숲토킹 Recorder] 최종 저장 실패:', error);
      notifyError(`최종 저장 실패: ${error.message}`);
      notifyRecordingStopped(0, 0, false);
    }

    recordedChunks.length = 0;
    recordedChunks = [];
    totalRecordedBytes = 0;
    partNumber = 1;
  }

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

    // ⭐ v3.5.10: 저장 완료 알림도 함께 전송 (Background에서 탭 종료 타이밍 결정용)
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_SAVED_NOTIFY',
      streamerId: currentStreamerId,
      nickname: currentNickname,
      fileName: fileName,
      fileSize: blob.size
    }, '*');
    console.log(`[숲토킹 Recorder] 녹화 저장 완료 알림 전송: ${fileName}`);

    // ⭐ v3.5.20: Blob URL 메모리 누수 방지 (5분 후 자동 해제)
    setTimeout(() => {
      try {
        URL.revokeObjectURL(blobUrl);
        console.log(`[숲토킹 Recorder] Blob URL 해제됨: ${fileName}`);
      } catch (e) {
        // 이미 해제되었거나 유효하지 않은 경우 무시
      }
    }, 300000);
  }

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
        isSplitting: isSplitting
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

    // ⭐ v3.5.10: Background에 녹화 시작 알림 (안전 종료용)
    try {
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_STARTED_NOTIFY',
        streamerId: streamerId,
        nickname: nickname
      }, '*');
      console.log('[숲토킹 Recorder] Background에 녹화 시작 알림 전송');
    } catch (e) {
      console.warn('[숲토킹 Recorder] 녹화 시작 알림 전송 실패:', e);
    }
  }

  function notifyRecordingStopped(totalBytes, duration, saved) {
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_STOPPED',
      streamerId: currentStreamerId,
      totalBytes: totalBytes,
      duration: duration,
      saved: saved,
      totalParts: partNumber  // ⭐ 총 파트 수 추가
    }, '*');
  }

  function notifyError(message) {
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_ERROR',
      error: message
    }, '*');
  }

  function notifySplitStart(partNum) {
    window.postMessage({
      type: 'SOOPTALKING_SPLIT_START',
      partNumber: partNum,
      streamerId: currentStreamerId
    }, '*');
  }

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
    // v3.5.20: origin 검증 추가 (보안 강화)
    if (!event.origin.includes('sooplive.co.kr')) return;
    if (!event.data || event.data.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = event.data;
    console.log('[숲토킹 Recorder] 명령 수신:', command);

    let result;
    switch (command) {
      case 'START_RECORDING':
        // ⭐ v3.5.9.2: 상세 파라미터 로깅
        console.log('[숲토킹 Recorder] ========== START_RECORDING 메시지 수신 ==========');
        console.log('[숲토킹 Recorder] params:', JSON.stringify(params, null, 2));

        const { streamerId, nickname, quality } = params || {};

        console.log(`[숲토킹 Recorder] 파라미터 추출 결과:`);
        console.log(`[숲토킹 Recorder]   - streamerId: "${streamerId}"`);
        console.log(`[숲토킹 Recorder]   - nickname: "${nickname}"`);
        console.log(`[숲토킹 Recorder]   - quality: "${quality}" (타입: ${typeof quality})`);

        // quality가 없으면 경고 후 기본값 사용
        const finalQuality = quality || 'ultra';
        if (!quality) {
          console.warn('[숲토킹 Recorder] ⚠️ quality 파라미터 누락! 기본값 "ultra" 사용');
        }

        console.log(`[숲토킹 Recorder] 최종 quality: "${finalQuality}"`);
        console.log('[숲토킹 Recorder] ================================================');

        result = await startRecording(streamerId, nickname, finalQuality);

        // 결과도 페이지로 전달
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_RESULT',
          success: result.success,
          error: result.error
        }, '*');
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
        result = { success: true, pong: true, version: '3.5.10' };
        break;

      default:
        result = { success: false, error: '알 수 없는 명령' };
    }

    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESPONSE',
      command: command,
      result: result
    }, '*');
  });

  console.log('[숲토킹 Recorder] 메시지 리스너 등록 완료');

})();
