# 🎬 PATCH v3.2.6 - 녹화 정보 툴팁 추가

## 버전 정보
- **현재 버전**: 3.2.5
- **수정 버전**: 3.2.6
- **작성일**: 2026-01-01

---

## 1. 변경 목적

녹화 중인 탭 영역에 **정보 아이콘(ⓘ)**을 추가하고, 마우스 오버 시 **백그라운드 탭 프레임 드랍 주의사항**을 안내.

---

## 2. 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `manifest.json` | 버전 3.2.5 → 3.2.6 |
| `sidepanel/sidepanel.html` | 녹화 섹션에 정보 아이콘 + 툴팁 추가 |
| `sidepanel/sidepanel.css` | 툴팁 스타일 추가 |

---

## 3. 상세 수정 내용

### 3.1 manifest.json

```json
// 변경 전
"version": "3.2.5",

// 변경 후
"version": "3.2.6",
```

---

### 3.2 sidepanel/sidepanel.html

녹화 중 섹션 헤더 부분을 찾아서 정보 아이콘 추가.

**찾기** (녹화 중 섹션 타이틀 부분):
```html
<div class="section-title">
  <span class="recording-indicator"></span>
  🔴 녹화 중
</div>
```

또는 유사한 형태의 녹화 섹션 헤더를 찾아서 **바꾸기**:
```html
<div class="section-title">
  <span class="recording-indicator"></span>
  🔴 녹화 중
  <div class="info-tooltip-wrapper">
    <span class="info-icon">ⓘ</span>
    <div class="info-tooltip">
      <p class="tooltip-title">⚠️ 녹화 품질 안내</p>
      <p>백그라운드 탭은 브라우저가 리소스를 제한하여 <strong>프레임 드랍</strong>이 발생할 수 있습니다.</p>
      <p class="tooltip-tip">💡 <strong>권장:</strong> 녹화 탭을 새 창으로 분리하거나 활성 상태로 유지하세요.</p>
    </div>
  </div>
</div>
```

---

### 3.3 sidepanel/sidepanel.css

파일 끝에 다음 스타일 추가:

```css
/* ===== v3.2.6 녹화 정보 툴팁 ===== */

/* 정보 아이콘 래퍼 */
.info-tooltip-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
}

/* 정보 아이콘 */
.info-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 12px;
  font-style: normal;
  color: #888;
  cursor: help;
  transition: color 0.2s ease;
}

.info-icon:hover {
  color: #4ecdc4;
}

/* 툴팁 박스 */
.info-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 260px;
  padding: 12px;
  background: #1a1a2e;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  opacity: 0;
  visibility: hidden;
  z-index: 1000;
  transition: all 0.2s ease;
}

/* 툴팁 화살표 */
.info-tooltip::before {
  content: '';
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid rgba(255, 255, 255, 0.15);
}

.info-tooltip::after {
  content: '';
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-bottom: 5px solid #1a1a2e;
}

/* 호버 시 툴팁 표시 */
.info-tooltip-wrapper:hover .info-tooltip {
  opacity: 1;
  visibility: visible;
}

/* 툴팁 내용 스타일 */
.info-tooltip .tooltip-title {
  font-size: 12px;
  font-weight: 600;
  color: #ffcc00;
  margin-bottom: 8px;
}

.info-tooltip p {
  font-size: 11px;
  color: #bbb;
  line-height: 1.5;
  margin-bottom: 6px;
}

.info-tooltip p:last-child {
  margin-bottom: 0;
}

.info-tooltip strong {
  color: #fff;
}

.info-tooltip .tooltip-tip {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: #4ecdc4;
}
```

---

## 4. 메시지 내용 (권장)

| 항목 | 내용 |
|------|------|
| **제목** | ⚠️ 녹화 품질 안내 |
| **본문** | 백그라운드 탭은 브라우저가 리소스를 제한하여 **프레임 드랍**이 발생할 수 있습니다. |
| **팁** | 💡 **권장:** 녹화 탭을 새 창으로 분리하거나 활성 상태로 유지하세요. |

---

## 5. 테스트 체크리스트

```
[ ] 1. 녹화 중 섹션에 ⓘ 아이콘 표시
[ ] 2. 아이콘 hover 시 툴팁 부드럽게 표시
[ ] 3. 툴팁 내용 정상 표시 (제목, 본문, 팁)
[ ] 4. 툴팁이 사이드 패널 밖으로 잘리지 않음
[ ] 5. 녹화 기능에 영향 없음
```

---

## 6. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "PATCH_v3.2.6_RECORDING_TOOLTIP.md 파일을 읽고 수정사항을 적용해줘. 완료 후 git add -A && git commit -m 'feat: v3.2.6 - 녹화 백그라운드 탭 프레임 드랍 안내 툴팁 추가'"
```

---

**문서 끝**
