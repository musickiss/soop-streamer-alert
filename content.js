// ===== 숲토킹 v2.5 - Content Script (ISOLATED World) =====
// chrome API 사용 가능, content-main.js로부터 postMessage 수신
// v2.5: 보안 강화, origin 검증 추가

(function() {
  'use strict';

  // 중복 주입 방지
  if (window.__soopContentScriptInstalled) {
    console.log('[숲토킹 Content] 이미 설치됨, 스킵');
    return;
  }
  window.__soopContentScriptInstalled = true;

  // ===== 보안: 허용된 origin =====
  const ALLOWED_ORIGINS = [
    'https://play.sooplive.co.kr',
    'https://sooplive.co.kr'
  ];

  function isAllowedOrigin(origin) {
    if (!origin) return true;  // 같은 페이지 내 postMessage
    return ALLOWED_ORIGINS.some(allowed =>
      origin === allowed || origin.endsWith('.sooplive.co.kr')
    );
  }

  // ===== Extension context 유효성 검사 =====
  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
  }

  // 안전한 메시지 전송 함수
  function safeSendMessage(message) {
    if (!isExtensionContextValid()) {
      console.warn('[숲토킹 Content] Extension context가 무효화됨. 페이지를 새로고침해주세요.');
      return Promise.reject(new Error('Extension context invalidated. 페이지를 새로고침해주세요.'));
    }
    return chrome.runtime.sendMessage(message);
  }

  // 캡처된 m3u8 URL 저장
  let capturedM3u8Url = null;
  let capturedBaseUrl = null;

  // ===== MAIN World에서 보낸 메시지 수신 (origin 검증 추가) =====
  window.addEventListener('message', (event) => {
    // 🔒 보안: source 및 origin 검증
    if (event.source !== window) return;
    if (!isAllowedOrigin(event.origin)) {
      console.warn('[숲토킹 Content] 🔒 차단된 origin:', event.origin);
      return;
    }

    // content-main.js에서 보낸 m3u8 캡처 메시지
    if (event.data && event.data.type === 'SOOPTALKING_M3U8_CAPTURED') {
      const url = event.data.url;
      console.log('[숲토킹 Content] Main에서 m3u8 수신:', url.substring(0, 80), '(via', event.data.source + ')');

      capturedM3u8Url = url;
      capturedBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);

      // Background로 전달
      safeSendMessage({
        type: 'M3U8_URL_FROM_HOOK',
        data: {
          m3u8Url: url,
          baseUrl: capturedBaseUrl,
          streamerId: extractStreamerIdFromUrl(),
          broadNo: extractBroadNoFromUrl(),
          source: event.data.source
        }
      }).then(() => {
        console.log('[숲토킹 Content] Background로 m3u8 URL 전송 완료');
      }).catch((e) => {
        console.error('[숲토킹 Content] Background 전송 실패:', e.message);
      });
    }

    // 이전 버전 호환성 (SOOP_M3U8_CAPTURED)
    if (event.data && event.data.type === 'SOOP_M3U8_CAPTURED') {
      const url = event.data.url;
      console.log('[숲토킹 Content] 레거시 m3u8 수신:', url);

      capturedM3u8Url = url;
      capturedBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);

      safeSendMessage({
        type: 'M3U8_URL_FROM_HOOK',
        data: {
          m3u8Url: url,
          baseUrl: capturedBaseUrl,
          streamerId: extractStreamerIdFromUrl(),
          broadNo: extractBroadNoFromUrl(),
          source: event.data.source || 'legacy'
        }
      }).catch(() => {});
    }

    // ===== 최종 녹화 파일 저장 요청 =====
    if (event.data && event.data.type === 'SOOPTALKING_SAVE_FINAL_RECORDING') {
      console.log('[숲토킹 Content] 최종 녹화 저장 요청:', event.data.filename);
      console.log('[숲토킹 Content] 크기:', (event.data.size / 1024 / 1024).toFixed(2), 'MB');
      safeSendMessage({
        type: 'SAVE_FINAL_RECORDING',
        data: {
          filename: event.data.filename,
          size: event.data.size,
          blobUrl: event.data.blobUrl,
          streamerId: event.data.streamerId,
          recordingId: event.data.recordingId,
          duration: event.data.duration
        }
      }).catch(e => {
        console.error('[숲토킹 Content] 최종 녹화 저장 요청 실패:', e.message);
        if (e.message.includes('invalidated')) {
          console.error('[숲토킹 Content] Extension이 업데이트됨. 페이지 새로고침 필요.');
        }
      });
    }

    // ===== 녹화 완료 메시지 =====
    if (event.data && event.data.type === 'SOOPTALKING_RECORDING_COMPLETE') {
      console.log('[숲토킹 Content] 녹화 완료:',
                  (event.data.totalBytes / 1024 / 1024).toFixed(2), 'MB,',
                  event.data.duration?.toFixed(1) || 0, '초');
      safeSendMessage({
        type: 'RECORDING_COMPLETE',
        data: {
          streamerId: event.data.streamerId,
          recordingId: event.data.recordingId,
          totalBytes: event.data.totalBytes,
          duration: event.data.duration,
          saved: event.data.saved
        }
      }).catch(() => {});
    }

    // ===== 녹화 에러 메시지 =====
    if (event.data && event.data.type === 'SOOPTALKING_RECORDING_ERROR') {
      console.error('[숲토킹 Content] 녹화 에러:', event.data.error);
      safeSendMessage({
        type: 'RECORDING_ERROR_FROM_HOOK',
        data: {
          error: event.data.error
        }
      }).catch(() => {});
    }

    // ===== 녹화 진행 상황 (10초마다 push) =====
    if (event.data && event.data.type === 'SOOPTALKING_RECORDING_PROGRESS') {
      safeSendMessage({
        type: 'RECORDING_PROGRESS_FROM_HOOK',
        data: {
          totalBytes: event.data.totalBytes,
          duration: event.data.duration,
          streamerId: event.data.streamerId
        }
      }).catch(() => {});
    }

    // ===== 녹화 완료 (Background 상태 업데이트용) =====
    if (event.data && event.data.type === 'SOOPTALKING_RECORDING_STOPPED') {
      console.log('[숲토킹 Content] 녹화 완료:', event.data);
      safeSendMessage({
        type: 'RECORDING_STOPPED_FROM_HOOK',
        data: {
          streamerId: event.data.streamerId,
          recordingId: event.data.recordingId,
          totalBytes: event.data.totalBytes,
          duration: event.data.duration,
          saved: event.data.saved
        }
      }).catch(() => {});
    }

  });

  // ===== URL에서 정보 추출 =====
  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ===== 페이지에서 정보 추출 =====
  function extractPageInfo() {
    const streamerId = extractStreamerIdFromUrl();
    const broadNo = extractBroadNoFromUrl();

    let nickname = streamerId;
    let title = document.title || '';

    if (document.body) {
      const nicknameSelectors = [
        '.nickname', '.bj-name', '[class*="nickname"]',
        '.player-bj-name', '.broadcast-bj-name', '.streamer-name'
      ];
      for (const selector of nicknameSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim()) {
            nickname = el.textContent.trim();
            break;
          }
        } catch (e) {}
      }

      const titleSelectors = [
        '.title', '.broadcast-title', '[class*="title"]',
        '.player-title', '.stream-title'
      ];
      for (const selector of titleSelectors) {
        try {
          const el = document.querySelector(selector);
          if (el && el.textContent.trim()) {
            title = el.textContent.trim();
            break;
          }
        } catch (e) {}
      }
    }

    return {
      streamerId,
      broadNo,
      nickname,
      title,
      url: window.location.href,
      capturedM3u8Url,
      capturedBaseUrl
    };
  }

  // ===== 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionContextValid()) {
      console.warn('[숲토킹 Content] Extension context 무효화됨, 메시지 무시');
      return false;
    }

    console.log('[숲토킹 Content] 메시지 수신:', message.type);

    switch (message.type) {
      case 'PING':
        sendResponse({ success: true, message: 'pong' });
        return true;

      case 'GET_PAGE_INFO':
        const pageInfo = extractPageInfo();
        sendResponse({
          success: true,
          ...pageInfo
        });
        return true;

      case 'GET_CAPTURED_M3U8':
        if (capturedM3u8Url) {
          sendResponse({
            success: true,
            m3u8Url: capturedM3u8Url,
            baseUrl: capturedBaseUrl
          });
        } else {
          sendResponse({
            success: false,
            error: 'm3u8 URL이 아직 캡처되지 않았습니다.'
          });
        }
        return true;

      case 'GET_BROADCAST_INFO':
        const info = extractPageInfo();
        safeSendMessage({
          type: 'FETCH_STREAM_INFO',
          streamerId: info.streamerId,
          broadNo: info.broadNo
        }).then(response => {
          if (response && response.success) {
            sendResponse({
              success: true,
              data: {
                streamerId: response.streamerId,
                broadNo: response.broadNo,
                nickname: response.nickname,
                title: response.title,
                isLive: true
              }
            });
          } else {
            sendResponse({
              success: true,
              data: {
                streamerId: info.streamerId,
                broadNo: info.broadNo,
                nickname: info.nickname || info.streamerId,
                title: info.title,
                isLive: true
              }
            });
          }
        }).catch(() => {
          sendResponse({
            success: true,
            data: {
              streamerId: info.streamerId,
              broadNo: info.broadNo,
              nickname: info.nickname || info.streamerId,
              title: info.title,
              isLive: true
            }
          });
        });
        return true;

      case 'GET_M3U8_URL':
        if (capturedM3u8Url) {
          sendResponse({
            success: true,
            m3u8Url: capturedM3u8Url,
            baseUrl: capturedBaseUrl
          });
          return true;
        }

        const streamInfo = extractPageInfo();
        safeSendMessage({
          type: 'FETCH_STREAM_URL',
          streamerId: streamInfo.streamerId,
          broadNo: streamInfo.broadNo
        }).then(response => {
          sendResponse(response);
        }).catch(error => {
          sendResponse({ success: false, error: error.message });
        });
        return true;

      case 'RECORDING_COMMAND':
        // sidepanel/background에서 온 녹화 명령을 MAIN world로 전달
        const { command: recCommand, params: recParams } = message;
        console.log('[숲토킹 Content] 녹화 명령 수신:', recCommand);

        // MAIN world (audio-hook.js)로 명령 전달
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: recCommand,
          params: recParams
        }, '*');

        // 즉시 응답 (결과는 이벤트로 전달됨)
        sendResponse({ success: true, message: '명령 전달됨' });
        return true;

      default:
        sendResponse({ success: false, error: '알 수 없는 메시지' });
        return true;
    }
  });

  // ===== 초기화 =====
  function init() {
    console.log('[숲토킹 Content] Content script 로드됨 v2.5');
    console.log('[숲토킹 Content] URL:', window.location.href);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        const info = extractPageInfo();
        console.log('[숲토킹 Content] 스트리머 ID:', info.streamerId);
        console.log('[숲토킹 Content] 방송 번호:', info.broadNo);

        safeSendMessage({
          type: 'CONTENT_LOADED',
          data: info
        }).catch(() => {});
      });
    } else {
      const info = extractPageInfo();
      console.log('[숲토킹 Content] 스트리머 ID:', info.streamerId);
      console.log('[숲토킹 Content] 방송 번호:', info.broadNo);

      safeSendMessage({
        type: 'CONTENT_LOADED',
        data: info
      }).catch(() => {});
    }
  }

  init();
})();
