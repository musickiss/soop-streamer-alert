// ===== 숲토킹 v4.0.2 - Content Script (ISOLATED) =====

(function() {
  'use strict';

  if (window.__soopContentScriptInstalled) return;
  window.__soopContentScriptInstalled = true;

  // ===== 유틸리티 =====
  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function safeSendMessage(message) {
    if (!isExtensionContextValid()) {
      return Promise.reject(new Error('Extension context invalidated'));
    }
    return chrome.runtime.sendMessage(message);
  }

  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // ===== v3.5.14: Storage 기반 녹화 상태 관리 =====
  const STORAGE_KEY_RECORDINGS = 'activeRecordings';

  // ⭐ v3.5.15: Progress 쓰로틀링 (15초)
  const PROGRESS_SAVE_INTERVAL = 15000;
  let lastProgressSaveTime = 0;

  // 녹화 상태를 storage에 직접 저장
  async function saveRecordingStateToStorage(tabId, recordingData) {
    // ⭐ v3.6.1: Context 유효성 체크 추가
    if (!isExtensionContextValid()) {
      console.log('[숲토킹 Content] 녹화 상태 저장 스킵 (context 무효)');
      return;
    }

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordings = result[STORAGE_KEY_RECORDINGS] || {};

      recordings[tabId] = {
        ...recordingData,
        tabId: tabId,
        lastUpdate: Date.now()
      };

      await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
      console.log('[숲토킹 Content] 녹화 상태 storage 저장:', tabId);
    } catch (error) {
      // Extension context invalidated 오류는 조용히 무시
      if (error.message?.includes('Extension context invalidated')) {
        console.log('[숲토킹 Content] 녹화 상태 저장 스킵 (context 무효화됨)');
        return;
      }
      console.error('[숲토킹 Content] 녹화 상태 저장 실패:', error);
    }
  }

  // 녹화 상태를 storage에서 제거
  async function removeRecordingStateFromStorage(tabId) {
    // ⭐ v3.6.1: Context 유효성 체크 추가
    if (!isExtensionContextValid()) {
      console.log('[숲토킹 Content] 녹화 상태 제거 스킵 (context 무효)');
      return;
    }

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordings = result[STORAGE_KEY_RECORDINGS] || {};

      if (recordings[tabId]) {
        delete recordings[tabId];
        await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
        console.log('[숲토킹 Content] 녹화 상태 storage 제거:', tabId);
      }
    } catch (error) {
      // Extension context invalidated 오류는 조용히 무시
      if (error.message?.includes('Extension context invalidated')) {
        console.log('[숲토킹 Content] 녹화 상태 제거 스킵 (context 무효화됨)');
        return;
      }
      console.error('[숲토킹 Content] 녹화 상태 제거 실패:', error);
    }
  }

  // 녹화 진행 상태 업데이트 (storage)
  // ⭐ v3.5.15: 쓰로틀링 적용 (15초마다 저장)
  async function updateRecordingProgressInStorage(tabId, totalBytes, elapsedTime, partNumber) {
    // ⭐ v3.6.1: Context 유효성 체크 추가
    if (!isExtensionContextValid()) {
      return;  // 조용히 스킵
    }

    // 쓰로틀링: 마지막 저장 후 15초 이내면 스킵
    const now = Date.now();
    if (now - lastProgressSaveTime < PROGRESS_SAVE_INTERVAL) {
      return;  // 스킵
    }
    lastProgressSaveTime = now;

    try {
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordings = result[STORAGE_KEY_RECORDINGS] || {};

      if (recordings[tabId]) {
        recordings[tabId].totalBytes = totalBytes;
        recordings[tabId].elapsedTime = elapsedTime;
        recordings[tabId].partNumber = partNumber || 1;
        recordings[tabId].lastUpdate = Date.now();

        await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
        // Progress 저장 로그 생략 (15초마다 발생하므로)
      }
    } catch (error) {
      // Extension context invalidated 포함 모든 오류 조용히 무시 (다음 주기에 재시도)
    }
  }

  // 현재 탭 ID 캐시 (비동기 조회 최소화)
  let cachedTabId = null;

  async function getCurrentTabId() {
    if (cachedTabId) return cachedTabId;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_ID' });
      if (response?.tabId) {
        cachedTabId = response.tabId;
        return cachedTabId;
      }
    } catch (e) {
      console.warn('[숲토킹 Content] 탭 ID 조회 실패:', e.message);
    }
    return null;
  }

  // ===== MAIN world → Background 메시지 브릿지 =====

  // 허용된 메시지 타입 목록 (화이트리스트)
  const ALLOWED_MESSAGE_TYPES = [
    'SOOPTALKING_RECORDING_STARTED',
    'SOOPTALKING_RECORDING_PROGRESS',
    'SOOPTALKING_RECORDING_STOPPED',
    'SOOPTALKING_RECORDING_ERROR',
    'SOOPTALKING_SAVE_RECORDING',
    'SOOPTALKING_SAVE_SEGMENT',  // 분할 저장 메시지 추가
    'SOOPTALKING_SPLIT_START',   // 파트 전환 시작
    'SOOPTALKING_SPLIT_COMPLETE', // 파트 전환 완료
    'SOOPTALKING_RECORDER_RESULT',
    // ⭐ v3.5.10: 안전 종료용 알림 메시지
    'SOOPTALKING_RECORDING_STARTED_NOTIFY',
    'SOOPTALKING_RECORDING_SAVED_NOTIFY',
    'SOOPTALKING_RECORDING_STOPPED_NOTIFY',
    'SOOPTALKING_RECORDING_LOST',  // ⭐ v3.5.24: 녹화 손실 메시지 추가
    'SOOPTALKING_ANALYTICS_ERROR'  // ⭐ v3.6.0: 녹화 오류 Analytics
  ];

  window.addEventListener('message', (e) => {
    // 보안: 같은 윈도우에서 온 메시지만 처리
    if (e.source !== window) return;

    // 보안: origin 검증 (SOOP 도메인만)
    if (!e.origin.includes('sooplive.co.kr')) return;

    const { type, ...data } = e.data;

    // 보안: 화이트리스트에 없는 타입 무시
    if (!type || !ALLOWED_MESSAGE_TYPES.includes(type)) return;

    switch (type) {
      case 'SOOPTALKING_RECORDING_STARTED':
        // ⭐ v3.5.14: Storage에 먼저 저장 (background 통신 실패해도 상태 유지)
        getCurrentTabId().then(tabId => {
          if (tabId) {
            saveRecordingStateToStorage(tabId, {
              streamerId: data.streamerId,
              nickname: data.nickname,
              startTime: Date.now(),
              totalBytes: 0,
              elapsedTime: 0,
              partNumber: 1
            });
          }
        });

        // Background에도 알림 (실패해도 storage에는 저장됨)
        safeSendMessage({
          type: 'RECORDING_STARTED_FROM_PAGE',
          streamerId: data.streamerId,
          nickname: data.nickname,
          recordingId: data.recordingId
        }).catch(err => {
          console.log('[숲토킹 Content] RECORDING_STARTED 전송 실패 (storage에는 저장됨):', err.message);
        });
        break;

      case 'SOOPTALKING_RECORDING_PROGRESS':
        // ⭐ v3.5.14: Storage에 직접 업데이트 (background 통신 불필요)
        getCurrentTabId().then(tabId => {
          if (tabId) {
            updateRecordingProgressInStorage(
              tabId,
              data.totalBytes,
              data.elapsedTime,
              data.partNumber
            );
          }
        });

        // Background에도 알림 (선택적 - 실패 무시)
        safeSendMessage({
          type: 'RECORDING_PROGRESS_FROM_PAGE',
          streamerId: data.streamerId,
          totalBytes: data.totalBytes,
          elapsedTime: data.elapsedTime,
          partNumber: data.partNumber
        }).catch(() => {});
        break;

      case 'SOOPTALKING_RECORDING_STOPPED':
        // ⭐ v3.5.14: Storage에서 제거
        getCurrentTabId().then(tabId => {
          if (tabId) {
            removeRecordingStateFromStorage(tabId);
          }
        });

        safeSendMessage({
          type: 'RECORDING_STOPPED_FROM_PAGE',
          streamerId: data.streamerId,
          totalBytes: data.totalBytes,
          duration: data.duration,
          saved: data.saved
        }).catch(err => {
          console.log('[숲토킹 Content] RECORDING_STOPPED 전송 실패:', err.message);
        });
        break;

      case 'SOOPTALKING_RECORDING_ERROR':
        // ⭐ v3.5.14: 에러 시에도 Storage에서 제거
        getCurrentTabId().then(tabId => {
          if (tabId) {
            removeRecordingStateFromStorage(tabId);
          }
        });

        safeSendMessage({
          type: 'RECORDING_ERROR_FROM_PAGE',
          error: data.error,
          streamerId: data.streamerId
        }).catch(err => {
          console.log('[숲토킹 Content] RECORDING_ERROR 전송 실패:', err.message);
        });
        break;

      case 'SOOPTALKING_SAVE_RECORDING':
        safeSendMessage({
          type: 'SAVE_RECORDING_FROM_PAGE',
          ...data
        }).catch(() => {});
        break;

      case 'SOOPTALKING_SAVE_SEGMENT':
        // ★ 분할 저장 메시지 처리
        console.log('[숲토킹 Content] 분할 저장 요청:', data.fileName);
        safeSendMessage({
          type: 'SAVE_RECORDING_SEGMENT',
          fileName: data.fileName,
          size: data.size,
          blobUrl: data.blobUrl,
          partNumber: data.partNumber,
          streamerId: data.streamerId
        }).catch((error) => {
          console.error('[숲토킹 Content] 분할 저장 전송 실패:', error);
        });
        break;

      case 'SOOPTALKING_RECORDER_RESULT':
        // 녹화 명령 결과 - 필요시 처리
        break;

      // 파트 전환 시작 알림 전달
      case 'SOOPTALKING_SPLIT_START':
        try {
          chrome.runtime.sendMessage({
            type: 'RECORDING_SPLIT_START',
            partNumber: data.partNumber,
            streamerId: data.streamerId
          });
        } catch (e) {
          console.log('[숲토킹 Content] 파트 전환 시작 알림 전달 실패');
        }
        break;

      // 파트 전환 완료 알림 전달
      case 'SOOPTALKING_SPLIT_COMPLETE':
        try {
          chrome.runtime.sendMessage({
            type: 'RECORDING_SPLIT_COMPLETE',
            partNumber: data.partNumber,
            streamerId: data.streamerId
          });
        } catch (e) {
          console.log('[숲토킹 Content] 파트 전환 완료 알림 전달 실패');
        }
        break;

      // ⭐ v3.5.10: 녹화 시작 알림 → Background (안전 종료용)
      case 'SOOPTALKING_RECORDING_STARTED_NOTIFY':
        getCurrentTabId().then(tabId => {
          chrome.runtime.sendMessage({
            type: 'RECORDING_STARTED',
            tabId: tabId,
            streamerId: data.streamerId,
            nickname: data.nickname
          }).catch(e => console.log('[숲토킹 Content] RECORDING_STARTED 전송 실패:', e));
        });
        break;

      // ⭐ v3.5.10: 녹화 저장 완료 알림 → Background (안전 종료용)
      case 'SOOPTALKING_RECORDING_SAVED_NOTIFY':
        getCurrentTabId().then(tabId => {
          chrome.runtime.sendMessage({
            type: 'RECORDING_SAVED',
            tabId: tabId,
            streamerId: data.streamerId,
            nickname: data.nickname,
            fileName: data.fileName,
            fileSize: data.fileSize
          }).catch(e => console.log('[숲토킹 Content] RECORDING_SAVED 전송 실패:', e));
        });
        break;

      // ⭐ v3.5.10: 녹화 중지 알림 (저장 없음) → Background (안전 종료용)
      case 'SOOPTALKING_RECORDING_STOPPED_NOTIFY':
        getCurrentTabId().then(tabId => {
          chrome.runtime.sendMessage({
            type: 'RECORDING_STOPPED',
            tabId: tabId,
            streamerId: data.streamerId,
            saved: data.saved
          }).catch(e => console.log('[숲토킹 Content] RECORDING_STOPPED 전송 실패:', e));
        });
        break;

      // ⭐ v3.5.24: 녹화 손실 알림 (beforeunload에서 전송)
      case 'SOOPTALKING_RECORDING_LOST':
        console.warn('[숲토킹 Content] 녹화 손실 알림 수신:', data.streamerId);
        // Storage에서 녹화 상태 제거 시도
        getCurrentTabId().then(tabId => {
          if (tabId) {
            removeRecordingStateFromStorage(tabId);
          }
        });
        // Background에 알림 (실패해도 무시)
        safeSendMessage({
          type: 'RECORDING_LOST_FROM_PAGE',
          streamerId: data.streamerId,
          totalBytes: data.totalBytes,
          elapsedTime: data.elapsedTime
        }).catch(() => {});
        break;

      // ⭐ v3.6.0: 녹화 오류 Analytics 이벤트 전달
      case 'SOOPTALKING_ANALYTICS_ERROR':
        safeSendMessage({
          type: 'ANALYTICS_RECORDING_ERROR',
          errorType: data.errorType
        }).catch(() => {});
        break;
    }
  });

  // ===== Background → MAIN world 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionContextValid()) {
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return true;
    }

    switch (message.type) {
      case 'PING':
        sendResponse({ success: true, message: 'pong' });
        return true;

      case 'GET_PAGE_INFO':
        sendResponse({
          success: true,
          streamerId: extractStreamerIdFromUrl(),
          url: window.location.href,
          title: document.title
        });
        return true;

      case 'START_RECORDING':
        const qualityToSend = message.quality || 'ultra';
        const splitSizeToSend = message.splitSize || 500;

        // MAIN world로 녹화 시작 명령 전달
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: 'START_RECORDING',
          params: {
            streamerId: message.streamerId,
            nickname: message.nickname,
            quality: qualityToSend,
            splitSize: splitSizeToSend
          }
        }, '*');
        sendResponse({ success: true });
        return true;

      case 'STOP_RECORDING':
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: 'STOP_RECORDING'
        }, '*');
        sendResponse({ success: true, message: '중지 명령 전달됨' });
        return true;

      case 'GET_RECORDING_STATUS':
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: 'GET_STATUS'
        }, '*');
        sendResponse({ success: true, message: '상태 조회 명령 전달됨' });
        return true;

      default:
        sendResponse({ success: false, error: '알 수 없는 메시지: ' + message.type });
        return true;
    }
  });

  // ===== 초기화 알림 =====
  safeSendMessage({
    type: 'CONTENT_SCRIPT_LOADED',
    streamerId: extractStreamerIdFromUrl(),
    url: window.location.href
  }).catch(() => {});

  // ⭐ v3.5.14: 초기화 시 탭 ID 미리 캐시
  getCurrentTabId().then(tabId => {
    // 캐시 완료 - 로그 생략
  });

  // ⭐ v3.5.24: 초기화 시 Background와 녹화 상태 동기화
  // (새로고침 후 불일치 상태 해결)
  getCurrentTabId().then(async (tabId) => {
    if (!tabId) return;

    try {
      // Storage에서 이 탭의 녹화 상태 확인
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordings = result[STORAGE_KEY_RECORDINGS] || {};

      if (recordings[tabId]) {
        // 녹화 상태가 남아있지만, 실제 녹화 중이 아님 (새로고침됨)
        delete recordings[tabId];
        await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });

        // Background에도 알림
        safeSendMessage({
          type: 'RECORDING_STATE_CLEANUP',
          tabId: tabId,
          reason: 'page_reloaded'
        }).catch(() => {});
      }
    } catch (e) {
      // 동기화 실패 무시
    }
  });
})();
