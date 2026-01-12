// ===== 숲토킹 v5.0.0 - Chat Collector (ISOLATED World) =====
// SOOP 채팅창 DOM 감시 및 수집

(function() {
  'use strict';

  // 중복 로드 방지
  if (window.__soopChatCollectorInstalled) return;
  window.__soopChatCollectorInstalled = true;

  // ===== 설정 =====
  const CONFIG = {
    BUFFER_SIZE: 500,           // 버퍼 최대 크기
    FLUSH_INTERVAL: 180000,     // 3분마다 강제 flush (ms)
    RETRY_INTERVAL: 5000,       // 채팅창 탐색 재시도 간격 (ms)
    MAX_RETRY: 12,              // 최대 재시도 횟수 (1분간)

    // SOOP 채팅창 선택자 (다중 폴백)
    SELECTORS: {
      // 채팅 리스트 컨테이너
      chatContainer: [
        '#chatArea',
        '.chat_area',
        '[class*="chat_area"]',
        '.chat-list',
        '#chat-list'
      ],
      // 개별 채팅 아이템
      chatItem: [
        '.chat_list_item',
        '.chat-item',
        '[class*="chat_item"]',
        '[class*="chatItem"]'
      ],
      // 닉네임 요소
      nickname: [
        '.nickname',
        '.nick',
        '[class*="nick"]',
        '.user_nick'
      ],
      // 메시지 내용
      message: [
        '.message',
        '.msg',
        '.chat_msg',
        '[class*="message"]',
        '[class*="msg"]'
      ],
      // 유저 ID 속성
      userIdAttrs: [
        'data-user-id',
        'data-uid',
        'data-userid',
        'data-id'
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
    lastFlushTime: 0
  };

  // ===== 유틸리티 =====
  function isExtensionContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function sanitizeText(text, maxLength = 1000) {
    if (typeof text !== 'string') return '';
    return text
      .trim()
      .slice(0, maxLength)
      .replace(/[\x00-\x1F]/g, ''); // 제어 문자 제거
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

  // ===== 채팅 파싱 =====
  function parseChatElement(element) {
    if (!element) return null;

    // 닉네임 찾기
    const nickEl = findElement(element, CONFIG.SELECTORS.nickname);
    if (!nickEl) return null;

    // 메시지 찾기
    const msgEl = findElement(element, CONFIG.SELECTORS.message);
    if (!msgEl) return null;

    const nickname = sanitizeText(nickEl.textContent, 50);
    const message = sanitizeText(msgEl.textContent, 1000);

    if (!nickname || !message) return null;

    // 유저 ID (가능한 경우)
    const userId = findAttribute(nickEl, CONFIG.SELECTORS.userIdAttrs) ||
                   findAttribute(element, CONFIG.SELECTORS.userIdAttrs) || '';

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
    return {
      id: generateId(),
      timestamp: now.getTime(),
      date: formatDate(now),
      time: formatTime(now),
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

    // 버퍼 크기 초과 시 flush
    if (state.buffer.length >= CONFIG.BUFFER_SIZE) {
      flushBuffer();
    }
  }

  // ===== 버퍼 flush (Background로 전송) =====
  async function flushBuffer() {
    if (state.buffer.length === 0) return;
    if (!isExtensionContextValid()) {
      console.warn('[숲토킹 Chat] Extension context 무효, flush 스킵');
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
      console.log(`[숲토킹 Chat] ${messages.length}건 전송 완료`);
    } catch (error) {
      console.error('[숲토킹 Chat] 메시지 전송 실패:', error.message);
      // 실패 시 버퍼에 다시 추가 (최대 크기 제한)
      state.buffer = [...messages, ...state.buffer].slice(0, CONFIG.BUFFER_SIZE * 2);
    }
  }

  // ===== 수집 시작 =====
  function startCollecting(streamerId, streamerNick) {
    if (state.isCollecting) {
      console.log('[숲토킹 Chat] 이미 수집 중');
      return { success: false, reason: 'already_collecting' };
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

  // ===== 초기화 =====
  console.log('[숲토킹 Chat] Collector v5.0.0 로드됨');

  // Background에 로드 알림
  if (isExtensionContextValid()) {
    chrome.runtime.sendMessage({
      type: 'CHAT_COLLECTOR_LOADED',
      url: window.location.href,
      streamerId: extractStreamerIdFromUrl()
    }).catch(() => {});
  }
})();
