# 🎬 FEATURE v3.3.0 - File System API 기반 실시간 디스크 저장

## 버전 정보
- **현재 버전**: 3.2.6
- **수정 버전**: 3.3.0
- **작성일**: 2026-01-01

---

## 1. 변경 목적

### 현재 문제점
- 녹화 데이터가 메모리(RAM)에 누적 → 장시간 녹화 시 크래시
- 비정상 종료 시 모든 데이터 손실
- 10GB+ 녹화 불가능

### 해결책
- File System Access API로 청크 발생 즉시 디스크에 쓰기
- 메모리 사용 최소화
- 비정상 종료 시에도 마지막 청크까지 파일 보존

---

## 2. 사용자 시나리오

### 시나리오 A: 경로 미지정 상태에서 녹화
```
1. 녹화 버튼 클릭
2. [폴더 선택 다이얼로그] 표시 (1회)
3. 사용자가 폴더 선택
4. 녹화 시작
5. 이후 녹화는 원터치로 동작
```

### 시나리오 B: 미리 경로 지정 후 녹화
```
1. 설정에서 "녹화 저장 폴더" 선택
2. 녹화 버튼 클릭
3. 즉시 녹화 시작 (다이얼로그 없음)
```

### 시나리오 C: 자동 녹화
```
1. 경로가 이미 지정된 상태
2. 방송 시작 감지
3. 자동으로 녹화 시작 (사용자 인풋 없음)
```

### 시나리오 D: 경로 미지정 + 자동 녹화
```
1. 경로 미지정 상태
2. 방송 시작 감지
3. 자동 녹화 건너뜀 (사용자 제스처 필요)
4. 알림으로 "녹화 폴더를 먼저 설정해주세요" 안내
```

---

## 3. 수정 파일 목록

| 파일 | 변경 정도 | 내용 |
|------|-----------|------|
| `manifest.json` | 🟢 작음 | 버전 변경 |
| `sidepanel/sidepanel.html` | 🟡 중간 | 녹화 폴더 설정 UI 추가 |
| `sidepanel/sidepanel.css` | 🟡 중간 | 설정 UI 스타일 |
| `sidepanel/sidepanel.js` | 🟡 중간 | 폴더 선택 로직, 상태 표시 |
| `content-main.js` | 🔴 큼 | 저장 로직 전체 변경 |
| `content.js` | 🟢 작음 | 메시지 타입 추가 |
| `background.js` | 🟡 중간 | 자동 녹화 시 폴더 체크 |

---

## 4. 상세 수정 내용

### 4.1 manifest.json

```json
// 변경 전
"version": "3.2.6",

// 변경 후
"version": "3.3.0",
```

---

### 4.2 sidepanel/sidepanel.html

**녹화 중 섹션 위 또는 설정 영역에 추가:**

```html
<!-- 녹화 저장 설정 -->
<div class="recording-folder-section">
  <div class="folder-setting-row">
    <span class="folder-label">📁 녹화 저장 폴더</span>
    <button class="folder-select-btn" id="selectFolderBtn">
      <span id="folderStatus">미설정</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
    </button>
  </div>
  <p class="folder-hint" id="folderHint">녹화 시작 전에 저장 폴더를 선택하면 원터치 녹화가 가능합니다.</p>
</div>
```

---

### 4.3 sidepanel/sidepanel.css

```css
/* ===== v3.3.0 녹화 폴더 설정 ===== */

.recording-folder-section {
  padding: 10px 12px;
  margin: 8px 0;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.folder-setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.folder-label {
  font-size: 13px;
  color: #ccc;
}

.folder-select-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #aaa;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.folder-select-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
}

.folder-select-btn.configured {
  border-color: #4ecdc4;
  color: #4ecdc4;
}

.folder-select-btn.configured:hover {
  background: rgba(78, 205, 196, 0.1);
}

.folder-hint {
  margin-top: 6px;
  font-size: 11px;
  color: #666;
  line-height: 1.4;
}

.folder-hint.warning {
  color: #ffcc00;
}

.folder-hint.success {
  color: #4ecdc4;
}
```

