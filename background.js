// ===== 숲토킹 v4.0.2 - Background Service Worker =====

// ⭐ v3.6.0: GA4 익명 통계 모듈 (ES6 Module)
import * as Analytics from './analytics.js';

// ===== 상수 =====
const CHECK_INTERVAL_FAST = 5000;   // 자동참여 ON 스트리머 (5초)
const CHECK_INTERVAL_SLOW = 30000;  // 자동참여 OFF 스트리머 (30초)
const API_URL = 'https://live.sooplive.co.kr/afreeca/player_live_api.php';
const RECORDING_SAVE_TIMEOUT = 30000;  // 녹화 저장 최대 대기 시간 (30초)
const STORAGE_KEY_RECORDINGS = 'activeRecordings';  // v3.5.14: Storage 키
const MAX_CONCURRENT_RECORDINGS = 4;  // ⭐ v3.7.2: SOOP 최대 동시 스트림 제한

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

// ===== v3.5.24: 시간 포맷 헬퍼 (녹화 손실 알림용) =====
function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ===== v5.0.0: 채팅 IndexedDB 직접 저장 헬퍼 =====
const CHAT_DB_NAME = 'sooptalkingChat';
const CHAT_DB_VERSION = 1;
let chatDB = null;

// 날짜 포맷 헬퍼 (채팅용)
function formatDateForChat(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// IndexedDB 연결 (Background에서 직접 접근)
async function getChatDB() {
  if (chatDB) return chatDB;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CHAT_DB_NAME, CHAT_DB_VERSION);

    request.onerror = () => {
      console.error('[숲토킹] 채팅 DB 열기 실패:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      chatDB = request.result;
      console.log('[숲토킹] 채팅 DB 연결 완료 (Background)');
      resolve(chatDB);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      console.log('[숲토킹] 채팅 DB 스키마 업그레이드');

      // messages 스토어
      if (!database.objectStoreNames.contains('messages')) {
        const messagesStore = database.createObjectStore('messages', { keyPath: 'id' });
        messagesStore.createIndex('date', 'date', { unique: false });
        messagesStore.createIndex('date_streamer', ['date', 'streamerId'], { unique: false });
        messagesStore.createIndex('userId', 'userId', { unique: false });
        messagesStore.createIndex('nickname', 'nickname', { unique: false });
        messagesStore.createIndex('sessionId', 'sessionId', { unique: false });
        messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // sessions 스토어
      if (!database.objectStoreNames.contains('sessions')) {
        const sessionsStore = database.createObjectStore('sessions', { keyPath: 'id' });
        sessionsStore.createIndex('date', 'date', { unique: false });
        sessionsStore.createIndex('streamerId', 'streamerId', { unique: false });
      }

      // settings 스토어
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

// 채팅 메시지 저장 (Background에서 직접)
async function saveChatMessagesToIndexedDB(messages) {
  if (!messages || messages.length === 0) return;

  const db = await getChatDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['messages'], 'readwrite');
    const store = transaction.objectStore('messages');

    let saved = 0;
    let errors = 0;

    for (const msg of messages) {
      const request = store.put(msg);
      request.onsuccess = () => saved++;
      request.onerror = () => errors++;
    }

    transaction.oncomplete = () => {
      console.log(`[숲토킹] 채팅 저장 완료 (Background): ${saved}건`);
      resolve({ saved, errors });
    };

    transaction.onerror = () => {
      console.error('[숲토킹] 채팅 저장 실패:', transaction.error);
      reject(transaction.error);
    };
  });
}

// 채팅 세션 저장 (Background에서 직접)
async function saveChatSessionToIndexedDB(session) {
  const db = await getChatDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.put(session);

    request.onsuccess = () => resolve(session);
    request.onerror = () => reject(request.error);
  });
}

// ===== 스트리머 닉네임 업데이트 헬퍼 (v3.5.12) =====
function updateStreamerNickname(streamerId, newNickname) {
  if (!newNickname || typeof newNickname !== 'string') return false;

  const streamer = state.favoriteStreamers.find(s => s.id === streamerId);
  if (!streamer) return false;

  // 닉네임이 변경된 경우에만 업데이트
  if (streamer.nickname !== newNickname) {
    console.log(`[숲토킹] 닉네임 업데이트: ${streamer.nickname || streamerId} → ${newNickname}`);
    streamer.nickname = newNickname;
    return true;
  }
  return false;
}

// ===== 상태 관리 =====
const state = {
  // 스트리머 모니터링
  isMonitoring: false,
  favoriteStreamers: [],  // [{id, nickname, autoJoin, autoRecord}]
  broadcastStatus: {},    // streamerId -> {isLive, title, ...}

  // 녹화 세션 (tabId 기반)
  recordings: new Map(),  // tabId -> {streamerId, nickname, startTime, totalBytes}

  // ⭐ v3.5.10: 탭 종료 대기 상태 (녹화 저장 완료 대기)
  pendingTabClose: new Map(),  // tabId -> { resolve, timeoutId }

  // 모니터링 인터벌 ID
  fastIntervalId: null,
  slowIntervalId: null,

  // 설정
  settings: {
    notificationEnabled: true,
    endNotificationEnabled: false
  },

  // 초기화 상태 플래그 (중복 초기화 방지)
  isInitialized: false,
  isMonitoringStarting: false
};

// ===== 초기화 =====

chrome.runtime.onInstalled.addListener(async (details) => {
  const version = chrome.runtime.getManifest().version;
  console.log(`[숲토킹] v${version} 설치됨`);
  if (state.isInitialized) {
    console.log('[숲토킹] 이미 초기화됨 - onInstalled 스킵');
    return;
  }
  state.isInitialized = true;
  await loadSettings();

  // ⭐ v3.6.0: Analytics 초기화 및 설치/업데이트 이벤트
  await Analytics.initAnalytics();
  const manifest = chrome.runtime.getManifest();

  if (details.reason === 'install') {
    Analytics.trackInstall(manifest.version);
  } else if (details.reason === 'update') {
    Analytics.trackUpdate(details.previousVersion, manifest.version);
  }

  // ⭐ v5.3.0: 자동 백업 알람 설정
  await setupBackupAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[숲토킹] 브라우저 시작');
  if (state.isInitialized) {
    console.log('[숲토킹] 이미 초기화됨 - onStartup 스킵');
    return;
  }
  state.isInitialized = true;
  await loadSettings();
  await loadRecordingsFromStorage();  // ⭐ v3.5.15: 녹화 상태 복구 추가

  // ⭐ 브라우저 시작 시 clearOnExit 설정 확인 및 후원 데이터 삭제
  await checkAndClearDonationData();

  // ⭐ v3.6.0: Analytics 초기화
  await Analytics.initAnalytics();

  // ⭐ v5.3.0: 자동 백업 알람 설정
  await setupBackupAlarm();

  if (state.isMonitoring) {
    startMonitoring();
  }
});

