// ===== 숲토킹 v3.3.0 - MAIN World 녹화 모듈 =====
// File System API 기반 실시간 디스크 저장

(function() {
  'use strict';

  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  // ===== 상태 변수 =====
  let mediaRecorder = null;
  let fileWritable = null;  // WritableStream
  let isRecording = false;
  let recordingStartTime = null;
  let totalBytesWritten = 0;
  let recordingStream = null;
  let progressInterval = null;
  let currentStreamerId = null;
  let currentNickname = null;
  let currentFileName = null;

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 8000000,    // 8 Mbps
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

  // ===== IndexedDB 함수 =====

  // IndexedDB에서 directoryHandle 로드
  async function getDirectoryHandle() {
    return new Promise((resolve) => {
      const request = indexedDB.open('SooptalkingDB', 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('settings', 'readonly');
        const store = tx.objectStore('settings');
        const getReq = store.get('recordingDirectory');

        getReq.onsuccess = () => resolve(getReq.result?.value || null);
        getReq.onerror = () => resolve(null);
      };

      request.onerror = () => resolve(null);
    });
  }

  // directoryHandle 저장
  async function saveDirectoryHandle(dirHandle) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('SooptalkingDB', 1);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put({ key: 'recordingDirectory', value: dirHandle });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // 권한 확인
  async function verifyPermission(dirHandle) {
    try {
      const options = { mode: 'readwrite' };
      return (await dirHandle.queryPermission(options)) === 'granted';
    } catch {
      return false;
    }
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
          totalBytes: totalBytesWritten,
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

    mediaRecorder = null;
    isRecording = false;
  }

  // ===== 녹화 모듈 =====
  window.__soopRecorder = {
    // ===== 녹화 시작 (File System API) =====
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

        // 2. 디렉토리 핸들 가져오기
        let dirHandle = await getDirectoryHandle();

        // 3. 핸들이 없거나 권한이 없으면 폴더 선택 요청
        if (!dirHandle || !(await verifyPermission(dirHandle))) {
          try {
            dirHandle = await window.showDirectoryPicker({
              mode: 'readwrite',
              startIn: 'downloads'
            });
            await saveDirectoryHandle(dirHandle);
            console.log('[숲토킹 Recorder] 새 폴더 선택됨:', dirHandle.name);
          } catch (err) {
            if (err.name === 'AbortError') {
              return { success: false, error: '폴더 선택이 취소되었습니다.' };
            }
            throw err;
          }
        }

        // 4. 파일 생성
        currentFileName = generateFileName(currentStreamerId);
        const fileHandle = await dirHandle.getFileHandle(currentFileName, { create: true });
        fileWritable = await fileHandle.createWritable();

        console.log('[숲토킹 Recorder] 파일 생성:', currentFileName);

        // 5. 초기화
        totalBytesWritten = 0;
        recordingStartTime = Date.now();

        // 6. video.captureStream()으로 스트림 획득
        recordingStream = video.captureStream();
        console.log('[숲토킹 Recorder] 스트림 획득 성공');

        // 7. 코덱 선택
        const mimeType = getBestMimeType();

        // 8. MediaRecorder 생성
        mediaRecorder = new MediaRecorder(recordingStream, {
          mimeType: mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 9. 데이터 발생 시 즉시 디스크에 쓰기
        mediaRecorder.ondataavailable = async (e) => {
          if (e.data && e.data.size > 0 && fileWritable) {
            try {
              await fileWritable.write(e.data);
              totalBytesWritten += e.data.size;
            } catch (err) {
              console.error('[숲토킹 Recorder] 디스크 쓰기 오류:', err);
            }
          }
        };

        // 10. 녹화 종료 처리
        mediaRecorder.onstop = async () => {
          console.log('[숲토킹 Recorder] 녹화 중지됨');
          clearProgressInterval();

          try {
            if (fileWritable) {
              await fileWritable.close();
              fileWritable = null;
            }

            const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

            window.postMessage({
              type: 'SOOPTALKING_RECORDING_STOPPED',
              streamerId: currentStreamerId,
              nickname: currentNickname,
              totalBytes: totalBytesWritten,
              duration: duration,
              saved: true,
              fileName: currentFileName
            }, window.location.origin);

            console.log(`[숲토킹 Recorder] 녹화 완료: ${currentFileName} (${(totalBytesWritten / 1024 / 1024).toFixed(2)} MB)`);

          } catch (err) {
            console.error('[숲토킹 Recorder] 파일 닫기 오류:', err);
          }

          cleanup();
        };

        // 11. 에러 핸들러
        mediaRecorder.onerror = async (e) => {
          console.error('[숲토킹 Recorder] MediaRecorder 오류:', e.error);

          try {
            if (fileWritable) {
              await fileWritable.close();
              fileWritable = null;
            }
          } catch {}

          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: e.error?.message || '녹화 중 오류 발생'
          }, window.location.origin);

          cleanup();
        };

        // 12. 녹화 시작
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
          recordingId: currentFileName,
          fileName: currentFileName
        }, window.location.origin);

        return {
          success: true,
          streamerId: currentStreamerId,
          nickname: currentNickname,
          fileName: currentFileName
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 시작 실패:', error);

        try {
          if (fileWritable) {
            await fileWritable.close();
            fileWritable = null;
          }
        } catch {}

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
        totalBytes: totalBytesWritten,
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

  // 페이지 떠나기 시도 시 경고
  window.addEventListener('beforeunload', (e) => {
    if (isRecording) {
      e.preventDefault();
      e.returnValue = '녹화가 진행 중입니다. 페이지를 떠나면 녹화가 중단됩니다.';
    }
  });

  // 강제 종료 시에도 파일 닫기 시도
  window.addEventListener('unload', async () => {
    if (fileWritable) {
      try {
        await fileWritable.close();
      } catch {}
    }
  });

  console.log('[숲토킹 Recorder] v3.3.0 MAIN world 모듈 로드됨 (File System API)');
})();
