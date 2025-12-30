// ===== 숲토킹 v2.0 - 팝업 =====
// 사이드패널 열기 버튼만 포함

document.getElementById('openSidepanelBtn').addEventListener('click', async () => {
  // 현재 창에서 사이드패널 열기
  const currentWindow = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: currentWindow.id });
  window.close(); // 팝업 닫기
});

// 다국어 적용
document.querySelectorAll('[data-i18n]').forEach(el => {
  const key = el.getAttribute('data-i18n');
  const message = chrome.i18n.getMessage(key);
  if (message) el.textContent = message;
});

// 버전 정보
const manifest = chrome.runtime.getManifest();
document.getElementById('versionInfo').textContent = `v${manifest.version}`;

// 브랜드명 (언어별)
const brandName = chrome.i18n.getMessage('appName') || '숲토킹';
document.getElementById('brandName').textContent = brandName;
