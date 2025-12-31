# 숲토킹 v2.0 업그레이드 - Claude Code 개발 커맨드

## 📋 프로젝트 개요

**목표**: 숲토킹 Chrome 확장 프로그램에 **사이드패널 UI** 적용 및 **HLS 직접 다운로드 기능** 추가

**현재 위치**: `C:\Users\ADMIN\Claude\soop-streamer-alert`

**핵심 변경사항**:
1. 팝업 → **사이드패널** UI로 변경
2. 화면 녹화(getDisplayMedia) → **HLS .ts 직접 다운로드** 방식
3. 자동참여와 자동다운로드를 **독립적인 옵션**으로 분리
4. **백그라운드 다운로드** 지원 (탭 없이 다운로드 가능)

**인증 방식**: 사용자가 SOOP에 로그인한 세션/쿠키를 그대로 활용 (별도 로그인 불필요)

---

## 🎯 핵심 요구사항

### 1. UI 변경: 사이드패널
- 팝업 대신 **사이드패널** 사용 (항상 열어둘 수 있음)
- 팝업은 사이드패널 열기 버튼만 포함
- 디자인 시안: `design-mockup.html` 참고
- 사이드패널 너비: 380px

### 2. 다운로드 기능 (HLS 방식)
- **도메인 제한**: `*.sooplive.co.kr` 도메인에서만 다운로드 가능
- **HLS 직접 다운로드**: m3u8 플레이리스트에서 .ts 세그먼트 다운로드
- **실시간 저장**: .ts 파일들을 하나로 이어붙여 OPFS에 저장
- **원본 화질**: 브라우저 녹화가 아닌 원본 스트림 직접 다운로드
- **낮은 리소스**: CPU 인코딩 없이 단순 다운로드
- **자동/수동 모드**: 스트리머별 자동 다운로드 또는 버튼 클릭으로 수동 시작

### 3. 자동참여와 자동다운로드 분리
- **자동참여**: 방송 시작 시 탭 열기 (시청용)
- **자동다운로드**: 방송 시작 시 자동 녹화 시작
- 두 옵션은 **완전히 독립적**으로 동작
- 자동참여 OFF + 자동다운로드 ON = **백그라운드 다운로드** (탭 잠시 열었다 닫기)

### 4. 방송 감지 주기
- **자동참여 ON 또는 자동다운로드 ON**: 5초 주기 (빠른 감지 필요)
- **알림만 (둘 다 OFF)**: 30초 주기 (서버 부하 감소)

### 5. 기존 기능 유지
- 스트리머 모니터링
- 방송 알림/종료 알림
- 탭 자동 종료
- 다국어 지원 (한국어, 영어, 일본어, 중국어 간체/번체)

---

## 📊 옵션 조합별 동작

| 자동참여 | 자동다운로드 | 감지주기 | 동작 |
|---------|------------|---------|------|
| ❌ OFF | ❌ OFF | 30초 | 알림만 표시 |
| ✅ ON | ❌ OFF | 5초 | 탭 열림 (시청만) |
| ❌ OFF | ✅ ON | **5초** | **백그라운드 다운로드** ⭐ |
| ✅ ON | ✅ ON | 5초 | 탭 열림 + 다운로드 |

### 백그라운드 다운로드 흐름 (자동참여 OFF + 자동다운로드 ON)

```
방송 시작 감지 (5초 주기)
    ↓
백그라운드 탭 생성 (active: false)
    ↓
m3u8 URL 캡처 대기 (3~10초)
    ↓
Offscreen에 다운로드 시작 명령
    ↓
임시 탭 자동 닫힘
    ↓
Offscreen에서 백그라운드 다운로드 계속
(탭 없이도 다운로드 진행!)
```

---

## 📁 파일 구조

```
soop-streamer-alert/
├── manifest.json              # side_panel, offscreen, downloads 권한
├── sidepanel/                 # 신규: 사이드패널
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
├── offscreen/                 # 신규: HLS 다운로드 엔진
│   ├── offscreen.html
│   └── offscreen.js
├── content.js                 # 신규: SOOP 페이지 m3u8 캡처
├── background.js              # 수정: 다운로드 관리, 탭 관리, 감지 주기 분리
├── popup.html                 # 수정: 사이드패널 열기 버튼만
├── popup.js                   # 수정: 사이드패널 열기 로직
├── popup.css                  # 수정: 간단한 스타일
├── icons/
├── _locales/
│   ├── ko/messages.json       # 다운로드 관련 번역 추가
│   ├── en/messages.json
│   ├── ja/messages.json
│   ├── zh_CN/messages.json
│   └── zh_TW/messages.json
├── PRIVACY.md
├── README.md
└── CHANGELOG.md
```

