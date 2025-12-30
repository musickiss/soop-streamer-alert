// ===== 숲토킹 v2.0 - SOOP 스트리머 방송 알림 & 다운로드 =====
// background.js - 백그라운드 서비스 워커
// 자동참여와 자동다운로드 분리, 백그라운드 다운로드 지원

// ===== i18n 헬퍼 함수 =====
function i18n(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// ===== 상수 정의 =====
const FAST_CHECK_INTERVAL = 5000;    // 자동참여/자동다운로드 스트리머 체크 주기 (5초)
const SLOW_CHECK_INTERVAL = 30000;   // 알림만 스트리머 체크 주기 (30초)
const TAB_CHECK_INTERVAL = 30000;    // 탭 실행 상태 점검 주기 (30초)
const REQUEST_DELAY = 300;           // 각 API 요청 사이 딜레이 (ms)
const M3U8_WAIT_TIMEOUT = 15000;     // m3u8 캡처 대기 시간 (15초)
const DEFAULT_NOTIFICATION_DURATION = 10;
const MAX_SOOP_TABS = 4;

// ===== 상태 저장 객체 =====
let state = {
  favoriteStreamers: [],
  isMonitoring: false,
  broadcastStatus: {},
  openedTabs: {},
  runningTabs: {},
  downloads: [],
  capturedM3u8: {},
  notificationEnabled: true,
  notificationDuration: DEFAULT_NOTIFICATION_DURATION,
  endNotificationEnabled: false,
  autoCloseOfflineTabs: true
};

// 타이머 ID
let fastCheckTimeoutId = null;
let slowCheckTimeoutId = null;
let tabCheckTimeoutId = null;

// Offscreen 상태
let offscreenCreated = false;

// 상태 로드 완료 여부
let stateLoaded = false;

// ===== 초기화 =====
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] 확장 프로그램이 설치되었습니다.');
  await loadState();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[숲토킹] 브라우저가 시작되었습니다.');
  await loadState();
  state.broadcastStatus = {};
  if (state.isMonitoring) {
    startMonitoring();
  }
});

(async () => {
  console.log('[숲토킹] 서비스 워커가 활성화되었습니다.');
  await loadState();
  if (state.isMonitoring) {
    startMonitoring();
  }
})();

// ===== 상태 저장/불러오기 =====
async function saveState() {
  try {
    await chrome.storage.local.set({
      favoriteStreamers: state.favoriteStreamers,
      isMonitoring: state.isMonitoring,
      notificationEnabled: state.notificationEnabled,
      notificationDuration: state.notificationDuration,
      endNotificationEnabled: state.endNotificationEnabled,
      autoCloseOfflineTabs: state.autoCloseOfflineTabs,
      broadcastStatus: state.broadcastStatus
    });
  } catch (error) {
    console.error('[숲토킹] 상태 저장 오류:', error);
  }
}

async function loadState() {
  try {
    const data = await chrome.storage.local.get([
      'favoriteStreamers',
      'isMonitoring',
      'notificationEnabled',
      'notificationDuration',
      'endNotificationEnabled',
      'autoCloseOfflineTabs',
      'broadcastStatus'
    ]);

    state.favoriteStreamers = data.favoriteStreamers || [];
    state.isMonitoring = data.isMonitoring || false;
    state.notificationEnabled = data.notificationEnabled !== undefined ? data.notificationEnabled : true;
    state.notificationDuration = data.notificationDuration || DEFAULT_NOTIFICATION_DURATION;
    state.endNotificationEnabled = data.endNotificationEnabled || false;
    state.autoCloseOfflineTabs = data.autoCloseOfflineTabs !== undefined ? data.autoCloseOfflineTabs : true;
    state.broadcastStatus = data.broadcastStatus || {};
    stateLoaded = true;

    console.log('[숲토킹] 상태 불러오기 완료:', {
      favorites: state.favoriteStreamers.length,
      isMonitoring: state.isMonitoring
    });
  } catch (error) {
    console.error('[숲토킹] 상태 불러오기 오류:', error);
    stateLoaded = true;
  }
}

