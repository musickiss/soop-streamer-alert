// ===== 숲토킹 - SOOP 스트리머 방송 알림 확장 프로그램 =====
// popup.js - 팝업 UI 로직
// v1.7.0 - 다국어 지원 추가

// ===== i18n 헬퍼 함수 =====
function i18n(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// DOM 요소 참조
const monitoringToggle = document.getElementById('monitoringToggle');
const statusText = document.getElementById('statusText');
const monitoringCount = document.getElementById('monitoringCount');
const streamerList = document.getElementById('streamerList');
const refreshBtn = document.getElementById('refreshBtn');
const manualAddInput = document.getElementById('manualAddInput');
const manualAddBtn = document.getElementById('manualAddBtn');
const toast = document.getElementById('toast');
const notificationToggle = document.getElementById('notificationToggle');
const notificationDuration = document.getElementById('notificationDuration');
const durationRow = document.getElementById('durationRow');
const endNotificationToggle = document.getElementById('endNotificationToggle');
const autoCloseToggle = document.getElementById('autoCloseToggle');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');

// 상태 저장
let state = {
  favoriteStreamers: [],
  monitoringStreamers: [],
  isMonitoring: false,
  broadcastStatus: {},
  runningTabs: {},
  notificationEnabled: true,
  notificationDuration: 10,
  endNotificationEnabled: false,
  autoCloseOfflineTabs: true
};

// ===== i18n 적용 함수 =====
function applyI18n() {
  // 앱 이름과 슬로건
  document.getElementById('brandText').textContent = i18n('appName');
  document.getElementById('creepyText').textContent = i18n('appSlogan');

  // data-i18n 속성을 가진 요소들
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = i18n(key);
  });

  // data-i18n-placeholder 속성을 가진 요소들
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = i18n(key);
  });

  // data-i18n-title 속성을 가진 요소들
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = i18n(key);
  });
}

// ===== 유틸리티 함수 =====

