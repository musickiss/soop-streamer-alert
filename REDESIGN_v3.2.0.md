# 🔧 숲토킹 v3.2.0 재설계 명세서
## video.captureStream() 기반 다이얼로그 없는 녹화

---

## 📋 변경 배경

### 문제점
- `chrome.tabCapture.getMediaStreamId()`는 Side Panel에서 activeTab 권한 문제로 작동 불가
- `getDisplayMedia()`는 매번 화면 선택 다이얼로그 필요

### 해결책
- v2.5에서 검증된 `video.captureStream()` 방식 채택
- SOOP 페이지의 `<video>` 요소를 직접 캡처
- **다이얼로그 없이 즉시 녹화 시작**

---

## 🏗️ 아키텍처 비교

### v3.1.x (실패)
```
Side Panel → Background → Offscreen (tabCapture) ❌
```

### v3.2.0 (새 설계)
```
Side Panel (UI)
    ↕ 메시지
Background Service Worker (모니터링, 다운로드)
    ↕ 메시지
Content Script [ISOLATED] (메시지 브릿지)
    ↕ window.postMessage
Content Script [MAIN] (video.captureStream 녹화) ✅
```

---

## 📁 파일 구조

```
soop-streamer-alert/
├── manifest.json          (수정)
├── background.js          (수정)
├── content.js             (수정 - 메시지 브릿지)
├── content-main.js        (신규 - MAIN world 녹화)
├── offscreen.html         (삭제)
├── offscreen.js           (삭제)
└── sidepanel/
    └── sidepanel.js       (수정)
```

---

## 📝 파일별 수정 내용

---

### 1️⃣ manifest.json

```json
{
  "manifest_version": 3,
  "name": "__MSG_extName__",
  "version": "3.2.0",
  "description": "__MSG_extDescription__",
  "default_locale": "ko",

  "permissions": [
    "storage",
    "tabs",
    "alarms",
    "notifications",
    "sidePanel",
    "downloads",
    "scripting"
  ],

  "host_permissions": [
    "*://*.sooplive.co.kr/*",
    "*://*.afreecatv.com/*"
  ],

  "background": {
    "service_worker": "background.js",
    "type": "module"
  },

  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },

  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "content_scripts": [
    {
      "matches": ["https://play.sooplive.co.kr/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://play.sooplive.co.kr/*"],
      "js": ["content-main.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

**변경사항:**
- version: 3.2.0
- `tabCapture`, `activeTab`, `offscreen` 권한 제거
- `scripting` 권한 추가 (동적 스크립트 주입용)
- content_scripts에 `content-main.js` 추가 (MAIN world)

---

### 2️⃣ content-main.js (신규 파일)

```javascript
// ===== 숲토킹 v3.2.0 - MAIN World 녹화 모듈 =====
// video.captureStream() 기반 다이얼로그 없는 녹화

