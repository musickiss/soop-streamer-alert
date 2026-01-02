// ===== 숲토킹 v3.5.0 - MAIN World 녹화 모듈 =====
// 녹화 품질 선택 (VP9/VP8) + 성능 최적화 + 500MB 자동 분할 저장

(function() {
  'use strict';

  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  // ===== 상태 변수 =====
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingStartTime = null;
  let totalBytesRecorded = 0;
  let recordingStream = null;
  let progressInterval = null;
  let currentStreamerId = null;
  let currentNickname = null;

  // ===== 분할 저장용 상태 변수 =====
  let partNumber = 1;              // 현재 파트 번호
  let recordingStartTimestamp = ''; // 녹화 시작 시간 (파일명용)
  let accumulatedBytes = 0;         // 현재 세그먼트 누적 바이트
  let currentMimeType = 'video/webm'; // 현재 사용 중인 mimeType

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 5000000,    // 5 Mbps (원본 수준, CPU 부하 감소)
    AUDIO_BITRATE: 128000,     // 128 Kbps
    TIMESLICE: 1000,           // 1초마다 데이터 청크 (부하 분산)
    PROGRESS_INTERVAL: 5000,   // 5초마다 진행 상황 보고
    MAX_CHUNK_SIZE: 50 * 1024 * 1024,  // 50MB 청크 제한 (메모리 보호)
    SEGMENT_SIZE: 500 * 1024 * 1024    // 500MB (분할 저장 기준)
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

  function generateFileName(streamerId) {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') + '_' +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    return `soop_${sanitizeFilename(streamerId)}_${timestamp}.webm`;
  }

  // ===== 코덱 선택 =====
  function getBestMimeType(quality) {
    // quality: 'high' = VP9 (고사양), 'low' = VP8 (저사양)
    let codecs;

    if (quality === 'high') {
      // 고사양: VP9 우선 (좋은 화질, 하드웨어 가속 시 부하 적음)
      codecs = [
        { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
        { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
        { mime: 'video/webm', name: 'WebM' }
      ];
    } else {
      // 저사양: VP8 우선 (가장 가벼움)
      codecs = [
        { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
        { mime: 'video/webm', name: 'WebM' }
      ];
    }

    for (const { mime, name } of codecs) {
      if (MediaRecorder.isTypeSupported(mime)) {
        console.log(`[숲토킹 Recorder] 코덱 선택: ${name} (${quality === 'high' ? '고사양' : '저사양'})`);
        return mime;
      }
    }
    return 'video/webm';
  }

  // ===== 진행 상황 보고 =====
  function startProgressInterval() {
    clearProgressInterval();
    progressInterval = setInterval(() => {
      if (isRecording) {
        const elapsedTime = Math.floor((Date.now() - recordingStartTime) / 1000);
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_PROGRESS',
          streamerId: currentStreamerId,
          nickname: currentNickname,
          totalBytes: totalBytesRecorded,
          elapsedTime: elapsedTime
        }, window.location.origin);
      }
    }, CONFIG.PROGRESS_INTERVAL);
  }

  function clearProgressInterval() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  // ===== 정리 =====
  function cleanup() {
    clearProgressInterval();

    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }

    recordedChunks = [];
    mediaRecorder = null;
    isRecording = false;
    totalBytesRecorded = 0;
  }

  // ===== 녹화 모듈 =====
  window.__soopRecorder = {
    // ===== 녹화 시작 =====
    async startRecording(params = {}) {
      if (isRecording) {
        return { success: false, error: '이미 녹화 중입니다.' };
      }

      try {
        // 1. 비디오 요소 찾기
        let video = document.querySelector('video#webplayer-video');
        if (!video) {
          video = document.querySelector('video[src]');
        }
        if (!video) {
          video = document.querySelector('video');
        }

        if (!video) {
          return { success: false, error: '비디오 요소를 찾을 수 없습니다.' };
        }

        // readyState 확인
        if (video.readyState < 2) {
          return { success: false, error: '비디오가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.' };
        }

        if (video.paused || video.ended) {
          return { success: false, error: '비디오가 재생 중이 아닙니다.' };
        }

        // 스트리머 정보
        currentStreamerId = params.streamerId ? sanitizeFilename(params.streamerId) : sanitizeFilename(getStreamerIdFromUrl());
        currentNickname = params.nickname ? sanitizeFilename(params.nickname) : currentStreamerId;

        // 2. 초기화
        recordedChunks = [];
        totalBytesRecorded = 0;
        recordingStartTime = Date.now();

        // 분할 저장용 변수 초기화
        partNumber = 1;
        recordingStartTimestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        accumulatedBytes = 0;

        // 3. video.captureStream()으로 스트림 획득
        recordingStream = video.captureStream();
        console.log('[숲토킹 Recorder] 스트림 획득 성공');

        // 4. 코덱 선택
        const quality = params.quality || 'low';
        const mimeType = getBestMimeType(quality);
        currentMimeType = mimeType; // 분할 저장 시 사용

        // 5. MediaRecorder 생성
        mediaRecorder = new MediaRecorder(recordingStream, {
          mimeType: mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 6. 데이터 핸들러 (메모리 최적화 + 500MB 자동 분할 저장)
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
            totalBytesRecorded += e.data.size;
            accumulatedBytes += e.data.size;

            // ★ 500MB 도달 시 자동 분할 저장
            if (accumulatedBytes >= CONFIG.SEGMENT_SIZE) {
              console.log(`[숲토킹 Recorder] 분할 저장 시작 (part${partNumber}, ${(accumulatedBytes / 1024 / 1024).toFixed(1)}MB)`);

              // 현재 청크들로 Blob 생성
              const blob = new Blob(recordedChunks, { type: currentMimeType });

              // 파일명 생성 (part 번호 포함)
              const fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;

              // 저장 요청 전송
              const blobUrl = URL.createObjectURL(blob);
              window.postMessage({
                type: 'SOOPTALKING_SAVE_SEGMENT',
                fileName: fileName,
                size: blob.size,
                blobUrl: blobUrl,
                partNumber: partNumber,
                streamerId: currentStreamerId
              }, '*');

              // 10초 후 Blob URL 해제 (다운로드 완료 후)
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
              }, 10000);

              // 다음 세그먼트 준비
              partNumber++;
              recordedChunks = [];  // 청크 배열 초기화 (메모리 해제)
              accumulatedBytes = 0;

              console.log(`[숲토킹 Recorder] 분할 저장 완료, part${partNumber} 시작`);
            }
          }
        };

        // 7. 녹화 종료 처리 (남은 청크 저장 + part 번호 처리)
        mediaRecorder.onstop = async () => {
          console.log('[숲토킹 Recorder] 녹화 중지됨');
          clearProgressInterval();

          const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

          // 남은 청크가 있으면 저장
          if (recordedChunks.length > 0) {
            try {
              // Blob 생성
              const blob = new Blob(recordedChunks, { type: currentMimeType });
              const blobUrl = URL.createObjectURL(blob);

              // 파일명 생성 (마지막 part 또는 단일 파일)
              let fileName;
              if (partNumber > 1) {
                // 분할된 경우: part 번호 포함
                fileName = `soop_${currentStreamerId}_${recordingStartTimestamp}_part${partNumber}.webm`;
              } else {
                // 분할 없이 종료된 경우: 기존 형식 유지
                fileName = generateFileName(currentStreamerId);
              }

              console.log(`[숲토킹 Recorder] 최종 파일 생성: ${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

              // Background로 다운로드 요청
              window.postMessage({
                type: 'SOOPTALKING_SAVE_RECORDING',
                blobUrl: blobUrl,
                fileName: fileName,
                size: blob.size
              }, window.location.origin);

              // 완료 알림
              window.postMessage({
                type: 'SOOPTALKING_RECORDING_STOPPED',
                streamerId: currentStreamerId,
                nickname: currentNickname,
                totalBytes: totalBytesRecorded,
                duration: duration,
                saved: true,
                fileName: fileName,
                partNumber: partNumber > 1 ? partNumber : null,
                totalParts: partNumber > 1 ? partNumber : null
              }, window.location.origin);

              // 메모리 정리: 10초 후 Blob URL 해제
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                console.log('[숲토킹 Recorder] Blob URL 해제됨');
              }, 10000);

            } catch (err) {
              console.error('[숲토킹 Recorder] 파일 생성 오류:', err);
              window.postMessage({
                type: 'SOOPTALKING_RECORDING_ERROR',
                error: '파일 생성 중 오류: ' + err.message
              }, window.location.origin);
            }
          }

          // 상태 초기화
          recordedChunks = [];
          accumulatedBytes = 0;
          partNumber = 1;
          recordingStartTimestamp = '';

          cleanup();
        };

        // 8. 에러 핸들러
        mediaRecorder.onerror = (e) => {
          console.error('[숲토킹 Recorder] MediaRecorder 오류:', e.error);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: e.error?.message || '녹화 중 오류 발생'
          }, window.location.origin);
          cleanup();
        };

        // 9. 녹화 시작
        mediaRecorder.start(CONFIG.TIMESLICE);
        isRecording = true;

        // 진행 상황 보고 시작
        startProgressInterval();

        console.log('[숲토킹 Recorder] 녹화 시작:', currentStreamerId);

        // 시작 알림
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STARTED',
          streamerId: currentStreamerId,
          nickname: currentNickname,
          recordingId: Date.now().toString()
        }, window.location.origin);

        return {
          success: true,
          streamerId: currentStreamerId,
          nickname: currentNickname
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 시작 실패:', error);
        cleanup();

        window.postMessage({
          type: 'SOOPTALKING_RECORDING_ERROR',
          error: error.message
        }, window.location.origin);

        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 중지 =====
    stopRecording() {
      if (!isRecording) {
        return { success: false, error: '녹화 중이 아닙니다.' };
      }

      console.log('[숲토킹 Recorder] 녹화 중지 요청');

      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // ===== 상태 조회 =====
    getStatus() {
      return {
        isRecording: isRecording,
        streamerId: currentStreamerId,
        nickname: currentNickname,
        totalBytes: totalBytesRecorded,
        elapsedTime: recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0
      };
    }
  };

  // ===== 메시지 리스너 =====
  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = e.data;
    let result;

    switch (command) {
      case 'START_RECORDING':
        result = await window.__soopRecorder.startRecording(params);
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
    }, window.location.origin);
  });

  // ===== 페이지 언로드 처리 =====
  window.addEventListener('beforeunload', (e) => {
    if (isRecording) {
      e.preventDefault();
      e.returnValue = '녹화가 진행 중입니다. 페이지를 떠나면 녹화가 중단됩니다.';
    }
  });

  console.log('[숲토킹 Recorder] v3.5.0 MAIN world 모듈 로드됨 (500MB 자동 분할 저장)');
})();
