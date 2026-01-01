# 🎨 PATCH v3.2.4 - UI/UX 개선

## 버전 정보
- **현재 버전**: 3.2.3
- **수정 버전**: 3.2.4
- **작성일**: 2026-01-01

---

## 1. 변경 사항 요약

| # | 항목 | 설명 |
|---|------|------|
| 1 | 가독성 개선 | 작은 글씨 크기 및 색상 조정 |
| 2 | 슬로건 변경 | "SOOP 스트리머 알림..." → 빨간색 "내가 늘 지켜보고 있어.." |
| 3 | 드롭다운 위치 | "전체" 드롭다운을 가장 우측으로 이동 |
| 4 | 아이콘 개선 | 가져오기/내보내기/새로고침 아이콘을 직관적으로 변경 |
| 5 | 드래그 앤 드롭 | 스트리머 순서 변경 (추가 버튼 없이 현재 디자인 유지) |
| 6 | 푸터 링크 | SOOP 링크, 개인정보보호방침 링크 수정 |
| 7 | 아코디언 안정화 | 스트리머 클릭 시 떨림/자동닫힘 문제 해결 |
| 8 | 도움말 툴팁 | 톱니바퀴 제거, 물음표 hover 시 안내 메시지 |

---

## 2. 수정 파일 목록

| 파일 | 변경 내용 |
|------|-----------|
| `manifest.json` | 버전 3.2.3 → 3.2.4 |
| `sidepanel/sidepanel.html` | 슬로건, 아이콘, 푸터 링크, 도움말 툴팁 구조 변경 |
| `sidepanel/sidepanel.css` | 가독성, 아이콘 스타일, 드래그, 툴팁 스타일 추가 |
| `sidepanel/sidepanel.js` | 드래그 앤 드롭, 아코디언 안정화 로직 |

---

## 3. 상세 수정 내용

### 3.1 manifest.json

```json
// 변경 전
"version": "3.2.3",

// 변경 후
"version": "3.2.4",
```

---

### 3.2 sidepanel/sidepanel.html

#### 3.2.1 헤더 슬로건 변경

찾기:
```html
<p class="header-subtitle">SOOP 스트리머 알림 &amp; 다운로드</p>
```

바꾸기:
```html
<p class="header-subtitle creepy-text">내가 늘 지켜보고 있어..</p>
```

#### 3.2.2 헤더 아이콘 영역 변경 (톱니바퀴 제거, 물음표에 툴팁 추가)

찾기 (header-actions 부분):
```html
<div class="header-actions">
  <button class="icon-btn" id="settingsBtn" title="설정">⚙️</button>
  <button class="icon-btn" id="helpBtn" title="도움말">❓</button>
</div>
```

바꾸기:
```html
<div class="header-actions">
  <div class="help-wrapper">
    <button class="icon-btn" id="helpBtn" title="도움말">❓</button>
    <div class="help-tooltip">
      <p class="tooltip-title">📢 안내</p>
      <p>이 확장 프로그램은 개인 사용 목적으로 제작되었습니다.</p>
      <p>일부 버그나 예상치 못한 동작이 있을 수 있습니다.</p>
      <p>지속적으로 개선하고 있으니 양해 부탁드립니다.</p>
      <a href="https://github.com/musickiss/soop-streamer-alert/issues" target="_blank" class="tooltip-link">버그 신고 →</a>
    </div>
  </div>
</div>
```

#### 3.2.3 즐겨찾기 스트리머 헤더 영역 (아이콘 + 드롭다운 위치 변경)

찾기 (streamer-section-header 또는 유사한 부분):
```html
<div class="section-header">
  <span class="section-title">⭐ 즐겨찾기 스트리머</span>
  <select id="filterSelect" class="filter-select">
```

이 부분을 다음과 같은 구조로 변경:
```html
<div class="section-header">
  <span class="section-title">⭐ 즐겨찾기 스트리머</span>
  <div class="section-actions">
    <button class="action-btn" id="importBtn" title="가져오기">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
    <button class="action-btn" id="exportBtn" title="내보내기">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    </button>
    <button class="action-btn" id="refreshBtn" title="새로고침">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"/>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
      </svg>
    </button>
    <select id="filterSelect" class="filter-select">
      <option value="all">전체</option>
      <option value="live">방송중</option>
      <option value="offline">오프라인</option>
    </select>
  </div>
</div>
```

#### 3.2.4 푸터 링크 변경

찾기 (footer 부분):
```html
<a href="https://www.sooplive.co.kr" target="_blank">SOOP</a>
```