// ===== v5.3.0: 자동 백업 알람 설정 =====
async function setupBackupAlarm() {
  try {
    // 기존 알람 제거 후 재설정
    await chrome.alarms.clear('chatBackupAlarm');

    // 6시간마다 백업 체크 알람 생성
    chrome.alarms.create('chatBackupAlarm', {
      delayInMinutes: 1,           // 1분 후 첫 실행
      periodInMinutes: 60          // 매 1시간마다 체크 (실제 백업은 BackupManager가 주기 판단)
    });

    console.log('[숲토킹] 자동 백업 알람 설정 완료');
  } catch (e) {
    console.warn('[숲토킹] 자동 백업 알람 설정 실패:', e);
  }
}

// 알람 이벤트 핸들러
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'chatBackupAlarm') {
    console.log('[숲토킹] 자동 백업 알람 트리거');
    // Side Panel에 백업 요청 메시지 전송
    try {
      await chrome.runtime.sendMessage({
        type: 'TRIGGER_CHAT_BACKUP'
      });
    } catch (e) {
      // Side Panel이 열려있지 않으면 무시
      if (!e.message?.includes('Receiving end does not exist')) {
        console.warn('[숲토킹] 백업 트리거 실패:', e);
      }
    }
  }
});

// ===== 브라우저 시작 시 후원 데이터 삭제 (clearOnExit 설정) =====
async function checkAndClearDonationData() {
  try {
    const result = await chrome.storage.local.get('myDonation');
    const donationData = result.myDonation;

    if (donationData?.settings?.clearOnExit) {
      console.log('[숲토킹] clearOnExit 설정이 활성화됨 - 후원 데이터 삭제');

      // 데이터만 삭제하고 settings는 유지
      const clearedData = {
        lastSync: null,
        isLoggedIn: null,
        data: null,
        settings: donationData.settings  // clearOnExit 설정 유지
      };

      await chrome.storage.local.set({ myDonation: clearedData });
      console.log('[숲토킹] 후원 데이터 삭제 완료');
    }
  } catch (error) {
    console.error('[숲토킹] 후원 데이터 삭제 확인 중 오류:', error);
  }
}

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

// ===== Content Script 자동 주입 =====

async function injectContentScripts(tabId) {
  console.log('[숲토킹] Content Script 주입 시도:', tabId);

  try {
    // ISOLATED world content script 주입
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
    console.log('[숲토킹] content.js 주입 완료');

    // MAIN world content script 주입
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content-main.js'],
      world: 'MAIN'
    });
    console.log('[숲토킹] content-main.js 주입 완료');

    // 스크립트 초기화 대기
    await new Promise(r => setTimeout(r, 500));

    return { success: true };
  } catch (error) {
    console.error('[숲토킹] Content Script 주입 실패:', error);
    return { success: false, error: error.message };
  }
}

// ===== 녹화 관리 =====

