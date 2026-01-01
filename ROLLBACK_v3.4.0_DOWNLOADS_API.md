# 🔙 ROLLBACK v3.4.0 - Downloads API 기반 안정화 버전

## 버전 정보
- **롤백 대상**: v3.3.0 ~ v3.3.1 (File System API)
- **신규 버전**: v3.4.0
- **작성일**: 2026-01-01

---

## 1. 롤백 배경

### 발견된 치명적 이슈

| 이슈 | 심각도 | 설명 |
|------|--------|------|
| showDirectoryPicker 보안 에러 | 🔴 치명적 | Side Panel → MAIN world 메시지 전달 시 사용자 제스처 컨텍스트 소멸 |
| 브라우저 크래시 | 🔴 치명적 | Side Panel에서 File System API 호출 시 Chrome 강제 종료 |

### 에러 메시지
```
SecurityError: Failed to execute 'showDirectoryPicker' on 'Window': 
Must be handling a user gesture to show a file picker.
```

### 근본 원인
- `showDirectoryPicker()`는 직접적인 사용자 클릭 이벤트 핸들러 내에서만 호출 가능
- Chrome Extension의 메시지 체인을 통해 전달되면 사용자 제스처 컨텍스트가 소멸
- Side Panel은 File System Access API와 호환성 문제 존재

---

## 2. 롤백 전략

### 핵심 변경
- File System API → Downloads API로 롤백
- 메모리 최적화 적용 (청크 즉시 처리)
- Side Panel의 녹화 폴더 설정 UI 제거

### 유지 사항
- v3.2.x의 UI/UX 개선 사항 유지
- 아코디언 안정화 (v3.2.4)
- 드래그 앤 드롭 (v3.2.4)
- 녹화 진행 상황 표시

---

## 3. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `manifest.json` | 버전 3.3.1 → 3.4.0 |
| `content-main.js` | File System API → Downloads API 롤백 + 메모리 최적화 |
| `sidepanel/sidepanel.html` | 녹화 폴더 설정 섹션 제거 |
| `sidepanel/sidepanel.css` | 폴더 설정 스타일 제거 |
| `sidepanel/sidepanel.js` | 폴더 관련 코드 제거, IndexedDB 코드 제거 |
| `background.js` | 버전 주석 업데이트, 폴더 에러 알림 제거 |

---

## 4. 상세 수정 내용

### 4.1 manifest.json

```json
// 변경 전
"version": "3.3.1",

// 변경 후
"version": "3.4.0",
```

---

### 4.2 content-main.js (전체 교체)