async function ensureStateLoaded() {
  if (stateLoaded) return;
  await loadState();
}

// ===== 유틸리티 함수 =====
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateStreamerNickname(streamerId, newNickname) {
  if (!newNickname) return;
  const streamerIndex = state.favoriteStreamers.findIndex(s => s.id === streamerId);
  if (streamerIndex !== -1) {
    const currentNickname = state.favoriteStreamers[streamerIndex].nickname;
    if (currentNickname !== newNickname) {
      state.favoriteStreamers[streamerIndex].nickname = newNickname;
      console.log(`[숲토킹] ${streamerId} 닉네임 업데이트: ${currentNickname || streamerId} → ${newNickname}`);
    }
  }
}

// ===== Offscreen Document 관리 =====
async function ensureOffscreenDocument() {
  if (offscreenCreated) return true;

  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (contexts.length > 0) {
      offscreenCreated = true;
      return true;
    }

    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'HLS stream download engine'
    });

    offscreenCreated = true;
    console.log('[숲토킹] Offscreen document 생성됨');
    return true;
  } catch (error) {
    if (error.message?.includes('single offscreen')) {
      offscreenCreated = true;
      return true;
    }
    console.error('[숲토킹] Offscreen 생성 오류:', error);
    return false;
  }
}

// ===== 스트리머 그룹 분류 =====
function categorizeStreamers() {
  const fastCheck = [];
  const slowCheck = [];

  for (const streamer of state.favoriteStreamers) {
    const settings = streamer.settings || {};
    if (settings.autoJoin || settings.autoDownload) {
      fastCheck.push(streamer);
    } else {
      slowCheck.push(streamer);
    }
  }

  return { fastCheck, slowCheck };
}

// ===== 탭 관리 =====
async function findExistingBroadcastTab(streamerId) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        `https://play.sooplive.co.kr/${streamerId}/*`,
        `https://play.sooplive.co.kr/${streamerId}`
      ]
    });
    return tabs.length > 0 ? tabs[0] : null;
  } catch (error) {
    console.error(`[숲토킹] 탭 검색 오류:`, error);
    return null;
  }
}

async function countCurrentBroadcastTabs() {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://play.sooplive.co.kr/*'
    });
    return tabs.length;
  } catch (error) {
    return 0;
  }
}

async function openBroadcastTab(streamerId, broadNo, active = true) {
  const existingTab = await findExistingBroadcastTab(streamerId);
  if (existingTab) {
    if (active) {
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    state.openedTabs[streamerId] = existingTab.id;
    return existingTab;
  }

  const currentTabCount = await countCurrentBroadcastTabs();
  if (currentTabCount >= MAX_SOOP_TABS) {
    console.log(`[숲토킹] SOOP 탭 제한 (${currentTabCount}/${MAX_SOOP_TABS})`);
    return null;
  }

  try {
    const url = `https://play.sooplive.co.kr/${streamerId}/${broadNo}`;
    const tab = await chrome.tabs.create({ url, active });
    state.openedTabs[streamerId] = tab.id;
    state.runningTabs[streamerId] = true;
    console.log(`[숲토킹] ${streamerId} 방송 탭 열림 (탭 ID: ${tab.id})`);
    return tab;
  } catch (error) {
    console.error(`[숲토킹] 탭 열기 오류:`, error);
    return null;
  }
}

async function closeBroadcastTab(streamerId) {
  let tabId = state.openedTabs[streamerId];

  if (!tabId) {
    const existingTab = await findExistingBroadcastTab(streamerId);
    if (existingTab) tabId = existingTab.id;
  }

  if (tabId) {
    try {
      await chrome.tabs.remove(tabId);
      console.log(`[숲토킹] ${streamerId} 탭 닫힘`);
    } catch (e) {}
    delete state.openedTabs[streamerId];
    state.runningTabs[streamerId] = false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [streamerId, id] of Object.entries(state.openedTabs)) {
    if (id === tabId) {
      delete state.openedTabs[streamerId];
      state.runningTabs[streamerId] = false;
      break;
    }
  }
});