---

## 🔧 상세 구현 명세

### Phase 1: manifest.json

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "version": "2.0.0",
  "description": "__MSG_extDescription__",
  "default_locale": "ko",
  
  "permissions": [
    "storage",
    "tabs",
    "alarms",
    "notifications",
    "offscreen",
    "downloads",
    "sidePanel"
  ],
  
  "host_permissions": [
    "https://*.sooplive.co.kr/*"
  ],
  
  "background": {
    "service_worker": "background.js"
  },
  
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  
  "content_scripts": [
    {
      "matches": ["https://play.sooplive.co.kr/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

---

### Phase 2: 팝업 (사이드패널 열기용)

#### popup.html
```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>숲토킹</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <div class="brand-logo">📺</div>
        <div class="brand-text">
          <h1 id="brandName">숲토킹</h1>
          <p class="tagline" data-i18n="tagline">SOOP 스트리머 알림 & 다운로드</p>
        </div>
      </div>
    </div>
    
    <div class="content">
      <button class="open-sidepanel-btn" id="openSidepanelBtn">
        <span class="icon">📋</span>
        <span data-i18n="openSidepanel">사이드패널 열기</span>
      </button>
      
      <p class="hint" data-i18n="sidepanelHint">
        사이드패널에서 모든 기능을 사용할 수 있습니다.
      </p>
    </div>
    
    <div class="footer">
      <span id="versionInfo">v2.0.0</span>
    </div>
  </div>
  
  <script src="popup.js"></script>
</body>
</html>
```

#### popup.js
```javascript
document.getElementById('openSidepanelBtn').addEventListener('click', async () => {
  // 현재 창에서 사이드패널 열기
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: currentWindow.id });
  window.close(); // 팝업 닫기
});

// 다국어 적용
document.querySelectorAll('[data-i18n]').forEach(el => {
  const key = el.getAttribute('data-i18n');
  const message = chrome.i18n.getMessage(key);
  if (message) el.textContent = message;
});

// 버전 정보
const manifest = chrome.runtime.getManifest();
document.getElementById('versionInfo').textContent = `v${manifest.version}`;

// 브랜드명 (언어별)
const brandName = chrome.i18n.getMessage('extName') || '숲토킹';
document.getElementById('brandName').textContent = brandName;
```

#### popup.css
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #0A0E14;
  color: #F5F7FA;
  width: 280px;
  padding: 16px;
}

.container {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header {
  display: flex;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-logo {
  width: 36px;
  height: 36px;
  background: linear-gradient(135deg, #00B4E5, #0099CC);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.brand-text h1 {
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(135deg, #fff, #00B4E5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-text .tagline {
  font-size: 10px;
  color: #5E6D82;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.open-sidepanel-btn {
  width: 100%;
  padding: 14px 20px;
  border-radius: 10px;
  border: none;
  background: linear-gradient(135deg, #00B4E5, #0099CC);
  color: white;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
  font-family: inherit;
}

.open-sidepanel-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 180, 229, 0.4);
}

.hint {
  font-size: 11px;
  color: #5E6D82;
  text-align: center;
  line-height: 1.5;
}

.footer {
  text-align: center;
  font-size: 10px;
  color: #5E6D82;
}
```

---

### Phase 3: Content Script (content.js)

```javascript
// content.js - SOOP 방송 페이지에서 m3u8 URL 캡처 및 방송 정보 추출
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
```

---

### Phase 4: Offscreen Document

#### offscreen/offscreen.html
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SOOPtalking HLS Downloader</title>
</head>
<body>
  <script src="offscreen.js"></script>
</body>
</html>
```

#### offscreen/offscreen.js
```javascript
// offscreen.js - HLS 스트림 다운로드 엔진
// .ts 세그먼트를 실시간으로 다운로드하여 하나의 파일로 저장

(function() {
  'use strict';

  const activeDownloads = new Map();

  // ===== 다운로드 세션 클래스 =====
  class DownloadSession {
    constructor(sessionId, options) {
      this.sessionId = sessionId;
      this.streamerId = options.streamerId;
      this.broadNo = options.broadNo;
      this.title = options.title;
      this.nickname = options.nickname;
      this.m3u8Url = options.m3u8Url;
      this.baseUrl = options.baseUrl || this.m3u8Url.substring(0, this.m3u8Url.lastIndexOf('/') + 1);
      this.quality = options.quality || 'original';
      this.isBackgroundDownload = options.isBackgroundDownload || false;
      
      this.isRunning = false;
      this.startTime = null;
      this.totalBytes = 0;
      this.segmentCount = 0;
      this.downloadedSegments = new Set();
      this.lastSequence = -1;
      this.noNewSegmentCount = 0;
      
      this.fileHandle = null;
      this.writable = null;
      this.fileName = null;
      
      this.pollingTimeoutId = null;
      this.pollInterval = 5000;
    }
  }

  // ===== 파일명 생성 =====
  function generateFileName(nickname, streamerId) {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
    const safeName = (nickname || streamerId || 'broadcast').replace(/[<>:"/\\|?*]/g, '_');
    return `${safeName}_${dateStr}_${timeStr}.ts`;
  }

  // ===== OPFS 초기화 =====
  async function initOPFS(session) {
    try {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('SOOPtalking', { create: true });
      
      session.fileName = generateFileName(session.nickname, session.streamerId);
      session.fileHandle = await folder.getFileHandle(session.fileName, { create: true });
      session.writable = await session.fileHandle.createWritable();
      
      console.log(`[HLS] OPFS 파일 생성: ${session.fileName}`);
      return true;
    } catch (error) {
      console.error('[HLS] OPFS 초기화 오류:', error);
      return false;
    }
  }

  // ===== m3u8 파싱 =====
  async function parseM3u8(m3u8Url, baseUrl) {
    try {
      const response = await fetch(m3u8Url, {
        credentials: 'include',
        headers: {
          'Origin': 'https://play.sooplive.co.kr',
          'Referer': 'https://play.sooplive.co.kr/'
        }
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const text = await response.text();
      const lines = text.split('\n');
      
      const segments = [];
      let currentSequence = 0;
      let targetDuration = 10;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
          currentSequence = parseInt(line.split(':')[1], 10);
        }
        
        if (line.startsWith('#EXT-X-TARGETDURATION:')) {
          targetDuration = parseInt(line.split(':')[1], 10);
        }
        
        if (line.startsWith('#EXTINF:')) {
          const duration = parseFloat(line.split(':')[1].split(',')[0]);
          const segmentUrl = lines[i + 1]?.trim();
          
          if (segmentUrl && !segmentUrl.startsWith('#')) {
            const absoluteUrl = segmentUrl.startsWith('http') 
              ? segmentUrl 
              : new URL(segmentUrl, baseUrl).href;
            
            segments.push({
              sequence: currentSequence,
              duration,
              url: absoluteUrl
            });
            currentSequence++;
          }
        }
        
        // 방송 종료 태그 확인
        if (line === '#EXT-X-ENDLIST') {
          return { success: true, segments, targetDuration, ended: true };
        }
      }
      
      return { success: true, segments, targetDuration, ended: false };
    } catch (error) {
      console.error('[HLS] m3u8 파싱 오류:', error);
      return { success: false, error: error.message };
    }
  }

  // ===== .ts 세그먼트 다운로드 =====
  async function downloadSegment(session, segment) {
    if (session.downloadedSegments.has(segment.sequence)) {
      return { success: true, skipped: true };
    }
    
    try {
      const response = await fetch(segment.url, {
        credentials: 'include',
        headers: {
          'Origin': 'https://play.sooplive.co.kr',
          'Referer': 'https://play.sooplive.co.kr/'
        }
      });
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      await session.writable.write(bytes);
      
      session.downloadedSegments.add(segment.sequence);
      session.totalBytes += bytes.length;
      session.segmentCount++;
      session.lastSequence = segment.sequence;
      session.noNewSegmentCount = 0;
      
      // 진행 상태 전송
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_PROGRESS',
        sessionId: session.sessionId,
        data: {
          totalBytes: session.totalBytes,
          segmentCount: session.segmentCount,
          elapsedTime: Date.now() - session.startTime,
          lastSequence: segment.sequence,
          isBackgroundDownload: session.isBackgroundDownload
        }
      }).catch(() => {});
      
      return { success: true, bytes: bytes.length };
    } catch (error) {
      console.error(`[HLS] 세그먼트 #${segment.sequence} 다운로드 오류:`, error);
      return { success: false, error: error.message };
    }
  }

  // ===== 다운로드 폴링 루프 =====
  async function pollAndDownload(session) {
    if (!session.isRunning) return;
    
    const result = await parseM3u8(session.m3u8Url, session.baseUrl);
    
    if (result.success) {
      let newSegments = 0;
      
      for (const segment of result.segments) {
        if (segment.sequence > session.lastSequence) {
          const dlResult = await downloadSegment(session, segment);
          if (dlResult.success && !dlResult.skipped) {
            newSegments++;
          }
        }
      }
      
      if (newSegments === 0) {
        session.noNewSegmentCount++;
      }
      
      // 방송 종료 감지: 60초간 새 세그먼트 없음 또는 ENDLIST 태그
      if (result.ended || session.noNewSegmentCount >= 12) {
        console.log(`[HLS] 방송 종료 감지: ${session.streamerId}`);
        await stopDownload(session.sessionId, true);
        return;
      }
    }
    
    // 다음 폴링
    if (session.isRunning) {
      session.pollingTimeoutId = setTimeout(
        () => pollAndDownload(session), 
        session.pollInterval
      );
    }
  }

  // ===== 다운로드 시작 =====
  async function startDownload(options) {
    const sessionId = `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session = new DownloadSession(sessionId, options);
    
    const opfsReady = await initOPFS(session);
    if (!opfsReady) {
      return { success: false, error: 'OPFS 초기화 실패' };
    }
    
    activeDownloads.set(sessionId, session);
    session.isRunning = true;
    session.startTime = Date.now();
    
    // 폴링 시작
    pollAndDownload(session);
    
    console.log(`[HLS] 다운로드 시작: ${session.fileName} (백그라운드: ${session.isBackgroundDownload})`);
    
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_STARTED',
      sessionId,
      data: {
        streamerId: session.streamerId,
        nickname: session.nickname,
        title: session.title,
        fileName: session.fileName,
        isBackgroundDownload: session.isBackgroundDownload
      }
    }).catch(() => {});
    
    return { success: true, sessionId, fileName: session.fileName };
  }

  // ===== 다운로드 중지 =====
  async function stopDownload(sessionId, isAutoStop = false) {
    const session = activeDownloads.get(sessionId);
    if (!session) {
      return { success: false, error: '세션을 찾을 수 없습니다.' };
    }
    
    session.isRunning = false;
    if (session.pollingTimeoutId) {
      clearTimeout(session.pollingTimeoutId);
    }
    
    try {
      if (session.writable) {
        await session.writable.close();
      }
      
      // OPFS에서 파일 읽어서 다운로드 트리거 요청
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_COMPLETED',
        sessionId,
        data: {
          fileName: session.fileName,
          totalBytes: session.totalBytes,
          segmentCount: session.segmentCount,
          duration: Date.now() - session.startTime,
          isAutoStop,
          isBackgroundDownload: session.isBackgroundDownload
        }
      }).catch(() => {});
      
      activeDownloads.delete(sessionId);
      
      return { 
        success: true, 
        fileName: session.fileName, 
        totalBytes: session.totalBytes 
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== 파일 다운로드 트리거 =====
  async function triggerFileDownload(fileName) {
    try {
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle('SOOPtalking');
      const fileHandle = await folder.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      
      const blob = new Blob([await file.arrayBuffer()], { type: 'video/mp2t' });
      const url = URL.createObjectURL(blob);
      
      chrome.runtime.sendMessage({
        type: 'TRIGGER_BROWSER_DOWNLOAD',
        data: { url, fileName }
      }).catch(() => {});
      
      // 잠시 후 OPFS에서 파일 삭제 (공간 확보)
      setTimeout(async () => {
        try {
          await folder.removeEntry(fileName);
          console.log(`[HLS] OPFS 파일 삭제: ${fileName}`);
        } catch (e) {}
      }, 5000);
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== 저장 공간 확인 =====
  async function getStorageInfo() {
    try {
      const estimate = await navigator.storage.estimate();
      return {
        success: true,
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
        usagePercent: estimate.quota ? (estimate.usage / estimate.quota * 100) : 0
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ===== 활성 다운로드 목록 =====
  function getAllDownloads() {
    const downloads = [];
    for (const [sessionId, session] of activeDownloads) {
      downloads.push({
        sessionId,
        streamerId: session.streamerId,
        nickname: session.nickname,
        title: session.title,
        isRunning: session.isRunning,
        totalBytes: session.totalBytes,
        segmentCount: session.segmentCount,
        elapsedTime: session.startTime ? Date.now() - session.startTime : 0,
        fileName: session.fileName,
        isBackgroundDownload: session.isBackgroundDownload
      });
    }
    return downloads;
  }

  // ===== 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case 'START_DOWNLOAD':
          const startResult = await startDownload(message.options);
          sendResponse(startResult);
          break;
          
        case 'STOP_DOWNLOAD':
          const stopResult = await stopDownload(message.sessionId);
          sendResponse(stopResult);
          break;
          
        case 'GET_ALL_DOWNLOADS':
          sendResponse({ success: true, data: getAllDownloads() });
          break;
          
        case 'TRIGGER_FILE_DOWNLOAD':
          const triggerResult = await triggerFileDownload(message.fileName);
          sendResponse(triggerResult);
          break;
          
        case 'GET_STORAGE_INFO':
          const storageInfo = await getStorageInfo();
          sendResponse(storageInfo);
          break;
          
        default:
          sendResponse({ success: false, error: '알 수 없는 메시지' });
      }
    })();
    return true;
  });

  console.log('[HLS] Offscreen 다운로드 엔진 로드됨');
})();
```

---

### Phase 5: Background.js 주요 변경사항

```javascript
// ===== 상수 =====
const FAST_CHECK_INTERVAL = 5000;   // 자동참여/자동다운로드 스트리머 (5초)
const SLOW_CHECK_INTERVAL = 30000;  // 알림만 스트리머 (30초)
const M3U8_WAIT_TIMEOUT = 15000;    // m3u8 캡처 대기 시간 (15초)

// ===== Offscreen Document 관리 =====
let offscreenCreated = false;

async function ensureOffscreenDocument() {
  if (offscreenCreated) return true;
  
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    if (contexts.length > 0) {
      offscreenCreated = true;
      return true;
    }
    
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'HLS stream download'
    });
    
    offscreenCreated = true;
    return true;
  } catch (error) {
    if (error.message?.includes('single offscreen')) {
      offscreenCreated = true;
      return true;
    }
    console.error('[숲토킹] Offscreen 생성 오류:', error);
    return false;
  }
}

// ===== 스트리머 그룹 분류 =====
function categorizeStreamers() {
  const fastCheck = [];  // 5초 주기
  const slowCheck = [];  // 30초 주기
  
  for (const streamer of state.favoriteStreamers) {
    const settings = streamer.settings || {};
    
    // 자동참여 OR 자동다운로드가 ON이면 5초 주기
    if (settings.autoJoin || settings.autoDownload) {
      fastCheck.push(streamer);
    } else {
      // 둘 다 OFF면 30초 주기 (알림만)
      slowCheck.push(streamer);
    }
  }
  
  return { fastCheck, slowCheck };
}

// ===== 방송 시작 처리 =====
async function handleBroadcastStart(streamer, broadcastInfo) {
  const settings = streamer.settings || {};
  const { autoJoin, autoDownload, notification } = settings;
  
  console.log(`[숲토킹] ${streamer.id} 방송 시작 - 자동참여: ${autoJoin}, 자동다운로드: ${autoDownload}`);
  
  // 알림 표시
  if (notification) {
    await showBroadcastNotification(streamer.id, broadcastInfo);
  }
  
  // 케이스별 처리
  if (autoJoin && autoDownload) {
    // 탭 열기 + 다운로드
    const tab = await openBroadcastTab(streamer.id, broadcastInfo.broadNo, true);
    if (tab) {
      await waitAndStartDownload(tab.id, streamer, broadcastInfo);
    }
    
  } else if (autoJoin && !autoDownload) {
    // 탭만 열기
    await openBroadcastTab(streamer.id, broadcastInfo.broadNo, true);
    
  } else if (!autoJoin && autoDownload) {
    // ⭐ 백그라운드 다운로드
    await startBackgroundDownload(streamer, broadcastInfo);
    
  }
  // else: 알림만 (이미 위에서 처리)
}

// ===== 백그라운드 다운로드 (자동참여 OFF + 자동다운로드 ON) =====
async function startBackgroundDownload(streamer, broadcastInfo) {
  console.log(`[숲토킹] ${streamer.id} 백그라운드 다운로드 시작`);
  
  // 1. 백그라운드 탭 열기
  const tab = await chrome.tabs.create({
    url: `https://play.sooplive.co.kr/${streamer.id}/${broadcastInfo.broadNo}`,
    active: false  // 백그라운드!
  });
  
  console.log(`[숲토킹] 임시 탭 생성: ${tab.id}`);
  
  try {
    // 2. m3u8 URL 캡처 대기
    const m3u8Data = await waitForM3u8(tab.id, M3U8_WAIT_TIMEOUT);
    
    if (!m3u8Data) {
      throw new Error('m3u8 URL 캡처 실패');
    }
    
    // 3. Offscreen에 다운로드 시작
    await ensureOffscreenDocument();
    
    const result = await chrome.runtime.sendMessage({
      type: 'START_DOWNLOAD',
      options: {
        streamerId: streamer.id,
        broadNo: broadcastInfo.broadNo,
        nickname: broadcastInfo.nickname || streamer.nickname,
        title: broadcastInfo.title,
        m3u8Url: m3u8Data.m3u8Url,
        baseUrl: m3u8Data.baseUrl,
        quality: streamer.settings?.downloadQuality || 'original',
        isBackgroundDownload: true
      }
    });
    
    if (result.success) {
      console.log(`[숲토킹] 백그라운드 다운로드 시작: ${result.sessionId}`);
      
      // 4. 임시 탭 닫기
      await chrome.tabs.remove(tab.id);
      console.log(`[숲토킹] 임시 탭 닫힘`);
      
      // 다운로드 시작 알림
      await showDownloadStartNotification(streamer, broadcastInfo);
    } else {
      throw new Error(result.error);
    }
    
  } catch (error) {
    console.error(`[숲토킹] 백그라운드 다운로드 오류:`, error);
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

// ===== m3u8 URL 캡처 대기 =====
async function waitForM3u8(tabId, timeout = 15000) {
  const startTime = Date.now();
  const pollInterval = 1000;
  
  while (Date.now() - startTime < timeout) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_M3U8_URL' });
      if (response.success && response.m3u8Url) {
        return response;
      }
    } catch (e) {
      // Content script 아직 로드 안됨
    }
    await delay(pollInterval);
  }
  
  return null;
}

// ===== 탭에서 다운로드 시작 =====
async function waitAndStartDownload(tabId, streamer, broadcastInfo) {
  const m3u8Data = await waitForM3u8(tabId, M3U8_WAIT_TIMEOUT);
  
  if (!m3u8Data) {
    console.error(`[숲토킹] ${streamer.id} m3u8 캡처 실패`);
    return;
  }
  
  await ensureOffscreenDocument();
  
  await chrome.runtime.sendMessage({
    type: 'START_DOWNLOAD',
    options: {
      streamerId: streamer.id,
      broadNo: broadcastInfo.broadNo,
      nickname: broadcastInfo.nickname || streamer.nickname,
      title: broadcastInfo.title,
      m3u8Url: m3u8Data.m3u8Url,
      baseUrl: m3u8Data.baseUrl,
      quality: streamer.settings?.downloadQuality || 'original',
      isBackgroundDownload: false
    }
  });
}

// ===== 브라우저 다운로드 트리거 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRIGGER_BROWSER_DOWNLOAD') {
    chrome.downloads.download({
      url: message.data.url,
      filename: `SOOPtalking/${message.data.fileName}`,
      saveAs: false
    }).then(downloadId => {
      console.log(`[숲토킹] 다운로드 시작: ${message.data.fileName}`);
    }).catch(error => {
      console.error('[숲토킹] 다운로드 오류:', error);
    });
  }
  
  // 다른 메시지 처리...
});

