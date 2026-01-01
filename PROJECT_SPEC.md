# 📺 숲토킹 (SOOPtalking) 프로젝트 명세서
## Chrome Extension for SOOP Live Stream Recording & Monitoring

**문서 버전:** 1.0  
**프로젝트 버전:** v3.2.x  
**최종 업데이트:** 2025-01-01

---

## 📋 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [핵심 요구사항](#2-핵심-요구사항)
3. [개발 원칙 및 제약사항](#3-개발-원칙-및-제약사항)
4. [아키텍처 설계](#4-아키텍처-설계)
5. [파일 구조](#5-파일-구조)
6. [기술 스택](#6-기술-스택)
7. [개발 워크플로우](#7-개발-워크플로우)
8. [기능별 상세 명세](#8-기능별-상세-명세)
9. [API 및 메시지 프로토콜](#9-api-및-메시지-프로토콜)
10. [테스트 체크리스트](#10-테스트-체크리스트)
11. [알려진 이슈 및 해결책](#11-알려진-이슈-및-해결책)
12. [버전 히스토리](#12-버전-히스토리)

---

## 1. 프로젝트 개요

### 1.1 프로젝트 설명

**숲토킹(SOOPtalking)**은 한국 스트리밍 플랫폼 SOOP(구 AfreecaTV)의 방송 알림 및 자동 녹화 기능을 제공하는 Chrome 확장 프로그램입니다.

### 1.2 주요 기능

| 기능 | 설명 |
|------|------|
| **방송 모니터링** | 즐겨찾는 스트리머의 방송 시작/종료 감지 |
| **알림** | 방송 시작 시 데스크톱 알림 |
| **자동 참여** | 방송 시작 시 자동으로 탭 열기 |
| **원터치 녹화** | 다이얼로그 없이 클릭 한 번으로 녹화 |
| **자동 녹화** | 방송 시작 시 자동으로 녹화 시작 |
| **다국어 지원** | 한국어, 영어, 일본어, 중국어(간체/번체) |

### 1.3 대상 플랫폼

- **스트리밍 플랫폼:** SOOP (https://play.sooplive.co.kr)
- **브라우저:** Chrome (Manifest V3)
- **배포:** Chrome Web Store

---

## 2. 핵심 요구사항

### 2.1 녹화 기능 요구사항

| 요구사항 | 우선순위 | 상태 |
|----------|----------|------|
| **다이얼로그 없는 원터치 녹화** | 🔴 필수 | ✅ 구현 |
| **자동 녹화** (방송 시작 시) | 🔴 필수 | ✅ 구현 |
| **Side Panel 닫아도 녹화 유지** | 🔴 필수 | ✅ 구현 |
| **AV1 > VP9 > VP8 코덱 자동 선택** | 🟡 권장 | ✅ 구현 |
| **녹화 진행 상황 표시** (시간, 용량) | 🟡 권장 | ✅ 구현 |
| **자동 파일 저장** (SOOPtalking 폴더) | 🔴 필수 | ✅ 구현 |

### 2.2 모니터링 기능 요구사항

| 요구사항 | 우선순위 | 상태 |
|----------|----------|------|
| **자동참여 ON 스트리머: 5초 체크** | 🔴 필수 | ✅ 구현 |
| **자동참여 OFF 스트리머: 30초 체크** | 🔴 필수 | ✅ 구현 |
| **방송 시작/종료 알림** | 🟡 권장 | ✅ 구현 |
| **LIVE 뱃지 표시** | 🟡 권장 | ✅ 구현 |

### 2.3 UI/UX 요구사항

| 요구사항 | 우선순위 | 상태 |
|----------|----------|------|
| **Side Panel UI** | 🔴 필수 | ✅ 구현 |
| **최소한의 사용자 상호작용** | 🔴 필수 | ✅ 구현 |
| **스트리머 목록 관리** | 🟡 권장 | ✅ 구현 |
| **내보내기/가져오기** | 🟢 선택 | ✅ 구현 |

---

## 3. 개발 원칙 및 제약사항

### 3.1 🔴 절대 원칙 (MUST)

```
1. 다이얼로그/팝업 금지
   - 화면 공유 선택 다이얼로그 절대 안 됨
   - 탭 선택 다이얼로그 절대 안 됨
   - 사용자 추가 클릭 요구 금지

2. 원터치 작동
   - 녹화 시작: 버튼 1번 클릭으로 즉시 시작
   - 녹화 중지: 버튼 1번 클릭으로 즉시 중지 + 저장

3. 백그라운드 녹화
   - Side Panel 닫아도 녹화 계속
   - 브라우저 최소화해도 녹화 계속
   - 다른 탭 활성화해도 녹화 계속

4. 자동 저장
   - 녹화 중지 시 자동으로 다운로드 폴더에 저장
   - 파일명: soop_{스트리머ID}_{타임스탬프}.webm
   - 저장 위치: 다운로드/SOOPtalking/
```

### 3.2 🟡 권장 원칙 (SHOULD)

```
1. 코덱 우선순위
   - 1순위: AV1 (최고 압축률)
   - 2순위: VP9 (높은 호환성)
   - 3순위: VP8 (폴백)
   - 4순위: WebM (최종 폴백)

2. 리소스 효율성
   - 메모리 누수 방지
   - 불필요한 API 호출 최소화
   - 모니터링 주기 최적화 (5초/30초 분리)

3. 오류 복구
   - 녹화 실패 시 재시도 (최대 3회)
   - 네트워크 오류 시 graceful 처리
   - Extension context 무효화 대응
```

### 3.3 🚫 금지 사항 (MUST NOT)

```
1. 절대 사용 금지 API
   - getDisplayMedia() - 다이얼로그 발생
   - tabCapture.capture() - Side Panel에서 작동 안 함
   - desktopCapture - 다이얼로그 발생

2. 금지된 구현 방식
   - Offscreen Document에서 tabCapture 사용
   - Background에서 직접 tabCapture 호출
   - 사용자 제스처 필요한 API를 비동기로 호출

3. 금지된 UX
   - 탭 선택 요구
   - 권한 요청 팝업 반복
   - 녹화 시작 전 추가 확인 요구
```

### 3.4 기술적 제약사항

```
1. Chrome 보안 정책
   - tabCapture.getMediaStreamId()는 사용자 제스처 컨텍스트 필요
   - Side Panel에서는 activeTab 권한이 제한적
   - MAIN world에서만 video.captureStream() 사용 가능

2. SOOP 플랫폼 특성
   - 비디오 요소 ID: video#webplayer-video (주로)
   - 스트리밍 방식: 독자 프로토콜 (ALS)
   - CDN 직접 접근 불가

3. Manifest V3 제약
   - Service Worker 수명 제한
   - 지속적 연결 불가
   - Offscreen Document 용도 제한
```

---

## 4. 아키텍처 설계

### 4.1 v3.2.x 아키텍처 (현재)

```
┌─────────────────────────────────────────────────────────────┐
│                     Side Panel (UI)                          │
│  - 스트리머 목록 관리                                         │
│  - 녹화 시작/중지 버튼                                        │
│  - 녹화 상태 표시                                             │
└─────────────────────┬───────────────────────────────────────┘
                      │ chrome.runtime.sendMessage
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Background Service Worker                       │
│  - 스트리머 모니터링 (5초/30초)                               │
│  - 녹화 세션 관리 (tabId 기반)                                │
│  - 다운로드 처리                                              │
│  - 알림 생성                                                  │
└─────────────────────┬───────────────────────────────────────┘
                      │ chrome.tabs.sendMessage
                      ▼
┌─────────────────────────────────────────────────────────────┐
│           Content Script [ISOLATED World]                    │
│  - 메시지 브릿지 (Background ↔ MAIN)                         │
│  - 페이지 정보 추출                                           │
└─────────────────────┬───────────────────────────────────────┘
                      │ window.postMessage
                      ▼
┌─────────────────────────────────────────────────────────────┐
│             Content Script [MAIN World]                      │
│  - video.captureStream() 녹화 ⭐                             │
│  - MediaRecorder 관리                                        │
│  - Blob 생성 및 전달                                         │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 메시지 흐름

**녹화 시작:**
```
Side Panel
    │ {type: 'START_RECORDING_REQUEST', tabId, streamerId, nickname}
    ▼
Background
    │ {type: 'START_RECORDING', streamerId, nickname}
    ▼
Content [ISOLATED]
    │ {type: 'SOOPTALKING_RECORDER_COMMAND', command: 'START_RECORDING'}
    ▼
Content [MAIN]
    │ video.captureStream() → MediaRecorder.start()
    ▼
Content [ISOLATED]
    │ {type: 'SOOPTALKING_RECORDING_STARTED', ...}
    ▼
Background
    │ state.recordings.set(tabId, {...})
    ▼
Side Panel
    │ UI 업데이트
```

**녹화 중지 + 저장:**
```
Side Panel
    │ {type: 'STOP_RECORDING_REQUEST', tabId}
    ▼
Background
    │ {type: 'STOP_RECORDING'}
    ▼
Content [ISOLATED]
    │ {type: 'SOOPTALKING_RECORDER_COMMAND', command: 'STOP_RECORDING'}
    ▼
Content [MAIN]
    │ MediaRecorder.stop() → Blob 생성 → URL.createObjectURL()
    ▼
Content [ISOLATED]
    │ {type: 'SOOPTALKING_SAVE_RECORDING', blobUrl, fileName}
    ▼
Background
    │ chrome.downloads.download({url: blobUrl, filename: 'SOOPtalking/...'})
    ▼
다운로드 폴더
```

---

## 5. 파일 구조

```
soop-streamer-alert/
├── manifest.json           # 확장 프로그램 설정
├── background.js           # Service Worker (모니터링, 다운로드)
├── content.js              # Content Script [ISOLATED] (메시지 브릿지)
├── content-main.js         # Content Script [MAIN] (녹화 핵심)
├── sidepanel/
│   ├── sidepanel.html      # Side Panel HTML
│   ├── sidepanel.js        # Side Panel 로직
│   └── sidepanel.css       # Side Panel 스타일
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── _locales/
│   ├── ko/messages.json    # 한국어
│   ├── en/messages.json    # 영어
│   ├── ja/messages.json    # 일본어
│   ├── zh_CN/messages.json # 중국어 간체
│   └── zh_TW/messages.json # 중국어 번체
├── README.md
├── PRIVACY.md
└── PROJECT_SPEC.md         # 이 문서
```

---

## 6. 기술 스택

### 6.1 필수 기술

| 기술 | 용도 |
|------|------|
| **Chrome Extension Manifest V3** | 확장 프로그램 플랫폼 |
| **Service Worker** | 백그라운드 처리 |
| **Content Scripts** | 페이지 내 스크립트 실행 |
| **Side Panel API** | UI 인터페이스 |
| **MediaRecorder API** | 비디오 녹화 |
| **video.captureStream()** | 비디오 스트림 캡처 |
| **Downloads API** | 파일 저장 |

### 6.2 Chrome API 사용 목록

```javascript
// manifest.json permissions
"permissions": [
  "storage",      // 설정 저장
  "tabs",         // 탭 관리
  "alarms",       // 주기적 작업
  "notifications",// 알림
  "sidePanel",    // Side Panel UI
  "downloads",    // 파일 다운로드
  "scripting"     // 동적 스크립트 주입
]

// host_permissions
"host_permissions": [
  "*://*.sooplive.co.kr/*",
  "*://*.afreecatv.com/*"
]
```

### 6.3 코덱 우선순위

```javascript
const codecs = [
  { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },   // 1순위
  { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },   // 2순위
  { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },   // 3순위
  { mime: 'video/webm', name: 'WebM' }                    // 폴백
];
```

---

## 7. 개발 워크플로우

### 7.1 역할 분담

| 역할 | 담당 | 작업 내용 |
|------|------|-----------|
| **기획/요구사항** | 사용자 (Nimda) | 기능 정의, 우선순위 결정 |
| **설계/명세서** | Claude Desktop | 아키텍처 설계, 명세서 작성 |
| **코드 리뷰** | Claude Desktop | 코드 검토, 개선점 제안 |
| **코드 구현** | Claude Code | 실제 코드 작성, 커밋 |
| **테스트** | 사용자 (Nimda) | 기능 테스트, 버그 리포트 |

### 7.2 개발 프로세스

```
1. 요구사항 정의 (사용자)
   "다이얼로그 없이 원클릭으로 녹화하고 싶어"
       ↓
2. 명세서 작성 (Claude Desktop)
   - 아키텍처 설계
   - 파일별 수정 내용
   - Claude Code 실행 커맨드
       ↓
3. 코드 구현 (Claude Code)
   cd 프로젝트폴더 && claude "명세서.md 읽고 구현해줘"
       ↓
4. 코드 리뷰 (Claude Desktop)
   - 구현 검증
   - 개선점 제안
   - 추가 명세서 작성
       ↓
5. 테스트 (사용자)
   - 기능 테스트
   - 버그 리포트
       ↓
6. 반복 (필요시)
```

### 7.3 Claude Code 실행 커맨드 템플릿

```bash
# 기본 형식
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "명세서.md 파일을 읽고 수정사항을 적용해줘. 완료 후 git commit."

# 특정 작업
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "다음을 수행해줘:
1. manifest.json version을 X.X.X로 변경
2. background.js에 함수 추가
3. ...
완료 후: git add -A && git commit -m '커밋 메시지'"
```

### 7.4 명세서 작성 규칙

```markdown
# 명세서 제목

## 변경 배경
- 왜 이 변경이 필요한지

## 수정 파일 목록
| 파일 | 변경 내용 |
|------|-----------|

## 파일별 상세 수정 내용
### 1. 파일명
**수정 위치:** 함수명/줄번호
**기존 코드:**
```javascript
// 기존
```
**변경 코드:**
```javascript
// 변경
```

## Claude Code 실행 커맨드
```bash
실행할 커맨드
```

## 테스트 체크리스트
- [ ] 테스트 항목
```

---

## 8. 기능별 상세 명세

### 8.1 녹화 기능

#### 8.1.1 녹화 시작 (수동)

**트리거:** Side Panel에서 "녹화 시작" 버튼 클릭

**조건:**
- SOOP 방송 페이지 탭이 열려있어야 함
- 비디오가 재생 중이어야 함 (readyState ≥ 2)

**동작:**
1. Side Panel → Background로 START_RECORDING_REQUEST 전송
2. Background → Content Script로 START_RECORDING 전송
3. Content (MAIN)에서 video.captureStream() 실행
4. MediaRecorder 시작 (5초마다 데이터 청크)
5. 진행 상황 5초마다 보고

**결과:**
- 녹화 시작 토스트 표시
- 녹화 카드 UI 표시 (시간, 용량)
- 확장 프로그램 뱃지에 녹화 수 표시

#### 8.1.2 녹화 시작 (자동)

**트리거:** 모니터링 중 방송 시작 감지

**조건:**
- 해당 스트리머의 autoJoin = true
- 해당 스트리머의 autoRecord = true

**동작:**
1. 방송 시작 감지
2. 새 탭에서 방송 페이지 열기
3. 탭 로드 완료 대기 (최대 15초)
4. 비디오 로드 대기 (추가 2초)
5. 녹화 시작 (실패 시 최대 3회 재시도)

#### 8.1.3 녹화 중지

**트리거:** "녹화 중지" 버튼 클릭 또는 탭 닫힘

**동작:**
1. MediaRecorder.stop() 호출
2. 녹화된 청크들을 Blob으로 병합
3. Blob URL 생성
4. Background로 저장 요청 전송
5. chrome.downloads.download() 실행
6. 다운로드/SOOPtalking/폴더에 저장

**파일명 형식:**
```
soop_{스트리머ID}_{YYYYMMDDHHMMSS}.webm
예: soop_streamer123_20250101143052.webm
```

### 8.2 모니터링 기능

#### 8.2.1 방송 상태 체크

**API:** `https://api.m.sooplive.co.kr/broad/a/watch/{streamerId}`

**응답 구조:**
```json
{
  "data": {
    "broad": {
      "broad_no": 12345,       // 0이면 오프라인
      "broad_title": "방송 제목",
      "current_sum_viewer": 100,
      "broad_start": "2025-01-01 14:00:00"
    }
  }
}
```

**체크 주기:**
- autoJoin = true: 5초마다
- autoJoin = false: 30초마다

#### 8.2.2 방송 시작 감지

**조건:** 이전 상태 isLive=false → 현재 상태 isLive=true

**동작:**
1. 알림 표시 (notificationEnabled=true인 경우)
2. 자동 탭 열기 (autoJoin=true인 경우)
3. 자동 녹화 시작 (autoRecord=true인 경우)

#### 8.2.3 방송 종료 감지

**조건:** 이전 상태 isLive=true → 현재 상태 isLive=false

**동작:**
1. 종료 알림 표시 (endNotificationEnabled=true인 경우)
2. 녹화 중이었다면 자동 중지 및 저장

### 8.3 스트리머 관리

#### 8.3.1 스트리머 추가

**입력:** 스트리머 ID (영문 소문자, 숫자, 언더스코어)

**검증:** `/^[a-z0-9_]+$/`

**저장 데이터:**
```javascript
{
  id: "streamerId",
  nickname: "streamerId",  // API에서 가져올 수 있으면 업데이트
  autoJoin: false,
  autoRecord: false,
  addedAt: Date.now()
}
```

#### 8.3.2 스트리머 설정

| 설정 | 설명 | 기본값 |
|------|------|--------|
| autoJoin | 방송 시작 시 자동 탭 열기 | false |
| autoRecord | 방송 시작 시 자동 녹화 | false |

---

## 9. API 및 메시지 프로토콜

### 9.1 Side Panel → Background 메시지

```javascript
// 녹화 시작 요청
{ type: 'START_RECORDING_REQUEST', tabId, streamerId, nickname }

// 녹화 중지 요청
{ type: 'STOP_RECORDING_REQUEST', tabId }

// 상태 조회
{ type: 'GET_STATE' }
{ type: 'GET_ALL_RECORDINGS' }

// 모니터링
{ type: 'SET_MONITORING', enabled: boolean }
{ type: 'REFRESH_STREAMERS' }

// 스트리머 관리
{ type: 'ADD_STREAMER', streamerId }
{ type: 'REMOVE_STREAMER', streamerId }
{ type: 'UPDATE_STREAMER', streamerId, updates }

// 설정
{ type: 'UPDATE_SETTINGS', settings }
```

### 9.2 Background → Side Panel 메시지

```javascript
// 방송 상태 업데이트
{ type: 'BROADCAST_STATUS_UPDATED', data: {...} }

// 녹화 상태 업데이트
{ type: 'RECORDING_STARTED_UPDATE', tabId, streamerId, nickname }
{ type: 'RECORDING_PROGRESS_UPDATE', tabId, streamerId, totalBytes, elapsedTime }
{ type: 'RECORDING_STOPPED_UPDATE', tabId, streamerId, totalBytes, duration, saved }
{ type: 'RECORDING_ERROR_UPDATE', tabId, error }
```

### 9.3 Background → Content Script 메시지

```javascript
{ type: 'START_RECORDING', streamerId, nickname }
{ type: 'STOP_RECORDING' }
{ type: 'GET_RECORDING_STATUS' }
{ type: 'PING' }
```

### 9.4 Content Script 내부 메시지 (window.postMessage)

```javascript
// ISOLATED → MAIN
{ type: 'SOOPTALKING_RECORDER_COMMAND', command, params }

// MAIN → ISOLATED
{ type: 'SOOPTALKING_RECORDING_STARTED', streamerId, nickname, recordingId }
{ type: 'SOOPTALKING_RECORDING_PROGRESS', streamerId, totalBytes, elapsedTime }
{ type: 'SOOPTALKING_RECORDING_STOPPED', streamerId, totalBytes, duration, saved }
{ type: 'SOOPTALKING_RECORDING_ERROR', error }
{ type: 'SOOPTALKING_SAVE_RECORDING', fileName, size, blobUrl, ... }
```

---

## 10. 테스트 체크리스트

### 10.1 수동 녹화 테스트

```
[ ] 1. 확장 프로그램 새로고침
[ ] 2. SOOP 방송 페이지 접속 (play.sooplive.co.kr)
[ ] 3. Side Panel 열기 (확장 아이콘 클릭)
[ ] 4. "현재 시청 중" 카드에 스트리머 정보 표시 확인
[ ] 5. "녹화 시작" 버튼 클릭
[ ] 6. ⭐ 다이얼로그 없이 즉시 녹화 시작 확인
[ ] 7. 녹화 카드에 시간/용량 업데이트 확인 (5초마다)
[ ] 8. "녹화 중지" 버튼 클릭
[ ] 9. 다운로드 폴더/SOOPtalking/에 파일 저장 확인
[ ] 10. 파일 재생 확인
```

### 10.2 자동 녹화 테스트

```
[ ] 1. 스트리머 추가
[ ] 2. 해당 스트리머 설정: 자동 참여 ON + 자동 녹화 ON
[ ] 3. 모니터링 ON
[ ] 4. 방송 시작 대기
[ ] 5. 방송 시작 알림 확인
[ ] 6. 자동 탭 열림 확인
[ ] 7. 자동 녹화 시작 확인
[ ] 8. 방송 종료 시 자동 녹화 중지 + 저장 확인
```

### 10.3 Side Panel 닫힘 테스트

```
[ ] 1. 녹화 시작
[ ] 2. Side Panel 닫기
[ ] 3. 다른 탭으로 이동
[ ] 4. 잠시 대기 (30초~1분)
[ ] 5. Side Panel 다시 열기
[ ] 6. 녹화 상태 유지 확인
[ ] 7. 녹화 중지 → 파일 저장 확인
```

### 10.4 탭 닫힘 테스트

```
[ ] 1. 녹화 시작
[ ] 2. 녹화 중인 탭 닫기
[ ] 3. Side Panel에서 녹화 상태 정리 확인
[ ] 4. 파일 저장 확인 (가능한 경우)
```

### 10.5 콘솔 로그 확인

```javascript
// 정상 동작 시 콘솔 로그
[숲토킹 Recorder] 코덱 선택: AV1  // 또는 VP9
[숲토킹 Recorder] 스트림 획득 성공
[숲토킹 Recorder] 녹화 시작: {streamerId}
[숲토킹 Recorder] 녹화 중지됨
[숲토킹 Recorder] 파일 저장: soop_xxx.webm
```

---

## 11. 알려진 이슈 및 해결책

### 11.1 해결된 이슈

| 이슈 | 원인 | 해결책 |
|------|------|--------|
| tabCapture 권한 오류 | Side Panel에서 activeTab 제한 | video.captureStream() 사용 |
| Offscreen에서 녹화 실패 | tabCapture 사용자 제스처 필요 | MAIN world에서 직접 녹화 |
| getDisplayMedia 다이얼로그 | Chrome 보안 정책 | video.captureStream() 사용 |

### 11.2 주의 사항

| 상황 | 증상 | 대응 |
|------|------|------|
| 비디오 미로드 | "비디오 요소를 찾을 수 없습니다" | 페이지 로드 완료 후 재시도 |
| Extension 무효화 | 메시지 전송 실패 | 페이지 새로고침 필요 |
| 긴 녹화 | 메모리 증가 | 5초마다 청크 처리로 완화 |

### 11.3 시도했지만 실패한 방식들

```
❌ Offscreen Document + tabCapture.getMediaStreamId()
   → 사용자 제스처 컨텍스트 소멸

❌ Background에서 tabCapture.getMediaStreamId()
   → Side Panel에서 호출 시 권한 오류

❌ Side Panel에서 tabCapture.getMediaStreamId()
   → activeTab 권한 제한

❌ getDisplayMedia({ preferCurrentTab: true })
   → 여전히 다이얼로그 발생

✅ MAIN world에서 video.captureStream()
   → 다이얼로그 없이 작동!
```

---

## 12. 버전 히스토리

| 버전 | 날짜 | 주요 변경 |
|------|------|-----------|
| 3.2.1 | 예정 | 안정화: 메모리 관리, 자동 녹화 개선 |
| 3.2.0 | 2025-01-01 | video.captureStream 기반 다이얼로그 없는 녹화 |
| 3.1.2 | 2025-01-01 | 버전 통일 + 초기 로드 + 탭 닫힘 감지 |
| 3.1.1 | 2025-01-01 | tabCapture를 Side Panel에서 호출 + AV1 코덱 |
| 3.1.0 | 2024-12-31 | tabCapture API 기반 원터치 녹화 시도 |
| 3.0.0 | 2024-12-31 | Offscreen 기반 아키텍처 (실패) |
| 2.5.0 | 이전 | video.captureStream 기반 (원본) |

---

## 📌 빠른 참조

### 새 대화에서 작업 시작하기

```markdown
# 숲토킹 프로젝트 작업 요청

## 프로젝트 위치
C:\Users\ADMIN\Claude\soop-streamer-alert

## 현재 버전
v3.2.x

## 참조 문서
- PROJECT_SPEC.md (이 문서)
- PATCH_v3.2.1.md (다음 패치 명세)

## 개발 원칙
1. 다이얼로그/팝업 절대 금지
2. 원터치 작동
3. Side Panel 닫아도 녹화 유지
4. video.captureStream() 사용 (MAIN world)

## 역할
- Claude Desktop: 기획, 명세서, 코드 리뷰
- Claude Code: 코드 구현

## 요청 사항
[여기에 작업 내용 작성]
```

### Claude Code 기본 커맨드

```bash
# 명세서 기반 구현
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "XXX.md 파일을 읽고 수정사항을 적용해줘. 완료 후 git commit."

# 코드 리뷰 요청
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "현재 코드를 리뷰하고 개선점을 알려줘."

# 특정 파일 수정
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "background.js의 XXX 함수를 수정해줘: [수정 내용]"
```

---

**문서 끝**