// ===== 탭 실행 상태 점검 =====
async function checkAllRunningTabs() {
  if (!state.isMonitoring) return;

  for (const streamer of state.favoriteStreamers) {
    const existingTab = await findExistingBroadcastTab(streamer.id);
    state.runningTabs[streamer.id] = !!existingTab;
    if (existingTab) {
      state.openedTabs[streamer.id] = existingTab.id;
    }
  }

  if (state.autoCloseOfflineTabs) {
    await closeOfflineStreamerTabs();
  }
}

async function closeOfflineStreamerTabs() {
  for (const streamer of state.favoriteStreamers) {
    const settings = streamer.settings || {};
    if (!settings.autoJoin) continue;

    const broadcastStatus = state.broadcastStatus[streamer.id];
    if (!broadcastStatus) continue;

    if (!broadcastStatus.isLive) {
      try {
        const tabs = await chrome.tabs.query({
          url: [
            `https://play.sooplive.co.kr/${streamer.id}/*`,
            `https://play.sooplive.co.kr/${streamer.id}`
          ]
        });

        for (const tab of tabs) {
          await chrome.tabs.remove(tab.id);
        }

        if (tabs.length > 0) {
          delete state.openedTabs[streamer.id];
          state.runningTabs[streamer.id] = false;
        }
      } catch (error) {}
    }
  }
}

function scheduleTabCheck() {
  if (!state.isMonitoring) return;

  tabCheckTimeoutId = setTimeout(async () => {
    await checkAllRunningTabs();
    scheduleTabCheck();
  }, TAB_CHECK_INTERVAL);
}

// ===== 알림 기능 =====
async function showBroadcastNotification(streamerId, nickname, title, broadNo) {
  if (!state.notificationEnabled) return;

  const existingTab = await findExistingBroadcastTab(streamerId);
  if (existingTab) return;

  const notificationId = `broadcast_${streamerId}_${Date.now()}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🔴 ${i18n('notificationBroadcastStartTitle', [nickname || streamerId])}`,
      message: title || i18n('notificationBroadcastStartMessage'),
      priority: 2,
      requireInteraction: false
    });

    await chrome.storage.local.set({
      [`notification_${notificationId}`]: { streamerId, broadNo, timestamp: Date.now() }
    });

    setTimeout(async () => {
      try { await chrome.notifications.clear(notificationId); } catch (e) {}
    }, state.notificationDuration * 1000);
  } catch (error) {
    console.error(`[숲토킹] 알림 생성 오류:`, error);
  }
}

async function showEndNotification(streamerId, nickname) {
  if (!state.endNotificationEnabled) return;

  const notificationId = `end_${streamerId}_${Date.now()}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `⚫ ${i18n('notificationBroadcastEndTitle', [nickname || streamerId])}`,
      message: i18n('notificationBroadcastEndMessage'),
      priority: 1,
      requireInteraction: false
    });

    setTimeout(async () => {
      try { await chrome.notifications.clear(notificationId); } catch (e) {}
    }, state.notificationDuration * 1000);
  } catch (error) {}
}

async function showDownloadNotification(streamerId, nickname, isStart = true) {
  const notificationId = `download_${streamerId}_${Date.now()}`;

  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: isStart ? `📥 ${nickname || streamerId} 다운로드 시작` : `✅ ${nickname || streamerId} 다운로드 완료`,
      message: isStart ? '백그라운드에서 다운로드 중...' : '다운로드 폴더에 저장되었습니다.',
      priority: 1,
      requireInteraction: false
    });

    setTimeout(async () => {
      try { await chrome.notifications.clear(notificationId); } catch (e) {}
    }, 5000);
  } catch (error) {}
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    const data = await chrome.storage.local.get(`notification_${notificationId}`);
    const notificationData = data[`notification_${notificationId}`];

    if (notificationData) {
      const { streamerId, broadNo } = notificationData;
      const existingTab = await findExistingBroadcastTab(streamerId);

      if (existingTab) {
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
      } else {
        const url = broadNo
          ? `https://play.sooplive.co.kr/${streamerId}/${broadNo}`
          : `https://play.sooplive.co.kr/${streamerId}`;
        await chrome.tabs.create({ url, active: true });
      }

      await chrome.storage.local.remove(`notification_${notificationId}`);
    }

    await chrome.notifications.clear(notificationId);
  } catch (error) {}
});