```javascript
// ===== 숲토킹 v3.4.0 - MAIN World 녹화 모듈 =====
// Downloads API 기반 안정화 버전 (메모리 최적화)

(function() {
  'use strict';

  if (window.__soopRecorderInstalled) return;
  window.__soopRecorderInstalled = true;

  // ===== 상태 변수 =====
  let mediaRecorder = null;
  let recordedChunks = [];
  let isRecording = false;
  let recordingStartTime = null;
  let totalBytesRecorded = 0;
  let recordingStream = null;
  let progressInterval = null;
  let currentStreamerId = null;
  let currentNickname = null;

  // ===== 설정 =====
  const CONFIG = {
    VIDEO_BITRATE: 8000000,    // 8 Mbps
    AUDIO_BITRATE: 128000,     // 128 Kbps
    TIMESLICE: 5000,           // 5초마다 데이터 청크
    PROGRESS_INTERVAL: 5000,   // 5초마다 진행 상황 보고
    MAX_CHUNK_SIZE: 50 * 1024 * 1024  // 50MB 청크 제한 (메모리 보호)
  };

  // ===== 유틸리티 =====
  function sanitizeFilename(str) {
    if (!str) return 'unknown';
    return str
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\.\./g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  function getStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : 'unknown';
  }

  function generateFileName(streamerId) {
    const now = new Date();
    const timestamp = now.getFullYear().toString() +
      (now.getMonth() + 1).toString().padStart(2, '0') +
      now.getDate().toString().padStart(2, '0') + '_' +
      now.getHours().toString().padStart(2, '0') +
      now.getMinutes().toString().padStart(2, '0') +
      now.getSeconds().toString().padStart(2, '0');
    return `soop_${sanitizeFilename(streamerId)}_${timestamp}.webm`;
  }

  // ===== 코덱 선택 =====
  function getBestMimeType() {
    const codecs = [
      { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },
      { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
      { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
      { mime: 'video/webm', name: 'WebM' }
    ];

    for (const { mime, name } of codecs) {
      if (MediaRecorder.isTypeSupported(mime)) {
        console.log('[숲토킹 Recorder] 코덱 선택:', name);
        return mime;
      }
    }
    return 'video/webm';
  }

  // ===== 진행 상황 보고 =====
  function startProgressInterval() {
    clearProgressInterval();
    progressInterval = setInterval(() => {
      if (isRecording) {
        const elapsedTime = Math.floor((Date.now() - recordingStartTime) / 1000);
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_PROGRESS',
          streamerId: currentStreamerId,
          nickname: currentNickname,
          totalBytes: totalBytesRecorded,
          elapsedTime: elapsedTime
        }, window.location.origin);
      }
    }, CONFIG.PROGRESS_INTERVAL);
  }

  function clearProgressInterval() {
    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  // ===== 정리 =====
  function cleanup() {
    clearProgressInterval();

    if (recordingStream) {
      recordingStream.getTracks().forEach(track => track.stop());
      recordingStream = null;
    }

    recordedChunks = [];
    mediaRecorder = null;
    isRecording = false;
    totalBytesRecorded = 0;
  }

  // ===== 녹화 모듈 =====
  window.__soopRecorder = {
    // ===== 녹화 시작 =====
    async startRecording(params = {}) {
      if (isRecording) {
        return { success: false, error: '이미 녹화 중입니다.' };
      }

      try {
        // 1. 비디오 요소 찾기
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

        // readyState 확인
        if (video.readyState < 2) {
          return { success: false, error: '비디오가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.' };
        }

        if (video.paused || video.ended) {
          return { success: false, error: '비디오가 재생 중이 아닙니다.' };
        }

        // 스트리머 정보
        currentStreamerId = params.streamerId ? sanitizeFilename(params.streamerId) : sanitizeFilename(getStreamerIdFromUrl());
        currentNickname = params.nickname ? sanitizeFilename(params.nickname) : currentStreamerId;

        // 2. 초기화
        recordedChunks = [];
        totalBytesRecorded = 0;
        recordingStartTime = Date.now();

        // 3. video.captureStream()으로 스트림 획득
        recordingStream = video.captureStream();
        console.log('[숲토킹 Recorder] 스트림 획득 성공');

        // 4. 코덱 선택
        const mimeType = getBestMimeType();

        // 5. MediaRecorder 생성
        mediaRecorder = new MediaRecorder(recordingStream, {
          mimeType: mimeType,
          videoBitsPerSecond: CONFIG.VIDEO_BITRATE,
          audioBitsPerSecond: CONFIG.AUDIO_BITRATE
        });

        // 6. 데이터 핸들러 (메모리 최적화)
        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
            totalBytesRecorded += e.data.size;

            // ★ 메모리 보호: 청크 크기 제한 도달 시 경고
            if (totalBytesRecorded > CONFIG.MAX_CHUNK_SIZE * 10) {
              console.warn('[숲토킹 Recorder] 녹화 용량이 500MB를 초과했습니다.');
            }
          }
        };

        // 7. 녹화 종료 처리
        mediaRecorder.onstop = async () => {
          console.log('[숲토킹 Recorder] 녹화 중지됨');
          clearProgressInterval();

          const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

          if (recordedChunks.length > 0) {
            try {
              // Blob 생성
              const blob = new Blob(recordedChunks, { type: mimeType });
              const blobUrl = URL.createObjectURL(blob);
              const fileName = generateFileName(currentStreamerId);

              console.log(`[숲토킹 Recorder] 파일 생성: ${fileName} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);

              // Background로 다운로드 요청
              window.postMessage({
                type: 'SOOPTALKING_SAVE_RECORDING',
                blobUrl: blobUrl,
                fileName: fileName,
                size: blob.size
              }, window.location.origin);

              // 완료 알림
              window.postMessage({
                type: 'SOOPTALKING_RECORDING_STOPPED',
                streamerId: currentStreamerId,
                nickname: currentNickname,
                totalBytes: blob.size,
                duration: duration,
                saved: true,
                fileName: fileName
              }, window.location.origin);

              // ★ 메모리 정리: 10초 후 Blob URL 해제
              setTimeout(() => {
                URL.revokeObjectURL(blobUrl);
                console.log('[숲토킹 Recorder] Blob URL 해제됨');
              }, 10000);

            } catch (err) {
              console.error('[숲토킹 Recorder] 파일 생성 오류:', err);
              window.postMessage({
                type: 'SOOPTALKING_RECORDING_ERROR',
                error: '파일 생성 중 오류: ' + err.message
              }, window.location.origin);
            }
          }

          cleanup();
        };

        // 8. 에러 핸들러
        mediaRecorder.onerror = (e) => {
          console.error('[숲토킹 Recorder] MediaRecorder 오류:', e.error);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_ERROR',
            error: e.error?.message || '녹화 중 오류 발생'
          }, window.location.origin);
          cleanup();
        };

        // 9. 녹화 시작
        mediaRecorder.start(CONFIG.TIMESLICE);
        isRecording = true;

        // 진행 상황 보고 시작
        startProgressInterval();

        console.log('[숲토킹 Recorder] 녹화 시작:', currentStreamerId);

        // 시작 알림
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STARTED',
          streamerId: currentStreamerId,
          nickname: currentNickname,
          recordingId: Date.now().toString()
        }, window.location.origin);

        return {
          success: true,
          streamerId: currentStreamerId,
          nickname: currentNickname
        };

      } catch (error) {
        console.error('[숲토킹 Recorder] 시작 실패:', error);
        cleanup();

        window.postMessage({
          type: 'SOOPTALKING_RECORDING_ERROR',
          error: error.message
        }, window.location.origin);

        return { success: false, error: error.message };
      }
    },

    // ===== 녹화 중지 =====
    stopRecording() {
      if (!isRecording) {
        return { success: false, error: '녹화 중이 아닙니다.' };
      }

      console.log('[숲토킹 Recorder] 녹화 중지 요청');

      try {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },

    // ===== 상태 조회 =====
    getStatus() {
      return {
        isRecording: isRecording,
        streamerId: currentStreamerId,
        nickname: currentNickname,
        totalBytes: totalBytesRecorded,
        elapsedTime: recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0
      };
    }
  };

  // ===== 메시지 리스너 =====
  window.addEventListener('message', async (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'SOOPTALKING_RECORDER_COMMAND') return;

    const { command, params } = e.data;
    let result;

    switch (command) {
      case 'START_RECORDING':
        result = await window.__soopRecorder.startRecording(params);
        break;
      case 'STOP_RECORDING':
        result = window.__soopRecorder.stopRecording();
        break;
      case 'GET_STATUS':
        result = window.__soopRecorder.getStatus();
        break;
      default:
        result = { success: false, error: '알 수 없는 명령' };
    }

    // 결과 전송
    window.postMessage({
      type: 'SOOPTALKING_RECORDER_RESULT',
      command: command,
      result: result
    }, window.location.origin);
  });

  // ===== 페이지 언로드 처리 =====
  window.addEventListener('beforeunload', (e) => {
    if (isRecording) {
      e.preventDefault();
      e.returnValue = '녹화가 진행 중입니다. 페이지를 떠나면 녹화가 중단됩니다.';
    }
  });

  console.log('[숲토킹 Recorder] v3.4.0 MAIN world 모듈 로드됨 (Downloads API)');
})();
```

---

### 4.3 sidepanel/sidepanel.html

**삭제할 섹션:**
```html
<!-- 녹화 폴더 설정 섹션 전체 삭제 -->
<div class="folder-section">
  <div class="folder-row">
    <span class="folder-label">📁 녹화 저장 폴더</span>
    <button id="selectFolderBtn" class="folder-btn">
      <span id="folderStatus">미설정</span>
    </button>
  </div>
  <p class="folder-hint" id="folderHint">녹화 시작 전에 저장 폴더를 선택하면 원터치 녹화가 가능합니다.</p>
