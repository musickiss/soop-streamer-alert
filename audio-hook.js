// ===== 숲토킹 v2.3 - 녹화 시스템 (MAIN World) =====
// MediaRecorder + 메모리 누적 방식 (녹화 종료 시 단일 파일 저장)

(function() {
  'use strict';

  // 중복 주입 방지
  if (window.__soopRecorderInstalled) {
    console.log('[숲토킹 Recorder] 이미 설치됨, 스킵');
    return;
  }
  window.__soopRecorderInstalled = true;

  console.log('[숲토킹 Recorder] 녹화 시스템 시작');

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 4000000,            // 4Mbps
    AUDIO_BITRATE: 128000,             // 128kbps
    TIMESLICE: 1000                    // 1초마다 데이터 수집
  };

  // ===== 전역 상태 =====
  window.__soopRecorder = {
    // 녹화 상태
    isRecording: false,
    mediaRecorder: null,
    recordingStream: null,

    // 녹화 데이터 (메모리 누적)
    recordedChunks: [],
    totalBytes: 0,

    // 메타데이터
    streamerId: null,
    recordingId: null,
    recordingStartTime: null,
    mimeType: null,

    // ===== 최적 코덱 찾기 =====
    findBestCodec: function() {
      // AV1은 인코딩 에러가 자주 발생하므로 제외
      const codecs = [
        'video/webm;codecs=vp9,opus',             // VP9 + Opus (권장)
        'video/webm;codecs=vp8,opus',             // VP8 + Opus
        'video/webm;codecs=h264,opus',            // H.264 + Opus
        'video/webm;codecs=vp9',                  // VP9 only
        'video/webm;codecs=vp8',                  // VP8 only
        'video/webm'                               // 기본
      ];

      for (const codec of codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
          console.log('[숲토킹 Recorder] ✅ 선택된 코덱:', codec);
          return codec;
        }
      }
      return 'video/webm';
    },

    // ===== 스트리머 ID 추출 =====
    getStreamerId: function() {
      const match = window.location.pathname.match(/^\/([^\/]+)/);
      return match ? match[1] : 'unknown';
    },

    // ===== 녹화 ID 생성 =====
    generateRecordingId: function() {
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19).replace(/[-:T]/g, '');
      return `${this.streamerId}_${timestamp}`;
    },

    // ===== 최종 파일명 생성 =====
    getFinalFilename: function() {
      return `soop_${this.recordingId}.webm`;
    },

    // ===== 녹화 시작 =====
    startRecording: function(options = {}) {
      if (this.isRecording) {
        console.warn('[숲토킹 Recorder] 이미 녹화 중');
        return { success: false, error: '이미 녹화 중입니다.' };
      }

      // video 요소 찾기
      const video = document.querySelector('video');
      if (!video) {
        console.error('[숲토킹 Recorder] video 요소 없음');
        return { success: false, error: 'video 요소를 찾을 수 없습니다.' };
      }

      if (video.paused || video.ended) {
        console.error('[숲토킹 Recorder] 비디오 재생 중 아님');
        return { success: false, error: '비디오가 재생 중이 아닙니다.' };
      }

      try {
        // 초기화
        this.streamerId = options.streamerId || this.getStreamerId();
        this.recordingId = this.generateRecordingId();
        this.recordedChunks = [];
        this.totalBytes = 0;

        // 스트림 캡처
        this.recordingStream = video.captureStream();
        this.mimeType = this.findBestCodec();

        // MediaRecorder 생성
        this.mediaRecorder = new MediaRecorder(this.recordingStream, {
          mimeType: this.mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 데이터 수신 (메모리에 누적)
        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            this.recordedChunks.push(event.data);
            this.totalBytes += event.data.size;
          }
        };

        // 녹화 중지 이벤트
        this.mediaRecorder.onstop = () => {
          console.log('[숲토킹 Recorder] MediaRecorder 중지됨');

          // 스트림 트랙 중지
          if (this.recordingStream) {
            this.recordingStream.getTracks().forEach(track => track.stop());
          }

          // 최종 파일 저장
          this.saveFinalRecording();

          this.isRecording = false;
        };

        // 에러 이벤트
        this.mediaRecorder.onerror = (event) => {
          console.error('[숲토킹 Recorder] 에러:', event.error);
          this.stopRecording();

          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: event.error?.message || '녹화 오류'
          }, '*');
        };

        // 녹화 시작
        this.mediaRecorder.start(CONFIG.TIMESLICE);
        this.isRecording = true;
        this.recordingStartTime = Date.now();

        // 방송 종료 감지
        video.addEventListener('ended', this.handleVideoEnded.bind(this));
        video.addEventListener('error', this.handleVideoError.bind(this));

        console.log('[숲토킹 Recorder] ▶️ 녹화 시작');
        console.log('[숲토킹 Recorder] 스트리머:', this.streamerId);
        console.log('[숲토킹 Recorder] 녹화 ID:', this.recordingId);
        console.log('[숲토킹 Recorder] 코덱:', this.mimeType);

        return {
          success: true,
          streamerId: this.streamerId,
          recordingId: this.recordingId,
          mimeType: this.mimeType
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 녹화 시작 실패:', error);
        return { success: false, error: error.message };
      }
    },

    // ===== 최종 녹화 저장 =====
    saveFinalRecording: function() {
      if (this.recordedChunks.length === 0) {
        console.log('[숲토킹 Recorder] 저장할 데이터 없음');
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_COMPLETE',
          streamerId: this.streamerId,
          recordingId: this.recordingId,
          totalBytes: 0,
          saved: false
        }, '*');
        return;
      }

      const blob = new Blob(this.recordedChunks, { type: this.mimeType });
      const filename = this.getFinalFilename();
      const duration = (Date.now() - this.recordingStartTime) / 1000;

      console.log('[숲토킹 Recorder] 💾 최종 녹화 저장:', filename);
      console.log('[숲토킹 Recorder] 크기:', (blob.size / 1024 / 1024).toFixed(2), 'MB');
      console.log('[숲토킹 Recorder] 녹화 시간:', duration.toFixed(1), '초');

      // Background로 저장 요청
      window.postMessage({
        type: 'SOOPTALKING_SAVE_FINAL_RECORDING',
        filename: filename,
        size: blob.size,
        blobUrl: URL.createObjectURL(blob),
        streamerId: this.streamerId,
        recordingId: this.recordingId,
        duration: duration
      }, '*');

      // 녹화 완료 알림
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_COMPLETE',
        streamerId: this.streamerId,
        recordingId: this.recordingId,
        totalBytes: blob.size,
        duration: duration,
        saved: true
      }, '*');

      // 메모리 정리
      this.recordedChunks = [];
      this.totalBytes = 0;
    },

    // ===== 녹화 중지 =====
    stopRecording: function() {
      if (!this.isRecording) {
        return { success: false, error: '녹화 중이 아닙니다.' };
      }

      // MediaRecorder 중지 (onstop에서 최종 파일 저장)
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }

      const duration = (Date.now() - this.recordingStartTime) / 1000;
      console.log('[숲토킹 Recorder] ⏹️ 녹화 중지, 총 시간:', duration.toFixed(1), '초');

      return {
        success: true,
        duration: duration,
        totalBytes: this.totalBytes
      };
    },

    // ===== 방송 종료 감지 =====
    handleVideoEnded: function() {
      console.log('[숲토킹 Recorder] 📺 방송 종료 감지');
      if (this.isRecording) {
        this.stopRecording();
      }
    },

    handleVideoError: function(e) {
      console.log('[숲토킹 Recorder] ⚠️ 비디오 에러:', e);
      // 에러가 발생해도 즉시 종료하지 않고 잠시 대기 후 확인
      setTimeout(() => {
        const video = document.querySelector('video');
        if (!video || video.ended || video.error) {
          if (this.isRecording) {
            console.log('[숲토킹 Recorder] 스트림 종료로 녹화 중지');
            this.stopRecording();
          }
        }
      }, 3000);
    },

    // ===== 녹화 상태 조회 =====
    getStatus: function() {
      const duration = this.isRecording
        ? (Date.now() - this.recordingStartTime) / 1000
        : 0;

      return {
        isRecording: this.isRecording,
        streamerId: this.streamerId,
        recordingId: this.recordingId,
        mimeType: this.mimeType,
        duration: duration.toFixed(1),
        totalBytes: this.totalBytes,
        totalMB: (this.totalBytes / 1024 / 1024).toFixed(2)
      };
    }
  };

  // ===== 콘솔 도우미 =====
  window.soopRec = {
    start: () => window.__soopRecorder.startRecording(),
    stop: () => window.__soopRecorder.stopRecording(),
    status: () => {
      const s = window.__soopRecorder.getStatus();
      console.log('[숲토킹 Recorder] 상태:');
      console.log('  녹화 중:', s.isRecording);
      console.log('  스트리머:', s.streamerId);
      console.log('  녹화 ID:', s.recordingId);
      console.log('  코덱:', s.mimeType);
      console.log('  경과 시간:', s.duration, '초');
      console.log('  총 크기:', s.totalMB, 'MB');
      return s;
    },
    help: () => {
      console.log(`
╔════════════════════════════════════════════════════╗
║        🎬 숲토킹 녹화 시스템                        ║
╠════════════════════════════════════════════════════╣
║  soopRec.start()   - 녹화 시작                     ║
║  soopRec.stop()    - 녹화 중지 (파일 저장)         ║
║  soopRec.status()  - 녹화 상태 확인                ║
║                                                    ║
║  📁 파일 저장 위치: 기본 다운로드 폴더             ║
║  📦 파일명: soop_스트리머_날짜시간.webm            ║
║  💾 녹화 종료 시 단일 파일로 저장                  ║
╚════════════════════════════════════════════════════╝
      `);
    }
  };

  // ===== Content Script 통신 =====
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = event.data;
    let result = null;

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
    }

    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESULT',
      command: command,
      result: result
    }, '*');
  });

  console.log('[숲토킹 Recorder] ✅ 설치 완료');
  console.log('[숲토킹 Recorder] 📖 사용법: soopRec.help()');

})();