chrome.notifications.onClosed.addListener(async (notificationId) => {
  try {
    await chrome.storage.local.remove(`notification_${notificationId}`);
  } catch (e) {}
});

// ===== 방송 상태 확인 API =====
async function checkBroadcastStatus(streamerId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://play.sooplive.co.kr',
        'Referer': 'https://play.sooplive.co.kr/'
      },
      body: `bid=${encodeURIComponent(streamerId)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) throw new Error(`HTTP 오류: ${response.status}`);

    const data = await response.json();
    const isLive = data.CHANNEL && data.CHANNEL.RESULT === 1;

    return {
      isLive,
      broadNo: isLive ? data.CHANNEL.BNO : null,
      title: isLive ? data.CHANNEL.TITLE : null,
      nickname: isLive ? data.CHANNEL.BJNICK : null,
      streamerId
    };
  } catch (error) {
    clearTimeout(timeoutId);
    return { isLive: false, broadNo: null, title: null, nickname: null, streamerId, error: error.message };
  }
}

// ===== 방송 시작 처리 =====
async function handleBroadcastStart(streamer, broadcastInfo) {
  const settings = streamer.settings || {};
  const { autoJoin, autoDownload, notification } = settings;

  console.log(`[숲토킹] ${streamer.id} 방송 시작 - 자동참여: ${autoJoin}, 자동다운로드: ${autoDownload}`);

  // 알림 표시
  if (notification !== false) {
    await showBroadcastNotification(
      streamer.id,
      broadcastInfo.nickname || streamer.nickname,
      broadcastInfo.title,
      broadcastInfo.broadNo
    );
  }

  // 케이스별 처리
  if (autoJoin && autoDownload) {
    // 탭 열기 + 다운로드
    const tab = await openBroadcastTab(streamer.id, broadcastInfo.broadNo, true);
    if (tab) {
      await waitAndStartDownload(tab.id, streamer, broadcastInfo);
    }
  } else if (autoJoin && !autoDownload) {
    // 탭만 열기
    await openBroadcastTab(streamer.id, broadcastInfo.broadNo, true);
  } else if (!autoJoin && autoDownload) {
    // 백그라운드 다운로드
    await startBackgroundDownload(streamer, broadcastInfo);
  }
}

// ===== m3u8 캡처 대기 =====
async function waitForM3u8(tabId, timeout = M3U8_WAIT_TIMEOUT) {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_M3U8_URL' });
      if (response.success && response.m3u8Url) {
        return response;
      }
    } catch (e) {}
    await delay(pollInterval);
  }

  return null;
}

// ===== 탭에서 다운로드 시작 =====
async function waitAndStartDownload(tabId, streamer, broadcastInfo) {
  const m3u8Data = await waitForM3u8(tabId);

  if (!m3u8Data) {
    console.error(`[숲토킹] ${streamer.id} m3u8 캡처 실패`);
    return;
  }

  await startDownloadWithM3u8(streamer, broadcastInfo, m3u8Data, false);
}

// ===== 백그라운드 다운로드 =====
async function startBackgroundDownload(streamer, broadcastInfo) {
  console.log(`[숲토킹] ${streamer.id} 백그라운드 다운로드 시작`);

  const tab = await chrome.tabs.create({
    url: `https://play.sooplive.co.kr/${streamer.id}/${broadcastInfo.broadNo}`,
    active: false
  });

  console.log(`[숲토킹] 임시 탭 생성: ${tab.id}`);

  try {
    const m3u8Data = await waitForM3u8(tab.id);

    if (!m3u8Data) {
      throw new Error('m3u8 URL 캡처 실패');
    }

    await startDownloadWithM3u8(streamer, broadcastInfo, m3u8Data, true);

    // 임시 탭 닫기
    await chrome.tabs.remove(tab.id);
    console.log(`[숲토킹] 임시 탭 닫힘`);

    await showDownloadNotification(streamer.id, streamer.nickname, true);
  } catch (error) {
    console.error(`[숲토킹] 백그라운드 다운로드 오류:`, error);
    try { await chrome.tabs.remove(tab.id); } catch (e) {}
  }
}