바꾸기:
```html
<a href="https://www.sooplive.co.kr/station/teamilh" target="_blank">SOOP</a>
```

찾기 (개인정보보호방침 링크가 없거나 다른 링크인 경우):
```html
<a href="..." target="_blank">GitHub</a>
```

GitHub 링크 뒤에 추가 또는 수정:
```html
<a href="https://github.com/musickiss/soop-streamer-alert" target="_blank">GitHub</a>
<span class="footer-divider">·</span>
<a href="https://github.com/musickiss/soop-streamer-alert/blob/master/PRIVACY.md" target="_blank">개인정보</a>
```

---

### 3.3 sidepanel/sidepanel.css

파일 끝에 다음 스타일 추가:

```css
/* ===== v3.2.4 UI/UX 개선 ===== */

/* 1. 가독성 개선 - 작은 글씨 */
.streamer-item .streamer-meta,
.streamer-item .streamer-status,
.filter-select,
.footer-text,
.section-header .section-title {
  font-size: 13px;
  letter-spacing: 0.2px;
}

.streamer-item .streamer-title {
  font-size: 12px;
  color: #b0b0b0;
  line-height: 1.4;
}

/* 2. 슬로건 스타일 (스토커 컨셉) */
.header-subtitle.creepy-text {
  color: #ff4757 !important;
  font-style: italic;
  font-weight: 500;
  text-shadow: 0 0 10px rgba(255, 71, 87, 0.3);
  animation: creepy-pulse 3s ease-in-out infinite;
}

@keyframes creepy-pulse {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

/* 3. 섹션 헤더 레이아웃 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  margin-bottom: 8px;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 4. 액션 버튼 (가져오기/내보내기/새로고침) */
.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #888;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
  transform: translateY(-1px);
}

.action-btn svg {
  width: 14px;
  height: 14px;
}

#importBtn:hover { color: #4ecdc4; }
#exportBtn:hover { color: #a29bfe; }
#refreshBtn:hover { color: #ff6b6b; }

/* 5. 필터 드롭다운 */
.filter-select {
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #ccc;
  font-size: 12px;
  cursor: pointer;
  outline: none;
}

.filter-select:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

/* 6. 드래그 앤 드롭 */
.streamer-item {
  cursor: grab;
  transition: transform 0.15s ease, opacity 0.15s ease, background 0.2s ease;
}

.streamer-item:active {
  cursor: grabbing;
}

.streamer-item.dragging {
  opacity: 0.5;
  transform: scale(0.98);
  background: rgba(255, 255, 255, 0.1);
}

.streamer-item.drag-over {
  border-top: 2px solid #ff4757;
  margin-top: -2px;
}

.streamer-item.drag-over-bottom {
  border-bottom: 2px solid #ff4757;
  margin-bottom: -2px;
}

/* 7. 도움말 툴팁 */
.help-wrapper {
  position: relative;
}

.help-tooltip {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  width: 240px;
  padding: 12px;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: all 0.2s ease;
  z-index: 1000;
}

.help-wrapper:hover .help-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.help-tooltip .tooltip-title {
  font-size: 13px;
  font-weight: 600;
  color: #ff4757;
  margin-bottom: 8px;
}

.help-tooltip p {
  font-size: 11px;
  color: #aaa;
  line-height: 1.5;
  margin-bottom: 6px;
}

.help-tooltip .tooltip-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 11px;
  color: #4ecdc4;
  text-decoration: none;
}

.help-tooltip .tooltip-link:hover {
  text-decoration: underline;
}

/* 8. 아코디언 안정화 */
.streamer-item .streamer-details {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease-out;
}

.streamer-item.expanded .streamer-details {
  max-height: 200px;
  transition: max-height 0.3s ease-in;
}

/* 9. 푸터 개선 */
.footer-divider {
  color: #444;
  margin: 0 6px;
}
```

---

### 3.4 sidepanel/sidepanel.js

#### 3.4.1 드래그 앤 드롭 기능 추가

파일 상단에 드래그 상태 변수 추가:
```javascript
// 드래그 앤 드롭 상태
let draggedItem = null;
let draggedIndex = -1;
```

스트리머 목록 렌더링 함수 내에서 draggable 속성 추가하고, 이벤트 리스너 연결:

