// ===== 숲토킹 v2.0 - SOOP 스트리머 방송 알림 & 다운로드 =====
// background.js - 백그라운드 서비스 워커
// 자동참여와 자동다운로드 분리, 백그라운드 다운로드 지원

// ============================================
// webRequest로 미디어 요청 캡처 (최상단에 위치)
// ============================================

const capturedMediaUrls = new Map();

// 모든 요청 로깅 (디버깅용)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const urlLower = url.toLowerCase();

    // 디버깅: 모든 SOOP/아프리카 관련 요청 로깅
    if (urlLower.includes('sooplive') || urlLower.includes('afreeca') || urlLower.includes('live-')) {
      console.log('[숲토킹] 🔍 SOOP 관련 요청:', url.substring(0, 120));
    }

    // m3u8 또는 playlist 파일 감지
    if (urlLower.includes('.m3u8') || urlLower.includes('playlist')) {
      console.log('[숲토킹] 🎬 m3u8 감지! tabId:', details.tabId, 'URL:', url);

      if (details.tabId > 0) {
        if (!capturedMediaUrls.has(details.tabId)) {
          capturedMediaUrls.set(details.tabId, {
            playlist: null,
            baseUrl: null,
            segments: [],
            timestamp: Date.now()
          });
          console.log('[숲토킹] 🆕 새 탭 데이터 생성, tabId:', details.tabId);
        }

        const tabData = capturedMediaUrls.get(details.tabId);
        tabData.timestamp = Date.now();
        tabData.playlist = url;  // 원본 URL 사용
        tabData.baseUrl = url.substring(0, url.lastIndexOf('/') + 1);

        console.log('[숲토킹] ✅ m3u8 캡처 완료! tabId:', details.tabId);
        console.log('[숲토킹] 현재 캡처된 탭 수:', capturedMediaUrls.size);
        console.log('[숲토킹] 📋 현재 캡처된 탭 목록:', Array.from(capturedMediaUrls.keys()));
      }
    }

    // ts 세그먼트 캡처
    if (urlLower.includes('.ts') && details.tabId > 0) {
      const tabData = capturedMediaUrls.get(details.tabId);
      if (tabData && !tabData.segments.includes(url)) {
        tabData.segments.push(url);
        if (tabData.segments.length > 100) {
          tabData.segments.shift();
        }
      }
    }
  },
  {
    urls: ["<all_urls>"]  // 모든 URL 감시
  }
);

// 캡처된 미디어 가져오기 함수
function getCapturedMedia(tabId) {
  const data = capturedMediaUrls.get(tabId);
  if (data && (Date.now() - data.timestamp < 600000)) { // 10분 이내
    return data;
  }
  return null;
}

// 탭이 닫히면 캡처 데이터 정리
chrome.tabs.onRemoved.addListener((tabId) => {
  capturedMediaUrls.delete(tabId);
});

console.log('[숲토킹] webRequest 리스너 등록 완료');

// ============================================

// ===== i18n 헬퍼 함수 =====
function i18n(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// ===== 상수 정의 =====
const FAST_CHECK_INTERVAL = 5000;    // 자동참여/자동다운로드 스트리머 체크 주기 (5초)

// ===== 보안: 허용된 도메인 목록 =====
const ALLOWED_DOMAINS = [
  'sooplive.co.kr',
  'afreecatv.com',
  'livestream-manager.sooplive.co.kr'
];

// 도메인 검증 함수
function isAllowedDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_DOMAINS.some(domain => hostname.endsWith(domain));
  } catch {
    return false;
  }
}

// 파일명 sanitization 함수
function sanitizeFilename(filename) {
  if (!filename) return 'unknown';
  return filename
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}
const SLOW_CHECK_INTERVAL = 30000;   // 알림만 스트리머 체크 주기 (30초)
const TAB_CHECK_INTERVAL = 30000;    // 탭 실행 상태 점검 주기 (30초)
const REQUEST_DELAY = 300;           // 각 API 요청 사이 딜레이 (ms)
const M3U8_WAIT_TIMEOUT = 15000;     // m3u8 캡처 대기 시간 (15초)
const DEFAULT_NOTIFICATION_DURATION = 10;
const MAX_SOOP_TABS = 4;

