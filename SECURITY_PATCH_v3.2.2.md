# 🔒 숲토킹 v3.2.2 보안 및 코드 정리 패치 명세서
## 보안 취약점 수정 + 미사용 코드 제거

---

## 📋 코드 리뷰 결과

### 🔴 보안 취약점 (수정 필요)

| 심각도 | 파일 | 문제 | 위험 |
|--------|------|------|------|
| 🔴 높음 | content.js | 메시지 origin 검증 없음 | 악의적 스크립트가 가짜 녹화 메시지 주입 가능 |
| 🔴 높음 | background.js | streamerId 검증 누락 | URL 인젝션 가능 |
| 🟠 중간 | background.js | blobUrl 검증 없음 | 악의적 URL 다운로드 시도 가능 |
| 🟡 낮음 | content-main.js | postMessage에 '*' 사용 | 제한된 환경이라 실제 위험 낮음 |

### 🟡 사용되지 않는 코드

| 파일 | 항목 | 상태 |
|------|------|------|
| manifest.json | `alarms` 권한 | 선언만 되고 미사용 |
| background.js | `notificationDuration` | 선언만 되고 미사용 |
| background.js | `autoCloseOfflineTabs` | 선언만 되고 기능 미구현 |
| content.js | `extractBroadNoFromUrl()` | 초기화에만 사용, 불필요 |

---

## 📝 파일별 수정 내용

---

### 1️⃣ manifest.json

**수정 1:** 버전 변경

```json
"version": "3.2.2"
```

**수정 2:** 미사용 권한 제거

기존:
```json
"permissions": [
  "storage",
  "tabs",
  "alarms",
  "notifications",
  "sidePanel",
  "downloads",
  "scripting"
]
```

변경:
```json
"permissions": [
  "storage",
  "tabs",
  "notifications",
  "sidePanel",
  "downloads",
  "scripting"
]
```

---

### 2️⃣ background.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.2 - Background Service Worker =====
```

**수정 2:** 미사용 설정 제거 (state.settings)

기존:
```javascript
settings: {
  notificationEnabled: true,
  endNotificationEnabled: false,
  autoCloseOfflineTabs: true,
  notificationDuration: 10
}
```

변경:
```javascript
settings: {
  notificationEnabled: true,
  endNotificationEnabled: false
}
```

**수정 3:** streamerId 검증 함수 추가 (상수 섹션 아래)

```javascript
// ===== 보안 유틸리티 =====

function isValidStreamerId(streamerId) {
  if (!streamerId || typeof streamerId !== 'string') return false;
  // 영문 소문자, 숫자, 언더스코어만 허용 (1-50자)
  return /^[a-z0-9_]{1,50}$/.test(streamerId);
}

function sanitizeStreamerId(streamerId) {
  if (!streamerId || typeof streamerId !== 'string') return null;
  const sanitized = streamerId.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 50);
  return sanitized.length > 0 ? sanitized : null;
}

function isValidBlobUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('blob:');
}

