// ===== 숲토킹 - SOOP 스트리머 방송 알림 확장 프로그램 =====
// background.js - 백그라운드 서비스 워커
// v1.7.3 - 알림만 스트리머 탭 자동 종료 버그 수정

// ===== i18n 헬퍼 함수 =====
function i18n(key, substitutions = []) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

// 상수 정의
const MONITORING_CHECK_INTERVAL = 5000;   // 자동참여 스트리머 체크 주기 (5초)
const NOTIFY_CHECK_INTERVAL = 30000;      // 알림만 스트리머 체크 주기 (30초)
const TAB_CHECK_INTERVAL = 30000;         // 탭 실행 상태 점검 주기 (30초)
const REQUEST_DELAY = 300;                // 각 API 요청 사이 딜레이 (ms) - 서버 부하 방지
const DEFAULT_NOTIFICATION_DURATION = 10; // 기본 알림 표시 시간 (초)

// 상태 저장 객체
let state = {
  favoriteStreamers: [],      // 즐겨찾기 스트리머 목록
  monitoringStreamers: [],    // 모니터링 중인 스트리머 ID 목록 (자동참여)
  openedTabs: {},             // 열린 탭 정보 { streamerId: tabId }
  broadcastStatus: {},        // 방송 상태 { streamerId: { isLive, broadNo, lastChecked } }
  runningTabs: {},            // 탭 실행 상태 { streamerId: boolean }
  isMonitoring: false,        // 모니터링 활성화 여부
  // 알림 설정
  notificationEnabled: true,       // 방송 시작 알림 활성화 여부
  notificationDuration: DEFAULT_NOTIFICATION_DURATION,  // 알림 표시 시간 (초)
  endNotificationEnabled: false,   // 방송 종료 알림 활성화 여부
  autoCloseOfflineTabs: true       // 오프라인 탭 자동 종료 여부
};

// 타이머 ID
let monitoringTimeoutId = null;  // 자동참여 스트리머용 (5초)
let notifyTimeoutId = null;      // 알림만 스트리머용 (30초)
let tabCheckTimeoutId = null;    // 탭 점검용 (30초)

// 상태 로드 완료 여부
let stateLoaded = false;

// ===== 초기화 =====
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[숲토킹] 확장 프로그램이 설치되었습니다.');
  await loadState();
});

// 서비스 워커 시작 시 상태 복원
chrome.runtime.onStartup.addListener(async () => {
  console.log('[숲토킹] 브라우저가 시작되었습니다.');
  await loadState();
  // ★ 브라우저 재시작 시 방송 상태 초기화 (실제 API로 다시 확인하도록)
  state.broadcastStatus = {};
  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ★ 중요: Service Worker가 깨어날 때마다 상태 로드
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
      monitoringStreamers: state.monitoringStreamers,
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
      'monitoringStreamers',
      'isMonitoring',
      'notificationEnabled',
      'notificationDuration',
      'endNotificationEnabled',
      'autoCloseOfflineTabs',
      'broadcastStatus'
    ]);
    
    state.favoriteStreamers = data.favoriteStreamers || [];
    state.monitoringStreamers = data.monitoringStreamers || [];
    state.isMonitoring = data.isMonitoring || false;
    state.notificationEnabled = data.notificationEnabled !== undefined ? data.notificationEnabled : true;
    state.notificationDuration = data.notificationDuration || DEFAULT_NOTIFICATION_DURATION;
    state.endNotificationEnabled = data.endNotificationEnabled || false;
    state.autoCloseOfflineTabs = data.autoCloseOfflineTabs !== undefined ? data.autoCloseOfflineTabs : true;
    state.broadcastStatus = data.broadcastStatus || {};
    stateLoaded = true;
    
    console.log('[숲토킹] 상태 불러오기 완료:', {
      favorites: state.favoriteStreamers.length,
      monitoring: state.monitoringStreamers.length,
      isMonitoring: state.isMonitoring,
      savedStatuses: Object.keys(state.broadcastStatus).length
    });
  } catch (error) {
    console.error('[숲토킹] 상태 불러오기 오류:', error);
    stateLoaded = true;
  }
}

// 상태가 로드될 때까지 대기하는 헬퍼 함수
async function ensureStateLoaded() {
  if (stateLoaded) return;
  await loadState();
}

// ===== 유틸리티 함수 =====

// 딜레이 함수
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 스트리머 닉네임 업데이트 함수 (중복 코드 제거)
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

