# 🔧 숲토킹 v3.1.1 버그 수정 명세서
## tabCapture 사용자 제스처 문제 해결 + AV1 코덱 추가

---

## 📋 문제 분석

### 에러 메시지
```
Error: Extension has not been invoked for the current page (see activeTab permission). 
Chrome pages cannot be captured.
```

### 원인
`chrome.tabCapture.getMediaStreamId()`는 **사용자 제스처(클릭) 직후**에만 작동합니다.

**현재 (실패하는 흐름):**
```
Side Panel: 버튼 클릭 (사용자 제스처 ✅)
    ↓
Side Panel: sendMessage() → Background (제스처 컨텍스트 소멸 ❌)
    ↓
Background: tabCapture.getMediaStreamId() → 실패 ❌
```

**수정 후 (성공하는 흐름):**
```
Side Panel: 버튼 클릭 (사용자 제스처 ✅)
    ↓
Side Panel: chrome.tabCapture.getMediaStreamId() → 성공 ✅
    ↓
Side Panel: sendMessage({ streamId }) → Background
    ↓
Background → Offscreen: 녹화 시작
```

---

## ✅ 수정 사항

### 1. manifest.json
- `activeTab` 권한 추가
- version 3.1.1

### 2. sidepanel.js
- `startRecording()` 함수에서 **직접** `chrome.tabCapture.getMediaStreamId()` 호출
- 획득한 streamId를 Background로 전달

### 3. background.js
- `startRecording()` 함수가 streamId를 **받아서** Offscreen에 전달
- tabCapture 호출 코드 제거

### 4. offscreen.js
- AV1 코덱 1순위 추가 (VP9 폴백)

---

## 📁 파일별 수정 내용

### 1️⃣ manifest.json

```json
{
  "version": "3.1.1",
  "permissions": [
    "storage",
    "tabs",
    "tabCapture",
    "activeTab",
    "alarms",
    "notifications",
    "sidePanel",
    "offscreen",
    "downloads"
  ]
}
```

**변경:** `activeTab` 권한 추가, version 3.1.1

---

### 2️⃣ sidepanel.js - startRecording() 함수 수정

**기존 코드 (삭제):**
```javascript
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
    const result = await sendMessage({
      type: 'START_RECORDING_REQUEST',
      tabId,
      streamerId,
      nickname
    });
    // ... 이하 생략
```

**수정 코드 (교체):**
```javascript
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
    // ⭐ Side Panel에서 직접 tabCapture 호출 (사용자 제스처 컨텍스트 유지)
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    if (!streamId) {
      throw new Error('tabCapture streamId 획득 실패');
    }

    console.log('[사이드패널] tabCapture streamId 획득 성공');

    // Background에 streamId와 함께 녹화 시작 요청
    const result = await sendMessage({
      type: 'START_RECORDING_REQUEST',
      tabId,
      streamerId,
      nickname,
      streamId  // ⭐ streamId 전달
    });

    if (result?.success) {
      state.currentTabRecording = {
        sessionId: result.sessionId,
        tabId,
        streamerId,
        nickname,
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
    
    let errorMsg = error.message || '알 수 없는 오류';
    
    // 사용자 친화적 에러 메시지
    if (errorMsg.includes('activeTab') || errorMsg.includes('invoked')) {
      errorMsg = '녹화할 탭을 먼저 클릭해주세요.';
    }
    
    showToast('녹화 시작 실패: ' + errorMsg, 'error');

    if (elements.startRecordingBtn) {
      elements.startRecordingBtn.disabled = false;
      elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>녹화 시작</span>';
    }
  }
}
```

---

### 3️⃣ background.js - startRecording() 함수 수정

**기존 코드 (삭제):**
```javascript
async function startRecording(tabId, streamerId, nickname, quality) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  const ready = await ensureOffscreen();
  if (!ready) {
    return { success: false, error: 'Offscreen Document 생성 실패' };
  }

  try {
    // tabCapture API로 streamId 획득 (다이얼로그 없음!)
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    });

    console.log('[숲토킹] tabCapture streamId 획득:', streamId.substring(0, 20) + '...');

    // Offscreen에 녹화 시작 요청
    const response = await chrome.runtime.sendMessage({
      // ...
```

**수정 코드 (교체):**
```javascript
async function startRecording(tabId, streamerId, nickname, quality, streamId) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  // ⭐ streamId가 없으면 에러
  if (!streamId) {
    return { success: false, error: 'streamId가 필요합니다. Side Panel에서 tabCapture를 호출해주세요.' };
  }

  const ready = await ensureOffscreen();
  if (!ready) {
    return { success: false, error: 'Offscreen Document 생성 실패' };
  }

  try {
    console.log('[숲토킹] streamId 수신됨:', streamId.substring(0, 20) + '...');

    // Offscreen에 녹화 시작 요청
    const response = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId,
      tabId,
      streamerId,
      nickname,
      quality: quality || {
        resolution: '1080p',
        frameRate: 30,
        videoBitrate: 4000,
        audioBitrate: 128
      }
    });

    if (response?.success) {
      state.recordings.set(response.sessionId, {
        sessionId: response.sessionId,
        tabId,
        streamerId,
        nickname,
        fileName: response.fileName,
        startTime: Date.now(),
        totalBytes: 0
      });
      updateBadge();
      console.log('[숲토킹] 녹화 시작됨:', response.sessionId);
    }

    return response;
  } catch (error) {
    console.error('[숲토킹] 녹화 시작 실패:', error);
    return { success: false, error: error.message };
  }
}
```