// 토스트 메시지 표시
function showToast(message, type = 'info') {
  toast.textContent = message;
  toast.className = 'toast show ' + type;

  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// 백그라운드에 메시지 전송
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// ===== UI 업데이트 함수 =====

// 모니터링 상태 업데이트
function updateMonitoringStatus() {
  monitoringToggle.checked = state.isMonitoring;
  statusText.textContent = state.isMonitoring ? i18n('monitoringOn') : i18n('monitoringOff');
  statusText.className = state.isMonitoring ? 'status-text active' : 'status-text';
}

// 모니터링 카운트 업데이트
function updateMonitoringCount() {
  monitoringCount.textContent = i18n('selectedCount', [state.monitoringStreamers.length.toString()]);
}

// 알림 설정 UI 업데이트
function updateNotificationSettings() {
  notificationToggle.checked = state.notificationEnabled;
  notificationDuration.value = state.notificationDuration;
  durationRow.style.opacity = state.notificationEnabled ? '1' : '0.5';
  notificationDuration.disabled = !state.notificationEnabled;

  // 방송 종료 알림 설정
  if (endNotificationToggle) {
    endNotificationToggle.checked = state.endNotificationEnabled;
  }

  // 오프라인 탭 자동 종료 설정
  if (autoCloseToggle) {
    autoCloseToggle.checked = state.autoCloseOfflineTabs;
  }
}

// 알림 토글 핸들러
async function handleNotificationToggle() {
  state.notificationEnabled = notificationToggle.checked;

  // storage에 저장
  await chrome.storage.local.set({
    notificationEnabled: state.notificationEnabled
  });

  // 백그라운드에도 알림
  try {
    await sendMessage({
      type: 'SET_NOTIFICATION_SETTINGS',
      data: { enabled: state.notificationEnabled }
    });
  } catch (e) {
    console.log('[팝업] 백그라운드 알림 실패');
  }

  updateNotificationSettings();
  showToast(
    state.notificationEnabled ? i18n('toastNotificationEnabled') : i18n('toastNotificationDisabled'),
    state.notificationEnabled ? 'success' : 'info'
  );
}

// 방송 종료 알림 토글 핸들러
async function handleEndNotificationToggle() {
  state.endNotificationEnabled = endNotificationToggle.checked;

  // storage에 저장
  await chrome.storage.local.set({
    endNotificationEnabled: state.endNotificationEnabled
  });

  // 백그라운드에도 알림
  try {
    await sendMessage({
      type: 'SET_NOTIFICATION_SETTINGS',
      data: { endEnabled: state.endNotificationEnabled }
    });
  } catch (e) {
    console.log('[팝업] 백그라운드 알림 실패');
  }

  showToast(
    state.endNotificationEnabled ? i18n('toastEndNotificationEnabled') : i18n('toastEndNotificationDisabled'),
    state.endNotificationEnabled ? 'success' : 'info'
  );
}

// 오프라인 탭 자동 종료 토글 핸들러
async function handleAutoCloseToggle() {
  state.autoCloseOfflineTabs = autoCloseToggle.checked;

  // storage에 저장
  await chrome.storage.local.set({
    autoCloseOfflineTabs: state.autoCloseOfflineTabs
  });

  // 백그라운드에도 알림
  try {
    await sendMessage({
      type: 'SET_NOTIFICATION_SETTINGS',
      data: { autoCloseOfflineTabs: state.autoCloseOfflineTabs }
    });
  } catch (e) {
    console.log('[팝업] 백그라운드 알림 실패');
  }

  showToast(
    state.autoCloseOfflineTabs ? i18n('toastAutoCloseEnabled') : i18n('toastAutoCloseDisabled'),
    state.autoCloseOfflineTabs ? 'success' : 'info'
  );
}

// 알림 시간 변경 핸들러
async function handleDurationChange() {
  let duration = parseInt(notificationDuration.value, 10);

  // 유효성 검사
  if (isNaN(duration) || duration < 3) duration = 3;
  if (duration > 60) duration = 60;

  notificationDuration.value = duration;
  state.notificationDuration = duration;

  // storage에 저장
  await chrome.storage.local.set({
    notificationDuration: state.notificationDuration
  });

  // 백그라운드에도 알림
  try {
    await sendMessage({
      type: 'SET_NOTIFICATION_SETTINGS',
      data: { duration: state.notificationDuration }
    });
  } catch (e) {
    console.log('[팝업] 백그라운드 알림 실패');
  }
}

// 스트리머 목록 렌더링
function renderStreamerList() {
  if (state.favoriteStreamers.length === 0) {
    streamerList.innerHTML = `
      <div class="empty-message">
        <div class="icon">📋</div>
        <p>${i18n('emptyTitle')}<br>${i18n('emptyDescription')}</p>
      </div>
    `;
    return;
  }

  streamerList.innerHTML = state.favoriteStreamers.map(streamer => {
    const isMonitoring = state.monitoringStreamers.includes(streamer.id);
    const status = state.broadcastStatus[streamer.id];
    const isLive = status && status.isLive;
    const isRunning = state.runningTabs[streamer.id];

    // 모니터링 중이면 "자동참여", 아니면 "알림"
    const modeLabel = isMonitoring ? i18n('modeAutoJoin') : i18n('modeNotify');
    const modeClass = isMonitoring ? 'mode-auto' : 'mode-notify';

    // 실행 상태: 탭이 열려있으면 "실행", 아니면 표시 안 함 (방송중일 때만)
    const runningBadge = isLive ?
      `<span class="mode-badge ${isRunning ? 'mode-running' : 'mode-not-running'}">${isRunning ? i18n('modeRunning') : i18n('modeNotRunning')}</span>` : '';

    const statusLiveText = i18n('statusLive');
    const statusOfflineText = i18n('statusOffline');
    const titleAutoJoin = isMonitoring ? i18n('titleAutoJoinDisable') : i18n('titleAutoJoinEnable');
    const titleGoToStation = i18n('titleGoToStation');
    const titleDelete = i18n('deleteButton');

    return `
      <div class="streamer-item" data-id="${escapeHtml(streamer.id)}" draggable="true">
        <input type="checkbox"
               class="streamer-checkbox"
               title="${titleAutoJoin}"
               ${isMonitoring ? 'checked' : ''}
               >
        <div class="streamer-info">
          <div class="streamer-name" data-id="${escapeHtml(streamer.id)}" title="${titleGoToStation}">${escapeHtml(streamer.nickname || streamer.id)}</div>
          <div class="streamer-id">@${escapeHtml(streamer.id)} <span class="mode-badge ${modeClass}">${modeLabel}</span> ${runningBadge}</div>
        </div>
        <div class="streamer-status ${isLive ? 'live' : 'offline'}">
          <span class="status-dot ${isLive ? 'live' : 'offline'}"></span>
          ${isLive ? statusLiveText : statusOfflineText}
        </div>
        <button class="delete-btn" data-id="${escapeHtml(streamer.id)}" title="${titleDelete}">✕</button>
      </div>
    `;
  }).join('');

  // 체크박스 이벤트 리스너 추가
  document.querySelectorAll('.streamer-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', handleCheckboxChange);
  });

  // 삭제 버튼 이벤트 리스너 추가
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteStreamer);
  });

  // 스트리머 이름 클릭 이벤트 리스너 추가
  document.querySelectorAll('.streamer-name').forEach(name => {
    name.addEventListener('click', handleStreamerClick);
  });

  // 드래그 앤 드롭 이벤트 리스너 추가
  document.querySelectorAll('.streamer-item').forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('dragleave', handleDragLeave);
    item.addEventListener('drop', handleDrop);
  });
}

