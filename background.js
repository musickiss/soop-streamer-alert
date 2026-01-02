// ===== 숲토킹 v3.5.3 - Background Service Worker =====
// Downloads API 기반 안정화 버전 + 5초/30초 분리 모니터링 + 방송 종료 시 녹화 안전 저장 + 500MB 자동 분할 저장 (MediaRecorder 재시작 방식)

// ===== 상수 =====
const CHECK_INTERVAL_FAST = 5000;   // 자동참여 ON 스트리머 (5초)
const CHECK_INTERVAL_SLOW = 30000;  // 자동참여 OFF 스트리머 (30초)
const API_URL = 'https://live.sooplive.co.kr/afreeca/player_live_api.php';

// ===== 보안 유틸리티 =====

function isValidStreamerId(streamerId) {
  if (!streamerId || typeof streamerId !== 'string') return false;
  // 영문 소문자, 숫자, 언더스코어만 허용 (1-50자)
  return /^[a-z0-9_]{1,50}$/.test(streamerId);
}

function sanitizeStreamerId(streamerId) {
  if (!streamerId || typeof streamerId !== 'string') return null;
  const sanitized = streamerId.toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 50);
  return sanitized.length > 0 ? sanitized : null;
}

function isValidBlobUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.startsWith('blob:');
}

function sanitizeFilename(str) {
  if (!str || typeof str !== 'string') return 'unknown';
  return str
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

// ===== 상태 관리 =====
const state = {
  // 스트리머 모니터링
  isMonitoring: false,
  favoriteStreamers: [],  // [{id, nickname, autoJoin, autoRecord}]
  broadcastStatus: {},    // streamerId -> {isLive, title, ...}

  // 녹화 세션 (tabId 기반)
  recordings: new Map(),  // tabId -> {streamerId, nickname, startTime, totalBytes}

  // 모니터링 인터벌 ID
  fastIntervalId: null,
  slowIntervalId: null,

  // 설정
  settings: {
    notificationEnabled: true,
    endNotificationEnabled: false
  }
};

// ===== 초기화 =====

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] v3.4.0 설치됨');
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

// ===== 녹화 관리 =====

async function startRecording(tabId, streamerId, nickname) {
  console.log('[숲토킹] 녹화 시작 요청:', streamerId, 'tabId:', tabId);

  // 보안: 입력 검증
  if (!tabId || typeof tabId !== 'number') {
    return { success: false, error: 'tabId가 필요합니다.' };
  }

  // streamerId 검증 및 정제
  const sanitizedId = sanitizeStreamerId(streamerId);
  if (!sanitizedId) {
    return { success: false, error: '올바르지 않은 스트리머 ID입니다.' };
  }
  streamerId = sanitizedId;
  nickname = sanitizeFilename(nickname) || streamerId;

  // 이미 녹화 중인지 확인
  if (state.recordings.has(tabId)) {
    return { success: false, error: '이미 녹화 중입니다.' };
  }

  try {
    // 탭 확인
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.includes('play.sooplive.co.kr')) {
      return { success: false, error: 'SOOP 방송 페이지가 아닙니다.' };
    }

    // Content Script에 녹화 시작 명령 전송
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'START_RECORDING',
      streamerId: streamerId,
      nickname: nickname
    });

    if (response?.success) {
      // 녹화 상태 저장 (실제 시작 알림은 RECORDING_STARTED_FROM_PAGE에서 처리)
      state.recordings.set(tabId, {
        tabId,
        streamerId,
        nickname,
        startTime: Date.now(),
        totalBytes: 0
      });
      updateBadge();
      return { success: true, tabId, streamerId, nickname };
    } else {
      return { success: false, error: response?.error || '녹화 시작 실패' };
    }

  } catch (error) {
    console.error('[숲토킹] 녹화 시작 실패:', error);

    // Content Script 없으면 주입 시도
    if (error.message?.includes('Receiving end') || error.message?.includes('Could not establish')) {
      return { success: false, error: '페이지를 새로고침 후 다시 시도해주세요.' };
    }

    return { success: false, error: error.message };
  }
}

async function stopRecording(tabId) {
  console.log('[숲토킹] 녹화 중지 요청:', tabId);

  if (!state.recordings.has(tabId)) {
    return { success: false, error: '녹화 중인 세션이 없습니다.' };
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'STOP_RECORDING'
    });
    return { success: true };
  } catch (error) {
    console.error('[숲토킹] 녹화 중지 실패:', error);
    // 탭이 닫혔을 수 있음 - 상태만 정리
    state.recordings.delete(tabId);
    updateBadge();
    return { success: true, message: '세션 정리됨' };
  }
}