// ===== 모니터링 루프 =====
async function runMonitoringLoop() {
  if (!state.isMonitoring) return;
  
  const { fastCheck, slowCheck } = categorizeStreamers();
  
  // 빠른 체크 (5초) - 자동참여/자동다운로드 스트리머
  if (fastCheck.length > 0) {
    for (const streamer of fastCheck) {
      await checkAndHandleBroadcast(streamer);
      await delay(300);
    }
  }
  
  // 다음 빠른 체크 예약
  setTimeout(runMonitoringLoop, FAST_CHECK_INTERVAL);
}

async function runSlowMonitoringLoop() {
  if (!state.isMonitoring) return;
  
  const { slowCheck } = categorizeStreamers();
  
  // 느린 체크 (30초) - 알림만 스트리머
  if (slowCheck.length > 0) {
    for (const streamer of slowCheck) {
      await checkAndHandleBroadcast(streamer);
      await delay(300);
    }
  }
  
  // 다음 느린 체크 예약
  setTimeout(runSlowMonitoringLoop, SLOW_CHECK_INTERVAL);
}
```

---

### Phase 6: 사이드패널

사이드패널 구현은 `design-mockup.html` 파일을 참고하세요.

---

## 📋 데이터 구조

### 스트리머 설정

```javascript
const streamer = {
  id: 'streamer123',
  nickname: '이지각',
  addedAt: Date.now(),
  
  settings: {
    monitoring: true,           // 모니터링 (방송 상태 확인)
    autoJoin: true,             // 자동참여 (탭 열기)
    autoDownload: false,        // 자동다운로드 (녹화)
    notification: true,         // 방송 알림
    endNotification: false,     // 종료 알림
    downloadQuality: 'original' // 다운로드 화질
  }
};
```

### 다운로드 세션

```javascript
const downloadSession = {
  sessionId: 'dl_xxx',
  streamerId: 'streamer123',
  nickname: '이지각',
  title: '오늘의 방송',
  
  isBackgroundDownload: true,  // 탭 없이 다운로드
  tabId: null,                 // 연결된 탭 (있으면)
  
  status: 'downloading',       // downloading, completed, error
  startTime: Date.now(),
  totalBytes: 0,
  segmentCount: 0,
  fileName: '이지각_20250130_103000.ts'
};
```

---

## 🧪 테스트 체크리스트

### 기본 기능
- [ ] 사이드패널 열기/닫기
- [ ] 팝업에서 사이드패널 열기 버튼 동작
- [ ] 스트리머 추가/삭제
- [ ] 모니터링 ON/OFF

### 자동참여
- [ ] 자동참여 ON → 방송 시작 시 탭 열림
- [ ] 자동참여 OFF → 탭 안 열림
- [ ] SOOP 4개 탭 제한 동작

### 자동다운로드
- [ ] 자동참여 ON + 자동다운로드 ON → 탭 + 다운로드
- [ ] 자동참여 OFF + 자동다운로드 ON → 백그라운드 다운로드
- [ ] 사이드패널 닫아도 다운로드 계속
- [ ] 방송 종료 시 자동 저장

### 수동 다운로드
- [ ] "지금부터 다운로드" 버튼 동작
- [ ] 다운로드 중지 버튼 동작
- [ ] 진행 상태 표시 (시간, 용량)

### 감지 주기
- [ ] 자동참여/자동다운로드 ON → 5초 주기
- [ ] 둘 다 OFF → 30초 주기

### 저장
- [ ] .ts 파일 다운로드 폴더에 저장
- [ ] 파일명 형식: 닉네임_날짜_시간.ts
- [ ] VLC에서 재생 확인

---

## 📚 참고 자료

- SOOP API: `https://live.sooplive.co.kr/afreeca/player_live_api.php`
- HLS 사양: RFC 8216
- Chrome Side Panel API: https://developer.chrome.com/docs/extensions/reference/sidePanel/
- Chrome Offscreen API: https://developer.chrome.com/docs/extensions/reference/offscreen/

---

**버전**: 2.0.0  
**작성일**: 2025-01-30  
**작성자**: Claude Desktop → Claude Code
