// ===== 숲토킹 v3.1.2 - Background Service Worker =====
// tabCapture 원터치 녹화 + 5초/30초 분리 모니터링

// ===== 상수 =====
const CHECK_INTERVAL_FAST = 5000;   // 자동참여 ON 스트리머 (5초)
const CHECK_INTERVAL_SLOW = 30000;  // 자동참여 OFF 스트리머 (30초)
const API_BASE = 'https://api.m.sooplive.co.kr/broad/a/watch';

// ===== 상태 관리 =====
const state = {
  // 스트리머 모니터링
  isMonitoring: false,
  favoriteStreamers: [],  // [{id, nickname, autoJoin, autoRecord}]
  broadcastStatus: {},    // streamerId -> {isLive, title, ...}

  // 녹화 세션
  recordings: new Map(),  // sessionId -> {tabId, streamerId, nickname, fileName, startTime, totalBytes}

  // Offscreen 상태
  offscreenReady: false,

  // 모니터링 인터벌 ID
  fastIntervalId: null,
  slowIntervalId: null,

  // 설정
  settings: {
    notificationEnabled: true,
    endNotificationEnabled: false,
    autoCloseOfflineTabs: true,
    notificationDuration: 10
  }
};

// ===== 초기화 =====

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] v3.1.2 설치됨');
  await loadSettings();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[숲토킹] 브라우저 시작');
  await loadSettings();
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== 설정 저장/로드 =====

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([
      'favoriteStreamers',
      'isMonitoring',
      'settings'
    ]);

    if (data.favoriteStreamers) {
      state.favoriteStreamers = data.favoriteStreamers;
    }
    if (data.isMonitoring !== undefined) {
      state.isMonitoring = data.isMonitoring;
    }
    if (data.settings) {
      state.settings = { ...state.settings, ...data.settings };
    }

    console.log('[숲토킹] 설정 로드됨:', state.favoriteStreamers.length, '명의 스트리머');
  } catch (error) {
    console.error('[숲토킹] 설정 로드 실패:', error);
  }
}

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers,
      isMonitoring: state.isMonitoring,
      settings: state.settings
    });
  } catch (error) {
    console.error('[숲토킹] 설정 저장 실패:', error);
  }
}

// ===== Offscreen Document 관리 =====

async function ensureOffscreen() {
  if (state.offscreenReady) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (contexts.length > 0) {
        return true;
      }
    } catch (e) {}
    state.offscreenReady = false;
  }

  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (contexts.length === 0) {
      console.log('[숲토킹] Offscreen Document 생성 중...');
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA],
        justification: '방송 녹화를 위해 MediaRecorder 사용'
      });
    }

    state.offscreenReady = true;
    console.log('[숲토킹] Offscreen Document 준비됨');
    return true;
  } catch (error) {
    console.error('[숲토킹] Offscreen Document 생성 실패:', error);
    return false;
  }
}

// ===== 녹화 관리 (tabCapture 기반) =====

async function startRecording(tabId, streamerId, nickname, quality, streamId) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  // ⭐ streamId가 없으면 에러
  if (!streamId) {
    return { success: false, error: 'streamId가 필요합니다. Side Panel에서 tabCapture를 호출해주세요.' };
  }

  const ready = await ensureOffscreen();
  if (!ready) {
    return { success: false, error: 'Offscreen Document 생성 실패' };
  }

  try {
    console.log('[숲토킹] streamId 수신됨:', streamId.substring(0, 20) + '...');

    // Offscreen에 녹화 시작 요청
    const response = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
      streamId,
      tabId,
      streamerId,
      nickname,
      quality: quality || {
        resolution: '1080p',
        frameRate: 30,
        videoBitrate: 4000,
        audioBitrate: 128
      }
    });

    if (response?.success) {
      state.recordings.set(response.sessionId, {
        sessionId: response.sessionId,
        tabId,
        streamerId,
        nickname,
        fileName: response.fileName,
        startTime: Date.now(),
        totalBytes: 0
      });
      updateBadge();
      console.log('[숲토킹] 녹화 시작됨:', response.sessionId);
    }

    return response;
  } catch (error) {
    console.error('[숲토킹] 녹화 시작 실패:', error);
    return { success: false, error: error.message };
  }
}

