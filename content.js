// ===== 숲토킹 v2.0 - Content Script =====
// SOOP 방송 페이지에서 m3u8 URL 캡처 및 방송 정보 추출
// 사용자의 로그인 세션(쿠키)을 그대로 활용

(function() {
  'use strict';

  // ===== 상태 =====
  let capturedM3u8Url = null;
  let capturedBaseUrl = null;
  let broadcastInfo = null;
  let m3u8SearchInterval = null;

  // ===== URL에서 정보 추출 =====
  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ===== m3u8 URL 검증 및 캡처 =====
  function isValidM3u8Url(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.includes('.m3u8')) return false;
    if (url.includes('master')) return false;  // master playlist 제외
    // chunklist, playlist, 또는 일반 m3u8 패턴
    return url.includes('chunklist') || url.includes('playlist') || url.match(/\/[^\/]+\.m3u8/);
  }

  function captureM3u8(url) {
    if (!isValidM3u8Url(url)) return false;

    capturedM3u8Url = url;
    capturedBaseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    console.log('[숲토킹] m3u8 URL 캡처 성공:', capturedM3u8Url);

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

    return true;
  }

  // ===== 방법 1: PerformanceObserver로 네트워크 요청 감시 =====
  function setupPerformanceObserver() {
    // 이미 로드된 리소스에서 m3u8 찾기
    try {
      const entries = performance.getEntriesByType('resource');
      for (const entry of entries) {
        if (captureM3u8(entry.name)) break;
      }
    } catch (e) {
      console.log('[숲토킹] 기존 리소스 검색 오류:', e);
    }

    // 새로운 리소스 요청 감시
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (captureM3u8(entry.name)) break;
        }
      });
      observer.observe({ entryTypes: ['resource'] });
      console.log('[숲토킹] PerformanceObserver 시작');
    } catch (e) {
      console.log('[숲토킹] PerformanceObserver 오류:', e);
    }
  }

  // ===== 방법 2: Video 요소에서 src 확인 =====
  function findM3u8FromVideo() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      // video src 직접 확인
      if (video.src && isValidM3u8Url(video.src)) {
        return video.src;
      }
      // source 요소 확인
      const sources = video.querySelectorAll('source');
      for (const source of sources) {
        if (source.src && isValidM3u8Url(source.src)) {
          return source.src;
        }
      }
    }
    return null;
  }

  // ===== 방법 3: SOOP 플레이어 전역 변수에서 추출 =====
  function findM3u8FromPlayer() {
    try {
      // SOOP 플레이어 객체 확인
      if (window.PLAYER) {
        if (window.PLAYER.hlsUrl) return window.PLAYER.hlsUrl;
        if (window.PLAYER.streamUrl) return window.PLAYER.streamUrl;
        if (window.PLAYER.m3u8Url) return window.PLAYER.m3u8Url;
      }

      // 다른 전역 변수 확인
      if (window.playerConfig && window.playerConfig.hlsUrl) {
        return window.playerConfig.hlsUrl;
      }

      // szStreamUrl 등 SOOP 특정 변수
      if (window.szStreamUrl) return window.szStreamUrl;
      if (window.g_szStreamUrl) return window.g_szStreamUrl;

    } catch (e) {
      console.log('[숲토킹] 플레이어 변수 검색 오류:', e);
    }
    return null;
  }

  // ===== 방법 4: 페이지 스크립트에서 m3u8 URL 추출 =====
  function findM3u8FromScripts() {
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      const m3u8Pattern = /https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/g;

      for (const script of scripts) {
        const content = script.textContent || '';
        const matches = content.match(m3u8Pattern);
        if (matches) {
          for (const match of matches) {
            if (isValidM3u8Url(match)) {
              return match;
            }
          }
        }
      }
    } catch (e) {
      console.log('[숲토킹] 스크립트 검색 오류:', e);
    }
    return null;
  }

  // ===== 방법 5: Fetch/XHR 인터셉트 =====
  function setupNetworkInterceptor() {
    // Fetch 인터셉트
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const url = args[0]?.url || args[0];
      if (typeof url === 'string' && isValidM3u8Url(url)) {
        captureM3u8(url);
      }
      return response;
    };

    // XMLHttpRequest 인터셉트
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (typeof url === 'string' && isValidM3u8Url(url)) {
        captureM3u8(url);
      }
      return originalOpen.call(this, method, url, ...rest);
    };

    console.log('[숲토킹] 네트워크 인터셉터 설정 완료');
  }

  // ===== 종합 m3u8 검색 =====
  function searchM3u8() {
    if (capturedM3u8Url) return capturedM3u8Url;

    // 방법 2: Video 요소
    let url = findM3u8FromVideo();
    if (url && captureM3u8(url)) return capturedM3u8Url;

    // 방법 3: 플레이어 전역 변수
    url = findM3u8FromPlayer();
    if (url && captureM3u8(url)) return capturedM3u8Url;

    // 방법 4: 스크립트 내용
    url = findM3u8FromScripts();
    if (url && captureM3u8(url)) return capturedM3u8Url;

    // 방법 1: Performance entries 재검색
    try {
      const entries = performance.getEntriesByType('resource');
      for (const entry of entries) {
        if (isValidM3u8Url(entry.name)) {
          captureM3u8(entry.name);
          return capturedM3u8Url;
        }
      }
    } catch (e) {}

    return null;
  }

  // ===== 주기적 m3u8 검색 =====
  function startM3u8Search() {
    // 즉시 검색
    searchM3u8();

    // 캡처되지 않았으면 주기적으로 재시도
    if (!capturedM3u8Url) {
      let attempts = 0;
      m3u8SearchInterval = setInterval(() => {
        attempts++;
        const result = searchM3u8();

        if (result || attempts >= 30) {  // 최대 30초간 시도
          clearInterval(m3u8SearchInterval);
          m3u8SearchInterval = null;

          if (result) {
            console.log('[숲토킹] m3u8 검색 성공 (시도:', attempts, ')');
          } else {
            console.log('[숲토킹] m3u8 검색 실패 - 최대 시도 횟수 초과');
          }
        }
      }, 1000);
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

    // SOOP 페이지 구조에 맞는 선택자들
    const nicknameSelectors = [
      '.nickname', '.bj-name', '[class*="nickname"]',
      '.player-bj-name', '.broadcast-bj-name', '.streamer-name'
    ];
    for (const selector of nicknameSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        nickname = el.textContent.trim();
        break;
      }
    }

    const titleSelectors = [
      '.title', '.broadcast-title', '[class*="title"]',
      '.player-title', '.stream-title'
    ];
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent.trim()) {
        title = el.textContent.trim();
        break;
      }
    }

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
            // 캡처된 URL이 없으면 즉시 검색 시도
            if (!capturedM3u8Url) {
              searchM3u8();
            }

            if (capturedM3u8Url) {
              sendResponse({
                success: true,
                m3u8Url: capturedM3u8Url,
                baseUrl: capturedBaseUrl
              });
            } else {
              sendResponse({
                success: false,
                error: 'm3u8 URL을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.'
              });
            }
            break;

          case 'CHECK_PAGE_STATUS':
            sendResponse({
              success: true,
              hasM3u8: !!capturedM3u8Url,
              m3u8Url: capturedM3u8Url,
              streamerId: extractStreamerIdFromUrl(),
              broadNo: extractBroadNoFromUrl()
            });
            break;

          case 'FORCE_SEARCH_M3U8':
            // 강제 재검색
            capturedM3u8Url = null;
            capturedBaseUrl = null;
            const result = searchM3u8();
            sendResponse({
              success: !!result,
              m3u8Url: result,
              baseUrl: capturedBaseUrl
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
    console.log('[숲토킹] Content Script 로드됨 - URL:', window.location.href);

    // 네트워크 인터셉터 설정 (가장 먼저)
    setupNetworkInterceptor();

    // PerformanceObserver 설정
    setupPerformanceObserver();

    // m3u8 검색 시작
    startM3u8Search();

    // 방송 정보 조회 (약간 지연)
    setTimeout(() => fetchBroadcastInfo(), 1000);

    // 페이지 변경 감지 (SPA 대응)
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[숲토킹] URL 변경 감지:', lastUrl);
        // 상태 리셋
        capturedM3u8Url = null;
        capturedBaseUrl = null;
        // 재검색
        setTimeout(startM3u8Search, 500);
      }
    });
    urlObserver.observe(document.body, { childList: true, subtree: true });
  }

  // DOM 로드 후 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
