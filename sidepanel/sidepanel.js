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
    filter: 'all'
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
    downloadBtn: document.getElementById('downloadBtn'),
    qualitySelect: document.getElementById('qualitySelect'),

    // 다운로드
    downloadList: document.getElementById('downloadList'),
    downloadCount: document.getElementById('downloadCount'),
    emptyDownloads: document.getElementById('emptyDownloads'),

    // 스트리머
    streamerList: document.getElementById('streamerList'),
    filterSelect: document.getElementById('filterSelect'),
    refreshBtn: document.getElementById('refreshBtn'),
    streamerIdInput: document.getElementById('streamerIdInput'),
    addStreamerBtn: document.getElementById('addStreamerBtn'),

    // 저장 공간
    storageValue: document.getElementById('storageValue'),
    storageProgressFill: document.getElementById('storageProgressFill'),

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

  function updateCurrentStream() {
    // 현재 활성 탭이 SOOP 방송인지 확인
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.url) {
        showNotWatching();
        return;
      }

      const match = tab.url.match(/play\.sooplive\.co\.kr\/([^\/]+)/);
      if (!match) {
        showNotWatching();
        return;
      }

      const streamerId = match[1];

      // Content script에서 방송 정보 가져오기
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_BROADCAST_INFO' });
        if (response.success && response.data) {
          showCurrentStream(response.data);
        } else {
          // fallback: API에서 정보 가져오기
          const status = state.broadcastStatus[streamerId];
          if (status && status.isLive) {
            showCurrentStream({
              streamerId,
              nickname: status.nickname || streamerId,
              title: status.title || ''
            });
          } else {
            showNotWatching();
          }
        }
      } catch (e) {
        // Content script 통신 실패
        showNotWatching();
      }
    });
  }

  function showCurrentStream(info) {
    state.currentStream = info;
    elements.currentStreamCard.style.display = 'block';
    elements.notWatchingMessage.style.display = 'none';
    elements.currentStreamerName.textContent = info.nickname || info.streamerId;
    elements.currentStreamTitle.textContent = info.title || '';
    elements.currentAvatarText.textContent = getFirstChar(info.nickname || info.streamerId);

    // 다운로드 중인지 확인
    const isDownloading = state.downloads.some(d => d.streamerId === info.streamerId && d.isRunning);
    if (isDownloading) {
      elements.downloadBtn.className = 'download-btn stop';
      elements.downloadBtn.innerHTML = '<span class="rec-icon"></span><span>다운로드 중지</span>';
    } else {
      elements.downloadBtn.className = 'download-btn start';
      elements.downloadBtn.innerHTML = '<span class="rec-icon"></span><span>지금부터 다운로드</span>';
    }
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
        <div class="streamer-card ${isLive ? 'live' : ''}" data-id="${escapeHtml(streamer.id)}">
          <div class="streamer-card-header">
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
    // 카드 확장/축소
    document.querySelectorAll('.streamer-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest('.streamer-card');
        card.classList.toggle('expanded');
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

  async function startDownload() {
    if (!state.currentStream) {
      showToast('SOOP 방송을 시청 중이 아닙니다.', 'error');
      return;
    }

    // 다운로드 중인지 확인
    const existingDownload = state.downloads.find(
      d => d.streamerId === state.currentStream.streamerId && d.isRunning
    );

    if (existingDownload) {
      // 중지
      await stopDownload(existingDownload.sessionId);
      return;
    }

    // 다운로드 시작
    const quality = elements.qualitySelect.value;

    try {
      // 현재 탭에서 m3u8 URL 가져오기
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];

      const m3u8Response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_M3U8_URL' });

      if (!m3u8Response.success) {
        showToast('m3u8 URL을 가져올 수 없습니다. 잠시 후 다시 시도하세요.', 'error');
        return;
      }

      const result = await sendMessage({
        type: 'START_DOWNLOAD',
        options: {
          streamerId: state.currentStream.streamerId,
          broadNo: state.currentStream.broadNo,
          nickname: state.currentStream.nickname,
          title: state.currentStream.title,
          m3u8Url: m3u8Response.m3u8Url,
          baseUrl: m3u8Response.baseUrl,
          quality,
          isBackgroundDownload: false
        }
      });

      if (result.success) {
        showToast('다운로드가 시작되었습니다!', 'success');
        await refreshDownloads();
        updateCurrentStream();
      } else {
        showToast(result.error || '다운로드 시작 실패', 'error');
      }
    } catch (e) {
      showToast('다운로드 시작 중 오류가 발생했습니다.', 'error');
      console.error(e);
    }
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
        updateCurrentStream();
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

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    // 모니터링 토글
    elements.monitoringToggle.addEventListener('change', toggleMonitoring);

    // 빠른 설정
    elements.notificationChip.addEventListener('click', () => toggleQuickSetting('notification'));
    elements.endNotificationChip.addEventListener('click', () => toggleQuickSetting('endNotification'));
    elements.autoCloseChip.addEventListener('click', () => toggleQuickSetting('autoClose'));

    // 다운로드 버튼
    elements.downloadBtn.addEventListener('click', startDownload);

    // 필터
    elements.filterSelect.addEventListener('change', (e) => {
      state.filter = e.target.value;
      updateStreamerList();
    });

    // 새로고침
    elements.refreshBtn.addEventListener('click', refreshBroadcastStatus);

    // 스트리머 추가
    elements.addStreamerBtn.addEventListener('click', addStreamer);
    elements.streamerIdInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addStreamer();
    });

    // 메시지 수신 (다운로드 진행 상태 등)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
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
      }
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
