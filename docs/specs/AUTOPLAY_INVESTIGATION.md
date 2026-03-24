# SOOP 자동 참여 시 방송 자동 재생 문제 조사

> 작성일: 2026-03-25 (v5.5.5)
> 상태: **미해결 - 다음 버전에서 계속 조사 필요**

---

## 문제 요약

스트리머 방송 시작 시 자동 참여(autoJoin)로 새 탭이 열리면, 방송이 자동 재생되지 않고 **사용자가 플레이 버튼을 수동으로 클릭**해야 방송에 참여할 수 있음.

### 재현 조건
1. 즐겨찾기 스트리머에서 "자동 참여" 활성화
2. 해당 스트리머가 방송 시작
3. 모니터링이 감지하여 `openStreamerTab()`으로 새 탭 생성
4. 탭은 열리지만 **플레이 버튼이 표시되고 자동 재생 안 됨**

### 사용자 수동 해결 방법 (확인됨)
- Chrome 주소창 왼쪽 아이콘 → 사이트 설정 → **소리: "허용"**으로 변경
- 이후 자동 참여 시 정상 재생됨

---

## 시도한 해결 방법 및 결과

### 1. `chrome.contentSettings.sound.set()` API

**시도:** SOOP 도메인에 소리 "allow" 설정
```javascript
chrome.contentSettings.sound.set({
  primaryPattern: 'https://play.sooplive.com/*',
  setting: 'allow'
});
```

**결과: 실패**
- `contentSettings.sound.get()` → `'allow'` 반환 (API 레벨에서는 설정됨)
- 하지만 Chrome UI 사이트 설정에서는 여전히 "자동(기본값)" 표시
- **실제 autoplay 정책에 반영되지 않음**
- `contentSettings` API와 Chrome 사이트 설정 UI가 별개의 레이어로 동작하는 것으로 추정

**결론:** `contentSettings` 권한은 효과 없음 → v5.5.5에서 권한 및 관련 코드 전면 제거

### 2. 플레이 버튼 DOM 셀렉터 검색

**시도:** 다양한 셀렉터로 플레이 버튼 찾기
```javascript
// 시도 1: 버튼, 클래스 기반
document.querySelectorAll('button, [class*="play"], [class*="Play"], [id*="play"]')
// 결과: 매칭 없음

// 시도 2: 비디오, iframe
document.querySelectorAll('video, iframe')
// 결과: 매칭 없음

// 시도 3: 레이어, 오버레이
document.querySelectorAll('[class*="layer"], [class*="overlay"], [id*="layer"]')
// 결과: 매칭 없음

// 시도 4: Shadow DOM
document.querySelectorAll('*').forEach(el => { if(el.shadowRoot) ... })
// 결과: Shadow DOM 없음

// 시도 5: 플레이어 컨테이너
document.querySelectorAll('[id*="player"], [class*="player"]')
// 결과: 매칭 없음

// 시도 6: 전체 엘리먼트에서 VIDEO 태그 검색
document.querySelectorAll('*').forEach(el => { if (el.tagName === 'VIDEO') ... })
// 결과: VIDEO 엘리먼트 없음
```

**결론:** SOOP 플레이어가 표준 HTML5 video 태그를 사용하지 않거나, 특수한 렌더링 방식(WebRTC, Canvas 등) 사용

### 3. MutationObserver로 동적 VIDEO 감지

**시도:** 10초간 DOM 변경 감시하면서 video 엘리먼트 추가 감지
```javascript
const obs = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const n of m.addedNodes) {
      if (n.tagName === 'VIDEO') console.log('VIDEO found');
      if (n.querySelector?.('video')) console.log('VIDEO in child');
    }
  }
});
obs.observe(document.body, { childList: true, subtree: true });
```

**결과: VIDEO 엘리먼트 감지 안 됨**

### 4. 화면 좌표 기반 클릭 (`document.elementFromPoint`)

