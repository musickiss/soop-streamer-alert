// ===== 숲토킹 v2.0 - 사이드패널 =====
// 스트리머 관리, 다운로드 제어, 모니터링 UI

(function() {
  'use strict';

  // ===== 상태 =====
  let state = {
    favoriteStreamers: [],
    isMonitoring: false,
    broadcastStatus: {},
    runningTabs: {},
    downloads: [],
    currentStream: null,
    notificationEnabled: true,
    endNotificationEnabled: false,
    autoCloseOfflineTabs: true,
    filter: 'all',
    // 녹화 상태 (메모리 누적 + 단일 파일 저장)
    isRecording: false,
    recordingTabId: null,
    recordingStartTime: null,
    recordingTimerInterval: null,
    recordingTotalBytes: 0
  };

  // ===== DOM 요소 =====
  const elements = {
    // 모니터링
    monitoringBar: document.getElementById('monitoringBar'),
    monitoringToggle: document.getElementById('monitoringToggle'),
    statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'),
    monitoringInfo: document.getElementById('monitoringInfo'),

    // 빠른 설정
    notificationChip: document.getElementById('notificationChip'),
    endNotificationChip: document.getElementById('endNotificationChip'),
    autoCloseChip: document.getElementById('autoCloseChip'),

    // 현재 시청
    currentStreamCard: document.getElementById('currentStreamCard'),
    notWatchingMessage: document.getElementById('notWatchingMessage'),
    currentStreamerName: document.getElementById('currentStreamerName'),
    currentStreamTitle: document.getElementById('currentStreamTitle'),
    currentAvatar: document.getElementById('currentAvatar'),
    currentAvatarText: document.getElementById('currentAvatarText'),

    // 다운로드
    downloadList: document.getElementById('downloadList'),
    downloadCount: document.getElementById('downloadCount'),
    emptyDownloads: document.getElementById('emptyDownloads'),

    // 스트리머
    streamerList: document.getElementById('streamerList'),
    filterSelect: document.getElementById('filterSelect'),
    exportBtn: document.getElementById('exportBtn'),
    importBtn: document.getElementById('importBtn'),
    importFileInput: document.getElementById('importFileInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    streamerIdInput: document.getElementById('streamerIdInput'),
    addStreamerBtn: document.getElementById('addStreamerBtn'),

    // 저장 공간
    storageValue: document.getElementById('storageValue'),
    storageProgressFill: document.getElementById('storageProgressFill'),

    // 녹화 (메모리 누적 + 단일 파일 저장)
    startRecordingBtn: document.getElementById('startRecordingBtn'),
    stopRecordingBtn: document.getElementById('stopRecordingBtn'),
    recordingStatus: document.getElementById('recordingStatus'),
    recordingTime: document.getElementById('recordingTime'),
    recordingSize: document.getElementById('recordingSize'),

    // 기타
    toast: document.getElementById('toast'),
    versionInfo: document.getElementById('versionInfo'),
    brandText: document.getElementById('brandText')
  };

  // ===== i18n 헬퍼 =====
  function i18n(key, substitutions = []) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function applyI18n() {
    // 브랜드명
    elements.brandText.textContent = i18n('appName') || '숲토킹';

    // data-i18n 요소들
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = i18n(key);
      if (msg && msg !== key) el.textContent = msg;
    });

    // placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = i18n(key);
      if (msg && msg !== key) el.placeholder = msg;
    });
  }

  // ===== 유틸리티 =====
  function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = `toast show ${type}`;
    setTimeout(() => {
      elements.toast.classList.remove('show');
    }, 3000);
  }

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

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getFirstChar(str) {
    if (!str) return '?';
    const first = str.charAt(0).toUpperCase();
    return /[A-Z0-9가-힣]/.test(first) ? first : '📺';
  }

  // ===== 상태 로드/저장 =====
  async function loadState() {
    try {
      const data = await chrome.storage.local.get([
        'favoriteStreamers',
        'isMonitoring',
        'notificationEnabled',
        'endNotificationEnabled',
        'autoCloseOfflineTabs',
        'broadcastStatus'
      ]);

      state.favoriteStreamers = data.favoriteStreamers || [];
      state.isMonitoring = data.isMonitoring || false;
      state.notificationEnabled = data.notificationEnabled !== undefined ? data.notificationEnabled : true;
      state.endNotificationEnabled = data.endNotificationEnabled || false;
      state.autoCloseOfflineTabs = data.autoCloseOfflineTabs !== undefined ? data.autoCloseOfflineTabs : true;
      state.broadcastStatus = data.broadcastStatus || {};

      // 백그라운드에서 추가 상태 가져오기
      try {
        const bgState = await sendMessage({ type: 'GET_STATE' });
        if (bgState.success && bgState.data) {
          state.runningTabs = bgState.data.runningTabs || {};
          state.downloads = bgState.data.downloads || [];
        }
      } catch (e) {
        console.log('[사이드패널] 백그라운드 통신 실패');
      }
    } catch (error) {
      console.error('[사이드패널] 상태 로드 오류:', error);
    }
  }

  // ===== UI 업데이트 =====
  function updateMonitoringUI() {
    const isOn = state.isMonitoring;
    elements.monitoringToggle.checked = isOn;

    if (isOn) {
      elements.monitoringBar.classList.remove('off');
      elements.statusIndicator.classList.remove('off');
      elements.statusText.textContent = i18n('monitoringOn') || '모니터링 ON';
    } else {
      elements.monitoringBar.classList.add('off');
      elements.statusIndicator.classList.add('off');
      elements.statusText.textContent = i18n('monitoringOff') || '모니터링 OFF';
    }

    // 모니터링 정보
    const liveCount = state.favoriteStreamers.filter(s => state.broadcastStatus[s.id]?.isLive).length;
    elements.monitoringInfo.textContent = `${state.favoriteStreamers.length}명 중 ${liveCount}명 방송중`;
  }

  function updateQuickSettings() {
    elements.notificationChip.classList.toggle('active', state.notificationEnabled);
    elements.endNotificationChip.classList.toggle('active', state.endNotificationEnabled);
    elements.autoCloseChip.classList.toggle('active', state.autoCloseOfflineTabs);
  }

  // ===== Content Script 관리 =====
  async function ensureContentScriptLoaded(tabId) {
    try {
      // content script가 응답하는지 테스트
      const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      return response && response.success;
    } catch (error) {
      // content script가 없으면 주입
      console.log('[사이드패널] Content script 주입 시도...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        // 주입 후 잠시 대기
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      } catch (injectError) {
        console.error('[사이드패널] Content script 주입 실패:', injectError);
        return false;
      }
    }
  }

  async function findSoopTab() {
    // 먼저 활성 탭이 SOOP인지 확인
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];

    if (activeTab && activeTab.url && activeTab.url.includes('play.sooplive.co.kr')) {
      return activeTab;
    }

    // 활성 탭이 SOOP이 아니면 SOOP 탭 검색
    const soopTabs = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });
    return soopTabs.length > 0 ? soopTabs[0] : null;
  }

  async function updateCurrentStream() {
    // SOOP 방송 탭 찾기
    try {
      const soopTab = await findSoopTab();

      if (!soopTab) {
        showNotWatching();
        return;
      }

      const match = soopTab.url.match(/play\.sooplive\.co\.kr\/([^\/]+)(?:\/(\d+))?/);
      if (!match) {
        showNotWatching();
        return;
      }

      const streamerId = match[1];
      const broadNo = match[2] || '';

      // 1순위: 저장된 방송 상태에서 정보 가져오기
      const status = state.broadcastStatus[streamerId];
      if (status && status.isLive) {
        showCurrentStream({
          streamerId,
          nickname: status.nickname || streamerId,
          title: status.title || '',
          broadNo: status.broadNo || broadNo
        });
        return;
      }

      // 2순위: Background를 통해 API 조회 (CORS 우회)
      try {
        const apiResponse = await sendMessage({
          type: 'FETCH_STREAM_INFO',
          streamerId,
          broadNo
        });

        if (apiResponse && apiResponse.success) {
          showCurrentStream({
            streamerId,
            nickname: apiResponse.nickname || streamerId,
            title: apiResponse.title || '',
            broadNo: apiResponse.broadNo || broadNo
          });
          return;
        }
      } catch (e) {
        console.log('[사이드패널] 방송 정보 API 조회 실패:', e.message);
      }

      // 3순위: URL에서 추출한 정보만으로 표시 (방송 중으로 간주)
      // SOOP 방송 페이지에 있으면 일단 방송 중으로 표시
      showCurrentStream({
        streamerId,
        nickname: streamerId,
        title: '방송 중',
        broadNo
      });

    } catch (error) {
      console.error('[사이드패널] 현재 스트림 확인 오류:', error);
      showNotWatching();
    }
  }

  function showCurrentStream(info) {
    state.currentStream = info;
    elements.currentStreamCard.style.display = 'block';
    elements.notWatchingMessage.style.display = 'none';
    elements.currentStreamerName.textContent = info.nickname || info.streamerId;
    elements.currentStreamTitle.textContent = info.title || '';
    elements.currentAvatarText.textContent = getFirstChar(info.nickname || info.streamerId);
  }

  function showNotWatching() {
    state.currentStream = null;
    elements.currentStreamCard.style.display = 'none';
    elements.notWatchingMessage.style.display = 'block';
  }

  function updateDownloadList() {
    const downloads = state.downloads || [];
    const activeDownloads = downloads.filter(d => d.isRunning);

    elements.downloadCount.textContent = activeDownloads.length;

    if (activeDownloads.length === 0) {
      elements.downloadList.innerHTML = '';
      elements.emptyDownloads.style.display = 'block';
      return;
    }

    elements.emptyDownloads.style.display = 'none';
    elements.downloadList.innerHTML = activeDownloads.map(dl => `
      <div class="download-item" data-session-id="${escapeHtml(dl.sessionId)}">
        <div class="rec-indicator"></div>
        <div class="info">
          <div class="name-row">
            <span class="name">${escapeHtml(dl.nickname || dl.streamerId)}</span>
            <span class="mode-badge ${dl.isBackgroundDownload ? 'background' : 'watching'}">
              ${dl.isBackgroundDownload ? '💾 백그라운드' : '📺 시청중'}
            </span>
          </div>
          <div class="meta">
            <span>⏱ ${formatDuration(dl.elapsedTime || 0)}</span>
            <span>📦 ${formatBytes(dl.totalBytes || 0)}</span>
          </div>
        </div>
        <button class="stop-btn" data-session-id="${escapeHtml(dl.sessionId)}">중지</button>
      </div>
    `).join('');

    // 중지 버튼 이벤트
    document.querySelectorAll('.download-item .stop-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const sessionId = e.target.dataset.sessionId;
        await stopDownload(sessionId);
      });
    });
  }

  function updateStreamerList() {
    let streamers = [...state.favoriteStreamers];

    // 필터 적용
    if (state.filter === 'live') {
      streamers = streamers.filter(s => state.broadcastStatus[s.id]?.isLive);
    } else if (state.filter === 'offline') {
      streamers = streamers.filter(s => !state.broadcastStatus[s.id]?.isLive);
    }

    if (streamers.length === 0) {
      elements.streamerList.innerHTML = `
        <div class="empty-list">
          <div class="icon">📋</div>
          <h3>${i18n('emptyTitle') || '등록된 스트리머가 없습니다.'}</h3>
          <p>${i18n('emptyDescription') || '아래에서 스트리머 ID를 추가하세요.'}</p>
        </div>
      `;
      return;
    }

    elements.streamerList.innerHTML = streamers.map(streamer => {
      const status = state.broadcastStatus[streamer.id];
      const isLive = status?.isLive || false;
      const settings = streamer.settings || {};
      const autoJoin = settings.autoJoin || false;
      const autoDownload = settings.autoDownload || false;
      const isFastCheck = autoJoin || autoDownload;

      let checkIntervalText = '';
      if (isFastCheck) {
        const reasons = [];
        if (autoJoin) reasons.push('자동참여');
        if (autoDownload) reasons.push('자동DL');
        checkIntervalText = `⚡ 5초 주기 (${reasons.join('+')})`;
      } else {
        checkIntervalText = '🕐 30초 주기 (알림만)';
      }

      return `
        <div class="streamer-card ${isLive ? 'live' : ''}" data-id="${escapeHtml(streamer.id)}" draggable="true">
          <div class="streamer-card-header">
            <div class="drag-handle" title="드래그하여 순서 변경">⋮⋮</div>
            <div class="avatar">
              <span>${getFirstChar(streamer.nickname || streamer.id)}</span>
              <span class="status-dot ${isLive ? 'live' : 'offline'}"></span>
            </div>
            <div class="details">
              <div class="name-row">
                <span class="name">${escapeHtml(streamer.nickname || streamer.id)}</span>
                <span class="status-text ${isLive ? 'live' : 'offline'}">${isLive ? 'LIVE' : 'OFF'}</span>
              </div>
              <div class="check-interval ${isFastCheck ? 'fast' : ''}">${checkIntervalText}</div>
            </div>
            <span class="expand-icon">▼</span>
          </div>
          <div class="streamer-settings">
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">📺</span>
                <div>
                  <span>자동 참여</span>
                  <span class="hint">${autoJoin ? 'ON - 탭 열기' : 'OFF - 시청 안함'}</span>
                </div>
              </div>
              <label class="mini-toggle">
                <input type="checkbox" data-setting="autoJoin" ${autoJoin ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">📥</span>
                <div>
                  <span>자동 다운로드</span>
                  <span class="hint">${autoDownload ? 'ON - 자동 녹화' : 'OFF - 다운로드 안함'}</span>
                </div>
              </div>
              <label class="mini-toggle red">
                <input type="checkbox" data-setting="autoDownload" ${autoDownload ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">🔔</span>
                <span>방송 알림</span>
              </div>
              <label class="mini-toggle">
                <input type="checkbox" data-setting="notification" ${settings.notification !== false ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">⚙️</span>
                <span>다운로드 화질</span>
              </div>
              <div class="quality-setting">
                <select data-setting="downloadQuality">
                  <option value="original" ${settings.downloadQuality === 'original' || !settings.downloadQuality ? 'selected' : ''}>원본</option>
                  <option value="1080p" ${settings.downloadQuality === '1080p' ? 'selected' : ''}>1080p</option>
                  <option value="720p" ${settings.downloadQuality === '720p' ? 'selected' : ''}>720p</option>
                </select>
              </div>
            </div>
            <button class="delete-streamer-btn" data-id="${escapeHtml(streamer.id)}">🗑️ 스트리머 삭제</button>
          </div>
        </div>
      `;
    }).join('');

    // 이벤트 리스너 등록
    bindStreamerCardEvents();
  }

  function bindStreamerCardEvents() {
    // 카드 확장/축소 (드래그 핸들 클릭 제외)
    document.querySelectorAll('.streamer-card-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // 드래그 핸들 클릭 시 확장/축소하지 않음
        if (e.target.closest('.drag-handle')) return;
        const card = header.closest('.streamer-card');
        card.classList.toggle('expanded');
      });
    });

    // 드래그 앤 드롭 이벤트
    let draggedCard = null;

    document.querySelectorAll('.streamer-card').forEach(card => {
      card.addEventListener('dragstart', (e) => {
        draggedCard = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', card.dataset.id);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.streamer-card.drag-over').forEach(c => {
          c.classList.remove('drag-over');
        });
        draggedCard = null;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (draggedCard && draggedCard !== card) {
          card.classList.add('drag-over');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        card.classList.remove('drag-over');

        if (!draggedCard || draggedCard === card) return;

        const draggedId = draggedCard.dataset.id;
        const targetId = card.dataset.id;

        // 배열에서 인덱스 찾기
        const draggedIndex = state.favoriteStreamers.findIndex(s => s.id === draggedId);
        const targetIndex = state.favoriteStreamers.findIndex(s => s.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        // 배열에서 이동
        const [removed] = state.favoriteStreamers.splice(draggedIndex, 1);
        state.favoriteStreamers.splice(targetIndex, 0, removed);

        // 저장
        await chrome.storage.local.set({ favoriteStreamers: state.favoriteStreamers });

        try {
          await sendMessage({
            type: 'UPDATE_FAVORITES',
            data: state.favoriteStreamers
          });
        } catch (e) {}

        // UI 업데이트
        updateStreamerList();
        showToast('순서가 변경되었습니다.', 'success');
      });
    });

    // 설정 토글
    document.querySelectorAll('.streamer-settings input[type="checkbox"]').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.streamer-card');
        const streamerId = card.dataset.id;
        const setting = e.target.dataset.setting;
        const value = e.target.checked;

        await updateStreamerSetting(streamerId, setting, value);
      });
    });

    // 화질 설정
    document.querySelectorAll('.streamer-settings select').forEach(select => {
      select.addEventListener('change', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.streamer-card');
        const streamerId = card.dataset.id;
        const setting = e.target.dataset.setting;
        const value = e.target.value;

        await updateStreamerSetting(streamerId, setting, value);
      });
    });

    // 삭제 버튼
    document.querySelectorAll('.delete-streamer-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const streamerId = e.target.dataset.id;
        const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
        const displayName = streamer?.nickname || streamerId;

        if (confirm(`"${displayName}" 스트리머를 삭제하시겠습니까?`)) {
          await deleteStreamer(streamerId);
        }
      });
    });
  }

  async function updateStorageInfo() {
    try {
      const response = await sendMessage({ type: 'GET_STORAGE_INFO' });
      if (response.success) {
        const { usage, quota, usagePercent } = response;
        elements.storageValue.textContent = `${formatBytes(usage)} / ${formatBytes(quota)} (${usagePercent.toFixed(1)}%)`;
        elements.storageProgressFill.style.width = `${usagePercent}%`;

        if (usagePercent > 90) {
          elements.storageProgressFill.className = 'storage-progress-fill danger';
        } else if (usagePercent > 70) {
          elements.storageProgressFill.className = 'storage-progress-fill warning';
        } else {
          elements.storageProgressFill.className = 'storage-progress-fill';
        }
      }
    } catch (e) {
      // 저장소 정보 가져오기 실패
    }
  }

  // ===== 액션 핸들러 =====
  async function toggleMonitoring() {
    const newState = !state.isMonitoring;

    if (newState && state.favoriteStreamers.length === 0) {
      showToast('모니터링할 스트리머를 먼저 추가하세요.', 'error');
      elements.monitoringToggle.checked = false;
      return;
    }

    state.isMonitoring = newState;

    await chrome.storage.local.set({ isMonitoring: newState });

    try {
      await sendMessage({ type: newState ? 'START_MONITORING' : 'STOP_MONITORING' });
    } catch (e) {
      console.log('[사이드패널] 백그라운드 알림 실패');
    }

    updateMonitoringUI();
    showToast(newState ? '모니터링을 시작합니다.' : '모니터링을 중지합니다.', 'success');
  }

  async function toggleQuickSetting(setting) {
    let newValue;

    switch (setting) {
      case 'notification':
        newValue = !state.notificationEnabled;
        state.notificationEnabled = newValue;
        await chrome.storage.local.set({ notificationEnabled: newValue });
        break;
      case 'endNotification':
        newValue = !state.endNotificationEnabled;
        state.endNotificationEnabled = newValue;
        await chrome.storage.local.set({ endNotificationEnabled: newValue });
        break;
      case 'autoClose':
        newValue = !state.autoCloseOfflineTabs;
        state.autoCloseOfflineTabs = newValue;
        await chrome.storage.local.set({ autoCloseOfflineTabs: newValue });
        break;
    }

    try {
      await sendMessage({
        type: 'SET_NOTIFICATION_SETTINGS',
        data: {
          enabled: state.notificationEnabled,
          endEnabled: state.endNotificationEnabled,
          autoCloseOfflineTabs: state.autoCloseOfflineTabs
        }
      });
    } catch (e) {}

    updateQuickSettings();
  }

  async function stopDownload(sessionId) {
    try {
      const result = await sendMessage({
        type: 'STOP_DOWNLOAD',
        sessionId
      });

      if (result.success) {
        showToast('다운로드가 중지되고 저장되었습니다.', 'success');
        await refreshDownloads();
      } else {
        showToast(result.error || '다운로드 중지 실패', 'error');
      }
    } catch (e) {
      showToast('다운로드 중지 중 오류가 발생했습니다.', 'error');
    }
  }

  async function refreshDownloads() {
    try {
      const result = await sendMessage({ type: 'GET_ALL_DOWNLOADS' });
      if (result.success) {
        state.downloads = result.data || [];
        updateDownloadList();
      }
    } catch (e) {}
  }

  async function updateStreamerSetting(streamerId, setting, value) {
    const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
    if (!streamer) return;

    if (!streamer.settings) streamer.settings = {};
    streamer.settings[setting] = value;

    await chrome.storage.local.set({ favoriteStreamers: state.favoriteStreamers });

    try {
      await sendMessage({
        type: 'UPDATE_FAVORITES',
        data: state.favoriteStreamers
      });
    } catch (e) {}

    // 자동참여/자동다운로드 변경 시 해당 카드만 업데이트 (확장 상태 유지)
    if (setting === 'autoJoin' || setting === 'autoDownload') {
      const card = document.querySelector(`.streamer-card[data-id="${streamerId}"]`);
      if (card) {
        const settings = streamer.settings || {};
        const autoJoin = settings.autoJoin || false;
        const autoDownload = settings.autoDownload || false;
        const isFastCheck = autoJoin || autoDownload;

        // 체크 주기 텍스트 업데이트
        const checkIntervalEl = card.querySelector('.check-interval');
        if (checkIntervalEl) {
          let checkIntervalText = '';
          if (isFastCheck) {
            const reasons = [];
            if (autoJoin) reasons.push('자동참여');
            if (autoDownload) reasons.push('자동DL');
            checkIntervalText = `⚡ 5초 주기 (${reasons.join('+')})`;
            checkIntervalEl.classList.add('fast');
          } else {
            checkIntervalText = '🕐 30초 주기 (알림만)';
            checkIntervalEl.classList.remove('fast');
          }
          checkIntervalEl.textContent = checkIntervalText;
        }

        // 힌트 텍스트 업데이트
        const autoJoinHint = card.querySelector('[data-setting="autoJoin"]')?.closest('.setting-row')?.querySelector('.hint');
        if (autoJoinHint) {
          autoJoinHint.textContent = autoJoin ? 'ON - 탭 열기' : 'OFF - 시청 안함';
        }
        const autoDownloadHint = card.querySelector('[data-setting="autoDownload"]')?.closest('.setting-row')?.querySelector('.hint');
        if (autoDownloadHint) {
          autoDownloadHint.textContent = autoDownload ? 'ON - 자동 녹화' : 'OFF - 다운로드 안함';
        }
      }
    }
  }

  async function addStreamer() {
    const streamerId = elements.streamerIdInput.value.trim().toLowerCase();

    if (!streamerId) {
      showToast('스트리머 ID를 입력하세요.', 'error');
      return;
    }

    if (!/^[a-z0-9_]+$/.test(streamerId)) {
      showToast('올바른 스트리머 ID를 입력하세요.', 'error');
      return;
    }

    if (state.favoriteStreamers.find(s => s.id === streamerId)) {
      showToast('이미 등록된 스트리머입니다.', 'error');
      return;
    }

    elements.addStreamerBtn.disabled = true;
    elements.addStreamerBtn.textContent = '확인중...';

    try {
      // 방송 상태 확인해서 닉네임 가져오기
      let nickname = streamerId;
      try {
        const statusResponse = await sendMessage({
          type: 'GET_BROADCAST_STATUS',
          data: streamerId
        });
        if (statusResponse.data?.nickname) {
          nickname = statusResponse.data.nickname;
        }
        if (statusResponse.data) {
          state.broadcastStatus[streamerId] = statusResponse.data;
        }
      } catch (e) {}

      const newStreamer = {
        id: streamerId,
        nickname: nickname,
        addedAt: Date.now(),
        settings: {
          autoJoin: false,
          autoDownload: false,
          notification: true,
          downloadQuality: 'original'
        }
      };

      state.favoriteStreamers.push(newStreamer);

      await chrome.storage.local.set({ favoriteStreamers: state.favoriteStreamers });

      try {
        await sendMessage({
          type: 'UPDATE_FAVORITES',
          data: state.favoriteStreamers
        });
      } catch (e) {}

      elements.streamerIdInput.value = '';
      updateStreamerList();
      updateMonitoringUI();
      showToast(`${nickname} 추가됨`, 'success');
    } catch (error) {
      showToast('스트리머 추가 중 오류가 발생했습니다.', 'error');
    } finally {
      elements.addStreamerBtn.disabled = false;
      elements.addStreamerBtn.textContent = '추가';
    }
  }

  async function deleteStreamer(streamerId) {
    const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
    const displayName = streamer?.nickname || streamerId;

    state.favoriteStreamers = state.favoriteStreamers.filter(s => s.id !== streamerId);
    delete state.broadcastStatus[streamerId];

    await chrome.storage.local.set({ favoriteStreamers: state.favoriteStreamers });

    try {
      await sendMessage({
        type: 'REMOVE_FAVORITE',
        data: streamerId
      });
    } catch (e) {}

    updateStreamerList();
    updateMonitoringUI();
    showToast(`${displayName} 삭제됨`, 'info');
  }

  async function refreshBroadcastStatus() {
    elements.refreshBtn.disabled = true;

    try {
      const response = await sendMessage({ type: 'CHECK_BROADCAST_NOW' });
      if (response.success) {
        state.broadcastStatus = response.data || {};
        updateStreamerList();
        updateMonitoringUI();
        updateCurrentStream();
        showToast('새로고침 완료', 'success');
      }
    } catch (e) {
      showToast('새로고침 실패', 'error');
    } finally {
      elements.refreshBtn.disabled = false;
    }
  }

  // ===== 녹화 기능 (이벤트 기반) =====
  async function startRecording() {
    if (state.isRecording) {
      showToast('이미 녹화 중입니다.', 'error');
      return;
    }

    try {
      // SOOP 탭 찾기
      const soopTab = await findSoopTab();
      if (!soopTab) {
        showToast('SOOP 방송 탭을 찾을 수 없습니다.', 'error');
        return;
      }

      // 버튼 비활성화 & 로딩 상태
      if (elements.startRecordingBtn) {
        elements.startRecordingBtn.disabled = true;
        elements.startRecordingBtn.innerHTML = '<span class="rec-dot"></span><span>시작 중...</span>';
      }

      // 탭 ID 임시 저장 (이벤트에서 사용)
      state.pendingRecordingTabId = soopTab.id;

      showToast('녹화 시작 중...', 'info');

      // 명령 전송 (응답은 이벤트로 받음)
      await sendMessage({
        type: 'SIDEPANEL_RECORDING_COMMAND',
        tabId: soopTab.id,
        command: 'START_RECORDING',
        params: { streamerId: state.currentStream?.streamerId }
      });

      // 5초 타임아웃 설정 (이벤트가 오지 않으면 복구)
      setTimeout(() => {
        if (!state.isRecording && elements.startRecordingBtn) {
          elements.startRecordingBtn.disabled = false;
          elements.startRecordingBtn.innerHTML = '<span class="rec-dot"></span><span>녹화 시작</span>';
        }
      }, 5000);

    } catch (error) {
      console.error('[사이드패널] 녹화 시작 오류:', error);
      showToast('녹화 시작 실패: ' + error.message, 'error');

      if (elements.startRecordingBtn) {
        elements.startRecordingBtn.disabled = false;
        elements.startRecordingBtn.innerHTML = '<span class="rec-dot"></span><span>녹화 시작</span>';
      }
    }
  }

  async function stopRecording() {
    if (!state.isRecording) {
      showToast('녹화 중이 아닙니다.', 'error');
      return;
    }

    try {
      // 버튼 비활성화 & 로딩 상태
      if (elements.stopRecordingBtn) {
        elements.stopRecordingBtn.disabled = true;
        elements.stopRecordingBtn.innerHTML = '<span class="stop-icon"></span><span>중지 중...</span>';
      }

      showToast('녹화 중지 중...', 'info');

      // 명령 전송 (응답은 이벤트로 받음)
      await sendMessage({
        type: 'SIDEPANEL_RECORDING_COMMAND',
        tabId: state.recordingTabId,
        command: 'STOP_RECORDING'
      });

    } catch (error) {
      console.error('[사이드패널] 녹화 중지 오류:', error);
      showToast('녹화 중지 실패: ' + error.message, 'error');

      if (elements.stopRecordingBtn) {
        elements.stopRecordingBtn.disabled = false;
        elements.stopRecordingBtn.innerHTML = '<span class="stop-icon"></span><span>녹화 중지</span>';
      }
    }
  }

  function startRecordingTimer() {
    // 기존 타이머 정리
    if (state.recordingTimerInterval) {
      clearInterval(state.recordingTimerInterval);
    }

    // 1초마다 시간 업데이트
    state.recordingTimerInterval = setInterval(() => {
      if (state.isRecording && state.recordingStartTime) {
        const elapsed = Date.now() - state.recordingStartTime;
        elements.recordingTime.textContent = formatDuration(elapsed);

        // 녹화 상태 조회 (크기 및 세그먼트 수 업데이트)
        updateRecordingStatus();
      }
    }, 1000);
  }

  function stopRecordingTimer() {
    if (state.recordingTimerInterval) {
      clearInterval(state.recordingTimerInterval);
      state.recordingTimerInterval = null;
    }
  }

  async function updateRecordingStatus() {
    if (!state.recordingTabId) return;

    try {
      // 상태 조회 명령 전송 (응답은 RECORDING_STATUS 이벤트로 받음)
      await sendMessage({
        type: 'SIDEPANEL_RECORDING_COMMAND',
        tabId: state.recordingTabId,
        command: 'GET_STATUS'
      });
    } catch (e) {
      // 상태 조회 실패 무시
    }
  }

  function resetRecordingState() {
    state.isRecording = false;
    state.recordingTabId = null;
    state.recordingStartTime = null;
    state.recordingTotalBytes = 0;
    stopRecordingTimer();
  }

  function updateRecordingUI() {
    if (!elements.startRecordingBtn) return;

    if (state.isRecording) {
      // 녹화 중
      elements.startRecordingBtn.style.display = 'none';
      elements.stopRecordingBtn.style.display = 'flex';
      elements.recordingStatus.style.display = 'flex';
    } else {
      // 대기 상태
      elements.startRecordingBtn.style.display = 'flex';
      elements.stopRecordingBtn.style.display = 'none';
      elements.recordingStatus.style.display = 'none';
      elements.recordingTime.textContent = '00:00:00';
      elements.recordingSize.textContent = '0 MB';
    }
  }

  // 사이드패널 재열림 시 녹화 상태 복원
  async function restoreRecordingState() {
    try {
      // SOOP 탭 찾기
      const soopTab = await findSoopTab();
      if (!soopTab) {
        console.log('[사이드패널] SOOP 탭 없음, 녹화 상태 복원 스킵');
        return;
      }

      // 해당 탭의 녹화 상태 확인
      const result = await sendMessage({
        type: 'SIDEPANEL_RECORDING_COMMAND',
        tabId: soopTab.id,
        command: 'GET_STATUS'
      });

      console.log('[사이드패널] 녹화 상태 복원 확인:', result);

      if (result && result.success && result.result) {
        const status = result.result;

        if (status.isRecording) {
          // 녹화 중인 경우 상태 복원
          state.isRecording = true;
          state.recordingTabId = soopTab.id;

          // 녹화 시작 시간 추정 (현재 시간 - 녹화 시간)
          const durationSeconds = parseFloat(status.duration) || 0;
          state.recordingStartTime = Date.now() - (durationSeconds * 1000);

          // 타이머 시작
          startRecordingTimer();

          // 크기 업데이트
          if (elements.recordingSize) {
            elements.recordingSize.textContent = (status.totalMB || '0') + ' MB';
          }

          console.log('[사이드패널] 녹화 상태 복원됨 - 녹화 중');
        }
      }
    } catch (error) {
      console.log('[사이드패널] 녹화 상태 복원 실패 (정상):', error.message);
      // 실패해도 무시 (새 탭이거나 녹화 안 함)
    }
  }

  // ===== 내보내기/가져오기 =====
  function exportStreamers() {
    if (state.favoriteStreamers.length === 0) {
      showToast('내보낼 스트리머가 없습니다.', 'error');
      return;
    }

    const exportData = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      streamers: state.favoriteStreamers
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sooptalking-streamers-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`${state.favoriteStreamers.length}명의 스트리머를 내보냈습니다.`, 'success');
  }

  async function importStreamers(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      let streamersToImport = [];

      // 버전 2.0 형식
      if (importData.version && importData.streamers) {
        streamersToImport = importData.streamers;
      }
      // 이전 버전 또는 단순 배열 형식
      else if (Array.isArray(importData)) {
        streamersToImport = importData;
      }
      // 이전 버전 객체 형식
      else if (importData.favoriteStreamers) {
        streamersToImport = importData.favoriteStreamers;
      }
      else {
        showToast('올바른 형식의 파일이 아닙니다.', 'error');
        return;
      }

      if (!Array.isArray(streamersToImport) || streamersToImport.length === 0) {
        showToast('가져올 스트리머가 없습니다.', 'error');
        return;
      }

      // 유효성 검사 및 중복 체크
      let addedCount = 0;
      let skippedCount = 0;

      for (const streamer of streamersToImport) {
        // ID가 있는지 확인
        const streamerId = streamer.id || streamer.streamerId;
        if (!streamerId) {
          skippedCount++;
          continue;
        }

        // 이미 존재하는지 확인
        if (state.favoriteStreamers.some(s => s.id === streamerId)) {
          skippedCount++;
          continue;
        }

        // 새 스트리머 추가
        const newStreamer = {
          id: streamerId,
          nickname: streamer.nickname || streamerId,
          addedAt: streamer.addedAt || Date.now(),
          settings: streamer.settings || {
            autoJoin: false,
            autoDownload: false,
            notification: true,
            downloadQuality: 'original'
          }
        };

        state.favoriteStreamers.push(newStreamer);
        addedCount++;
      }

      if (addedCount > 0) {
        await chrome.storage.local.set({ favoriteStreamers: state.favoriteStreamers });

        try {
          await sendMessage({
            type: 'UPDATE_FAVORITES',
            data: state.favoriteStreamers
          });
        } catch (e) {}

        updateStreamerList();
        updateMonitoringUI();
      }

      if (addedCount > 0 && skippedCount > 0) {
        showToast(`${addedCount}명 추가됨, ${skippedCount}명 건너뜀 (중복)`, 'success');
      } else if (addedCount > 0) {
        showToast(`${addedCount}명의 스트리머를 가져왔습니다.`, 'success');
      } else {
        showToast('모든 스트리머가 이미 등록되어 있습니다.', 'info');
      }

    } catch (error) {
      console.error('[사이드패널] 가져오기 오류:', error);
      showToast('파일을 읽는 중 오류가 발생했습니다.', 'error');
    }

    // 파일 입력 초기화
    elements.importFileInput.value = '';
  }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    // 모니터링 토글
    elements.monitoringToggle.addEventListener('change', toggleMonitoring);

    // 빠른 설정
    elements.notificationChip.addEventListener('click', () => toggleQuickSetting('notification'));
    elements.endNotificationChip.addEventListener('click', () => toggleQuickSetting('endNotification'));
    elements.autoCloseChip.addEventListener('click', () => toggleQuickSetting('autoClose'));

    // 녹화 버튼
    if (elements.startRecordingBtn) {
      elements.startRecordingBtn.addEventListener('click', startRecording);
    }
    if (elements.stopRecordingBtn) {
      elements.stopRecordingBtn.addEventListener('click', stopRecording);
    }

    // 필터
    elements.filterSelect.addEventListener('change', (e) => {
      state.filter = e.target.value;
      updateStreamerList();
    });

    // 새로고침
    elements.refreshBtn.addEventListener('click', refreshBroadcastStatus);

    // 내보내기/가져오기
    elements.exportBtn.addEventListener('click', exportStreamers);
    elements.importBtn.addEventListener('click', () => elements.importFileInput.click());
    elements.importFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) {
        importStreamers(e.target.files[0]);
      }
    });

    // 스트리머 추가
    elements.addStreamerBtn.addEventListener('click', addStreamer);
    elements.streamerIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addStreamer();
    });

    // 메시지 수신 (다운로드 진행 상태 등)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'CLOSE_SIDEPANEL':
          // 사이드패널 닫기 요청
          window.close();
          break;

        case 'DOWNLOAD_PROGRESS':
          // 다운로드 진행 상태 업데이트
          const download = state.downloads.find(d => d.sessionId === message.sessionId);
          if (download) {
            Object.assign(download, message.data);
            updateDownloadList();
          } else {
            refreshDownloads();
          }
          break;

        case 'DOWNLOAD_STARTED':
          refreshDownloads();
          updateCurrentStream();
          break;

        case 'DOWNLOAD_COMPLETED':
          refreshDownloads();
          updateCurrentStream();
          showToast(`${message.data.fileName} 다운로드 완료!`, 'success');
          break;

        case 'BROADCAST_STATUS_UPDATED':
          state.broadcastStatus = message.data || {};
          updateStreamerList();
          updateMonitoringUI();
          break;

        // ===== 이벤트 기반 녹화 핸들러 =====
        case 'RECORDING_STARTED':
          console.log('[사이드패널] 🔴 녹화 시작됨:', message.data);
          state.isRecording = true;
          state.recordingTabId = message.data.tabId || state.pendingRecordingTabId;
          state.recordingStartTime = Date.now();
          state.recordingTotalBytes = 0;

          updateRecordingUI();
          startRecordingTimer();
          showToast('🔴 녹화가 시작되었습니다!', 'success');
          break;

        case 'RECORDING_STOPPED':
          console.log('[사이드패널] ⏹ 녹화 중지됨:', message.data);
          stopRecordingTimer();

          const stoppedTotalMB = message.data.totalBytes
            ? (message.data.totalBytes / 1024 / 1024).toFixed(2)
            : '0';
          showToast(`✅ 녹화 완료! ${stoppedTotalMB} MB 저장됨`, 'success');

          resetRecordingState();
          updateRecordingUI();
          break;

        case 'RECORDING_STATUS':
          console.log('[사이드패널] 녹화 상태:', message.data);
          if (message.data.isRecording && !state.isRecording) {
            // 녹화 중인데 상태가 안 맞으면 복원
            state.isRecording = true;
            state.recordingTabId = message.data.tabId;
            state.recordingStartTime = Date.now() - ((parseFloat(message.data.duration) || 0) * 1000);
            updateRecordingUI();
            startRecordingTimer();
          }
          if (elements.recordingSize && message.data.totalMB) {
            elements.recordingSize.textContent = message.data.totalMB + ' MB';
          }
          break;

        case 'RECORDING_ERROR':
          // 녹화 에러
          console.error('[사이드패널] ❌ 녹화 에러:', message.data);
          showToast('녹화 오류: ' + (message.data.error || '알 수 없는 오류'), 'error');

          // 버튼 복구
          if (elements.startRecordingBtn) {
            elements.startRecordingBtn.disabled = false;
            elements.startRecordingBtn.innerHTML = '<span class="rec-dot"></span><span>녹화 시작</span>';
          }
          if (elements.stopRecordingBtn) {
            elements.stopRecordingBtn.disabled = false;
            elements.stopRecordingBtn.innerHTML = '<span class="stop-icon"></span><span>녹화 중지</span>';
          }

          // START_RECORDING 실패 시 상태 리셋
          if (message.data.command === 'START_RECORDING') {
            resetRecordingState();
            updateRecordingUI();
          }
          break;

        case 'RECORDING_COMPLETED':
          // 녹화 완료 (방송 종료 등으로 인한 자동 완료)
          console.log('[사이드패널] 녹화 완료:', message.data);
          stopRecordingTimer();
          resetRecordingState();
          updateRecordingUI();
          if (message.data && message.data.totalBytes) {
            const sizeMB = (message.data.totalBytes / 1024 / 1024).toFixed(2);
            const durationMin = message.data.duration ? (message.data.duration / 60).toFixed(1) : '0';
            showToast(`녹화 완료! ${durationMin}분, ${sizeMB} MB 저장됨`, 'success');
          } else {
            showToast('녹화가 완료되었습니다.', 'success');
          }
          break;

        case 'RECORDING_STATUS_CHANGED':
          // 레거시 녹화 상태 업데이트 (호환성)
          const recordingData = message.data;
          console.log('[사이드패널] 녹화 상태 변경:', recordingData);

          if (recordingData.status === 'complete') {
            // 녹화 완료
            stopRecordingTimer();
            resetRecordingState();
            updateRecordingUI();
            showToast('녹화가 완료되었습니다.', 'success');
          } else if (recordingData.status === 'error') {
            // 녹화 에러
            resetRecordingState();
            updateRecordingUI();
            showToast('녹화 오류: ' + (recordingData.error || '알 수 없는 오류'), 'error');
          }
          break;
      }
    });

    // 사이드패널이 닫힐 때 background에 알림
    window.addEventListener('beforeunload', async () => {
      try {
        const currentWindow = await chrome.windows.getCurrent();
        chrome.runtime.sendMessage({
          type: 'SIDEPANEL_CLOSED',
          windowId: currentWindow.id
        }).catch(() => {});
      } catch (e) {}
    });

    // 탭 변경 감지
    chrome.tabs.onActivated.addListener(() => {
      setTimeout(updateCurrentStream, 100);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        updateCurrentStream();
      }
    });
  }

  // ===== 초기화 =====
  async function init() {
    applyI18n();

    // 버전 정보
    const manifest = chrome.runtime.getManifest();
    elements.versionInfo.textContent = `v${manifest.version}`;

    // 상태 로드
    await loadState();

    // UI 초기화
    updateMonitoringUI();
    updateQuickSettings();
    updateCurrentStream();
    updateStreamerList();

    // 녹화 상태 복원 (사이드패널 재열림 시)
    await restoreRecordingState();

    updateRecordingUI();
    await refreshDownloads();
    await updateStorageInfo();

    // 이벤트 바인딩
    bindEvents();

    // 주기적 업데이트
    setInterval(async () => {
      await refreshDownloads();
      await updateStorageInfo();
    }, 5000);

    // 방송 상태 주기적 업데이트
    setInterval(async () => {
      try {
        const response = await sendMessage({ type: 'GET_STATE' });
        if (response.success && response.data) {
          state.broadcastStatus = response.data.broadcastStatus || {};
          state.runningTabs = response.data.runningTabs || {};
          state.isMonitoring = response.data.isMonitoring || false;
          updateMonitoringUI();
          updateStreamerList();
        }
      } catch (e) {}
    }, 3000);
  }

  init();
})();
