# Changelog

## v2.2.0 (2025-12-31)

### New Features
- **MSE 오디오 캡처 기능 추가**: MediaSource.addSourceBuffer 후킹으로 fMP4 오디오/비디오 캡처 지원
- **audio-hook.js 추가**: 페이지 로드 전에 실행되어 초기화 세그먼트부터 완벽하게 캡처
- **콘솔 명령어 도구 제공**: `soopAudio.start()`, `soopAudio.stop()`, `soopAudio.downloadAudio()` 등

### Technical Details
- Content Script `run_at: document_start`와 `world: MAIN` 설정으로 페이지 스크립트보다 먼저 후킹
- AAC-LC 오디오 (mp4a.40.2) 및 H.264 비디오 (avc1.64002a) fMP4 형식 지원
- 초기화 세그먼트(ftyp+moov)와 미디어 세그먼트(moof+mdat) 모두 캡처

## v1.6.7 (2025-12-19)

### Bug Fixes
- **방송 재시작 시 이전 방송 탭이 아닌 새 탭 열기**: 스트리머가 방송 종료 후 재시작할 때 이전 방송 탭(종료된 방송)을 활성화하던 문제 수정. 방송 번호를 비교하여 다른 방송이면 새 탭을 열도록 개선

## v1.6.6 (2025-12-19)

### Bug Fixes
- **오프라인 탭 자동 종료 설정 무시 버그 수정**: 자동참여 스트리머 방송 종료 시 `autoCloseOfflineTabs` 설정이 무시되고 항상 탭이 닫히던 문제 수정
- **브라우저 재시작 후 탭 관리 불가 버그 수정**: 브라우저 재시작 후 `openedTabs`가 초기화되어 탭을 찾지 못하던 문제를 URL 패턴 검색으로 해결

## v1.6.5 (2025-12-19)

### Improvements
- 브라우저 재시작 시 동작 개선

## v1.6.4 (2025-12-19)

### Improvements
- 네트워크 오류 처리 개선