// ===== 다운로드 시작 (공통) =====
async function startDownloadWithM3u8(streamer, broadcastInfo, m3u8Data, isBackgroundDownload) {
  await ensureOffscreenDocument();

  const result = await chrome.runtime.sendMessage({
    type: 'START_HLS_DOWNLOAD',
    options: {
      streamerId: streamer.id,
      broadNo: broadcastInfo.broadNo,
      nickname: broadcastInfo.nickname || streamer.nickname,
      title: broadcastInfo.title,
      m3u8Url: m3u8Data.m3u8Url,
      baseUrl: m3u8Data.baseUrl,
      quality: streamer.settings?.downloadQuality || 'original',
      isBackgroundDownload
    }
  });

  if (result.success) {
    console.log(`[숲토킹] 다운로드 시작: ${result.sessionId}`);

    state.downloads.push({
      sessionId: result.sessionId,
      streamerId: streamer.id,
      nickname: broadcastInfo.nickname || streamer.nickname,
      isRunning: true,
      isBackgroundDownload,
      startTime: Date.now()
    });
  }
}

// ===== 모니터링 체크 =====
async function checkAndHandleBroadcast(streamer) {
  const status = await checkBroadcastStatus(streamer.id);
  const previousStatus = state.broadcastStatus[streamer.id];

  const wasLive = previousStatus && previousStatus.isLive;
  const isNowLive = status.isLive;

  if (isNowLive && !wasLive) {
    await handleBroadcastStart(streamer, status);
  } else if (!isNowLive && wasLive) {
    console.log(`[숲토킹] ${streamer.id} 방송 종료`);
    await showEndNotification(streamer.id, streamer.nickname || previousStatus.nickname);

    if (state.autoCloseOfflineTabs) {
      const settings = streamer.settings || {};
      if (settings.autoJoin) {
        await closeBroadcastTab(streamer.id);
      }
    }
  }

  state.broadcastStatus[streamer.id] = {
    isLive: status.isLive,
    broadNo: status.broadNo,
    nickname: status.nickname,
    title: status.title,
    lastChecked: Date.now()
  };

  updateStreamerNickname(streamer.id, status.nickname);
}

// ===== 빠른 모니터링 루프 (5초) =====
async function runFastMonitoringLoop() {
  if (!state.isMonitoring) return;

  const { fastCheck } = categorizeStreamers();

  if (fastCheck.length > 0) {
    console.log(`[숲토킹] 빠른 체크 (${fastCheck.length}명)`);

    for (const streamer of fastCheck) {
      await checkAndHandleBroadcast(streamer);
      await delay(REQUEST_DELAY);
    }
  }

  await saveState();

  fastCheckTimeoutId = setTimeout(runFastMonitoringLoop, FAST_CHECK_INTERVAL);
}

