// ===== 숲토킹 v3.0.2 - Background Service Worker =====
// Offscreen Document 기반 안정적 녹화

// ===== 상수 =====
const CHECK_INTERVAL = 30000;  // 스트리머 체크 주기 (30초)
const API_BASE = 'https://api.m.sooplive.co.kr/broad/a/watch';

// ===== 상태 관리 =====
const state = {
  // 스트리머 모니터링
  isMonitoring: false,
  favoriteStreamers: [],  // [{id, nickname, autoJoin, autoRecord}]
  broadcastStatus: {},    // streamerId -> {isLive, title, ...}

  // 녹화 세션 (Offscreen에서 관리하는 세션 메타데이터)
  recordings: new Map(),  // sessionId -> {tabId, streamerId, nickname, fileName, startTime, totalBytes}

  // Offscreen 상태
  offscreenReady: false,

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
  console.log('[숲토킹] v3.0 설치됨');
  await loadSettings();
  setupAlarms();
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

// ===== 알람 설정 =====

function setupAlarms() {
  chrome.alarms.create('checkStreamers', {
    periodInMinutes: 0.5  // 30초
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkStreamers' && state.isMonitoring) {
    checkAllStreamers();
  }
});

// ===== Offscreen Document 관리 =====

async function ensureOffscreen() {
  if (state.offscreenReady) {
    // 실제로 존재하는지 확인
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

// ===== 녹화 관리 =====

async function startRecording(tabId, streamerId, nickname, quality) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId);

  const ready = await ensureOffscreen();
  if (!ready) {
    return { success: false, error: 'Offscreen Document 생성 실패' };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_RECORDING',
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

// ===== 스트리머 모니터링 =====

async function checkAllStreamers() {
  if (!state.isMonitoring || state.favoriteStreamers.length === 0) {
    return;
  }

  console.log('[숲토킹] 스트리머 상태 체크 중...');

  for (const streamer of state.favoriteStreamers) {
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

      // API 요청 간 딜레이
      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.error('[숲토킹] 스트리머 체크 실패:', streamer.id, error);
    }
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

function startMonitoring() {
  state.isMonitoring = true;
  saveSettings();
  checkAllStreamers();
}

function stopMonitoring() {
  state.isMonitoring = false;
  saveSettings();
}

// ===== 스트리머 관리 =====

async function addStreamer(streamerId) {
  const exists = state.favoriteStreamers.some(s => s.id === streamerId);
  if (exists) {
    return { success: false, error: '이미 등록된 스트리머입니다.' };
  }

  // 스트리머 정보 가져오기
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
    // Offscreen이 준비되어 있는지 확인
    const ready = await ensureOffscreen();
    if (!ready) {
      return { success: false, error: 'Offscreen Document가 없습니다' };
    }

    // Offscreen에 다운로드 요청
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
        message.quality
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
      await checkAllStreamers();
      sendResponse({ success: true });
      break;

    // ===== Offscreen → Background =====

    case 'RECORDING_PROGRESS':
      const rec = state.recordings.get(message.sessionId);
      if (rec) {
        rec.totalBytes = message.totalBytes;
        rec.elapsedTime = message.elapsedTime;
      }
      // 사이드패널에 진행 상황 전달
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

      // Background에서 직접 OPFS 파일 읽어서 다운로드
      if (message.fileName) {
        await downloadRecording(message.fileName);
      }

      // 사이드패널에 완료 알림
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

        // 다운로드 완료 감지하여 OPFS 파일 삭제
        const listener = (delta) => {
          if (delta.id === downloadId && delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            console.log('[숲토킹] 다운로드 완료:', message.fileName);

            // Offscreen에 파일 삭제 요청
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

// ===== 로그 =====

console.log('[숲토킹] Background Service Worker v3.0.2 로드됨');
