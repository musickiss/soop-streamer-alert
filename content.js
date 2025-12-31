// ===== 숲토킹 v3.1.0 - Content Script =====
// 페이지 정보 제공만 담당 (녹화는 Offscreen에서 처리)

(function() {
  'use strict';

  if (window.__soopContentScriptInstalled) return;
  window.__soopContentScriptInstalled = true;

  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // 메시지 핸들러
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
          broadNo: extractBroadNoFromUrl(),
          url: window.location.href,
          title: document.title
        });
        return true;

      default:
        sendResponse({ success: false, error: '알 수 없는 메시지' });
        return true;
    }
  });

  console.log('[숲토킹 Content] v3.1.0 로드됨');
})();