(function() {
  'use strict';
  
  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 4000000,    // 4 Mbps
    AUDIO_BITRATE: 128000,     // 128 Kbps
    TIMESLICE: 5000,           // 5초마다 데이터 청크
    PROGRESS_INTERVAL: 5000    // 5초마다 진행 상황 보고
  };

  // ===== 유틸리티 =====
  function sanitizeFilename(str) {
    if (!str) return 'unknown';
    return str
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  function getStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : 'unknown';
  }

  function generateTimestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  }

  // ===== 코덱 선택 =====
  function getBestMimeType() {
    const codecs = [
      { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },
      { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
      { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
      { mime: 'video/webm', name: 'WebM' }
    ];

    for (const { mime, name } of codecs) {
      if (MediaRecorder.isTypeSupported(mime)) {
        console.log('[숲토킹 Recorder] 코덱 선택:', name);
        return mime;
      }
    }
    return 'video/webm';
  }

  // ===== 녹화 모듈 =====
  window.__soopRecorder = {
    // 상태
    isRecording: false,
    mediaRecorder: null,
    recordingStream: null,
    progressInterval: null,
    
    // 데이터
    recordedChunks: [],
    totalBytes: 0,
    streamerId: null,
    nickname: null,
    recordingId: null,
    startTime: null,
    mimeType: null,

    // ===== 녹화 시작 =====
    startRecording(params = {}) {
      if (this.isRecording) {
        return { success: false, error: '이미 녹화 중입니다.' };
      }

      // 비디오 요소 찾기
      const video = document.querySelector('video');
      if (!video) {
        return { success: false, error: '비디오 요소를 찾을 수 없습니다.' };
      }

      if (video.paused || video.ended) {
        return { success: false, error: '비디오가 재생 중이 아닙니다.' };
      }

      try {
        // 스트리머 정보
        this.streamerId = params.streamerId ? sanitizeFilename(params.streamerId) : sanitizeFilename(getStreamerIdFromUrl());
        this.nickname = params.nickname ? sanitizeFilename(params.nickname) : this.streamerId;
        this.recordingId = `${this.streamerId}_${generateTimestamp()}`;

        // 초기화
        this.recordedChunks = [];
        this.totalBytes = 0;
        this.startTime = Date.now();

        // ⭐ video.captureStream()으로 스트림 획득 (다이얼로그 없음!)
        this.recordingStream = video.captureStream();
        console.log('[숲토킹 Recorder] 스트림 획득 성공');

        // 코덱 선택
        this.mimeType = getBestMimeType();

        // MediaRecorder 생성
        this.mediaRecorder = new MediaRecorder(this.recordingStream, {
          mimeType: this.mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 데이터 수신 핸들러
        this.mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            this.recordedChunks.push(e.data);
            this.totalBytes += e.data.size;
          }
        };

        // 녹화 중지 핸들러
        this.mediaRecorder.onstop = () => {
          console.log('[숲토킹 Recorder] 녹화 중지됨');
          this.clearProgressInterval();
          this.saveRecording();
        };

        // 에러 핸들러
        this.mediaRecorder.onerror = (e) => {
          console.error('[숲토킹 Recorder] 에러:', e.error);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: e.error?.message || '녹화 에러'
          }, '*');
          this.stopRecording();
        };

        // 녹화 시작
        this.mediaRecorder.start(CONFIG.TIMESLICE);
        this.isRecording = true;

        // 진행 상황 보고 시작
        this.startProgressInterval();

        console.log('[숲토킹 Recorder] ▶️ 녹화 시작:', this.streamerId);

        // 시작 알림
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STARTED',
          streamerId: this.streamerId,
          nickname: this.nickname,
          recordingId: this.recordingId
        }, '*');

        return { 
          success: true, 
          streamerId: this.streamerId,
          nickname: this.nickname,
          recordingId: this.recordingId 
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 시작 실패:', error);
        this.cleanup();
        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 중지 =====
    stopRecording() {
      if (!this.isRecording) {
        return { success: false, error: '녹화 중이 아닙니다.' };
      }

      console.log('[숲토킹 Recorder] ⏹️ 녹화 중지 요청');

      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
          this.mediaRecorder.stop();
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 파일 저장 =====
    saveRecording() {
      const duration = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

      if (this.recordedChunks.length === 0) {
        console.warn('[숲토킹 Recorder] 저장할 데이터 없음');
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STOPPED',
          streamerId: this.streamerId,
          nickname: this.nickname,
          totalBytes: 0,
          duration: duration,
          saved: false
        }, '*');
        this.cleanup();
        return;
      }

      // Blob 생성
      const blob = new Blob(this.recordedChunks, { type: this.mimeType });
      const fileName = `soop_${sanitizeFilename(this.recordingId)}.webm`;
      const blobUrl = URL.createObjectURL(blob);

      console.log('[숲토킹 Recorder] 파일 저장:', fileName, blob.size, 'bytes');

      // Content Script (ISOLATED)를 통해 Background로 전달
      window.postMessage({
        type: 'SOOPTALKING_SAVE_RECORDING',
        fileName: fileName,
        size: blob.size,
        blobUrl: blobUrl,
        streamerId: this.streamerId,
        nickname: this.nickname,
        recordingId: this.recordingId,
        duration: duration
      }, '*');

      window.postMessage({
        type: 'SOOPTALKING_RECORDING_STOPPED',
        streamerId: this.streamerId,
        nickname: this.nickname,
        totalBytes: blob.size,
        duration: duration,
        saved: true
      }, '*');

      this.cleanup();
    },

    // ===== 진행 상황 보고 =====
    startProgressInterval() {
      this.clearProgressInterval();
      this.progressInterval = setInterval(() => {
        if (this.isRecording) {
          const elapsedTime = Math.floor((Date.now() - this.startTime) / 1000);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_PROGRESS',
            streamerId: this.streamerId,
            nickname: this.nickname,
            totalBytes: this.totalBytes,
            elapsedTime: elapsedTime
          }, '*');
        }
      }, CONFIG.PROGRESS_INTERVAL);
    },

    clearProgressInterval() {
      if (this.progressInterval) {
        clearInterval(this.progressInterval);
        this.progressInterval = null;
      }
    },

    // ===== 정리 =====
    cleanup() {
      this.clearProgressInterval();
      
      if (this.recordingStream) {
        this.recordingStream.getTracks().forEach(track => track.stop());
        this.recordingStream = null;
      }
      
      this.mediaRecorder = null;
      this.recordedChunks = [];
      this.totalBytes = 0;
      this.isRecording = false;
    },

    // ===== 상태 조회 =====
    getStatus() {
      return {
        isRecording: this.isRecording,
        streamerId: this.streamerId,
        nickname: this.nickname,
        totalBytes: this.totalBytes,
        elapsedTime: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
      };
    }
  };

  // ===== 메시지 리스너 =====
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = e.data;
    let result;

    switch (command) {
      case 'START_RECORDING':
        result = window.__soopRecorder.startRecording(params);
        break;
      case 'STOP_RECORDING':
        result = window.__soopRecorder.stopRecording();
        break;
      case 'GET_STATUS':
        result = window.__soopRecorder.getStatus();
        break;
      default:
        result = { success: false, error: '알 수 없는 명령' };
    }

    // 결과 전송
    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESULT',
      command: command,
      result: result
    }, '*');
  });

  console.log('[숲토킹 Recorder] ✅ v3.2.0 MAIN world 모듈 로드됨');
})();
```

---

### 3️⃣ content.js (수정)

```javascript
// ===== 숲토킹 v3.2.0 - Content Script (ISOLATED) =====
// MAIN world와 Background 사이의 메시지 브릿지

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

  function extractBroadNoFromUrl() {
    const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  // ===== MAIN world → Background 메시지 브릿지 =====
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;

    const { type, ...data } = e.data;

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

      case 'SOOPTALKING_RECORDER_RESULT':
        // 녹화 명령 결과 - 필요시 처리
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
          broadNo: extractBroadNoFromUrl(),
          url: window.location.href,
          title: document.title
        });
        return true;

      case 'START_RECORDING':
        // MAIN world로 명령 전달
        window.postMessage({
          type: 'SOOPTALKING_RECORDER_COMMAND',
          command: 'START_RECORDING',
          params: {
            streamerId: message.streamerId,
            nickname: message.nickname
          }
        }, '*');
        
        // 결과는 비동기로 전달되므로 일단 성공 응답
        sendResponse({ success: true, message: '녹화 명령 전달됨' });
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
    broadNo: extractBroadNoFromUrl(),
    url: window.location.href
  }).catch(() => {});

  console.log('[숲토킹 Content] v3.2.0 ISOLATED 브릿지 로드됨');
})();
```

---

### 4️⃣ background.js (수정)

**전체 교체:**

```javascript
// ===== 숲토킹 v3.2.0 - Background Service Worker =====
// video.captureStream 기반 녹화 + 5초/30초 분리 모니터링