---

### 4.4 sidepanel/sidepanel.js

**파일 상단에 변수 추가:**
```javascript
// 녹화 폴더 상태
let recordingDirectoryHandle = null;
```

**폴더 선택 버튼 이벤트 (init 함수 내 또는 별도):**
```javascript
// 녹화 폴더 선택
document.getElementById('selectFolderBtn').addEventListener('click', async () => {
  try {
    // 폴더 선택 다이얼로그
    const dirHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'downloads'
    });
    
    // IndexedDB에 저장 (권한 유지)
    await saveDirectoryHandle(dirHandle);
    
    // UI 업데이트
    updateFolderStatus(dirHandle.name);
    showToast(`녹화 폴더 설정: ${dirHandle.name}`, 'success');
    
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('[숲토킹] 폴더 선택 오류:', err);
      showToast('폴더 선택이 취소되었습니다.', 'info');
    }
  }
});

// IndexedDB에 directoryHandle 저장
async function saveDirectoryHandle(dirHandle) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SooptalkingDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ key: 'recordingDirectory', value: dirHandle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    
    request.onerror = () => reject(request.error);
  });
}

// IndexedDB에서 directoryHandle 로드
async function loadDirectoryHandle() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SooptalkingDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const getReq = store.get('recordingDirectory');
      
      getReq.onsuccess = () => {
        resolve(getReq.result?.value || null);
      };
      getReq.onerror = () => resolve(null);
    };
    
    request.onerror = () => resolve(null);
  });
}

// 폴더 권한 확인 및 요청
async function verifyDirectoryPermission(dirHandle) {
  if (!dirHandle) return false;
  
  try {
    // 권한 확인
    const options = { mode: 'readwrite' };
    if (await dirHandle.queryPermission(options) === 'granted') {
      return true;
    }
    
    // 권한 요청 (사용자 제스처 필요)
    if (await dirHandle.requestPermission(options) === 'granted') {
      return true;
    }
    
    return false;
  } catch (err) {
    console.error('[숲토킹] 권한 확인 오류:', err);
    return false;
  }
}

// UI 업데이트
function updateFolderStatus(folderName) {
  const statusEl = document.getElementById('folderStatus');
  const btnEl = document.getElementById('selectFolderBtn');
  const hintEl = document.getElementById('folderHint');
  
  if (folderName) {
    statusEl.textContent = folderName;
    btnEl.classList.add('configured');
    hintEl.textContent = '✅ 원터치 녹화 가능';
    hintEl.className = 'folder-hint success';
  } else {
    statusEl.textContent = '미설정';
    btnEl.classList.remove('configured');
    hintEl.textContent = '녹화 시작 전에 저장 폴더를 선택하면 원터치 녹화가 가능합니다.';
    hintEl.className = 'folder-hint';
  }
}

// 초기화 시 폴더 상태 로드
async function initFolderStatus() {
  try {
    const dirHandle = await loadDirectoryHandle();
    if (dirHandle) {
      const hasPermission = await verifyDirectoryPermission(dirHandle);
      if (hasPermission) {
        recordingDirectoryHandle = dirHandle;
        updateFolderStatus(dirHandle.name);
      } else {
        updateFolderStatus(null);
      }
    }
  } catch (err) {
    console.error('[숲토킹] 폴더 상태 로드 오류:', err);
  }
}

// init() 함수 내에서 호출
// initFolderStatus();
```

**녹화 시작 로직 수정 (기존 startRecording 함수 내):**

녹화 시작 시 content-main.js로 directoryHandle 전달이 필요하지만, 
directoryHandle은 postMessage로 전달할 수 없음 (non-serializable).