async function stopRecording(sessionId) {
  console.log('[숲토킹] 녹화 중지 요청:', sessionId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'STOP_RECORDING',
      sessionId
    });

    if (response?.success) {
      state.recordings.delete(sessionId);
      updateBadge();
    }

    return response;
  } catch (error) {
    console.error('[숲토킹] 녹화 중지 실패:', error);
    return { success: false, error: error.message };
  }
}

// ===== 배지 업데이트 =====

function updateBadge() {
  const count = state.recordings.size;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
}

// ===== 스트리머 모니터링 (5초/30초 분리) =====

function startMonitoring() {
  state.isMonitoring = true;
  saveSettings();

  // 기존 인터벌 정리
  if (state.fastIntervalId) clearInterval(state.fastIntervalId);
  if (state.slowIntervalId) clearInterval(state.slowIntervalId);

  // 즉시 한 번 체크
  checkFastStreamers();
  checkSlowStreamers();

  // 자동참여 ON 스트리머: 5초마다
  state.fastIntervalId = setInterval(checkFastStreamers, CHECK_INTERVAL_FAST);

  // 자동참여 OFF 스트리머: 30초마다
  state.slowIntervalId = setInterval(checkSlowStreamers, CHECK_INTERVAL_SLOW);

  console.log('[숲토킹] 모니터링 시작 (5초/30초 분리)');
}

function stopMonitoring() {
  state.isMonitoring = false;
  saveSettings();

  if (state.fastIntervalId) {
    clearInterval(state.fastIntervalId);
    state.fastIntervalId = null;
  }
  if (state.slowIntervalId) {
    clearInterval(state.slowIntervalId);
    state.slowIntervalId = null;
  }

  console.log('[숲토킹] 모니터링 중지');
}

async function checkFastStreamers() {
  const fastStreamers = state.favoriteStreamers.filter(s => s.autoJoin);
  if (fastStreamers.length === 0) return;

  console.log('[숲토킹] 빠른 체크 (자동참여 ON):', fastStreamers.length, '명');

  for (const streamer of fastStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function checkSlowStreamers() {
  const slowStreamers = state.favoriteStreamers.filter(s => !s.autoJoin);
  if (slowStreamers.length === 0) return;

  console.log('[숲토킹] 느린 체크 (자동참여 OFF):', slowStreamers.length, '명');

  for (const streamer of slowStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }
}

async function checkAndProcessStreamer(streamer) {
  try {
    const status = await checkStreamerStatus(streamer.id);
    const prevStatus = state.broadcastStatus[streamer.id];

    // 방송 시작 감지
    if (status.isLive && (!prevStatus || !prevStatus.isLive)) {
      console.log('[숲토킹] 방송 시작 감지:', streamer.nickname || streamer.id);

      // 알림
      if (state.settings.notificationEnabled) {
        showNotification(streamer, status);
      }

      // 자동 참여
      if (streamer.autoJoin) {
        openStreamerTab(streamer.id);
      }
    }

    // 방송 종료 감지
    if (!status.isLive && prevStatus?.isLive) {
      console.log('[숲토킹] 방송 종료 감지:', streamer.nickname || streamer.id);

      if (state.settings.endNotificationEnabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '방송 종료',
          message: `${streamer.nickname || streamer.id}님의 방송이 종료되었습니다.`,
          silent: true
        });
      }
    }

    state.broadcastStatus[streamer.id] = status;

  } catch (error) {
    console.error('[숲토킹] 스트리머 체크 실패:', streamer.id, error);
  }

  // 사이드패널에 상태 업데이트 전송
  broadcastToSidepanel({
    type: 'BROADCAST_STATUS_UPDATED',
    data: state.broadcastStatus
  });
}