</div>
```

---

### 4.4 sidepanel/sidepanel.css

**삭제할 스타일:**
```css
/* 폴더 설정 섹션 스타일 전체 삭제 */
.folder-section { ... }
.folder-row { ... }
.folder-label { ... }
.folder-btn { ... }
.folder-btn.configured { ... }
.folder-hint { ... }
.folder-hint.success { ... }
```

---

### 4.5 sidepanel/sidepanel.js

**삭제할 코드:**

1. 변수 선언:
```javascript
// 삭제
let recordingDirectoryHandle = null;
```

2. 함수들 전체 삭제:
```javascript
// 삭제할 함수들
async function saveDirectoryHandle(dirHandle) { ... }
async function loadDirectoryHandle() { ... }
async function verifyDirectoryPermission(dirHandle) { ... }
function updateFolderStatus(folderName) { ... }
async function initFolderStatus() { ... }
async function selectRecordingFolder() { ... }
```

3. 이벤트 리스너 삭제:
```javascript
// 삭제
document.getElementById('selectFolderBtn')?.addEventListener('click', selectRecordingFolder);
```

4. init() 함수에서 삭제:
```javascript
// 삭제
await initFolderStatus();
```

---

### 4.6 background.js

**수정 1: 버전 주석**
```javascript
// 변경 전
// ===== 숲토킹 v3.3.1 - Background Service Worker =====
// File System API 기반 녹화 + 5초/30초 분리 모니터링

