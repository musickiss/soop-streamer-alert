# 숲토킹 (SOOPtalking) - Claude Code 프로젝트 설정

> 이 파일은 Claude Code가 프로젝트를 이해하고 효율적으로 작업하기 위한 컨텍스트입니다.
> **세션 시작 시 자동으로 읽히므로 매번 설명할 필요가 없습니다.**

---

## 프로젝트 개요

**숲토킹** - SOOP(숲) 스트리머 모니터링/녹화/채팅수집 Chrome 확장 프로그램

> 버전 확인: `manifest.json`의 `"version"` 필드 참조
> 기능 상세: `docs/backlog/BASELINE_*.md` 중 최신 파일 참조

### 핵심 기능
| 기능 | 설명 |
|------|------|
| 모니터링 | 스트리머 방송 상태 실시간 감시 |
| 자동 참여 | 방송 시작 시 자동 탭 열기 |
| 녹화 | Canvas 기반 고품질 녹화 (H.264/VP9) |
| 자동 분할 | 500MB/1GB/2GB 단위 파일 분할 |
| 채팅 수집 | SQLite 기반 실시간 채팅 저장/검색 |

---

## 아키텍처 핵심 (반드시 숙지)

### 파일 구조
```
├── background.js          # Service Worker (상태 관리, 메시지 라우팅)
├── content.js             # ISOLATED World (브릿지)
├── content-main.js        # MAIN World (녹화 엔진)
├── chat-collector.js      # ISOLATED World (채팅 수집)
├── analytics.js           # GA4 익명 통계
├── constants.js           # ⭐ 통합 상수 정의 (v5.4.8+)
├── config.js              # 피처 플래그
├── sidepanel/
│   ├── sidepanel.js       # 모니터링 탭
│   ├── donation-tab.js    # 내 후원 탭
│   ├── chat-tab.js        # 채팅 탭 (UI)
│   ├── chat-storage.js    # 통합 스토리지 레이어
│   ├── chat-sqlite.js     # SQLite 백엔드
│   └── chat-db.js         # IndexedDB 폴백
└── lib/
    ├── sql-wasm.js/wasm   # SQLite WASM
    └── flexsearch.*.js    # 검색 라이브러리
```

### World 분리 (중요!)
| World | 파일 | Chrome API | 페이지 DOM |
|-------|------|------------|-----------|
| Background | background.js | 전체 | 없음 |
| MAIN | content-main.js | ❌ 없음 | 전체 |
| ISOLATED | content.js, chat-collector.js | 제한적 | 전체 |

#### ⚠️ content-main.js 수정 시 필수 확인사항
```
┌─────────────────────────────────────────────────────────────────┐
│  content-main.js는 "world": "MAIN"으로 페이지 컨텍스트에서 실행  │
│                                                                 │
│  ❌ 절대 사용 불가:                                              │
│    - chrome.runtime.* (sendMessage, id, onMessage 등)           │
│    - chrome.storage.*                                           │
│    - chrome.tabs.*                                              │
│    - 모든 Chrome Extension API                                  │
│                                                                 │
│  ✅ 사용 가능:                                                   │
│    - window.postMessage() → content.js(ISOLATED)와 통신         │
│    - 표준 Web API (DOM, Canvas, MediaRecorder, AudioContext)    │
│                                                                 │
│  Extension context 검사, 메시지 전송 등이 필요하면               │
│  → content.js(ISOLATED)에서 처리 후 postMessage로 결과 전달     │
└─────────────────────────────────────────────────────────────────┘
```

> **과거 사례**: `isExtensionContextValid()` 함수를 content-main.js에 추가했다가
> `chrome.runtime`이 MAIN world에서 접근 불가하여 녹화가 즉시 중지되는 버그 발생 (v5.4.4)

### 모듈 간 독립성 원칙
- **모니터링/녹화/채팅 수집은 서로 독립적**
- 각 기능의 실패가 다른 기능에 영향을 주지 않아야 함
- 공유 상태는 `background.js`의 `state` 객체에서만 관리

---

## ⛔ 절대 변경 금지 코드

> **중요**: 아래 코드들은 수많은 버그 수정을 거쳐 안정화된 핵심 로직입니다.
> 코드 리뷰, 리팩토링, "개선" 명목으로 절대 수정하지 마세요.