// ===== 상수 =====
const CHECK_INTERVAL_FAST = 5000;   // 자동참여 ON 스트리머 (5초)
const CHECK_INTERVAL_SLOW = 30000;  // 자동참여 OFF 스트리머 (30초)
const API_BASE = 'https://api.m.sooplive.co.kr/broad/a/watch';

// ===== 상태 관리 =====
const state = {
  // 스트리머 모니터링
  isMonitoring: false,
  favoriteStreamers: [],  // [{id, nickname, autoJoin, autoRecord}]
  broadcastStatus: {},    // streamerId -> {isLive, title, ...}

  // 녹화 세션 (tabId 기반)
  recordings: new Map(),  // tabId -> {streamerId, nickname, startTime, totalBytes}

  // 모니터링 인터벌 ID
  fastIntervalId: null,
  slowIntervalId: null,

  // 설정
  settings: {
    notificationEnabled: true,
    endNotificationEnabled: false,
    autoCloseOfflineTabs: true,
    notificationDuration: 10
  }
};

// ===== 초기화 =====

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] v3.2.0 설치됨');
  await loadSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[숲토킹] 브라우저 시작');
  await loadSettings();
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== 설정 저장/로드 =====

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([
      'favoriteStreamers',
      'isMonitoring',
      'settings'
    ]);

    if (data.favoriteStreamers) {
      state.favoriteStreamers = data.favoriteStreamers;
    }
    if (data.isMonitoring !== undefined) {
      state.isMonitoring = data.isMonitoring;
    }
    if (data.settings) {
      state.settings = { ...state.settings, ...data.settings };
    }

    console.log('[숲토킹] 설정 로드됨:', state.favoriteStreamers.length, '명의 스트리머');
  } catch (error) {
    console.error('[숲토킹] 설정 로드 실패:', error);
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers,
      isMonitoring: state.isMonitoring,
      settings: state.settings
    });
  } catch (error) {
    console.error('[숲토킹] 설정 저장 실패:', error);
  }
}