// ===== 안전한 탭 종료 (녹화 중이면 저장 후 종료) =====

async function safeCloseTab(tabId, streamerId) {
  console.log('[숲토킹] 안전한 탭 종료 요청:', streamerId, 'tabId:', tabId);

  // 녹화 중인지 확인
  if (state.recordings.has(tabId)) {
    console.log('[숲토킹] 녹화 중인 탭 - 녹화 중지 후 종료:', streamerId);

    try {
      // 녹화 중지 요청
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' });

      // 녹화 저장 완료 대기 (최대 10초)
      let waitCount = 0;
      while (state.recordings.has(tabId) && waitCount < 20) {
        await new Promise(r => setTimeout(r, 500));
        waitCount++;
      }

      console.log('[숲토킹] 녹화 저장 완료, 탭 종료:', streamerId);
    } catch (error) {
      console.error('[숲토킹] 녹화 중지 실패:', error);
      state.recordings.delete(tabId);
      updateBadge();
    }
  }

  // 탭 종료
  try {
    await chrome.tabs.remove(tabId);
    console.log('[숲토킹] 탭 종료됨:', streamerId);
  } catch (error) {
    console.error('[숲토킹] 탭 종료 실패:', error);
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

  for (const streamer of fastStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }

  // 상태 업데이트 브로드캐스트
  broadcastToSidepanel({
    type: 'BROADCAST_STATUS_UPDATED',
    data: state.broadcastStatus
  });
}

async function checkSlowStreamers() {
  const slowStreamers = state.favoriteStreamers.filter(s => !s.autoJoin);
  if (slowStreamers.length === 0) return;

  for (const streamer of slowStreamers) {
    await checkAndProcessStreamer(streamer);
    await new Promise(r => setTimeout(r, 200));
  }

  // 상태 업데이트 브로드캐스트
  broadcastToSidepanel({
    type: 'BROADCAST_STATUS_UPDATED',
    data: state.broadcastStatus
  });
}

// 탭 로드 완료 대기 함수
async function waitForTabComplete(tabId, timeout = 15000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        return true;
      }
    } catch {
      return false;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  return true; // 타임아웃 시에도 시도
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
        const tab = await openStreamerTab(streamer.id);

        // 자동 녹화
        if (streamer.autoRecord && tab?.id) {
          // 탭 로드 완료 대기
          await waitForTabComplete(tab.id, 15000);

          // 비디오 요소 로드 대기 (추가 2초)
          await new Promise(r => setTimeout(r, 2000));

          // 녹화 시작 (최대 3회 재시도)
          let retryCount = 0;
          const maxRetries = 3;

          const tryStartRecording = async () => {
            const result = await startRecording(tab.id, streamer.id, streamer.nickname || streamer.id);

            if (!result.success && retryCount < maxRetries) {
              retryCount++;
              console.log('[숲토킹] 자동 녹화 재시도:', retryCount);
              await new Promise(r => setTimeout(r, 2000));
              return tryStartRecording();
            }

            return result;
          };

          tryStartRecording();
        }
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

      // 해당 스트리머의 탭 찾기
      try {
        const tabs = await chrome.tabs.query({ url: `*://play.sooplive.co.kr/${streamer.id}*` });

        for (const tab of tabs) {
          // 녹화 중인 탭이면 녹화 안전 저장 (autoClose 여부와 무관)
          if (state.recordings.has(tab.id)) {
            console.log('[숲토킹] 방송 종료 - 녹화 안전 저장:', streamer.id, 'tabId:', tab.id);
            try {
              await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
              // 저장 완료 대기 (5초)
              await new Promise(r => setTimeout(r, 5000));
              state.recordings.delete(tab.id);
              updateBadge();
              console.log('[숲토킹] 녹화 저장 완료:', streamer.id);
            } catch (error) {
              console.error('[숲토킹] 녹화 중지 실패:', error);
              state.recordings.delete(tab.id);
              updateBadge();
            }
          }

          // 자동 종료가 활성화되어 있으면 탭 종료
          if (streamer.autoClose) {
            console.log('[숲토킹] 자동 종료 - 탭 닫기:', streamer.id);
            try {
              await chrome.tabs.remove(tab.id);
            } catch (error) {
              console.error('[숲토킹] 탭 종료 실패:', error);
            }
          }
        }
      } catch (error) {
        console.error('[숲토킹] 방송 종료 처리 실패:', error);
      }
    }

    state.broadcastStatus[streamer.id] = status;

  } catch (error) {
    console.error('[숲토킹] 스트리머 체크 실패:', streamer.id, error);
  }
}

