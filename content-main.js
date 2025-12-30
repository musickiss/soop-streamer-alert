// ===== 숲토킹 v2.1 - Content Script (MAIN World) =====
// 페이지 컨텍스트에서 직접 실행되어 XHR/Fetch/HLS.js 후킹
// chrome API 사용 불가, postMessage로 content.js에 전달

(function() {
  'use strict';

  // 이미 주입됐으면 스킵
  if (window.__soopTalkingMainHooked) return;
  window.__soopTalkingMainHooked = true;

  console.log('[숲토킹 Main] 페이지 컨텍스트 후킹 시작');

  // 캡처된 URL 저장 (중복 방지)
  const capturedUrls = new Set();

  // m3u8 URL 캡처 시 content.js로 전달
  function notifyCapture(url, source) {
    if (!url || typeof url !== 'string') return;

    // m3u8 URL인지 확인
    if (!url.includes('.m3u8') && !url.includes('playlist')) return;

    // 중복 체크
    if (capturedUrls.has(url)) return;
    capturedUrls.add(url);

    console.log('[숲토킹 Main] ✅ m3u8 캡처:', url.substring(0, 80), '(via', source + ')');

    // content.js로 postMessage 전송
    window.postMessage({
      type: 'SOOPTALKING_M3U8_CAPTURED',
      url: url,
      source: source,
      timestamp: Date.now()
    }, '*');
  }

  // ===== XMLHttpRequest 후킹 =====
  const originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    if (url && typeof url === 'string') {
      notifyCapture(url, 'xhr');
    }
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  // ===== Fetch 후킹 =====
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    let url = '';

    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
    } else if (input && input.toString) {
      url = input.toString();
    }

    notifyCapture(url, 'fetch');

    return originalFetch.apply(this, arguments);
  };

  // ===== HLS.js 후킹 =====
  function hookHls() {
    if (window.Hls && !window.Hls.__soopHooked) {
      window.Hls.__soopHooked = true;

      const origLoadSource = window.Hls.prototype.loadSource;
      if (origLoadSource) {
        window.Hls.prototype.loadSource = function(src) {
          console.log('[숲토킹 Main] HLS.js loadSource 호출:', src);
          notifyCapture(src, 'hls.js');
          return origLoadSource.apply(this, arguments);
        };
      }

      console.log('[숲토킹 Main] HLS.js 후킹 완료');
      return true;
    }
    return false;
  }

  // 주기적으로 HLS.js 체크 (로드 전일 수 있음)
  const hlsChecker = setInterval(() => {
    if (hookHls()) {
      clearInterval(hlsChecker);
    }
  }, 200);

  // 30초 후 체크 중지
  setTimeout(() => clearInterval(hlsChecker), 30000);

  // ===== SOOP 플레이어 객체에서 직접 추출 =====
  function extractFromPlayer() {
    try {
      // 가능한 플레이어 객체 위치들
      const possiblePlayers = [
        window.player,
        window.PLAYER,
        window.livePlayer,
        window.soopPlayer,
        window.hlsPlayer,
        window.afreecaPlayer,
      ];

      for (const p of possiblePlayers) {
        if (!p) continue;

        // url 속성
        if (p.url && typeof p.url === 'string') {
          notifyCapture(p.url, 'player.url');
        }

        // config.url
        if (p.config?.url) {
          notifyCapture(p.config.url, 'player.config');
        }

        // levels (HLS.js)
        if (p.levelController?.levels) {
          for (const level of p.levelController.levels) {
            if (level.url) {
              notifyCapture(level.url, 'player.level');
            }
          }
        }

        // _url (내부 속성)
        if (p._url) {
          notifyCapture(p._url, 'player._url');
        }
      }

      // Video 요소에서 HLS 인스턴스 추출
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (video._hls?.url) {
          notifyCapture(video._hls.url, 'video._hls');
        }
        if (video.src && video.src.includes('.m3u8')) {
          notifyCapture(video.src, 'video.src');
        }
      }
    } catch (e) {
      // 조용히 실패
    }
  }

  // 주기적으로 플레이어에서 추출 시도
  setInterval(extractFromPlayer, 2000);

  // ===== Performance API로 이미 완료된 요청 캡처 =====
  function checkPerformanceEntries() {
    try {
      const entries = performance.getEntriesByType('resource');
      for (const entry of entries) {
        if (entry.name) {
          notifyCapture(entry.name, 'performance');
        }
      }
    } catch (e) {
      // 조용히 실패
    }
  }

  // 주기적으로 Performance 체크
  setInterval(checkPerformanceEntries, 1000);

  // 초기 체크
  setTimeout(checkPerformanceEntries, 500);

  // ===== MediaSource 후킹 (선택적) =====
  try {
    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function(mimeType) {
      console.log('[숲토킹 Main] MediaSource.addSourceBuffer:', mimeType);
      return originalAddSourceBuffer.apply(this, arguments);
    };
  } catch (e) {}

  console.log('[숲토킹 Main] 페이지 컨텍스트 후킹 완료');

  // ===== 자동 m3u8 URL 탐색 =====
  async function probeM3u8Urls() {
    // URL에서 streamerId와 broadNo 추출
    const pathMatch = window.location.pathname.match(/^\/([^\/]+)(?:\/(\d+))?/);
    if (!pathMatch) {
      console.log('[숲토킹 Main] URL에서 스트리머 정보를 찾을 수 없음');
      return;
    }

    const streamerId = pathMatch[1];
    const broadNo = pathMatch[2];

    if (!streamerId) {
      console.log('[숲토킹 Main] 스트리머 ID 없음');
      return;
    }

    console.log('[숲토킹 Main] 자동 m3u8 탐색 시작:', streamerId, broadNo);

    // broadNo가 없으면 API에서 가져오기 시도
    let actualBroadNo = broadNo;
    if (!actualBroadNo) {
      try {
        const apiResponse = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `bid=${streamerId}`,
          credentials: 'include'
        });
        const apiData = await apiResponse.json();
        if (apiData.CHANNEL && apiData.CHANNEL.BNO) {
          actualBroadNo = apiData.CHANNEL.BNO;
          console.log('[숲토킹 Main] API에서 broadNo 획득:', actualBroadNo);
        }
      } catch (e) {
        console.log('[숲토킹 Main] API 호출 실패:', e.message);
      }
    }

    if (!actualBroadNo) {
      console.log('[숲토킹 Main] broadNo를 찾을 수 없음');
      return;
    }

    // 테스트할 URL 패턴들
    const testUrls = [
      `https://live-gs.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
      `https://live-avs.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
      `https://live-global.afreecatv.com/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
      `https://live-global.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
      `https://live-kt.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
      `https://live-lg.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`
    ];

    // 각 URL 테스트
    for (const url of testUrls) {
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (response.ok) {
          const text = await response.text();
          if (text.includes('#EXTM3U')) {
            console.log('[숲토킹 Main] ✅ m3u8 URL 발견:', url);
            notifyCapture(url, 'probe');
            return; // 하나 찾으면 종료
          }
        }
      } catch (e) {
        // 실패하면 다음 URL 시도
      }
    }

    console.log('[숲토킹 Main] ❌ 모든 m3u8 URL 테스트 실패');
  }

  // 페이지 로드 완료 후 자동 탐색 시작
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(probeM3u8Urls, 2000); // 2초 후 시작
    });
  } else {
    setTimeout(probeM3u8Urls, 2000);
  }

  // 주기적으로 재시도 (10초마다, 최대 3회)
  let probeRetryCount = 0;
  const probeInterval = setInterval(() => {
    probeRetryCount++;
    if (probeRetryCount >= 3 || capturedUrls.size > 0) {
      clearInterval(probeInterval);
      return;
    }
    console.log('[숲토킹 Main] m3u8 재탐색 시도 #' + probeRetryCount);
    probeM3u8Urls();
  }, 10000);
})();