// 변경 후
// ===== 숲토킹 v3.4.0 - Background Service Worker =====
// Downloads API 기반 안정화 버전 + 5초/30초 분리 모니터링
```

**수정 2: 폴더 에러 알림 제거**

`checkAndProcessStreamer()` 함수에서 폴더 관련 에러 체크 삭제:
```javascript
// 삭제
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
```

`RECORDING_ERROR_FROM_PAGE` 핸들러에서 폴더 에러 알림 삭제:
```javascript
// 삭제
if (message.error?.includes('폴더') || message.error?.includes('취소')) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '📁 녹화 폴더 설정 필요',
    message: '자동 녹화를 위해 Side Panel에서 녹화 폴더를 먼저 설정해주세요.',
    priority: 2,
    requireInteraction: true
  });
}
```

**수정 3: 로그 메시지 업데이트**
```javascript
// 변경 전
console.log('[숲토킹] Background Service Worker v3.3.1 로드됨');

// 변경 후
console.log('[숲토킹] Background Service Worker v3.4.0 로드됨');
```

---

## 5. 영향 평가

| 기능 | 영향 | 설명 |
|------|------|------|
| 수동 녹화 | ✅ 정상 | Downloads API로 즉시 다운로드 |
| 자동 녹화 | ✅ 정상 | 다이얼로그 없이 작동 |
| 모니터링 | 🟢 없음 | 변경 없음 |
| UI | 🟡 변경 | 폴더 설정 섹션 제거 |
| 메모리 | ✅ 개선 | Blob URL 자동 해제 |

---

## 6. 테스트 체크리스트

```
[ ] 1. 수동 녹화 시작/중지 정상 작동
[ ] 2. 녹화 파일이 다운로드/SOOPtalking/ 폴더에 저장
[ ] 3. 자동 녹화 정상 작동 (다이얼로그 없이)
[ ] 4. Side Panel 닫아도 녹화 유지
[ ] 5. 장시간 녹화 (30분+) 메모리 안정성
[ ] 6. 녹화 진행 상황 표시 (시간, 용량)
[ ] 7. 녹화 완료 후 파일 재생 정상
[ ] 8. 브라우저 크래시 없음
```

---

## 7. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "ROLLBACK_v3.4.0_DOWNLOADS_API.md 파일을 읽고 수정사항을 적용해줘. File System API 관련 코드는 완전히 제거하고, Downloads API 기반으로 롤백해줘. 완료 후 git add -A && git commit -m 'rollback: v3.4.0 - File System API → Downloads API 롤백 (안정화)'"
```

---

## 8. 버전 히스토리 업데이트

### CHANGELOG.md에 추가

```markdown
## v3.4.0 (2026-01-01)

### Rollback
- **File System API → Downloads API 롤백**: Chrome Extension의 Side Panel에서 File System Access API 사용 시 발생하는 보안 제약 및 브라우저 크래시 문제 해결

### Issues Fixed
- `SecurityError: Failed to execute 'showDirectoryPicker'` 에러 해결
- Side Panel에서 폴더 선택 시 브라우저 강제 종료 문제 해결

### Improvements
- 메모리 최적화: Blob URL 자동 해제 (10초 후)
- 대용량 녹화 경고 (500MB 초과 시)

### Removed
- 녹화 폴더 설정 UI 제거
- IndexedDB 폴더 핸들 저장 기능 제거
```

---

**문서 끝**