// ===== 녹화 관리 =====

async function startRecording(tabId, streamerId, nickname) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  if (!tabId) {
    return { success: false, error: 'tabId가 필요합니다.' };
  }

  // 이미 녹화 중인지 확인
  if (state.recordings.has(tabId)) {
    return { success: false, error: '이미 녹화 중입니다.' };
  }

  try {
    // 탭 확인
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.includes('play.sooplive.co.kr')) {
      return { success: false, error: 'SOOP 방송 페이지가 아닙니다.' };
    }

    // Content Script에 녹화 시작 명령 전송
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'START_RECORDING',
      streamerId: streamerId,
      nickname: nickname
    });

    if (response?.success) {
      // 녹화 상태 저장 (실제 시작 알림은 RECORDING_STARTED_FROM_PAGE에서 처리)
      state.recordings.set(tabId, {
        tabId,
        streamerId,
        nickname,
        startTime: Date.now(),
        totalBytes: 0
      });
      updateBadge();
      return { success: true, tabId, streamerId, nickname };
    } else {
      return { success: false, error: response?.error || '녹화 시작 실패' };
    }

  } catch (error) {
    console.error('[숲토킹] 녹화 시작 실패:', error);
    
    // Content Script 없으면 주입 시도
    if (error.message?.includes('Receiving end') || error.message?.includes('Could not establish')) {
      return { success: false, error: '페이지를 새로고침 후 다시 시도해주세요.' };
    }
    
    return { success: false, error: error.message };
  }
}

async function stopRecording(tabId) {
  console.log('[숲토킹] 녹화 중지 요청:', tabId);

  if (!state.recordings.has(tabId)) {
    return { success: false, error: '녹화 중인 세션이 없습니다.' };
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'STOP_RECORDING'
    });
    return { success: true };
  } catch (error) {
    console.error('[숲토킹] 녹화 중지 실패:', error);
    // 탭이 닫혔을 수 있음 - 상태만 정리
    state.recordings.delete(tabId);
    updateBadge();
    return { success: true, message: '세션 정리됨' };
  }
}

// ===== 배지 업데이트 =====

function updateBadge() {
  const count = state.recordings.size;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
}

// ===== 스트리머 모니터링 (5초/30초 분리) =====

function startMonitoring() {
  state.isMonitoring = true;
  saveSettings();

  // 기존 인터벌 정리
  if (state.fastIntervalId) clearInterval(state.fastIntervalId);
  if (state.slowIntervalId) clearInterval(state.slowIntervalId);

  // 즉시 한 번 체크
  checkFastStreamers();
  checkSlowStreamers();

  // 자동참여 ON 스트리머: 5초마다
  state.fastIntervalId = setInterval(checkFastStreamers, CHECK_INTERVAL_FAST);

  // 자동참여 OFF 스트리머: 30초마다
  state.slowIntervalId = setInterval(checkSlowStreamers, CHECK_INTERVAL_SLOW);

  console.log('[숲토킹] 모니터링 시작 (5초/30초 분리)');
}