---

### 3-2️⃣ background.js - handleMessage() 수정

**기존 코드:**
```javascript
case 'START_RECORDING_REQUEST':
  const startResult = await startRecording(
    message.tabId,
    message.streamerId,
    message.nickname,
    message.quality
  );
  sendResponse(startResult);
  break;
```

**수정 코드:**
```javascript
case 'START_RECORDING_REQUEST':
  const startResult = await startRecording(
    message.tabId,
    message.streamerId,
    message.nickname,
    message.quality,
    message.streamId  // ⭐ streamId 추가
  );
  sendResponse(startResult);
  break;
```

---

### 4️⃣ offscreen.js - getBestMimeType() 수정

**기존 코드:**
```javascript
function getBestMimeType() {
  const codecs = [
    { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
    { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
    { mime: 'video/webm', name: 'WebM' }
  ];
  // ...
}
```

**수정 코드:**
```javascript
function getBestMimeType() {
  const codecs = [
    { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },   // ⭐ AV1 1순위
    { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },   // VP9 2순위
    { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },   // VP8 3순위
    { mime: 'video/webm', name: 'WebM' }                    // 폴백
  ];

  for (const { mime, name } of codecs) {
    if (MediaRecorder.isTypeSupported(mime)) {
      console.log('[Offscreen] 코덱 선택:', name);
      return mime;
    }
  }
  return 'video/webm';
}
```

---

### 4-2️⃣ offscreen.js - 버전 로그 수정

**기존:**
```javascript
console.log('[Offscreen] 숲토킹 녹화 모듈 v3.1.0 로드됨');
```

**수정:**
```javascript
console.log('[Offscreen] 숲토킹 녹화 모듈 v3.1.1 로드됨');
```

---

### 5️⃣ background.js - 버전 로그 수정

**기존:**
```javascript
console.log('[숲토킹] Background Service Worker v3.1.0 로드됨');
```

**수정:**
```javascript
console.log('[숲토킹] Background Service Worker v3.1.1 로드됨');
```

---

## 📊 수정 전후 비교

| 항목 | 수정 전 (v3.1.0) | 수정 후 (v3.1.1) |
|------|-----------------|-----------------|
| tabCapture 호출 위치 | Background | **Side Panel** |
| 사용자 제스처 | 소멸됨 ❌ | 유지됨 ✅ |
| 코덱 우선순위 | VP9 > VP8 | **AV1 > VP9 > VP8** |
| activeTab 권한 | 없음 | **있음** |

---

## 🚀 Claude Code 실행 커맨드

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "다음 수정사항을 정확히 적용해줘:

## 1. manifest.json
- version을 3.1.1로 변경
- permissions 배열에 activeTab 추가

## 2. sidepanel/sidepanel.js의 startRecording() 함수 수정
- 함수 내부에서 chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })를 직접 호출
- 획득한 streamId를 sendMessage의 START_RECORDING_REQUEST에 포함해서 전달
- 에러 발생 시 사용자 친화적 메시지 표시

## 3. background.js의 startRecording() 함수 수정
- 파라미터에 streamId 추가: startRecording(tabId, streamerId, nickname, quality, streamId)
- chrome.tabCapture.getMediaStreamId() 호출 코드 삭제
- 전달받은 streamId를 그대로 Offscreen에 전달

## 4. background.js의 handleMessage() 내 START_RECORDING_REQUEST 케이스
- message.streamId를 startRecording()에 전달

## 5. offscreen.js의 getBestMimeType() 함수
- 코덱 배열 맨 앞에 AV1 추가: { mime: 'video/webm;codecs=av1,opus', name: 'AV1' }

## 6. 버전 로그 업데이트
- background.js: v3.1.1
- offscreen.js: v3.1.1

완료 후: git add -A && git commit -m 'v3.1.1: tabCapture를 Side Panel에서 호출 + AV1 코덱 추가'"
```

---

## 🧪 테스트 체크리스트

- [ ] 확장 프로그램 새로고침
- [ ] SOOP 방송 페이지 접속
- [ ] Side Panel 열기
- [ ] **녹화 시작 버튼 클릭 → 즉시 녹화 시작** (다이얼로그 없음)
- [ ] 콘솔에서 "코덱 선택: AV1" 또는 "코덱 선택: VP9" 확인
- [ ] 녹화 중지 → 다운로드
- [ ] 파일 재생 확인