// HTML 이스케이프 (XSS 방지)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== 드래그 앤 드롭 기능 =====

let draggedItem = null;
let draggedIndex = -1;

// 드래그 시작
function handleDragStart(e) {
  draggedItem = e.target.closest('.streamer-item');
  if (!draggedItem) return;

  draggedIndex = Array.from(streamerList.querySelectorAll('.streamer-item')).indexOf(draggedItem);
  draggedItem.classList.add('dragging');

  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedIndex);
}

// 드래그 종료
function handleDragEnd(e) {
  if (draggedItem) {
    draggedItem.classList.remove('dragging');
  }

  // 모든 드래그 오버 스타일 제거
  document.querySelectorAll('.streamer-item').forEach(item => {
    item.classList.remove('drag-over', 'drag-over-bottom');
  });

  draggedItem = null;
  draggedIndex = -1;
}

// 드래그 오버 (드롭 허용)
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const targetItem = e.target.closest('.streamer-item');
  if (!targetItem || targetItem === draggedItem) return;

  // 기존 스타일 제거
  document.querySelectorAll('.streamer-item').forEach(item => {
    item.classList.remove('drag-over', 'drag-over-bottom');
  });

  // 마우스 위치에 따라 위/아래 표시
  const rect = targetItem.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;

  if (e.clientY < midY) {
    targetItem.classList.add('drag-over');
  } else {
    targetItem.classList.add('drag-over-bottom');
  }
}

// 드래그 리브
function handleDragLeave(e) {
  const targetItem = e.target.closest('.streamer-item');
  if (targetItem) {
    targetItem.classList.remove('drag-over', 'drag-over-bottom');
  }
}