// ★ 스트리머 방송 URL이 이미 열려있는지 확인하는 함수
async function findExistingBroadcastTab(streamerId) {
  try {
    // play.sooplive.co.kr/{streamerId} 패턴의 탭 검색
    const tabs = await chrome.tabs.query({
      url: [
        `https://play.sooplive.co.kr/${streamerId}/*`,
        `https://play.sooplive.co.kr/${streamerId}`
      ]
    });
    
    if (tabs.length > 0) {
      console.log(`[숲토킹] ${streamerId} 방송 탭이 이미 열려있습니다. (탭 ID: ${tabs[0].id})`);
      return tabs[0];
    }
    
    return null;
  } catch (error) {
    console.error(`[숲토킹] 탭 검색 오류:`, error);
    return null;
  }
}

// ★ 현재 열린 모든 SOOP 방송 탭 수 확인 (4개 제한 체크용)
const MAX_SOOP_TABS = 4;  // SOOP 동시 시청 제한

async function countCurrentBroadcastTabs() {
  try {
    // play.sooplive.co.kr 의 모든 방송 탭 검색
    const tabs = await chrome.tabs.query({
      url: 'https://play.sooplive.co.kr/*'
    });
    
    console.log(`[숲토킹] 현재 열린 SOOP 방송 탭: ${tabs.length}개`);
    return tabs.length;
  } catch (error) {
    console.error('[숲토킹] 방송 탭 수 확인 오류:', error);
    return 0;
  }
}

// ===== 탭 실행 상태 점검 (30초마다) =====

// 모든 즐겨찾기 스트리머의 탭 실행 상태 확인
async function checkAllRunningTabs() {
  if (!state.isMonitoring) return;
  
  console.log('[숲토킹] 탭 실행 상태 점검 중...');
  
  // 각 즐겨찾기 스트리머의 탭 실행 상태 확인
  for (const streamer of state.favoriteStreamers) {
    const streamerId = streamer.id;
    const existingTab = await findExistingBroadcastTab(streamerId);
    state.runningTabs[streamerId] = !!existingTab;
    
    // openedTabs도 동기화
    if (existingTab) {
      state.openedTabs[streamerId] = existingTab.id;
    }
  }
  
  // 오프라인 스트리머 탭 자동 종료
  if (state.autoCloseOfflineTabs) {
    await closeOfflineStreamerTabs();
    await closeVodAutoplayTabs();
  }
  
  console.log('[숲토킹] 탭 실행 상태:', state.runningTabs);
}

// 오프라인 스트리머의 방송 탭 종료
// ★ 자동참여(monitoringStreamers) 스트리머만 대상으로 함
// ★ 알림만 스트리머는 탭 자동 종료 대상에서 제외
async function closeOfflineStreamerTabs() {
  for (const streamer of state.favoriteStreamers) {
    const streamerId = streamer.id;

    // ★ 자동참여 스트리머가 아니면 건너뛰기 (알림만 스트리머는 탭 자동 종료 제외)
    if (!state.monitoringStreamers.includes(streamerId)) {
      continue;
    }

    const broadcastStatus = state.broadcastStatus[streamerId];

    // ★ broadcastStatus가 없으면 아직 API 체크 전이므로 건너뛰기
    if (!broadcastStatus) {
      continue;
    }

    // 오프라인 상태인 스트리머 (자동참여만)
    if (!broadcastStatus.isLive) {
      try {
        // 해당 스트리머의 방송 탭 찾기
        const tabs = await chrome.tabs.query({
          url: [
            `https://play.sooplive.co.kr/${streamerId}/*`,
            `https://play.sooplive.co.kr/${streamerId}`
          ]
        });

        // 탭 종료
        for (const tab of tabs) {
          console.log(`[숲토킹] 오프라인 스트리머 ${streamerId} 탭 종료 (탭 ID: ${tab.id})`);
          await chrome.tabs.remove(tab.id);
        }

        // 상태 업데이트
        if (tabs.length > 0) {
          delete state.openedTabs[streamerId];
          state.runningTabs[streamerId] = false;
        }
      } catch (error) {
        console.error(`[숲토킹] 오프라인 탭 종료 오류 (${streamerId}):`, error);
      }
    }
  }
}

