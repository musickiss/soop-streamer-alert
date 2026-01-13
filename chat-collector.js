// ===== 숲토킹 v5.0.0 - Chat Collector (ISOLATED World) =====
// SOOP 채팅창 DOM 감시 및 수집

(function() {
  'use strict';

  // 중복 로드 방지
  if (window.__soopChatCollectorInstalled) return;
  window.__soopChatCollectorInstalled = true;

  // ===== 수집 모드 상수 =====
  const COLLECT_MODE = {
    OFF: 'off',           // 수집하지 않음
    ALL: 'all',           // 모든 채팅방 수집
    SELECTED: 'selected'  // 선택한 스트리머만 수집
  };

  // ===== 설정 =====
  const CONFIG = {
    BUFFER_SIZE: 100,           // 버퍼 최대 크기 (실시간성 개선)
    FLUSH_INTERVAL: 5000,       // 5초마다 강제 flush (ms) - 실시간성 개선
    ADAPTIVE_FLUSH_MIN: 2000,   // 어댑티브: 최소 flush 간격 (ms)
    ADAPTIVE_FLUSH_MAX: 10000,  // 어댑티브: 최대 flush 간격 (ms)
    RETRY_INTERVAL: 5000,       // 채팅창 탐색 재시도 간격 (ms)
    MAX_RETRY: 12,              // 최대 재시도 횟수 (1분간)

    // SOOP 채팅창 선택자 (실제 DOM 기반 - 2025.01)
    SELECTORS: {
      // 채팅 리스트 컨테이너
      chatContainer: [
        '#chat_area',
        '.chat_area'
      ],
      // 개별 채팅 아이템
      chatItem: [
        '.chatting-list-item'
      ],
      // 닉네임 요소 (button 내부의 .author)
      nickname: [
        '.author',
        '.username button[user_nick]',
        '[user_nick]'
      ],
      // 메시지 내용
      message: [
        '.msg',
        '.message-text p.msg',
        '.message-text'
      ],
      // 유저 ID 속성 (button에서 추출)
      userIdAttrs: [
        'user_id',
        'user_nick'
      ]
    }
  };

  // ===== 상태 =====
  const state = {
    isCollecting: false,
    isPaused: false,
    buffer: [],
    observer: null,
    flushIntervalId: null,
    retryCount: 0,
    sessionId: null,
    streamerId: null,
    streamerNick: null,
    chatContainer: null,
    processedIds: new Set(),  // 중복 방지용
    lastFlushTime: 0,
    // 수집 설정
    collectSettings: {
      mode: COLLECT_MODE.ALL,
      streamers: []
    },
    // 어댑티브 flush
    messageRate: 0,           // 초당 메시지 수
    lastRateCheck: 0,
    messageCountSinceCheck: 0
  };

  // ===== 유틸리티 =====
  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  // ===== 고아 수집기 정리 (Extension context 무효 시) =====
  function cleanupOrphanedCollector() {
    console.log('[숲토킹 Chat] 고아 수집기 정리 시작');

    // Observer 정리
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    // Interval 정리
    if (state.flushIntervalId) {
      clearInterval(state.flushIntervalId);
      state.flushIntervalId = null;
    }

    // 상태 초기화
    state.isCollecting = false;
    state.isPaused = false;
    state.buffer = [];
    state.chatContainer = null;
    state.processedIds.clear();

    // 전역 플래그 해제 (새 확장이 다시 설치할 수 있도록)
    window.__soopChatCollectorInstalled = false;

    console.log('[숲토킹 Chat] 고아 수집기 정리 완료');
  }

  function sanitizeText(text, maxLength = 1000) {
    if (typeof text !== 'string') return '';
    return text
      .trim()
      .replace(/\r\n|\r|\n/g, ' ')  // 줄바꿈을 공백으로 변환
      .replace(/\s+/g, ' ')          // 연속 공백을 단일 공백으로
      .slice(0, maxLength)
      .replace(/[\x00-\x1F]/g, '');  // 제어 문자 제거
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  // v5.4.0: 방송 경과 시간 추출
  function getBroadcastElapsedTime() {
    const timeEl = document.querySelector('li.time span');
    return timeEl ? timeEl.textContent : null;
  }

  function generateId() {
    return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===== DOM 탐색 =====
  function findElement(parent, selectors) {
    if (!parent || !selectors) return null;
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of selectorArray) {
      try {
        const element = parent.querySelector(selector);
        if (element) return element;
      } catch (e) {
        // 잘못된 선택자 무시
      }
    }
    return null;
  }

  function findAttribute(element, attrs) {
    if (!element || !attrs) return null;
    const attrArray = Array.isArray(attrs) ? attrs : [attrs];

    for (const attr of attrArray) {
      const value = element.getAttribute(attr);
      if (value) return value;
    }
    return null;
  }

  function isChatItem(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    for (const selector of CONFIG.SELECTORS.chatItem) {
      try {
        if (element.matches(selector)) return true;
      } catch (e) {
        // 잘못된 선택자 무시
      }
    }
    return false;
  }

  // ===== 채팅창 찾기 =====
  function findChatContainer() {
    for (const selector of CONFIG.SELECTORS.chatContainer) {
      try {
        const container = document.querySelector(selector);
        if (container) {
          console.log('[숲토킹 Chat] 채팅 컨테이너 발견:', selector);
          return container;
        }
      } catch (e) {
        // 무시
      }
    }
    return null;
  }

  // ===== 채팅 파싱 (SOOP 전용) =====
  function parseChatElement(element) {
    if (!element) return null;

    // SOOP 구조: .chatting-list-item > .message-container > .username > button[user_nick]
    //                                                     > .message-text > p.msg

    // 닉네임: button 요소에서 user_nick 속성 또는 .author 텍스트
    const userBtn = element.querySelector('.username button[user_nick]');
    const authorEl = element.querySelector('.author');

    let nickname = '';
    let userId = '';

    if (userBtn) {
      nickname = userBtn.getAttribute('user_nick') || '';
      userId = userBtn.getAttribute('user_id') || '';
    }

    // 폴백: .author 텍스트
    if (!nickname && authorEl) {
      nickname = sanitizeText(authorEl.textContent, 50);
    }

    if (!nickname) return null;

    // 메시지 찾기: .message-text p.msg
    const msgEl = element.querySelector('.msg') ||
                  element.querySelector('.message-text');
    if (!msgEl) return null;

    const message = sanitizeText(msgEl.textContent, 1000);

    if (!message) return null;

    // 중복 방지용 해시
    const contentHash = `${nickname}_${message}_${Math.floor(Date.now() / 1000)}`;
    if (state.processedIds.has(contentHash)) {
      return null;
    }
    state.processedIds.add(contentHash);

    // 메모리 관리: 오래된 해시 정리
    if (state.processedIds.size > 10000) {
      const arr = Array.from(state.processedIds);
      state.processedIds = new Set(arr.slice(-5000));
    }

    const now = new Date();
    // v5.4.0: 방송 경과 시간 추출
    const elapsedTime = getBroadcastElapsedTime();

    return {
      id: generateId(),
      timestamp: now.getTime(),
      date: formatDate(now),
      time: formatTime(now),
      elapsedTime: elapsedTime,  // v5.4.0: 방송 경과 시간 (HH:MM:SS)
      userId: sanitizeText(userId, 50),
      nickname: nickname,
      message: message,
      streamerId: state.streamerId,
      streamerNick: state.streamerNick,
      sessionId: state.sessionId
    };
  }

  // ===== MutationObserver 콜백 =====
  function handleMutations(mutations) {
    if (!state.isCollecting || state.isPaused) return;

    // Extension context 체크 (고아 상태 감지)
    if (!isExtensionContextValid()) {
      cleanupOrphanedCollector();
      return;
    }

    // ⭐ v5.0.0 버그 수정: URL과 state.streamerId 동기화 검증
    const currentUrlStreamerId = extractStreamerIdFromUrl();
    if (currentUrlStreamerId && state.streamerId && currentUrlStreamerId !== state.streamerId) {
      console.warn(`[숲토킹 Chat] URL 변경 감지 중 수집 중단: ${state.streamerId} → ${currentUrlStreamerId}`);
      stopCollecting();
      // 새 스트리머로 자동 재시작 (약간의 지연 후)
      setTimeout(autoStart, 1000);
      return;
    }

    for (const mutation of mutations) {
      // 추가된 노드 처리
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // 직접 채팅 아이템인 경우
        if (isChatItem(node)) {
          const chatData = parseChatElement(node);
          if (chatData) {
            addToBuffer(chatData);
          }
          continue;
        }

        // 하위에서 채팅 아이템 찾기
        try {
          for (const selector of CONFIG.SELECTORS.chatItem) {
            const items = node.querySelectorAll(selector);
            for (const item of items) {
              const chatData = parseChatElement(item);
              if (chatData) {
                addToBuffer(chatData);
              }
            }
          }
        } catch (e) {
          // 무시
        }
      }
    }
  }

  // ===== 버퍼 관리 =====
  function addToBuffer(chatData) {
    state.buffer.push(chatData);
    state.messageCountSinceCheck++;

    // 메시지 속도 계산 (어댑티브 flush용)
    const now = Date.now();
    const elapsed = now - state.lastRateCheck;
    if (elapsed >= 5000) { // 5초마다 속도 체크
      state.messageRate = (state.messageCountSinceCheck / elapsed) * 1000; // 초당 메시지 수
      state.messageCountSinceCheck = 0;
      state.lastRateCheck = now;
    }

    // 버퍼 크기 초과 시 즉시 flush
    if (state.buffer.length >= CONFIG.BUFFER_SIZE) {
      flushBuffer();
      return;
    }

    // 어댑티브 flush: 메시지가 적을 때는 더 빠르게 전송
    const timeSinceLastFlush = now - state.lastFlushTime;
    const adaptiveInterval = getAdaptiveFlushInterval();

    if (timeSinceLastFlush >= adaptiveInterval && state.buffer.length > 0) {
      flushBuffer();
    }
  }

  // ===== 어댑티브 flush 간격 계산 =====
  function getAdaptiveFlushInterval() {
    // 메시지 속도에 따라 flush 간격 조정
    // 속도가 빠르면 간격 늘림 (배치 효율), 느리면 간격 줄임 (실시간성)
    if (state.messageRate > 50) {
      // 초당 50건 이상: 10초 간격 (대량 채팅)
      return CONFIG.ADAPTIVE_FLUSH_MAX;
    } else if (state.messageRate > 10) {
      // 초당 10-50건: 5초 간격 (보통)
      return CONFIG.FLUSH_INTERVAL;
    } else if (state.messageRate > 2) {
      // 초당 2-10건: 3초 간격
      return 3000;
    } else {
      // 초당 2건 미만: 2초 간격 (실시간성 중시)
      return CONFIG.ADAPTIVE_FLUSH_MIN;
    }
  }

  // ===== 버퍼 flush (Background로 전송) =====
  async function flushBuffer() {
    if (state.buffer.length === 0) return;
    if (!isExtensionContextValid()) {
      console.warn('[숲토킹 Chat] Extension context 무효, 수집 중지');
      // 컨텍스트 무효 시 완전히 정리
      cleanupOrphanedCollector();
      return;
    }

    const messages = [...state.buffer];
    state.buffer = [];
    state.lastFlushTime = Date.now();

    try {
      await chrome.runtime.sendMessage({
        type: 'CHAT_MESSAGES_BATCH',
        messages: messages,
        sessionId: state.sessionId,
        streamerId: state.streamerId
      });

      // 디버그 로그 (속도 정보 포함)
      if (state.messageRate > 0) {
        console.log(`[숲토킹 Chat] ${messages.length}건 전송 (${state.messageRate.toFixed(1)}msg/s)`);
      } else {
        console.log(`[숲토킹 Chat] ${messages.length}건 전송 완료`);
      }
    } catch (error) {
      console.error('[숲토킹 Chat] 메시지 전송 실패:', error.message);
      // 실패 시 버퍼에 다시 추가 (최대 크기 제한)
      state.buffer = [...messages, ...state.buffer].slice(0, CONFIG.BUFFER_SIZE * 2);
    }
  }

  // ===== 수집 시작 =====
  function startCollecting(streamerId, streamerNick) {
    // ⭐ v5.0.0 버그 수정: 현재 URL과 요청된 streamerId 검증
    const currentUrlStreamerId = extractStreamerIdFromUrl();
    if (currentUrlStreamerId && streamerId !== currentUrlStreamerId) {
      console.warn(`[숲토킹 Chat] URL 불일치: 요청=${streamerId}, 현재페이지=${currentUrlStreamerId}`);
      // 현재 페이지의 streamerId로 대체
      streamerId = currentUrlStreamerId;
      // 닉네임도 페이지에서 새로 추출
      streamerNick = extractStreamerNickFromPage() || streamerId;
    }

    // 이미 수집 중인 경우
    if (state.isCollecting) {
      // 같은 스트리머면 무시
      if (state.streamerId === streamerId) {
        console.log('[숲토킹 Chat] 이미 동일 스트리머 수집 중:', streamerId);
        return { success: false, reason: 'already_collecting' };
      }
      // 다른 스트리머면 기존 수집 중지 후 새로 시작
      console.log(`[숲토킹 Chat] 스트리머 변경 감지: ${state.streamerId} → ${streamerId}`);
      stopCollecting(); // 동기적으로 중지 (비동기 대기 불필요)
    }

    // 채팅 컨테이너 찾기
    state.chatContainer = findChatContainer();
    if (!state.chatContainer) {
      console.warn('[숲토킹 Chat] 채팅 컨테이너를 찾을 수 없습니다. 재시도...');

      if (state.retryCount < CONFIG.MAX_RETRY) {
        state.retryCount++;
        setTimeout(() => {
          startCollecting(streamerId, streamerNick);
        }, CONFIG.RETRY_INTERVAL);
        return { success: false, reason: 'container_not_found', retry: true };
      } else {
        state.retryCount = 0;
        return { success: false, reason: 'container_not_found', retry: false };
      }
    }

    state.retryCount = 0;
    state.isCollecting = true;
    state.isPaused = false;
    state.streamerId = streamerId;
    state.streamerNick = streamerNick;
    state.sessionId = `session_${Date.now()}`;
    state.buffer = [];
    state.processedIds.clear();
    state.lastFlushTime = Date.now();

    // MutationObserver 시작
    state.observer = new MutationObserver(handleMutations);
    state.observer.observe(state.chatContainer, {
      childList: true,
      subtree: true
    });

    // 주기적 flush
    state.flushIntervalId = setInterval(() => {
      if (state.isCollecting && !state.isPaused && state.buffer.length > 0) {
        flushBuffer();
      }
    }, CONFIG.FLUSH_INTERVAL);

    // 세션 시작 알림
    if (isExtensionContextValid()) {
      chrome.runtime.sendMessage({
        type: 'CHAT_SESSION_START',
        sessionId: state.sessionId,
        streamerId: streamerId,
        streamerNick: streamerNick,
        startTime: Date.now()
      }).catch(() => {});
    }

    console.log(`[숲토킹 Chat] 수집 시작: ${streamerId} (${streamerNick})`);
    return { success: true, sessionId: state.sessionId };
  }

  // ===== 수집 중지 =====
  async function stopCollecting() {
    if (!state.isCollecting) {
      return { success: false, reason: 'not_collecting' };
    }

    state.isCollecting = false;

    // Observer 중지
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    // Interval 정리
    if (state.flushIntervalId) {
      clearInterval(state.flushIntervalId);
      state.flushIntervalId = null;
    }

    // 최종 flush
    await flushBuffer();

    // 세션 종료 알림
    if (isExtensionContextValid()) {
      try {
        await chrome.runtime.sendMessage({
          type: 'CHAT_SESSION_END',
          sessionId: state.sessionId,
          streamerId: state.streamerId,
          endTime: Date.now()
        });
      } catch (e) {
        console.log('[숲토킹 Chat] 세션 종료 알림 전송 실패:', e.message);
      }
    }

    const sessionId = state.sessionId;
    state.sessionId = null;
    state.streamerId = null;
    state.streamerNick = null;
    state.chatContainer = null;

    // M-2: processedIds Set 정리 (메모리 누수 방지)
    state.processedIds.clear();

    console.log('[숲토킹 Chat] 수집 중지');
    return { success: true, sessionId };
  }

  // ===== 일시정지/재개 =====
  function pauseCollecting() {
    if (!state.isCollecting) return { success: false };
    state.isPaused = true;
    console.log('[숲토킹 Chat] 수집 일시정지');
    return { success: true };
  }

  function resumeCollecting() {
    if (!state.isCollecting) return { success: false };
    state.isPaused = false;
    console.log('[숲토킹 Chat] 수집 재개');
    return { success: true };
  }

  // ===== 상태 조회 =====
  function getStatus() {
    return {
      isCollecting: state.isCollecting,
      isPaused: state.isPaused,
      bufferSize: state.buffer.length,
      sessionId: state.sessionId,
      streamerId: state.streamerId,
      streamerNick: state.streamerNick,
      hasContainer: !!state.chatContainer
    };
  }

  // ===== 메시지 리스너 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isExtensionContextValid()) {
      sendResponse({ success: false, error: 'Extension context invalidated' });
      return true;
    }

    switch (message.type) {
      case 'START_CHAT_COLLECTION':
        const startResult = startCollecting(message.streamerId, message.streamerNick);
        sendResponse(startResult);
        return true;

      case 'STOP_CHAT_COLLECTION':
        stopCollecting().then(result => {
          sendResponse(result);
        });
        return true; // 비동기 응답

      case 'PAUSE_CHAT_COLLECTION':
        sendResponse(pauseCollecting());
        return true;

      case 'RESUME_CHAT_COLLECTION':
        sendResponse(resumeCollecting());
        return true;

      case 'GET_CHAT_COLLECTION_STATUS':
        sendResponse(getStatus());
        return true;

      case 'CHAT_SETTINGS_CHANGED':
        // 설정 변경 시 처리
        if (message.settings) {
          const oldMode = state.collectSettings.mode;
          state.collectSettings.mode = message.settings.collectMode || COLLECT_MODE.ALL;
          state.collectSettings.streamers = message.settings.collectStreamers || [];

          console.log('[숲토킹 Chat] 설정 변경됨:', state.collectSettings);

          // 현재 수집 중인 경우, 설정에 따라 중지 여부 결정
          if (state.isCollecting && state.streamerId) {
            if (!shouldCollect(state.streamerId)) {
              console.log('[숲토킹 Chat] 설정 변경으로 수집 중지:', state.streamerId);
              stopCollecting();
            }
          } else if (!state.isCollecting && state.collectSettings.mode !== COLLECT_MODE.OFF) {
            // 수집 중이 아니고, 새 모드가 OFF가 아니면 자동 시작 시도
            console.log('[숲토킹 Chat] 설정 변경으로 수집 재시작 시도');
            autoStart();
          }
        }
        sendResponse({ success: true });
        return true;

      case 'CHAT_COLLECTION_TOGGLE':
        // 수집 활성화/비활성화 (레거시 호환)
        if (message.enabled === false) {
          state.collectSettings.mode = COLLECT_MODE.OFF;
          if (state.isCollecting) {
            stopCollecting();
          }
        } else {
          state.collectSettings.mode = COLLECT_MODE.ALL;
          if (!state.isCollecting) {
            autoStart();
          }
        }
        sendResponse({ success: true });
        return true;
    }

    return false;
  });

  // ===== 페이지 언로드 시 안전 저장 =====
  window.addEventListener('beforeunload', () => {
    if (state.isCollecting && state.buffer.length > 0) {
      // 동기적으로 최대한 저장 시도 (sendBeacon 사용 불가, 메시지 전송 시도)
      if (isExtensionContextValid()) {
        chrome.runtime.sendMessage({
          type: 'CHAT_EMERGENCY_SAVE',
          messages: state.buffer,
          sessionId: state.sessionId,
          streamerId: state.streamerId
        }).catch(() => {});
      }
    }
  });

  // ===== visibilitychange 시 flush =====
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.isCollecting && state.buffer.length > 0) {
      flushBuffer();
    }
  });

  // ===== URL에서 스트리머 ID 추출 =====
  function extractStreamerIdFromUrl() {
    const match = window.location.pathname.match(/^\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // ===== 스트리머 닉네임 추출 =====
  function extractStreamerNickFromPage() {
    // 여러 위치에서 닉네임 찾기 시도
    const selectors = [
      // v5.4.0: SOOP 2025년 레이아웃 (우선순위 높음)
      '.broadcast_header .nick',
      '.header_wrap .nick',
      '.bj_info .nick_wrap .nick',
      '.player_header .nick',
      // SOOP 플레이어 페이지 셀렉터
      '.broadcast_title .nick',
      '.streamer_info .nick',
      '.player-info .nick',
      '[class*="streamer"] .nick',
      '.header_info .nick',
      'h1.nick',
      '.nick_name',
      // 추가 셀렉터 (SOOP 레이아웃 변경 대응)
      '.info_area .nick',
      '.bj_info .nick',
      '.broadcast_info .nick',
      '[data-testid="streamer-nick"]',
      '.channel_info .nick',
      '.live_info .nick'
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const nick = el.textContent.trim();
          console.log(`[숲토킹 Chat] 닉네임 추출 성공 (${selector}):`, nick);
          return nick;
        }
      } catch (e) {}
    }

    // 페이지 타이틀에서 추출 시도 (여러 패턴)
    const title = document.title;
    const titlePatterns = [
      /^(.+?)(?:\s*[-|]|의\s*방송)/,
      /^(.+?)\s*-\s*SOOP/,
      /^(.+?)\s*\|\s*SOOP/
    ];

    for (const pattern of titlePatterns) {
      const match = title.match(pattern);
      if (match && match[1].trim()) {
        const nick = match[1].trim();
        console.log('[숲토킹 Chat] 닉네임 추출 성공 (title):', nick);
        return nick;
      }
    }

    console.log('[숲토킹 Chat] 닉네임 추출 실패, 폴백 사용');
    return null;
  }

  // v5.4.0: 저장된 설정에서 스트리머 닉네임 찾기
  function getStreamerNickFromSettings(streamerId) {
    const { streamers } = state.collectSettings;
    if (!streamers || streamers.length === 0) return null;

    const found = streamers.find(s =>
      s.id === streamerId || s.id?.toLowerCase() === streamerId?.toLowerCase()
    );
    if (found?.nickname && found.nickname !== found.id) {
      console.log(`[숲토킹 Chat] 닉네임 설정에서 찾음: ${found.nickname}`);
      return found.nickname;
    }
    return null;
  }

  // v5.4.0: background.js의 favoriteStreamers에서 닉네임 조회
  async function getStreamerNickFromBackground(streamerId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_STREAMER_NICKNAME',
        streamerId: streamerId
      });
      if (response?.success && response?.nickname) {
        console.log(`[숲토킹 Chat] 닉네임 background에서 찾음: ${response.nickname}`);
        return response.nickname;
      }
    } catch (e) {
      console.log('[숲토킹 Chat] background 닉네임 조회 실패:', e.message);
    }
    return null;
  }

  // ===== 수집 가능 여부 확인 =====
  function shouldCollect(streamerId) {
    const { mode, streamers } = state.collectSettings;

    if (mode === COLLECT_MODE.OFF) {
      return false;
    }

    if (mode === COLLECT_MODE.ALL) {
      return true;
    }

    if (mode === COLLECT_MODE.SELECTED) {
      return streamers.some(s => s.id === streamerId || s.id.toLowerCase() === streamerId.toLowerCase());
    }

    return false;
  }

  // ===== 설정 로드 =====
  async function loadSettings() {
    try {
      // v5.4.0: chrome.storage.local에서 직접 읽기 (background.js 의존성 제거)
      // 이렇게 하면 사이드패널 없이도 설정을 바로 읽을 수 있음
      const storageData = await chrome.storage.local.get(['chatCollectMode', 'chatCollectStreamers']);

      if (storageData.chatCollectMode !== undefined) {
        state.collectSettings.mode = storageData.chatCollectMode || COLLECT_MODE.ALL;
        state.collectSettings.streamers = storageData.chatCollectStreamers || [];
        console.log('[숲토킹 Chat] 설정 로드됨 (storage):', state.collectSettings);
        return true;
      }

      // 폴백: background.js에 요청
      const response = await chrome.runtime.sendMessage({
        type: 'GET_CHAT_COLLECTION_SETTINGS'
      });

      if (response?.success && response?.data) {
        state.collectSettings.mode = response.data.collectMode || COLLECT_MODE.ALL;
        state.collectSettings.streamers = response.data.collectStreamers || [];
        console.log('[숲토킹 Chat] 설정 로드됨 (background):', state.collectSettings);
        return true;
      }
    } catch (e) {
      console.log('[숲토킹 Chat] 설정 조회 실패, 기본값 사용:', e.message);
    }
    // 기본값: ALL 모드 (모든 채팅 수집)
    console.log('[숲토킹 Chat] 기본 설정 사용: ALL 모드');
    return false;
  }

  // ===== 자동 수집 시작 =====
  async function autoStart() {
    // 설정 로드
    await loadSettings();

    // 수집 모드 확인
    if (state.collectSettings.mode === COLLECT_MODE.OFF) {
      console.log('[숲토킹 Chat] 채팅 수집 비활성화됨 (수집 안함 모드)');
      return;
    }

    const streamerId = extractStreamerIdFromUrl();
    if (!streamerId) {
      console.log('[숲토킹 Chat] 스트리머 ID를 찾을 수 없음');
      return;
    }

    // ⭐ v5.0.0 버그 수정: 이전 세션이 다른 스트리머인 경우 정리
    if (state.isCollecting && state.streamerId && state.streamerId !== streamerId) {
      console.log(`[숲토킹 Chat] 이전 세션 정리: ${state.streamerId} → ${streamerId}`);
      await stopCollecting();
    }

    // 선택 모드일 때 스트리머 확인
    if (!shouldCollect(streamerId)) {
      console.log(`[숲토킹 Chat] 수집 대상이 아님: ${streamerId} (선택한 스트리머만 수집 모드)`);
      return;
    }

    // v5.4.0: 닉네임 추출 (우선순위: 설정 > background > 페이지 > ID 폴백)
    let streamerNick = null;

    // 1. 저장된 설정에서 닉네임 찾기 (선택 모드일 때)
    streamerNick = getStreamerNickFromSettings(streamerId);

    // 2. background.js의 favoriteStreamers에서 닉네임 찾기 (가장 신뢰할 수 있음)
    if (!streamerNick) {
      streamerNick = await getStreamerNickFromBackground(streamerId);
    }

    // 3. 페이지에서 닉네임 추출 시도
    if (!streamerNick) {
      for (let i = 0; i < 10; i++) {
        streamerNick = extractStreamerNickFromPage();
        if (streamerNick) break;
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // 4. 폴백: streamerId 사용
    if (!streamerNick) {
      streamerNick = streamerId;
      console.log('[숲토킹 Chat] 닉네임을 찾을 수 없어 ID 사용:', streamerId);
    }

    console.log(`[숲토킹 Chat] 자동 수집 시작 시도: ${streamerId} (${streamerNick})`);

    // 채팅창 로드 대기 후 수집 시작
    const result = startCollecting(streamerId, streamerNick);
    if (result.success) {
      console.log(`[숲토킹 Chat] ✅ 자동 수집 시작됨: ${streamerId}`);
    } else {
      console.log(`[숲토킹 Chat] 자동 수집 시작 실패: ${result.reason}`);
    }
  }

  // ===== 초기화 =====
  console.log('[숲토킹 Chat] Collector v5.0.0 로드됨');

  // Background에 로드 알림
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: 'CHAT_COLLECTOR_LOADED',
      url: window.location.href,
      streamerId: extractStreamerIdFromUrl()
    }).catch(() => {});

    // 페이지 로드 완료 후 자동 수집 시작
    if (document.readyState === 'complete') {
      setTimeout(autoStart, 1000);
    } else {
      window.addEventListener('load', () => {
        setTimeout(autoStart, 1000);
      });
    }
  }
})();