// 드롭 처리
async function handleDrop(e) {
  e.preventDefault();

  const targetItem = e.target.closest('.streamer-item');
  if (!targetItem || targetItem === draggedItem) return;

  const items = Array.from(streamerList.querySelectorAll('.streamer-item'));
  let targetIndex = items.indexOf(targetItem);

  // 마우스 위치에 따라 삽입 위치 조정
  const rect = targetItem.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY > midY) {
    targetIndex += 1;
  }

  // 배열 순서 변경
  if (draggedIndex !== -1 && targetIndex !== draggedIndex) {
    const [movedStreamer] = state.favoriteStreamers.splice(draggedIndex, 1);

    // 드래그한 아이템이 앞에 있었으면 타겟 인덱스 조정
    if (draggedIndex < targetIndex) {
      targetIndex -= 1;
    }

    state.favoriteStreamers.splice(targetIndex, 0, movedStreamer);

    // storage에 저장
    await saveStreamerOrder();

    // UI 업데이트
    renderStreamerList();
  }

  // 스타일 정리
  document.querySelectorAll('.streamer-item').forEach(item => {
    item.classList.remove('drag-over', 'drag-over-bottom');
  });
}

// 스트리머 순서 저장
async function saveStreamerOrder() {
  try {
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers
    });

    // 백그라운드에도 알림
    try {
      await sendMessage({
        type: 'UPDATE_FAVORITES',
        data: state.favoriteStreamers
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패, storage에는 저장됨');
    }
  } catch (error) {
    console.error('순서 저장 오류:', error);
    showToast(i18n('toastOrderSaveError'), 'error');
  }
}

// ===== 이벤트 핸들러 =====

// 스트리머 클릭 핸들러 (스테이션 페이지로 이동)
function handleStreamerClick(event) {
  const streamerId = event.target.dataset.id;
  if (streamerId) {
    const stationUrl = `https://www.sooplive.co.kr/station/${streamerId}`;
    chrome.tabs.create({ url: stationUrl });
  }
}