**해결책:** Side Panel에서 파일 생성 후 writable 핸들을 content-main으로 전달하거나,
content-main.js에서 직접 IndexedDB 접근.

→ **content-main.js에서 IndexedDB 직접 접근 방식 채택**

---

### 4.5 content-main.js

**전체 저장 로직 변경:**

```javascript
// ===== File System API 기반 실시간 저장 =====

// 상태 변수
let mediaRecorder = null;
let fileWritable = null;  // WritableStream
let isRecording = false;
let recordingStartTime = null;
let totalBytesWritten = 0;

// IndexedDB에서 directoryHandle 로드
async function getDirectoryHandle() {
  return new Promise((resolve) => {
    const request = indexedDB.open('SooptalkingDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const getReq = store.get('recordingDirectory');
      
      getReq.onsuccess = () => resolve(getReq.result?.value || null);
      getReq.onerror = () => resolve(null);
    };
    
    request.onerror = () => resolve(null);
  });
}

// directoryHandle 저장
async function saveDirectoryHandle(dirHandle) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SooptalkingDB', 1);
    
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put({ key: 'recordingDirectory', value: dirHandle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    
    request.onerror = () => reject(request.error);
  });
}

// 권한 확인
async function verifyPermission(dirHandle) {
  try {
    const options = { mode: 'readwrite' };
    return (await dirHandle.queryPermission(options)) === 'granted';
  } catch {
    return false;
  }
}

// 파일명 생성
function generateFileName(streamerId) {
  const now = new Date();
  const timestamp = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0') + '_' +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
  return `soop_${streamerId}_${timestamp}.webm`;
}

// 녹화 시작
async function startRecording(streamerId, nickname) {
  if (isRecording) {
    console.warn('[숲토킹 Recorder] 이미 녹화 중입니다.');
    return { success: false, error: 'ALREADY_RECORDING' };
  }
  
  try {
    // 1. 비디오 요소 찾기
    const video = document.querySelector('video#webplayer-video') || 
                  document.querySelector('video');
    
    if (!video) {
      throw new Error('비디오 요소를 찾을 수 없습니다.');
    }
    
    if (video.readyState < 2) {
      throw new Error('비디오가 아직 로드되지 않았습니다.');
    }
    
    // 2. 디렉토리 핸들 가져오기
    let dirHandle = await getDirectoryHandle();
    
    // 3. 핸들이 없거나 권한이 없으면 폴더 선택 요청
    if (!dirHandle || !(await verifyPermission(dirHandle))) {
      try {
        dirHandle = await window.showDirectoryPicker({
          mode: 'readwrite',
          startIn: 'downloads'
        });
        await saveDirectoryHandle(dirHandle);
        console.log('[숲토킹 Recorder] 새 폴더 선택됨:', dirHandle.name);
      } catch (err) {
        if (err.name === 'AbortError') {
          throw new Error('폴더 선택이 취소되었습니다.');
        }
        throw err;
      }
    }
    
    // 4. 파일 생성
    const fileName = generateFileName(streamerId);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    fileWritable = await fileHandle.createWritable();
    
    console.log('[숲토킹 Recorder] 파일 생성:', fileName);
    
    // 5. 스트림 캡처
    const stream = video.captureStream();
    
    // 6. 코덱 선택
    const codecs = [
      { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },
      { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
      { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
      { mime: 'video/webm', name: 'WebM' }
    ];
    
    let selectedMime = 'video/webm';
    for (const codec of codecs) {
      if (MediaRecorder.isTypeSupported(codec.mime)) {
        selectedMime = codec.mime;
        console.log('[숲토킹 Recorder] 코덱 선택:', codec.name);
        break;
      }
    }
    
    // 7. MediaRecorder 설정
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: selectedMime,
      videoBitsPerSecond: 8000000  // 8Mbps
    });
    
    totalBytesWritten = 0;
    recordingStartTime = Date.now();
    
    // 8. 데이터 발생 시 즉시 디스크에 쓰기
    mediaRecorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0 && fileWritable) {
        try {
          await fileWritable.write(e.data);
          totalBytesWritten += e.data.size;
          
          // 진행 상황 보고
          const elapsedTime = Math.floor((Date.now() - recordingStartTime) / 1000);
          window.postMessage({
            type: 'SOOPTALKING_RECORDING_PROGRESS',
            streamerId: streamerId,
            totalBytes: totalBytesWritten,
            elapsedTime: elapsedTime
          }, '*');
          
        } catch (err) {
          console.error('[숲토킹 Recorder] 디스크 쓰기 오류:', err);
        }
      }
    };
    
    // 9. 녹화 종료 처리
    mediaRecorder.onstop = async () => {
      try {
        if (fileWritable) {
          await fileWritable.close();
          fileWritable = null;
        }
        
        const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
        
        window.postMessage({
          type: 'SOOPTALKING_RECORDING_STOPPED',
          streamerId: streamerId,
          totalBytes: totalBytesWritten,
          duration: duration,
          saved: true,
          fileName: fileName
        }, '*');
        
        console.log(`[숲토킹 Recorder] 녹화 완료: ${fileName} (${(totalBytesWritten / 1024 / 1024).toFixed(2)} MB)`);
        
      } catch (err) {
        console.error('[숲토킹 Recorder] 파일 닫기 오류:', err);
      }
      
      isRecording = false;
      mediaRecorder = null;
    };
    
    // 10. 에러 처리
    mediaRecorder.onerror = async (e) => {
      console.error('[숲토킹 Recorder] MediaRecorder 오류:', e.error);
      
      try {
        if (fileWritable) {
          await fileWritable.close();
          fileWritable = null;
        }
      } catch {}
      
      isRecording = false;
      
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_ERROR',
        error: e.error?.message || '녹화 중 오류 발생'
      }, '*');
    };
    
    // 11. 녹화 시작 (5초마다 데이터 청크)
    mediaRecorder.start(5000);
    isRecording = true;
    
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_STARTED',
      streamerId: streamerId,
      nickname: nickname,
      fileName: fileName
    }, '*');
    
    console.log(`[숲토킹 Recorder] 녹화 시작: ${streamerId}`);
    
    return { success: true, fileName: fileName };
    
  } catch (err) {
    console.error('[숲토킹 Recorder] 녹화 시작 오류:', err);
    
    try {
      if (fileWritable) {
        await fileWritable.close();
        fileWritable = null;
      }
    } catch {}
    
    window.postMessage({
      type: 'SOOPTALKING_RECORDING_ERROR',
      error: err.message
    }, '*');
    
    return { success: false, error: err.message };
  }
}

// 녹화 중지
async function stopRecording() {
  if (!isRecording || !mediaRecorder) {
    console.warn('[숲토킹 Recorder] 녹화 중이 아닙니다.');
    return { success: false, error: 'NOT_RECORDING' };
  }
  
  try {
    mediaRecorder.stop();
    return { success: true };
  } catch (err) {
    console.error('[숲토킹 Recorder] 녹화 중지 오류:', err);
    return { success: false, error: err.message };
  }
}

// 메시지 리스너
window.addEventListener('message', async (e) => {
  if (e.source !== window) return;
  if (!e.data || e.data.type !== 'SOOPTALKING_RECORDER_COMMAND') return;
  
  const { command, params } = e.data;
  
  switch (command) {
    case 'START_RECORDING':
      await startRecording(params.streamerId, params.nickname);
      break;
      
    case 'STOP_RECORDING':
      await stopRecording();
      break;
      
    case 'GET_STATUS':
      window.postMessage({
        type: 'SOOPTALKING_RECORDING_STATUS',
        isRecording: isRecording,
        totalBytes: totalBytesWritten,
        elapsedTime: recordingStartTime ? Math.floor((Date.now() - recordingStartTime) / 1000) : 0
      }, '*');
      break;
  }
});

// 페이지 언로드 시 녹화 정리
window.addEventListener('beforeunload', async (e) => {
  if (isRecording) {
    e.preventDefault();
    e.returnValue = '녹화가 진행 중입니다. 페이지를 떠나면 녹화가 중단됩니다.';
  }
});

// 강제 종료 시에도 파일 닫기 시도
window.addEventListener('unload', async () => {
  if (fileWritable) {
    try {
      await fileWritable.close();
    } catch {}
  }
});

console.log('[숲토킹 Recorder] v3.3.0 MAIN world 모듈 로드됨 (File System API)');
```

