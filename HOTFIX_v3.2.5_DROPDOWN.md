# 🎨 HOTFIX v3.2.5 - 드롭다운 스타일 수정

## 버전 정보
- **현재 버전**: 3.2.4
- **수정 버전**: 3.2.5
- **작성일**: 2026-01-01

---

## 1. 문제점

드롭다운(select) 요소 클릭 시 옵션 목록의 배경색이 **흰색**으로 표시되어 다크 테마와 어울리지 않음.

---

## 2. 수정 파일

| 파일 | 변경 내용 |
|------|-----------|
| `manifest.json` | 버전 3.2.4 → 3.2.5 |
| `sidepanel/sidepanel.css` | 드롭다운 옵션 다크 테마 스타일 추가 |

---

## 3. 상세 수정 내용

### 3.1 manifest.json

```json
// 변경 전
"version": "3.2.4",

// 변경 후
"version": "3.2.5",
```

### 3.2 sidepanel/sidepanel.css

기존 `.filter-select` 스타일 아래에 다음 코드 추가:

```css
/* 드롭다운 옵션 다크 테마 */
.filter-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 28px;
}

.filter-select option {
  background-color: #1a1a2e;
  color: #ccc;
  padding: 8px 12px;
}

.filter-select option:hover,
.filter-select option:focus,
.filter-select option:checked {
  background-color: #2d2d44;
  color: #fff;
}

/* Firefox 전용 */
@-moz-document url-prefix() {
  .filter-select option {
    background-color: #1a1a2e;
    color: #ccc;
  }
}
```

---

## 4. 참고사항

> ⚠️ **브라우저 제한**: `<select>` 옵션의 스타일링은 브라우저마다 제한이 있습니다.
> - Chrome/Edge: `option` 배경색 지원
> - Firefox: 부분 지원 (@-moz-document 필요)
> - Safari: 제한적 지원
>
> 완벽한 커스텀이 필요하면 JavaScript 기반 커스텀 드롭다운으로 대체해야 하지만,
> 현재 수준에서는 기본 스타일링으로 충분합니다.

---

## 5. 테스트 체크리스트

```
[ ] 1. 드롭다운 클릭 시 옵션 배경색이 다크 (#1a1a2e)
[ ] 2. 옵션 hover 시 약간 밝은 색상 (#2d2d44)
[ ] 3. 선택된 옵션 텍스트 색상 흰색
[ ] 4. 드롭다운 화살표 아이콘 표시
```

---

## 6. Claude Code 실행 커맨드

```bash
cd C:\Users\ADMIN\Claude\soop-streamer-alert && claude "HOTFIX_v3.2.5_DROPDOWN.md 파일을 읽고 수정사항을 적용해줘. 완료 후 git add -A && git commit -m 'fix: v3.2.5 - 드롭다운 옵션 다크 테마 스타일 수정'"
```

---

**문서 끝**