// 체크박스 변경 핸들러
async function handleCheckboxChange(event) {
  const checkbox = event.target;
  const streamerItem = checkbox.closest('.streamer-item');
  const streamerId = streamerItem.dataset.id;

  try {
    if (checkbox.checked) {
      // 모니터링 추가 (선택 제한 없음 - SOOP 동시 시청 4개 제한은 탭 열 때 체크)
      if (!state.monitoringStreamers.includes(streamerId)) {
        state.monitoringStreamers.push(streamerId);
      }
      showToast(i18n('toastAutoJoinAdded', [streamerId]), 'success');
    } else {
      // 모니터링 제거
      state.monitoringStreamers = state.monitoringStreamers.filter(id => id !== streamerId);
      showToast(i18n('toastMonitoringRemoved', [streamerId]), 'info');
    }

    // ★ 직접 chrome.storage.local에 저장 (더 안정적)
    await chrome.storage.local.set({
      monitoringStreamers: state.monitoringStreamers
    });

    // 백그라운드에도 알림 (선택적)
    try {
      await sendMessage({
        type: 'SET_MONITORING_STREAMERS',
        data: state.monitoringStreamers
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패, storage에는 저장됨');
    }

    updateMonitoringCount();
    renderStreamerList();
  } catch (error) {
    console.error('체크박스 변경 오류:', error);
    checkbox.checked = !checkbox.checked;
    showToast(i18n('toastError'), 'error');
  }
}

// 스트리머 삭제 핸들러
async function handleDeleteStreamer(event) {
  const btn = event.target;
  const streamerId = btn.dataset.id;

  // 삭제 확인
  const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
  const displayName = streamer?.nickname || streamerId;

  if (!confirm(i18n('confirmDeleteStreamer', [displayName]))) {
    return;
  }

  try {
    // 목록에서 제거
    state.favoriteStreamers = state.favoriteStreamers.filter(s => s.id !== streamerId);

    // 모니터링 목록에서도 제거
    state.monitoringStreamers = state.monitoringStreamers.filter(id => id !== streamerId);

    // 방송 상태에서도 제거
    delete state.broadcastStatus[streamerId];

    // chrome.storage.local에 저장
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers,
      monitoringStreamers: state.monitoringStreamers
    });

    // 백그라운드에도 알림 (선택적)
    try {
      await sendMessage({
        type: 'UPDATE_FAVORITES',
        data: state.favoriteStreamers
      });
      await sendMessage({
        type: 'SET_MONITORING_STREAMERS',
        data: state.monitoringStreamers
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패, storage에는 저장됨');
    }

    updateMonitoringCount();
    renderStreamerList();
    showToast(i18n('toastStreamerDeleted', [displayName]), 'info');
  } catch (error) {
    console.error('스트리머 삭제 오류:', error);
    showToast(i18n('toastDeleteError'), 'error');
  }
}

// 모니터링 토글 핸들러
async function handleMonitoringToggle() {
  try {
    const isEnabled = monitoringToggle.checked;

    if (isEnabled && state.monitoringStreamers.length === 0) {
      monitoringToggle.checked = false;
      showToast(i18n('toastSelectStreamerFirst'), 'error');
      return;
    }

    state.isMonitoring = isEnabled;

    // ★ 직접 chrome.storage.local에 저장 (더 안정적)
    await chrome.storage.local.set({
      isMonitoring: state.isMonitoring
    });

    // 백그라운드에도 알림
    try {
      await sendMessage({
        type: isEnabled ? 'START_MONITORING' : 'STOP_MONITORING'
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패');
    }

    updateMonitoringStatus();

    showToast(
      isEnabled ? i18n('toastMonitoringStarted') : i18n('toastMonitoringStopped'),
      isEnabled ? 'success' : 'info'
    );
  } catch (error) {
    console.error('모니터링 토글 오류:', error);
    monitoringToggle.checked = !monitoringToggle.checked;
    showToast(i18n('toastError'), 'error');
  }
}

// 새로고침 버튼 핸들러
async function handleRefresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '⏳';

  try {
    // 방송 상태 새로고침 (백그라운드 통해)
    try {
      const response = await sendMessage({ type: 'CHECK_BROADCAST_NOW' });
      if (response.success) {
        state.broadcastStatus = response.data || {};
      }
    } catch (e) {
      console.log('[팝업] 방송 상태 새로고침 실패');
    }

    // 상태 새로 불러오기 (storage에서 직접)
    await loadState();

    renderStreamerList();
    showToast(i18n('toastRefreshComplete'), 'success');
  } catch (error) {
    console.error('새로고침 오류:', error);
    showToast(i18n('toastRefreshFailed'), 'error');
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄';
  }
}

// 스트리머 목록 내보내기 핸들러
function handleExport() {
  if (state.favoriteStreamers.length === 0) {
    showToast(i18n('toastNoStreamersToExport'), 'error');
    return;
  }

  try {
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      streamers: state.favoriteStreamers
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `sooptalk-streamers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(i18n('toastExportComplete', [state.favoriteStreamers.length.toString()]), 'success');
  } catch (error) {
    console.error('내보내기 오류:', error);
    showToast(i18n('toastExportError'), 'error');
  }
}

// 불러오기 버튼 클릭 핸들러
function handleImportClick() {
  importFileInput.click();
}

// 스트리머 목록 불러오기 핸들러
async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // 데이터 검증
    let streamersToImport = [];

    if (Array.isArray(data)) {
      // 이전 형식 호환: 배열 형태
      streamersToImport = data;
    } else if (data.streamers && Array.isArray(data.streamers)) {
      // 새 형식: { version, streamers: [] }
      streamersToImport = data.streamers;
    } else {
      showToast(i18n('toastInvalidFileFormat'), 'error');
      return;
    }

    // 스트리머 데이터 검증 및 정제
    const validStreamers = streamersToImport.filter(s => {
      return s && typeof s.id === 'string' && s.id.trim() !== '';
    }).map(s => ({
      id: s.id.toLowerCase().trim(),
      nickname: s.nickname || s.id
    }));

    if (validStreamers.length === 0) {
      showToast(i18n('toastNoStreamersToImport'), 'error');
      return;
    }

    // 중복 제거하면서 기존 목록에 추가
    let addedCount = 0;
    for (const streamer of validStreamers) {
      const exists = state.favoriteStreamers.find(s => s.id === streamer.id);
      if (!exists) {
        state.favoriteStreamers.push(streamer);
        addedCount++;
      }
    }

    // chrome.storage.local에 저장
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers
    });

    // 백그라운드에도 알림
    try {
      await sendMessage({
        type: 'UPDATE_FAVORITES',
        data: state.favoriteStreamers
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패, storage에는 저장됨');
    }

    renderStreamerList();

    if (addedCount > 0) {
      showToast(i18n('toastImportComplete', [addedCount.toString()]), 'success');
    } else {
      showToast(i18n('toastAllStreamersExist'), 'info');
    }
  } catch (error) {
    console.error('불러오기 오류:', error);
    showToast(i18n('toastFileReadError'), 'error');
  } finally {
    // 파일 입력 초기화 (같은 파일 다시 선택 가능하도록)
    importFileInput.value = '';
  }
}

// 스트리머 수동 추가 핸들러
async function handleManualAdd() {
  const streamerId = manualAddInput.value.trim().toLowerCase();

  if (!streamerId) {
    showToast(i18n('toastEnterStreamerId'), 'error');
    return;
  }

  // ID 유효성 검사 (영문, 숫자, 언더스코어만 허용)
  if (!/^[a-z0-9_]+$/.test(streamerId)) {
    showToast(i18n('toastInvalidStreamerId'), 'error');
    return;
  }

  // 이미 있는지 확인
  if (state.favoriteStreamers.find(s => s.id === streamerId)) {
    showToast(i18n('toastStreamerAlreadyExists'), 'error');
    return;
  }

  manualAddBtn.disabled = true;
  manualAddBtn.textContent = i18n('checkingStatus');

  try {
    // 스트리머 존재 여부 확인
    let nickname = streamerId;
    try {
      const statusResponse = await sendMessage({
        type: 'GET_BROADCAST_STATUS',
        data: streamerId
      });
      if (statusResponse.data?.nickname) {
        nickname = statusResponse.data.nickname;
      }
      // 방송 상태 업데이트
      if (statusResponse.data) {
        state.broadcastStatus[streamerId] = statusResponse.data;
      }
    } catch (e) {
      console.log('[팝업] 방송 상태 확인 실패, ID로 추가');
    }

    // 스트리머 추가
    const newStreamer = {
      id: streamerId,
      nickname: nickname
    };

    state.favoriteStreamers.push(newStreamer);

    // ★ 직접 chrome.storage.local에 저장 (더 안정적)
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers
    });

    // 백그라운드에도 알림 (선택적)
    try {
      await sendMessage({
        type: 'UPDATE_FAVORITES',
        data: state.favoriteStreamers
      });
    } catch (e) {
      console.log('[팝업] 백그라운드 알림 실패, storage에는 저장됨');
    }

    manualAddInput.value = '';
    renderStreamerList();
    showToast(i18n('toastStreamerAdded', [newStreamer.nickname || streamerId]), 'success');
  } catch (error) {
    console.error('스트리머 추가 오류:', error);
    showToast(i18n('toastError'), 'error');
  } finally {
    manualAddBtn.disabled = false;
    manualAddBtn.textContent = i18n('addButton');
  }
}

// ===== 상태 관리 =====

// ★ 직접 chrome.storage.local에서 상태 불러오기 (더 안정적)
async function loadState() {
  try {
    // 먼저 직접 storage에서 읽기
    const storageData = await chrome.storage.local.get([
      'favoriteStreamers',
      'monitoringStreamers',
      'isMonitoring',
      'notificationEnabled',
      'notificationDuration',
      'endNotificationEnabled',
      'autoCloseOfflineTabs'
    ]);

    state.favoriteStreamers = storageData.favoriteStreamers || [];
    state.monitoringStreamers = storageData.monitoringStreamers || [];
    state.isMonitoring = storageData.isMonitoring || false;
    state.notificationEnabled = storageData.notificationEnabled !== undefined
      ? storageData.notificationEnabled : true;
    state.notificationDuration = storageData.notificationDuration || 10;
    state.endNotificationEnabled = storageData.endNotificationEnabled || false;
    state.autoCloseOfflineTabs = storageData.autoCloseOfflineTabs !== undefined
      ? storageData.autoCloseOfflineTabs : true;

    console.log('[팝업] Storage에서 직접 로드:', {
      favorites: state.favoriteStreamers.length,
      monitoring: state.monitoringStreamers.length,
      autoCloseOfflineTabs: state.autoCloseOfflineTabs
    });

    // 방송 상태와 실행 상태는 백그라운드에서 가져오기
    try {
      const response = await sendMessage({ type: 'GET_STATE' });
      if (response.success) {
        if (response.data.broadcastStatus) {
          state.broadcastStatus = response.data.broadcastStatus;
        }
        if (response.data.runningTabs) {
          state.runningTabs = response.data.runningTabs;
        }
      }
    } catch (e) {
      console.log('[팝업] 백그라운드 통신 실패, storage 데이터 사용');
    }
  } catch (error) {
    console.error('[팝업] 상태 불러오기 오류:', error);
  }
}

// ===== 초기화 =====

async function init() {
  // i18n 적용
  applyI18n();

  // 버전 정보 표시
  const versionInfo = document.getElementById('versionInfo');
  if (versionInfo) {
    const manifest = chrome.runtime.getManifest();
    versionInfo.textContent = `v${manifest.version}`;
  }

  // 상태 불러오기 (storage에서 직접)
  await loadState();

  // UI 업데이트
  updateMonitoringStatus();
  updateMonitoringCount();
  updateNotificationSettings();
  renderStreamerList();

  // 이벤트 리스너 등록
  monitoringToggle.addEventListener('change', handleMonitoringToggle);
  refreshBtn.addEventListener('click', handleRefresh);
  manualAddBtn.addEventListener('click', handleManualAdd);
  notificationToggle.addEventListener('change', handleNotificationToggle);
  notificationDuration.addEventListener('change', handleDurationChange);
  notificationDuration.addEventListener('blur', handleDurationChange);

  // 내보내기/불러오기 이벤트 리스너
  exportBtn.addEventListener('click', handleExport);
  importBtn.addEventListener('click', handleImportClick);
  importFileInput.addEventListener('change', handleImport);

  // 방송 종료 알림 토글
  if (endNotificationToggle) {
    endNotificationToggle.addEventListener('change', handleEndNotificationToggle);
  }

  // 오프라인 탭 자동 종료 토글
  if (autoCloseToggle) {
    autoCloseToggle.addEventListener('change', handleAutoCloseToggle);
  }

  // Enter 키로 추가
  manualAddInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleManualAdd();
    }
  });

  // 3초마다 방송 상태만 새로고침 (팝업이 열려있는 동안)
  setInterval(async () => {
    try {
      // 방송 상태는 백그라운드에서 가져오기
      const response = await sendMessage({ type: 'GET_STATE' });
      if (response.success) {
        state.broadcastStatus = response.data.broadcastStatus || {};
        state.runningTabs = response.data.runningTabs || {};

        // isMonitoring 상태도 동기화
        const storageData = await chrome.storage.local.get(['isMonitoring']);
        state.isMonitoring = storageData.isMonitoring || false;

        updateMonitoringStatus();
        renderStreamerList();
      }
    } catch (e) {
      // 백그라운드 통신 실패 시 storage에서 읽기
      const storageData = await chrome.storage.local.get(['isMonitoring']);
      state.isMonitoring = storageData.isMonitoring || false;
      updateMonitoringStatus();
    }
  }, 3000);
}

// 초기화 실행
init();
