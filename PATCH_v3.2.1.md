# 🔧 숲토킹 v3.2.1 안정화 패치 명세서
## Blob URL 메모리 관리 + 자동 녹화 개선 + 녹화 안정성 강화

---

## 📋 개선 사항 요약

| 항목 | 문제 | 해결 |
|------|------|------|
| Blob URL 메모리 | 다운로드 후 해제 안됨 | 다운로드 완료 시 해제 |
| 자동 녹화 타이밍 | 고정 3초 대기 | 탭 로드 완료 대기 |
| 비디오 요소 탐색 | 단일 선택자 | 다중 선택자 + 재시도 |
| 녹화 상태 복구 | 없음 | Side Panel 열 때 상태 동기화 |

---

## 📝 파일별 수정 내용

---

### 1️⃣ manifest.json

**수정:** 버전만 변경

```json
"version": "3.2.1"
```

---

### 2️⃣ content-main.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.1 - MAIN World 녹화 모듈 =====
```

**수정 2:** 비디오 요소 탐색 개선 (startRecording 함수 내)

기존:
```javascript
// 비디오 요소 찾기
const video = document.querySelector('video');
if (!video) {
  return { success: false, error: '비디오 요소를 찾을 수 없습니다.' };
}
```

변경:
```javascript
// 비디오 요소 찾기 (여러 선택자 시도)
let video = document.querySelector('video#webplayer-video');
if (!video) {
  video = document.querySelector('video[src]');
}
if (!video) {
  video = document.querySelector('video');
}

if (!video) {
  return { success: false, error: '비디오 요소를 찾을 수 없습니다.' };
}

// readyState 확인 (HAVE_CURRENT_DATA 이상)
if (video.readyState < 2) {
  return { success: false, error: '비디오가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.' };
}
```

**수정 3:** 마지막 로그 변경

```javascript
console.log('[숲토킹 Recorder] v3.2.1 MAIN world 모듈 로드됨');
```

---

### 3️⃣ content.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.1 - Content Script (ISOLATED) =====
```

**수정 2:** 마지막 로그 변경

```javascript
console.log('[숲토킹 Content] v3.2.1 ISOLATED 브릿지 로드됨');
```

---

### 4️⃣ background.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.1 - Background Service Worker =====
```

**수정 2:** onInstalled 로그 변경

```javascript
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] v3.2.1 설치됨');
  await loadSettings();
});
```

**수정 3:** downloadRecording 함수 전체 교체

```javascript
async function downloadRecording(blobUrl, fileName) {
  console.log('[숲토킹] 다운로드 요청:', fileName);

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: `SOOPtalking/${fileName}`,
      saveAs: false
    });

    console.log('[숲토킹] 다운로드 시작:', downloadId);

    // 다운로드 완료 감지 및 정리
    const listener = (delta) => {
      if (delta.id === downloadId) {
        if (delta.state?.current === 'complete') {
          chrome.downloads.onChanged.removeListener(listener);
          console.log('[숲토킹] 다운로드 완료:', fileName);
        } else if (delta.state?.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(listener);
          console.error('[숲토킹] 다운로드 중단:', fileName);
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);

    // 5분 후 리스너 자동 정리 (안전장치)
    setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
    }, 300000);

    return { success: true, downloadId };
  } catch (error) {
    console.error('[숲토킹] 다운로드 실패:', error);
    return { success: false, error: error.message };
  }
}
```

**수정 4:** checkAndProcessStreamer 함수 내 자동 녹화 부분 교체

기존 (자동 참여 부분):
```javascript
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
```

변경:
```javascript
// 자동 참여
if (streamer.autoJoin) {
  const tab = await openStreamerTab(streamer.id);

  // 자동 녹화
  if (streamer.autoRecord && tab?.id) {
    // 탭 로드 완료 대기
    await waitForTabComplete(tab.id, 15000);
    
    // 비디오 요소 로드 대기 (추가 2초)
    await new Promise(r => setTimeout(r, 2000));
    
    // 녹화 시작 (최대 3회 재시도)
    let retryCount = 0;
    const maxRetries = 3;
    
    const tryStartRecording = async () => {
      const result = await startRecording(tab.id, streamer.id, streamer.nickname || streamer.id);
      
      if (!result.success && retryCount < maxRetries) {
        retryCount++;
        console.log('[숲토킹] 자동 녹화 재시도:', retryCount);
        await new Promise(r => setTimeout(r, 2000));
        return tryStartRecording();
      }
      
      return result;
    };
    
    tryStartRecording();
  }
}
```

**수정 5:** waitForTabComplete 함수 추가 (checkAndProcessStreamer 함수 위에)

```javascript
// 탭 로드 완료 대기 함수
async function waitForTabComplete(tabId, timeout = 15000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        return true;
      }
    } catch {
      return false;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  
  return true; // 타임아웃 시에도 시도
}
```

**수정 6:** 마지막 로그 변경

```javascript
console.log('[숲토킹] Background Service Worker v3.2.1 로드됨');
```

---

### 5️⃣ sidepanel/sidepanel.js

**수정 1:** 버전 주석 변경 (1번줄)

```javascript
// ===== 숲토킹 v3.2.1 - 사이드패널 =====
```

**수정 2:** 녹화 상태 동기화 추가 (init 함수 내, updateActiveRecordingList() 호출 후)

```javascript
// 현재 탭 녹화 상태 동기화
await syncCurrentTabRecordingState();
```

**수정 3:** syncCurrentTabRecordingState 함수 추가 (updateActiveRecordingList 함수 아래)

```javascript
// 현재 탭 녹화 상태 동기화
async function syncCurrentTabRecordingState() {
  try {
    const result = await sendMessage({ type: 'GET_ALL_RECORDINGS' });
    const recordings = result?.success && Array.isArray(result.data) ? result.data : [];
    
    // 현재 탭에서 녹화 중인지 확인
    const currentRecording = recordings.find(rec => rec.tabId === state.currentSoopTabId);
    
    if (currentRecording) {
      state.currentTabRecording = {
        tabId: currentRecording.tabId,
        streamerId: currentRecording.streamerId,
        nickname: currentRecording.nickname,
        startTime: currentRecording.startTime
      };
    } else {
      state.currentTabRecording = null;
    }
    
    updateRecordingButton();
  } catch (error) {
    console.error('[사이드패널] 녹화 상태 동기화 오류:', error);
  }
}
```

---

## 🚀 Claude Code 실행 커맨드

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "PATCH_v3.2.1.md 파일을 읽고 다음을 수행해줘:

1. manifest.json
   - version을 3.2.1로 변경

2. content-main.js
   - 1번줄 버전 주석을 v3.2.1로 변경
   - startRecording 함수에서 비디오 요소 탐색 개선:
     * video#webplayer-video → video[src] → video 순서로 시도
     * video.readyState < 2 체크 추가
   - 마지막 로그를 v3.2.1로 변경

3. content.js
   - 1번줄 버전 주석을 v3.2.1로 변경
   - 마지막 로그를 v3.2.1로 변경

4. background.js
   - 1번줄 버전 주석을 v3.2.1로 변경
   - onInstalled 로그를 v3.2.1로 변경
   - downloadRecording 함수에 다운로드 완료/중단 리스너와 5분 타임아웃 추가
   - waitForTabComplete 함수 추가 (checkAndProcessStreamer 위에)
   - checkAndProcessStreamer의 자동 녹화 부분을 탭 로드 대기 + 3회 재시도 로직으로 교체
   - 마지막 로그를 v3.2.1로 변경

5. sidepanel/sidepanel.js
   - 1번줄 버전 주석을 v3.2.1로 변경
   - syncCurrentTabRecordingState 함수 추가 (updateActiveRecordingList 아래)
   - init 함수에서 updateActiveRecordingList() 호출 후 await syncCurrentTabRecordingState() 추가

완료 후: git add -A && git commit -m 'v3.2.1: 안정화 패치 - 메모리 관리, 자동 녹화 개선, 비디오 탐색 강화'"
```