// VOD 자동재생 탭 종료 (방송 종료 후 리다이렉트되는 다시보기)
async function closeVodAutoplayTabs() {
  try {
    // vod.sooplive.co.kr URL 중 autoplay가 포함된 탭 찾기
    const allTabs = await chrome.tabs.query({
      url: 'https://vod.sooplive.co.kr/*'
    });
    
    for (const tab of allTabs) {
      // URL에 autoplay가 포함되어 있는지 확인
      if (tab.url && tab.url.includes('autoplay')) {
        console.log(`[숲토킹] VOD 자동재생 탭 종료: ${tab.url}`);
        try {
          await chrome.tabs.remove(tab.id);
        } catch (e) {
          // 탭이 이미 닫혔을 수 있음
        }
      }
    }
  } catch (error) {
    console.error('[숲토킹] VOD 자동재생 탭 종료 오류:', error);
  }
}

// 탭 점검 스케줄링 (30초)
function scheduleTabCheck() {
  if (!state.isMonitoring) return;
  
  tabCheckTimeoutId = setTimeout(async () => {
    await checkAllRunningTabs();
    scheduleTabCheck();
  }, TAB_CHECK_INTERVAL);
}

// ===== 알림 기능 =====

// 방송 시작 알림 표시
async function showBroadcastNotification(streamerId, nickname, title, broadNo) {
  if (!state.notificationEnabled) {
    console.log(`[숲토킹] 알림이 비활성화되어 있어 ${streamerId} 알림을 표시하지 않습니다.`);
    return;
  }

  // ★ 이미 해당 방송 탭이 열려있으면 알림 표시하지 않음
  const existingTab = await findExistingBroadcastTab(streamerId);
  if (existingTab) {
    console.log(`[숲토킹] ${streamerId} 방송을 이미 시청 중이므로 알림을 표시하지 않습니다.`);
    return;
  }

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

    // 알림 데이터 저장 (클릭 시 사용)
    await chrome.storage.local.set({
      [`notification_${notificationId}`]: {
        streamerId,
        broadNo,
        timestamp: Date.now()
      }
    });

    // 설정된 시간 후 알림 자동 닫기
    setTimeout(async () => {
      try {
        await chrome.notifications.clear(notificationId);
      } catch (e) {
        // 이미 닫혔을 수 있음
      }
    }, state.notificationDuration * 1000);

    console.log(`[숲토킹] ${streamerId} 방송 시작 알림 표시`);
  } catch (error) {
    console.error(`[숲토킹] 알림 생성 오류:`, error);
  }
}

// ★ 방송 종료 알림 표시 (새 기능)
async function showEndNotification(streamerId, nickname) {
  if (!state.endNotificationEnabled) {
    return;
  }

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

    // 설정된 시간 후 알림 자동 닫기
    setTimeout(async () => {
      try {
        await chrome.notifications.clear(notificationId);
      } catch (e) {
        // 이미 닫혔을 수 있음
      }
    }, state.notificationDuration * 1000);

    console.log(`[숲토킹] ${streamerId} 방송 종료 알림 표시`);
  } catch (error) {
    console.error(`[숲토킹] 종료 알림 생성 오류:`, error);
  }
}

// 알림 클릭 핸들러
chrome.notifications.onClicked.addListener(async (notificationId) => {
  try {
    // 저장된 알림 데이터 가져오기
    const data = await chrome.storage.local.get(`notification_${notificationId}`);
    const notificationData = data[`notification_${notificationId}`];
    
    if (notificationData) {
      const { streamerId, broadNo } = notificationData;
      
      // ★ 이미 열린 탭이 있는지 확인
      const existingTab = await findExistingBroadcastTab(streamerId);
      if (existingTab) {
        // 기존 탭 활성화
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
        console.log(`[숲토킹] ${streamerId} 기존 탭 활성화`);
      } else {
        // 새 탭으로 방송 페이지 열기
        const url = broadNo 
          ? `https://play.sooplive.co.kr/${streamerId}/${broadNo}`
          : `https://play.sooplive.co.kr/${streamerId}`;
        
        await chrome.tabs.create({ url, active: true });
        console.log(`[숲토킹] ${streamerId} 알림 클릭 → 방송 페이지 열기`);
      }
      
      // 저장된 데이터 삭제
      await chrome.storage.local.remove(`notification_${notificationId}`);
    }
    
    // 알림 닫기
    await chrome.notifications.clear(notificationId);
  } catch (error) {
    console.error('[숲토킹] 알림 클릭 처리 오류:', error);
  }
});

