// ===== 숲토킹 v3.5.10 - Content Script (ISOLATED) =====
// MAIN world와 Background 사이의 메시지 브릿지 + 분할 저장 지원 + 안전 종료

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

  // ⭐ v3.5.10: 현재 탭 ID 가져오기
  async function getCurrentTabId() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TAB_ID' });
      return response?.tabId;
    } catch (e) {
      console.warn('[숲토킹 Content] 탭 ID 조회 실패:', e);
      return null;
    }
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
    'SOOPTALKING_RECORDING_STOPPED_NOTIFY'
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
        safeSendMessage({
          type: 'RECORDING_STARTED_FROM_PAGE',
          ...data
        }).catch(() => {});
        break;

      case 'SOOPTALKING_RECORDING_PROGRESS':
        safeSendMessage({
          type: 'RECORDING_PROGRESS_FROM_PAGE',
          ...data
        }).catch(() => {});
        break;

      case 'SOOPTALKING_RECORDING_STOPPED':
        safeSendMessage({
          type: 'RECORDING_STOPPED_FROM_PAGE',
          ...data
        }).catch(() => {});
        break;

      case 'SOOPTALKING_RECORDING_ERROR':
        safeSendMessage({
          type: 'RECORDING_ERROR_FROM_PAGE',
          ...data
        }).catch(() => {});
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
            partNumber: event.data.partNumber,
            streamerId: event.data.streamerId
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
            partNumber: event.data.partNumber,
            streamerId: event.data.streamerId
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
        // ⭐ v3.5.9.2: 상세 로깅 추가
        console.log('[숲토킹 Content] ========== START_RECORDING 메시지 수신 ==========');
        console.log('[숲토킹 Content] message:', JSON.stringify(message, null, 2));
        console.log(`[숲토킹 Content]   - streamerId: "${message.streamerId}"`);
        console.log(`[숲토킹 Content]   - nickname: "${message.nickname}"`);
        console.log(`[숲토킹 Content]   - quality: "${message.quality}" (타입: ${typeof message.quality})`);

        const qualityToSend = message.quality || 'ultra';
        if (!message.quality) {
          console.warn('[숲토킹 Content] ⚠️ quality 누락! 기본값 "ultra" 사용');
        }

        console.log(`[숲토킹 Content] MAIN world로 전달할 quality: "${qualityToSend}"`);
        console.log('[숲토킹 Content] ================================================');

        // MAIN world로 녹화 시작 명령 전달
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: 'START_RECORDING',
          params: {
            streamerId: message.streamerId,
            nickname: message.nickname,
            quality: qualityToSend
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

  console.log('[숲토킹 Content] v3.5.10 ISOLATED 브릿지 로드됨 (안전 종료 지원)');
})();
