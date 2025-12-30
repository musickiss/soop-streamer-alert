// ===== 숲토킹 v2.0 - Content Script =====
// SOOP API를 직접 호출하여 m3u8 URL 획득
// 사용자의 로그인 세션(쿠키)을 그대로 활용

(function() {
  'use strict';

  // ===== 상태 =====
  let cachedStreamInfo = null;
  let lastFetchTime = 0;
  const CACHE_DURATION = 30000; // 30초 캐시

  // ===== URL에서 정보 추출 =====
  function extractStreamerIdFromUrl() {
    // URL: https://play.sooplive.co.kr/{streamerId}/{broadNo}
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ===== SOOP API 직접 호출로 스트림 URL 획득 =====
  async function getStreamUrl(forceRefresh = false) {
    const streamerId = extractStreamerIdFromUrl();
    const broadNo = extractBroadNoFromUrl();

    if (!streamerId) {
      console.error('[숲토킹] 스트리머 ID를 찾을 수 없음');
      return null;
    }

    // 캐시 확인 (강제 새로고침이 아닌 경우)
    if (!forceRefresh && cachedStreamInfo && (Date.now() - lastFetchTime < CACHE_DURATION)) {
      console.log('[숲토킹] 캐시된 스트림 정보 사용');
      return cachedStreamInfo;
    }

    try {
      // 1단계: player_live_api.php 호출
      console.log('[숲토킹] 1단계: player_live_api.php 호출');
      const playerApiResponse = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          bid: streamerId,
          bno: broadNo || '',
          type: 'live',
          confirm_adult: 'false',
          player_type: 'html5',
          mode: 'landing',
          from_api: '0',
          pwd: '',
          stream_type: 'common',
          quality: 'HD'
        }),
        credentials: 'include'
      });

      const playerData = await playerApiResponse.json();
      console.log('[숲토킹] player_live_api 응답:', playerData);

      if (!playerData.CHANNEL || playerData.CHANNEL.RESULT !== 1) {
        console.error('[숲토킹] 방송 중이 아니거나 접근 불가');
        // 캐시 무효화
        cachedStreamInfo = null;
        return null;
      }

      const channel = playerData.CHANNEL;
      const bno = channel.BNO;
      const cdnType = channel.CDN || 'gcp_cdn';
      const quality = channel.QUALITY || 'hd';

      // 2단계: broad_stream_assign.html 호출
      console.log('[숲토킹] 2단계: broad_stream_assign.html 호출');
      const returnType = cdnType === 'gs_cdn_pc_web' ? 'gs_cdn_pc_web' : 'gcp_cdn';

      const streamAssignResponse = await fetch('https://livestream-manager.sooplive.co.kr/broad_stream_assign.html', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          return_type: returnType,
          broad_key: `${bno}-common-${quality}-hls`,
          use_cors: 'true',
          cors_origin_url: 'play.sooplive.co.kr'
        }),
        credentials: 'include'
      });

      const streamData = await streamAssignResponse.json();
      console.log('[숲토킹] stream_assign 응답:', streamData);

      let m3u8Url = null;

      // view_url 확인
      if (streamData.view_url) {
        m3u8Url = streamData.view_url;
      }
      // 대안: 다른 CDN 구조
      else if (streamData.cdn_url) {
        m3u8Url = streamData.cdn_url;
      }
      else if (streamData.stream_url) {
        m3u8Url = streamData.stream_url;
      }

      if (m3u8Url) {
        console.log('[숲토킹] m3u8 URL 획득 성공:', m3u8Url);

        const result = {
          m3u8Url: m3u8Url,
          baseUrl: m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1),
          streamerId: streamerId,
          broadNo: bno,
          nickname: channel.BJNICK || streamerId,
          title: channel.TITLE || '',
          quality: quality,
          isLive: true
        };

        // 캐시 저장
        cachedStreamInfo = result;
        lastFetchTime = Date.now();

        // Background에 알림
        chrome.runtime.sendMessage({
          type: 'M3U8_CAPTURED',
          data: result
        }).catch(() => {});

        return result;
      }

      console.error('[숲토킹] m3u8 URL을 찾을 수 없음');
      return null;

    } catch (error) {
      console.error('[숲토킹] API 호출 오류:', error);
      return null;
    }
  }

  // ===== 방송 정보만 가져오기 (m3u8 없이) =====
  async function getBroadcastInfo() {
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
        body: new URLSearchParams({
          bid: streamerId,
          bno: extractBroadNoFromUrl() || '',
          type: 'live',
          confirm_adult: 'false',
          player_type: 'html5',
          mode: 'landing',
          from_api: '0'
        }),
        credentials: 'include'
      });

      const data = await response.json();

      if (data.CHANNEL && data.CHANNEL.RESULT === 1) {
        return {
          success: true,
          data: {
            streamerId: streamerId,
            broadNo: data.CHANNEL.BNO,
            title: data.CHANNEL.TITLE,
            nickname: data.CHANNEL.BJNICK,
            isLive: true
          }
        };
      } else {
        return {
          success: false,
          error: '방송 중이 아닙니다.',
          streamerId: streamerId
        };
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
    console.log('[숲토킹 Content] 메시지 수신:', message.type);

    (async () => {
      try {
        switch (message.type) {
          case 'PING':
            // 연결 확인용
            sendResponse({ success: true, message: 'pong' });
            break;

          case 'GET_BROADCAST_INFO':
            // 먼저 API로 시도
            let info = await getBroadcastInfo();
            if (!info.success) {
              // API 실패 시 페이지에서 추출
              info = { success: true, data: extractBroadcastInfoFromPage() };
            }
            sendResponse(info);
            break;

          case 'GET_M3U8_URL':
            // SOOP API 직접 호출
            const streamInfo = await getStreamUrl(message.forceRefresh);

            if (streamInfo) {
              sendResponse({
                success: true,
                m3u8Url: streamInfo.m3u8Url,
                baseUrl: streamInfo.baseUrl,
                streamerId: streamInfo.streamerId,
                broadNo: streamInfo.broadNo,
                nickname: streamInfo.nickname,
                title: streamInfo.title,
                quality: streamInfo.quality
              });
            } else {
              sendResponse({
                success: false,
                error: 'API에서 스트림 URL을 가져올 수 없습니다. 방송 중인지 확인하세요.'
              });
            }
            break;

          case 'CHECK_PAGE_STATUS':
            const status = await getBroadcastInfo();
            sendResponse({
              success: true,
              isLive: status.success && status.data?.isLive,
              streamerId: extractStreamerIdFromUrl(),
              broadNo: extractBroadNoFromUrl(),
              hasCachedStream: !!cachedStreamInfo
            });
            break;

          case 'FORCE_SEARCH_M3U8':
            // 캐시 무효화 후 강제 검색
            cachedStreamInfo = null;
            lastFetchTime = 0;
            const result = await getStreamUrl(true);
            sendResponse({
              success: !!result,
              m3u8Url: result?.m3u8Url,
              baseUrl: result?.baseUrl
            });
            break;

          default:
            sendResponse({ success: false, error: '알 수 없는 메시지' });
        }
      } catch (error) {
        console.error('[숲토킹] 메시지 처리 오류:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  });

  // ===== 초기화 =====
  function init() {
    console.log('[숲토킹] Content Script 로드됨 - URL:', window.location.href);
    console.log('[숲토킹] 스트리머 ID:', extractStreamerIdFromUrl());
    console.log('[숲토킹] 방송 번호:', extractBroadNoFromUrl());

    // 페이지 로드 후 방송 정보 확인 (지연)
    setTimeout(async () => {
      const info = await getBroadcastInfo();
      if (info.success) {
        console.log('[숲토킹] 방송 정보:', info.data);
      } else {
        console.log('[숲토킹] 방송 정보 조회 실패:', info.error);
      }
    }, 1000);

    // 페이지 변경 감지 (SPA 대응)
    let lastUrl = window.location.href;
    const urlObserver = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        console.log('[숲토킹] URL 변경 감지:', lastUrl);
        // 캐시 무효화
        cachedStreamInfo = null;
        lastFetchTime = 0;
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
