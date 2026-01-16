# 개인정보처리방침 (Privacy Policy)

**최종 수정일:** 2025년 1월 16일

## 개요

"숲토킹 - SOOP 스트리머 방송 알림" 크롬 확장 프로그램(이하 "본 확장프로그램")은 서비스 개선을 위해 익명의 사용 통계만 수집하며, 개인을 식별할 수 있는 정보는 수집하지 않습니다.

---

## 수집하는 정보

### 익명 사용 통계 (v3.6.0+)

본 확장프로그램은 서비스 개선을 위해 Google Analytics 4 (GA4)를 통해 **익명의 사용 통계**를 수집합니다.

| 수집 항목 | 설명 | 예시 |
|----------|------|------|
| 확장프로그램 버전 | 사용 중인 버전 | `5.4.2` |
| 기능 사용 이벤트 | 어떤 기능이 사용되는지 | 녹화 시작, 모니터링 ON/OFF |
| 브라우저 언어 | 다국어 지원 개선용 | `ko`, `en`, `ja` |
| 익명 세션 ID | 세션 구분용 (무작위 생성) | `abc123xyz` |

#### ❌ 수집하지 않는 정보

- 사용자 식별 정보 (이름, 이메일, IP 주소 등)
- 로그인 정보 및 인증 정보
- 쿠키 및 세션 정보
- 브라우징 기록
- 위치 정보
- 스트리머 ID 또는 시청 정보
- 녹화 파일 정보
- 채팅 메시지 내용

---

## 데이터 저장

본 확장프로그램은 다음 데이터를 **사용자의 로컬 브라우저에만** 저장합니다:

| 데이터 유형 | 저장 위치 | 설명 |
|------------|----------|------|
| 스트리머 ID 목록 | Chrome Storage | 사용자가 등록한 스트리머 목록 |
| 확장프로그램 설정 | Chrome Storage | 알림, 자동참여, 자동녹화 설정 |
| 녹화 파일 | 다운로드 폴더 | `다운로드/SOOPtalking/*.webm` |
| 채팅 데이터 (v5.0.0+) | IndexedDB / SQLite | 수집된 채팅 메시지 (아래 상세 설명 참조) |
| 채팅 백업 파일 (v5.4.2+) | 다운로드 폴더 | `다운로드/SOOPtalking/chat/auto-backup/*.csv` |

이 데이터는 Chrome의 `chrome.storage.local` API, `IndexedDB`, `chrome.downloads` API를 사용하여 **사용자의 기기에만 저장**되며, 외부 서버로 전송되지 않습니다.

---

## 녹화 기능

본 확장프로그램은 방송 녹화 기능을 제공합니다:

- **녹화 방식**: 브라우저 내 video.captureStream() API 사용
- **저장 위치**: 사용자 다운로드 폴더 내 `SOOPtalking` 하위 폴더
- **파일 형식**: WebM (VP9/AV1 코덱)
- **외부 전송**: 녹화 파일은 외부 서버로 전송되지 않음

### ⚠️ 저작권 고지

녹화된 콘텐츠의 저작권은 해당 스트리머 및 SOOP(숲)에 있습니다.
- 녹화 파일은 **개인적 시청 목적**으로만 사용하십시오.
- 녹화물의 **재배포, 상업적 이용, 무단 공유는 저작권법 위반**입니다.
- 본 확장프로그램 개발자는 사용자의 녹화물 사용에 대해 책임지지 않습니다.

---

## 채팅 수집 기능 (v5.0.0+)

본 확장프로그램은 방송 채팅 수집 기능을 제공합니다. 이 기능은 **사용자가 직접 활성화**해야 작동합니다.

### 저장되는 채팅 데이터

