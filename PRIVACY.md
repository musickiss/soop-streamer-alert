# 개인정보처리방침 (Privacy Policy)

**최종 수정일:** 2025년 1월 1일

## 개요

"숲토킹 - SOOP 스트리머 방송 알림" 크롬 확장 프로그램(이하 "본 확장프로그램")은 사용자의 개인정보를 수집, 저장, 전송하지 않습니다.

---

## 수집하는 정보

**본 확장프로그램은 어떠한 개인정보도 수집하지 않습니다.**

- 사용자 식별 정보 (이름, 이메일 등) 수집 안 함
- 로그인 정보 및 인증 정보 수집 안 함
- 쿠키 및 세션 정보 수집 안 함
- 브라우징 기록 수집 안 함
- 위치 정보 수집 안 함

---

## 데이터 저장

본 확장프로그램은 다음 데이터를 **사용자의 로컬 브라우저에만** 저장합니다:

| 데이터 유형 | 저장 위치 | 설명 |
|------------|----------|------|
| 스트리머 ID 목록 | Chrome Storage | 사용자가 등록한 스트리머 목록 |
| 확장프로그램 설정 | Chrome Storage | 알림, 자동참여, 자동녹화 설정 |
| 녹화 파일 | 다운로드 폴더 | `다운로드/SOOPtalking/*.webm` |

이 데이터는 Chrome의 `chrome.storage.local` API 및 `chrome.downloads` API를 사용하여 **사용자의 기기에만 저장**되며, 외부 서버로 전송되지 않습니다.

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

## 외부 통신

본 확장프로그램은 다음 목적으로만 외부와 통신합니다:

| 대상 | 목적 | 수집 정보 |
|------|------|----------|
| SOOP 공식 API (`sooplive.co.kr`) | 스트리머 방송 상태 확인 | 없음 (공개된 방송 정보만 조회) |

- 사용자 데이터를 외부 서버로 전송하지 않습니다.
- 분석 도구(Analytics)를 사용하지 않습니다.
- 광고 네트워크와 연동하지 않습니다.
- 제3자와 데이터를 공유하지 않습니다.

---

## 권한 사용 목적

본 확장프로그램이 요청하는 브라우저 권한과 그 사용 목적:

| 권한 | 사용 목적 |
|------|----------|
| `storage` | 스트리머 목록 및 설정을 로컬에 저장 |
| `tabs` | 방송 시작 시 새 탭 열기 및 기존 탭 확인 |
| `notifications` | 방송 시작/종료 알림 표시 |
| `sidePanel` | Side Panel UI 표시 |
| `downloads` | 녹화 파일을 다운로드 폴더에 저장 |
| `scripting` | 방송 페이지에 녹화 스크립트 주입 |
| `host_permissions` (sooplive.co.kr) | SOOP 방송 상태 API 호출 및 녹화 기능 |

---

## 데이터 삭제

### 확장프로그램 데이터
확장프로그램을 제거하면 Chrome Storage에 저장된 모든 데이터가 자동으로 삭제됩니다.

### 녹화 파일
녹화 파일은 다운로드 폴더에 저장되므로 확장프로그램 제거 후에도 남아있습니다.
수동으로 삭제하려면 `다운로드/SOOPtalking/` 폴더를 삭제하십시오.

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

**Last Updated:** January 1, 2025

## Overview

The "SOOPtalking - SOOP Streamer Live Alert" Chrome extension (hereinafter "this extension") does not collect, store, or transmit any personal information from users.

---

## Information We Collect

**This extension does not collect any personal information.**

- No collection of user identification information (name, email, etc.)
- No collection of login or authentication information
- No collection of cookies or session information
- No collection of browsing history
- No collection of location information

---

## Data Storage

This extension stores the following data **only in the user's local browser**:

| Data Type | Storage Location | Description |
|-----------|-----------------|-------------|
| Streamer ID list | Chrome Storage | List of streamers registered by user |
| Extension settings | Chrome Storage | Notification, auto-join, auto-record settings |
| Recording files | Downloads folder | `Downloads/SOOPtalking/*.webm` |

This data is stored **only on the user's device** using Chrome's `chrome.storage.local` API and `chrome.downloads` API, and is not transmitted to any external servers.

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

## External Communication

This extension communicates externally only for the following purpose:

| Target | Purpose | Information Collected |
|--------|---------|----------------------|
| SOOP Official API (`sooplive.co.kr`) | Check streamer broadcast status | None (only queries publicly available broadcast information) |

- User data is not transmitted to external servers.
- No analytics tools are used.
- No integration with advertising networks.
- No data sharing with third parties.

---

## Purpose of Permissions

Browser permissions requested by this extension and their purposes:

| Permission | Purpose |
|------------|---------|
| `storage` | Store streamer list and settings locally |
| `tabs` | Open new tabs when broadcasts start and check existing tabs |
| `notifications` | Display broadcast start/end notifications |
| `sidePanel` | Display Side Panel UI |
| `downloads` | Save recording files to downloads folder |
| `scripting` | Inject recording script into broadcast pages |
| `host_permissions` (sooplive.co.kr) | Call SOOP broadcast status API and enable recording |

---

## Data Deletion

### Extension Data
All data stored in Chrome Storage is automatically deleted when the extension is removed.

### Recording Files
Recording files are saved in the downloads folder and remain after extension removal.
To delete manually, remove the `Downloads/SOOPtalking/` folder.

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