function stopMonitoring() {
  state.isMonitoring = false;
  saveSettings();

  if (state.fastIntervalId) {
    clearInterval(state.fastIntervalId);
    state.fastIntervalId = null;
  }
  if (state.slowIntervalId) {
    clearInterval(state.slowIntervalId);
    state.slowIntervalId = null;
  }

  console.log('[숲토킹] 모니터링 중지');
}

async function checkFastStreamers() {
  const fastStreamers = state.favoriteStreamers.filter(s => s.autoJoin);
  if (fastStreamers.length === 0) return;

  for (const streamer of fastStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 상태 업데이트 브로드캐스트
  broadcastToSidepanel({
    type: 'BROADCAST_STATUS_UPDATED',
    data: state.broadcastStatus
  });
}

async function checkSlowStreamers() {
  const slowStreamers = state.favoriteStreamers.filter(s => !s.autoJoin);
  if (slowStreamers.length === 0) return;

  for (const streamer of slowStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }
  
  // 상태 업데이트 브로드캐스트
  broadcastToSidepanel({
    type: 'BROADCAST_STATUS_UPDATED',
    data: state.broadcastStatus
  });
}

async function checkAndProcessStreamer(streamer) {
  try {
    const status = await checkStreamerStatus(streamer.id);
    const prevStatus = state.broadcastStatus[streamer.id];

    // 방송 시작 감지
    if (status.isLive && (!prevStatus || !prevStatus.isLive)) {
      console.log('[숲토킹] 방송 시작 감지:', streamer.nickname || streamer.id);

      // 알림
      if (state.settings.notificationEnabled) {
        showNotification(streamer, status);
      }

      // 자동 참여
      if (streamer.autoJoin) {
        const tab = await openStreamerTab(streamer.id);
        
        // 자동 녹화
        if (streamer.autoRecord && tab?.id) {
          // 페이지 로드 대기 후 녹화 시작
          setTimeout(() => {
            startRecording(tab.id, streamer.id, streamer.nickname || streamer.id);
          }, 3000);
        }
      }
    }

    // 방송 종료 감지
    if (!status.isLive && prevStatus?.isLive) {
      console.log('[숲토킹] 방송 종료 감지:', streamer.nickname || streamer.id);

      if (state.settings.endNotificationEnabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '방송 종료',
          message: `${streamer.nickname || streamer.id}님의 방송이 종료되었습니다.`,
          silent: true
        });
      }
    }

    state.broadcastStatus[streamer.id] = status;

  } catch (error) {
    console.error('[숲토킹] 스트리머 체크 실패:', streamer.id, error);
  }
}

async function checkStreamerStatus(streamerId) {
  try {
    const response = await fetch(`${API_BASE}/${streamerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!response.ok) {
      return { isLive: false };
    }

    const data = await response.json();
    const broad = data.data?.broad;

    if (!broad) {
      return { isLive: false };
    }

    return {
      isLive: broad.broad_no > 0,
      broadNo: broad.broad_no,
      title: broad.broad_title || '',
      viewerCount: broad.current_sum_viewer || 0,
      startTime: broad.broad_start || null
    };
  } catch (error) {
    return { isLive: false };
  }
}

function showNotification(streamer, status) {
  chrome.notifications.create(`live_${streamer.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${streamer.nickname || streamer.id} 방송 시작!`,
    message: status.title || '방송이 시작되었습니다.',
    requireInteraction: true,
    buttons: [{ title: '시청하기' }]
  });
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('live_') && buttonIndex === 0) {
    const streamerId = notificationId.replace('live_', '');
    openStreamerTab(streamerId);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('live_')) {
    const streamerId = notificationId.replace('live_', '');
    openStreamerTab(streamerId);
  }
});

async function openStreamerTab(streamerId) {
  const url = `https://play.sooplive.co.kr/${streamerId}`;
  const tab = await chrome.tabs.create({ url });
  return tab;
}

// ===== 스트리머 관리 =====

async function addStreamer(streamerId) {
  const exists = state.favoriteStreamers.some(s => s.id === streamerId);
  if (exists) {
    return { success: false, error: '이미 등록된 스트리머입니다.' };
  }

  const status = await checkStreamerStatus(streamerId);

  const streamer = {
    id: streamerId,
    nickname: streamerId,
    autoJoin: false,
    autoRecord: false,
    addedAt: Date.now()
  };

  state.favoriteStreamers.push(streamer);
  state.broadcastStatus[streamerId] = status;

  await saveSettings();

  return { success: true, streamer };
}

async function removeStreamer(streamerId) {
  const index = state.favoriteStreamers.findIndex(s => s.id === streamerId);
  if (index === -1) {
    return { success: false, error: '스트리머를 찾을 수 없습니다.' };
  }

  state.favoriteStreamers.splice(index, 1);
  delete state.broadcastStatus[streamerId];

  await saveSettings();

  return { success: true };
}

async function updateStreamer(streamerId, updates) {
  const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
  if (!streamer) {
    return { success: false, error: '스트리머를 찾을 수 없습니다.' };
  }

  Object.assign(streamer, updates);
  await saveSettings();

  return { success: true, streamer };
}

// ===== 사이드패널로 브로드캐스트 =====

function broadcastToSidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ===== 다운로드 처리 =====

async function downloadRecording(blobUrl, fileName) {
  console.log('[숲토킹] 다운로드 요청:', fileName);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: `SOOPtalking/${fileName}`,
      saveAs: false
    });

    console.log('[숲토킹] 다운로드 시작:', downloadId);
    return { success: true, downloadId };
  } catch (error) {
    console.error('[숲토킹] 다운로드 실패:', error);
    return { success: false, error: error.message };
  }
}