// ===== 뱃지 업데이트 함수 =====
function updateRecordingBadge() {
  const count = state.activeRecordings.size;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4757' }); // 빨간색
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

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
  autoCloseOfflineTabs: true,

  // 녹화 상태 중앙 관리 - 탭별 다중 녹화 지원
  activeRecordings: new Map()  // Map<tabId, { streamerId, nickname, startTime, totalBytes }>
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

// Offscreen document로 메시지 전송
async function sendMessageToOffscreen(message) {
  return new Promise((resolve, reject) => {
    // chrome.runtime.sendMessage는 모든 extension context(background, content scripts, popup, offscreen 등)에 메시지를 보냄
    // offscreen에서 해당 메시지 타입을 처리하도록 함
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[숲토킹] Offscreen 메시지 오류:', chrome.runtime.lastError.message);
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
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

  // 녹화 중인 탭이 닫히면 녹화 상태 정리
  if (state.activeRecordings.has(tabId)) {
    console.log('[숲토킹] 녹화 중인 탭 닫힘, 상태 정리:', tabId);
    const recordingInfo = state.activeRecordings.get(tabId);
    state.activeRecordings.delete(tabId);
    updateRecordingBadge();  // 뱃지 업데이트

    chrome.runtime.sendMessage({
      type: 'RECORDING_STOPPED',
      data: {
        tabId,
        ...recordingInfo,
        reason: 'tab_closed'
      }
    }).catch(() => {});
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

// ===== SOOP 스트림 URL 가져오기 (CORS 우회) =====
async function fetchStreamUrl(streamerId, broadNo) {
  console.log('[숲토킹] fetchStreamUrl 시작:', streamerId, broadNo);

  try {
    // 1단계: player_live_api.php 호출
    const playerApiResponse = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        bid: streamerId,
        bno: broadNo || '',
        type: 'live',
        confirm_adult: 'false',
        player_type: 'html5',
        mode: 'landing',
        from_api: '0',
        pwd: '',
        stream_type: 'common',
        quality: 'HD'
      }),
      credentials: 'include'
    });

    const playerData = await playerApiResponse.json();
    console.log('[숲토킹] player_live_api 응답 받음');

    if (!playerData.CHANNEL || playerData.CHANNEL.RESULT !== 1) {
      return {
        success: false,
        error: '방송 중이 아니거나 접근할 수 없습니다.',
        streamerId: streamerId
      };
    }

    const channel = playerData.CHANNEL;
    const bno = channel.BNO;
    const bjid = channel.BJID || streamerId;
    const cdnType = channel.CDN || 'gcp_cdn';

    console.log('[숲토킹] 방송 정보:', { bno, bjid, cdnType });

    // CDN 타입에 따른 도메인 매핑
    const cdnDomains = {
      'lg_cdn': ['live-lg.sooplive.co.kr', 'live-lg.afreecatv.com'],
      'kt_cdn': ['live-kt.sooplive.co.kr', 'live-kt.afreecatv.com'],
      'sk_cdn': ['live-sk.sooplive.co.kr', 'live-sk.afreecatv.com'],
      'gcp_cdn': ['live-global.sooplive.co.kr', 'live-global.afreecatv.com'],
      'aws_cdn': ['live-aws.sooplive.co.kr'],
      'gs_cdn': ['live-gs.sooplive.co.kr']
    };

    // 해당 CDN의 도메인 목록 가져오기
    const domains = cdnDomains[cdnType] || cdnDomains['gcp_cdn'];

    // 2단계: 여러 URL 패턴 시도
    const urlPatterns = [];

    for (const domain of domains) {
      // 패턴 1: /hls/{bjid}/{bno}/playlist.m3u8
      urlPatterns.push(`https://${domain}/hls/${bjid}/${bno}/playlist.m3u8`);
      // 패턴 2: /live/{bjid}/{bno}/playlist.m3u8
      urlPatterns.push(`https://${domain}/live/${bjid}/${bno}/playlist.m3u8`);
      // 패턴 3: /{bjid}/{bno}/playlist.m3u8
      urlPatterns.push(`https://${domain}/${bjid}/${bno}/playlist.m3u8`);
      // 패턴 4: /hls/{bno}/playlist.m3u8
      urlPatterns.push(`https://${domain}/hls/${bno}/playlist.m3u8`);
      // 패턴 5: original 화질
      urlPatterns.push(`https://${domain}/hls/${bjid}/${bno}_original/playlist.m3u8`);
      urlPatterns.push(`https://${domain}/hls/${bjid}/${bno}_hd/playlist.m3u8`);
    }

    // 모든 도메인에 대해 추가 패턴
    const allDomainsList = Object.values(cdnDomains).flat();
    for (const domain of allDomainsList) {
      if (!domains.includes(domain)) {
        urlPatterns.push(`https://${domain}/hls/${bjid}/${bno}/playlist.m3u8`);
      }
    }

    console.log('[숲토킹] URL 패턴 시도 시작 (총', urlPatterns.length, '개)');

    // 각 URL 테스트
    for (const url of urlPatterns) {
      try {
        console.log('[숲토킹] 시도:', url);
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Referer': 'https://play.sooplive.co.kr/',
            'Origin': 'https://play.sooplive.co.kr'
          }
        });

        if (response.ok) {
          const text = await response.text();
          // m3u8 파일인지 확인 (EXTM3U로 시작)
          if (text.includes('#EXTM3U')) {
            console.log('[숲토킹] ✅ m3u8 URL 발견!:', url);
            const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
            return {
              success: true,
              m3u8Url: url,
              baseUrl: baseUrl,
              streamerId: streamerId,
              broadNo: bno,
              nickname: channel.BJNICK || streamerId,
              title: channel.TITLE || ''
            };
          }
        }
      } catch (e) {
        // 실패하면 다음 URL 시도
      }
    }

    // 3단계: broad_stream_assign.html 시도 (여러 파라미터 조합)
    console.log('[숲토킹] broad_stream_assign.html 시도...');

    const qualityList = ['original', 'hd', 'sd'];
    const returnTypes = ['gcp_cdn', 'gs_cdn_pc_web', cdnType];

    for (const returnType of returnTypes) {
      for (const quality of qualityList) {
        try {
          const params = {
            return_type: returnType,
            broad_key: `${bno}-common-${quality}-hls`,
            use_cors: 'true',
            cors_origin_url: 'play.sooplive.co.kr'
          };

          console.log('[숲토킹] broad_stream_assign 파라미터:', params);

          const assignResponse = await fetch('https://livestream-manager.sooplive.co.kr/broad_stream_assign.html', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': 'https://play.sooplive.co.kr/',
              'Origin': 'https://play.sooplive.co.kr'
            },
            body: new URLSearchParams(params),
            credentials: 'include'
          });

          if (assignResponse.ok) {
            const assignData = await assignResponse.json();
            console.log('[숲토킹] broad_stream_assign 응답:', assignData);

            const m3u8Url = assignData.view_url || assignData.cdn_url || assignData.stream_url || assignData.url;

            if (m3u8Url && !m3u8Url.includes('error')) {
              console.log('[숲토킹] ✅ broad_stream_assign에서 URL 획득:', m3u8Url);
              const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
              return {
                success: true,
                m3u8Url: m3u8Url,
                baseUrl: baseUrl,
                streamerId: streamerId,
                broadNo: bno,
                nickname: channel.BJNICK || streamerId,
                title: channel.TITLE || ''
              };
            }
          }
        } catch (e) {
          console.log('[숲토킹] broad_stream_assign 실패:', e.message);
        }
      }
    }

    // 모든 방법 실패
    console.error('[숲토킹] 모든 URL 패턴 실패');
    return {
      success: false,
      error: 'm3u8 URL을 찾을 수 없습니다. 잠시 후 다시 시도해주세요.',
      streamerId: streamerId
    };

  } catch (error) {
    console.error('[숲토킹] fetchStreamUrl 오류:', error);
    return {
      success: false,
      error: error.message,
      streamerId: streamerId
    };
  }
}

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