| 파일 | 줄 번호 | 설명 | 변경 시 발생하는 문제 |
|------|---------|------|----------------------|
| `content-main.js` | 590-609 | 오디오 리소스 정리 (v5.4.7) | 녹화 종료 시 원본 방송 소리/화면 끊김 |
| `content-main.js` | 925-1038 | `splitWithRecorderRestart` 6단계 분할 저장 | 분할 녹화 파일 손상/누락 |
| `content-main.js` | 238-242 | 오디오 캡처 연결 (`audioSource.connect`) | 녹화 중 소리 안 들림 |
| `content.js` | 166-380 | MAIN ↔ Background 메시지 브릿지 | 녹화 명령 전달 실패 |
| `manifest.json` | 47-64 | Content Script 주입 순서 | 스크립트 로드 순서 오류 |

---

## 📋 과거 버그 사례 (재발 방지)

### v5.4.4 버그: chrome.runtime 사용 (MAIN world)
```
❌ 문제: content-main.js에 isExtensionContextValid() 추가
   → chrome.runtime이 MAIN world에서 undefined
   → 녹화 시작 즉시 중지됨

✅ 교훈: content-main.js에서 Chrome API 절대 사용 금지
   → Extension context 검사는 content.js(ISOLATED)에서 처리
```

### v5.4.4 버그: audioSource.disconnect() 전체 연결 해제
```
❌ 문제: cleanupCanvas()에서 audioSource.disconnect() 호출
   → 녹화용 연결뿐 아니라 스피커 연결도 끊김
   → 녹화 종료 후 원본 방송 소리/화면 끊김

✅ 교훈: audioSource.disconnect(audioDest)로 녹화용만 선택적 해제
   → audioSource, audioCtx는 유지하여 스피커 출력 계속
```

### 공통 교훈
```
1. "메모리 누수 수정", "코드 정리" 명목의 변경 시 부작용 확인 필수
2. 오디오/비디오 관련 코드는 실제 방송에서 테스트 필수
3. 기존 동작 변경 시 원본 기능(방송 시청) 영향 확인 필수
```

---

## 개발 규칙 (필수 준수)

### 1. 최소 영향 원칙
```
기존 코드 수정 시:
1. 해당 기능만 수정 (다른 기능 건드리지 않음)
2. 새 함수 추가 > 기존 함수 수정
3. 조건 분기 추가 > 기존 로직 변경
```

### 2. 안전한 코딩 패턴
```javascript
// ✅ 좋은 예: 방어적 코딩
if (!state.isCollecting) return;
const value = data?.nested?.property || defaultValue;

// ❌ 나쁜 예: 가정에 의존
state.buffer.push(data.nested.property);
```

### 3. 에러 처리 필수
```javascript
// 모든 외부 호출은 try-catch로 감싸기
try {
  const response = await chrome.runtime.sendMessage({...});
  if (!response?.success) throw new Error(response?.error);
} catch (e) {
  console.warn('[모듈명] 작업 실패:', e.message);
  // 폴백 로직 또는 graceful degradation
}
```

### 4. 메시지 통신 패턴
```javascript
// background.js에서 핸들러 추가 시
case 'NEW_MESSAGE_TYPE':
  try {
    // 동기 로직
    sendResponse({ success: true, data: result });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
  break;  // return true는 비동기 응답 시에만
```

### 5. 상수 관리 규칙 (v5.4.8+)

#### constants.js 통합 상수 파일
모든 상수는 `constants.js`에서 중앙 관리합니다.

```
┌─────────────────────────────────────────────────────────────────────┐
│  상수 카테고리                                                       │
│                                                                     │
│  STORAGE_KEYS    - chrome.storage 키 이름                           │
│  INTERVALS       - 타이머/폴링 간격 (ms)                             │
│  TIMEOUTS        - 타임아웃 값 (ms)                                  │
│  LIMITS          - 최대/최소 제한 값                                  │
│  RECORDING       - 녹화 관련 설정                                    │
│  COLLECT_MODE    - 채팅 수집 모드                                    │
│  API_URLS        - 외부 API 엔드포인트                               │
│  DATABASE        - DB 이름/버전                                      │
│  PATTERNS        - 정규식 패턴                                       │
│  DEFAULT_SELECTORS - DOM 선택자                                      │
└─────────────────────────────────────────────────────────────────────┘
```

#### 파일별 상수 사용 규칙