// 알림 닫힘 핸들러 (데이터 정리)
chrome.notifications.onClosed.addListener(async (notificationId) => {
  try {
    await chrome.storage.local.remove(`notification_${notificationId}`);
  } catch (e) {
    // 무시
  }
});

// ===== 방송 상태 확인 API =====
async function checkBroadcastStatus(streamerId) {
  // 10초 타임아웃 설정
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://live.sooplive.co.kr/afreeca/player_live_api.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Origin': 'https://play.sooplive.co.kr',
        'Referer': 'https://play.sooplive.co.kr/'
      },
      body: `bid=${encodeURIComponent(streamerId)}`,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP 오류: ${response.status}`);
    }

    const data = await response.json();

    // RESULT가 1이면 방송 중, 0이면 방송 중 아님
    const isLive = data.CHANNEL && data.CHANNEL.RESULT === 1;
    const broadNo = isLive ? data.CHANNEL.BNO : null;
    const title = isLive ? data.CHANNEL.TITLE : null;
    const nickname = isLive ? data.CHANNEL.BJNICK : null;

    return {
      isLive,
      broadNo,
      title,
      nickname,
      streamerId
    };
  } catch (error) {
    clearTimeout(timeoutId);
    // 네트워크 에러는 warn으로 처리 (일시적 오류일 수 있음)
    if (error.name === 'AbortError') {
      console.warn(`[숲토킹] ${streamerId} 상태 확인 타임아웃`);
    } else if (error.message === 'Failed to fetch') {
      console.warn(`[숲토킹] ${streamerId} 네트워크 오류 (재시도 예정)`);
    } else {
      console.warn(`[숲토킹] ${streamerId} 상태 확인 실패:`, error.message);
    }
    return {
      isLive: false,
      broadNo: null,
      title: null,
      nickname: null,
      streamerId,
      error: error.message
    };
  }
}

// ===== 탭 관리 =====
async function openBroadcastTab(streamerId, broadNo, nickname, title) {
  // ★ 먼저 URL로 이미 열린 탭이 있는지 확인
  const existingTab = await findExistingBroadcastTab(streamerId);
  if (existingTab) {
    // ★ 탭의 URL에서 방송 번호 추출하여 현재 방송과 비교
    const urlMatch = existingTab.url.match(/play\.sooplive\.co\.kr\/[^\/]+\/(\d+)/);
    const existingBroadNo = urlMatch ? urlMatch[1] : null;

    if (existingBroadNo === String(broadNo)) {
      // 같은 방송 → 기존 탭 활성화
      try {
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
        state.openedTabs[streamerId] = existingTab.id;
        console.log(`[숲토킹] ${streamerId} 같은 방송 탭 활성화 (방송번호: ${broadNo})`);
      } catch (e) {
        console.error(`[숲토킹] 기존 탭 활성화 오류:`, e);
      }
      return { success: true, action: 'activated' };
    } else {
      // 다른 방송 (이전 방송 탭) → 새 탭 열기
      console.log(`[숲토킹] ${streamerId} 이전 방송 탭 발견 (이전: ${existingBroadNo}, 현재: ${broadNo}) → 새 탭 열기`);
      delete state.openedTabs[streamerId];
    }
  }

  // state.openedTabs에서 확인 (위에서 못 찾은 경우)
  if (state.openedTabs[streamerId]) {
    try {
      const tab = await chrome.tabs.get(state.openedTabs[streamerId]);
      if (tab) {
        // ★ 탭의 URL에서 방송 번호 추출하여 현재 방송과 비교
        const urlMatch = tab.url && tab.url.match(/play\.sooplive\.co\.kr\/[^\/]+\/(\d+)/);
        const existingBroadNo = urlMatch ? urlMatch[1] : null;

        if (existingBroadNo === String(broadNo)) {
          // 같은 방송 → 기존 탭 활성화
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          console.log(`[숲토킹] ${streamerId} 같은 방송 탭 활성화 (방송번호: ${broadNo})`);
          return { success: true, action: 'activated' };
        } else {
          // 다른 방송이거나 방송 URL이 아님 → 새 탭 열기
          console.log(`[숲토킹] ${streamerId} 탭이 현재 방송이 아님 → 새 탭 열기`);
          delete state.openedTabs[streamerId];
        }
      }
    } catch (e) {
      // 탭이 존재하지 않음 - 새로 열기
      delete state.openedTabs[streamerId];
    }
  }

  // ★ 새 탭 열기 전에 현재 열린 SOOP 방송 탭 수 확인
  const currentTabCount = await countCurrentBroadcastTabs();
  if (currentTabCount >= MAX_SOOP_TABS) {
    console.log(`[숲토킹] 이미 ${currentTabCount}개 방송 시청 중 → ${streamerId} 알림만 표시`);
    
    // 알림으로 대체
    await showTabLimitNotification(streamerId, nickname, title, broadNo);
    return { success: false, action: 'notification', reason: 'tab_limit' };
  }

  try {
    // 방송 URL 생성
    const url = `https://play.sooplive.co.kr/${streamerId}/${broadNo}`;
    
    // ★ 활성 탭으로 열기
    const tab = await chrome.tabs.create({
      url: url,
      active: true
    });

    state.openedTabs[streamerId] = tab.id;
    state.runningTabs[streamerId] = true;
    console.log(`[숲토킹] ${streamerId} 방송 탭을 열었습니다. (탭 ID: ${tab.id})`);
    return { success: true, action: 'opened' };
  } catch (error) {
    console.error(`[숲토킹] ${streamerId} 탭 열기 오류:`, error);
    return { success: false, action: 'error', reason: error.message };
  }
}

