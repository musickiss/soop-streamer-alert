# 🔧 HOTFIX v3.3.1 - 자동 녹화 실패 알림 추가

## 버전 정보
- **현재 버전**: 3.3.0
- **수정 버전**: 3.3.1
- **작성일**: 2026-01-01

---

## 1. 변경 목적

### 발견된 이슈

| 이슈 | 심각도 | 설명 |
|------|--------|------|
| background.js 버전 불일치 | 🔴 높음 | 파일 주석이 v3.2.3으로 남아있음 |
| 자동 녹화 실패 알림 누락 | 🔴 높음 | 폴더 미설정 시 자동 녹화 실패해도 사용자에게 알림 없음 |

### 문제 시나리오

```
1. 사용자가 녹화 폴더를 설정하지 않음
2. 스트리머 방송 시작 → 자동 녹화 시도
3. File System API가 폴더 선택 다이얼로그 필요
4. 사용자 제스처 없음 → 조용히 실패
5. 사용자는 녹화되고 있다고 생각하지만 실제로는 녹화 안 됨 ❌
```

### 해결 방안

```
1. 자동 녹화 실패 시 RECORDING_ERROR 메시지 수신
2. 에러 메시지에 "폴더" 키워드 포함 시 알림 표시
3. 사용자가 녹화 폴더를 설정하도록 안내
```

---

## 2. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `manifest.json` | 버전 3.3.0 → 3.3.1 |
| `background.js` | 버전 주석 업데이트 + 자동 녹화 실패 알림 처리 추가 |

---

## 3. 상세 수정 내용

### 3.1 manifest.json

```json
// 변경 전
"version": "3.3.0",

// 변경 후
"version": "3.3.1",
```

---

### 3.2 background.js

#### 3.2.1 파일 상단 버전 주석 수정

```javascript
// 변경 전
// ===== 숲토킹 v3.2.3 - Background Service Worker =====
// video.captureStream 기반 녹화 + 5초/30초 분리 모니터링

// 변경 후
// ===== 숲토킹 v3.3.1 - Background Service Worker =====
// File System API 기반 녹화 + 5초/30초 분리 모니터링
```

#### 3.2.2 메시지 핸들러에 RECORDING_ERROR 처리 추가

**위치:** `chrome.runtime.onMessage.addListener` 내부의 switch 문

기존 메시지 핸들러에서 `RECORDING_ERROR_FROM_PAGE` 또는 유사한 케이스를 찾아서, 폴더 관련 에러 시 알림을 추가합니다.

**추가할 코드:**

```javascript
// 메시지 핸들러 내부에 추가 (기존 case 문들 사이에)

case 'RECORDING_ERROR_FROM_PAGE':
  // 녹화 에러 처리
  const errorTabId = sender.tab?.id;
  const errorMessage = message.error || '알 수 없는 오류';
  
  console.error('[숲토킹] 녹화 오류:', errorMessage);
  
  // 녹화 상태 정리
  if (errorTabId && state.recordings.has(errorTabId)) {
    state.recordings.delete(errorTabId);
    updateBadge();
  }
  
  // ★ 폴더 미설정으로 인한 자동 녹화 실패 알림
  if (errorMessage.includes('폴더') || errorMessage.includes('취소')) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '📁 녹화 폴더 설정 필요',
      message: '자동 녹화를 위해 Side Panel에서 녹화 폴더를 먼저 설정해주세요.',
      priority: 2,
      requireInteraction: true  // 사용자가 직접 닫을 때까지 유지
    });
  }
  
  // Side Panel에 에러 전파
  broadcastToSidepanel({
    type: 'RECORDING_ERROR_UPDATE',
    tabId: errorTabId,
    error: errorMessage
  });
  
  sendResponse({ success: true });
  break;
```

#### 3.2.3 자동 녹화 시작 부분 에러 처리 강화

**위치:** `checkAndProcessStreamer` 함수 내 자동 녹화 부분

**기존 코드:**
```javascript
// 자동 녹화
if (streamer.autoRecord && tab?.id) {
  // ... 대기 로직 ...
  
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
```

**변경 코드:**
```javascript
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

    if (!result.success) {
      // ★ 폴더 미설정 에러는 재시도하지 않고 즉시 알림
      if (result.error?.includes('폴더') || result.error?.includes('취소')) {
        console.log('[숲토킹] 자동 녹화 실패 - 폴더 미설정');
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '📁 녹화 폴더 설정 필요',
          message: `${streamer.nickname || streamer.id} 자동 녹화를 위해 녹화 폴더를 먼저 설정해주세요.`,
          priority: 2,
          requireInteraction: true
        });
        return result;
      }
      
      // 다른 에러는 재시도
      if (retryCount < maxRetries) {
        retryCount++;
        console.log('[숲토킹] 자동 녹화 재시도:', retryCount);
        await new Promise(r => setTimeout(r, 2000));
        return tryStartRecording();
      }
    }

    return result;
  };

  tryStartRecording();
}
```

---

## 4. 영향 평가

| 기능 | 영향 | 설명 |
|------|------|------|
| 수동 녹화 | 🟢 없음 | 변경 없음 |
| 자동 녹화 (폴더 설정됨) | 🟢 없음 | 정상 작동 |
| 자동 녹화 (폴더 미설정) | ✅ 개선 | 실패 시 알림 표시 |
| 모니터링 | 🟢 없음 | 변경 없음 |
| UI | 🟢 없음 | 변경 없음 |

---

## 5. 테스트 체크리스트

```
[ ] 1. 폴더 미설정 상태에서 자동 녹화 트리거
     → "녹화 폴더 설정 필요" 알림 표시 확인
     
[ ] 2. 폴더 설정 상태에서 자동 녹화 트리거
     → 정상 녹화 시작 확인
     
[ ] 3. 알림 클릭/닫기 동작 확인

[ ] 4. 수동 녹화는 기존대로 작동 확인

[ ] 5. 콘솔에 에러 로그 정상 출력 확인
```

---

## 6. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "HOTFIX_v3.3.1_AUTO_RECORD_NOTIFICATION.md 파일을 읽고 수정사항을 적용해줘. 기존 기능에 영향을 주지 않도록 주의해서 수정해줘. 완료 후 git add -A && git commit -m 'hotfix: v3.3.1 - 자동 녹화 실패 시 폴더 설정 알림 추가'"
```

---

**문서 끝**