async function checkStreamerStatus(streamerId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(API_URL, {
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

    if (!response.ok) {
      return { isLive: false };
    }

    const data = await response.json();
    const channel = data.CHANNEL;

    if (!channel) {
      return { isLive: false };
    }

    return {
      isLive: channel && channel.RESULT === 1,
      broadNo: channel.BNO,
      title: channel.TITLE || '',
      nickname: channel.BJNICK || streamerId
    };
  } catch (error) {
    clearTimeout(timeoutId);
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

async function openStreamerTab(streamerId) {
  const url = `https://play.sooplive.co.kr/${streamerId}`;
  const tab = await chrome.tabs.create({ url });
  return tab;
}

// ===== 스트리머 관리 =====

async function addStreamer(streamerId) {
  // 보안: streamerId 검증
  const sanitized = sanitizeStreamerId(streamerId);
  if (!sanitized) {
    return { success: false, error: '올바르지 않은 스트리머 ID입니다.' };
  }
  streamerId = sanitized;

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

// ===== 다운로드 처리 =====

async function downloadRecording(blobUrl, fileName) {
  console.log('[숲토킹] 다운로드 요청:', fileName);

  // 보안: blobUrl 검증
  if (!isValidBlobUrl(blobUrl)) {
    console.error('[숲토킹] 유효하지 않은 blobUrl:', blobUrl);
    return { success: false, error: '유효하지 않은 다운로드 URL입니다.' };
  }

  // 보안: 파일명 정제
  fileName = sanitizeFilename(fileName) || 'recording.webm';
  if (!fileName.endsWith('.webm')) {
    fileName += '.webm';
  }

  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename: `SOOPtalking/${fileName}`,
      saveAs: false
    });

    console.log('[숲토킹] 다운로드 시작:', downloadId);

    // 다운로드 완료 감지 및 정리
    const listener = (delta) => {
      if (delta.id === downloadId) {
        if (delta.state?.current === 'complete') {
          chrome.downloads.onChanged.removeListener(listener);
          console.log('[숲토킹] 다운로드 완료:', fileName);
        } else if (delta.state?.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(listener);
          console.error('[숲토킹] 다운로드 중단:', fileName);
        }
      }
    };
    chrome.downloads.onChanged.addListener(listener);

    // 5분 후 리스너 자동 정리 (안전장치)
    setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
    }, 300000);

    return { success: true, downloadId };
  } catch (error) {
    console.error('[숲토킹] 다운로드 실패:', error);
    return { success: false, error: error.message };
  }
}