---

### 4.6 background.js

**자동 녹화 시 폴더 설정 체크 (autoStartRecording 함수 내):**

자동 녹화 시작 전에 폴더가 설정되어 있는지 확인하는 로직 필요.
하지만 background.js (Service Worker)에서는 IndexedDB 접근이 제한적이고,
File System API 권한은 content script에서 확인해야 함.

**해결책:** 자동 녹화 요청을 보내고, content-main.js에서 폴더 미설정 시 에러 반환.
→ 에러 발생 시 사용자에게 알림.

```javascript
// 자동 녹화 실패 시 알림 (기존 코드에 추가)
// RECORDING_ERROR_UPDATE 처리 부분에서:

if (error === '폴더 선택이 취소되었습니다.' || error.includes('폴더')) {
  // 녹화 폴더 미설정 알림
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '📁 녹화 폴더 설정 필요',
    message: '자동 녹화를 위해 녹화 폴더를 먼저 설정해주세요.',
    priority: 2
  });
}
```

---

## 5. 영향 평가

| 기능 | 영향 | 설명 |
|------|------|------|
| 수동 녹화 | ✅ 개선 | 디스크 직접 저장, 메모리 안정 |
| 자동 녹화 | ✅ 개선 | 폴더 설정 시 원터치 동작 |
| 모니터링 | 🟢 없음 | 별개 기능 |
| 알림 | 🟢 없음 | 별개 기능 |
| 스트리머 관리 | 🟢 없음 | 별개 기능 |
| UI/UX | 🟢 없음 | 기존 유지 |

