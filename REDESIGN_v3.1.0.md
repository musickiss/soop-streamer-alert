# 🚀 숲토킹 v3.1.0 완전 재설계 명세서
## 원터치 녹화 (tabCapture) + 모니터링 기능 복원

---

## 📋 문제 분석

### 문제 1: 녹화 방식
| 현재 | 문제 |
|------|------|
| `getDisplayMedia()` 사용 | **무조건** 화면 선택 다이얼로그가 뜸 (브라우저 보안 정책) |

### 문제 2: 모니터링 기능
| 현재 | 문제 |
|------|------|
| 30초 고정 체크 | 자동참여 ON 스트리머는 5초마다 체크해야 함 |
| LIVE 표시 안됨 | 방송 중 상태가 UI에 반영 안됨 |

---

## ✅ 해결 방안

### 녹화: `chrome.tabCapture.getMediaStreamId()` API 사용

```javascript
// Background Service Worker에서 streamId 획득 (다이얼로그 없음!)
const streamId = await chrome.tabCapture.getMediaStreamId({
  targetTabId: tabId
});

// Offscreen Document에서 스트림 획득 및 녹화
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  },
  video: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
});
```

**장점:**
- ✅ 화면 선택 다이얼로그 **없음** (원터치)
- ✅ 탭의 비디오+오디오를 직접 캡처 (고품질)
- ✅ Side Panel 닫아도 녹화 유지
- ✅ CORS 문제 없음

---

## 📁 수정 파일

1. **manifest.json** - tabCapture 권한, version 3.1.0
2. **background.js** - 전체 교체
3. **offscreen.js** - 전체 교체
4. **content.js** - 간소화

---

## 🚀 Claude Code 실행 커맨드

아래 내용을 터미널에 복사하세요:

```
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "REDESIGN_v3.1.0.md 파일을 읽고 다음 작업을 수행해줘:

1. manifest.json 수정
   - version을 3.1.0으로 변경
   - permissions 배열에 tabCapture 추가

2. background.js 전체 교체
   - CHECK_INTERVAL_FAST = 5000 (자동참여 ON 스트리머)
   - CHECK_INTERVAL_SLOW = 30000 (자동참여 OFF 스트리머)
   - startMonitoring()에서 두 개의 setInterval 사용
   - checkFastStreamers(): 자동참여 ON인 스트리머만 체크
   - checkSlowStreamers(): 자동참여 OFF인 스트리머만 체크
   - startRecording()에서 chrome.tabCapture.getMediaStreamId({ targetTabId }) 사용
   - Offscreen에 streamId 전달

3. offscreen.js 전체 교체
   - START_RECORDING에서 streamId를 받아서 getUserMedia 호출
   - getUserMedia 옵션에 chromeMediaSource: 'tab', chromeMediaSourceId: streamId 사용
   - getDisplayMedia 완전히 제거

4. content.js 간소화
   - GET_PAGE_INFO, PING 메시지만 처리
   - 녹화 관련 코드 전부 제거

5. content-main.js 파일이 있으면 삭제

6. sidepanel.js는 그대로 유지 (메시지 타입 동일)

완료 후: git add -A && git commit -m 'v3.1.0: tabCapture 원터치 녹화 + 모니터링 5초/30초 분리'"
```

---

## 📊 v3.0.x vs v3.1.0 비교

| 항목 | v3.0.x | v3.1.0 |
|------|--------|--------|
| **녹화 API** | getDisplayMedia | **tabCapture** |
| **화면 선택 다이얼로그** | ❌ 무조건 뜸 | ✅ **없음** |
| **모니터링 주기** | 30초 고정 | 5초/30초 분리 |
| **LIVE 뱃지** | 미작동 | ✅ 작동 |

---

## 🧪 테스트 체크리스트

### 모니터링
- [ ] 자동참여 ON 스트리머: 5초마다 체크 (콘솔 로그 확인)
- [ ] 자동참여 OFF 스트리머: 30초마다 체크
- [ ] 방송 시작 시 LIVE 뱃지 표시
- [ ] 방송 시작 알림

### 녹화
- [ ] 녹화 시작 → **다이얼로그 없이** 즉시 시작
- [ ] 녹화 중 배지 숫자 표시
- [ ] 녹화 중지 → 다운로드
- [ ] Side Panel 닫아도 녹화 유지