| 파일 유형 | constants.js 사용 | 비고 |
|-----------|-------------------|------|
| background.js | ✅ import 가능 | ES Module |
| sidepanel/*.js | ✅ import 가능 | ES Module |
| content.js | ❌ 불가 | ISOLATED world |
| content-main.js | ❌ 불가 | MAIN world |
| chat-collector.js | ❌ 불가 | ISOLATED world |

#### 새 상수 추가 시 필수 작업

```
1. constants.js에 먼저 정의 (적절한 카테고리에)
2. 주석으로 용도/단위 설명
3. Content Script에서 사용 시:
   → 해당 파일에도 동일한 값 정의
   → 주석에 "// 동기화: constants.js" 표시
```

#### 예시: 새 타임아웃 상수 추가

```javascript
// constants.js
export const TIMEOUTS = {
  // ... 기존 상수
  NEW_FEATURE_TIMEOUT: 5000,  // 새 기능 대기 시간 (ms)
};

// content.js (Content Script에서 필요한 경우)
// 동기화: constants.js - TIMEOUTS.NEW_FEATURE_TIMEOUT
const NEW_FEATURE_TIMEOUT = 5000;
```

#### ⚠️ 상수 변경 시 주의

```
값 변경 시 반드시 확인:
1. constants.js 수정
2. Content Script 파일들에서 동일 상수 검색
3. 값 동기화 (grep "동기화: constants.js")
4. 테스트
```

---

## 작업 유형별 가이드

### 버그 수정 (HOTFIX)
```
1. 원인 분석 (관련 파일만 읽기)
2. 최소 범위 수정
3. 테스트 시나리오 제시
4. 커밋 (fix: 메시지)
```

### 기능 추가 (FEATURE)
```
1. 최신 베이스라인 확인 (docs/backlog/BASELINE_*.md)
2. 영향 범위 분석
3. 독립적 모듈로 구현
4. 기존 코드와 연결점 최소화
5. 테스트 후 커밋
6. [자동] 새 핵심 기능이면 베이스라인 업데이트 (아래 규칙 참조)
```

### 리팩토링 (REFACTOR)
```
1. 변경 전 동작 명확히 파악
2. 기능 변경 없이 구조만 개선
3. 단계별 작은 변경
4. 각 단계마다 동작 확인
```

---

## 베이스라인 자동 업데이트 규칙 (중요!)

### 트리거 조건
다음 조건 중 하나라도 해당되면 **커밋/푸시 완료 후 자동으로** 베이스라인 업데이트:

| 조건 | 예시 |
|------|------|
| 새로운 핵심 기능 추가 | 새 탭 추가, 새 저장소 백엔드, 새 API 연동 |
| 아키텍처 변경 | 파일 구조 변경, World 간 통신 방식 변경 |
| 새 파일 추가 | 새 모듈 파일 (.js) 추가 |
| manifest.json 권한 변경 | 새 권한 추가/제거 |

### 트리거되지 않는 경우
- 버그 수정 (HOTFIX)
- 기존 기능의 소규모 개선
- UI 텍스트/스타일 변경
- 주석/문서 수정

### 자동 실행 프로세스
```
1. 기존 베이스라인을 docs/backlog/_archive/로 이동
   (BASELINE_vX.X.X_*.md → _archive/BASELINE_vX.X.X_*.md)

2. 새 베이스라인 생성
   파일명: BASELINE_v{새버전}_code_reference.md

3. 새 베이스라인에 포함할 내용:
   - 현재 버전 정보 (manifest.json에서)
   - 변경된 아키텍처/파일 구조
   - 새로 추가된 기능 설명
   - 주요 함수/핸들러 목록
   - 알려진 이슈 (있다면)
```

### 사용자 확인 없이 자동 실행
> Claude Code는 위 트리거 조건에 해당하는 커밋을 완료하면,
> 사용자에게 묻지 않고 베이스라인 업데이트를 자동으로 수행합니다.

---

## 알려진 이슈 (미해결)

### 자동 참여 시 방송 자동 재생 안 됨 (v5.5.5~)
```
상태: 미해결
상세: docs/specs/AUTOPLAY_INVESTIGATION.md 참조

문제: openStreamerTab()으로 새 탭이 열리면 플레이 버튼을 수동 클릭해야 재생됨
원인: Chrome autoplay 정책이 프로그래밍으로 열린 탭의 미디어 자동재생을 차단
해결: 사용자가 Chrome 사이트 설정에서 소리를 "허용"으로 변경하면 해결됨

시도 후 실패한 방법:
- contentSettings.sound API (API는 'allow' 반환하지만 실제 반영 안 됨)
- 플레이 버튼 DOM 셀렉터 검색 (SOOP 플레이어가 표준 HTML5 video 미사용)
- MutationObserver로 VIDEO 감지 (VIDEO 엘리먼트 DOM에 없음)

다음 버전에서 탐색할 방향:
- chrome.scripting.executeScript({ world: 'MAIN' })로 플레이어 접근
- SOOP LivePlayer.js 내부 구조 분석
```

### SOOP API RESULT 코드 (v5.5.5 확인)
```
API: https://live.sooplive.co.kr/afreeca/player_live_api.php
  RESULT === 1   → 일반 방송 (라이브)
  RESULT === -6  → 19+ 성인 방송 (라이브) ← v5.5.4에서 감지 수정
  RESULT === 0   → 방송 종료
  기타 음수      → 제한 방송 (TITLE 있으면 라이브)
```

---

## 금지 사항

### 절대 하지 말 것
- [ ] `docs/` 폴더 전체 읽기 (토큰 낭비)
- [ ] `_archive/` 폴더 접근 (아카이브 시에만 예외)
- [ ] 요청 없이 대규모 리팩토링
- [ ] 테스트 없이 커밋
- [ ] 기존 동작 변경하면서 "개선"이라고 하기

### 파일 접근 규칙
```
읽어도 됨:
- 작업에 직접 관련된 소스 파일
- docs/backlog/BASELINE_*.md (최신 것만, _archive 제외)
- docs/WORKFLOW.md (프로세스 확인 시)
- manifest.json (버전 확인)

읽지 말 것:
- docs/specs/_archive/*
- docs/backlog/_archive/*
- *.bak 파일
```

---

## 자주 사용하는 작업

### 현재 버전 확인
```bash
grep '"version"' manifest.json
```

### 최신 베이스라인 찾기
```bash
ls -t docs/backlog/BASELINE_*.md | head -1
```

### 특정 기능 구현 위치 찾기
```bash
# 메시지 핸들러 찾기
grep "case 'MESSAGE_TYPE'" background.js

# 함수 정의 찾기
grep "function functionName" *.js sidepanel/*.js
```

### 웹스토어 패키징

#### ⚠️ 필수 포함 파일 (누락 시 앱 동작 불가!)
```
manifest.json          # 필수 - 확장 프로그램 설정
background.js          # 필수 - Service Worker
content.js             # 필수 - ISOLATED world 브릿지
content-main.js        # 필수 - MAIN world 녹화 엔진
chat-collector.js      # 필수 - 채팅 수집
config.js              # 필수 - 피처 플래그
message-queue.js       # 필수 - 메시지 큐 모듈
selectors-config.js    # 필수 - DOM 선택자
analytics.js           # 필수 - GA4 통계

sidepanel/             # 필수 - 전체 폴더
├── sidepanel.html
├── sidepanel.js
├── sidepanel.css
├── chat-tab.js
├── chat-tab.css
├── chat-storage.js
├── chat-sqlite.js
├── chat-db.js
├── chat-backup.js
├── donation-tab.js
└── donation-tab.css

icons/                 # 필수 - 전체 폴더
├── icon16.png
├── icon48.png
└── icon128.png

fonts/                 # 필수 - 로컬 번들 폰트 (v5.5.4+)
├── fonts.css
├── Pretendard-Regular.woff2
├── JetBrainsMono-Regular.woff2
├── JetBrainsMono-Medium.woff2
└── JetBrainsMono-SemiBold.woff2

lib/                   # 필수 - .bak 제외
├── sql-wasm.js
├── sql-wasm.wasm
└── flexsearch.bundle.min.js

_locales/              # 필수 - 전체 언어
├── ko/messages.json   # 필수 (기본 언어)
├── en/messages.json
├── ja/messages.json
├── zh_CN/messages.json
└── zh_TW/messages.json
```

#### ❌ 제외할 파일/폴더
```
.git/                  # Git 데이터
.claude/               # Claude 스킬
docs/                  # 문서
dist/                  # 이전 배포본
images/                # 스크린샷
*.md                   # 마크다운 문서
*.bak                  # 백업 파일
.claudeignore          # Claude 설정
```

#### 패키징 명령어
```bash
# Bash (Git Bash / WSL)
cd Claude/soop-streamer-alert
zip -r dist/soop-streamer-alert-v5.4.8.zip \
  manifest.json \
  background.js content.js content-main.js \
  chat-collector.js config.js message-queue.js \
  selectors-config.js analytics.js \
  sidepanel/ icons/ lib/*.js lib/*.wasm \
  _locales/ \
  -x "*.bak" -x "lib/*.bak"
```

#### 패키징 후 검증
```bash
# zip 내용 확인
unzip -l dist/soop-streamer-alert-v5.4.8.zip

# 필수 파일 존재 확인
unzip -l dist/soop-streamer-alert-v5.4.8.zip | grep -E "manifest.json|background.js|content.js|content-main.js|config.js|message-queue.js"
```

---

## 테스트 체크리스트

### 핵심 기능 (매번 확인)
- [ ] 사이드패널 정상 열림
- [ ] 모니터링 ON/OFF 동작
- [ ] 수동 녹화 시작/중지
- [ ] 채팅 수집 동작 (채팅 탭)

### 변경 영향 시 추가 확인
- [ ] 자동 참여/자동 녹화
- [ ] 파일 분할 저장
- [ ] 데이터 내보내기/가져오기

---

## 커밋 메시지 형식

```
타입(범위): 간단한 설명

본문 (선택)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

타입: `feat`, `fix`, `refactor`, `docs`, `chore`
범위: `chat`, `recording`, `monitoring`, `ui`, `storage`

---

## 웹스토어 제출 참고

### 개인정보처리방침 URL
```
https://github.com/musickiss/soop-streamer-alert/blob/master/PRIVACY.md
```

### 권한 설명 (필요 시)
- **alarms**: 주기적 모니터링 스케줄링
- **unlimitedStorage**: 대용량 채팅 로그 SQLite 저장

---

## Vercel Agent Skills 적용

이 프로젝트는 Vercel의 성능 최적화 스킬을 적용합니다.

### 설치된 스킬
- `.claude/skills/react-best-practices/` - React/Next.js 성능 최적화 45개 규칙
- `.claude/skills/web-design-guidelines/` - 웹 디자인 가이드라인

### 핵심 최적화 규칙 (이 프로젝트에 적용)

#### 1. Waterfall 제거 (CRITICAL)
```javascript
// ❌ 순차 실행 (느림)
const a = await fetchA();
const b = await fetchB();

// ✅ 병렬 실행 (빠름)
const [a, b] = await Promise.all([fetchA(), fetchB()]);
```

#### 2. 조기 종료 패턴 (js-early-exit)
```javascript
// ❌ 깊은 중첩
function process(data) {
  if (data) {
    if (data.valid) {
      // 실제 로직
    }
  }
}

// ✅ 조기 종료
function process(data) {
  if (!data) return;
  if (!data.valid) return;
  // 실제 로직
}
```

#### 3. Set/Map 사용 (js-set-map-lookups)
```javascript
// ❌ 배열 검색 O(n)
if (processedIds.includes(id)) return;

// ✅ Set 검색 O(1) - 이미 적용됨
if (state.processedIds.has(id)) return;
```

#### 4. 루프 내 정규식 호이스팅 (js-hoist-regexp)
```javascript
// ❌ 루프 내 생성
items.forEach(item => {
  const match = item.match(/pattern/);
});

// ✅ 외부 선언
const PATTERN = /pattern/;
items.forEach(item => {
  const match = item.match(PATTERN);
});
```

#### 5. 속성 접근 캐싱 (js-cache-property-access)
```javascript
// ❌ 반복 접근
for (let i = 0; i < arr.length; i++) { ... }

// ✅ 캐싱
const len = arr.length;
for (let i = 0; i < len; i++) { ... }
```

### 적용 시기
- 새 코드 작성 시 위 패턴 우선 적용
- 코드 리뷰 시 CRITICAL/HIGH 규칙 위반 체크
- 리팩토링 시 `.claude/skills/react-best-practices/AGENTS.md` 참조

---

## 연락처

문제 발생 시 GitHub Issues: https://github.com/musickiss/soop-streamer-alert/issues