// ★ 탭 제한으로 인한 알림 표시
async function showTabLimitNotification(streamerId, nickname, title, broadNo) {
  const notificationId = `tablimit_${streamerId}_${Date.now()}`;
  
  try {
    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `🔴 ${i18n('notificationBroadcastStartTitle', [nickname || streamerId])}`,
      message: `${title || i18n('notificationBroadcastStartMessage')}\n⚠️ ${i18n('notificationTabLimitWarning')}`,
      priority: 2,
      requireInteraction: false
    });

    // 알림 데이터 저장 (클릭 시 사용)
    await chrome.storage.local.set({
      [`notification_${notificationId}`]: {
        streamerId,
        broadNo,
        timestamp: Date.now()
      }
    });

    // 설정된 시간 후 알림 자동 닫기
    setTimeout(async () => {
      try {
        await chrome.notifications.clear(notificationId);
      } catch (e) {
        // 이미 닫혔을 수 있음
      }
    }, state.notificationDuration * 1000);

    console.log(`[숲토킹] ${streamerId} 탭 제한 알림 표시`);
  } catch (error) {
    console.error(`[숲토킹] 탭 제한 알림 생성 오류:`, error);
  }
}

async function closeBroadcastTab(streamerId) {
  let tabId = state.openedTabs[streamerId];

  // ★ 탭 ID가 없으면 URL 패턴으로 탭 검색 (브라우저 재시작 후 대응)
  if (!tabId) {
    const existingTab = await findExistingBroadcastTab(streamerId);
    if (existingTab) {
      tabId = existingTab.id;
      console.log(`[숲토킹] ${streamerId} 탭을 URL 패턴으로 찾았습니다. (탭 ID: ${tabId})`);
    } else {
      // 탭을 찾을 수 없음
      return;
    }
  }

  try {
    await chrome.tabs.remove(tabId);
    console.log(`[숲토킹] ${streamerId} 방송 탭을 닫았습니다.`);
  } catch (error) {
    // 탭이 이미 닫혔을 수 있음
    console.log(`[숲토킹] ${streamerId} 탭이 이미 닫혀있습니다.`);
  } finally {
    delete state.openedTabs[streamerId];
  }
}

// 탭이 닫힐 때 상태 업데이트
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [streamerId, id] of Object.entries(state.openedTabs)) {
    if (id === tabId) {
      delete state.openedTabs[streamerId];
      console.log(`[숲토킹] ${streamerId} 탭이 수동으로 닫혔습니다.`);
      break;
    }
  }
});