```javascript
// renderStreamerList 함수 내 또는 스트리머 아이템 생성 시
// 각 streamer-item 요소에 다음 속성 추가:
// draggable="true"

// 그리고 이벤트 리스너 연결:
function setupDragAndDrop() {
  const streamerItems = document.querySelectorAll('.streamer-item');
  
  streamerItems.forEach((item, index) => {
    item.setAttribute('draggable', 'true');
    
    item.addEventListener('dragstart', (e) => {
      draggedItem = item;
      draggedIndex = index;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      document.querySelectorAll('.streamer-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
      });
      draggedItem = null;
      draggedIndex = -1;
    });
    
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!draggedItem || draggedItem === item) return;
      
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      
      document.querySelectorAll('.streamer-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
      });
      
      if (e.clientY < midY) {
        item.classList.add('drag-over');
      } else {
        item.classList.add('drag-over-bottom');
      }
    });
    
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over', 'drag-over-bottom');
    });
    
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!draggedItem || draggedItem === item) return;
      
      const items = Array.from(document.querySelectorAll('.streamer-item'));
      let targetIndex = items.indexOf(item);
      
      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY > midY) {
        targetIndex += 1;
      }
      
      // 배열 순서 변경
      if (draggedIndex !== -1 && targetIndex !== draggedIndex) {
        const [movedStreamer] = state.favoriteStreamers.splice(draggedIndex, 1);
        if (draggedIndex < targetIndex) {
          targetIndex -= 1;
        }
        state.favoriteStreamers.splice(targetIndex, 0, movedStreamer);
        
        // 저장 및 UI 업데이트
        await saveStreamers();
        renderStreamerList();
      }
      
      document.querySelectorAll('.streamer-item').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-bottom');
      });
    });
  });
}

// renderStreamerList() 호출 후에 setupDragAndDrop() 호출 추가
```

#### 3.4.2 아코디언 안정화

기존 토글 로직을 수정하여 debounce 적용:

```javascript
// 아코디언 토글 debounce
let toggleTimeout = null;

function toggleStreamerDetails(item) {
  // 이미 토글 중이면 무시
  if (toggleTimeout) return;
  
  const isExpanded = item.classList.contains('expanded');
  
  // 다른 모든 아이템 닫기
  document.querySelectorAll('.streamer-item.expanded').forEach(el => {
    if (el !== item) {
      el.classList.remove('expanded');
    }
  });
  
  // 현재 아이템 토글
  item.classList.toggle('expanded', !isExpanded);
  
  // 300ms 동안 추가 토글 방지
  toggleTimeout = setTimeout(() => {
    toggleTimeout = null;
  }, 300);
}

// 기존 클릭 이벤트에서 toggleStreamerDetails 함수 사용
// 자동 닫힘 로직이 있다면 제거
```

#### 3.4.3 settingsBtn 관련 코드 제거

```javascript
// 찾아서 제거:
// document.getElementById('settingsBtn')... 관련 코드
// settingsBtn.addEventListener... 관련 코드
```

---

## 4. 영향 평가

| 기능 | 영향 | 설명 |
|------|------|------|
| 녹화 | 영향 없음 | UI만 변경 |
| 모니터링 | 영향 없음 | UI만 변경 |
| 알림 | 영향 없음 | UI만 변경 |
| 스트리머 관리 | 개선됨 | 드래그 앤 드롭 추가 |

---

## 5. 테스트 체크리스트

```
[ ] 1. 확장 프로그램 새로고침
[ ] 2. 헤더에 빨간색 "내가 늘 지켜보고 있어.." 표시 확인
[ ] 3. 물음표(❓) hover 시 도움말 툴팁 표시 확인
[ ] 4. 톱니바퀴 아이콘 제거 확인
[ ] 5. 가져오기/내보내기/새로고침 아이콘 확인 (SVG)
[ ] 6. "전체" 드롭다운이 가장 우측에 위치 확인
[ ] 7. 스트리머 드래그 앤 드롭으로 순서 변경 확인
[ ] 8. 스트리머 클릭 시 부드럽게 확장/축소 확인 (떨림 없음)
[ ] 9. 확장된 스트리머가 자동으로 닫히지 않는지 확인
[ ] 10. 푸터 SOOP 링크 클릭 → teamilh 스테이션 이동 확인
[ ] 11. 푸터 개인정보 링크 클릭 → PRIVACY.md 이동 확인
[ ] 12. 전체적인 글씨 가독성 확인
```

---

## 6. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "PATCH_v3.2.4_UI_UX.md 파일을 읽고 수정사항을 적용해줘. 기존 기능에 영향을 주지 않도록 주의해서 작업해줘. 완료 후 git add -A && git commit -m 'feat: v3.2.4 - UI/UX 개선 (슬로건, 아이콘, 드래그앤드롭, 툴팁, 아코디언 안정화)'"
```

---

**문서 끝**