---

## 📊 변경 요약

| 파일 | 변경 내용 |
|------|-----------|
| manifest.json | version 3.2.1 |
| content-main.js | 비디오 선택자 개선, readyState 체크 |
| content.js | 버전 업데이트 |
| background.js | 다운로드 리스너, 탭 로드 대기, 자동 녹화 재시도 |
| sidepanel.js | 녹화 상태 동기화 |

---

## 🔍 개선 상세

### 1. 비디오 요소 탐색 강화
```
1순위: video#webplayer-video (SOOP 메인 플레이어)
2순위: video[src] (src 속성이 있는 비디오)
3순위: video (모든 비디오)
+ readyState 체크로 로드 완료 확인
```

### 2. 자동 녹화 안정성
```
탭 로드 대기 (최대 15초)
    ↓
비디오 로드 대기 (2초)
    ↓
녹화 시작 시도
    ↓
실패 시 2초 대기 후 재시도 (최대 3회)
```

### 3. 메모리 관리
```
다운로드 시작
    ↓
완료/중단 감지 리스너
    ↓
5분 후 자동 리스너 해제 (안전장치)
```

---

## 🧪 테스트 체크리스트

**수동 녹화:**
- [ ] SOOP 방송 접속 → Side Panel → 녹화 시작 (다이얼로그 없음)
- [ ] 녹화 중 시간/용량 업데이트 (5초마다)
- [ ] 녹화 중지 → SOOPtalking 폴더에 파일 저장
- [ ] 콘솔: "코덱 선택: AV1" (또는 VP9)

**자동 녹화:**
- [ ] 스트리머 설정: 자동 참여 ON + 자동 녹화 ON
- [ ] 방송 시작 감지 → 탭 열림 → 페이지 로드 완료 → 녹화 자동 시작
- [ ] 콘솔: 재시도 로그 확인 (필요시)

**Side Panel 상태 동기화:**
- [ ] 녹화 중 Side Panel 닫기 → 다시 열기 → 녹화 상태 유지 확인

**메모리:**
- [ ] 여러 번 녹화 → 메모리 누수 없음 확인

---

## 📈 버전 히스토리

| 버전 | 변경 사항 |
|------|-----------|
| 3.2.0 | video.captureStream 기반 다이얼로그 없는 녹화 |
| **3.2.1** | **안정화: 메모리 관리, 자동 녹화 개선, 비디오 탐색 강화** |
