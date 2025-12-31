// ===== 숲토킹 v3.2.0 - 사이드패널 =====
// video.captureStream 기반 녹화, Background와 메시지 통신

(function() {
  'use strict';

  // ===== 상태 =====
  const state = {
    favoriteStreamers: [],
    isMonitoring: false,
    broadcastStatus: {},
    settings: {
      notificationEnabled: true,
      endNotificationEnabled: false,
      autoCloseOfflineTabs: true
    },
    currentStream: null,
    currentSoopTabId: null,
    filter: 'all',
    // 현재 탭 녹화 상태 (sessionId 기반)
    currentTabRecording: null
  };

  // ===== DOM 요소 =====
  const elements = {};

  function initElements() {
    elements.monitoringBar = document.getElementById('monitoringBar');
    elements.monitoringToggle = document.getElementById('monitoringToggle');
    elements.statusIndicator = document.getElementById('statusIndicator');
    elements.statusText = document.getElementById('statusText');
    elements.monitoringInfo = document.getElementById('monitoringInfo');

    elements.notificationChip = document.getElementById('notificationChip');
    elements.endNotificationChip = document.getElementById('endNotificationChip');
    elements.autoCloseChip = document.getElementById('autoCloseChip');

    elements.currentStreamCard = document.getElementById('currentStreamCard');
    elements.notWatchingMessage = document.getElementById('notWatchingMessage');
    elements.currentStreamerName = document.getElementById('currentStreamerName');
    elements.currentStreamTitle = document.getElementById('currentStreamTitle');
    elements.currentAvatarText = document.getElementById('currentAvatarText');

    elements.startRecordingBtn = document.getElementById('startRecordingBtn');

    elements.activeRecordingList = document.getElementById('activeRecordingList');
    elements.recordingCount = document.getElementById('recordingCount');
    elements.noRecordingMessage = document.getElementById('noRecordingMessage');

    elements.streamerList = document.getElementById('streamerList');
    elements.filterSelect = document.getElementById('filterSelect');
    elements.exportBtn = document.getElementById('exportBtn');
    elements.importBtn = document.getElementById('importBtn');
    elements.importFileInput = document.getElementById('importFileInput');
    elements.refreshBtn = document.getElementById('refreshBtn');
    elements.streamerIdInput = document.getElementById('streamerIdInput');
    elements.addStreamerBtn = document.getElementById('addStreamerBtn');

    elements.storageValue = document.getElementById('storageValue');
    elements.storageProgressFill = document.getElementById('storageProgressFill');

    elements.toast = document.getElementById('toast');
    elements.versionInfo = document.getElementById('versionInfo');
    elements.brandText = document.getElementById('brandText');
  }

  // ===== i18n =====
  function i18n(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  function applyI18n() {
    if (elements.brandText) {
      elements.brandText.textContent = i18n('appName') || '숲토킹';
    }

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const msg = i18n(key);
      if (msg && msg !== key) el.textContent = msg;
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const msg = i18n(key);
      if (msg && msg !== key) el.placeholder = msg;
    });
  }

  // ===== 유틸리티 =====
  function showToast(message, type = 'info') {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.className = `toast show ${type}`;
    setTimeout(() => {
      elements.toast.classList.remove('show');
    }, 3000);
  }

  async function sendMessage(message) {
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
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  function getFirstChar(str) {
    if (!str) return '?';
    const first = str.charAt(0).toUpperCase();
    return /[A-Z0-9가-힣]/.test(first) ? first : '📺';
  }

  // ===== 상태 로드 =====
  async function loadState() {
    try {
      const response = await sendMessage({ type: 'GET_STATE' });
      if (response?.success && response.data) {
        state.isMonitoring = response.data.isMonitoring || false;
        state.favoriteStreamers = response.data.favoriteStreamers || [];
        state.broadcastStatus = response.data.broadcastStatus || {};
        state.settings = response.data.settings || state.settings;
      }
    } catch (error) {
      console.error('[사이드패널] 상태 로드 오류:', error);
    }
  }

  // ===== UI 업데이트 =====
  function updateMonitoringUI() {
    if (!elements.monitoringToggle) return;

    const isOn = state.isMonitoring;
    elements.monitoringToggle.checked = isOn;

    if (isOn) {
      elements.monitoringBar?.classList.remove('off');
      elements.statusIndicator?.classList.remove('off');
      if (elements.statusText) {
        elements.statusText.textContent = i18n('monitoringOn') || '모니터링 ON';
      }
    } else {
      elements.monitoringBar?.classList.add('off');
      elements.statusIndicator?.classList.add('off');
      if (elements.statusText) {
        elements.statusText.textContent = i18n('monitoringOff') || '모니터링 OFF';
      }
    }

    const liveCount = state.favoriteStreamers.filter(
      s => state.broadcastStatus[s.id]?.isLive
    ).length;
    if (elements.monitoringInfo) {
      elements.monitoringInfo.textContent = `${state.favoriteStreamers.length}명 중 ${liveCount}명 방송중`;
    }
  }

  function updateQuickSettings() {
    elements.notificationChip?.classList.toggle('active', state.settings.notificationEnabled);
    elements.endNotificationChip?.classList.toggle('active', state.settings.endNotificationEnabled);
    elements.autoCloseChip?.classList.toggle('active', state.settings.autoCloseOfflineTabs);
  }

  // ===== 현재 스트림 감지 =====
  async function findSoopTab() {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = activeTabs[0];

    if (activeTab?.url?.includes('play.sooplive.co.kr')) {
      return activeTab;
    }

    const soopTabs = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });
    return soopTabs.length > 0 ? soopTabs[0] : null;
  }

  async function updateCurrentStream() {
    try {
      const soopTab = await findSoopTab();

      if (!soopTab) {
        state.currentSoopTabId = null;
        state.currentStream = null;
        showNotWatching();
        updateRecordingButton();
        return;
      }

      state.currentSoopTabId = soopTab.id;

      const match = soopTab.url.match(/play\.sooplive\.co\.kr\/([^\/]+)/);
      if (!match) {
        showNotWatching();
        updateRecordingButton();
        return;
      }

      const streamerId = match[1];
      const status = state.broadcastStatus[streamerId];

      const streamInfo = {
        streamerId,
        nickname: status?.nickname || streamerId,
        title: status?.title || '',
        tabId: soopTab.id
      };

      state.currentStream = streamInfo;
      showCurrentStream(streamInfo);
      updateRecordingButton();

    } catch (error) {
      console.error('[사이드패널] 현재 스트림 확인 오류:', error);
      showNotWatching();
    }
  }

  function showCurrentStream(info) {
    if (!elements.currentStreamCard) return;
    elements.currentStreamCard.style.display = 'block';
    if (elements.notWatchingMessage) {
      elements.notWatchingMessage.style.display = 'none';
    }
    if (elements.currentStreamerName) {
      elements.currentStreamerName.textContent = info.nickname || info.streamerId;
    }
    if (elements.currentStreamTitle) {
      elements.currentStreamTitle.textContent = info.title || '';
    }
    if (elements.currentAvatarText) {
      elements.currentAvatarText.textContent = getFirstChar(info.nickname || info.streamerId);
    }
  }

  function showNotWatching() {
    if (elements.currentStreamCard) {
      elements.currentStreamCard.style.display = 'none';
    }
    if (elements.notWatchingMessage) {
      elements.notWatchingMessage.style.display = 'block';
    }
  }

  // ===== 녹화 기능 (video.captureStream 기반) =====
  async function startRecording() {
    if (!state.currentStream || !state.currentSoopTabId) {
      showToast('SOOP 방송 탭을 찾을 수 없습니다.', 'error');
      return;
    }

    const { streamerId, nickname, tabId } = state.currentStream;

    if (elements.startRecordingBtn) {
      elements.startRecordingBtn.disabled = true;
      elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>시작 중...</span>';
    }

    showToast('녹화 시작 중...', 'info');

    try {
      // Background에 녹화 시작 요청 (tabId 기반)
      const result = await sendMessage({
        type: 'START_RECORDING_REQUEST',
        tabId: tabId,
        streamerId: streamerId,
        nickname: nickname
      });

      if (result?.success) {
        state.currentTabRecording = {
          tabId: tabId,
          streamerId: streamerId,
          nickname: nickname,
          startTime: Date.now()
        };
        showToast(`🔴 ${nickname || streamerId} 녹화 시작!`, 'success');
        updateRecordingButton();
        updateActiveRecordingList();
      } else {
        throw new Error(result?.error || '녹화 시작 실패');
      }
    } catch (error) {
      console.error('[사이드패널] 녹화 시작 오류:', error);
      showToast('녹화 시작 실패: ' + (error.message || '알 수 없는 오류'), 'error');

      if (elements.startRecordingBtn) {
        elements.startRecordingBtn.disabled = false;
        elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>녹화 시작</span>';
      }
    }
  }

  async function stopRecording(tabId) {
    try {
      const result = await sendMessage({
        type: 'STOP_RECORDING_REQUEST',
        tabId: tabId
      });

      if (result?.success) {
        if (state.currentTabRecording?.tabId === tabId) {
          state.currentTabRecording = null;
        }
        showToast('녹화가 중지되었습니다.', 'success');
        updateRecordingButton();
        updateActiveRecordingList();
      } else {
        throw new Error(result?.error || '녹화 중지 실패');
      }
    } catch (error) {
      console.error('[사이드패널] 녹화 중지 오류:', error);
      showToast('녹화 중지 실패: ' + (error.message || '알 수 없는 오류'), 'error');
    }
  }

  function updateRecordingButton() {
    if (!elements.startRecordingBtn) return;

    // 현재 탭에서 녹화 중인지 확인
    const isRecordingThisTab = state.currentTabRecording &&
      state.currentTabRecording.tabId === state.currentSoopTabId;

    if (isRecordingThisTab) {
      elements.startRecordingBtn.style.display = 'none';
    } else {
      elements.startRecordingBtn.style.display = 'flex';
      elements.startRecordingBtn.disabled = false;
      elements.startRecordingBtn.innerHTML = '<span class="record-icon"></span><span>녹화 시작</span>';
    }
  }

  // ===== 녹화 목록 =====
  async function updateActiveRecordingList() {
    try {
      const result = await sendMessage({ type: 'GET_ALL_RECORDINGS' });
      const recordings = result?.success && Array.isArray(result.data) ? result.data : [];

      if (elements.recordingCount) {
        elements.recordingCount.textContent = recordings.length;
      }

      if (elements.noRecordingMessage) {
        elements.noRecordingMessage.style.display = recordings.length === 0 ? 'block' : 'none';
      }

      if (!elements.activeRecordingList) return;

      if (recordings.length === 0) {
        elements.activeRecordingList.innerHTML = '';
        return;
      }

      elements.activeRecordingList.innerHTML = recordings.map(rec => {
        const elapsed = rec.elapsedTime || Math.floor((Date.now() - rec.startTime) / 1000);
        const timeStr = formatDuration(elapsed);
        const sizeStr = formatBytes(rec.totalBytes || 0);
        const displayName = escapeHtml(rec.nickname || rec.streamerId || '알 수 없음');

        return `
          <div class="recording-card" data-tab-id="${rec.tabId}">
            <div class="recording-card-header">
              <span class="recording-indicator"></span>
              <span class="recording-streamer-name">${displayName}</span>
            </div>
            <div class="recording-card-stats">
              <div class="recording-stat">
                <span>⏱️</span>
                <span class="recording-stat-value recording-time">${timeStr}</span>
              </div>
              <div class="recording-stat">
                <span>💾</span>
                <span class="recording-stat-value recording-size">${sizeStr}</span>
              </div>
            </div>
            <button class="recording-stop-btn" data-tab-id="${rec.tabId}">
              <span>⏹</span>
              <span>녹화 중지</span>
            </button>
          </div>
        `;
      }).join('');

      // 중지 버튼 이벤트 (tabId 사용)
      elements.activeRecordingList.querySelectorAll('.recording-stop-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tabId = parseInt(btn.dataset.tabId);
          if (tabId) stopRecording(tabId);
        });
      });

    } catch (error) {
      console.error('[사이드패널] 녹화 목록 업데이트 오류:', error);
    }
  }

  // ===== 스트리머 목록 =====
  function updateStreamerList() {
    if (!elements.streamerList) return;

    let streamers = [...state.favoriteStreamers];

    if (state.filter === 'live') {
      streamers = streamers.filter(s => state.broadcastStatus[s.id]?.isLive);
    } else if (state.filter === 'offline') {
      streamers = streamers.filter(s => !state.broadcastStatus[s.id]?.isLive);
    }

    if (streamers.length === 0) {
      elements.streamerList.innerHTML = `
        <div class="empty-list">
          <div class="icon">📋</div>
          <h3>등록된 스트리머가 없습니다</h3>
          <p>아래에서 스트리머 ID를 추가하세요</p>
        </div>
      `;
      return;
    }

    elements.streamerList.innerHTML = streamers.map(streamer => {
      const status = state.broadcastStatus[streamer.id];
      const isLive = status?.isLive || false;

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
              ${isLive && status.title ? `<div class="stream-title">${escapeHtml(status.title)}</div>` : ''}
            </div>
            <span class="expand-icon">▼</span>
          </div>
          <div class="streamer-settings">
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">📺</span>
                <span>자동 참여</span>
              </div>
              <label class="mini-toggle">
                <input type="checkbox" data-setting="autoJoin" ${streamer.autoJoin ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">📥</span>
                <span>자동 녹화</span>
              </div>
              <label class="mini-toggle red">
                <input type="checkbox" data-setting="autoRecord" ${streamer.autoRecord ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <button class="delete-streamer-btn" data-id="${escapeHtml(streamer.id)}">🗑️ 스트리머 삭제</button>
          </div>
        </div>
      `;
    }).join('');

    bindStreamerCardEvents();
  }

  function bindStreamerCardEvents() {
    // 카드 확장/축소
    document.querySelectorAll('.streamer-card-header').forEach(header => {
      header.addEventListener('click', () => {
        const card = header.closest('.streamer-card');
        card?.classList.toggle('expanded');
      });
    });

    // 설정 토글
    document.querySelectorAll('.streamer-settings input[type="checkbox"]').forEach(toggle => {
      toggle.addEventListener('change', async (e) => {
        e.stopPropagation();
        const card = e.target.closest('.streamer-card');
        const streamerId = card?.dataset.id;
        const setting = e.target.dataset.setting;
        const value = e.target.checked;

        if (streamerId && setting) {
          await updateStreamerSetting(streamerId, setting, value);
        }
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

  async function updateStreamerSetting(streamerId, setting, value) {
    try {
      const updates = { [setting]: value };
      const result = await sendMessage({
        type: 'UPDATE_STREAMER',
        streamerId,
        updates
      });

      if (result?.success) {
        const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
        if (streamer) {
          streamer[setting] = value;
        }
      }
    } catch (error) {
      console.error('[사이드패널] 스트리머 설정 업데이트 오류:', error);
    }
  }

  // ===== 스트리머 관리 =====
  async function addStreamer() {
    const input = elements.streamerIdInput;
    if (!input) return;

    const streamerId = input.value.trim().toLowerCase();

    if (!streamerId) {
      showToast('스트리머 ID를 입력하세요.', 'error');
      return;
    }

    if (!/^[a-z0-9_]+$/.test(streamerId)) {
      showToast('올바른 스트리머 ID를 입력하세요.', 'error');
      return;
    }

    if (elements.addStreamerBtn) {
      elements.addStreamerBtn.disabled = true;
      elements.addStreamerBtn.textContent = '확인중...';
    }

    try {
      const result = await sendMessage({
        type: 'ADD_STREAMER',
        streamerId
      });

      if (result?.success) {
        input.value = '';
        if (result.streamer) {
          state.favoriteStreamers.push(result.streamer);
        }
        updateStreamerList();
        updateMonitoringUI();
        showToast(`${result.streamer?.nickname || streamerId} 추가됨`, 'success');
      } else {
        showToast(result?.error || '스트리머 추가 실패', 'error');
      }
    } catch (error) {
      showToast('스트리머 추가 중 오류가 발생했습니다.', 'error');
    } finally {
      if (elements.addStreamerBtn) {
        elements.addStreamerBtn.disabled = false;
        elements.addStreamerBtn.textContent = '추가';
      }
    }
  }

  async function deleteStreamer(streamerId) {
    try {
      const result = await sendMessage({
        type: 'REMOVE_STREAMER',
        streamerId
      });

      if (result?.success) {
        const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
        const displayName = streamer?.nickname || streamerId;

        state.favoriteStreamers = state.favoriteStreamers.filter(s => s.id !== streamerId);
        delete state.broadcastStatus[streamerId];

        updateStreamerList();
        updateMonitoringUI();
        showToast(`${displayName} 삭제됨`, 'info');
      }
    } catch (error) {
      showToast('스트리머 삭제 중 오류가 발생했습니다.', 'error');
    }
  }

  // ===== 모니터링 토글 =====
  async function toggleMonitoring() {
    const newState = !state.isMonitoring;

    if (newState && state.favoriteStreamers.length === 0) {
      showToast('모니터링할 스트리머를 먼저 추가하세요.', 'error');
      if (elements.monitoringToggle) {
        elements.monitoringToggle.checked = false;
      }
      return;
    }

    try {
      await sendMessage({
        type: 'SET_MONITORING',
        enabled: newState
      });

      state.isMonitoring = newState;
      updateMonitoringUI();
      showToast(newState ? '모니터링을 시작합니다.' : '모니터링을 중지합니다.', 'success');
    } catch (error) {
      showToast('모니터링 설정 실패', 'error');
    }
  }

  // ===== 빠른 설정 =====
  async function toggleQuickSetting(setting) {
    let newSettings = { ...state.settings };

    switch (setting) {
      case 'notification':
        newSettings.notificationEnabled = !state.settings.notificationEnabled;
        break;
      case 'endNotification':
        newSettings.endNotificationEnabled = !state.settings.endNotificationEnabled;
        break;
      case 'autoClose':
        newSettings.autoCloseOfflineTabs = !state.settings.autoCloseOfflineTabs;
        break;
    }

    try {
      await sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: newSettings
      });

      state.settings = newSettings;
      updateQuickSettings();
    } catch (error) {
      showToast('설정 변경 실패', 'error');
    }
  }

  // ===== 내보내기/가져오기 =====
  function exportStreamers() {
    if (state.favoriteStreamers.length === 0) {
      showToast('내보낼 스트리머가 없습니다.', 'error');
      return;
    }

    const exportData = {
      version: '3.0',
      exportedAt: new Date().toISOString(),
      streamers: state.favoriteStreamers
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sooptalking-${new Date().toISOString().slice(0, 10)}.json`;
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

      if (importData.streamers) {
        streamersToImport = importData.streamers;
      } else if (Array.isArray(importData)) {
        streamersToImport = importData;
      } else if (importData.favoriteStreamers) {
        streamersToImport = importData.favoriteStreamers;
      }

      if (!Array.isArray(streamersToImport) || streamersToImport.length === 0) {
        showToast('가져올 스트리머가 없습니다.', 'error');
        return;
      }

      let addedCount = 0;
      let skippedCount = 0;

      for (const streamer of streamersToImport) {
        const streamerId = streamer.id || streamer.streamerId;
        if (!streamerId) {
          skippedCount++;
          continue;
        }

        if (state.favoriteStreamers.some(s => s.id === streamerId)) {
          skippedCount++;
          continue;
        }

        const result = await sendMessage({
          type: 'ADD_STREAMER',
          streamerId
        });

        if (result?.success && result.streamer) {
          // 기존 설정 복원
          if (streamer.autoJoin !== undefined || streamer.autoRecord !== undefined) {
            await sendMessage({
              type: 'UPDATE_STREAMER',
              streamerId,
              updates: {
                autoJoin: streamer.autoJoin || false,
                autoRecord: streamer.autoRecord || false
              }
            });
          }
          state.favoriteStreamers.push(result.streamer);
          addedCount++;
        } else {
          skippedCount++;
        }
      }

      updateStreamerList();
      updateMonitoringUI();

      if (addedCount > 0 && skippedCount > 0) {
        showToast(`${addedCount}명 추가됨, ${skippedCount}명 건너뜀`, 'success');
      } else if (addedCount > 0) {
        showToast(`${addedCount}명의 스트리머를 가져왔습니다.`, 'success');
      } else {
        showToast('모든 스트리머가 이미 등록되어 있습니다.', 'info');
      }

    } catch (error) {
      console.error('[사이드패널] 가져오기 오류:', error);
      showToast('파일을 읽는 중 오류가 발생했습니다.', 'error');
    }

    if (elements.importFileInput) {
      elements.importFileInput.value = '';
    }
  }

  // ===== 새로고침 =====
  async function refreshBroadcastStatus() {
    if (elements.refreshBtn) {
      elements.refreshBtn.disabled = true;
    }

    try {
      await sendMessage({ type: 'REFRESH_STREAMERS' });
      await loadState();
      updateStreamerList();
      updateMonitoringUI();
      await updateCurrentStream();
      showToast('새로고침 완료', 'success');
    } catch (error) {
      showToast('새로고침 실패', 'error');
    } finally {
      if (elements.refreshBtn) {
        elements.refreshBtn.disabled = false;
      }
    }
  }

  // ===== 저장 공간 =====
  async function updateStorageInfo() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const quota = estimate.quota || 0;
        const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;

        if (elements.storageValue) {
          elements.storageValue.textContent = `${formatBytes(usage)} / ${formatBytes(quota)}`;
        }
        if (elements.storageProgressFill) {
          elements.storageProgressFill.style.width = `${usagePercent}%`;

          if (usagePercent > 90) {
            elements.storageProgressFill.className = 'storage-progress-fill danger';
          } else if (usagePercent > 70) {
            elements.storageProgressFill.className = 'storage-progress-fill warning';
          } else {
            elements.storageProgressFill.className = 'storage-progress-fill';
          }
        }
      }
    } catch (error) {
      // 저장소 정보 가져오기 실패
    }
  }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    // 모니터링 토글
    elements.monitoringToggle?.addEventListener('change', toggleMonitoring);

    // 빠른 설정
    elements.notificationChip?.addEventListener('click', () => toggleQuickSetting('notification'));
    elements.endNotificationChip?.addEventListener('click', () => toggleQuickSetting('endNotification'));
    elements.autoCloseChip?.addEventListener('click', () => toggleQuickSetting('autoClose'));

    // 녹화 버튼
    elements.startRecordingBtn?.addEventListener('click', startRecording);

    // 필터
    elements.filterSelect?.addEventListener('change', (e) => {
      state.filter = e.target.value;
      updateStreamerList();
    });

    // 새로고침
    elements.refreshBtn?.addEventListener('click', refreshBroadcastStatus);

    // 내보내기/가져오기
    elements.exportBtn?.addEventListener('click', exportStreamers);
    elements.importBtn?.addEventListener('click', () => elements.importFileInput?.click());
    elements.importFileInput?.addEventListener('change', (e) => {
      if (e.target.files?.[0]) {
        importStreamers(e.target.files[0]);
      }
    });

    // 스트리머 추가
    elements.addStreamerBtn?.addEventListener('click', addStreamer);
    elements.streamerIdInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') addStreamer();
    });

    // Background에서 오는 메시지 처리
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case 'BROADCAST_STATUS_UPDATED':
          state.broadcastStatus = message.data || {};
          updateStreamerList();
          updateMonitoringUI();
          break;

        case 'RECORDING_STARTED_UPDATE':
          if (message.tabId === state.currentSoopTabId) {
            state.currentTabRecording = {
              tabId: message.tabId,
              streamerId: message.streamerId,
              nickname: message.nickname,
              startTime: Date.now()
            };
          }
          updateRecordingButton();
          updateActiveRecordingList();
          break;

        case 'RECORDING_PROGRESS_UPDATE':
          // 녹화 목록 카드 업데이트 (tabId 기반)
          const card = document.querySelector(
            `.recording-card[data-tab-id="${message.tabId}"]`
          );
          if (card) {
            const timeEl = card.querySelector('.recording-time');
            const sizeEl = card.querySelector('.recording-size');
            if (timeEl) timeEl.textContent = formatDuration(message.elapsedTime || 0);
            if (sizeEl) sizeEl.textContent = formatBytes(message.totalBytes || 0);
          }
          break;

        case 'RECORDING_STOPPED_UPDATE':
          if (state.currentTabRecording?.tabId === message.tabId) {
            state.currentTabRecording = null;
          }
          updateRecordingButton();
          updateActiveRecordingList();
          if (message.saved) {
            showToast(`✅ ${message.nickname || message.streamerId} 녹화 완료!`, 'success');
          }
          break;

        case 'RECORDING_ERROR_UPDATE':
          if (state.currentTabRecording?.tabId === message.tabId) {
            state.currentTabRecording = null;
          }
          updateRecordingButton();
          updateActiveRecordingList();
          showToast('녹화 오류: ' + (message.error || '알 수 없는 오류'), 'error');
          break;
      }
    });

    // 탭 변경 감지
    chrome.tabs.onActivated.addListener(() => {
      setTimeout(() => {
        updateCurrentStream();
        updateActiveRecordingList();
      }, 100);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'complete') {
        updateCurrentStream();
      }
    });
  }

  // ===== 초기화 =====
  async function init() {
    initElements();
    applyI18n();

    // 버전 정보
    const manifest = chrome.runtime.getManifest();
    if (elements.versionInfo) {
      elements.versionInfo.textContent = `v${manifest.version}`;
    }

    // 상태 로드
    await loadState();

    // UI 초기화
    updateMonitoringUI();
    updateQuickSettings();
    updateStreamerList();
    await updateCurrentStream();
    await updateActiveRecordingList();
    await updateStorageInfo();

    // 이벤트 바인딩
    bindEvents();

    // 주기적 업데이트
    setInterval(updateActiveRecordingList, 5000);
    setInterval(updateStorageInfo, 10000);

    // 상태 동기화
    setInterval(async () => {
      try {
        const response = await sendMessage({ type: 'GET_STATE' });
        if (response?.success && response.data) {
          state.broadcastStatus = response.data.broadcastStatus || {};
          state.isMonitoring = response.data.isMonitoring || false;
          updateMonitoringUI();
          updateStreamerList();
        }
      } catch (e) {}
    }, 15000);
  }

  init();
})();