---

## 6. 폴백 전략

File System API 미지원 브라우저 또는 오류 시:
→ 기존 메모리 방식으로 폴백 (별도 구현 필요 시 추가)

현재 Chrome 86+ 에서 지원되므로 대부분 환경에서 작동.

---

## 7. 테스트 체크리스트

```
[ ] 1. 폴더 미설정 상태에서 녹화 시작 → 폴더 선택 다이얼로그
[ ] 2. 폴더 선택 후 녹화 정상 시작
[ ] 3. 이후 녹화 시 다이얼로그 없이 원터치 시작
[ ] 4. 녹화 중 진행 상황 표시 (시간, 용량)
[ ] 5. 녹화 중지 → 파일 정상 저장
[ ] 6. 저장된 파일 재생 확인
[ ] 7. 장시간 녹화 테스트 (30분+) → 메모리 안정
[ ] 8. 녹화 중 탭 닫기 시도 → 경고 메시지
[ ] 9. 녹화 중 브라우저 강제 종료 → 파일 보존 확인
[ ] 10. 폴더 설정 후 자동 녹화 테스트
[ ] 11. 폴더 미설정 + 자동 녹화 → 알림 표시
[ ] 12. 설정 버튼으로 폴더 변경 가능
```

---

## 8. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "FEATURE_v3.3.0_FILESYSTEM_API.md 파일을 읽고 수정사항을 적용해줘. 기존 녹화 기능의 안정성을 유지하면서 File System API 기반으로 변경해줘. 완료 후 git add -A && git commit -m 'feat: v3.3.0 - File System API 기반 실시간 디스크 저장 (메모리 안정화, 크래시 안전)'"
```

---

**문서 끝**
