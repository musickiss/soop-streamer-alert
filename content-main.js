// ===== 숲토킹 v3.2.0 - MAIN World 녹화 모듈 =====
// video.captureStream() 기반 다이얼로그 없는 녹화

(function() {
  'use strict';

  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 4000000,    // 4 Mbps
    AUDIO_BITRATE: 128000,     // 128 Kbps
    TIMESLICE: 5000,           // 5초마다 데이터 청크
    PROGRESS_INTERVAL: 5000    // 5초마다 진행 상황 보고
  };

  // ===== 유틸리티 =====
  function sanitizeFilename(str) {
    if (!str) return 'unknown';
    return str
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  function getStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : 'unknown';
  }

  function generateTimestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  }

  // ===== 코덱 선택 =====
  function getBestMimeType() {
    const codecs = [
      { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },
      { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
      { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
      { mime: 'video/webm', name: 'WebM' }
    ];

    for (const { mime, name } of codecs) {
      if (MediaRecorder.isTypeSupported(mime)) {
        console.log('[숲토킹 Recorder] 코덱 선택:', name);
        return mime;
      }
    }
    return 'video/webm';
  }

  // ===== 녹화 모듈 =====
  window.__soopRecorder = {
    // 상태
    isRecording: false,
    mediaRecorder: null,
    recordingStream: null,
    progressInterval: null,

    // 데이터
    recordedChunks: [],
    totalBytes: 0,
    streamerId: null,
    nickname: null,
    recordingId: null,
    startTime: null,
    mimeType: null,

    // ===== 녹화 시작 =====
    startRecording(params = {}) {
      if (this.isRecording) {
        return { success: false, error: '이미 녹화 중입니다.' };
      }

      // 비디오 요소 찾기
      const video = document.querySelector('video');
      if (!video) {
        return { success: false, error: '비디오 요소를 찾을 수 없습니다.' };
      }

      if (video.paused || video.ended) {
        return { success: false, error: '비디오가 재생 중이 아닙니다.' };
      }

      try {
        // 스트리머 정보
        this.streamerId = params.streamerId ? sanitizeFilename(params.streamerId) : sanitizeFilename(getStreamerIdFromUrl());
        this.nickname = params.nickname ? sanitizeFilename(params.nickname) : this.streamerId;
        this.recordingId = `${this.streamerId}_${generateTimestamp()}`;

        // 초기화
        this.recordedChunks = [];
        this.totalBytes = 0;
        this.startTime = Date.now();

        // video.captureStream()으로 스트림 획득 (다이얼로그 없음!)
        this.recordingStream = video.captureStream();
        console.log('[숲토킹 Recorder] 스트림 획득 성공');

        // 코덱 선택
        this.mimeType = getBestMimeType();

        // MediaRecorder 생성
        this.mediaRecorder = new MediaRecorder(this.recordingStream, {
          mimeType: this.mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 데이터 수신 핸들러
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.recordedChunks.push(e.data);
            this.totalBytes += e.data.size;
          }
        };

        // 녹화 중지 핸들러
        this.mediaRecorder.onstop = () => {
          console.log('[숲토킹 Recorder] 녹화 중지됨');
          this.clearProgressInterval();
          this.saveRecording();
        };

        // 에러 핸들러
        this.mediaRecorder.onerror = (e) => {
          console.error('[숲토킹 Recorder] 에러:', e.error);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: e.error?.message || '녹화 에러'
          }, '*');
          this.stopRecording();
        };

        // 녹화 시작
        this.mediaRecorder.start(CONFIG.TIMESLICE);
        this.isRecording = true;

        // 진행 상황 보고 시작
        this.startProgressInterval();

        console.log('[숲토킹 Recorder] 녹화 시작:', this.streamerId);

        // 시작 알림
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STARTED',
          streamerId: this.streamerId,
          nickname: this.nickname,
          recordingId: this.recordingId
        }, '*');

        return {
          success: true,
          streamerId: this.streamerId,
          nickname: this.nickname,
          recordingId: this.recordingId
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 시작 실패:', error);
        this.cleanup();
        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 중지 =====
    stopRecording() {
      if (!this.isRecording) {
        return { success: false, error: '녹화 중이 아닙니다.' };
      }

      console.log('[숲토킹 Recorder] 녹화 중지 요청');

      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 파일 저장 =====
    saveRecording() {
      const duration = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

      if (this.recordedChunks.length === 0) {
        console.warn('[숲토킹 Recorder] 저장할 데이터 없음');
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STOPPED',
          streamerId: this.streamerId,
          nickname: this.nickname,
          totalBytes: 0,
          duration: duration,
          saved: false
        }, '*');
        this.cleanup();
        return;
      }

      // Blob 생성
      const blob = new Blob(this.recordedChunks, { type: this.mimeType });
      const fileName = `soop_${sanitizeFilename(this.recordingId)}.webm`;
      const blobUrl = URL.createObjectURL(blob);

      console.log('[숲토킹 Recorder] 파일 저장:', fileName, blob.size, 'bytes');

      // Content Script (ISOLATED)를 통해 Background로 전달
      window.postMessage({
        type: 'SOOPTALKING_SAVE_RECORDING',
        fileName: fileName,
        size: blob.size,
        blobUrl: blobUrl,
        streamerId: this.streamerId,
        nickname: this.nickname,
        recordingId: this.recordingId,
        duration: duration
      }, '*');

      window.postMessage({
        type: 'SOOPTALKING_RECORDING_STOPPED',
        streamerId: this.streamerId,
        nickname: this.nickname,
        totalBytes: blob.size,
        duration: duration,
        saved: true
      }, '*');

      this.cleanup();
    },

    // ===== 진행 상황 보고 =====
    startProgressInterval() {
      this.clearProgressInterval();
      this.progressInterval = setInterval(() => {
        if (this.isRecording) {
          const elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_PROGRESS',
            streamerId: this.streamerId,
            nickname: this.nickname,
            totalBytes: this.totalBytes,
            elapsedTime: elapsedTime
          }, '*');
        }
      }, CONFIG.PROGRESS_INTERVAL);
    },

    clearProgressInterval() {
      if (this.progressInterval) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }
    },

    // ===== 정리 =====
    cleanup() {
      this.clearProgressInterval();

      if (this.recordingStream) {
        this.recordingStream.getTracks().forEach(track => track.stop());
        this.recordingStream = null;
      }

      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.totalBytes = 0;
      this.isRecording = false;
    },

    // ===== 상태 조회 =====
    getStatus() {
      return {
        isRecording: this.isRecording,
        streamerId: this.streamerId,
        nickname: this.nickname,
        totalBytes: this.totalBytes,
        elapsedTime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
      };
    }
  };

  // ===== 메시지 리스너 =====
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = e.data;
    let result;

    switch (command) {
      case 'START_RECORDING':
        result = window.__soopRecorder.startRecording(params);
        break;
      case 'STOP_RECORDING':
        result = window.__soopRecorder.stopRecording();
        break;
      case 'GET_STATUS':
        result = window.__soopRecorder.getStatus();
        break;
      default:
        result = { success: false, error: '알 수 없는 명령' };
    }

    // 결과 전송
    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESULT',
      command: command,
      result: result
    }, '*');
  });

  console.log('[숲토킹 Recorder] v3.2.0 MAIN world 모듈 로드됨');
})();