function sanitizeFilename(str) {
  if (!str || typeof str !== 'string') return 'unknown';
  return str
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}
```

**수정 4:** addStreamer 함수에 검증 추가

기존:
```javascript
async function addStreamer(streamerId) {
  const exists = state.favoriteStreamers.some(s => s.id === streamerId);
  if (exists) {
    return { success: false, error: '이미 등록된 스트리머입니다.' };
  }
```

변경:
```javascript
async function addStreamer(streamerId) {
  // 보안: streamerId 검증
  const sanitized = sanitizeStreamerId(streamerId);
  if (!sanitized) {
    return { success: false, error: '올바르지 않은 스트리머 ID입니다.' };
  }
  streamerId = sanitized;

  const exists = state.favoriteStreamers.some(s => s.id === streamerId);
  if (exists) {
    return { success: false, error: '이미 등록된 스트리머입니다.' };
  }
```

**수정 5:** startRecording 함수에 검증 추가

기존:
```javascript
async function startRecording(tabId, streamerId, nickname) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  if (!tabId) {
    return { success: false, error: 'tabId가 필요합니다.' };
  }
```

변경:
```javascript
async function startRecording(tabId, streamerId, nickname) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  // 보안: 입력 검증
  if (!tabId || typeof tabId !== 'number') {
    return { success: false, error: 'tabId가 필요합니다.' };
  }

  // streamerId 검증 및 정제
  const sanitizedId = sanitizeStreamerId(streamerId);
  if (!sanitizedId) {
    return { success: false, error: '올바르지 않은 스트리머 ID입니다.' };
  }
  streamerId = sanitizedId;
  nickname = sanitizeFilename(nickname) || streamerId;
```

**수정 6:** downloadRecording 함수에 blobUrl 검증 추가

기존:
```javascript
async function downloadRecording(blobUrl, fileName) {
  console.log('[숲토킹] 다운로드 요청:', fileName);

  try {
    const downloadId = await chrome.downloads.download({
```

변경:
```javascript
async function downloadRecording(blobUrl, fileName) {
  console.log('[숲토킹] 다운로드 요청:', fileName);

  // 보안: blobUrl 검증
  if (!isValidBlobUrl(blobUrl)) {
    console.error('[숲토킹] 유효하지 않은 blobUrl:', blobUrl);
    return { success: false, error: '유효하지 않은 다운로드 URL입니다.' };
  }

  // 보안: 파일명 정제
  fileName = sanitizeFilename(fileName) || 'recording.webm';
  if (!fileName.endsWith('.webm')) {
    fileName += '.webm';
  }

  try {
    const downloadId = await chrome.downloads.download({
```

**수정 7:** SAVE_RECORDING_FROM_PAGE 핸들러에 검증 추가

기존:
```javascript
case 'SAVE_RECORDING_FROM_PAGE':
  console.log('[숲토킹] 파일 저장 요청:', message.fileName);
  await downloadRecording(message.blobUrl, message.fileName);
  break;
```

변경:
```javascript
case 'SAVE_RECORDING_FROM_PAGE':
  console.log('[숲토킹] 파일 저장 요청:', message.fileName);
  // 보안: Content Script에서 온 요청만 처리
  if (!tabId) {
    console.warn('[숲토킹] 파일 저장 요청 거부: 탭 ID 없음');
    break;
  }
  await downloadRecording(message.blobUrl, message.fileName);
  break;
```

**수정 8:** onInstalled 로그 변경

```javascript
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] v3.2.2 설치됨');
  await loadSettings();
});
```

**수정 9:** 마지막 로그 변경

```javascript
console.log('[숲토킹] Background Service Worker v3.2.2 로드됨');
```

---

### 3️⃣ content.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.2 - Content Script (ISOLATED) =====
```

**수정 2:** 메시지 origin 검증 강화 (window.addEventListener 부분)

기존:
```javascript
// ===== MAIN world → Background 메시지 브릿지 =====
window.addEventListener('message', (e) => {
  if (e.source !== window) return;

  const { type, ...data } = e.data;
```

변경:
```javascript
// ===== MAIN world → Background 메시지 브릿지 =====

// 허용된 메시지 타입 목록 (화이트리스트)
const ALLOWED_MESSAGE_TYPES = [
  'SOOPTALKING_RECORDING_STARTED',
  'SOOPTALKING_RECORDING_PROGRESS',
  'SOOPTALKING_RECORDING_STOPPED',
  'SOOPTALKING_RECORDING_ERROR',
  'SOOPTALKING_SAVE_RECORDING',
  'SOOPTALKING_RECORDER_RESULT'
];

window.addEventListener('message', (e) => {
  // 보안: 같은 윈도우에서 온 메시지만 처리
  if (e.source !== window) return;
  
  // 보안: origin 검증 (SOOP 도메인만)
  if (!e.origin.includes('sooplive.co.kr')) return;

  const { type, ...data } = e.data;
  
  // 보안: 화이트리스트에 없는 타입 무시
  if (!type || !ALLOWED_MESSAGE_TYPES.includes(type)) return;
```

**수정 3:** extractBroadNoFromUrl 함수 제거

기존:
```javascript
function extractBroadNoFromUrl() {
  const match = window.location.pathname.match(/^\/[^\/]+\/(\d+)/);
  return match ? match[1] : null;
}
```

변경: **함수 전체 삭제**

**수정 4:** 초기화 알림에서 broadNo 제거

기존:
```javascript
// ===== 초기화 알림 =====
safeSendMessage({
  type: 'CONTENT_SCRIPT_LOADED',
  streamerId: extractStreamerIdFromUrl(),
  broadNo: extractBroadNoFromUrl(),
  url: window.location.href
}).catch(() => {});
```

변경:
```javascript
// ===== 초기화 알림 =====
safeSendMessage({
  type: 'CONTENT_SCRIPT_LOADED',
  streamerId: extractStreamerIdFromUrl(),
  url: window.location.href
}).catch(() => {});
```

**수정 5:** 마지막 로그 변경

```javascript
console.log('[숲토킹 Content] v3.2.2 ISOLATED 브릿지 로드됨');
```

---

### 4️⃣ content-main.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.2 - MAIN World 녹화 모듈 =====
```

**수정 2:** postMessage에 targetOrigin 명시

모든 `window.postMessage({...}, '*')` 를 다음으로 변경:

```javascript
window.postMessage({...}, window.location.origin);
```

해당 위치:
- startRecording 함수 내 시작 알림 (약 115번줄)
- saveRecording 함수 내 저장 요청 (약 145번줄)
- saveRecording 함수 내 중지 알림 (약 155번줄)
- startProgressInterval 함수 내 (약 170번줄)
- mediaRecorder.onerror 핸들러 내 (약 100번줄)
- 메시지 리스너 결과 전송 (약 220번줄)

**수정 3:** 마지막 로그 변경

```javascript
console.log('[숲토킹 Recorder] v3.2.2 MAIN world 모듈 로드됨');
```

---

### 5️⃣ sidepanel/sidepanel.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.2 - 사이드패널 =====
```

**수정 2:** 미사용 설정 제거 (state.settings)

기존:
```javascript
settings: {
  notificationEnabled: true,
  endNotificationEnabled: false,
  autoCloseOfflineTabs: true
},
```

변경:
```javascript
settings: {
  notificationEnabled: true,
  endNotificationEnabled: false
},
```

**수정 3:** 미사용 UI 요소 제거 (initElements 함수)

기존:
```javascript
elements.autoCloseChip = document.getElementById('autoCloseChip');
```

변경: **해당 줄 삭제**

**수정 4:** 미사용 UI 업데이트 제거 (updateQuickSettings 함수)

기존:
```javascript
function updateQuickSettings() {
  elements.notificationChip?.classList.toggle('active', state.settings.notificationEnabled);
  elements.endNotificationChip?.classList.toggle('active', state.settings.endNotificationEnabled);
  elements.autoCloseChip?.classList.toggle('active', state.settings.autoCloseOfflineTabs);
}
```

변경:
```javascript
function updateQuickSettings() {
  elements.notificationChip?.classList.toggle('active', state.settings.notificationEnabled);
  elements.endNotificationChip?.classList.toggle('active', state.settings.endNotificationEnabled);
}
```

**수정 5:** 미사용 설정 토글 제거 (toggleQuickSetting 함수)

기존:
```javascript
async function toggleQuickSetting(setting) {
  let newSettings = { ...state.settings };

  switch (setting) {
    case 'notification':
      newSettings.notificationEnabled = !state.settings.notificationEnabled;
      break;
    case 'endNotification':
      newSettings.endNotificationEnabled = !state.settings.endNotificationEnabled;
      break;
    case 'autoClose':
      newSettings.autoCloseOfflineTabs = !state.settings.autoCloseOfflineTabs;
      break;
  }
```

변경:
```javascript
async function toggleQuickSetting(setting) {
  let newSettings = { ...state.settings };

  switch (setting) {
    case 'notification':
      newSettings.notificationEnabled = !state.settings.notificationEnabled;
      break;
    case 'endNotification':
      newSettings.endNotificationEnabled = !state.settings.endNotificationEnabled;
      break;
    default:
      return;
  }
```

**수정 6:** 미사용 이벤트 바인딩 제거 (bindEvents 함수)

기존:
```javascript
// 빠른 설정
elements.notificationChip?.addEventListener('click', () => toggleQuickSetting('notification'));
elements.endNotificationChip?.addEventListener('click', () => toggleQuickSetting('endNotification'));
elements.autoCloseChip?.addEventListener('click', () => toggleQuickSetting('autoClose'));
```

변경:
```javascript
// 빠른 설정
elements.notificationChip?.addEventListener('click', () => toggleQuickSetting('notification'));
elements.endNotificationChip?.addEventListener('click', () => toggleQuickSetting('endNotification'));
```

---

### 6️⃣ sidepanel/sidepanel.html

**수정:** autoCloseChip 요소 제거 (약 55-58번줄)

기존:
```html
<div class="setting-chip active" data-setting="autoClose" id="autoCloseChip">
  <span class="chip-icon">🚫</span>
  <span data-i18n="autoCloseOfflineTabs">탭 자동종료</span>
</div>
```

변경: **해당 4줄 전체 삭제**

---

## 🚀 Claude Code 실행 커맨드

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "SECURITY_PATCH_v3.2.2.md 파일을 읽고 다음을 수행해줘:

1. manifest.json
   - version을 3.2.2로 변경
   - permissions에서 'alarms' 제거

2. background.js
   - 버전 주석/로그를 3.2.2로 변경
   - 보안 유틸리티 함수 4개 추가 (isValidStreamerId, sanitizeStreamerId, isValidBlobUrl, sanitizeFilename)
   - state.settings에서 autoCloseOfflineTabs, notificationDuration 제거
   - addStreamer 함수에 streamerId 검증 추가
   - startRecording 함수에 입력 검증 추가
   - downloadRecording 함수에 blobUrl, fileName 검증 추가
   - SAVE_RECORDING_FROM_PAGE 핸들러에 tabId 검증 추가

3. content.js
   - 버전 주석/로그를 3.2.2로 변경
   - ALLOWED_MESSAGE_TYPES 화이트리스트 추가
   - window.addEventListener에 origin 검증 추가 (sooplive.co.kr)
   - extractBroadNoFromUrl 함수 삭제
   - 초기화 알림에서 broadNo 제거

4. content-main.js
   - 버전 주석/로그를 3.2.2로 변경
   - 모든 window.postMessage의 두 번째 인자를 '*'에서 window.location.origin으로 변경

5. sidepanel/sidepanel.js
   - 버전 주석을 3.2.2로 변경
   - state.settings에서 autoCloseOfflineTabs 제거
   - initElements에서 autoCloseChip 제거
   - updateQuickSettings에서 autoCloseChip 관련 코드 제거
   - toggleQuickSetting에서 autoClose 케이스 제거 (default: return으로 변경)
   - bindEvents에서 autoCloseChip 이벤트 제거

6. sidepanel/sidepanel.html
   - autoCloseChip div 요소 4줄 삭제 (setting-chip active data-setting="autoClose" id="autoCloseChip" 부분)

완료 후: git add -A && git commit -m 'v3.2.2: 보안 강화 + 미사용 코드 제거'"
```

---

## 📊 변경 요약

### 🔒 보안 강화

| 항목 | 수정 내용 |
|------|-----------|
| streamerId 검증 | `sanitizeStreamerId()` 함수로 정제 |
| blobUrl 검증 | `blob:` 프로토콜 검증 |
| fileName 검증 | `sanitizeFilename()` 함수로 정제 |
| 메시지 origin | `sooplive.co.kr` 도메인만 허용 |
| 메시지 화이트리스트 | `ALLOWED_MESSAGE_TYPES` 배열로 제한 |
| postMessage | `'*'` → `window.location.origin` |
| tabId 검증 | Content Script 요청만 처리 |

### 🧹 코드 정리

| 항목 | 제거 |
|------|------|
| manifest.json | `alarms` 권한 |
| background.js | `notificationDuration`, `autoCloseOfflineTabs` |
| content.js | `extractBroadNoFromUrl()` |
| sidepanel.js | `autoCloseChip` 관련 전체 |

---

## 🧪 테스트 체크리스트

**보안 테스트:**
- [ ] 올바른 스트리머 ID로 추가 성공
- [ ] 잘못된 스트리머 ID (특수문자 포함) 추가 실패
- [ ] 녹화 시작/중지 정상 작동
- [ ] 파일 다운로드 정상 작동
- [ ] 콘솔에 보안 관련 경고 없음

**기능 테스트:**
- [ ] 모니터링 ON/OFF
- [ ] 알림 설정 토글
- [ ] 종료 알림 설정 토글
- [ ] 녹화 시작/중지
- [ ] 스트리머 추가/삭제
- [ ] 내보내기/가져오기

**제거된 기능:**
- [ ] 자동 닫기 칩이 UI에서 사라졌는지 확인