// ===== 자동참여 스트리머 체크 (5초 간격) =====
async function checkMonitoringStreamers() {
  if (!state.isMonitoring || state.monitoringStreamers.length === 0) {
    return;
  }

  console.log(`[숲토킹] 자동참여 스트리머 체크 중... (${state.monitoringStreamers.length}명)`);

  for (let i = 0; i < state.monitoringStreamers.length; i++) {
    const streamerId = state.monitoringStreamers[i];
    const status = await checkBroadcastStatus(streamerId);
    const previousStatus = state.broadcastStatus[streamerId];

    // 방송 상태 변경 확인
    const wasLive = previousStatus && previousStatus.isLive;
    const isNowLive = status.isLive;

    if (isNowLive && !wasLive) {
      // ★ 오프라인 → 방송중: 처음 한 번만 탭 열기 (4개 제한 체크 포함)
      console.log(`[숲토킹] ${streamerId} (${status.nickname}) 방송 시작! → 자동 참여 시도`);
      await openBroadcastTab(streamerId, status.broadNo, status.nickname, status.title);
    } else if (!isNowLive && wasLive) {
      // ★ 방송중 → 오프라인: 방송 종료
      console.log(`[숲토킹] ${streamerId} 방송 종료`);

      // 방송 종료 알림 표시
      const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
      await showEndNotification(streamerId, streamer?.nickname || previousStatus.nickname);

      // ★ autoCloseOfflineTabs 설정이 true일 때만 탭 종료
      if (state.autoCloseOfflineTabs) {
        await closeBroadcastTab(streamerId);
      }
    }

    // ★ 상태 업데이트 및 저장
    state.broadcastStatus[streamerId] = {
      isLive: status.isLive,
      broadNo: status.broadNo,
      nickname: status.nickname,
      title: status.title,
      lastChecked: Date.now()
    };

    // ★ 닉네임 업데이트
    updateStreamerNickname(streamerId, status.nickname);

    // 다음 요청 전 딜레이
    if (i < state.monitoringStreamers.length - 1) {
      await delay(REQUEST_DELAY);
    }
  }

  // ★ 상태 저장 (방송 상태 포함)
  await saveState();
}

// ===== 알림만 스트리머 체크 (30초 간격) =====
async function checkNotifyStreamers() {
  if (!state.isMonitoring) {
    return;
  }

  // 모니터링에 없는 즐겨찾기 스트리머
  const notifyStreamers = state.favoriteStreamers.filter(
    s => !state.monitoringStreamers.includes(s.id)
  );

  if (notifyStreamers.length === 0) {
    return;
  }

  console.log(`[숲토킹] 알림 스트리머 체크 중... (${notifyStreamers.length}명)`);

  for (let i = 0; i < notifyStreamers.length; i++) {
    const streamer = notifyStreamers[i];
    const streamerId = streamer.id;
    
    const status = await checkBroadcastStatus(streamerId);
    const previousStatus = state.broadcastStatus[streamerId];

    // 방송 상태 변경 확인
    const wasLive = previousStatus && previousStatus.isLive;
    const isNowLive = status.isLive;

    if (isNowLive && !wasLive) {
      // ★ 오프라인 → 방송중: 알림 표시 (중복 체크는 showBroadcastNotification 내부에서)
      console.log(`[숲토킹] ${streamerId} (${status.nickname}) 방송 시작! → 알림 표시`);
      await showBroadcastNotification(
        streamerId,
        status.nickname || streamer.nickname,
        status.title,
        status.broadNo
      );
    } else if (!isNowLive && wasLive) {
      // ★ 방송중 → 오프라인: 방송 종료 알림
      console.log(`[숲토킹] ${streamerId} 방송 종료`);
      await showEndNotification(streamerId, streamer.nickname || previousStatus.nickname);
    }

    // ★ 상태 업데이트
    state.broadcastStatus[streamerId] = {
      isLive: status.isLive,
      broadNo: status.broadNo,
      nickname: status.nickname,
      title: status.title,
      lastChecked: Date.now()
    };

    // ★ 닉네임 업데이트
    updateStreamerNickname(streamerId, status.nickname);

    // 다음 요청 전 딜레이
    if (i < notifyStreamers.length - 1) {
      await delay(REQUEST_DELAY);
    }
  }

  // ★ 상태 저장
  await saveState();
}

// ===== 자동참여 스트리머 타이머 스케줄링 (5초) =====
function scheduleMonitoringCheck() {
  if (!state.isMonitoring) {
    return;
  }
  
  monitoringTimeoutId = setTimeout(async () => {
    await checkMonitoringStreamers();
    scheduleMonitoringCheck();
  }, MONITORING_CHECK_INTERVAL);
}

// ===== 알림 스트리머 타이머 스케줄링 (60초) =====
function scheduleNotifyCheck() {
  if (!state.isMonitoring) {
    return;
  }
  
  notifyTimeoutId = setTimeout(async () => {
    await checkNotifyStreamers();
    scheduleNotifyCheck();
  }, NOTIFY_CHECK_INTERVAL);
}