// ===== 느린 모니터링 루프 (30초) =====
async function runSlowMonitoringLoop() {
  if (!state.isMonitoring) return;

  const { slowCheck } = categorizeStreamers();

  if (slowCheck.length > 0) {
    console.log(`[숲토킹] 느린 체크 (${slowCheck.length}명)`);

    for (const streamer of slowCheck) {
      await checkAndHandleBroadcast(streamer);
      await delay(REQUEST_DELAY);
    }
  }

  await saveState();

  slowCheckTimeoutId = setTimeout(runSlowMonitoringLoop, SLOW_CHECK_INTERVAL);
}

// ===== 모니터링 시작/중지 =====
function startMonitoring() {
  if (fastCheckTimeoutId) clearTimeout(fastCheckTimeoutId);
  if (slowCheckTimeoutId) clearTimeout(slowCheckTimeoutId);
  if (tabCheckTimeoutId) clearTimeout(tabCheckTimeoutId);

  state.isMonitoring = true;
  saveState();

  console.log('[숲토킹] 모니터링 시작');
  console.log(`  - 빠른 체크: ${FAST_CHECK_INTERVAL / 1000}초 (자동참여/자동다운로드)`);
  console.log(`  - 느린 체크: ${SLOW_CHECK_INTERVAL / 1000}초 (알림만)`);

  runFastMonitoringLoop();
  runSlowMonitoringLoop();
  checkAllRunningTabs().then(() => scheduleTabCheck());
}

function stopMonitoring() {
  if (fastCheckTimeoutId) { clearTimeout(fastCheckTimeoutId); fastCheckTimeoutId = null; }
  if (slowCheckTimeoutId) { clearTimeout(slowCheckTimeoutId); slowCheckTimeoutId = null; }
  if (tabCheckTimeoutId) { clearTimeout(tabCheckTimeoutId); tabCheckTimeoutId = null; }

  state.isMonitoring = false;
  state.runningTabs = {};
  saveState();

  console.log('[숲토킹] 모니터링 중지');
}

