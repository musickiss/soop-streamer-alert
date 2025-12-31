# 🔧 숲토킹 v3.1.2 개선 패치 명세서
## 버전 정리 + 안정성 개선

---

## 📋 개선 사항

### 1. 버전 주석 통일 (사소함)

**sidepanel.js 1번줄:**
```javascript
// 기존
// ===== 숲토킹 v3.0 - 사이드패널 =====

// 수정
// ===== 숲토킹 v3.1.2 - 사이드패널 =====
```

**background.js onInstalled:**
```javascript
// 기존
console.log('[숲토킹] v3.1.0 설치됨');

// 수정
console.log('[숲토킹] v3.1.2 설치됨');
```

---

### 2. 초기 로드 추가 (중요)

**background.js 맨 아래 (console.log 전):**
```javascript
// 기존: 없음

// 추가: 서비스 워커 시작 시 설정 로드
loadSettings().then(() => {
  console.log('[숲토킹] 초기 설정 로드 완료');
  if (state.isMonitoring) {
    startMonitoring();
  }
});
```

---

### 3. 탭 닫힘 감지 추가 (안정성)

**background.js에 추가:**
```javascript
// 탭 닫힘 감지 - 녹화 중인 탭이 닫히면 녹화 중지
chrome.tabs.onRemoved.addListener((tabId) => {
  // 해당 탭에서 녹화 중인 세션 찾기
  for (const [sessionId, recording] of state.recordings.entries()) {
    if (recording.tabId === tabId) {
      console.log('[숲토킹] 녹화 중인 탭이 닫힘, 녹화 중지:', sessionId);
      stopRecording(sessionId);
    }
  }
});
```

---

### 4. manifest.json 버전 업데이트

```json
"version": "3.1.2"
```

---

### 5. offscreen.js 버전 로그

```javascript
console.log('[Offscreen] 숲토킹 녹화 모듈 v3.1.2 로드됨');
```

---

### 6. background.js 버전 로그

```javascript
console.log('[숲토킹] Background Service Worker v3.1.2 로드됨');
```

---

## 🚀 Claude Code 실행 커맨드

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "다음 수정사항을 적용해줘:

## 1. manifest.json
- version을 3.1.2로 변경

## 2. sidepanel/sidepanel.js
- 1번줄 주석을 'v3.1.2'로 변경

## 3. background.js
- onInstalled 내 로그를 'v3.1.2 설치됨'으로 변경
- 맨 아래 console.log 직전에 다음 코드 추가:
  loadSettings().then(() => {
    console.log('[숲토킹] 초기 설정 로드 완료');
    if (state.isMonitoring) {
      startMonitoring();
    }
  });
- 탭 닫힘 감지 리스너 추가:
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [sessionId, recording] of state.recordings.entries()) {
      if (recording.tabId === tabId) {
        console.log('[숲토킹] 녹화 중인 탭이 닫힘, 녹화 중지:', sessionId);
        stopRecording(sessionId);
      }
    }
  });
- 맨 아래 버전 로그를 'v3.1.2'로 변경

## 4. offscreen.js
- 맨 아래 버전 로그를 'v3.1.2'로 변경

완료 후: git add -A && git commit -m 'v3.1.2: 버전 통일 + 초기 로드 + 탭 닫힘 감지'"
```

---

## 📊 변경 요약

| 항목 | 변경 |
|------|------|
| 버전 통일 | 모든 파일 v3.1.2 |
| 초기 로드 | 서비스 워커 시작 시 loadSettings() |
| 탭 닫힘 감지 | tabs.onRemoved 리스너 추가 |

---

## 🧪 테스트 체크리스트

- [ ] 확장 프로그램 새로고침
- [ ] 브라우저 재시작 후 모니터링 자동 시작 확인
- [ ] 녹화 시작 → 탭 닫기 → 녹화 자동 중지 확인
- [ ] 다운로드 폴더에 파일 저장 확인