// ===== 메시지 핸들러 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  switch (message.type) {
    // ===== 사이드패널 → Background =====

    case 'START_RECORDING_REQUEST':
      const startResult = await startRecording(
        message.tabId,
        message.streamerId,
        message.nickname
      );
      sendResponse(startResult);
      break;

    case 'STOP_RECORDING_REQUEST':
      const stopResult = await stopRecording(message.tabId);
      sendResponse(stopResult);
      break;

    case 'GET_ALL_RECORDINGS':
      sendResponse({
        success: true,
        data: Array.from(state.recordings.values())
      });
      break;

    case 'GET_STATE':
      sendResponse({
        success: true,
        data: {
          isMonitoring: state.isMonitoring,
          favoriteStreamers: state.favoriteStreamers,
          broadcastStatus: state.broadcastStatus,
          settings: state.settings,
          recordingCount: state.recordings.size
        }
      });
      break;

    case 'SET_MONITORING':
      if (message.enabled) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
      sendResponse({ success: true });
      break;

    case 'ADD_STREAMER':
      const addResult = await addStreamer(message.streamerId);
      sendResponse(addResult);
      break;

    case 'REMOVE_STREAMER':
      const removeResult = await removeStreamer(message.streamerId);
      sendResponse(removeResult);
      break;

    case 'UPDATE_STREAMER':
      const updateResult = await updateStreamer(message.streamerId, message.updates);
      sendResponse(updateResult);
      break;

    case 'UPDATE_SETTINGS':
      state.settings = { ...state.settings, ...message.settings };
      await saveSettings();
      sendResponse({ success: true });
      break;

    case 'REFRESH_STREAMERS':
      await checkFastStreamers();
      await checkSlowStreamers();
      sendResponse({ success: true });
      break;

    // ===== Content Script (MAIN) → Background =====

    case 'CONTENT_SCRIPT_LOADED':
      console.log('[숲토킹] Content Script 로드됨:', message.streamerId);
      sendResponse({ success: true });
      break;

    case 'RECORDING_STARTED_FROM_PAGE':
      console.log('[숲토킹] 녹화 시작됨 (페이지에서):', message.streamerId);
      if (tabId && !state.recordings.has(tabId)) {
        state.recordings.set(tabId, {
          tabId,
          streamerId: message.streamerId,
          nickname: message.nickname,
          startTime: Date.now(),
          totalBytes: 0
        });
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_STARTED_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname
      });
      break;

    case 'RECORDING_PROGRESS_FROM_PAGE':
      if (tabId && state.recordings.has(tabId)) {
        const rec = state.recordings.get(tabId);
        rec.totalBytes = message.totalBytes;
        rec.elapsedTime = message.elapsedTime;
      }
      broadcastToSidepanel({
        type: 'RECORDING_PROGRESS_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        totalBytes: message.totalBytes,
        elapsedTime: message.elapsedTime
      });
      break;

    case 'RECORDING_STOPPED_FROM_PAGE':
      console.log('[숲토킹] 녹화 중지됨 (페이지에서):', message.streamerId);
      if (tabId) {
        state.recordings.delete(tabId);
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_STOPPED_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        totalBytes: message.totalBytes,
        duration: message.duration,
        saved: message.saved
      });
      break;

    case 'RECORDING_ERROR_FROM_PAGE':
      console.error('[숲토킹] 녹화 에러 (페이지에서):', message.error);
      if (tabId) {
        state.recordings.delete(tabId);
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_ERROR_UPDATE',
        tabId: tabId,
        error: message.error
      });
      break;

    case 'SAVE_RECORDING_FROM_PAGE':
      console.log('[숲토킹] 파일 저장 요청:', message.fileName);
      await downloadRecording(message.blobUrl, message.fileName);
      break;

    default:
      sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
  }
}

