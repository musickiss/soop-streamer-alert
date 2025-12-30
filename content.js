// ===== 숲토킹 v2.0 - Content Script =====
// SOOP 방송 페이지에서 m3u8 URL 캡처 및 방송 정보 추출
// 사용자의 로그인 세션(쿠키)을 그대로 활용

(function() {
  'use strict';

  // ===== 상태 =====
  let capturedM3u8Url = null;
  let capturedBaseUrl = null;
  let broadcastInfo = null;

  // ===== URL에서 정보 추출 =====
  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ===== m3u8 URL 캡처 (PerformanceObserver) =====
  function setupM3u8Observer() {
    // 이미 로드된 리소스에서 m3u8 찾기
    try {
      const entries = performance.getEntriesByType('resource');
      for (const entry of entries) {
        checkAndCaptureM3u8(entry.name);
      }
    } catch (e) {
      console.log('[숲토킹] 기존 리소스 검색 오류:', e);
    }

    // 새로운 리소스 요청 감시
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          checkAndCaptureM3u8(entry.name);
        }
      });
      observer.observe({ entryTypes: ['resource'] });
      console.log('[숲토킹] m3u8 URL 감시 시작');
    } catch (e) {
      console.log('[숲토킹] PerformanceObserver 오류:', e);
    }
  }

  function checkAndCaptureM3u8(url) {
    if (!url) return;

    // chunklist 또는 playlist m3u8 URL 캡처 (미디어 플레이리스트)
    if (url.includes('.m3u8') && (url.includes('chunklist') || url.includes('playlist'))) {
      if (!url.includes('master')) {
        capturedM3u8Url = url;
        capturedBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);
        console.log('[숲토킹] m3u8 URL 캡처:', capturedM3u8Url);

        // Background에 캡처 완료 알림
        chrome.runtime.sendMessage({
          type: 'M3U8_CAPTURED',
          data: {
            m3u8Url: capturedM3u8Url,
            baseUrl: capturedBaseUrl,
            streamerId: extractStreamerIdFromUrl(),
            broadNo: extractBroadNoFromUrl()
          }
        }).catch(() => {});
      }
    }
  }

  // ===== 방송 정보 조회 =====
  async function fetchBroadcastInfo() {
    const streamerId = extractStreamerIdFromUrl();
    if (!streamerId) {
      return { success: false, error: '스트리머 ID를 찾을 수 없습니다.' };
    }

    try {
      const response = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `bid=${encodeURIComponent(streamerId)}`,
        credentials: 'include'
      });

      const data = await response.json();

      if (data.CHANNEL && data.CHANNEL.RESULT === 1) {
        broadcastInfo = {
          streamerId: streamerId,
          broadNo: data.CHANNEL.BNO,
          title: data.CHANNEL.TITLE,
          nickname: data.CHANNEL.BJNICK,
          isLive: true
        };
        return { success: true, data: broadcastInfo };
      } else {
        return { success: false, error: '방송 중이 아닙니다.', streamerId };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== 페이지에서 정보 추출 (fallback) =====
  function extractBroadcastInfoFromPage() {
    const streamerId = extractStreamerIdFromUrl();
    const broadNo = extractBroadNoFromUrl();

    let nickname = streamerId;
    let title = document.title || '';

    const nicknameEl = document.querySelector('.nickname, .bj-name, [class*="nickname"]');
    if (nicknameEl) nickname = nicknameEl.textContent.trim();

    const titleEl = document.querySelector('.title, .broadcast-title, [class*="title"]');
    if (titleEl) title = titleEl.textContent.trim();

    return { streamerId, broadNo, nickname, title, isLive: true };
  }

  // ===== 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_BROADCAST_INFO':
            let info = await fetchBroadcastInfo();
            if (!info.success) {
              info = { success: true, data: extractBroadcastInfoFromPage() };
            }
            sendResponse(info);
            break;

          case 'GET_M3U8_URL':
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
            break;

          case 'CHECK_PAGE_STATUS':
            sendResponse({
              success: true,
              hasM3u8: !!capturedM3u8Url,
              streamerId: extractStreamerIdFromUrl(),
              broadNo: extractBroadNoFromUrl()
            });
            break;

          default:
            sendResponse({ success: false, error: '알 수 없는 메시지' });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  });

  // ===== 초기화 =====
  function init() {
    console.log('[숲토킹] Content Script 로드됨');
    setupM3u8Observer();
    setTimeout(() => fetchBroadcastInfo(), 1000);
  }

  init();
})();