async function checkStreamerStatus(streamerId) {
  try {
    const response = await fetch(`${API_BASE}/${streamerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    if (!response.ok) {
      return { isLive: false };
    }

    const data = await response.json();
    const broad = data.data?.broad;

    if (!broad) {
      return { isLive: false };
    }

    return {
      isLive: broad.broad_no > 0,
      broadNo: broad.broad_no,
      title: broad.broad_title || '',
      viewerCount: broad.current_sum_viewer || 0,
      startTime: broad.broad_start || null
    };
  } catch (error) {
    return { isLive: false };
  }
}

function showNotification(streamer, status) {
  chrome.notifications.create(`live_${streamer.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${streamer.nickname || streamer.id} 방송 시작!`,
    message: status.title || '방송이 시작되었습니다.',
    requireInteraction: true,
    buttons: [{ title: '시청하기' }]
  });
}

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId.startsWith('live_') && buttonIndex === 0) {
    const streamerId = notificationId.replace('live_', '');
    openStreamerTab(streamerId);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('live_')) {
    const streamerId = notificationId.replace('live_', '');
    openStreamerTab(streamerId);
  }
});

function openStreamerTab(streamerId) {
  const url = `https://play.sooplive.co.kr/${streamerId}`;
  chrome.tabs.create({ url });
}

// ===== 스트리머 관리 =====

async function addStreamer(streamerId) {
  const exists = state.favoriteStreamers.some(s => s.id === streamerId);
  if (exists) {
    return { success: false, error: '이미 등록된 스트리머입니다.' };
  }

  const status = await checkStreamerStatus(streamerId);

  const streamer = {
    id: streamerId,
    nickname: streamerId,
    autoJoin: false,
    autoRecord: false,
    addedAt: Date.now()
  };

  state.favoriteStreamers.push(streamer);
  state.broadcastStatus[streamerId] = status;

  await saveSettings();

  return { success: true, streamer };
}

async function removeStreamer(streamerId) {
  const index = state.favoriteStreamers.findIndex(s => s.id === streamerId);
  if (index === -1) {
    return { success: false, error: '스트리머를 찾을 수 없습니다.' };
  }

  state.favoriteStreamers.splice(index, 1);
  delete state.broadcastStatus[streamerId];

  await saveSettings();

  return { success: true };
}

async function updateStreamer(streamerId, updates) {
  const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
  if (!streamer) {
    return { success: false, error: '스트리머를 찾을 수 없습니다.' };
  }

  Object.assign(streamer, updates);
  await saveSettings();

  return { success: true, streamer };
}

// ===== 사이드패널로 브로드캐스트 =====

function broadcastToSidepanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ===== 다운로드 처리 (Offscreen에 요청) =====

async function downloadRecording(fileName) {
  console.log('[숲토킹] 다운로드 요청 (Offscreen으로):', fileName);

  try {
    const ready = await ensureOffscreen();
    if (!ready) {
      return { success: false, error: 'Offscreen Document가 없습니다' };
    }

    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      fileName: fileName
    });

    return response;
  } catch (error) {
    console.error('[숲토킹] 다운로드 요청 실패:', error);
    return { success: false, error: error.message };
  }
}

// ===== 메시지 핸들러 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  console.log('[숲토킹] 메시지 수신:', message.type);

  switch (message.type) {
    // ===== 사이드패널 → Background =====

    case 'START_RECORDING_REQUEST':
      const startResult = await startRecording(
        message.tabId,
        message.streamerId,
        message.nickname,
        message.quality,
        message.streamId  // ⭐ streamId 추가
      );
      sendResponse(startResult);
      break;

    case 'STOP_RECORDING_REQUEST':
      const stopResult = await stopRecording(message.sessionId);
      sendResponse(stopResult);
      break;

    case 'GET_ALL_RECORDINGS':
      sendResponse({
        success: true,
        data: Array.from(state.recordings.values())
      });
      break;

    case 'GET_STATE':
      sendResponse({
        success: true,
        data: {
          isMonitoring: state.isMonitoring,
          favoriteStreamers: state.favoriteStreamers,
          broadcastStatus: state.broadcastStatus,
          settings: state.settings,
          recordingCount: state.recordings.size
        }
      });
      break;

    case 'SET_MONITORING':
      if (message.enabled) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
      sendResponse({ success: true });
      break;

    case 'ADD_STREAMER':
      const addResult = await addStreamer(message.streamerId);
      sendResponse(addResult);
      break;

    case 'REMOVE_STREAMER':
      const removeResult = await removeStreamer(message.streamerId);
      sendResponse(removeResult);
      break;

    case 'UPDATE_STREAMER':
      const updateResult = await updateStreamer(message.streamerId, message.updates);
      sendResponse(updateResult);
      break;

    case 'UPDATE_SETTINGS':
      state.settings = { ...state.settings, ...message.settings };
      await saveSettings();
      sendResponse({ success: true });
      break;

    case 'REFRESH_STREAMERS':
      await checkFastStreamers();
      await checkSlowStreamers();
      sendResponse({ success: true });
      break;

    // ===== Offscreen → Background =====

    case 'RECORDING_PROGRESS':
      const rec = state.recordings.get(message.sessionId);
      if (rec) {
        rec.totalBytes = message.totalBytes;
        rec.elapsedTime = message.elapsedTime;
      }
      broadcastToSidepanel({
        type: 'RECORDING_PROGRESS_UPDATE',
        sessionId: message.sessionId,
        tabId: message.tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        totalBytes: message.totalBytes,
        elapsedTime: message.elapsedTime
      });
      break;

    case 'RECORDING_STOPPED':
      state.recordings.delete(message.sessionId);
      updateBadge();

      if (message.fileName) {
        await downloadRecording(message.fileName);
      }

      broadcastToSidepanel({
        type: 'RECORDING_STOPPED_UPDATE',
        sessionId: message.sessionId,
        tabId: message.tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        fileName: message.fileName,
        totalBytes: message.totalBytes,
        duration: message.duration
      });
      break;

    case 'RECORDING_ERROR':
      state.recordings.delete(message.sessionId);
      updateBadge();

      broadcastToSidepanel({
        type: 'RECORDING_ERROR_UPDATE',
        sessionId: message.sessionId,
        tabId: message.tabId,
        error: message.error
      });
      break;

    // ===== Offscreen → Background: 실제 다운로드 실행 =====

    case 'TRIGGER_DOWNLOAD':
      try {
        const downloadId = await chrome.downloads.download({
          url: message.url,
          filename: `SOOPtalking/${message.fileName}`,
          saveAs: false
        });

        console.log('[숲토킹] 다운로드 시작됨:', downloadId);

        const listener = (delta) => {
          if (delta.id === downloadId && delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            console.log('[숲토킹] 다운로드 완료:', message.fileName);

            chrome.runtime.sendMessage({
              type: 'DELETE_FILE',
              fileName: message.fileName
            }).catch(() => {});
          }
        };
        chrome.downloads.onChanged.addListener(listener);

        sendResponse({ success: true, downloadId });
      } catch (error) {
        console.error('[숲토킹] 다운로드 실행 실패:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    default:
      sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
  }
}

// ===== 사이드패널 열기 =====

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ===== 탭 닫힘 감지 =====

chrome.tabs.onRemoved.addListener((tabId) => {
  // 해당 탭에서 녹화 중인 세션 찾기
  for (const [sessionId, recording] of state.recordings.entries()) {
    if (recording.tabId === tabId) {
      console.log('[숲토킹] 녹화 중인 탭이 닫힘, 녹화 중지:', sessionId);
      stopRecording(sessionId);
    }
  }
});

// ===== 초기 설정 로드 =====

loadSettings().then(() => {
  console.log('[숲토킹] 초기 설정 로드 완료');
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== 로그 =====

console.log('[숲토킹] Background Service Worker v3.1.2 로드됨');