// ===== m3u8 URL 직접 탐색 =====
async function probeM3u8Url(streamerId, broadNo) {
  console.log('[숲토킹] m3u8 URL 직접 탐색 시작:', streamerId, broadNo);

  // broadNo가 없으면 API에서 가져오기
  let actualBroadNo = broadNo;
  if (!actualBroadNo) {
    try {
      const apiResponse = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `bid=${streamerId}`,
        credentials: 'include'
      });
      const apiData = await apiResponse.json();
      if (apiData.CHANNEL && apiData.CHANNEL.BNO) {
        actualBroadNo = apiData.CHANNEL.BNO;
        console.log('[숲토킹] API에서 broadNo 획득:', actualBroadNo);
      }
    } catch (e) {
      console.log('[숲토킹] API 호출 실패:', e.message);
    }
  }

  if (!actualBroadNo) {
    return { success: false, error: 'broadNo를 찾을 수 없습니다.' };
  }

  // 테스트할 URL 패턴들
  const testUrls = [
    `https://live-gs.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
    `https://live-avs.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
    `https://live-global.afreecatv.com/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
    `https://live-global.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
    `https://live-kt.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`,
    `https://live-lg.sooplive.co.kr/hls/${streamerId}/${actualBroadNo}/playlist.m3u8`
  ];

  // 각 URL 테스트
  for (const url of testUrls) {
    try {
      console.log('[숲토킹] m3u8 테스트:', url);
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          'Origin': 'https://play.sooplive.co.kr',
          'Referer': 'https://play.sooplive.co.kr/'
        }
      });
      if (response.ok) {
        const text = await response.text();
        if (text.includes('#EXTM3U')) {
          console.log('[숲토킹] ✅ m3u8 URL 발견:', url);
          const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
          return {
            success: true,
            m3u8Url: url,
            baseUrl: baseUrl,
            broadNo: actualBroadNo
          };
        }
      }
    } catch (e) {
      // 실패하면 다음 URL 시도
    }
  }

  console.log('[숲토킹] ❌ 모든 m3u8 URL 테스트 실패');
  return { success: false, error: '사용 가능한 m3u8 URL을 찾을 수 없습니다.' };
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

  const result = await sendMessageToOffscreen({
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

  if (result && result.success) {
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

        case 'GET_CAPTURED_MEDIA':
          // 캡처된 미디어 정보 요청
          const mediaData = getCapturedMedia(message.tabId);
          sendResponse({
            success: !!mediaData && (mediaData.playlist || mediaData.segments.length > 0),
            data: mediaData
          });
          break;

        case 'START_DOWNLOAD_FROM_CAPTURED':
          // 캡처된 URL로 다운로드 시작
          console.log('[숲토킹] START_DOWNLOAD_FROM_CAPTURED 요청:', message);
          const capturedData = getCapturedMedia(message.tabId);

          if (!capturedData || (!capturedData.playlist && capturedData.segments.length === 0)) {
            sendResponse({
              success: false,
              error: '캡처된 미디어 URL이 없습니다. 방송을 잠시 시청한 후 다시 시도해주세요.'
            });
            break;
          }

          // 플레이리스트 URL이 있으면 사용
          if (capturedData.playlist) {
            console.log('[숲토킹] 캡처된 플레이리스트로 다운로드:', capturedData.playlist);

            await ensureOffscreenDocument();

            // offscreen document로 메시지 전송
            const capturedDlResult = await sendMessageToOffscreen({
              type: 'START_HLS_DOWNLOAD',
              options: {
                streamerId: message.streamerId,
                broadNo: message.broadNo,
                nickname: message.nickname,
                title: message.title,
                m3u8Url: capturedData.playlist,
                baseUrl: capturedData.baseUrl,
                quality: message.quality || 'original',
                isBackgroundDownload: false
              }
            });

            console.log('[숲토킹] offscreen 응답:', capturedDlResult);

            if (capturedDlResult && capturedDlResult.success) {
              state.downloads.push({
                sessionId: capturedDlResult.sessionId,
                streamerId: message.streamerId,
                nickname: message.nickname,
                isRunning: true,
                isBackgroundDownload: false,
                startTime: Date.now()
              });
            }
            sendResponse(capturedDlResult);
          } else {
            sendResponse({
              success: false,
              error: '플레이리스트 URL을 찾을 수 없습니다. 방송 페이지를 새로고침하고 다시 시도해주세요.'
            });
          }
          break;

        case 'DEBUG_CAPTURED_URLS':
          // 디버그: 현재 캡처 상태 확인
          const allCaptured = {};
          capturedMediaUrls.forEach((value, key) => {
            allCaptured[key] = {
              playlist: value.playlist,
              segmentCount: value.segments.length,
              timestamp: value.timestamp
            };
          });
          console.log('[숲토킹] 전체 캡처 상태:', allCaptured);
          sendResponse({ success: true, data: allCaptured });
          break;

        case 'FETCH_STREAM_URL':
          // Content Script에서 요청 - CORS 우회용
          const streamUrlResult = await fetchStreamUrl(message.streamerId, message.broadNo);
          sendResponse(streamUrlResult);
          break;

        case 'FETCH_STREAM_INFO':
          // sidepanel에서 방송 정보 요청
          const streamInfoResult = await fetchStreamUrl(message.streamerId, message.broadNo);
          sendResponse(streamInfoResult);
          break;

        case 'START_DOWNLOAD_FROM_TAB':
          console.log('[숲토킹] ========== 다운로드 요청 시작 ==========');
          console.log('[숲토킹] 요청 데이터:', message);

          const dlStreamerId = message.streamerId;
          const dlBroadNo = message.broadNo;

          if (!dlStreamerId) {
            sendResponse({ success: false, error: '스트리머 ID가 없습니다.' });
            break;
          }

          // 직접 m3u8 URL 탐색
          console.log('[숲토킹] m3u8 URL 직접 탐색 시작...');
          const probeResult = await probeM3u8Url(dlStreamerId, dlBroadNo);

          if (!probeResult.success) {
            console.log('[숲토킹] ❌ m3u8 탐색 실패:', probeResult.error);
            sendResponse({
              success: false,
              error: probeResult.error || '방송 스트림을 찾을 수 없습니다.'
            });
            break;
          }

          console.log('[숲토킹] ✅ m3u8 URL 확보:', probeResult.m3u8Url);

          // Offscreen document로 다운로드 시작
          await ensureOffscreenDocument();

          const dlStartResult = await sendMessageToOffscreen({
            type: 'START_HLS_DOWNLOAD',
            options: {
              streamerId: dlStreamerId,
              broadNo: probeResult.broadNo || dlBroadNo,
              nickname: message.nickname || dlStreamerId,
              title: message.title || '',
              m3u8Url: probeResult.m3u8Url,
              baseUrl: probeResult.baseUrl,
              quality: message.quality || 'original',
              isBackgroundDownload: false
            }
          });

          console.log('[숲토킹] Offscreen 응답:', dlStartResult);

          if (dlStartResult && dlStartResult.success) {
            state.downloads.push({
              sessionId: dlStartResult.sessionId,
              streamerId: dlStreamerId,
              nickname: message.nickname || dlStreamerId,
              isRunning: true,
              isBackgroundDownload: false,
              startTime: Date.now()
            });
          }

          sendResponse(dlStartResult || { success: false, error: 'Offscreen 응답 없음' });
          break;

        case 'START_DOWNLOAD':
          await ensureOffscreenDocument();
          const startResult = await sendMessageToOffscreen({
            type: 'START_HLS_DOWNLOAD',
            options: message.options
          });
          if (startResult && startResult.success) {
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
          const stopResult = await sendMessageToOffscreen({
            type: 'STOP_HLS_DOWNLOAD',
            sessionId: message.sessionId
          });
          if (stopResult && stopResult.success) {
            const idx = state.downloads.findIndex(d => d.sessionId === message.sessionId);
            if (idx !== -1) state.downloads.splice(idx, 1);
          }
          sendResponse(stopResult);
          break;

        case 'GET_ALL_DOWNLOADS':
          await ensureOffscreenDocument();
          try {
            const dlResult = await sendMessageToOffscreen({ type: 'GET_ALL_DOWNLOAD_STATUS' });
            sendResponse({ success: true, data: dlResult?.data || [] });
          } catch (e) {
            sendResponse({ success: true, data: state.downloads });
          }
          break;

        case 'GET_STORAGE_INFO':
          await ensureOffscreenDocument();
          try {
            const storageResult = await sendMessageToOffscreen({ type: 'GET_STORAGE_INFO' });
            sendResponse(storageResult);
          } catch (e) {
            sendResponse({ success: false, error: e.message });
          }
          break;

        case 'M3U8_CAPTURED':
          state.capturedM3u8[message.data.streamerId] = message.data;
          console.log(`[숲토킹] m3u8 캡처됨: ${message.data.streamerId}`);
          sendResponse({ success: true });
          break;

        case 'M3U8_URL_FROM_HOOK':
          // Content Script Hook에서 캡처한 m3u8 URL 저장
          console.log('[숲토킹] 🎣 Hook에서 m3u8 URL 수신!');
          console.log('[숲토킹] URL:', message.data.m3u8Url);
          console.log('[숲토킹] Source:', message.data.source);
          
          // sender.tab.id를 사용하여 탭 ID 확인
          const hookTabId = sender.tab?.id;
          console.log('[숲토킹] Tab ID:', hookTabId);
          
          if (hookTabId && message.data.m3u8Url) {
            if (!capturedMediaUrls.has(hookTabId)) {
              capturedMediaUrls.set(hookTabId, {
                playlist: null,
                baseUrl: null,
                segments: [],
                timestamp: Date.now()
              });
            }
            
            const hookTabData = capturedMediaUrls.get(hookTabId);
            hookTabData.playlist = message.data.m3u8Url;
            hookTabData.baseUrl = message.data.baseUrl || message.data.m3u8Url.substring(0, message.data.m3u8Url.lastIndexOf('/') + 1);
            hookTabData.timestamp = Date.now();
            hookTabData.source = message.data.source;
            
            console.log('[숲토킹] ✅ Hook에서 캡처한 m3u8 저장 완료! tabId:', hookTabId);
            console.log('[숲토킹] 📋 현재 캡처된 탭 목록:', Array.from(capturedMediaUrls.keys()));
          }
          
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
            // 🔒 보안: 파일명 sanitization
            const safeDownloadName = sanitizeFilename(message.data.fileName);
            chrome.downloads.download({
              url: message.data.blobUrl,
              filename: `SOOPtalking/${safeDownloadName}`,
              saveAs: false
            }).catch(e => console.error('[숲토킹] 다운로드 오류:', e));
          }
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_COMPLETED',
            data: message.data
          }).catch(() => {});
          sendResponse({ success: true });
          break;

        case 'SIDEPANEL_RECORDING_COMMAND':
          // Sidepanel에서 녹화 명령어 - 탭별 다중 녹화 지원
          console.log('[숲토킹] SIDEPANEL_RECORDING_COMMAND:', message.command, 'tabId:', message.tabId);

          // GET_STATUS - 특정 탭의 녹화 상태 반환
          if (message.command === 'GET_STATUS') {
            const tabRecording = message.tabId ? state.activeRecordings.get(message.tabId) : null;
            sendResponse({
              success: true,
              result: tabRecording ? {
                isRecording: true,
                streamerId: tabRecording.streamerId,
                nickname: tabRecording.nickname,
                tabId: message.tabId,
                duration: Date.now() - tabRecording.startTime,
                totalBytes: tabRecording.totalBytes || 0
              } : {
                isRecording: false
              }
            });
            break;
          }

          // GET_ALL_RECORDINGS - 모든 녹화 상태 반환
          if (message.command === 'GET_ALL_RECORDINGS') {
            const allRecordings = [];
            state.activeRecordings.forEach((recording, tabId) => {
              allRecordings.push({
                tabId,
                ...recording,
                duration: Date.now() - recording.startTime
              });
            });
            sendResponse({ success: true, recordings: allRecordings });
            break;
          }

          if (!message.tabId) {
            sendResponse({ success: false, error: '탭 ID가 없습니다.' });
            break;
          }

          const targetTabId = message.tabId;

          // START_RECORDING
          if (message.command === 'START_RECORDING') {
            // 이 탭에서 이미 녹화 중인지 확인
            if (state.activeRecordings.has(targetTabId)) {
              const existing = state.activeRecordings.get(targetTabId);
              sendResponse({
                success: false,
                error: `이 탭에서 이미 ${existing.nickname || existing.streamerId} 녹화 중입니다.`
              });
              break;
            }

            // 녹화 상태 설정
            const newRecording = {
              streamerId: message.params?.streamerId || 'unknown',
              nickname: message.params?.nickname || message.params?.streamerId || 'unknown',
              startTime: Date.now(),
              totalBytes: 0
            };
            state.activeRecordings.set(targetTabId, newRecording);

            // 즉시 성공 응답
            sendResponse({ success: true, message: '녹화 시작 요청됨' });

            // 비동기로 실제 명령 전달 (Content Script 주입 포함)
            (async () => {
              let retryCount = 0;
              const maxRetries = 2;

              while (retryCount <= maxRetries) {
                try {
                  console.log(`[숲토킹] START_RECORDING 시도 ${retryCount + 1}/${maxRetries + 1}, tabId:`, targetTabId);

                  await chrome.tabs.sendMessage(targetTabId, {
                    type: 'RECORDING_COMMAND',
                    command: 'START_RECORDING',
                    params: message.params
                  });

                  // 성공 이벤트 브로드캐스트
                  console.log('[숲토킹] ✅ START_RECORDING 성공, tabId:', targetTabId);
                  updateRecordingBadge();  // 뱃지 업데이트
                  chrome.runtime.sendMessage({
                    type: 'RECORDING_STARTED',
                    data: { tabId: targetTabId, ...newRecording }
                  }).catch(() => {});
                  return;  // 성공 시 종료

                } catch (error) {
                  console.error(`[숲토킹] START_RECORDING 시도 ${retryCount + 1} 실패:`, error.message);

                  // Content Script가 없는 경우 주입 시도
                  if (error.message?.includes('Receiving end does not exist') ||
                      error.message?.includes('Could not establish connection')) {

                    if (retryCount < maxRetries) {
                      console.log('[숲토킹] Content Script 주입 시도...');
                      try {
                        await chrome.scripting.executeScript({
                          target: { tabId: targetTabId },
                          files: ['content.js']
                        });
                        await chrome.scripting.executeScript({
                          target: { tabId: targetTabId },
                          files: ['audio-hook.js'],
                          world: 'MAIN'
                        });
                        console.log('[숲토킹] Content Script 주입 완료, 1초 대기...');
                        await new Promise(r => setTimeout(r, 1000));
                        retryCount++;
                        continue;  // 재시도

                      } catch (injectError) {
                        console.error('[숲토킹] Script 주입 실패:', injectError.message);
                      }
                    }
                  }

                  // 최종 실패
                  console.error('[숲토킹] START_RECORDING 최종 실패');
                  state.activeRecordings.delete(targetTabId);  // 롤백
                  updateRecordingBadge();  // 뱃지 업데이트

                  chrome.runtime.sendMessage({
                    type: 'RECORDING_ERROR',
                    data: {
                      tabId: targetTabId,
                      error: '녹화 시작 실패: 페이지를 새로고침한 후 다시 시도해주세요.'
                    }
                  }).catch(() => {});
                  return;
                }
              }
            })();
            break;
          }

          // STOP_RECORDING
          if (message.command === 'STOP_RECORDING') {
            // 이 탭에서 녹화 중인지 확인
            if (!state.activeRecordings.has(targetTabId)) {
              sendResponse({ success: false, error: '이 탭에서 녹화 중이 아닙니다.' });
              break;
            }

            const recordingInfo = { tabId: targetTabId, ...state.activeRecordings.get(targetTabId) };

            // 즉시 성공 응답
            sendResponse({ success: true, message: '녹화 중지 요청됨' });

            // 비동기로 실제 명령 전달
            (async () => {
              try {
                await chrome.tabs.sendMessage(targetTabId, {
                  type: 'RECORDING_COMMAND',
                  command: 'STOP_RECORDING'
                });
                // 상태 초기화는 RECORDING_STOPPED_FROM_HOOK 이벤트에서 처리
              } catch (error) {
                console.error('[숲토킹] STOP_RECORDING 전달 실패:', error.message);
                // 에러여도 상태 초기화 (녹화 탭이 닫혔을 수 있음)
                state.activeRecordings.delete(targetTabId);

                chrome.runtime.sendMessage({
                  type: 'RECORDING_STOPPED',
                  data: { ...recordingInfo, error: error.message }
                }).catch(() => {});
              }
            })();
            break;
          }

          sendResponse({ success: false, error: '알 수 없는 명령' });
          break;

        case 'START_RECORDING':
          // 직접 START_RECORDING 메시지 처리 (재시도용)
          const startTargetTabId = message.tabId;
          const startRetryCount = message.retryCount || 0;
          const START_MAX_RETRIES = 3;

          console.log('[숲토킹] START_RECORDING 시도', startRetryCount + 1, 'tabId:', startTargetTabId);

          if (!startTargetTabId) {
            sendResponse({ success: false, error: 'tabId가 없습니다.' });
            break;
          }

          try {
            // 탭 확인
            let startTab;
            try {
              startTab = await chrome.tabs.get(startTargetTabId);
            } catch {
              sendResponse({ success: false, error: '탭을 찾을 수 없습니다.' });
              break;
            }

            if (!startTab.url?.includes('play.sooplive.co.kr')) {
              sendResponse({ success: false, error: 'SOOP 방송 페이지가 아닙니다.' });
              break;
            }

            // Content script에 명령 전달
            let startResponse;
            try {
              startResponse = await chrome.tabs.sendMessage(startTargetTabId, {
                type: 'RECORDING_COMMAND',
                command: 'START_RECORDING',
                params: { streamerId: message.streamerId, nickname: message.nickname }
              });
            } catch (msgError) {
              console.warn('[숲토킹] 메시지 전송 실패:', msgError.message);

              // Content script 없으면 주입 후 재시도
              if (startRetryCount < START_MAX_RETRIES &&
                  (msgError.message?.includes('Receiving end') || msgError.message?.includes('Could not establish'))) {

                console.log('[숲토킹] Script 주입 후 재시도...');

                try {
                  await chrome.scripting.executeScript({
                    target: { tabId: startTargetTabId },
                    files: ['content.js']
                  });
                  await chrome.scripting.executeScript({
                    target: { tabId: startTargetTabId },
                    files: ['audio-hook.js'],
                    world: 'MAIN'
                  });

                  await new Promise(r => setTimeout(r, 500));

                  const retryResult = await new Promise(resolve => {
                    chrome.runtime.sendMessage({
                      type: 'START_RECORDING',
                      tabId: startTargetTabId,
                      streamerId: message.streamerId,
                      nickname: message.nickname,
                      retryCount: startRetryCount + 1
                    }, resolve);
                  });

                  sendResponse(retryResult);
                  break;
                } catch (injectErr) {
                  sendResponse({ success: false, error: 'Script 주입 실패' });
                  break;
                }
              }

              sendResponse({ success: false, error: '페이지를 새로고침 후 다시 시도해주세요.' });
              break;
            }

            // 성공 처리
            if (startResponse?.success) {
              const newStartRecording = {
                tabId: startTargetTabId,
                streamerId: message.streamerId,
                nickname: message.nickname,
                startTime: Date.now(),
                totalBytes: 0
              };
              state.activeRecordings.set(startTargetTabId, newStartRecording);

              chrome.runtime.sendMessage({
                type: 'RECORDING_STARTED',
                data: { tabId: startTargetTabId, ...newStartRecording }
              }).catch(() => {});

              sendResponse({ success: true, data: newStartRecording });
            } else {
              sendResponse({ success: false, error: startResponse?.error || '녹화 시작 실패' });
            }
          } catch (error) {
            console.error('[숲토킹] START_RECORDING 오류:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_RECORDING_STATE':
          // sidepanel 초기화용 - 특정 탭 또는 전체 녹화 상태 반환
          if (message.tabId) {
            const tabRec = state.activeRecordings.get(message.tabId);
            sendResponse({
              success: true,
              data: tabRec ? { tabId: message.tabId, ...tabRec } : null
            });
          } else {
            // 모든 녹화 상태
            const all = [];
            state.activeRecordings.forEach((rec, tid) => {
              all.push({ tabId: tid, ...rec });
            });
            sendResponse({ success: true, data: all.length > 0 ? all : null });
          }
          break;

        case 'GET_ALL_RECORDINGS':
          // 모든 활성 녹화 목록 반환
          try {
            const allRecordings = [];
            if (state.activeRecordings && state.activeRecordings.size > 0) {
              for (const [tabId, recording] of state.activeRecordings) {
                allRecordings.push({
                  tabId: tabId,
                  streamerId: recording.streamerId,
                  nickname: recording.nickname,
                  startTime: recording.startTime,
                  totalBytes: recording.totalBytes || 0,
                  isRecording: true
                });
              }
            }
            console.log('[숲토킹] GET_ALL_RECORDINGS 응답:', allRecordings.length, '개');
            sendResponse({ success: true, data: allRecordings });
          } catch (error) {
            console.error('[숲토킹] GET_ALL_RECORDINGS 오류:', error);
            sendResponse({ success: false, error: error.message, data: [] });
          }
          break;

        case 'STOP_RECORDING':
          // 특정 탭의 녹화 중지
          const stopTabId = message.tabId;
          console.log('[숲토킹] STOP_RECORDING 요청, tabId:', stopTabId);

          // tabId 타입 및 범위 검증
          if (typeof stopTabId !== 'number' || stopTabId <= 0) {
            sendResponse({ success: false, error: '유효하지 않은 탭 ID입니다.' });
            break;
          }

          if (!state.activeRecordings.has(stopTabId)) {
            sendResponse({ success: false, error: '이 탭에서 녹화 중이 아닙니다.' });
            break;
          }

          const stopRecordingInfo = { tabId: stopTabId, ...state.activeRecordings.get(stopTabId) };

          // 즉시 응답
          sendResponse({ success: true, message: '녹화 중지 요청됨' });

          // 비동기로 실제 중지 명령 전달
          (async () => {
            try {
              await chrome.tabs.sendMessage(stopTabId, {
                type: 'RECORDING_COMMAND',
                command: 'STOP_RECORDING'
              });
              console.log('[숲토킹] STOP_RECORDING 명령 전달 완료:', stopTabId);
            } catch (error) {
              console.error('[숲토킹] STOP_RECORDING 전달 실패:', error.message);
              // 에러여도 상태 정리 (탭이 닫혔을 수 있음)
              state.activeRecordings.delete(stopTabId);
              updateRecordingBadge();

              chrome.runtime.sendMessage({
                type: 'RECORDING_STOPPED',
                data: { ...stopRecordingInfo, error: error.message }
              }).catch(() => {});
            }
          })();
          break;

        case 'RECORDING_STOPPED_FROM_HOOK':
          // audio-hook에서 녹화 완료 이벤트
          console.log('[숲토킹] 녹화 완료 이벤트:', message.data);

          // sender.tab.id로 어느 탭에서 왔는지 확인
          const stoppedTabId = sender.tab?.id || message.data?.tabId;
          const completedRecording = stoppedTabId ? state.activeRecordings.get(stoppedTabId) : null;

          if (stoppedTabId) {
            state.activeRecordings.delete(stoppedTabId);  // 상태 초기화
            updateRecordingBadge();  // 뱃지 업데이트
          }

          // sidepanel에 브로드캐스트
          chrome.runtime.sendMessage({
            type: 'RECORDING_STOPPED',
            data: {
              tabId: stoppedTabId,
              ...completedRecording,
              ...message.data
            }
          }).catch(() => {});

          sendResponse({ success: true });
          break;

        case 'RECORDING_PROGRESS_FROM_HOOK':
          // audio-hook에서 진행 상황 업데이트 (10초마다)
          const progressTabId = sender.tab?.id;
          if (progressTabId && state.activeRecordings.has(progressTabId)) {
            const rec = state.activeRecordings.get(progressTabId);
            rec.totalBytes = message.data.totalBytes || 0;

            // sidepanel에 진행 상황 브로드캐스트
            chrome.runtime.sendMessage({
              type: 'RECORDING_PROGRESS',
              data: {
                tabId: progressTabId,
                totalBytes: message.data.totalBytes,
                duration: message.data.duration
              }
            }).catch(() => {});
          }
          sendResponse({ success: true });
          break;

        case 'RECORDING_ERROR_FROM_HOOK':
          // audio-hook에서 에러 발생
          console.error('[숲토킹] 녹화 에러:', message.data);
          const errorTabId = sender.tab?.id || message.data?.tabId;

          if (errorTabId) {
            state.activeRecordings.delete(errorTabId);
            updateRecordingBadge();  // 뱃지 업데이트
          }

          chrome.runtime.sendMessage({
            type: 'RECORDING_ERROR',
            data: { tabId: errorTabId, ...message.data }
          }).catch(() => {});

          sendResponse({ success: true });
          break;


        case 'SAVE_FINAL_RECORDING':
          // 최종 녹화 파일 저장 요청
          console.log('[숲토킹] 💾 최종 녹화 저장 요청:', message.data.filename);
          console.log('[숲토킹] 크기:', (message.data.size / 1024 / 1024).toFixed(2), 'MB');

          try {
            const recordingData = message.data;

            // blob URL을 사용하여 다운로드
            // 🔒 보안: 파일명 sanitization
            const safeFilename = sanitizeFilename(recordingData.filename);

            if (recordingData.blobUrl) {
              await chrome.downloads.download({
                url: recordingData.blobUrl,
                filename: `SOOPtalking/${safeFilename}`,
                saveAs: false
              });

              console.log('[숲토킹] ✅ 녹화 파일 저장 완료:', safeFilename);
            }

            sendResponse({ success: true });
          } catch (recordingError) {
            console.error('[숲토킹] 녹화 저장 오류:', recordingError);
            sendResponse({ success: false, error: recordingError.message });
          }
          break;

        case 'RECORDING_COMPLETE':
          // 녹화 완료
          console.log('[숲토킹] 🎬 녹화 완료:', message.data);

          // 완료 알림 표시
          try {
            const sizeMB = (message.data.totalBytes / 1024 / 1024).toFixed(2);
            const durationMin = message.data.duration ? (message.data.duration / 60).toFixed(1) : '0';

            await chrome.notifications.create(`recording_complete_${Date.now()}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: '🎬 녹화 완료',
              message: `${message.data.streamerId} - ${durationMin}분, ${sizeMB} MB`,
              priority: 1
            });
          } catch (e) {}

          // sidepanel에 알림 (녹화 상태 업데이트)
          chrome.runtime.sendMessage({
            type: 'RECORDING_COMPLETED',
            data: message.data
          }).catch(() => {});

          sendResponse({ success: true });
          break;

        case 'RECORDING_ERROR':
          // 녹화 에러
          console.error('[숲토킹] ❌ 녹화 에러:', message.data.error);

          // 에러 알림
          try {
            await chrome.notifications.create(`recording_error_${Date.now()}`, {
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: '⚠️ 녹화 오류',
              message: message.data.error || '알 수 없는 오류가 발생했습니다.',
              priority: 2
            });
          } catch (e) {}

          // sidepanel에 알림
          chrome.runtime.sendMessage({
            type: 'RECORDING_ERROR',
            data: message.data
          }).catch(() => {});

          sendResponse({ success: true });
          break;

        case 'PROXY_FETCH':
          // Offscreen 대신 Background에서 fetch 수행 (DNS 문제 우회)
          try {
            // 🔒 보안: 도메인 화이트리스트 검증
            if (!message.url || !isAllowedDomain(message.url)) {
              console.warn('[숲토킹] PROXY_FETCH 차단 - 허용되지 않은 도메인:', message.url);
              sendResponse({ success: false, error: '허용되지 않은 도메인입니다.' });
              break;
            }

            console.log('[숲토킹] PROXY_FETCH 요청:', message.url.substring(0, 80));

            const proxyResponse = await fetch(message.url, {
              credentials: 'include',
              headers: {
                'Origin': 'https://play.sooplive.co.kr',
                'Referer': 'https://play.sooplive.co.kr/'
              }
            });

            if (!proxyResponse.ok) {
              sendResponse({ success: false, error: `HTTP ${proxyResponse.status}` });
              break;
            }

            // 응답 타입에 따라 처리
            if (message.responseType === 'text') {
              const text = await proxyResponse.text();
              sendResponse({ success: true, data: text });
            } else {
              // arraybuffer -> base64로 변환해서 전달
              const buffer = await proxyResponse.arrayBuffer();
              const bytes = new Uint8Array(buffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
              }
              const base64 = btoa(binary);
              sendResponse({ success: true, data: base64, isBase64: true });
            }
          } catch (error) {
            console.error('[숲토킹] PROXY_FETCH 오류:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'SIDEPANEL_CLOSED':
          // 사이드패널이 닫혔을 때 상태 업데이트
          const closedWindowId = message.windowId;
          if (closedWindowId) {
            sidePanelOpen[closedWindowId] = false;
          }
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

// ===== 아이콘 클릭 시 사이드패널 토글 =====
let sidePanelOpen = {};  // windowId별 사이드패널 상태

chrome.action.onClicked.addListener(async (tab) => {
  const windowId = tab.windowId;

  try {
    if (sidePanelOpen[windowId]) {
      // 사이드패널이 열려있으면 닫기 메시지 전송
      chrome.runtime.sendMessage({ type: 'CLOSE_SIDEPANEL' }).catch(() => {});
      sidePanelOpen[windowId] = false;
    } else {
      // 사이드패널 열기
      await chrome.sidePanel.open({ windowId });
      sidePanelOpen[windowId] = true;
    }
  } catch (error) {
    // 오류 시 상태 리셋하고 열기 시도
    console.error('[숲토킹] 사이드패널 토글 오류:', error);
    try {
      await chrome.sidePanel.open({ windowId });
      sidePanelOpen[windowId] = true;
    } catch (e) {}
  }
});


console.log('[숲토킹] 백그라운드 서비스 워커 v2.0 로드됨');
