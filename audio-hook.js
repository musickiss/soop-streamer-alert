// ===== 숲토킹 v2.5 - 녹화 시스템 (MAIN World) =====
(function() {
  'use strict';
  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  const CONFIG = { VIDEO_BITRATE: 4000000, AUDIO_BITRATE: 128000, TIMESLICE: 30000, PROGRESS_INTERVAL: 10000 };

  function sanitize(str) {
    if (!str) return 'unknown';
    return str.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').replace(/\s+/g, '_').substring(0, 100);
  }

  window.__soopRecorder = {
    isRecording: false, mediaRecorder: null, recordingStream: null, progressInterval: null,
    recordedChunks: [], totalBytes: 0, streamerId: null, recordingId: null, recordingStartTime: null, mimeType: null,

    findBestCodec() {
      for (const c of ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
        if (MediaRecorder.isTypeSupported(c)) return c;
      }
      return 'video/webm';
    },

    getStreamerId() {
      const m = window.location.pathname.match(/^\/([^\/]+)/);
      return m ? sanitize(m[1]) : 'unknown';
    },

    startRecording(opts = {}) {
      if (this.isRecording) return { success: false, error: '이미 녹화 중' };
      const video = document.querySelector('video');
      if (!video || video.paused) return { success: false, error: '비디오 없음' };

      try {
        this.streamerId = opts.streamerId ? sanitize(opts.streamerId) : this.getStreamerId();
        this.recordingId = this.streamerId + '_' + new Date().toISOString().slice(0,19).replace(/[-:T]/g,'');
        this.recordedChunks = []; this.totalBytes = 0;
        this.recordingStream = video.captureStream();
        this.mimeType = this.findBestCodec();

        this.mediaRecorder = new MediaRecorder(this.recordingStream, {
          mimeType: this.mimeType, videoBitsPerSecond: CONFIG.VIDEO_BITRATE, audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        this.mediaRecorder.ondataavailable = (e) => { if (e.data?.size > 0) { this.recordedChunks.push(e.data); this.totalBytes += e.data.size; } };
        this.mediaRecorder.onstop = () => { this.clearProgress(); this.recordingStream?.getTracks().forEach(t => t.stop()); this.saveRecording(); this.isRecording = false; };
        this.mediaRecorder.onerror = (e) => { window.postMessage({ type: 'SOOPTALKING_RECORDING_ERROR', error: e.error?.message || '오류' }, '*'); this.stopRecording(); };

        this.mediaRecorder.start(CONFIG.TIMESLICE);
        this.isRecording = true;
        this.recordingStartTime = Date.now();
        this.startProgress();

        console.log('[숲토킹 Recorder] ▶️ 녹화 시작:', this.streamerId);
        return { success: true, streamerId: this.streamerId, recordingId: this.recordingId };
      } catch (e) { return { success: false, error: e.message }; }
    },

    startProgress() {
      this.clearProgress();
      this.progressInterval = setInterval(() => {
        if (this.isRecording) {
          window.postMessage({ type: 'SOOPTALKING_RECORDING_PROGRESS', totalBytes: this.totalBytes, duration: (Date.now() - this.recordingStartTime) / 1000, streamerId: this.streamerId }, '*');
        }
      }, CONFIG.PROGRESS_INTERVAL);
    },

    clearProgress() { if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = null; } },

    saveRecording() {
      const duration = this.recordingStartTime ? (Date.now() - this.recordingStartTime) / 1000 : 0;
      if (!this.recordedChunks.length) {
        window.postMessage({ type: 'SOOPTALKING_RECORDING_STOPPED', streamerId: this.streamerId, totalBytes: 0, duration, saved: false }, '*');
        return;
      }
      const blob = new Blob(this.recordedChunks, { type: this.mimeType });
      const filename = 'soop_' + sanitize(this.recordingId) + '.webm';
      window.postMessage({ type: 'SOOPTALKING_SAVE_FINAL_RECORDING', filename, size: blob.size, blobUrl: URL.createObjectURL(blob), streamerId: this.streamerId, recordingId: this.recordingId, duration }, '*');
      window.postMessage({ type: 'SOOPTALKING_RECORDING_STOPPED', streamerId: this.streamerId, totalBytes: blob.size, duration, saved: true }, '*');
      this.recordedChunks = []; this.totalBytes = 0;
    },

    stopRecording() {
      if (!this.isRecording) return { success: false, error: '녹화 중 아님' };
      if (this.mediaRecorder?.state !== 'inactive') this.mediaRecorder.stop();
      return { success: true, duration: (Date.now() - this.recordingStartTime) / 1000 };
    },

    getStatus() {
      return { isRecording: this.isRecording, streamerId: this.streamerId, totalBytes: this.totalBytes, duration: this.recordingStartTime ? (Date.now() - this.recordingStartTime) / 1000 : 0 };
    }
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.type !== 'SOOPTALKING_RECORDER_COMMAND') return;
    let result;
    switch (e.data.command) {
      case 'START_RECORDING': result = window.__soopRecorder.startRecording(e.data.params); break;
      case 'STOP_RECORDING': result = window.__soopRecorder.stopRecording(); break;
      case 'GET_STATUS': result = window.__soopRecorder.getStatus(); break;
    }
    window.postMessage({ type: 'SOOPTALKING_RECORDER_RESULT', command: e.data.command, result }, '*');
  });

  console.log('[숲토킹 Recorder] ✅ v2.5 설치 완료');
})();
