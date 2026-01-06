// ===== 숲토킹 v3.7.2 - Content Script (MAIN) =====
// MAIN world Canvas 녹화 스크립트
// v3.7.0 - requestAnimationFrame + captureStream(0) 기반 프레임 동기화 녹화
//        - H.264 하드웨어 가속 코덱 우선 적용

(function() {
  'use strict';

  // 이미 로드된 경우 스킵
  if (window.__SOOPTALKING_RECORDER_LOADED__) {
    console.log('[숲토킹 Recorder] 이미 로드됨, 스킵');
    return;
  }
  window.__SOOPTALKING_RECORDER_LOADED__ = true;

  console.log('[숲토킹 Recorder] 로드됨');

  // ===== 설정 =====
  // SOOP 원본 스트리밍: 1080p, 8Mbps, 60fps
  // ⭐ v3.7.1: 단일 품질 (6Mbps) - 백그라운드 30fps에서도 양호한 화질 유지
  const CONFIG = {
    // 녹화 품질 설정 (단일)
    VIDEO_BITRATE: 6000000,       // 6 Mbps (v3.7.1: 4→6Mbps)
    AUDIO_BITRATE: 128000,        // 128 kbps
    TARGET_FPS: 60,               // 60fps 유지
    CODEC_PRIORITY: ['avc1.640028', 'avc1.4d0028', 'vp9', 'vp8'],  // H.264 High 우선
    // 공통 설정
    TIMESLICE: 2000,
    REQUEST_DATA_INTERVAL: 5000,  // ⭐ v3.6.2: 5초마다 requestData 호출
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
  let totalRecordedBytes = 0;       // 현재 파트의 바이트 (분할 시 리셋)
  let sessionTotalBytes = 0;        // ⭐ v3.7.0: 전체 세션 누적 바이트 (UI 표시용)
  let partNumber = 1;
  let isRecording = false;
  let isSaving = false;    // ⭐ v3.6.4: 누락된 변수 추가
  let isSplitting = false;
  let requestDataIntervalId = null;  // ⭐ v3.6.2: requestData 인터벌 ID
  // currentQuality 제거됨 - v3.7.0: 단일 품질 (4Mbps) 사용
  let currentMimeType = null;
  let currentSplitSize = 500;  // MB 단위

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

  // ⭐ v3.7.0: 단일 품질 - CONFIG에서 직접 코덱 우선순위 사용
  function getBestMimeType() {
    console.log(`[숲토킹 Recorder] getBestMimeType 호출 (단일 품질: 4Mbps)`);
    console.log(`[숲토킹 Recorder]   코덱 우선순위: [${CONFIG.CODEC_PRIORITY.join(', ')}]`);

    for (const codec of CONFIG.CODEC_PRIORITY) {
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

  // ⭐ v3.7.0: 단일 품질 - 파일명에서 품질 표시 제거
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

  // ⭐ v3.7.0: requestAnimationFrame + requestFrame() 기반 프레임 동기화 녹화
  let rafId = null;  // requestAnimationFrame ID
  let canvasVideoTrack = null;  // captureStream의 video track (requestFrame용)
  let isBackgroundTab = false;  // 백그라운드 탭 여부
  let bgIntervalId = null;  // 백그라운드용 setInterval ID

  // ⭐ v3.7.0: 백그라운드 오디오 유지 (타이머 throttling 우회)
  let keepAliveAudioCtx = null;
  let keepAliveOscillator = null;
  let keepAliveGain = null;

  // ⭐ v3.7.0: 무음 오디오 재생으로 백그라운드 타이머 throttling 우회
  function startKeepAliveAudio() {
    if (keepAliveAudioCtx) return;  // 이미 실행 중

    try {
      keepAliveAudioCtx = new (window.AudioContext || window.webkitAudioContext)();

      // 무음 오실레이터 생성 (들리지 않는 매우 낮은 주파수)
      keepAliveOscillator = keepAliveAudioCtx.createOscillator();
      keepAliveOscillator.frequency.value = 1;  // 1Hz - 사람이 들을 수 없음

      // 게인을 0으로 설정 (완전 무음)
      keepAliveGain = keepAliveAudioCtx.createGain();
      keepAliveGain.gain.value = 0.00001;  // 거의 무음 (완전 0은 일부 브라우저에서 최적화로 제거됨)

      keepAliveOscillator.connect(keepAliveGain);
      keepAliveGain.connect(keepAliveAudioCtx.destination);
      keepAliveOscillator.start();

      console.log('[숲토킹 Recorder] 백그라운드 Keep-Alive 오디오 시작');
    } catch (e) {
      console.warn('[숲토킹 Recorder] Keep-Alive 오디오 생성 실패:', e.message);
    }
  }

  function stopKeepAliveAudio() {
    if (keepAliveOscillator) {
      try {
        keepAliveOscillator.stop();
        keepAliveOscillator.disconnect();
      } catch (e) {}
      keepAliveOscillator = null;
    }
    if (keepAliveGain) {
      try {
        keepAliveGain.disconnect();
      } catch (e) {}
      keepAliveGain = null;
    }
    if (keepAliveAudioCtx) {
      try {
        keepAliveAudioCtx.close();
      } catch (e) {}
      keepAliveAudioCtx = null;
    }
    console.log('[숲토킹 Recorder] 백그라운드 Keep-Alive 오디오 종료');
  }

  function startCanvasDrawing(video, targetFps) {
    sourceVideo = video;
    videoUnavailableCount = 0;

    // 기존 타이머/RAF 정리
    if (drawIntervalId) {
      clearInterval(drawIntervalId);
      drawIntervalId = null;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (bgIntervalId) {
      clearInterval(bgIntervalId);
      bgIntervalId = null;
    }

    const frameInterval = 1000 / targetFps;
    let lastDrawTime = 0;
    let frameCount = 0;
    let lastFpsLogTime = performance.now();

    // ===== 프레임 그리기 로직 =====
    function performDraw(timestamp) {
      if (!sourceVideo || !isRecording) return false;

      // 비디오 요소 DOM 존재 확인
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
            return false;
          }
          return true;
        }
      }

      // 비디오 상태 체크
      const videoUnavailable = sourceVideo.ended ||
          sourceVideo.readyState < 2 || sourceVideo.videoWidth === 0;

      // paused 상태는 자동재생 시도
      if (sourceVideo.paused && !sourceVideo.ended && sourceVideo.readyState >= 2) {
        sourceVideo.play().catch(() => {});
      }

      if (videoUnavailable) {
        videoUnavailableCount++;
        if (videoUnavailableCount % 100 === 0) {
          console.log(`[숲토킹 Recorder] 비디오 상태 불안정 (${videoUnavailableCount}/${CONFIG.MAX_VIDEO_UNAVAILABLE})`);
        }
        if (videoUnavailableCount > CONFIG.MAX_VIDEO_UNAVAILABLE) {
          console.log('[숲토킹 Recorder] video 장시간 비정상 상태, 녹화 중지');
          stopRecording();
          return false;
        }
        return true;
      }

      videoUnavailableCount = 0;

      // 프레임 간격 체크
      if (timestamp - lastDrawTime < frameInterval) {
        return true;
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

        // Canvas에 프레임 그리기
        recordingCtx.drawImage(sourceVideo, 0, 0, recordingCanvas.width, recordingCanvas.height);

        // ⭐ 명시적 프레임 요청 (captureStream(0) 사용 시)
        if (canvasVideoTrack && canvasVideoTrack.requestFrame) {
          canvasVideoTrack.requestFrame();
        }

        lastDrawTime = timestamp;
        frameCount++;

        // FPS 로깅 (10초마다)
        if (timestamp - lastFpsLogTime >= 10000) {
          const fps = frameCount / ((timestamp - lastFpsLogTime) / 1000);
          console.log(`[숲토킹 Recorder] 녹화 FPS: ${fps.toFixed(1)}`);
          frameCount = 0;
          lastFpsLogTime = timestamp;
        }

      } catch (e) {
        console.log('[숲토킹 Recorder] drawImage 실패:', e.message);
      }

      return true;
    }

    // ===== requestAnimationFrame 루프 (포그라운드) =====
    function rafLoop(timestamp) {
      if (!isRecording || isBackgroundTab) return;

      if (performDraw(timestamp)) {
        rafId = requestAnimationFrame(rafLoop);
      }
    }

    // ===== setInterval 폴백 (백그라운드 탭) =====
    // ⭐ v3.7.0: Keep-Alive 오디오와 함께 사용하여 ~30fps 유지
    function startBackgroundFallback() {
      if (bgIntervalId) return;

      // Keep-Alive 오디오 시작 (타이머 throttling 우회)
      startKeepAliveAudio();

      // Keep-Alive 오디오 덕분에 더 짧은 인터벌 사용 가능 (~30fps)
      const bgFrameInterval = Math.max(frameInterval, 33);  // 최소 33ms (30fps)

      bgIntervalId = setInterval(() => {
        if (!isRecording) {
          clearInterval(bgIntervalId);
          bgIntervalId = null;
          stopKeepAliveAudio();
          return;
        }
        performDraw(performance.now());
      }, bgFrameInterval);

      console.log(`[숲토킹 Recorder] 백그라운드 모드 전환 (Keep-Alive + setInterval ${bgFrameInterval}ms)`);
    }

    // ===== 탭 가시성 변경 처리 =====
    function handleVisibilityChange() {
      if (!isRecording) return;

      isBackgroundTab = document.hidden;

      if (isBackgroundTab) {
        // 포그라운드 → 백그라운드: RAF 중지, setInterval + Keep-Alive 시작
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        startBackgroundFallback();
      } else {
        // 백그라운드 → 포그라운드: setInterval + Keep-Alive 중지, RAF 재시작
        if (bgIntervalId) {
          clearInterval(bgIntervalId);
          bgIntervalId = null;
        }
        stopKeepAliveAudio();
        console.log('[숲토킹 Recorder] 포그라운드 복귀 (requestAnimationFrame)');
        rafId = requestAnimationFrame(rafLoop);
      }
    }

    // 가시성 리스너 등록
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // ===== 시작 =====
    isBackgroundTab = document.hidden;

    if (isBackgroundTab) {
      startBackgroundFallback();
    } else {
      rafId = requestAnimationFrame(rafLoop);
    }

    console.log('[숲토킹 Recorder] Canvas 그리기 시작 (requestAnimationFrame)');
  }

  function cleanupCanvas() {
    // ⭐ v3.7.0: requestAnimationFrame 정리
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // ⭐ v3.7.0: 백그라운드 인터벌 정리
    if (bgIntervalId) {
      clearInterval(bgIntervalId);
      bgIntervalId = null;
    }

    // ⭐ v3.7.0: Keep-Alive 오디오 정리
    stopKeepAliveAudio();

    // 기존 setInterval 정리 (폴백용)
    if (drawIntervalId) {
      clearInterval(drawIntervalId);
      drawIntervalId = null;
    }

    // ⭐ v3.7.0: video track 참조 정리
    canvasVideoTrack = null;
    isBackgroundTab = false;

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
      // ⭐ v3.7.0: 단일 품질 - CONFIG 직접 사용
      // 새 Canvas 스트림 생성 (0 = 수동 프레임 제어)
      canvasStream = recordingCanvas.captureStream(0);
      canvasVideoTrack = canvasStream.getVideoTracks()[0];
      console.log('[숲토킹 Recorder] Canvas 스트림 재생성됨 (수동 프레임 모드)');

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

  // ⭐ v3.6.7: beforeunload에서 경고만 표시 (상태 변경 없음)
  // 실제 페이지 언로드는 background.js에서 tabs.onUpdated로 감지
  window.addEventListener('beforeunload', (event) => {
    console.log('[숲토킹 Recorder] 탭 종료/새로고침 감지');

    // 녹화 중인 경우 경고만 표시 (상태 변경 없음)
    if (isRecording) {
      console.log('[숲토킹 Recorder] 녹화 중 - 확인 팝업 표시');

      // ⭐ v3.6.7: 손실 알림 제거 - 취소 시에도 녹화 유지를 위해
      // 실제 페이지 종료는 background.js에서 PING으로 감지

      event.preventDefault();
      event.returnValue = '녹화가 진행 중입니다. 페이지를 떠나면 녹화 데이터가 손실됩니다.';
      return event.returnValue;
    }

    // 오디오 리소스 정리
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

  // ⭐ v3.7.0: 단일 품질 (4Mbps) - quality 파라미터 무시 (하위 호환성 유지)
  async function startRecording(streamerId, nickname, quality = null, splitSize = 500) {
    console.log(`[숲토킹 Recorder] 녹화 시작: ${streamerId} (단일 품질: 4Mbps, 분할: ${splitSize}MB)`);

    // ⭐ v3.6.5: 분할 크기 설정 (MB → Bytes 변환)
    if (!splitSize || splitSize < 100) {
      console.warn(`[숲토킹 Recorder] splitSize가 유효하지 않음 (${splitSize}), 기본값 500MB 사용`);
      splitSize = 500;
    }
    currentSplitSize = splitSize;
    CONFIG.MAX_FILE_SIZE = splitSize * 1024 * 1024;
    console.log(`[숲토킹 Recorder] ★ 분할 크기 설정: ${splitSize}MB (${CONFIG.MAX_FILE_SIZE} bytes)`);

    if (isRecording) {
      console.log('[숲토킹 Recorder] 이미 녹화 중');
      return { success: false, error: '이미 녹화 중입니다.' };
    }

    console.log(`[숲토킹 Recorder] 녹화 시작 요청: ${streamerId}`);
    logMemoryUsage('녹화 시작 전');

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

      // ⭐ v3.7.0: 단일 품질 - CONFIG 직접 사용
      console.log(`[숲토킹 Recorder] 설정: ${(CONFIG.VIDEO_BITRATE / 1000000).toFixed(0)}Mbps ${CONFIG.TARGET_FPS}fps`);

      if (!setupCanvas(video)) {
        throw new Error('Canvas 설정 실패');
      }

      // ⭐ v3.7.0: captureStream(0)을 먼저 생성하여 canvasVideoTrack 설정
      // requestFrame()이 처음부터 호출될 수 있도록 순서 변경
      canvasStream = recordingCanvas.captureStream(0);
      canvasVideoTrack = canvasStream.getVideoTracks()[0];
      console.log('[숲토킹 Recorder] Canvas 스트림 획득 (수동 프레임 모드)');

      // ⭐ v3.7.0: isRecording을 먼저 설정해야 RAF 루프가 정상 동작
      isRecording = true;

      // Canvas 그리기 시작 (canvasVideoTrack과 isRecording이 이미 설정된 상태)
      startCanvasDrawing(video, CONFIG.TARGET_FPS);

      await new Promise(r => setTimeout(r, 200));

      const audioTrack = await getOrCreateAudioTrack(video);
      if (audioTrack) {
        canvasStream.addTrack(audioTrack);
        console.log('[숲토킹 Recorder] 오디오 트랙 추가됨');
      } else {
        console.log('[숲토킹 Recorder] 오디오 없이 녹화 진행');
      }

      currentMimeType = getBestMimeType();
      const options = {
        mimeType: currentMimeType,
        videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
        audioBitsPerSecond: CONFIG.AUDIO_BITRATE
      };

      console.log(`[숲토킹 Recorder] 녹화 설정: ${(CONFIG.VIDEO_BITRATE / 1000000).toFixed(0)}Mbps, ${CONFIG.TARGET_FPS}fps`);

      mediaRecorder = new MediaRecorder(canvasStream, options);

      // MediaRecorder 생성 완료

      mediaRecorder.ondataavailable = handleDataAvailable;
      mediaRecorder.onstop = handleRecordingStop;
      mediaRecorder.onerror = (event) => {
        console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
        console.error('[숲토킹 Recorder] 오류 스택:', event.error?.stack);
        notifyError(event.error?.message || '녹화 오류');

        // ⭐ v3.6.0: 녹화 오류 이벤트 전송 (content → background)
        window.postMessage({
          type: 'SOOPTALKING_ANALYTICS_ERROR',
          errorType: event.error?.name || 'unknown'
        }, '*');
      };

      currentStreamerId = streamerId;
      currentNickname = nickname;
      recordedChunks = [];
      totalRecordedBytes = 0;
      sessionTotalBytes = 0;  // ⭐ v3.7.0: 세션 전체 초기화
      partNumber = 1;
      recordingStartTime = Date.now();
      generateFileName(streamerId);
      // isRecording은 이미 위에서 설정됨 (v3.7.0)
      isSplitting = false;
      stopRetryCount = 0;
      splitWaitCount = 0;

      mediaRecorder.start(CONFIG.TIMESLICE);

      console.log(`[숲토킹 Recorder] ✓ 녹화 시작됨`);

      startProgressReporting();
      startRequestDataInterval();  // ⭐ v3.6.2: requestData 인터벌 시작

      notifyRecordingStarted(streamerId, nickname);

      return { success: true };

    } catch (error) {
      console.error('[숲토킹 Recorder] 녹화 시작 실패:', error);
      console.error('[숲토킹 Recorder] 오류 스택:', error.stack);
      stopRequestDataInterval();  // ⭐ v3.6.3: 실패 시 인터벌 정리
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
      stopRequestDataInterval();  // ⭐ v3.6.2: requestData 인터벌 중지

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
      sessionTotalBytes += event.data.size;  // ⭐ v3.7.0: 세션 전체 누적

      // ⭐ v3.6.3: 로깅 간소화 (10개마다 또는 첫번째)
      if (recordedChunks.length % 10 === 0 || recordedChunks.length === 1) {
        console.log('[숲토킹 Recorder] 청크 #' + recordedChunks.length + ': 파트 ' + formatBytes(totalRecordedBytes) + ' / 전체 ' + formatBytes(sessionTotalBytes));
      }

      // 500MB 분할 조건 확인
      if (totalRecordedBytes >= CONFIG.MAX_FILE_SIZE && !isSplitting) {
        console.log(`[숲토킹 Recorder] ★ 분할 트리거! ${formatBytes(totalRecordedBytes)} >= ${formatBytes(CONFIG.MAX_FILE_SIZE)}`);
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
      // ⭐ v3.6.3: 0단계 - 기존 인터벌 중지 (무효한 MediaRecorder에 호출 방지)
      stopRequestDataInterval();
      console.log('[숲토킹 Recorder] 0단계: requestData 인터벌 중지');
      // ===== 1단계: MediaRecorder 완전 종료 및 청크 수집 =====
      console.log('[숲토킹 Recorder] 1단계: MediaRecorder 종료 대기...');
      const allChunks = await stopMediaRecorderAndWait();
      console.log(`[숲토킹 Recorder] 수집된 청크: ${allChunks.length}개`);

      // ===== 2단계: 현재 파트 저장 =====
      if (allChunks.length > 0) {
        try {
          const blob = new Blob(allChunks, { type: 'video/webm' });
          // ⭐ v3.7.0: 단일 품질 - 파일명에서 품질 표시 제거
          const fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;

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

        // ⭐ v3.7.0: 단일 품질 - CONFIG 직접 사용
        const options = {
          mimeType: currentMimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        };

        mediaRecorder = new MediaRecorder(canvasStream, options);
        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onstop = handleRecordingStop;
        mediaRecorder.onerror = (event) => {
          console.error('[숲토킹 Recorder] MediaRecorder 오류:', event.error);
          notifyError(event.error?.message || '녹화 오류');
        };

        mediaRecorder.start(CONFIG.TIMESLICE);
        startRequestDataInterval();  // ⭐ v3.6.2: 새 파트에서도 인터벌 시작
        console.log('[숲토킹 Recorder] 6단계: requestData 인터벌 재시작');
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
            // ⭐ v3.7.0: 단일 품질 - CONFIG 직접 사용
            const options = {
              mimeType: currentMimeType,
              videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
              audioBitsPerSecond: CONFIG.AUDIO_BITRATE
            };
            mediaRecorder = new MediaRecorder(canvasStream, options);
            mediaRecorder.ondataavailable = handleDataAvailable;
            mediaRecorder.onstop = handleRecordingStop;
            mediaRecorder.start(CONFIG.TIMESLICE);
            startRequestDataInterval();  // ⭐ v3.6.3: 복구 후 인터벌 재시작
            console.log('[숲토킹 Recorder] 복구 성공, 녹화 재개');
            console.log('[숲토킹 Recorder] 복구 후 requestData 인터벌 재시작');
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

    stopRequestDataInterval();  // ⭐ v3.6.2: 인터벌 정리
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

      // ⭐ v3.7.0: 단일 품질 - 파일명에서 품질 표시 제거
      let fileName;
      if (partNumber > 1) {
        fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;
      } else {
        fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}.webm`;
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
    sessionTotalBytes = 0;  // ⭐ v3.7.0: 세션 전체 초기화
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

  // ===== v3.6.2: requestData 인터벌 관리 =====

  function startRequestDataInterval() {
    if (requestDataIntervalId) {
      clearInterval(requestDataIntervalId);
    }

    requestDataIntervalId = setInterval(() => {
      if (!isRecording || !mediaRecorder) {
        stopRequestDataInterval();
        return;
      }

      if (mediaRecorder.state === 'recording') {
        try {
          mediaRecorder.requestData();
          console.log('[숲토킹 Recorder] requestData() 호출 - 현재 누적:', formatBytes(totalRecordedBytes));
        } catch (e) {
          console.warn('[숲토킹 Recorder] requestData 실패:', e.message);
        }
      }
    }, CONFIG.REQUEST_DATA_INTERVAL);

    console.log('[숲토킹 Recorder] requestData 인터벌 시작 (5초 주기)');
  }

  function stopRequestDataInterval() {
    if (requestDataIntervalId) {
      clearInterval(requestDataIntervalId);
      requestDataIntervalId = null;
      console.log('[숲토킹 Recorder] requestData 인터벌 중지');
    }
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
        totalBytes: sessionTotalBytes,  // ⭐ v3.7.0: 세션 전체 바이트 (분할 시에도 유지)
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
        // 메시지 수신 로그 생략 - startRecording 함수 내에서 로깅
        // ⭐ v3.7.0: quality 파라미터 무시 (단일 품질 4Mbps)
        const { streamerId, nickname, splitSize } = params || {};
        const finalSplitSize = splitSize || 500;

        result = await startRecording(streamerId, nickname, null, finalSplitSize);

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
          quality: '4Mbps',  // ⭐ v3.7.0: 단일 품질
          partNumber: partNumber
        };
        break;

      case 'PING':
        result = { success: true, pong: true, version: '3.7.0' };
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

  console.log('[숲토킹 Recorder] v3.7.2 메시지 리스너 등록 완료 (rAF + captureStream(0) 프레임 동기화)');

})();