// ===== 탭 닫힘 감지 =====

chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.recordings.has(tabId)) {
    console.log('[숲토킹] 녹화 중인 탭이 닫힘:', tabId);
    state.recordings.delete(tabId);
    updateBadge();
  }
});

// ===== 사이드패널 열기 =====

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ===== 초기 설정 로드 =====

loadSettings().then(() => {
  console.log('[숲토킹] 초기 설정 로드 완료');
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== 로그 =====

console.log('[숲토킹] Background Service Worker v3.2.0 로드됨');
```

---

### 5️⃣ sidepanel/sidepanel.js (수정)

**startRecording 함수와 stopRecording 함수 수정:**

**기존 startRecording 함수 교체:**
```javascript
  // ===== 녹화 기능 =====
  async function startRecording() {
    if (!state.currentStream || !state.currentSoopTabId) {
      showToast('SOOP 방송 탭을 찾을 수 없습니다.', 'error');
      return;
    }

    const { streamerId, nickname, tabId } = state.currentStream;

    if (elements.startRecordingBtn) {
      elements.startRecordingBtn.disabled = true;
      elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>시작 중...</span>';
    }

    showToast('녹화 시작 중...', 'info');

    try {
      // Background에 녹화 시작 요청 (tabId 기반)
      const result = await sendMessage({
        type: 'START_RECORDING_REQUEST',
        tabId: tabId,
        streamerId: streamerId,
        nickname: nickname
      });

      if (result?.success) {
        state.currentTabRecording = {
          tabId: tabId,
          streamerId: streamerId,
          nickname: nickname,
          startTime: Date.now()
        };
        showToast(`🔴 ${nickname || streamerId} 녹화 시작!`, 'success');
        updateRecordingButton();
        updateActiveRecordingList();
      } else {
        throw new Error(result?.error || '녹화 시작 실패');
      }
    } catch (error) {
      console.error('[사이드패널] 녹화 시작 오류:', error);
      showToast('녹화 시작 실패: ' + (error.message || '알 수 없는 오류'), 'error');

      if (elements.startRecordingBtn) {
        elements.startRecordingBtn.disabled = false;
        elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>녹화 시작</span>';
      }
    }
  }

  async function stopRecording(tabId) {
    try {
      const result = await sendMessage({
        type: 'STOP_RECORDING_REQUEST',
        tabId: tabId
      });

      if (result?.success) {
        if (state.currentTabRecording?.tabId === tabId) {
          state.currentTabRecording = null;
        }
        showToast('녹화가 중지되었습니다.', 'success');
        updateRecordingButton();
        updateActiveRecordingList();
      } else {
        throw new Error(result?.error || '녹화 중지 실패');
      }
    } catch (error) {
      console.error('[사이드패널] 녹화 중지 오류:', error);
      showToast('녹화 중지 실패: ' + (error.message || '알 수 없는 오류'), 'error');
    }
  }
```

**updateRecordingButton 함수 수정:**
```javascript
  function updateRecordingButton() {
    if (!elements.startRecordingBtn) return;

    // 현재 탭에서 녹화 중인지 확인
    const isRecordingThisTab = state.currentTabRecording &&
      state.currentTabRecording.tabId === state.currentSoopTabId;

    if (isRecordingThisTab) {
      elements.startRecordingBtn.style.display = 'none';
    } else {
      elements.startRecordingBtn.style.display = 'flex';
      elements.startRecordingBtn.disabled = false;
      elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>녹화 시작</span>';
    }
  }
```

**녹화 목록 카드에서 중지 버튼 이벤트 수정:**
```javascript
      // 중지 버튼 이벤트 (tabId 사용)
      elements.activeRecordingList.querySelectorAll('.recording-stop-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tabId = parseInt(btn.dataset.tabId);
          if (tabId) stopRecording(tabId);
        });
      });