// ===== 메시지 핸들러 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  switch (message.type) {
    // ===== 사이드패널 → Background =====

    case 'START_RECORDING_REQUEST':
      const startResult = await startRecording(
        message.tabId,
        message.streamerId,
        message.nickname
      );
      sendResponse(startResult);
      break;

    case 'STOP_RECORDING_REQUEST':
      const stopResult = await stopRecording(message.tabId);
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

    // ===== Content Script (MAIN) → Background =====

    case 'CONTENT_SCRIPT_LOADED':
      console.log('[숲토킹] Content Script 로드됨:', message.streamerId);
      sendResponse({ success: true });
      break;

    case 'RECORDING_STARTED_FROM_PAGE':
      console.log('[숲토킹] 녹화 시작됨 (페이지에서):', message.streamerId);
      if (tabId && !state.recordings.has(tabId)) {
        state.recordings.set(tabId, {
          tabId,
          streamerId: message.streamerId,
          nickname: message.nickname,
          startTime: Date.now(),
          totalBytes: 0
        });
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_STARTED_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname
      });
      break;

    case 'RECORDING_PROGRESS_FROM_PAGE':
      if (tabId && state.recordings.has(tabId)) {
        const rec = state.recordings.get(tabId);
        rec.totalBytes = message.totalBytes;
        rec.elapsedTime = message.elapsedTime;
      }
      broadcastToSidepanel({
        type: 'RECORDING_PROGRESS_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        totalBytes: message.totalBytes,
        elapsedTime: message.elapsedTime
      });
      break;

    case 'RECORDING_STOPPED_FROM_PAGE':
      console.log('[숲토킹] 녹화 중지됨 (페이지에서):', message.streamerId);
      if (tabId) {
        state.recordings.delete(tabId);
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_STOPPED_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        totalBytes: message.totalBytes,
        duration: message.duration,
        saved: message.saved
      });
      break;

    case 'RECORDING_ERROR_FROM_PAGE':
      console.error('[숲토킹] 녹화 에러 (페이지에서):', message.error);
      if (tabId) {
        state.recordings.delete(tabId);
        updateBadge();
      }
      broadcastToSidepanel({
        type: 'RECORDING_ERROR_UPDATE',
        tabId: tabId,
        error: message.error
      });
      break;

    case 'SAVE_RECORDING_FROM_PAGE':
      console.log('[숲토킹] 파일 저장 요청:', message.fileName);
      // 보안: Content Script에서 온 요청만 처리
      if (!tabId) {
        console.warn('[숲토킹] 파일 저장 요청 거부: 탭 ID 없음');
        break;
      }
      await downloadRecording(message.blobUrl, message.fileName);
      break;

    // ===== 분할 저장 처리 =====
    case 'SAVE_RECORDING_SEGMENT':
      try {
        const { fileName, blobUrl, size, partNumber, streamerId } = message;

        console.log(`[숲토킹] 분할 저장: ${fileName} (${(size / 1024 / 1024).toFixed(1)}MB)`);

        // 보안: Content Script에서 온 요청만 처리
        if (!tabId) {
          console.warn('[숲토킹] 분할 저장 요청 거부: 탭 ID 없음');
          sendResponse({ success: false, error: '탭 ID 없음' });
          break;
        }

        // 보안: blobUrl 검증
        if (!isValidBlobUrl(blobUrl)) {
          console.error('[숲토킹] 분할 저장 - 유효하지 않은 blobUrl');
          sendResponse({ success: false, error: '유효하지 않은 URL' });
          break;
        }

        // 다운로드 실행
        await chrome.downloads.download({
          url: blobUrl,
          filename: `SOOPtalking/${sanitizeFilename(fileName)}`,
          saveAs: false
        });

        // 사이드패널에 분할 저장 성공 알림
        broadcastToSidepanel({
          type: 'SEGMENT_SAVED',
          tabId: tabId,
          streamerId: streamerId,
          partNumber: partNumber,
          size: size,
          fileName: fileName
        });

        sendResponse({ success: true, partNumber: partNumber });
      } catch (error) {
        console.error('[숲토킹] 분할 저장 실패:', error);

        // 사이드패널에 분할 저장 실패 알림
        broadcastToSidepanel({
          type: 'SEGMENT_SAVE_ERROR',
          tabId: tabId,
          error: error.message
        });

        sendResponse({ success: false, error: error.message });
      }
      break;

    default:
      sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
  }
}

// ===== 탭 닫힘 감지 =====

chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.recordings.has(tabId)) {
    console.log('[숲토킹] 녹화 중인 탭이 닫힘:', tabId);
    state.recordings.delete(tabId);
    updateBadge();
  }
});

// ===== VOD 리다이렉트 감지 (방송 종료 시 VOD 페이지로 이동) =====

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // URL 변경 감지
  if (changeInfo.url) {
    const url = changeInfo.url;

    // VOD 페이지로 리다이렉트 감지 (vod.sooplive.co.kr)
    if (url.includes('vod.sooplive.co.kr')) {
      console.log('[숲토킹] VOD 리다이렉트 감지:', tabId);

      // 녹화 중인 탭인지 확인
      if (state.recordings.has(tabId)) {
        const rec = state.recordings.get(tabId);
        const streamer = state.favoriteStreamers.find(s => s.id === rec.streamerId);

        // 스트리머별 자동 종료 활성화 확인
        if (streamer?.autoClose) {
          console.log('[숲토킹] VOD 리다이렉트 - 자동 종료 실행:', rec.streamerId);
          await safeCloseTab(tabId, rec.streamerId);
        }
      }
    }
  }
});

// ===== 사이드패널 열기 =====

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ===== 초기 설정 로드 =====

loadSettings().then(() => {
  console.log('[숲토킹] 초기 설정 로드 완료');
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== 로그 =====

console.log('[숲토킹] Background Service Worker v3.5.3 로드됨 (500MB 자동 분할 저장)');
