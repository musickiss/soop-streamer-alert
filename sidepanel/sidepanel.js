// ===== 숲토킹 v3.6.0 - 사이드패널 =====

(function() {
  'use strict';

  // ===== v3.5.14: Storage 기반 녹화 상태 =====
  const STORAGE_KEY_RECORDINGS = 'activeRecordings';

  // ===== 상태 =====
  const state = {
    favoriteStreamers: [],
    isMonitoring: false,
    broadcastStatus: {},
    settings: {
      notificationEnabled: true,
      endNotificationEnabled: false
    },
    currentStream: null,
    currentSoopTabId: null,
    filter: 'all',
    expandedStreamerId: null,
    recordingQuality: 'ultra',  // 'ultra' = 원본급(30Mbps), 'high' = 고품질(15Mbps), 'standard' = 표준(8Mbps)
    splitSize: 500,  // 분할 크기 (MB): 500 / 1024 / 2048
    // 현재 탭 녹화 상태 (sessionId 기반)
    currentTabRecording: null
  };

  // ===== 드래그 앤 드롭 상태 (v3.2.4) =====
  let draggedItem = null;
  let draggedIndex = -1;

  // ===== 아코디언 안정화 (v3.2.4) =====
  let toggleTimeout = null;

  // ===== 리사이즈 상태 (v3.5.2) =====
  const RESIZE_CONFIG = {
    MIN_RECORDING_HEIGHT: 120, // 녹화 중 최소 높이
    MIN_FAVORITES_HEIGHT: 80,  // 즐겨찾기 최소 높이
    STORAGE_KEY: 'sooptalking_recording_section_height'
  };
  let isResizing = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

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

    elements.recordingQualitySelect = document.getElementById('recordingQualitySelect');
    elements.splitSizeSelect = document.getElementById('splitSizeSelect');
    elements.recordingQualityInfoTooltip = document.getElementById('recordingQualityInfoTooltip');

    elements.toast = document.getElementById('toast');
    elements.versionInfo = document.getElementById('versionInfo');
    elements.brandText = document.getElementById('brandText');

    // 리사이즈 관련 요소
    elements.resizeHandle = document.getElementById('resizeHandle');
    elements.recordingsSection = document.getElementById('recordingsSection');
    elements.favoritesSection = document.getElementById('favoritesSection');
    elements.resizableArea = document.querySelector('.resizable-area');
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

  function getRecordingQualityTooltip() {
    // ⭐ 3단계 품질 툴팁
    switch (state.recordingQuality) {
      case 'ultra':
        return '원본급 (VP9 30Mbps 60fps)\n• 1시간당 약 13GB\n• 동시 녹화: 1개 권장\n• ⚠️ 고사양 PC 필요';
      case 'high':
        return '고품질 (VP9 15Mbps 60fps)\n• 1시간당 약 6.5GB\n• 동시 녹화: 1~2개 권장\n• 대부분의 PC에서 안정적';
      case 'standard':
        return '표준 (VP8 8Mbps 30fps)\n• 1시간당 약 3.5GB\n• 동시 녹화: 2~3개 가능\n• ✅ 저사양 PC에서도 안정적';
      default:
        return '녹화 품질 정보';
    }
  }

  // 파트 전환 상태 표시 (v3.5.8.2)
  function showSplitStatus(streamerId, partNumber, status) {
    // 녹화 카드 찾기 (tabId 또는 streamerId로)
    let recordingCard = document.querySelector(`.recording-card[data-streamer-id="${streamerId}"]`);
    if (!recordingCard) {
      // streamerId로 못 찾으면 모든 녹화 카드에서 찾기
      const allCards = document.querySelectorAll('.recording-card');
      for (const card of allCards) {
        const nameEl = card.querySelector('.recording-streamer-name');
        if (nameEl && nameEl.textContent.includes(streamerId)) {
          recordingCard = card;
          break;
        }
      }
    }
    if (!recordingCard) return;

    // 상태 표시 요소 찾기 또는 생성
    let splitStatus = recordingCard.querySelector('.split-status');
    if (!splitStatus) {
      splitStatus = document.createElement('div');
      splitStatus.className = 'split-status';
      const infoArea = recordingCard.querySelector('.recording-card-stats');
      if (infoArea) {
        infoArea.appendChild(splitStatus);
      }
    }

    if (status === 'saving') {
      splitStatus.innerHTML = `<span class="split-saving">💾 파트 ${partNumber} 저장 중...</span>`;
      splitStatus.style.color = '#ffa500';
    } else if (status === 'recording') {
      splitStatus.innerHTML = `<span class="split-recording">🔴 파트 ${partNumber} 녹화 중</span>`;
      splitStatus.style.color = '#00ff88';

      // 3초 후 숨김
      setTimeout(() => {
        if (splitStatus) {
          splitStatus.innerHTML = '';
        }
      }, 3000);
    }
  }

  // ⭐ 녹화 카드 파트 상태 업데이트 (v3.5.8.3)
  function updateRecordingCardPartStatus(tabId, partNumber) {
    const card = document.querySelector(`.recording-card[data-tab-id="${tabId}"]`);
    if (!card) return;

    // 파트 표시 컨테이너 찾기 또는 생성
    let partContainer = card.querySelector('.part-container');
    if (!partContainer) {
      partContainer = document.createElement('div');
      partContainer.className = 'part-container';

      const header = card.querySelector('.recording-card-header');
      if (header) {
        // 헤더 내 적절한 위치에 삽입
        const streamerName = header.querySelector('.recording-streamer-name');
        if (streamerName) {
          streamerName.insertAdjacentElement('afterend', partContainer);
        } else {
          header.appendChild(partContainer);
        }
      }
    }

    // 파트 번호 표시
    if (partNumber > 1) {
      partContainer.innerHTML = `<span class="part-indicator">Part ${partNumber}</span>`;
      partContainer.style.display = 'inline-flex';
    } else {
      partContainer.style.display = 'none';
    }
  }

  function updateRecordingQualityInfoBox() {
    if (!elements.recordingQualityInfoTooltip) return;

    // ⭐ 3단계 품질 정보 박스
    let qualityName, bitrate, fps, fileSize, recommendCount, stabilityNote;

    switch (state.recordingQuality) {
      case 'ultra':
        qualityName = '원본급';
        bitrate = 'VP9 30Mbps';
        fps = '60fps';
        fileSize = '~13GB/시간';
        recommendCount = '1개';
        stabilityNote = '⚠️ 고사양 PC 필요';
        break;
      case 'high':
        qualityName = '고품질';
        bitrate = 'VP9 15Mbps';
        fps = '60fps';
        fileSize = '~6.5GB/시간';
        recommendCount = '1~2개';
        stabilityNote = '대부분의 PC에서 안정적';
        break;
      case 'standard':
        qualityName = '표준';
        bitrate = 'VP8 8Mbps';
        fps = '30fps';
        fileSize = '~3.5GB/시간';
        recommendCount = '2~3개';
        stabilityNote = '✅ 저사양 PC에서도 안정적';
        break;
      default:
        qualityName = '알 수 없음';
        bitrate = '-';
        fps = '-';
        fileSize = '-';
        recommendCount = '-';
        stabilityNote = '';
    }

    // ⭐ v3.5.22: 데이터 손실 경고 문구 (다국어 지원)
    const dataLossWarning = i18n('recordingDataLossWarning') || '탭/브라우저 비정상 종료 시 현재 녹화 중인 내용이 손실될 수 있습니다.';

    elements.recordingQualityInfoTooltip.innerHTML = `
      <p class="tooltip-title">⚠️ 녹화 품질 안내</p>
      <p><strong>현재 설정: ${qualityName}</strong></p>
      <p>• 코덱: ${bitrate} ${fps}</p>
      <p>• 파일 크기: ${fileSize}</p>
      <p>• 동시 녹화 권장: ${recommendCount}</p>
      <p>• ${stabilityNote}</p>
      <p style="margin-top: 8px;">백그라운드 탭은 브라우저가 리소스를 제한하여 <strong>프레임 드랍</strong>이 발생할 수 있습니다.</p>
      <p class="tooltip-tip">💡 <strong>권장:</strong> 녹화 탭을 새 창으로 분리하거나 활성 상태로 유지하세요.</p>
      <p class="tooltip-tip" style="color: #ff6b6b; margin-top: 6px;">⚠️ ${dataLossWarning}</p>
    `;
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

    // ⭐ v3.5.9.2: 녹화 시작 요청 로깅
    console.log(`[사이드패널] 녹화 요청: ${streamerId}`);

    try {
      // Background에 녹화 시작 요청 (tabId 기반)
      const result = await sendMessage({
        type: 'START_RECORDING_REQUEST',
        tabId: tabId,
        streamerId: streamerId,
        nickname: nickname,
        quality: state.recordingQuality,
        splitSize: state.splitSize || 500
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
      // ⭐ v3.5.14: Storage에서 직접 읽기 (background 통신 불필요)
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordingsObj = result[STORAGE_KEY_RECORDINGS] || {};

      // 유효한 녹화만 필터링 (탭 존재 여부 확인)
      const validRecordings = [];
      const invalidTabIds = [];

      for (const [tabIdStr, rec] of Object.entries(recordingsObj)) {
        const tabId = parseInt(tabIdStr);
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab && tab.url?.includes('play.sooplive.co.kr')) {
            validRecordings.push({
              ...rec,
              tabId: tabId
            });
          } else {
            invalidTabIds.push(tabIdStr);
          }
        } catch (e) {
          // 탭이 존재하지 않음
          invalidTabIds.push(tabIdStr);
        }
      }

      // 무효한 항목 정리 (Storage에서 제거)
      if (invalidTabIds.length > 0) {
        const cleanedRecordings = { ...recordingsObj };
        for (const tabIdStr of invalidTabIds) {
          delete cleanedRecordings[tabIdStr];
        }
        await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: cleanedRecordings });
        console.log('[사이드패널] 무효한 녹화 상태 정리:', invalidTabIds.length, '개');
      }

      const recordings = validRecordings;

      // UI 업데이트: 녹화 개수
      if (elements.recordingCount) {
        elements.recordingCount.textContent = recordings.length;
      }

      // UI 업데이트: 빈 메시지
      if (elements.noRecordingMessage) {
        elements.noRecordingMessage.style.display = recordings.length === 0 ? 'block' : 'none';
      }

      if (!elements.activeRecordingList) return;

      // 녹화 없으면 목록 비우기
      if (recordings.length === 0) {
        elements.activeRecordingList.innerHTML = '';
        return;
      }

      // 녹화 카드 렌더링
      elements.activeRecordingList.innerHTML = recordings.map(rec => {
        const elapsed = rec.elapsedTime || Math.floor((Date.now() - (rec.startTime || Date.now())) / 1000);
        const timeStr = formatDuration(elapsed);
        const sizeStr = formatBytes(rec.totalBytes || 0);
        const displayName = escapeHtml(rec.nickname || rec.streamerId || '알 수 없음');

        // ⭐ v3.5.14: 마지막 업데이트 시간 확인 (30초 이상 지났으면 경고)
        const lastUpdate = rec.lastUpdate || rec.startTime || Date.now();
        const isStale = (Date.now() - lastUpdate) > 30000;
        const staleWarning = isStale ? '<span class="stale-warning" title="상태 업데이트 지연 - 녹화는 계속 진행 중일 수 있습니다">⚠️</span>' : '';

        return `
          <div class="recording-card" data-tab-id="${rec.tabId}" data-streamer-id="${escapeHtml(rec.streamerId || '')}">
            <div class="recording-card-header">
              <span class="recording-indicator"></span>
              <span class="recording-streamer-name">${displayName}</span>
              ${staleWarning}
              <span class="recording-quality-info" title="${getRecordingQualityTooltip()}">ⓘ</span>
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

      // 중지 버튼 이벤트 바인딩
      elements.activeRecordingList.querySelectorAll('.recording-stop-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tabId = parseInt(btn.dataset.tabId);
          if (tabId) stopRecording(tabId);
        });
      });

    } catch (error) {
      console.error('[사이드패널] 녹화 목록 업데이트 오류:', error);

      // ⭐ v3.5.14: 폴백 - background에서 읽기 시도
      try {
        const result = await sendMessage({ type: 'GET_ALL_RECORDINGS' });
        const recordings = result?.success && Array.isArray(result.data) ? result.data : [];

        if (elements.recordingCount) {
          elements.recordingCount.textContent = recordings.length;
        }
        if (elements.noRecordingMessage) {
          elements.noRecordingMessage.style.display = recordings.length === 0 ? 'block' : 'none';
        }
      } catch (e) {
        console.error('[사이드패널] 폴백도 실패:', e);
      }
    }
  }

  // 현재 탭 녹화 상태 동기화
  async function syncCurrentTabRecordingState() {
    try {
      // ⭐ v3.5.14: Storage에서 직접 읽기
      const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
      const recordingsObj = result[STORAGE_KEY_RECORDINGS] || {};
      const recordings = Object.values(recordingsObj);

      // 현재 탭에서 녹화 중인지 확인
      const currentRecording = recordings.find(rec => rec.tabId === state.currentSoopTabId);

      if (currentRecording) {
        state.currentTabRecording = {
          tabId: currentRecording.tabId,
          streamerId: currentRecording.streamerId,
          nickname: currentRecording.nickname,
          startTime: currentRecording.startTime
        };
      } else {
        state.currentTabRecording = null;
      }

      updateRecordingButton();
    } catch (error) {
      console.error('[사이드패널] 녹화 상태 동기화 오류:', error);

      // 폴백: background 요청
      try {
        const result = await sendMessage({ type: 'GET_ALL_RECORDINGS' });
        if (result?.success) {
          const recordings = result.data || [];
          const currentRecording = recordings.find(rec => rec.tabId === state.currentSoopTabId);
          state.currentTabRecording = currentRecording || null;
          updateRecordingButton();
        }
      } catch (e) {}
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
            <div class="avatar clickable" data-station-id="${escapeHtml(streamer.id)}" title="방송국 페이지로 이동">
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
            <div class="setting-row">
              <div class="setting-label">
                <span class="icon">🚪</span>
                <span data-i18n="autoClose">자동 종료</span>
              </div>
              <label class="mini-toggle orange">
                <input type="checkbox" data-setting="autoClose" ${streamer.autoClose ? 'checked' : ''}>
                <span class="track"></span>
              </label>
            </div>
            <button class="delete-streamer-btn" data-id="${escapeHtml(streamer.id)}">🗑️ 스트리머 삭제</button>
          </div>
        </div>
      `;
    }).join('');

    bindStreamerCardEvents();

    // 확장 상태 복원 (DOM 재생성 후)
    if (state.expandedStreamerId) {
      const expandedCard = document.querySelector(`.streamer-card[data-id="${state.expandedStreamerId}"]`);
      if (expandedCard) {
        expandedCard.classList.add('expanded');
      }
    }
  }

  // ===== 아코디언 토글 (v3.2.4 - 안정화) =====
  function toggleStreamerDetails(card) {
    // 이미 토글 중이면 무시 (떨림 방지)
    if (toggleTimeout) return;

    const isExpanded = card.classList.contains('expanded');
    const streamerId = card.dataset.id;

    // 다른 모든 아이템 닫기
    document.querySelectorAll('.streamer-card.expanded').forEach(el => {
      if (el !== card) {
        el.classList.remove('expanded');
      }
    });

    // 현재 아이템 토글
    card.classList.toggle('expanded', !isExpanded);

    // 확장 상태 저장 (DOM 재생성 후 복원용)
    state.expandedStreamerId = isExpanded ? null : streamerId;

    // 300ms 동안 추가 토글 방지
    toggleTimeout = setTimeout(() => {
      toggleTimeout = null;
    }, 300);
  }

  // ===== 드래그 앤 드롭 설정 (v3.2.4) =====
  function setupDragAndDrop() {
    const streamerCards = document.querySelectorAll('.streamer-card');

    streamerCards.forEach((card, index) => {
      card.setAttribute('draggable', 'true');

      card.addEventListener('dragstart', (e) => {
        draggedItem = card;
        draggedIndex = index;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        document.querySelectorAll('.streamer-card').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
        });
        draggedItem = null;
        draggedIndex = -1;
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedItem || draggedItem === card) return;

        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;

        document.querySelectorAll('.streamer-card').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
        });

        if (e.clientY < midY) {
          card.classList.add('drag-over-top');
        } else {
          card.classList.add('drag-over-bottom');
        }
      });

      card.addEventListener('dragleave', () => {
        card.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
      });

      card.addEventListener('drop', async (e) => {
        e.preventDefault();
        if (!draggedItem || draggedItem === card) return;

        const cards = Array.from(document.querySelectorAll('.streamer-card'));
        let targetIndex = cards.indexOf(card);

        const rect = card.getBoundingClientRect();
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
          await saveStreamerOrder();
          updateStreamerList();
        }

        document.querySelectorAll('.streamer-card').forEach(el => {
          el.classList.remove('drag-over', 'drag-over-top', 'drag-over-bottom');
        });
      });
    });
  }

  // ===== 스트리머 순서 저장 (v3.2.4) =====
  async function saveStreamerOrder() {
    try {
      await sendMessage({
        type: 'REORDER_STREAMERS',
        streamers: state.favoriteStreamers
      });
    } catch (error) {
      console.error('[사이드패널] 스트리머 순서 저장 오류:', error);
    }
  }

  function bindStreamerCardEvents() {
    // 카드 확장/축소 (v3.2.4 - 안정화된 아코디언)
    document.querySelectorAll('.streamer-card-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // 드래그 중이면 무시
        if (draggedItem) return;
        const card = header.closest('.streamer-card');
        if (card) toggleStreamerDetails(card);
      });
    });

    // 드래그 앤 드롭 설정 (v3.2.4)
    setupDragAndDrop();

    // ★ v3.5.12: 아바타 클릭 - 방송국 페이지로 이동
    document.querySelectorAll('.avatar.clickable').forEach(avatar => {
      avatar.addEventListener('click', (e) => {
        e.stopPropagation();  // 카드 확장/축소 방지
        const streamerId = avatar.dataset.stationId;
        if (streamerId) {
          const stationUrl = `https://www.sooplive.co.kr/station/${streamerId}`;
          chrome.tabs.create({ url: stationUrl });
        }
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
      default:
        return;
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
          // 모든 설정 복원 (autoJoin, autoRecord, autoClose)
          const hasSettings = streamer.autoJoin !== undefined ||
                              streamer.autoRecord !== undefined ||
                              streamer.autoClose !== undefined;

          if (hasSettings) {
            await sendMessage({
              type: 'UPDATE_STREAMER',
              streamerId,
              updates: {
                autoJoin: streamer.autoJoin || false,
                autoRecord: streamer.autoRecord || false,
                autoClose: streamer.autoClose || false
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

  // ===== 리사이즈 핸들 로직 (v3.5.2) =====

  function initResize() {
    if (!elements.resizeHandle || !elements.recordingsSection || !elements.resizableArea) {
      console.warn('[사이드패널] 리사이즈 요소를 찾을 수 없습니다.');
      return;
    }

    // 저장된 높이 복원
    loadSavedHeight();

    // 마우스 이벤트
    elements.resizeHandle.addEventListener('mousedown', handleResizeStart);
    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    // 터치 이벤트 (모바일 지원)
    elements.resizeHandle.addEventListener('touchstart', handleTouchStart, { passive: false });
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleResizeEnd);
  }

  function loadSavedHeight() {
    try {
      const savedHeight = localStorage.getItem(RESIZE_CONFIG.STORAGE_KEY);
      if (savedHeight) {
        const height = parseInt(savedHeight, 10);
        if (!isNaN(height) && height >= RESIZE_CONFIG.MIN_RECORDING_HEIGHT) {
          elements.recordingsSection.style.height = height + 'px';
        }
      }
    } catch (e) {
      console.warn('[사이드패널] 저장된 높이 복원 실패:', e);
    }
  }

  function saveResizeHeight(height) {
    try {
      localStorage.setItem(RESIZE_CONFIG.STORAGE_KEY, height.toString());
    } catch (e) {
      console.warn('[사이드패널] 높이 저장 실패:', e);
    }
  }

  function handleResizeStart(e) {
    e.preventDefault();
    isResizing = true;
    resizeStartY = e.clientY;
    resizeStartHeight = elements.recordingsSection.offsetHeight;

    elements.resizeHandle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  function handleTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      isResizing = true;
      resizeStartY = e.touches[0].clientY;
      resizeStartHeight = elements.recordingsSection.offsetHeight;

      elements.resizeHandle.classList.add('dragging');
    }
  }

  function handleResizeMove(e) {
    if (!isResizing) return;

    const deltaY = e.clientY - resizeStartY;
    applyResize(deltaY);
  }

  function handleTouchMove(e) {
    if (!isResizing || e.touches.length !== 1) return;
    e.preventDefault();

    const deltaY = e.touches[0].clientY - resizeStartY;
    applyResize(deltaY);
  }

  function applyResize(deltaY) {
    const resizableHeight = elements.resizableArea.offsetHeight;
    const handleHeight = elements.resizeHandle.offsetHeight;
    const availableHeight = resizableHeight - handleHeight;

    let newRecordingHeight = resizeStartHeight + deltaY;

    // 최소/최대 제한 적용
    newRecordingHeight = Math.max(RESIZE_CONFIG.MIN_RECORDING_HEIGHT, newRecordingHeight);
    newRecordingHeight = Math.min(availableHeight - RESIZE_CONFIG.MIN_FAVORITES_HEIGHT, newRecordingHeight);

    elements.recordingsSection.style.height = newRecordingHeight + 'px';
  }

  function handleResizeEnd() {
    if (!isResizing) return;

    isResizing = false;
    elements.resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // 현재 높이 저장
    const currentHeight = elements.recordingsSection.offsetHeight;
    saveResizeHeight(currentHeight);
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

    // 녹화 버튼
    elements.startRecordingBtn?.addEventListener('click', startRecording);

    // 녹화 품질 드롭다운
    elements.recordingQualitySelect?.addEventListener('change', (e) => {
      state.recordingQuality = e.target.value;
      chrome.storage.local.set({ recordingQuality: state.recordingQuality });

      // ⭐ v3.6.0: 품질 변경 이벤트
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({
          type: 'ANALYTICS_QUALITY_CHANGE',
          quality: state.recordingQuality
        }).catch(() => {});
      }

      // ⭐ 3단계 품질 토스트 메시지
      const qualityNames = {
        'ultra': '원본급 (30Mbps)',
        'high': '고품질 (15Mbps)',
        'standard': '표준 (8Mbps)'
      };
      showToast(`${qualityNames[state.recordingQuality] || '품질'} 설정됨`, 'success');
      // 녹화 카드의 info 아이콘 툴팁 업데이트
      document.querySelectorAll('.recording-quality-info').forEach(el => {
        el.title = getRecordingQualityTooltip();
      });
      // 녹화 품질 안내박스 업데이트
      updateRecordingQualityInfoBox();
    });

    // 분할 크기 드롭다운
    elements.splitSizeSelect?.addEventListener('change', (e) => {
      state.splitSize = parseInt(e.target.value, 10);
      chrome.storage.local.set({ splitSize: state.splitSize });
      const sizeNames = {
        500: '500MB',
        1024: '1GB',
        2048: '2GB'
      };
      showToast(`분할 크기: ${sizeNames[state.splitSize] || state.splitSize + 'MB'} 설정됨`, 'success');
    });

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

            // ⭐ 파트 번호 표시 (v3.5.8.3)
            if (message.partNumber && message.partNumber > 1) {
              updateRecordingCardPartStatus(message.tabId, message.partNumber);
            }
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

        case 'SEGMENT_SAVED':
          // 분할 저장 성공 알림
          showToast(`📁 Part ${message.partNumber} 저장됨 (${formatBytes(message.size)})`, 'success');
          break;

        case 'SEGMENT_SAVE_ERROR':
          // 분할 저장 실패 알림
          showToast('분할 저장 실패: ' + (message.error || '알 수 없는 오류'), 'error');
          break;

        // 파트 전환 시작 (v3.5.8.3)
        case 'RECORDING_SPLIT_START':
          console.log(`[숲토킹 SidePanel] 파트 ${message.partNumber} 저장 중...`);
          showSplitStatus(message.streamerId, message.partNumber, 'saving');
          // 파트 상태도 업데이트
          if (message.tabId) {
            updateRecordingCardPartStatus(message.tabId, message.partNumber);
          }
          break;

        // 파트 전환 완료 (v3.5.8.3)
        case 'RECORDING_SPLIT_COMPLETE':
          console.log(`[숲토킹 SidePanel] 파트 ${message.partNumber} 녹화 시작`);
          showSplitStatus(message.streamerId, message.partNumber, 'recording');
          // 파트 상태 업데이트
          if (message.tabId) {
            updateRecordingCardPartStatus(message.tabId, message.partNumber);
          }
          // 토스트 표시
          showToast(`파트 ${message.partNumber} 녹화 중`, 'info');
          break;

        // ⭐ v3.5.24: 녹화 손실 알림 (새로고침으로 인한)
        case 'RECORDING_LOST_BY_REFRESH':
          console.warn('[사이드패널] 녹화 손실:', message.streamerId);

          // 현재 탭 녹화 상태 정리
          if (state.currentTabRecording?.tabId === message.tabId) {
            state.currentTabRecording = null;
          }

          // UI 업데이트
          updateRecordingButton();
          updateActiveRecordingList();

          // 사용자에게 알림
          showToast(`⚠️ ${message.streamerId} 녹화가 새로고침으로 중단되었습니다. (${formatDuration(message.elapsedTime)} 손실)`, 'error');
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

    // ⭐ v3.5.14: Storage 변경 감지 (실시간 UI 업데이트)
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[STORAGE_KEY_RECORDINGS]) {
        // Storage 변경 → UI 동기화
        updateActiveRecordingList();
        syncCurrentTabRecordingState();
      }
    });
  }

  // ===== 초기화 =====
  async function init() {
    // ⭐ v3.5.14: stale-warning 스타일 동적 추가
    const staleStyle = document.createElement('style');
    staleStyle.textContent = `
      .stale-warning {
        color: #ffa500;
        margin-left: 4px;
        font-size: 12px;
        cursor: help;
        animation: stale-blink 1.5s ease-in-out infinite;
      }
      @keyframes stale-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
    `;
    document.head.appendChild(staleStyle);

    initElements();
    applyI18n();

    // 버전 정보
    const manifest = chrome.runtime.getManifest();
    if (elements.versionInfo) {
      elements.versionInfo.textContent = `v${manifest.version}`;
    }

    // 상태 로드
    await loadState();

    // 녹화 품질 및 분할 크기 설정 로드
    chrome.storage.local.get(['recordingQuality', 'splitSize'], (result) => {
      if (result.recordingQuality) {
        state.recordingQuality = result.recordingQuality;
        if (elements.recordingQualitySelect) {
          elements.recordingQualitySelect.value = state.recordingQuality;
        }
      }
      if (result.splitSize) {
        state.splitSize = result.splitSize;
        if (elements.splitSizeSelect) {
          elements.splitSizeSelect.value = state.splitSize.toString();
        }
      }
      // 품질 안내박스 초기화
      updateRecordingQualityInfoBox();
    });

    // UI 초기화
    updateMonitoringUI();
    updateQuickSettings();
    updateStreamerList();
    await updateCurrentStream();
    await updateActiveRecordingList();
    // 현재 탭 녹화 상태 동기화
    await syncCurrentTabRecordingState();
    await updateStorageInfo();

    // 이벤트 바인딩
    bindEvents();

    // 리사이즈 기능 초기화
    initResize();

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