| 데이터 항목 | 설명 | 외부 전송 |
|------------|------|----------|
| 채팅 메시지 내용 | 방송 중 발생한 채팅 텍스트 | ❌ 없음 |
| 작성자 닉네임 | 채팅 작성자의 표시 닉네임 | ❌ 없음 |
| 작성자 ID | 채팅 작성자의 사용자 ID | ❌ 없음 |
| 타임스탬프 | 채팅 발생 시각 | ❌ 없음 |
| 스트리머 정보 | 방송 중인 스트리머 ID/닉네임 | ❌ 없음 |
| 세션 정보 | 방송 세션 구분용 정보 | ❌ 없음 |

### 데이터 저장 방식

- **저장 위치**: 사용자 브라우저 내 IndexedDB 또는 SQLite (로컬 저장)
- **저장 용량**: 최신 20,000건 유지, 초과 시 오래된 데이터 자동 백업
- **자동 백업**: 30,000건 초과 시 오래된 데이터를 CSV 파일로 자동 다운로드
- **백업 파일 위치**: `다운로드/SOOPtalking/chat/auto-backup/*.csv`
- **외부 전송**: 채팅 데이터는 **절대 외부 서버로 전송되지 않음**

### 수집 모드

사용자는 다음 수집 모드 중 선택할 수 있습니다:
- **수집 안함**: 채팅 수집 기능 비활성화
- **선택한 스트리머만** (기본값): 등록된 스트리머 방송에서만 수집
- **모든 채팅방**: 모든 방송에서 수집

### 채팅 데이터 삭제

- **날짜별 삭제**: 특정 날짜의 채팅 데이터 삭제 가능
- **스트리머별 삭제**: 특정 스트리머의 채팅 데이터 삭제 가능
- **전체 삭제**: 모든 채팅 데이터 일괄 삭제 가능
- **확장프로그램 제거 시**: IndexedDB/SQLite 데이터 자동 삭제

### ⚠️ 채팅 데이터 관련 고지

- 채팅 데이터는 **개인적 기록 목적**으로만 사용하십시오.
- 수집된 채팅 데이터의 **재배포, 상업적 이용, 무단 공유는 금지**됩니다.
- 타인의 개인정보가 포함된 채팅 내용의 처리에 주의하십시오.
- 본 확장프로그램 개발자는 사용자의 채팅 데이터 사용에 대해 책임지지 않습니다.

---

## 외부 통신

본 확장프로그램은 다음 목적으로만 외부와 통신합니다:

| 대상 | 목적 | 수집 정보 |
|------|------|----------|
| SOOP 공식 API (`sooplive.co.kr`) | 스트리머 방송 상태 확인 | 없음 (공개된 방송 정보만 조회) |
| Google Analytics (`google-analytics.com`) | 익명 사용 통계 수집 | 위 "수집하는 정보" 섹션 참조 |

- 개인 식별 가능한 데이터를 외부 서버로 전송하지 않습니다.
- 익명 사용 통계만 Google Analytics로 전송됩니다.
- 광고 네트워크와 연동하지 않습니다.
- 제3자와 개인정보를 공유하지 않습니다.

---

## 권한 사용 목적

본 확장프로그램이 요청하는 브라우저 권한과 그 사용 목적:

| 권한 | 사용 목적 |
|------|----------|
| `storage` | 스트리머 목록 및 설정을 로컬에 저장 |
| `unlimitedStorage` | 채팅 데이터 저장을 위한 확장 용량 (v5.0.0+) |
| `tabs` | 방송 시작 시 새 탭 열기 및 기존 탭 확인 |
| `notifications` | 방송 시작/종료 알림 표시 |
| `sidePanel` | Side Panel UI 표시 |
| `downloads` | 녹화 파일 및 채팅 백업 파일을 다운로드 폴더에 저장 |
| `scripting` | 방송 페이지에 녹화/채팅 수집 스크립트 주입 |
| `alarms` | 주기적 작업 스케줄링 (백업 등) |
| `host_permissions` (sooplive.co.kr) | SOOP 방송 상태 API 호출, 녹화 및 채팅 수집 기능 |

---

## 데이터 삭제

### 확장프로그램 데이터
확장프로그램을 제거하면 Chrome Storage 및 IndexedDB/SQLite에 저장된 모든 데이터가 자동으로 삭제됩니다.