async function startRecording(tabId, streamerId, nickname, quality = 'high', splitSize = 500) {
  // ⭐ v3.5.9.2: 상세 로깅
  console.log('[숲토킹] ========== startRecording 함수 호출 ==========');
  console.log(`[숲토킹]   - tabId: ${tabId}`);
  console.log(`[숲토킹]   - streamerId: "${streamerId}"`);
  console.log(`[숲토킹]   - nickname: "${nickname}"`);
  console.log(`[숲토킹]   - quality: "${quality}" (타입: ${typeof quality})`);
  console.log(`[숲토킹]   - splitSize: ${splitSize}MB`);
  console.log('[숲토킹] ===============================================');

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

  // ⭐ v3.5.17: 이미 녹화 중이면 성공으로 처리 (재시도 방지)
  if (state.recordings.has(tabId)) {
    console.log('[숲토킹] 이미 녹화 중 - 성공으로 처리:', tabId);
    return { success: true, alreadyRecording: true };
  }

  try {
    // 탭 확인
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url?.includes('play.sooplive.co.kr')) {
      return { success: false, error: 'SOOP 방송 페이지가 아닙니다.' };
    }

    // Content Script에 녹화 시작 명령 전송
    console.log(`[숲토킹] Content Script로 전달: quality="${quality}", splitSize=${splitSize}MB`);
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'START_RECORDING',
      streamerId: streamerId,
      nickname: nickname,
      quality: quality,
      splitSize: splitSize
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

      // ⭐ v3.6.0: 녹화 시작 이벤트
      Analytics.trackRecordingStart(quality);

      return { success: true, tabId, streamerId, nickname };
    } else {
      return { success: false, error: response?.error || '녹화 시작 실패' };
    }

  } catch (error) {
    // Content Script 연결 실패는 예상된 상황 - 자동 주입으로 복구 시도
    const isConnectionError = error.message?.includes('Receiving end') ||
                              error.message?.includes('Could not establish');

    if (isConnectionError) {
      console.log('[숲토킹] Content Script 미연결 - 자동 주입 시도');

      const injectResult = await injectContentScripts(tabId);
      if (!injectResult.success) {
        console.warn('[숲토킹] 스크립트 주입 실패:', injectResult.error);
        return { success: false, error: '스크립트 주입 실패. 페이지를 새로고침 해주세요.' };
      }

      // 주입 후 재시도
      try {
        console.log(`[숲토킹] 재시도 - Content Script로 전달: quality="${quality}", splitSize=${splitSize}MB`);
        const retryResponse = await chrome.tabs.sendMessage(tabId, {
          type: 'START_RECORDING',
          streamerId: streamerId,
          nickname: nickname,
          quality: quality,
          splitSize: splitSize
        });

        if (retryResponse?.success) {
          state.recordings.set(tabId, {
            tabId,
            streamerId,
            nickname,
            startTime: Date.now(),
            totalBytes: 0
          });
          updateBadge();
          console.log('[숲토킹] 녹화 시작 성공 (스크립트 자동 주입)');
          return { success: true, tabId, streamerId, nickname };
        } else {
          console.warn('[숲토킹] 재시도 후 녹화 시작 실패:', retryResponse?.error);
          return { success: false, error: retryResponse?.error || '녹화 시작 실패' };
        }
      } catch (retryError) {
        console.error('[숲토킹] 녹화 시작 최종 실패:', retryError.message);
        return { success: false, error: '페이지를 새로고침 후 다시 시도해주세요.' };
      }
    }

    // 예상치 못한 에러만 console.error
    console.error('[숲토킹] 녹화 시작 실패:', error.message);
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

// ⭐ v3.5.10: 녹화 저장 완료를 기다린 후 탭 종료
async function safeCloseBroadcastTab(streamerId, tabId = null) {
  // tabId가 없으면 스트리머 URL로 탭 검색
  if (!tabId) {
    try {
      const tabs = await chrome.tabs.query({ url: `*://play.sooplive.co.kr/${streamerId}*` });
      if (tabs.length > 0) {
        tabId = tabs[0].id;
      } else {
        console.log(`[숲토킹] ${streamerId} 탭을 찾을 수 없음`);
        return;
      }
    } catch (error) {
      console.log(`[숲토킹] ${streamerId} 탭 검색 실패:`, error);
      return;
    }
  }

  console.log('[숲토킹] 안전한 탭 종료 요청:', streamerId, 'tabId:', tabId);

  // ⭐ 녹화 중인지 확인
  if (state.recordings.has(tabId)) {
    const recording = state.recordings.get(tabId);
    console.log(`[숲토킹] ${streamerId} 녹화 중 - 안전 종료 프로세스 시작`);
    console.log(`[숲토킹]   녹화 시간: ${Math.floor((Date.now() - recording.startTime) / 1000)}초`);

    try {
      // 1. 녹화 중지 요청
      console.log(`[숲토킹] ${streamerId} 녹화 중지 요청 전송`);
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' });

      // 2. 저장 완료 대기 (Promise + 타임아웃)
      console.log(`[숲토킹] ${streamerId} 녹화 저장 완료 대기 중... (최대 ${RECORDING_SAVE_TIMEOUT / 1000}초)`);

      const saved = await waitForRecordingSaved(tabId, RECORDING_SAVE_TIMEOUT);

      if (saved) {
        console.log(`[숲토킹] ${streamerId} 녹화 저장 완료 확인`);
      } else {
        console.warn(`[숲토킹] ${streamerId} 녹화 저장 타임아웃 - 강제 진행`);
      }

    } catch (error) {
      console.error(`[숲토킹] ${streamerId} 녹화 중지 요청 실패:`, error);
      // 에러가 나도 탭 종료는 진행 (탭이 이미 닫혔을 수 있음)
    }
  } else {
    console.log(`[숲토킹] ${streamerId} 녹화 중 아님 - 즉시 종료`);
  }

  // 3. 탭 종료
  try {
    await chrome.tabs.remove(tabId);
    console.log(`[숲토킹] ${streamerId} 탭 종료 완료`);
  } catch (error) {
    console.log(`[숲토킹] ${streamerId} 탭이 이미 닫혀있음`);
  } finally {
    state.recordings.delete(tabId);
    state.pendingTabClose.delete(tabId);
    updateBadge();
  }
}

// ⭐ v3.5.10: 녹화 저장 완료 대기 함수
function waitForRecordingSaved(tabId, timeout) {
  return new Promise((resolve) => {
    // 이미 녹화 상태가 없으면 즉시 resolve
    if (!state.recordings.has(tabId)) {
      resolve(true);
      return;
    }

    // 타임아웃 설정
    const timeoutId = setTimeout(() => {
      console.warn(`[숲토킹] 탭 ${tabId} 녹화 저장 대기 타임아웃`);
      state.pendingTabClose.delete(tabId);
      resolve(false);  // 타임아웃 시 false 반환
    }, timeout);

    // 대기 상태 등록
    state.pendingTabClose.set(tabId, {
      resolve: resolve,
      timeoutId: timeoutId
    });

    console.log(`[숲토킹] 탭 ${tabId} 저장 완료 대기 등록`);
  });
}

// 기존 함수 호환용 (VOD 리다이렉트 등에서 사용)
async function safeCloseTab(tabId, streamerId) {
  await safeCloseBroadcastTab(streamerId, tabId);
}

// ===== 배지 업데이트 =====

function updateBadge() {
  const count = state.recordings.size;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
}

// ===== v3.5.14: Storage 기반 녹화 상태 관리 =====

// Storage에서 녹화 상태 로드 (시작 시, 복구 시)
async function loadRecordingsFromStorage() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
    const recordings = result[STORAGE_KEY_RECORDINGS] || {};

    // 유효한 녹화만 필터링 (탭 존재 + stale 체크)
    const now = Date.now();
    const validRecordings = {};
    const invalidTabIds = [];

    for (const [tabIdStr, rec] of Object.entries(recordings)) {
      const tabId = parseInt(tabIdStr);

      // 탭 존재 확인
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && tab.url && tab.url.includes('play.sooplive.co.kr')) {
          // 마지막 업데이트가 2분 이내인 경우만 유효
          if (now - (rec.lastUpdate || 0) < 120000) {
            validRecordings[tabIdStr] = rec;
            state.recordings.set(tabId, rec);
          } else {
            console.log('[숲토킹] Stale 녹화 상태 제거 (2분 초과):', tabIdStr);
            invalidTabIds.push(tabIdStr);
          }
        } else {
          invalidTabIds.push(tabIdStr);
        }
      } catch (e) {
        // 탭이 존재하지 않음
        console.log('[숲토킹] 존재하지 않는 탭 녹화 상태 제거:', tabIdStr);
        invalidTabIds.push(tabIdStr);
      }
    }

    // 정리된 상태 저장
    if (invalidTabIds.length > 0) {
      await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: validRecordings });
    }

    updateBadge();
    console.log('[숲토킹] Storage에서 녹화 상태 로드 완료:', Object.keys(validRecordings).length, '개');
  } catch (error) {
    console.error('[숲토킹] 녹화 상태 로드 실패:', error);
  }
}

// 메모리 Map의 특정 항목을 Storage에 동기화
async function saveRecordingToStorage(tabId, recordingData) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
    const recordings = result[STORAGE_KEY_RECORDINGS] || {};

    recordings[tabId] = {
      ...recordingData,
      tabId: tabId,
      lastUpdate: Date.now()
    };

    await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
    console.log('[숲토킹] 녹화 상태 storage 저장:', tabId);
  } catch (error) {
    console.error('[숲토킹] 녹화 상태 저장 실패:', error);
  }
}

// Storage에서 특정 녹화 제거
async function removeRecordingFromStorage(tabId) {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
    const recordings = result[STORAGE_KEY_RECORDINGS] || {};

    if (recordings[tabId]) {
      delete recordings[tabId];
      await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
      console.log('[숲토킹] 녹화 상태 storage 제거:', tabId);
    }
  } catch (error) {
    console.error('[숲토킹] 녹화 상태 제거 실패:', error);
  }
}