// ===== 메시지 핸들러 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureStateLoaded();

    try {
      switch (message.type) {
        case 'GET_STATE':
          sendResponse({
            success: true,
            data: {
              favoriteStreamers: state.favoriteStreamers,
              isMonitoring: state.isMonitoring,
              broadcastStatus: state.broadcastStatus,
              openedTabs: Object.keys(state.openedTabs),
              runningTabs: state.runningTabs,
              downloads: state.downloads,
              notificationEnabled: state.notificationEnabled,
              notificationDuration: state.notificationDuration,
              endNotificationEnabled: state.endNotificationEnabled,
              autoCloseOfflineTabs: state.autoCloseOfflineTabs
            }
          });
          break;

        case 'UPDATE_FAVORITES':
          state.favoriteStreamers = message.data || [];
          await saveState();
          sendResponse({ success: true });
          break;

        case 'SET_NOTIFICATION_SETTINGS':
          if (message.data) {
            if (typeof message.data.enabled === 'boolean') {
              state.notificationEnabled = message.data.enabled;
            }
            if (typeof message.data.duration === 'number' && message.data.duration > 0) {
              state.notificationDuration = message.data.duration;
            }
            if (typeof message.data.endEnabled === 'boolean') {
              state.endNotificationEnabled = message.data.endEnabled;
            }
            if (typeof message.data.autoCloseOfflineTabs === 'boolean') {
              state.autoCloseOfflineTabs = message.data.autoCloseOfflineTabs;
            }
            await saveState();
          }
          sendResponse({ success: true });
          break;

        case 'START_MONITORING':
          startMonitoring();
          sendResponse({ success: true });
          break;

        case 'STOP_MONITORING':
          stopMonitoring();
          sendResponse({ success: true });
          break;

        case 'REMOVE_FAVORITE':
          const removeId = message.data;
          state.favoriteStreamers = state.favoriteStreamers.filter(s => s.id !== removeId);
          delete state.broadcastStatus[removeId];
          delete state.openedTabs[removeId];
          await saveState();
          sendResponse({ success: true });
          break;

        case 'CHECK_BROADCAST_NOW':
          for (const streamer of state.favoriteStreamers) {
            await checkAndHandleBroadcast(streamer);
            await delay(REQUEST_DELAY);
          }
          sendResponse({ success: true, data: state.broadcastStatus });
          break;

        case 'GET_BROADCAST_STATUS':
          const status = await checkBroadcastStatus(message.data);
          sendResponse({ success: true, data: status });
          break;

        case 'START_DOWNLOAD':
          await ensureOffscreenDocument();
          const startResult = await chrome.runtime.sendMessage({
            type: 'START_HLS_DOWNLOAD',
            options: message.options
          });
          if (startResult.success) {
            state.downloads.push({
              sessionId: startResult.sessionId,
              streamerId: message.options.streamerId,
              nickname: message.options.nickname,
              isRunning: true,
              isBackgroundDownload: message.options.isBackgroundDownload,
              startTime: Date.now()
            });
          }
          sendResponse(startResult);
          break;

        case 'STOP_DOWNLOAD':
          await ensureOffscreenDocument();
          const stopResult = await chrome.runtime.sendMessage({
            type: 'STOP_HLS_DOWNLOAD',
            sessionId: message.sessionId
          });
          if (stopResult.success) {
            const idx = state.downloads.findIndex(d => d.sessionId === message.sessionId);
            if (idx !== -1) state.downloads.splice(idx, 1);
          }
          sendResponse(stopResult);
          break;

        case 'GET_ALL_DOWNLOADS':
          await ensureOffscreenDocument();
          try {
            const dlResult = await chrome.runtime.sendMessage({ type: 'GET_ALL_DOWNLOAD_STATUS' });
            sendResponse({ success: true, data: dlResult.data || [] });
          } catch (e) {
            sendResponse({ success: true, data: state.downloads });
          }
          break;

        case 'GET_STORAGE_INFO':
          await ensureOffscreenDocument();
          const storageResult = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_INFO' });
          sendResponse(storageResult);
          break;

        case 'M3U8_CAPTURED':
          state.capturedM3u8[message.data.streamerId] = message.data;
          console.log(`[숲토킹] m3u8 캡처됨: ${message.data.streamerId}`);
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_DOWNLOAD_STARTED':
        case 'OFFSCREEN_DOWNLOAD_PROGRESS':
          const dlIndex = state.downloads.findIndex(d => d.sessionId === message.data.sessionId);
          if (dlIndex !== -1) {
            Object.assign(state.downloads[dlIndex], message.data);
          }
          chrome.runtime.sendMessage({
            type: message.type === 'OFFSCREEN_DOWNLOAD_STARTED' ? 'DOWNLOAD_STARTED' : 'DOWNLOAD_PROGRESS',
            sessionId: message.data.sessionId,
            data: message.data
          }).catch(() => {});
          sendResponse({ success: true });
          break;

        case 'OFFSCREEN_DOWNLOAD_COMPLETE':
          const completeIdx = state.downloads.findIndex(d => d.sessionId === message.data.sessionId);
          if (completeIdx !== -1) {
            state.downloads.splice(completeIdx, 1);
          }
          // 브라우저 다운로드 트리거
          if (message.data.blobUrl) {
            chrome.downloads.download({
              url: message.data.blobUrl,
              filename: `SOOPtalking/${message.data.fileName}`,
              saveAs: false
            }).catch(e => console.error('[숲토킹] 다운로드 오류:', e));
          }
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_COMPLETED',
            data: message.data
          }).catch(() => {});
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
      }
    } catch (error) {
      console.error('[숲토킹] 메시지 처리 오류:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// ===== 서비스 워커 유지 =====
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && state.isMonitoring) {
    console.log('[숲토킹] 서비스 워커 유지 중...');
  }
});

console.log('[숲토킹] 백그라운드 서비스 워커 v2.0 로드됨');