**검토만 함 (구현 안 함)**
- 사용자 브라우저 크기/환경에 따라 버튼 위치가 다름
- 신뢰성 낮아 폐기

---

## 관찰된 단서

### SOOP 플레이어 에러 로그
```
Uncaught (in promise) Error: auto play block    LivePlayer.js
```
- `LivePlayer.js`가 autoplay를 시도하고 Chrome이 차단
- 차단 후 플레이 버튼 오버레이가 표시됨

### SOOP API 호출 패턴
```
GET https://deapi.sooplive.com/api/v1/recommend?publisher=AFREECA&placement=LIV...
→ net::ERR_BLOCKED_BY_CLIENT (광고차단기에 의해 차단됨)
```

### Chrome 사이트 설정 (수동 확인)
- `play.sooplive.com` 사이트 설정에서 "소리" 항목이 존재
- "자동(기본값)" → autoplay 차단됨
- "허용" → autoplay 정상 동작

---

## 미탐색 방향 (다음 버전에서 시도 가능)

### A. `chrome.scripting.executeScript` + `world: 'MAIN'`
```
가설: MAIN world에서 SOOP 플레이어의 전역 객체에 접근 가능할 수 있음
방법:
1. openStreamerTab() 후 탭 로드 완료 대기
2. chrome.scripting.executeScript({ world: 'MAIN', target: { tabId } })
3. SOOP 플레이어의 play() 메서드 직접 호출
주의: SOOP 플레이어가 어떤 전역 객체를 노출하는지 조사 필요
```

### B. SOOP 플레이어 내부 구조 분석
```
방법:
1. LivePlayer.js 소스 분석 (난독화되어 있을 수 있음)
2. 플레이어 초기화 흐름 파악
3. autoplay 차단 시 fallback 로직 확인
4. 프로그래밍적으로 재생을 트리거하는 방법 찾기
```

### C. chrome.debugger API 활용
```
가설: debugger API로 사용자 제스처를 시뮬레이션하면 autoplay 허용될 수 있음
방법: chrome.debugger.attach() → Input.dispatchMouseEvent
단점: debugger 권한 필요, 사용자에게 디버거 아이콘 표시됨
```

### D. 알림 클릭 기반 탭 열기
```
가설: chrome.notifications.onClicked에서 열린 탭은 "사용자 제스처"로 간주될 수 있음
방법: 자동 참여 대신 알림만 띄우고, 사용자가 알림 클릭 시 탭 열기
단점: "자동" 참여가 아닌 "반자동" 참여가 됨
```

### E. Content Script에서 사용자 인터랙션 후 재생
```
가설: content script가 로드된 후 임의의 클릭 이벤트를 발생시키면
      Chrome이 사용자 제스처로 인식할 수 있음
방법: document.dispatchEvent(new MouseEvent('click'))
주의: Chrome은 프로그래밍 생성 이벤트를 "신뢰할 수 없는(untrusted)" 이벤트로
      처리하여 autoplay 허용 조건에 포함하지 않을 가능성 높음
```

---

## 관련 Chrome 정책 참고

### Chrome Autoplay Policy (2024+)
- **Media Engagement Index (MEI)**: 사용자가 사이트에서 미디어와 상호작용한 이력 기반
- **사용자 제스처 필요**: 프로그래밍으로 열린 탭은 사용자 제스처 없음
- **`contentSettings.sound`**: 탭 음소거 제어용이며, autoplay 정책과는 별개
- **사이트 설정 UI의 "소리: 허용"**: 이것만이 실제 autoplay를 허용하는 설정

### 참고 문서
- https://developer.chrome.com/blog/autoplay/
- https://developer.chrome.com/docs/extensions/reference/api/contentSettings

---

## 변경 이력

| 날짜 | 버전 | 내용 |
|------|------|------|
| 2026-03-25 | v5.5.5 | 최초 조사, contentSettings 제거, 5가지 방법 시도 및 실패 기록 |