// 전체 메모리 Map을 Storage에 동기화
async function syncAllRecordingsToStorage() {
  try {
    const recordings = {};
    for (const [tabId, rec] of state.recordings.entries()) {
      recordings[tabId] = {
        ...rec,
        lastUpdate: Date.now()
      };
    }
    await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });
  } catch (error) {
    console.error('[숲토킹] 전체 녹화 상태 동기화 실패:', error);
  }
}

// Storage 변경 감지 (content.js에서 직접 저장한 경우 동기화)
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY_RECORDINGS]) return;

  const newRecordings = changes[STORAGE_KEY_RECORDINGS].newValue || {};

  // 메모리 Map 업데이트 (Storage가 source of truth)
  state.recordings.clear();
  for (const [tabIdStr, rec] of Object.entries(newRecordings)) {
    state.recordings.set(parseInt(tabIdStr), rec);
  }

  updateBadge();
  // 디버깅 필요 시에만 활성화
  // console.log('[숲토킹] Storage 동기화:', state.recordings.size);
});

// ===== 스트리머 모니터링 (5초/30초 분리) =====

function startMonitoring() {
  // 중복 시작 방지
  if (state.isMonitoringStarting) {
    console.log('[숲토킹] 모니터링 시작 중 - 중복 호출 무시');
    return;
  }
  state.isMonitoringStarting = true;

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

  state.isMonitoringStarting = false;
  console.log('[숲토킹] 모니터링 시작 (5초/30초 분리)');

  // ⭐ v3.6.0: 모니터링 시작 이벤트
  Analytics.trackMonitoringToggle(true, state.favoriteStreamers.length);
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

  // ⭐ v3.6.0: 모니터링 중지 이벤트
  Analytics.trackMonitoringToggle(false, state.favoriteStreamers.length);
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

        // ⭐ v3.6.0: 자동 참여 이벤트
        Analytics.trackAutoJoin();

        // 자동 녹화
        if (streamer.autoRecord && tab?.id) {
          // ⭐ v3.7.2: 동시 녹화 개수 체크
          try {
            const recResult = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
            const recordings = recResult[STORAGE_KEY_RECORDINGS] || {};
            const currentRecordingCount = Object.keys(recordings).length;

            if (currentRecordingCount >= MAX_CONCURRENT_RECORDINGS) {
              console.log(`[숲토킹] 자동 녹화 취소 - 최대 동시 녹화 (${MAX_CONCURRENT_RECORDINGS}개) 초과:`, streamer.id);
              // 알림으로 사용자에게 알림
              chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: '숲토킹 - 자동 녹화 제한',
                message: `${streamer.nickname || streamer.id} 자동 녹화 실패: 최대 ${MAX_CONCURRENT_RECORDINGS}개까지 동시 녹화 가능`
              });
              return;
            }
          } catch (e) {
            console.warn('[숲토킹] 녹화 개수 확인 실패:', e);
            // 체크 실패해도 녹화 시도는 진행
          }

          // 탭 로드 완료 대기
          await waitForTabComplete(tab.id, 15000);

          // ⭐ v3.5.16: 비디오 요소 로드 대기 (2초 → 5초로 증가)
          await new Promise(r => setTimeout(r, 5000));
          console.log('[숲토킹] 비디오 로드 대기 완료, 녹화 시작 시도');

          // 탭 유효성 재확인 (탭이 닫혔거나 URL이 변경되었을 수 있음)
          try {
            const currentTab = await chrome.tabs.get(tab.id);
            if (!currentTab || !currentTab.url?.includes(`play.sooplive.co.kr/${streamer.id}`)) {
              console.log('[숲토킹] 자동 녹화 취소 - 탭이 유효하지 않음:', streamer.id);
              return;
            }
          } catch (error) {
            console.log('[숲토킹] 자동 녹화 취소 - 탭 확인 실패:', error);
            return;
          }

          // ⭐ v3.5.18: 사용자가 선택한 품질을 자동 녹화에도 적용
          // ⭐ v3.6.6: 분할 크기도 함께 로드
          const settingsData = await chrome.storage.local.get(['recordingQuality', 'splitSize']);
          const autoRecordQuality = settingsData.recordingQuality || 'high';
          const autoSplitSize = settingsData.splitSize || 500;
          console.log('[숲토킹] 자동 녹화 품질:', autoRecordQuality);
          console.log('[숲토킹] 자동 녹화 분할 크기:', autoSplitSize + 'MB');

          // 녹화 시작 (최대 3회 재시도)
          let retryCount = 0;
          const maxRetries = 3;

          const tryStartRecording = async () => {
            // 재시도 전 탭 유효성 재확인
            try {
              const currentTab = await chrome.tabs.get(tab.id);
              if (!currentTab || !currentTab.url?.includes(`play.sooplive.co.kr/${streamer.id}`)) {
                console.log('[숲토킹] 자동 녹화 재시도 취소 - 탭 무효');
                return { success: false, error: '탭이 유효하지 않음' };
              }
            } catch {
              return { success: false, error: '탭 확인 실패' };
            }

            const result = await startRecording(tab.id, streamer.id, streamer.nickname || streamer.id, autoRecordQuality, autoSplitSize);

            if (!result.success && retryCount < maxRetries) {
              retryCount++;
              console.log('[숲토킹] 자동 녹화 재시도:', retryCount);
              await new Promise(r => setTimeout(r, 2000));
              return tryStartRecording();
            }

            // ⭐ v3.6.0: 자동 녹화 이벤트 (tryStartRecording 성공 시)
            if (result?.success) {
              Analytics.trackAutoRecordingStart(autoRecordQuality);
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

      // 방송 종료 알림
      if (state.settings.endNotificationEnabled) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '방송 종료',
          message: `${streamer.nickname || streamer.id}님의 방송이 종료되었습니다.`,
          silent: true
        });
      }

      // ⭐ v3.5.10: 자동 종료가 활성화되어 있으면 안전한 탭 종료 (녹화 저장 완료 후)
      if (streamer.autoClose) {
        console.log(`[숲토킹] ${streamer.id} 자동 종료 - 안전한 탭 종료 시작`);
        await safeCloseBroadcastTab(streamer.id);
      } else {
        // 자동 종료가 비활성화되어 있어도, 녹화 중이면 녹화는 안전 저장
        try {
          const tabs = await chrome.tabs.query({ url: `*://play.sooplive.co.kr/${streamer.id}*` });
          for (const tab of tabs) {
            if (state.recordings.has(tab.id)) {
              console.log('[숲토킹] 방송 종료 - 녹화 안전 저장 (탭 유지):', streamer.id);
              try {
                await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
                // 저장 완료 대기 (Promise 기반)
                await waitForRecordingSaved(tab.id, RECORDING_SAVE_TIMEOUT);
                console.log('[숲토킹] 녹화 저장 완료 (탭 유지):', streamer.id);
              } catch (error) {
                console.error('[숲토킹] 녹화 중지 실패:', error);
                state.recordings.delete(tab.id);
                updateBadge();
              }
            }
          }
        } catch (error) {
          console.error('[숲토킹] 방송 종료 처리 실패:', error);
        }
      }
    }

    state.broadcastStatus[streamer.id] = status;

    // ★ v3.5.12: 닉네임 업데이트 (방송 중일 때 API에서 가져온 닉네임으로 갱신)
    if (status.nickname && status.nickname !== streamer.id) {
      const updated = updateStreamerNickname(streamer.id, status.nickname);
      if (updated) {
        await saveSettings();  // 변경 사항 저장
      }
    }

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

  // 이미 열린 탭이 있는지 확인 (중복 열림 방지)
  try {
    const existingTabs = await chrome.tabs.query({ url: `*://play.sooplive.co.kr/${streamerId}*` });
    if (existingTabs.length > 0) {
      console.log('[숲토킹] 이미 열린 탭 재사용:', streamerId, 'tabId:', existingTabs[0].id);
      // 탭 활성화
      await chrome.tabs.update(existingTabs[0].id, { active: true });
      return existingTabs[0];
    }
  } catch (error) {
    console.warn('[숲토킹] 기존 탭 조회 실패:', error);
  }

  const tab = await chrome.tabs.create({ url });
  console.log('[숲토킹] 새 탭 생성:', streamerId, 'tabId:', tab.id);
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
    nickname: status.nickname || streamerId,  // ★ v3.5.12: API에서 가져온 닉네임 사용
    autoJoin: false,
    autoRecord: false,
    autoClose: false,
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
// M-1 참고: Chrome 서비스 워커에서는 리스너가 자동 관리되므로
// 중복 등록 체크가 불필요함 (재시작 시 기존 리스너 자동 해제)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true;
});