### 녹화 파일
녹화 파일은 다운로드 폴더에 저장되므로 확장프로그램 제거 후에도 남아있습니다.
수동으로 삭제하려면 `다운로드/SOOPtalking/` 폴더를 삭제하십시오.

### 채팅 데이터 (v5.0.0+)
- **확장프로그램 내 삭제**: 채팅 탭 → 설정 → 데이터 관리에서 날짜별/스트리머별/전체 삭제 가능
- **확장프로그램 제거 시**: IndexedDB/SQLite 데이터 자동 삭제
- **백업 파일**: `다운로드/SOOPtalking/chat/auto-backup/` 폴더의 CSV 파일은 수동 삭제 필요

---

## 아동 개인정보 보호

본 확장프로그램은 아동을 대상으로 하지 않으며, 의도적으로 13세 미만 아동의 개인정보를 수집하지 않습니다.

---

## 개인정보처리방침 변경

본 개인정보처리방침은 변경될 수 있으며, 변경 시 이 페이지에 업데이트됩니다.

---

## 문의

본 개인정보처리방침에 대한 문의사항이 있으시면 GitHub Issues를 통해 연락해 주세요.

- GitHub: https://github.com/musickiss/soop-streamer-alert/issues

---

# Privacy Policy (English)

**Last Updated:** January 16, 2025

## Overview

The "SOOPtalking - SOOP Streamer Live Alert" Chrome extension (hereinafter "this extension") collects only anonymous usage statistics to improve the service and does not collect any personally identifiable information.

---

## Information We Collect

### Anonymous Usage Statistics (v3.6.0+)

This extension collects **anonymous usage statistics** through Google Analytics 4 (GA4) to improve the service.

| Collected Item | Description | Example |
|---------------|-------------|---------|
| Extension version | Version in use | `5.4.2` |
| Feature usage events | Which features are used | Recording start, Monitoring ON/OFF |
| Browser language | For multilingual support improvement | `ko`, `en`, `ja` |
| Anonymous session ID | For session distinction (randomly generated) | `abc123xyz` |

#### ❌ Information NOT Collected

- User identification information (name, email, IP address, etc.)
- Login or authentication information
- Cookies or session information
- Browsing history
- Location information
- Streamer IDs or viewing information
- Recording file information
- Chat message contents

---

## Data Storage

This extension stores the following data **only in the user's local browser**:

| Data Type | Storage Location | Description |
|-----------|-----------------|-------------|
| Streamer ID list | Chrome Storage | List of streamers registered by user |
| Extension settings | Chrome Storage | Notification, auto-join, auto-record settings |
| Recording files | Downloads folder | `Downloads/SOOPtalking/*.webm` |
| Chat data (v5.0.0+) | IndexedDB / SQLite | Collected chat messages (see details below) |
| Chat backup files (v5.4.2+) | Downloads folder | `Downloads/SOOPtalking/chat/auto-backup/*.csv` |

This data is stored **only on the user's device** using Chrome's `chrome.storage.local` API, `IndexedDB`, and `chrome.downloads` API, and is not transmitted to any external servers.

---

## Recording Feature

This extension provides broadcast recording functionality:

- **Recording method**: Browser's video.captureStream() API
- **Storage location**: `SOOPtalking` subfolder in user's Downloads folder
- **File format**: WebM (VP9/AV1 codec)
- **External transmission**: Recording files are NOT transmitted to external servers

### ⚠️ Copyright Notice

The copyright of recorded content belongs to the respective streamer and SOOP.
- Recording files should be used for **personal viewing purposes only**.
- **Redistribution, commercial use, or unauthorized sharing of recordings is a copyright violation.**
- The developer of this extension is not responsible for users' use of recorded content.

---

## Chat Collection Feature (v5.0.0+)

This extension provides broadcast chat collection functionality. This feature **must be manually activated by the user**.

### Stored Chat Data