function startMonitoring() {
  // 기존 타이머 모두 정리
  if (monitoringTimeoutId) {
    clearTimeout(monitoringTimeoutId);
    monitoringTimeoutId = null;
  }
  if (notifyTimeoutId) {
    clearTimeout(notifyTimeoutId);
    notifyTimeoutId = null;
  }
  if (tabCheckTimeoutId) {
    clearTimeout(tabCheckTimeoutId);
    tabCheckTimeoutId = null;
  }

  state.isMonitoring = true;
  saveState();

  console.log('[숲토킹] 모니터링을 시작합니다.');
  console.log(`  - 자동참여 스트리머: ${MONITORING_CHECK_INTERVAL / 1000}초 간격`);
  console.log(`  - 알림 스트리머: ${NOTIFY_CHECK_INTERVAL / 1000}초 간격`);
  console.log(`  - 탭 실행 상태 점검: ${TAB_CHECK_INTERVAL / 1000}초 간격`);
  
  // 자동참여 스트리머 즉시 체크 후 스케줄링
  checkMonitoringStreamers().then(() => {
    scheduleMonitoringCheck();
  });
  
  // 알림 스트리머 즉시 체크 후 스케줄링
  checkNotifyStreamers().then(() => {
    scheduleNotifyCheck();
  });
  
  // 탭 실행 상태 즉시 체크 후 스케줄링
  checkAllRunningTabs().then(() => {
    scheduleTabCheck();
  });
}

function stopMonitoring() {
  // 모든 타이머 정리
  if (monitoringTimeoutId) {
    clearTimeout(monitoringTimeoutId);
    monitoringTimeoutId = null;
  }
  if (notifyTimeoutId) {
    clearTimeout(notifyTimeoutId);
    notifyTimeoutId = null;
  }
  if (tabCheckTimeoutId) {
    clearTimeout(tabCheckTimeoutId);
    tabCheckTimeoutId = null;
  }

  state.isMonitoring = false;
  state.runningTabs = {};  // 탭 상태 초기화
  saveState();

  console.log('[숲토킹] 모니터링을 중지합니다.');
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
              monitoringStreamers: state.monitoringStreamers,
              isMonitoring: state.isMonitoring,
              broadcastStatus: state.broadcastStatus,
              openedTabs: Object.keys(state.openedTabs),
              runningTabs: state.runningTabs,
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

        case 'SET_MONITORING_STREAMERS':
          // 선택 제한 없음 - SOOP 동시 시청 4개 제한은 탭 열 때 체크
          state.monitoringStreamers = message.data || [];
          await saveState();
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

        case 'ADD_FAVORITE':
          const newStreamer = message.data;
          if (newStreamer && newStreamer.id) {
            // 중복 체크
            const exists = state.favoriteStreamers.some(s => s.id === newStreamer.id);
            if (!exists) {
              state.favoriteStreamers.push(newStreamer);
              await saveState();
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: '이미 등록된 스트리머입니다.' });
            }
          } else {
            sendResponse({ success: false, error: '잘못된 스트리머 정보입니다.' });
          }
          break;

        case 'REMOVE_FAVORITE':
          const removeId = message.data;
          state.favoriteStreamers = state.favoriteStreamers.filter(s => s.id !== removeId);
          state.monitoringStreamers = state.monitoringStreamers.filter(id => id !== removeId);
          delete state.broadcastStatus[removeId];
          delete state.openedTabs[removeId];
          await saveState();
          sendResponse({ success: true });
          break;

        case 'CHECK_BROADCAST_NOW':
          // 두 그룹 모두 즉시 체크
          await checkMonitoringStreamers();
          await checkNotifyStreamers();
          sendResponse({
            success: true,
            data: state.broadcastStatus
          });
          break;

        case 'GET_BROADCAST_STATUS':
          const status = await checkBroadcastStatus(message.data);
          sendResponse({ success: true, data: status });
          break;

        default:
          sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
      }
    } catch (error) {
      console.error('[숲토킹] 메시지 처리 오류:', error);
      sendResponse({ success: false, error: error.message || '메시지 처리 중 오류 발생' });
    }
  })();

  return true; // 비동기 응답 허용
});

// 서비스 워커 유지를 위한 알람 설정
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && state.isMonitoring) {
    console.log('[숲토킹] 서비스 워커 유지 중...');
  }
});

console.log('[숲토킹] 백그라운드 서비스 워커가 로드되었습니다.');