async function handleMessage(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  switch (message.type) {
    // ===== 사이드패널 → Background =====

    case 'START_RECORDING_REQUEST':
      console.log(`[숲토킹] 녹화 요청: ${message.streamerId} (${message.quality || 'high'}, 분할: ${message.splitSize || 500}MB)`);

      const recordingQuality = message.quality || 'high';
      const recordingSplitSize = message.splitSize || 500;

      const startResult = await startRecording(
        message.tabId,
        message.streamerId,
        message.nickname,
        recordingQuality,
        recordingSplitSize
      );
      sendResponse(startResult);
      break;

    case 'STOP_RECORDING_REQUEST':
      const stopResult = await stopRecording(message.tabId);
      sendResponse(stopResult);
      break;

    case 'GET_ALL_RECORDINGS':
      // ⭐ v3.5.14: Storage에서 직접 읽기 (최신 상태 보장)
      try {
        const result = await chrome.storage.local.get(STORAGE_KEY_RECORDINGS);
        const recordings = result[STORAGE_KEY_RECORDINGS] || {};

        // 유효성 검사 (탭 존재 여부)
        const validRecordings = [];
        const invalidTabIds = [];

        for (const [tabIdStr, rec] of Object.entries(recordings)) {
          try {
            const tab = await chrome.tabs.get(parseInt(tabIdStr));
            if (tab && tab.url?.includes('play.sooplive.co.kr')) {
              validRecordings.push({ ...rec, tabId: parseInt(tabIdStr) });
            } else {
              invalidTabIds.push(tabIdStr);
            }
          } catch (e) {
            invalidTabIds.push(tabIdStr);
          }
        }

        // 무효한 항목 정리
        if (invalidTabIds.length > 0) {
          for (const tabIdStr of invalidTabIds) {
            delete recordings[tabIdStr];
          }
          await chrome.storage.local.set({ [STORAGE_KEY_RECORDINGS]: recordings });

          // 메모리도 동기화
          state.recordings.clear();
          for (const rec of validRecordings) {
            state.recordings.set(rec.tabId, rec);
          }
          updateBadge();
        }

        sendResponse({
          success: true,
          data: validRecordings
        });
      } catch (error) {
        console.error('[숲토킹] GET_ALL_RECORDINGS 오류:', error);
        // 폴백: 메모리에서 읽기
        sendResponse({
          success: true,
          data: Array.from(state.recordings.values())
        });
      }
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

    case 'REORDER_STREAMERS':
      // v3.5.20: 스트리머 순서 변경 저장
      if (Array.isArray(message.streamers)) {
        const isValid = message.streamers.every(s =>
          s && typeof s.id === 'string' && isValidStreamerId(s.id)
        );
        if (isValid) {
          state.favoriteStreamers = message.streamers;
          await saveSettings();
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: '유효하지 않은 스트리머 데이터' });
        }
      } else {
        sendResponse({ success: false, error: '스트리머 배열이 필요합니다' });
      }
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
      // 정상 동작 - 로그 생략
      sendResponse({ success: true });
      break;

    case 'RECORDING_STARTED_FROM_PAGE':
      console.log('[숲토킹] 녹화 시작됨 (페이지에서):', message.streamerId);
      if (tabId && !state.recordings.has(tabId)) {
        const recordingData = {
          tabId,
          streamerId: message.streamerId,
          nickname: message.nickname,
          startTime: Date.now(),
          totalBytes: 0,
          lastUpdate: Date.now()
        };

        state.recordings.set(tabId, recordingData);
        updateBadge();

        // ⭐ v3.5.14: Storage에도 저장 (content.js에서 이미 저장했을 수 있지만 확실히)
        await saveRecordingToStorage(tabId, recordingData);
      }
      broadcastToSidepanel({
        type: 'RECORDING_STARTED_UPDATE',
        tabId: tabId,
        streamerId: message.streamerId,
        nickname: message.nickname
      });
      sendResponse({ success: true });
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

        // ⭐ v3.5.14: Storage에서도 제거
        await removeRecordingFromStorage(tabId);
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
      sendResponse({ success: true });
      break;

    case 'RECORDING_ERROR_FROM_PAGE':
      console.error('[숲토킹] 녹화 에러 (페이지에서):', message.error);
      if (tabId) {
        state.recordings.delete(tabId);
        updateBadge();

        // ⭐ v3.5.14: Storage에서도 제거
        await removeRecordingFromStorage(tabId);
      }
      broadcastToSidepanel({
        type: 'RECORDING_ERROR_UPDATE',
        tabId: tabId,
        error: message.error
      });
      sendResponse({ success: true });
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

    // ===== 분할 녹화 상태 릴레이 (v3.5.8.3) =====
    case 'RECORDING_SPLIT_START':
      console.log(`[숲토킹] 파트 ${message.partNumber} 분할 시작 (${message.streamerId})`);
      broadcastToSidepanel({
        type: 'RECORDING_SPLIT_START',
        tabId: tabId,
        streamerId: message.streamerId,
        partNumber: message.partNumber
      });
      sendResponse({ success: true });
      break;

    case 'RECORDING_SPLIT_COMPLETE':
      console.log(`[숲토킹] 파트 ${message.partNumber} 분할 완료 (${message.streamerId})`);
      broadcastToSidepanel({
        type: 'RECORDING_SPLIT_COMPLETE',
        tabId: tabId,
        streamerId: message.streamerId,
        partNumber: message.partNumber
      });

      // ⭐ v3.6.0: 파일 분할 이벤트
      Analytics.trackFileSplit(message.partNumber);

      sendResponse({ success: true });
      break;

    // ===== v3.5.10: 녹화 상태 추적 메시지 =====

    // ⭐ 녹화 시작됨 (Content에서 알림)
    case 'RECORDING_STARTED':
      console.log(`[숲토킹] 녹화 시작됨: tabId=${message.tabId}, streamerId=${message.streamerId}`);
      // ⭐ v3.5.10.2: tabId, totalBytes 필드 추가 (녹화 중지 버튼 동작 수정)
      state.recordings.set(message.tabId, {
        tabId: message.tabId,
        streamerId: message.streamerId,
        nickname: message.nickname,
        startTime: Date.now(),
        totalBytes: 0
      });
      updateBadge();
      sendResponse({ success: true });
      break;

    // ⭐ 녹화 저장 완료 (Content에서 알림)
    case 'RECORDING_SAVED':
      console.log(`[숲토킹] 녹화 저장 완료: tabId=${message.tabId}, streamerId=${message.streamerId}`);
      console.log(`[숲토킹]   파일: ${message.fileName}, 크기: ${(message.fileSize / 1024 / 1024).toFixed(2)}MB`);

      // ⭐ v3.6.0: 녹화 완료 이벤트
      {
        const rec = state.recordings.get(message.tabId);
        const durationSec = rec ? Math.floor((Date.now() - rec.startTime) / 1000) : 0;
        const sizeMB = message.fileSize ? Math.round(message.fileSize / 1024 / 1024) : 0;
        chrome.storage.local.get(['recordingQuality']).then(result => {
          const quality = result.recordingQuality || 'ultra';
          Analytics.trackRecordingStop(quality, durationSec, sizeMB);
        }).catch(() => {
          Analytics.trackRecordingStop('unknown', durationSec, sizeMB);
        });
      }

      // 녹화 상태 제거
      state.recordings.delete(message.tabId);
      updateBadge();

      // 대기 중인 탭 종료가 있으면 resolve
      if (state.pendingTabClose.has(message.tabId)) {
        const pending = state.pendingTabClose.get(message.tabId);
        clearTimeout(pending.timeoutId);
        pending.resolve(true);
        state.pendingTabClose.delete(message.tabId);
        console.log(`[숲토킹] 탭 ${message.tabId} 종료 대기 해제`);
      }

      sendResponse({ success: true });
      break;

    // ⭐ 녹화 중지됨 (저장 없이 중지된 경우)
    case 'RECORDING_STOPPED':
      console.log(`[숲토킹] 녹화 중지됨: tabId=${message.tabId}`);
      state.recordings.delete(message.tabId);
      updateBadge();

      // 대기 중인 탭 종료가 있으면 resolve
      if (state.pendingTabClose.has(message.tabId)) {
        const pending = state.pendingTabClose.get(message.tabId);
        clearTimeout(pending.timeoutId);
        pending.resolve(true);
        state.pendingTabClose.delete(message.tabId);
      }

      sendResponse({ success: true });
      break;

    // ⭐ 현재 탭 ID 조회 (Content Script용)
    case 'GET_CURRENT_TAB_ID':
      sendResponse({ tabId: tabId });
      break;

    // ⭐ v3.5.24: 페이지 새로고침으로 인한 상태 정리
    case 'RECORDING_STATE_CLEANUP':
      console.log(`[숲토킹] 녹화 상태 정리 요청: tabId=${message.tabId}, reason=${message.reason}`);
      if (message.tabId && state.recordings.has(message.tabId)) {
        state.recordings.delete(message.tabId);
        updateBadge();
      }
      sendResponse({ success: true });
      break;

    // ⭐ v3.5.24: 페이지에서 녹화 손실 알림
    case 'RECORDING_LOST_FROM_PAGE':
      console.warn(`[숲토킹] 녹화 손실 (페이지에서): ${message.streamerId}, ${message.elapsedTime}초`);
      // 이미 onUpdated에서 처리했을 수 있으므로 중복 체크
      if (tabId && state.recordings.has(tabId)) {
        state.recordings.delete(tabId);
        await removeRecordingFromStorage(tabId);
        updateBadge();
      }
      sendResponse({ success: true });
      break;

    // ⭐ v3.6.0: 품질 변경 이벤트 (sidepanel에서 전송)
    case 'ANALYTICS_QUALITY_CHANGE':
      Analytics.trackQualityChange(message.quality);
      sendResponse({ success: true });
      break;

    // ⭐ v3.6.0: 녹화 오류 이벤트 (content에서 전송)
    case 'ANALYTICS_RECORDING_ERROR':
      Analytics.trackRecordingError(message.errorType);
      sendResponse({ success: true });
      break;

    // ===== v5.0.0: 채팅 수집 관련 메시지 =====

    case 'CHAT_COLLECTOR_LOADED':
      // v5.3.0: 수집기 로드 시 자동 수집 시작 트리거
      console.log('[숲토킹] 채팅 수집기 로드됨:', message.streamerId);
      (async () => {
        try {
          // 현재 설정 확인
          const chatSettings = await chrome.storage.local.get(['chatCollectMode', 'chatCollectStreamers']);
          const collectMode = chatSettings.chatCollectMode || 'all';
          const collectStreamers = chatSettings.chatCollectStreamers || [];

          // 수집 모드가 off가 아니면 수집 시작 명령 전송
          if (collectMode !== 'off' && message.streamerId && sender.tab?.id) {
            // 선택 모드일 때 대상 스트리머인지 확인
            if (collectMode === 'selected') {
              const isTarget = collectStreamers.some(s =>
                s.id === message.streamerId || s.id?.toLowerCase() === message.streamerId?.toLowerCase()
              );
              if (!isTarget) {
                console.log('[숲토킹] 수집 대상 아님:', message.streamerId);
                return;
              }
            }

            // 약간의 지연 후 수집 시작 명령 (페이지 로드 완료 대기)
            setTimeout(async () => {
              try {
                await chrome.tabs.sendMessage(sender.tab.id, {
                  type: 'START_CHAT_COLLECTION',
                  streamerId: message.streamerId,
                  streamerNick: message.streamerId
                });
                console.log('[숲토킹] 채팅 수집 시작 명령 전송:', message.streamerId);
              } catch (e) {
                console.log('[숲토킹] 채팅 수집 시작 명령 전송 실패:', e.message);
              }
            }, 2000);
          }
        } catch (e) {
          console.error('[숲토킹] 채팅 수집기 초기화 오류:', e);
        }
      })();
      sendResponse({ success: true });
      break;

    case 'CHAT_MESSAGES_COLLECTED':
      // 채팅 메시지 수집됨 - Side Panel로 브로드캐스트
      broadcastToSidepanel({
        type: 'CHAT_MESSAGES_UPDATE',
        streamerId: message.streamerId,
        messages: message.messages,
        count: message.count
      });
      sendResponse({ success: true });
      break;

    case 'CHAT_COLLECTION_STATUS':
      // 채팅 수집 상태 변경 알림
      broadcastToSidepanel({
        type: 'CHAT_COLLECTION_STATUS_UPDATE',
        streamerId: message.streamerId,
        isCollecting: message.isCollecting,
        isPaused: message.isPaused
      });
      sendResponse({ success: true });
      break;

    case 'GET_CHAT_COLLECTION_SETTINGS':
      // 채팅 수집 설정 조회
      try {
        const chatSettings = await chrome.storage.local.get(['chatCollectMode', 'chatCollectStreamers']);
        sendResponse({
          success: true,
          data: {
            collectMode: chatSettings.chatCollectMode || 'all',
            collectStreamers: chatSettings.chatCollectStreamers || []
          }
        });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'GET_STREAMER_NICKNAME':
      // v5.4.0: favoriteStreamers에서 스트리머 닉네임 조회
      try {
        const targetId = message.streamerId;
        const foundStreamer = state.favoriteStreamers.find(s =>
          s.id === targetId || s.id?.toLowerCase() === targetId?.toLowerCase()
        );
        if (foundStreamer?.nickname) {
          sendResponse({ success: true, nickname: foundStreamer.nickname });
        } else {
          sendResponse({ success: false, nickname: null });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'CHAT_SETTINGS_CHANGED':
      // 채팅 수집 설정 변경 - 모든 SOOP 탭에 알림
      try {
        // storage에 설정 저장
        await chrome.storage.local.set({
          chatCollectMode: message.settings.collectMode,
          chatCollectStreamers: message.settings.collectStreamers
        });

        // 모든 SOOP 탭에 설정 변경 알림
        const soopTabsForSettings = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });
        for (const tab of soopTabsForSettings) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'CHAT_SETTINGS_CHANGED',
              settings: message.settings
            });
          } catch (e) {
            // 탭에서 응답 없음 - 무시
          }
        }

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'GET_CHAT_COLLECTION_STATUS_FROM_TABS':
      // Side Panel에서 요청 - 탭에서 수집 상태 조회
      try {
        const soopTabsForStatus = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });
        let chatStatus = null;

        for (const tab of soopTabsForStatus) {
          try {
            const tabResponse = await chrome.tabs.sendMessage(tab.id, {
              type: 'GET_CHAT_COLLECTION_STATUS'
            });
            if (tabResponse?.isCollecting) {
              chatStatus = tabResponse;
              break;
            } else if (!chatStatus && tabResponse) {
              chatStatus = tabResponse;
            }
          } catch (e) {
            // 탭에서 응답 없음
          }
        }

        sendResponse({ success: true, status: chatStatus });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'SET_CHAT_COLLECTION_ENABLED':
      // 채팅 수집 활성화/비활성화
      try {
        await chrome.storage.local.set({ chatCollectionEnabled: message.enabled });

        // 모든 SOOP 탭에 상태 변경 알림
        const soopTabs = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });
        for (const tab of soopTabs) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'CHAT_COLLECTION_TOGGLE',
              enabled: message.enabled
            });
          } catch (e) {
            // 탭에서 응답 없음 - 무시
          }
        }

        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'CHAT_MESSAGES_BATCH':
      // 채팅 메시지 배치 저장 - Background에서 직접 IndexedDB에 저장
      try {
        // IndexedDB에 직접 저장 (Side Panel 종속성 제거)
        await saveChatMessagesToIndexedDB(message.messages);

        // Side Panel에 UI 업데이트 알림 (선택적 - 실패해도 저장은 완료됨)
        broadcastToSidepanel({
          type: 'CHAT_SAVE_BATCH',
          messages: message.messages,
          sessionId: message.sessionId,
          streamerId: message.streamerId
        });

        sendResponse({ success: true, saved: message.messages?.length || 0 });
      } catch (error) {
        console.error('[숲토킹] 채팅 메시지 저장 실패:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    case 'CHAT_SESSION_START':
      // 채팅 세션 시작 - Background에서 직접 IndexedDB에 저장
      console.log('[숲토킹] 채팅 세션 시작:', message.streamerId);
      try {
        await saveChatSessionToIndexedDB({
          id: message.sessionId,
          streamerId: message.streamerId,
          streamerNick: message.streamerNick,
          date: formatDateForChat(new Date()),
          startTime: message.startTime,
          endTime: null
        });

        broadcastToSidepanel({
          type: 'CHAT_SESSION_START_UPDATE',
          sessionId: message.sessionId,
          streamerId: message.streamerId,
          streamerNick: message.streamerNick,
          startTime: message.startTime
        });
      } catch (error) {
        console.error('[숲토킹] 세션 저장 실패:', error);
      }
      sendResponse({ success: true });
      break;

    case 'CHAT_SESSION_END':
      // 채팅 세션 종료 - Background에서 직접 IndexedDB에 저장
      console.log('[숲토킹] 채팅 세션 종료:', message.streamerId);
      try {
        await saveChatSessionToIndexedDB({
          id: message.sessionId,
          streamerId: message.streamerId,
          date: formatDateForChat(new Date()),
          endTime: message.endTime
        });

        broadcastToSidepanel({
          type: 'CHAT_SESSION_END_UPDATE',
          sessionId: message.sessionId,
          streamerId: message.streamerId,
          endTime: message.endTime
        });
      } catch (error) {
        console.error('[숲토킹] 세션 종료 저장 실패:', error);
      }
      sendResponse({ success: true });
      break;

    case 'CHAT_EMERGENCY_SAVE':
      // 긴급 저장 (페이지 언로드 시) - Background에서 직접 저장
      console.log('[숲토킹] 채팅 긴급 저장:', message.messages?.length || 0, '건');
      try {
        if (message.messages && message.messages.length > 0) {
          await saveChatMessagesToIndexedDB(message.messages);
        }
        broadcastToSidepanel({
          type: 'CHAT_SAVE_BATCH',
          messages: message.messages,
          sessionId: message.sessionId,
          streamerId: message.streamerId,
          emergency: true
        });
        sendResponse({ success: true });
      } catch (error) {
        console.error('[숲토킹] 긴급 저장 실패:', error);
        sendResponse({ success: false, error: error.message });
      }
      break;

    default:
      sendResponse({ success: false, error: '알 수 없는 메시지 타입' });
  }
}