| Data Item | Description | External Transmission |
|-----------|-------------|----------------------|
| Chat message content | Chat text during broadcast | ❌ None |
| Author nickname | Display nickname of chat author | ❌ None |
| Author ID | User ID of chat author | ❌ None |
| Timestamp | Time when chat occurred | ❌ None |
| Streamer info | Streamer ID/nickname of broadcast | ❌ None |
| Session info | Information for broadcast session distinction | ❌ None |

### Data Storage Method

- **Storage location**: IndexedDB or SQLite within user's browser (local storage)
- **Storage capacity**: Maintains latest 20,000 messages, older data automatically backed up when exceeded
- **Auto backup**: Old data automatically downloaded as CSV files when exceeding 30,000 messages
- **Backup file location**: `Downloads/SOOPtalking/chat/auto-backup/*.csv`
- **External transmission**: Chat data is **NEVER transmitted to external servers**

### Collection Modes

Users can choose from the following collection modes:
- **Do not collect**: Chat collection feature disabled
- **Selected streamers only** (default): Collect only from registered streamer broadcasts
- **All chat rooms**: Collect from all broadcasts

### Chat Data Deletion

- **Delete by date**: Can delete chat data for specific dates
- **Delete by streamer**: Can delete chat data for specific streamers
- **Delete all**: Can delete all chat data at once
- **When extension is removed**: IndexedDB/SQLite data automatically deleted

### ⚠️ Chat Data Notice

- Chat data should be used for **personal recording purposes only**.
- **Redistribution, commercial use, or unauthorized sharing of collected chat data is prohibited.**
- Please be careful when handling chat content that may contain others' personal information.
- The developer of this extension is not responsible for users' use of chat data.

---

## External Communication

This extension communicates externally only for the following purposes:

| Target | Purpose | Information Collected |
|--------|---------|----------------------|
| SOOP Official API (`sooplive.co.kr`) | Check streamer broadcast status | None (only queries publicly available broadcast information) |
| Google Analytics (`google-analytics.com`) | Anonymous usage statistics | See "Information We Collect" section above |

- No personally identifiable data is transmitted to external servers.
- Only anonymous usage statistics are sent to Google Analytics.
- No integration with advertising networks.
- No sharing of personal information with third parties.

---

## Purpose of Permissions

Browser permissions requested by this extension and their purposes:

| Permission | Purpose |
|------------|---------|
| `storage` | Store streamer list and settings locally |
| `unlimitedStorage` | Extended storage capacity for chat data (v5.0.0+) |
| `tabs` | Open new tabs when broadcasts start and check existing tabs |
| `notifications` | Display broadcast start/end notifications |
| `sidePanel` | Display Side Panel UI |
| `downloads` | Save recording files and chat backup files to downloads folder |
| `scripting` | Inject recording/chat collection scripts into broadcast pages |
| `alarms` | Schedule periodic tasks (backups, etc.) |
| `host_permissions` (sooplive.co.kr) | Call SOOP broadcast status API, enable recording and chat collection |

---

## Data Deletion

### Extension Data
All data stored in Chrome Storage and IndexedDB/SQLite is automatically deleted when the extension is removed.

### Recording Files
Recording files are saved in the downloads folder and remain after extension removal.
To delete manually, remove the `Downloads/SOOPtalking/` folder.

### Chat Data (v5.0.0+)
- **Delete within extension**: Chat Tab → Settings → Data Management allows deletion by date/streamer/all
- **When extension is removed**: IndexedDB/SQLite data automatically deleted
- **Backup files**: CSV files in `Downloads/SOOPtalking/chat/auto-backup/` folder must be manually deleted

---

## Children's Privacy

This extension is not intended for children and does not intentionally collect personal information from children under 13 years of age.

---

## Changes to Privacy Policy

This privacy policy may be updated, and any changes will be posted on this page.

---

## Contact

If you have any questions about this privacy policy, please contact us through GitHub Issues.

- GitHub: https://github.com/musickiss/soop-streamer-alert/issues
