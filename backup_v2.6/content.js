// ===== 숲토킹 v2.5 - Content Script =====
(function() {
  'use strict';
  if (window.__soopContentScriptInstalled) return;
  window.__soopContentScriptInstalled = true;

  function isExtensionContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  function safeSendMessage(msg) {
    if (!isExtensionContextValid()) return Promise.reject(new Error('Extension context invalidated'));
    return chrome.runtime.sendMessage(msg);
  }

  let capturedM3u8Url = null, capturedBaseUrl = null;

  function extractStreamerIdFromUrl() {
    const m = window.location.pathname.match(/^\/([^\/]+)/);
    return m ? m[1] : null;
  }

  function extractBroadNoFromUrl() {
    const m = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return m ? m[1] : null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;

    if (e.data?.type === 'SOOPTALKING_M3U8_CAPTURED') {
      capturedM3u8Url = e.data.url;
      capturedBaseUrl = e.data.url.substring(0, e.data.url.lastIndexOf('/') + 1);
      safeSendMessage({ type: 'M3U8_URL_FROM_HOOK', data: { m3u8Url: capturedM3u8Url, baseUrl: capturedBaseUrl, streamerId: extractStreamerIdFromUrl(), broadNo: extractBroadNoFromUrl(), source: e.data.source } }).catch(() => {});
    }
    if (e.data?.type === 'SOOPTALKING_SAVE_FINAL_RECORDING') {
      safeSendMessage({ type: 'SAVE_FINAL_RECORDING', data: { filename: e.data.filename, size: e.data.size, blobUrl: e.data.blobUrl, streamerId: e.data.streamerId, recordingId: e.data.recordingId, duration: e.data.duration } }).catch(() => {});
    }
    if (e.data?.type === 'SOOPTALKING_RECORDING_PROGRESS') {
      safeSendMessage({ type: 'RECORDING_PROGRESS_FROM_HOOK', data: { totalBytes: e.data.totalBytes, duration: e.data.duration, streamerId: e.data.streamerId } }).catch(() => {});
    }
    if (e.data?.type === 'SOOPTALKING_RECORDING_STOPPED') {
      safeSendMessage({ type: 'RECORDING_STOPPED_FROM_HOOK', data: { streamerId: e.data.streamerId, recordingId: e.data.recordingId, totalBytes: e.data.totalBytes, duration: e.data.duration, saved: e.data.saved } }).catch(() => {});
    }
    if (e.data?.type === 'SOOPTALKING_RECORDING_ERROR') {
      safeSendMessage({ type: 'RECORDING_ERROR_FROM_HOOK', data: { error: e.data.error } }).catch(() => {});
    }
  });

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
        sendResponse({ success: true, streamerId: extractStreamerIdFromUrl(), broadNo: extractBroadNoFromUrl(), url: window.location.href, capturedM3u8Url, capturedBaseUrl });
        return true;
      case 'GET_CAPTURED_M3U8':
        sendResponse(capturedM3u8Url ? { success: true, m3u8Url: capturedM3u8Url, baseUrl: capturedBaseUrl } : { success: false, error: 'm3u8 없음' });
        return true;
      case 'RECORDING_COMMAND':
        window.postMessage({ type: 'SOOPTALKING_RECORDER_COMMAND', command: message.command, params: message.params }, '*');
        sendResponse({ success: true, message: '명령 전달됨' });
        return true;
      default:
        sendResponse({ success: false, error: '알 수 없는 메시지: ' + message.type });
        return true;
    }
  });

  console.log('[숲토킹 Content] v2.5 로드됨');
  safeSendMessage({ type: 'CONTENT_LOADED', data: { streamerId: extractStreamerIdFromUrl(), broadNo: extractBroadNoFromUrl(), url: window.location.href } }).catch(() => {});
})();