// ===== 탭 닫힘 감지 =====

chrome.tabs.onRemoved.addListener(async (tabId) => {
  // ⭐ v3.5.14: 녹화 중인 탭이 강제 종료된 경우 경고 및 storage 정리
  if (state.recordings.has(tabId)) {
    console.warn(`[숲토킹] 녹화 중인 탭 ${tabId}이 강제 종료됨 - 데이터 유실 가능`);
    const recording = state.recordings.get(tabId);

    // 메모리에서 제거
    state.recordings.delete(tabId);
    updateBadge();

    // ⭐ v3.5.14: Storage에서도 제거
    await removeRecordingFromStorage(tabId);

    // Side Panel에 알림
    try {
      chrome.runtime.sendMessage({
        type: 'RECORDING_TAB_CLOSED',
        tabId: tabId,
        streamerId: recording?.streamerId
      }).catch(() => {});
    } catch (e) {}
  }

  // ⭐ v3.5.10: 대기 중인 탭 종료 해제
  if (state.pendingTabClose.has(tabId)) {
    const pending = state.pendingTabClose.get(tabId);
    clearTimeout(pending.timeoutId);
    pending.resolve(false);  // 탭이 이미 닫혔으므로 false
    state.pendingTabClose.delete(tabId);
  }
});

// ===== 탭 새로고침/URL 변경 감지 (녹화 상태 정리) =====