```

**녹화 카드 HTML에서 data-session-id → data-tab-id 변경:**
```javascript
        return `
          <div class="recording-card" data-tab-id="${rec.tabId}">
            ...
            <button class="recording-stop-btn" data-tab-id="${rec.tabId}">
              ...
            </button>
          </div>
        `;
```

**메시지 리스너에서 RECORDING_STARTED_UPDATE 처리 추가:**
```javascript
        case 'RECORDING_STARTED_UPDATE':
          if (message.tabId === state.currentSoopTabId) {
            state.currentTabRecording = {
              tabId: message.tabId,
              streamerId: message.streamerId,
              nickname: message.nickname,
              startTime: Date.now()
            };
          }
          updateRecordingButton();
          updateActiveRecordingList();
          break;
```

---

### 6️⃣ 삭제할 파일

- `offscreen.html`
- `offscreen.js`

---

## 🚀 Claude Code 실행 커맨드

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "REDESIGN_v3.2.0.md 파일을 읽고 다음을 수행해줘:

1. manifest.json 수정:
   - version: 3.2.0
   - permissions에서 tabCapture, activeTab, offscreen 제거
   - permissions에 scripting 추가
   - content_scripts에 content-main.js 추가 (world: MAIN)

2. content-main.js 신규 생성:
   - REDESIGN_v3.2.0.md의 content-main.js 코드 전체 복사

3. content.js 전체 교체:
   - REDESIGN_v3.2.0.md의 content.js 코드로 교체

4. background.js 전체 교체:
   - REDESIGN_v3.2.0.md의 background.js 코드로 교체

5. sidepanel/sidepanel.js 수정:
   - startRecording 함수 교체 (tabCapture 관련 코드 제거, tabId만 전달)
   - stopRecording 함수 수정 (sessionId → tabId)
   - updateActiveRecordingList에서 data-session-id → data-tab-id
   - 메시지 리스너에 RECORDING_STARTED_UPDATE 케이스 추가

6. offscreen.html, offscreen.js 삭제

완료 후: git add -A && git commit -m 'v3.2.0: video.captureStream 기반 다이얼로그 없는 녹화'"
```

---

## 📊 변경 요약

| 항목 | v3.1.x | v3.2.0 |
|------|--------|--------|
| 녹화 방식 | tabCapture (Offscreen) | **video.captureStream (MAIN)** |
| 다이얼로그 | 있음 (실패) | **없음** |
| 녹화 실행 위치 | Offscreen Document | Content Script (MAIN world) |
| 파일 저장 | OPFS → 다운로드 | Blob URL → 다운로드 |
| 코덱 | AV1 > VP9 | AV1 > VP9 (동일) |
| 모니터링 | 5초/30초 분리 | 5초/30초 분리 (동일) |
| 자동 녹화 | 미구현 | **구현** |

---

## 🧪 테스트 체크리스트

**녹화:**
- [ ] SOOP 방송 페이지 접속
- [ ] Side Panel 열기
- [ ] **녹화 시작 버튼 클릭 → 다이얼로그 없이 즉시 녹화**
- [ ] 녹화 중 시간/용량 표시 (5초마다 업데이트)
- [ ] 녹화 중지 → 다운로드 폴더에 파일 저장
- [ ] 콘솔에서 "코덱 선택: AV1" (또는 VP9) 확인

**자동 녹화:**
- [ ] 스트리머 설정에서 "자동 참여" + "자동 녹화" ON
- [ ] 방송 시작 시 자동으로 탭 열림 + 녹화 시작

**탭 닫힘:**
- [ ] 녹화 중 탭 닫기 → 녹화 상태 정리

**모니터링:**
- [ ] 자동참여 ON 스트리머: 5초마다 체크
- [ ] 자동참여 OFF 스트리머: 30초마다 체크
- [ ] LIVE 뱃지 표시