// ⭐ v3.6.7: 녹화 상태 정리 헬퍼 함수
async function cleanupRecordingState(tabId, streamerId, reason) {
  if (!state.recordings.has(tabId)) return;

  const recording = state.recordings.get(tabId);
  const elapsedTime = recording?.startTime
    ? Math.floor((Date.now() - recording.startTime) / 1000)
    : 0;

  console.warn(`[숲토킹] 녹화 상태 정리: ${streamerId} (${reason})`);

  // 녹화 상태 정리
  state.recordings.delete(tabId);
  await removeRecordingFromStorage(tabId);
  updateBadge();

  // 대기 중인 탭 종료 해제
  if (state.pendingTabClose.has(tabId)) {
    const pending = state.pendingTabClose.get(tabId);
    clearTimeout(pending.timeoutId);
    pending.resolve(false);
    state.pendingTabClose.delete(tabId);
  }

  // Side Panel에 녹화 손실 알림
  broadcastToSidepanel({
    type: 'RECORDING_LOST_BY_REFRESH',
    tabId: tabId,
    streamerId: streamerId,
    elapsedTime: elapsedTime,
    message: `${streamerId} 녹화가 ${reason}으로 인해 중단되었습니다. (${formatDuration(elapsedTime)} 분량 손실)`
  });

  console.log(`[숲토킹] 녹화 상태 정리 완료: ${streamerId}, 손실 시간: ${elapsedTime}초`);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // ⭐ v3.6.7: 탭 로딩 시작 감지 - 지연 삭제로 새로고침 취소 대응
  if (changeInfo.status === 'loading' && state.recordings.has(tabId)) {
    console.warn(`[숲토킹] 녹화 중인 탭 ${tabId} 새로고침/이동 감지 - 확인 대기`);

    const recording = state.recordings.get(tabId);
    const streamerId = recording?.streamerId || 'unknown';

    // 기존 대기 중인 삭제 타이머가 있으면 취소
    if (state.pendingRecordingCleanup?.has(tabId)) {
      clearTimeout(state.pendingRecordingCleanup.get(tabId));
    }

    // 500ms 후 페이지 상태 확인 후 삭제 결정
    const timeoutId = setTimeout(async () => {
      state.pendingRecordingCleanup?.delete(tabId);

      // 녹화 상태가 아직 존재하는지 확인
      if (!state.recordings.has(tabId)) {
        return; // 이미 다른 곳에서 정리됨
      }

      // content script에 PING으로 연결 상태 확인
      try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab || !tab.url?.includes('play.sooplive.co.kr')) {
          // 탭이 없거나 URL이 변경됨 → 실제 이동/새로고침
          await cleanupRecordingState(tabId, streamerId, '페이지 이동');
          return;
        }

        // content script PING
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' })
          .catch(() => null);

        if (!response?.success) {
          // content script 응답 없음 → 새로고침 진행됨
          await cleanupRecordingState(tabId, streamerId, '새로고침');
        } else {
          // content script 응답 있음 → 취소됨, 녹화 유지
          console.log(`[숲토킹] 탭 ${tabId} 새로고침 취소됨 - 녹화 유지`);
        }
      } catch (e) {
        // 탭 접근 실패 → 탭이 닫힘
        await cleanupRecordingState(tabId, streamerId, '탭 닫힘');
      }
    }, 500);

    // 대기 중인 타이머 저장
    if (!state.pendingRecordingCleanup) {
      state.pendingRecordingCleanup = new Map();
    }
    state.pendingRecordingCleanup.set(tabId, timeoutId);
  }

  // URL 변경 감지 (기존 VOD 리다이렉트 로직 유지)
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

// ===== 초기 설정 로드 (IIFE로 중복 방지) =====

(async function initializeExtension() {
  if (state.isInitialized) {
    console.log('[숲토킹] 이미 초기화됨 - 초기 로드 스킵');
    return;
  }
  state.isInitialized = true;

  await loadSettings();

  // ⭐ v3.5.14: Storage에서 녹화 상태 복구
  await loadRecordingsFromStorage();

  // ⭐ v3.6.0: Analytics 초기화
  await Analytics.initAnalytics();

  console.log('[숲토킹] 초기 설정 로드 완료');

  if (state.isMonitoring) {
    startMonitoring();
  }
})();

// ===== 로그 =====

console.log('[숲토킹] Background Service Worker v4.0.2 로드됨');
