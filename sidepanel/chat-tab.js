// ===== 숲토킹 v5.4.0 - Chat Tab Module =====
// Lightweight MVC 패턴 + 통합 검색 UI

const ChatTab = (function() {
  'use strict';

  // ===== 디버그 모드 (프로덕션에서는 false) =====
  const DEBUG_MODE = false;
  const debugLog = DEBUG_MODE ? (...args) => console.log('[ChatTab]', ...args) : () => {};

  // ===== 상수 =====
  const PAGE_SIZE = 50;
  const SEARCH_DEBOUNCE = 150;  // v5.2.0: 필터 응답성 향상을 위해 감소

  // ===== Lightweight MVC 설정 =====
  const LIVE_CONFIG = {
    BUFFER_CAPACITY: 2000,    // RingBuffer 최대 용량
    MAX_DOM: 500,             // DOM 최대 개수
    CLEANUP_BATCH: 100,       // 한번에 정리할 DOM 개수
    SCROLL_THRESHOLD: 50      // 맨 아래 판정 임계값 (px)
  };

  // ===== 검색 모드 상수 (v5.2.0) =====
  const SEARCH_MODE = {
    LIVE: 'live',       // 실시간 필터 (RingBuffer)
    HISTORY: 'history'  // 과거 검색 (IndexedDB)
  };

  // ===== 수집 모드 상수 =====
  // 동기화: constants.js - COLLECT_MODE
  const COLLECT_MODE = {
    OFF: 'off',           // 수집하지 않음
    ALL: 'all',           // 모든 채팅방 수집
    SELECTED: 'selected'  // 선택한 스트리머만 수집
  };

  // ===== FilterPipeline 클래스 (v5.2.0) =====
  // Reactive Filter - 데이터 불변, 필터는 뷰일 뿐
  class FilterPipeline {
    constructor() {
      this.filters = {
        keyword: null,    // 키워드 필터 (message 내용)
        nickname: null,   // 닉네임/유저ID 필터
        streamer: null    // 스트리머 필터
      };
      this.isActive = false;
    }

    // 키워드 필터 설정
    setKeyword(keyword) {
      this.filters.keyword = keyword && keyword.trim() ? keyword.trim().toLowerCase() : null;
      this._updateActiveState();
    }

    // 닉네임 필터 설정
    setNickname(nickname) {
      this.filters.nickname = nickname && nickname.trim() ? nickname.trim().toLowerCase() : null;
      this._updateActiveState();
    }

    // 스트리머 필터 설정
    setStreamer(streamerId) {
      this.filters.streamer = streamerId || null;
      this._updateActiveState();
    }

    // 활성 상태 업데이트
    _updateActiveState() {
      this.isActive = Object.values(this.filters).some(f => f !== null);
    }

    // 단일 메시지 테스트 (통과하면 true)
    test(msg) {
      if (!this.isActive) return true;

      // 키워드 필터 (메시지 내용)
      if (this.filters.keyword) {
        const text = (msg.message || '').toLowerCase();
        if (!text.includes(this.filters.keyword)) return false;
      }

      // 닉네임 필터 (닉네임 또는 유저ID)
      if (this.filters.nickname) {
        const nick = (msg.nickname || '').toLowerCase();
        const userId = (msg.userId || '').toLowerCase();
        if (!nick.includes(this.filters.nickname) &&
            !userId.includes(this.filters.nickname)) return false;
      }

      // 스트리머 필터
      if (this.filters.streamer) {
        if (msg.streamerId !== this.filters.streamer) return false;
      }

      return true;
    }

    // 메시지 배열 필터링
    apply(messages) {
      if (!this.isActive || !messages) return messages || [];
      return messages.filter(msg => this.test(msg));
    }

    // 필터 초기화
    clear() {
      this.filters = { keyword: null, nickname: null, streamer: null };
      this.isActive = false;
    }

    // 현재 필터 상태 문자열 반환
    getStatusText() {
      if (!this.isActive) return null;
      const parts = [];
      if (this.filters.keyword) parts.push(`"${this.filters.keyword}"`);
      if (this.filters.nickname) parts.push(`@${this.filters.nickname}`);
      if (this.filters.streamer) parts.push(`#${this.filters.streamer}`);
      return parts.join(' ');
    }

    // 현재 필터 상태 객체 반환
    getFilters() {
      return { ...this.filters };
    }
  }

  // ===== RingBuffer 클래스 (Model) =====
  class RingBuffer {
    constructor(capacity = 2000) {
      this.data = [];
      this.capacity = capacity;
    }

    push(item) {
      this.data.push(item);
      if (this.data.length > this.capacity) {
        this.data.shift();
      }
    }

    pushBatch(items) {
      if (!items || items.length === 0) return;
      this.data.push(...items);
      if (this.data.length > this.capacity) {
        this.data.splice(0, this.data.length - this.capacity);
      }
    }

    getAll() { return this.data; }
    getLast(n) { return this.data.slice(-n); }
    get length() { return this.data.length; }
    clear() { this.data = []; }

    filter(predicate) {
      return this.data.filter(predicate);
    }
  }

  // ===== SimpleRenderer 클래스 (View) =====
  class SimpleRenderer {
    constructor(container, maxDOM = 500, cleanupBatch = 100) {
      this.container = container;
      this.maxDOM = maxDOM;
      this.cleanupBatch = cleanupBatch;
      this.lastDate = null;
    }

    append(messages) {
      if (!this.container || !messages || messages.length === 0) return;

      const fragment = document.createDocumentFragment();

      for (const msg of messages) {
        // 날짜 구분선
        if (msg.date !== this.lastDate) {
          this.lastDate = msg.date;
          fragment.appendChild(this.createDateDivider(msg.date));
        }
        fragment.appendChild(this.createMessageDOM(msg));
      }

      this.container.appendChild(fragment);
    }

    cleanup() {
      if (!this.container) return;
      const excess = this.container.children.length - this.maxDOM;
      if (excess > 0) {
        const toRemove = Math.min(excess + this.cleanupBatch, this.container.children.length - 10);
        for (let i = 0; i < toRemove; i++) {
          if (this.container.firstChild) {
            this.container.firstChild.remove();
          }
        }
        // 날짜 상태 리셋 (정리 후 첫 메시지에서 날짜 구분선 다시 표시될 수 있도록)
        this.lastDate = null;
      }
    }

    clear() {
      if (this.container) {
        this.container.innerHTML = '';
      }
      this.lastDate = null;
    }

    createMessageDOM(msg) {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.dataset.id = msg.id;
      div.dataset.timestamp = msg.timestamp;

      const streamerDisplay = msg.streamerNick || msg.streamerId || '';
      const userIdHtml = msg.userId ? `<span class="msg-userid">(${this.escapeHtml(msg.userId)})</span>` : '';

      // v5.4.0: 경과 시간 표시 (있는 경우에만)
      const elapsedHtml = msg.elapsedTime ? `<span class="msg-elapsed">${msg.elapsedTime}</span>` : '';

      div.innerHTML = `
        <div class="msg-header">
          <span class="msg-time">${msg.time || ''}</span>
          ${elapsedHtml}
          <span class="msg-streamer">${this.escapeHtml(streamerDisplay)}</span>
        </div>
        <div class="msg-body">
          <span class="msg-nick">${this.escapeHtml(msg.nickname || '')}</span>
          ${userIdHtml}
          <span class="msg-text">${this.escapeHtml(msg.message || '')}</span>
        </div>
      `;

      return div;
    }

    createDateDivider(date) {
      const div = document.createElement('div');
      div.className = 'chat-date-divider';

      const dateObj = new Date(date);
      const dayNames = [
        getMessage('daySun') || '일',
        getMessage('dayMon') || '월',
        getMessage('dayTue') || '화',
        getMessage('dayWed') || '수',
        getMessage('dayThu') || '목',
        getMessage('dayFri') || '금',
        getMessage('daySat') || '토'
      ];
      const dayName = dayNames[dateObj.getDay()];

      div.innerHTML = `<span class="date-text">${date} (${dayName})</span>`;
      return div;
    }

    escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // ===== ChatLiveView 클래스 (Controller) =====
  // v5.2.0: FilterPipeline 통합
  class ChatLiveView {
    constructor(listSelector, scrollContainerSelector = null) {
      this.listSelector = listSelector;
      this.scrollContainerSelector = scrollContainerSelector;
      this.listContainer = null;      // 메시지가 추가될 컨테이너 (#chatList)
      this.scrollContainer = null;    // 스크롤 이벤트 대상 (#chatListContainer)
      this.buffer = new RingBuffer(LIVE_CONFIG.BUFFER_CAPACITY);
      this.renderer = null;
      this.filterPipeline = new FilterPipeline();  // v5.2.0: 필터 파이프라인
      this.isAtBottom = true;
      this.newMessageCount = 0;
      this.scrollListenerBound = null;
      this.onNewMessageCallback = null;
      this.onFilterChangeCallback = null;  // v5.2.0: 필터 변경 콜백
    }

    init() {
      this.listContainer = document.querySelector(this.listSelector);
      if (!this.listContainer) {
        console.warn('[ChatLiveView] List container not found:', this.listSelector);
        return false;
      }

      // 스크롤 컨테이너 설정 (지정되지 않으면 리스트 컨테이너의 부모 사용)
      if (this.scrollContainerSelector) {
        this.scrollContainer = document.querySelector(this.scrollContainerSelector);
      } else {
        this.scrollContainer = this.listContainer.parentElement;
      }

      if (!this.scrollContainer) {
        console.warn('[ChatLiveView] Scroll container not found');
        this.scrollContainer = this.listContainer;
      }

      this.renderer = new SimpleRenderer(
        this.listContainer,
        LIVE_CONFIG.MAX_DOM,
        LIVE_CONFIG.CLEANUP_BATCH
      );

      this.setupScrollListener();
      debugLog('[LiveView] 초기화 완료 (list:', this.listSelector, ', scroll:', this.scrollContainerSelector || 'parent)');
      return true;
    }

    setupScrollListener() {
      if (!this.scrollContainer) return;

      this.scrollListenerBound = () => {
        const { scrollTop, scrollHeight, clientHeight } = this.scrollContainer;
        const wasAtBottom = this.isAtBottom;
        this.isAtBottom = scrollHeight - scrollTop - clientHeight < LIVE_CONFIG.SCROLL_THRESHOLD;

        // 맨 아래로 도달하면 새 메시지 카운트 리셋
        if (this.isAtBottom && !wasAtBottom) {
          this.newMessageCount = 0;
          this.hideToastButton();
        }
      };

      this.scrollContainer.addEventListener('scroll', this.scrollListenerBound, { passive: true });
    }

    // ===== v5.2.0: 필터 설정 메서드 =====
    setFilter(type, value) {
      switch (type) {
        case 'keyword':
          this.filterPipeline.setKeyword(value);
          break;
        case 'nickname':
          this.filterPipeline.setNickname(value);
          break;
        case 'streamer':
          this.filterPipeline.setStreamer(value);
          break;
      }
      this.rerender();
      this._notifyFilterChange();
    }

    clearFilter() {
      this.filterPipeline.clear();
      this.rerender();
      this._notifyFilterChange();
    }

    isFilterActive() {
      return this.filterPipeline.isActive;
    }

    getFilterStatus() {
      return this.filterPipeline.getStatusText();
    }

    // 필터 적용하여 전체 다시 렌더링
    rerender() {
      // v5.2.1 디버그: DOM 요소 유효성 확인
      if (!this.renderer || !this.renderer.container) {
        console.warn('[ChatLiveView] rerender 실패: renderer 또는 container가 없음');
        return;
      }

      // DOM이 실제로 문서에 연결되어 있는지 확인
      if (!document.body.contains(this.renderer.container)) {
        console.warn('[ChatLiveView] rerender 실패: container가 DOM에 연결되지 않음, 재초기화 필요');
        // DOM 참조 업데이트 시도
        const newContainer = document.querySelector(this.listSelector);
        if (newContainer) {
          this.listContainer = newContainer;
          this.renderer.container = newContainer;
          debugLog('[LiveView] container 참조 업데이트 완료');
        } else {
          return;
        }
      }

      this.renderer.clear();
      const allMessages = this.buffer.getAll();
      const filtered = this.filterPipeline.apply(allMessages);

      if (filtered.length > 0) {
        this.renderer.append(filtered);
      }

      this.scrollToBottom();
      debugLog(`[LiveView] rerender: ${allMessages.length}개 중 ${filtered.length}개 표시`);
    }

    _notifyFilterChange() {
      if (this.onFilterChangeCallback) {
        this.onFilterChangeCallback(
          this.filterPipeline.isActive,
          this.filterPipeline.getStatusText()
        );
      }
    }

    setOnFilterChangeCallback(callback) {
      this.onFilterChangeCallback = callback;
    }
    // ===== 필터 설정 메서드 끝 =====

    onMessages(messages) {
      if (!messages || messages.length === 0) return;

      // 빈 상태 메시지 숨기기 (새 메시지 수신 시)
      const emptyEl = document.getElementById('chatEmpty');
      if (emptyEl) emptyEl.style.display = 'none';

      // 1. 원본 데이터 저장 (항상)
      this.buffer.pushBatch(messages);

      // 2. 필터 적용 (v5.2.0)
      const filtered = this.filterPipeline.apply(messages);

      // v5.2.1: DOM 참조 유효성 확인
      if (this.renderer && !document.body.contains(this.renderer.container)) {
        const newContainer = document.querySelector(this.listSelector);
        if (newContainer) {
          this.listContainer = newContainer;
          this.renderer.container = newContainer;
        }
      }

      // 3. 렌더링 (필터 통과한 것만, 맨 아래일 때만)
      if (this.isAtBottom) {
        if (filtered.length > 0) {
          this.renderer.append(filtered);
          this.renderer.cleanup();
        }
        this.scrollToBottom();
      } else {
        // 스크롤이 위에 있으면 필터된 메시지 수만 카운트
        this.newMessageCount += filtered.length;
        if (filtered.length > 0) {
          this.updateToastButton();
        }
      }

      // 콜백 호출 (통계 업데이트 등)
      if (this.onNewMessageCallback) {
        this.onNewMessageCallback(filtered.length, this.buffer.length);
      }
    }

    scrollToBottom() {
      if (this.scrollContainer) {
        this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
      }
    }

    updateToastButton() {
      const toastBtn = document.getElementById('chatFabBtn');
      if (!toastBtn) return;

      if (this.newMessageCount > 0) {
        toastBtn.classList.add('visible', 'has-new');
        const countEl = toastBtn.querySelector('.toast-count');
        if (countEl) {
          countEl.textContent = this.newMessageCount > 99 ? '99+' : this.newMessageCount;
          countEl.style.display = 'inline-flex';
        }
      }
    }

    hideToastButton() {
      const toastBtn = document.getElementById('chatFabBtn');
      if (toastBtn) {
        toastBtn.classList.remove('visible', 'has-new');
      }
    }

    goToLatest() {
      this.newMessageCount = 0;
      this.hideToastButton();
      this.scrollToBottom();
    }

    clear() {
      this.buffer.clear();
      if (this.renderer) {
        this.renderer.clear();
      }
      this.newMessageCount = 0;
      this.isAtBottom = true;
    }

    destroy() {
      if (this.scrollContainer && this.scrollListenerBound) {
        this.scrollContainer.removeEventListener('scroll', this.scrollListenerBound);
      }
      this.listContainer = null;
      this.scrollContainer = null;
      this.renderer = null;
      this.scrollListenerBound = null;
    }

    getBufferLength() {
      return this.buffer.length;
    }

    setOnNewMessageCallback(callback) {
      this.onNewMessageCallback = callback;
    }
  }

  // ===== LiveView 인스턴스 =====
  let liveView = null;

  // ===== 상태 =====
  const state = {
    isInitialized: false,
    isVisible: false,
    isLoading: false,
    flexSearch: null,
    results: [],
    currentPage: 1,
    totalCount: 0,
    selectedPeriod: '1m',
    searchQuery: '',
    advancedOpen: false,
    settingsOpen: false,  // 설정 패널 열림 상태
    // v5.2.0: 검색 모드 추가
    searchMode: SEARCH_MODE.LIVE,  // 'live' | 'history'
    advancedFilters: {
      nicknames: [],
      keywords: '',
      dateStart: '',
      dateEnd: '',
      streamer: ''
    },
    streamers: [],
    datesWithData: [],
    collectionStatus: {
      isCollecting: false,
      streamerId: null,
      bufferSize: 0
    },
    settings: {
      collectMode: COLLECT_MODE.SELECTED,      // 수집 모드 (기본값: 선택한 스트리머)
      collectStreamers: [],                // 선택된 스트리머 목록 (selected 모드용)
      retentionDays: 90
    },
    // 새 메시지 알림 (liveView와 동기화)
    newMessageCount: 0
  };

  let searchDebounceTimer = null;
  let statusUpdateInterval = null;

  // ===== 초기화 =====
  async function init() {
    if (state.isInitialized) return;

    debugLog('초기화 시작');

    try {
      // ChatStorage 초기화 (SQLite 우선, IndexedDB 폴백)
      await ChatStorage.init();
      debugLog(`저장소 모드: ${ChatStorage.getStorageType()}`);

      // 자동 백업 스케줄 체크
      if (typeof BackupManager !== 'undefined') {
        BackupManager.runScheduledBackup().catch(e => {
          console.warn('[ChatTab] 백업 스케줄 체크 실패:', e);
        });
      }

      // FlexSearch 초기화
      if (typeof FlexSearch !== 'undefined') {
        state.flexSearch = new FlexSearch.Index({
          tokenize: 'forward',
          resolution: 9
        });
      }

      // 설정 로드
      await loadSettings();

      // 스트리머 목록 로드
      state.streamers = await ChatStorage.getStreamers();

      // 데이터 있는 날짜 로드
      state.datesWithData = await ChatStorage.getDatesWithData();

      state.isInitialized = true;
      debugLog('초기화 완료');
    } catch (error) {
      console.error('[ChatTab] 초기화 실패:', error);
    }
  }

  // ===== 설정 로드/저장 =====
  async function loadSettings() {
    try {
      const collectMode = await ChatStorage.getSetting('collectMode', COLLECT_MODE.SELECTED);
      const collectStreamers = await ChatStorage.getSetting('collectStreamers', []);
      const retentionDays = await ChatStorage.getSetting('retentionDays', 90);
      state.settings = { collectMode, collectStreamers, retentionDays };
      debugLog('설정 로드됨:', state.settings);

      // v5.4.0: chrome.storage.local에도 동기화 (background.js가 사이드패널 없이도 설정 읽을 수 있도록)
      // 이렇게 하면 사용자가 채팅 탭을 클릭하지 않아도 background.js가 설정을 알 수 있음
      await chrome.storage.local.set({
        chatCollectMode: collectMode,
        chatCollectStreamers: collectStreamers
      });
      debugLog('chrome.storage.local 동기화 완료');
    } catch (e) {
      console.error('[ChatTab] 설정 로드 실패:', e);
    }
  }

  async function saveSettings() {
    try {
      await ChatStorage.saveSetting('collectMode', state.settings.collectMode);
      await ChatStorage.saveSetting('collectStreamers', state.settings.collectStreamers);
      await ChatStorage.saveSetting('retentionDays', state.settings.retentionDays);

      // v5.4.0: chrome.storage.local에도 직접 저장 (background.js와 동기화)
      // background.js가 chatCollectMode, chatCollectStreamers 키로 설정을 읽음
      await chrome.storage.local.set({
        chatCollectMode: state.settings.collectMode,
        chatCollectStreamers: state.settings.collectStreamers
      });

      // Background에 설정 변경 알림
      await chrome.runtime.sendMessage({
        type: 'CHAT_SETTINGS_CHANGED',
        settings: {
          collectMode: state.settings.collectMode,
          collectStreamers: state.settings.collectStreamers
        }
      });

      debugLog('설정 저장됨:', state.settings);
    } catch (e) {
      console.error('[ChatTab] 설정 저장 실패:', e);
    }
  }

  // ===== 스트리머 채팅 수집 토글 =====
  function toggleStreamerCollect(streamerId, streamerNick) {
    const idx = state.settings.collectStreamers.findIndex(s => s.id === streamerId);
    if (idx >= 0) {
      state.settings.collectStreamers.splice(idx, 1);
    } else {
      state.settings.collectStreamers.push({ id: streamerId, nickname: streamerNick || streamerId });
    }
    saveSettings();
    renderSettings();
  }

  function isStreamerSelected(streamerId) {
    return state.settings.collectStreamers.some(s => s.id === streamerId);
  }

  // ===== 스트리머 닉네임 업데이트 =====
  function updateStreamerNickname(streamerId, newNickname) {
    if (!streamerId || !newNickname) return;

    let updated = false;

    // 1. collectStreamers 설정 업데이트
    const settingsIndex = state.settings.collectStreamers.findIndex(
      s => s.id.toLowerCase() === streamerId.toLowerCase()
    );

    if (settingsIndex !== -1) {
      const currentStreamer = state.settings.collectStreamers[settingsIndex];
      // 닉네임이 없거나 ID와 동일한 경우에만 업데이트
      if (!currentStreamer.nickname || currentStreamer.nickname === currentStreamer.id) {
        state.settings.collectStreamers[settingsIndex].nickname = newNickname;
        saveSettings();
        updated = true;
      }
    }

    // 2. state.streamers (DB 스트리머 목록) 업데이트
    const streamersIndex = state.streamers.findIndex(
      s => s.id.toLowerCase() === streamerId.toLowerCase()
    );

    if (streamersIndex !== -1) {
      const currentStreamer = state.streamers[streamersIndex];
      if (!currentStreamer.nickname || currentStreamer.nickname === currentStreamer.id) {
        state.streamers[streamersIndex].nickname = newNickname;
        updated = true;
      }
    } else {
      // 스트리머가 목록에 없으면 추가
      state.streamers.push({ id: streamerId, nickname: newNickname });
      updated = true;
    }

    if (updated) {
      debugLog('스트리머 닉네임 업데이트:', streamerId, '->', newNickname);

      // 설정 패널이 열려있으면 UI 갱신
      if (state.settingsOpen) {
        renderSettings();
      }

      // v5.2.1: 스트리머 칩 갱신
      updateStreamerChips();
    }
  }

  // ===== 탭 표시 =====
  async function show() {
    if (!state.isInitialized) {
      await init();
    }

    state.isVisible = true;
    render();

    // v5.2.1 버그 수정: render()가 DOM을 재생성하므로 liveView도 재초기화 필요
    // 기존 liveView의 버퍼 데이터는 보존하고 DOM 참조만 업데이트
    if (liveView) {
      const savedBuffer = liveView.buffer.getAll();
      const savedFilters = liveView.filterPipeline.getFilters();
      liveView.destroy();
      liveView = null;

      initLiveView();

      if (liveView && savedBuffer.length > 0) {
        liveView.buffer.pushBatch(savedBuffer);
        // 필터 상태 복원
        if (savedFilters.keyword) liveView.filterPipeline.setKeyword(savedFilters.keyword);
        if (savedFilters.nickname) liveView.filterPipeline.setNickname(savedFilters.nickname);
        if (savedFilters.streamer) liveView.filterPipeline.setStreamer(savedFilters.streamer);
        liveView.rerender();
      }
    }

    bindEvents();

    // v5.2.1: 스트리머 칩 업데이트
    updateStreamerChips();

    // 수집 상태 주기적 업데이트
    updateCollectionStatus();
    statusUpdateInterval = setInterval(updateCollectionStatus, 5000);

    // 최근 데이터 로드 (LIVE 모드에서 버퍼가 있으면 스킵)
    // v5.2.1: 실시간 채팅 중 탭 전환 시 버퍼 데이터 유지
    if (!liveView || liveView.buffer.length === 0) {
      await loadRecentData();
    }
  }

  // ===== 탭 숨김 =====
  function hide() {
    state.isVisible = false;

    // H-3: 검색 debounce 타이머 정리
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    if (statusUpdateInterval) {
      clearInterval(statusUpdateInterval);
      statusUpdateInterval = null;
    }
  }

  // ===== 수집 상태 업데이트 =====
  async function updateCollectionStatus() {
    try {
      // Background를 통해 상태 조회
      const response = await chrome.runtime.sendMessage({
        type: 'GET_CHAT_COLLECTION_STATUS_FROM_TABS'
      });

      if (response?.success && response.status) {
        state.collectionStatus = {
          isCollecting: response.status.isCollecting || false,
          streamerId: response.status.streamerId || null,
          streamerNick: response.status.streamerNick || null,
          bufferSize: response.status.bufferSize || 0,
          isPaused: response.status.isPaused || false
        };
      } else {
        state.collectionStatus = {
          isCollecting: false,
          streamerId: null,
          streamerNick: null,
          bufferSize: 0,
          isPaused: false
        };
      }

      // UI 업데이트
      updateStatusUI();
    } catch (e) {
      console.error('[ChatTab] 상태 업데이트 실패:', e);
      state.collectionStatus = {
        isCollecting: false,
        streamerId: null,
        streamerNick: null,
        bufferSize: 0,
        isPaused: false
      };
      updateStatusUI();
    }
  }

  // ===== 상태 UI 업데이트 =====
  function updateStatusUI() {
    const statusDot = document.querySelector('.chat-status-dot');
    const statusText = document.getElementById('chatStatusText');
    const toggleBtn = document.getElementById('chatCollectToggle');

    if (!statusDot || !statusText) return;

    if (state.collectionStatus.isCollecting) {
      statusDot.classList.add('active');
      statusDot.classList.remove('paused');

      if (state.collectionStatus.isPaused) {
        statusDot.classList.add('paused');
        statusText.textContent = `일시정지: ${state.collectionStatus.streamerNick || state.collectionStatus.streamerId}`;
      } else {
        statusText.textContent = `수집 중: ${state.collectionStatus.streamerNick || state.collectionStatus.streamerId} (${state.collectionStatus.bufferSize}건)`;
      }
    } else {
      statusDot.classList.remove('active', 'paused');
      statusText.textContent = getMessage('chatNotCollecting') || '수집 대기 중';
    }

    if (toggleBtn) {
      toggleBtn.checked = state.settings.collectEnabled;
    }
  }

  // ===== 최근 데이터 로드 =====
  async function loadRecentData() {
    state.isLoading = true;
    updateLoadingUI(true);

    try {
      const { startDate, endDate } = getPeriodDates(state.selectedPeriod);
      const messages = await ChatStorage.getMessagesByDateRange(startDate, endDate, PAGE_SIZE * 10);

      state.results = messages;
      state.totalCount = messages.length;

      renderResults();

      // 통계 업데이트
      const stats = await ChatStorage.getStats();
      updateStatsUI(stats);
    } catch (e) {
      console.error('[ChatTab] 데이터 로드 실패:', e);
    } finally {
      state.isLoading = false;
      updateLoadingUI(false);
    }
  }

  // ===== 기간 날짜 계산 =====
  function getPeriodDates(period) {
    const end = new Date();
    const start = new Date();

    switch (period) {
      case '1w':
        start.setDate(start.getDate() - 7);
        break;
      case '1m':
        start.setMonth(start.getMonth() - 1);
        break;
      case '3m':
        start.setMonth(start.getMonth() - 3);
        break;
      case 'all':
        start.setFullYear(2020, 0, 1);
        break;
      default:
        start.setMonth(start.getMonth() - 1);
    }

    return {
      startDate: ChatStorage.formatDate(start),
      endDate: ChatStorage.formatDate(end)
    };
  }

  // ===== 검색 =====
  async function search(queryText) {
    // 빈 검색이고 상세 필터도 없으면 최근 데이터 로드
    if (!queryText && !hasAdvancedFilters()) {
      await loadRecentData();
      return;
    }

    // 이미 로딩 중이면 중복 실행 방지
    if (state.isLoading) {
      debugLog('검색 중복 요청 무시');
      return;
    }

    state.isLoading = true;
    updateLoadingUI(true);

    try {
      let query = {};

      // AI 파싱 시도 (queryText가 있을 때만)
      if (queryText && queryText.trim()) {
        try {
          query = await parseSearchQuery(queryText.trim());
        } catch (parseError) {
          console.warn('[ChatTab] 쿼리 파싱 실패, 기본 키워드 검색 사용:', parseError);
          // 파싱 실패 시 입력값을 키워드로 사용
          query = { keywords: [queryText.trim()] };
        }
      }

      // 상세 검색 필터 병합
      if (hasAdvancedFilters()) {
        if (state.advancedFilters.nicknames.length > 0) {
          query.nicknames = [...(query.nicknames || []), ...state.advancedFilters.nicknames];
        }
        if (state.advancedFilters.keywords) {
          query.keywords = [...(query.keywords || []), state.advancedFilters.keywords];
        }
        if (state.advancedFilters.dateStart) {
          query.dateStart = state.advancedFilters.dateStart;
        }
        if (state.advancedFilters.dateEnd) {
          query.dateEnd = state.advancedFilters.dateEnd;
        }
        if (state.advancedFilters.streamer) {
          query.streamers = [state.advancedFilters.streamer];
        }
      }

      // 기간 기본값
      if (!query.dateStart && !query.dateEnd) {
        const { startDate, endDate } = getPeriodDates(state.selectedPeriod);
        query.dateStart = startDate;
        query.dateEnd = endDate;
      }

      // 검색 실행
      const results = await ChatStorage.searchMessages(query);

      state.results = results || [];
      state.totalCount = state.results.length;
      state.currentPage = 1;

      renderResults();
    } catch (e) {
      console.error('[ChatTab] 검색 실패:', e);
      showToast(getMessage('searchError') || '검색 중 오류가 발생했습니다');
      // 오류 시에도 빈 결과 표시
      state.results = [];
      state.totalCount = 0;
      renderResults();
    } finally {
      state.isLoading = false;
      updateLoadingUI(false);
    }
  }

  // ===== AI 쿼리 파싱 =====
  async function parseSearchQuery(input) {
    // 1단계: Chrome Built-in AI 시도
    const aiResult = await parseWithBuiltInAI(input);
    if (aiResult) {
      debugLog('AI 파싱 성공:', aiResult);
      return aiResult;
    }

    // 2단계: 규칙 기반 파서
    const ruleResult = parseWithRules(input);
    debugLog('규칙 파싱 결과:', ruleResult);
    return ruleResult;
  }

  // ===== Chrome Built-in AI =====
  async function parseWithBuiltInAI(input) {
    try {
      // AI API 확인
      if (!('ai' in self) || !self.ai?.languageModel) {
        debugLog('Chrome Built-in AI 미지원');
        return null;
      }

      const capabilities = await self.ai.languageModel.capabilities();
      if (capabilities.available === 'no') {
        debugLog('Chrome Built-in AI 사용 불가');
        return null;
      }

      // 세션 생성
      const session = await self.ai.languageModel.create({
        systemPrompt: `채팅 검색 쿼리를 JSON으로 변환하세요.
출력 형식만 반환 (설명 없이 JSON만): {"nicknames":[],"keywords":[],"dateStart":"","dateEnd":"","streamers":[]}
날짜 형식: YYYY-MM-DD
오늘 날짜: ${ChatStorage.formatDate(new Date())}
예시 입력: "닉네임A가 안녕이라고 말한 거"
예시 출력: {"nicknames":["닉네임A"],"keywords":["안녕"],"dateStart":"","dateEnd":"","streamers":[]}`
      });

      const result = await session.prompt(input);
      session.destroy();

      // JSON 파싱 시도
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return null;
    } catch (e) {
      debugLog('AI 파싱 실패:', e.message);
      return null;
    }
  }

  // ===== 규칙 기반 파서 =====
  function parseWithRules(input) {
    const query = {
      nicknames: [],
      keywords: [],
      dateStart: '',
      dateEnd: '',
      streamers: []
    };

    if (!input) return query;

    // 닉네임 추출
    const nickPatterns = [
      /(.+?)(?:이|가|의|님이?)\s*(?:말한|쓴|친|보낸|한)/g,
      /닉네임[:\s]*([^\s,]+)/gi,
      /유저[:\s]*([^\s,]+)/gi
    ];

    for (const pattern of nickPatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const nick = match[1].trim();
        if (nick && nick.length > 0 && nick.length < 30 && !query.nicknames.includes(nick)) {
          query.nicknames.push(nick);
        }
      }
    }

    // 키워드 추출 (따옴표 안의 내용)
    const quotePatterns = [
      /[""''](.+?)[""'']/g,
      /["'](.+?)["']/g
    ];

    for (const pattern of quotePatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        const keyword = match[1].trim();
        if (keyword && !query.keywords.includes(keyword)) {
          query.keywords.push(keyword);
        }
      }
    }

    // 날짜 추출
    const datePatterns = [
      /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/g,
      /(\d{1,2})월\s*(\d{1,2})일/g
    ];

    const dates = [];
    for (const pattern of datePatterns) {
      let match;
      while ((match = pattern.exec(input)) !== null) {
        if (match[0].includes('월')) {
          // 한글 날짜
          const month = match[1].padStart(2, '0');
          const day = match[2].padStart(2, '0');
          const year = new Date().getFullYear();
          dates.push(`${year}-${month}-${day}`);
        } else {
          // 숫자 날짜
          const year = match[1];
          const month = match[2].padStart(2, '0');
          const day = match[3].padStart(2, '0');
          dates.push(`${year}-${month}-${day}`);
        }
      }
    }

    if (dates.length >= 2) {
      dates.sort();
      query.dateStart = dates[0];
      query.dateEnd = dates[dates.length - 1];
    } else if (dates.length === 1) {
      query.dateStart = query.dateEnd = dates[0];
    }

    // 상대 날짜
    const today = new Date();
    if (/오늘/.test(input)) {
      query.dateStart = query.dateEnd = ChatStorage.formatDate(today);
    } else if (/어제/.test(input)) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      query.dateStart = query.dateEnd = ChatStorage.formatDate(yesterday);
    } else if (/이번\s*주/.test(input)) {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      query.dateStart = ChatStorage.formatDate(weekStart);
      query.dateEnd = ChatStorage.formatDate(today);
    }

    return query;
  }

  // ===== 상세 필터 확인 =====
  function hasAdvancedFilters() {
    return state.advancedFilters.nicknames.length > 0 ||
           state.advancedFilters.keywords ||
           state.advancedFilters.dateStart ||
           state.advancedFilters.dateEnd ||
           state.advancedFilters.streamer;
  }

  // ===== 내보내기 모달 열기 =====
  function openExportModal() {
    const overlay = document.getElementById('chatExportOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      renderExportModal();
    }
  }

  // ===== 내보내기 모달 닫기 =====
  function closeExportModal() {
    const overlay = document.getElementById('chatExportOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // ===== 내보내기 모달 렌더링 =====
  function renderExportModal() {
    const content = document.getElementById('exportContent');
    if (!content) return;

    // 스트리머 목록
    const allStreamers = [...state.streamers];

    content.innerHTML = `
      <div class="export-section">
        <h4>내보내기 방식 선택</h4>
        <div class="export-mode-selector">
          <label class="export-option active" data-mode="all">
            <input type="radio" name="exportMode" value="all" checked>
            <span class="export-option-content">
              <span class="export-icon">📦</span>
              <span class="export-text">
                <span class="export-title">모두 내보내기</span>
                <span class="export-desc">모든 채팅 데이터를 하나의 파일로 내보냅니다 (스트리머별 구분 가능)</span>
              </span>
            </span>
          </label>
          <label class="export-option" data-mode="streamer">
            <input type="radio" name="exportMode" value="streamer">
            <span class="export-option-content">
              <span class="export-icon">👤</span>
              <span class="export-text">
                <span class="export-title">스트리머별 내보내기</span>
                <span class="export-desc">특정 스트리머의 데이터만 선택하여 내보냅니다</span>
              </span>
            </span>
          </label>
        </div>
      </div>

      <div class="export-section export-streamer-section" id="exportStreamerSection" style="display: none;">
        <h4>스트리머 선택</h4>
        ${allStreamers.length === 0 ?
          '<p class="export-no-data">수집된 스트리머 데이터가 없습니다</p>' :
          `<div class="export-streamer-list">
            ${allStreamers.map(s => `
              <label class="export-streamer-item">
                <input type="checkbox" name="exportStreamer" value="${s.id}" data-nick="${s.nickname || s.id}">
                <span class="streamer-checkbox-label">${escapeHtml(s.nickname || s.id)}</span>
              </label>
            `).join('')}
          </div>
          <div class="export-streamer-actions">
            <button class="btn-select-all" id="exportSelectAll">모두 선택</button>
            <button class="btn-select-none" id="exportSelectNone">모두 해제</button>
          </div>`
        }
      </div>

      <div class="export-section">
        <h4>파일 형식</h4>
        <div class="export-format-selector">
          <label class="export-format-option">
            <input type="radio" name="exportFormat" value="json">
            <span class="format-label">JSON</span>
          </label>
          <label class="export-format-option active">
            <input type="radio" name="exportFormat" value="csv" checked>
            <span class="format-label">CSV</span>
          </label>
        </div>
      </div>

      <div class="export-actions">
        <button class="btn-export-cancel" id="exportCancelBtn">취소</button>
        <button class="btn-export-confirm" id="exportConfirmBtn">내보내기</button>
      </div>
    `;

    bindExportModalEvents();
  }

  // ===== 내보내기 모달 이벤트 바인딩 =====
  function bindExportModalEvents() {
    // 모달 닫기
    const closeBtn = document.getElementById('exportCloseBtn');
    const cancelBtn = document.getElementById('exportCancelBtn');
    const overlay = document.getElementById('chatExportOverlay');

    if (closeBtn) closeBtn.addEventListener('click', closeExportModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeExportModal);
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeExportModal();
      });
    }

    // 내보내기 모드 선택
    document.querySelectorAll('input[name="exportMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        const streamerSection = document.getElementById('exportStreamerSection');
        if (streamerSection) {
          streamerSection.style.display = e.target.value === 'streamer' ? 'block' : 'none';
        }

        // active 클래스 업데이트
        document.querySelectorAll('.export-option').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.mode === e.target.value);
        });
      });
    });

    // 파일 형식 선택
    document.querySelectorAll('input[name="exportFormat"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        document.querySelectorAll('.export-format-option').forEach(opt => {
          const input = opt.querySelector('input');
          opt.classList.toggle('active', input && input.value === e.target.value);
        });
      });
    });

    // 모두 선택/해제
    const selectAllBtn = document.getElementById('exportSelectAll');
    const selectNoneBtn = document.getElementById('exportSelectNone');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        document.querySelectorAll('input[name="exportStreamer"]').forEach(cb => {
          cb.checked = true;
        });
      });
    }

    if (selectNoneBtn) {
      selectNoneBtn.addEventListener('click', () => {
        document.querySelectorAll('input[name="exportStreamer"]').forEach(cb => {
          cb.checked = false;
        });
      });
    }

    // 내보내기 실행
    const confirmBtn = document.getElementById('exportConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', executeExport);
    }
  }

  // ===== 내보내기 실행 =====
  async function executeExport() {
    const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'all';
    const format = document.querySelector('input[name="exportFormat"]:checked')?.value || 'json';

    try {
      let data;
      let filenamePrefix = 'sooptalking_chat';

      if (mode === 'all') {
        // 전체 내보내기
        data = await ChatStorage.exportAll();
      } else {
        // 스트리머별 내보내기
        const selectedStreamers = Array.from(
          document.querySelectorAll('input[name="exportStreamer"]:checked')
        ).map(cb => cb.value);

        if (selectedStreamers.length === 0) {
          showToast('내보낼 스트리머를 선택해주세요');
          return;
        }

        data = await ChatStorage.exportByStreamers(selectedStreamers);

        // 파일명에 스트리머 정보 추가
        if (selectedStreamers.length === 1) {
          const streamerNick = document.querySelector(`input[name="exportStreamer"][value="${selectedStreamers[0]}"]`)?.dataset.nick || selectedStreamers[0];
          filenamePrefix = `sooptalking_chat_${streamerNick}`;
        } else {
          filenamePrefix = `sooptalking_chat_${selectedStreamers.length}streamers`;
        }
      }

      // 데이터가 없는 경우
      if (!data || !data.messages || data.messages.length === 0) {
        showToast('내보낼 데이터가 없습니다');
        return;
      }

      let content, filename, mimeType;

      let blob;

      if (format === 'csv') {
        // CSV 변환 (UTF-8 BOM 추가 - 엑셀 호환)
        // v5.4.0: elapsedTime (방송 경과 시간) 컬럼 추가
        const headers = ['datetime_utc', 'date', 'time', 'elapsedTime', 'userId', 'nickname', 'message', 'streamerId', 'streamerNick'];
        const rows = data.messages.map(m => {
          // timestamp를 ISO 형식으로 변환 (엑셀 지수표기 방지)
          const datetime = m.timestamp ? new Date(m.timestamp).toISOString().replace('T', ' ').slice(0, 19) : '';
          return [
            `"${datetime}"`,
            `"${String(m.date || '').replace(/"/g, '""')}"`,
            `"${String(m.time || '').replace(/"/g, '""')}"`,
            `"${String(m.elapsedTime || '').replace(/"/g, '""')}"`,
            `"${String(m.userId || '').replace(/"/g, '""')}"`,
            `"${String(m.nickname || '').replace(/"/g, '""')}"`,
            `"${String(m.message || '').replace(/"/g, '""')}"`,
            `"${String(m.streamerId || '').replace(/"/g, '""')}"`,
            `"${String(m.streamerNick || '').replace(/"/g, '""')}"`
          ].join(',');
        });
        content = [headers.join(','), ...rows].join('\n');
        filename = `${filenamePrefix}_${ChatStorage.formatDate(new Date())}.csv`;
        mimeType = 'text/csv;charset=utf-8';
        // UTF-8 BOM (0xEF, 0xBB, 0xBF) 추가하여 엑셀에서 한글 깨짐 방지
        const BOM = new Uint8Array([0xEF, 0xBB, 0xBF]);
        blob = new Blob([BOM, content], { type: mimeType });
      } else {
        // JSON
        content = JSON.stringify(data, null, 2);
        filename = `${filenamePrefix}_${ChatStorage.formatDate(new Date())}.json`;
        mimeType = 'application/json';
        blob = new Blob([content], { type: mimeType });
      }

      // 다운로드
      const url = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: url,
        filename: `SOOPtalking/chat/${filename}`,
        saveAs: true
      });

      closeExportModal();
      showToast(`${data.messages.length}건 내보내기 완료`);
    } catch (e) {
      console.error('[ChatTab] 내보내기 실패:', e);
      showToast(getMessage('exportError') || '내보내기 실패');
    }
  }

  // ===== 내보내기 (기존 함수 - 하위 호환) =====
  async function exportData(format = 'json') {
    // 모달 방식으로 변경
    openExportModal();
  }

  // ===== 가져오기 =====
  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.messages || !Array.isArray(data.messages)) {
        throw new Error('잘못된 파일 형식');
      }

      const result = await ChatStorage.importData(data, true);

      showToast(`${result.imported}건 가져오기 완료 (중복 ${result.skipped}건 제외)`);

      // 데이터 새로고침
      await loadRecentData();
      state.datesWithData = await ChatStorage.getDatesWithData();
      state.streamers = await ChatStorage.getStreamers();
    } catch (e) {
      console.error('[ChatTab] 가져오기 실패:', e);
      showToast(getMessage('importError') || '가져오기 실패: ' + e.message);
    }
  }

  // ===== 렌더링 =====
  function render() {
    const container = document.getElementById('chatTabContainer');
    if (!container) return;

    const modeLabels = {
      [COLLECT_MODE.OFF]: getMessage('collectModeOff') || '수집 안함',
      [COLLECT_MODE.ALL]: getMessage('collectModeAll') || '모든 채팅방',
      [COLLECT_MODE.SELECTED]: getMessage('collectModeSelected') || '선택한 스트리머'
    };

    container.innerHTML = `
      <div class="chat-tab-content">
        <!-- 메인 스크롤 영역 -->
        <div class="chat-main-area">
          <!-- 수집 현황 -->
          <div class="chat-collection-status">
            <div class="status-info">
              <span class="chat-status-dot ${state.settings.collectMode !== COLLECT_MODE.OFF ? 'ready' : ''}"></span>
              <span class="status-text" id="chatStatusText">${getMessage('chatNotCollecting') || '수집 대기 중'}</span>
            </div>
            <button class="collect-mode-btn" id="collectModeBtn">
              ${modeLabels[state.settings.collectMode]}
              <span class="mode-arrow">▼</span>
            </button>
          </div>

          <!-- 기간 선택 -->
          <div class="chat-period-selector">
            <button class="period-btn ${state.selectedPeriod === '1w' ? 'active' : ''}" data-period="1w">${getMessage('period1w') || '1주'}</button>
            <button class="period-btn ${state.selectedPeriod === '1m' ? 'active' : ''}" data-period="1m">${getMessage('period1m') || '1달'}</button>
            <button class="period-btn ${state.selectedPeriod === '3m' ? 'active' : ''}" data-period="3m">${getMessage('period3m') || '3달'}</button>
            <button class="period-btn ${state.selectedPeriod === 'all' ? 'active' : ''}" data-period="all">${getMessage('periodAll') || '전체'}</button>
          </div>

          <!-- 통계 -->
          <div class="chat-stats" id="chatStats">
            <span class="stat-item">💬 <span id="statMessageCount">0</span>건</span>
            <span class="stat-item">📁 <span id="statSessionCount">0</span>개 세션</span>
          </div>

          <!-- v5.2.0: 필터 상태 표시 -->
          <div class="filter-status" id="filterStatus" style="display: none;">
            <span class="filter-status-text"></span>
            <button class="filter-clear-btn" id="filterClearBtn">✕</button>
          </div>

          <!-- 채팅 목록 (Lightweight MVC - Append Only) -->
          <div class="chat-list-container" id="chatListContainer">
            <div class="chat-list" id="chatList">
              <!-- SimpleRenderer가 동적으로 추가 -->
            </div>
            <div class="chat-empty" id="chatEmpty" style="display: none;">
              <div class="empty-icon">💬</div>
              <p>${getMessage('noChatData') || '수집된 채팅이 없습니다'}</p>
            </div>
            <div class="chat-loading" id="chatLoading" style="display: none;">
              <div class="loading-spinner"></div>
              <p>${getMessage('loading') || '로딩 중...'}</p>
            </div>

          </div>
        </div>

        <!-- 최신 메시지 이동 토스트 버튼 (하단 고정바 위) -->
        <button class="chat-new-message-toast" id="chatFabBtn" title="${getMessage('scrollToLatest') || '최신 메시지로 이동'}">
          <span class="toast-icon">↓</span>
          <span class="toast-text">${getMessage('newMessages') || '새 메시지'}</span>
          <span class="toast-count" id="chatNewMsgCount" style="display: none;">0</span>
        </button>

        <!-- 하단 고정 바 (검색 + 액션) -->
        <div class="chat-bottom-bar">
          <!-- 검색 행 -->
          <div class="chat-bottom-row chat-search-row">
            <div class="chat-search-input-wrap">
              <svg class="chat-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input type="text"
                     class="chat-search-input"
                     id="chatSearchInput"
                     placeholder="${getMessage('chatSearchInputPlaceholder') || '메시지, @닉네임 검색...'}"
                     autocomplete="off">
              <button class="chat-search-clear" id="chatSearchClear" style="display:none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          <!-- 컨트롤 행: 전체 클릭 가능한 필터 토글 바 -->
          <div class="chat-bottom-row chat-controls-row">
            <div class="chat-filter-toggle-bar" id="filterToggleBar">
              <!-- v5.2.1: 검색 도움말 -->
              <div class="search-help-wrap">
                <button class="search-help-btn" id="searchHelpBtn" type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </button>
                <div class="search-help-tooltip" id="searchHelpTooltip">
                  <div class="help-tooltip-title">검색 도움말</div>
                  <table class="help-tooltip-table">
                    <tr>
                      <td class="help-syntax">단어</td>
                      <td class="help-desc">메시지 내용 검색</td>
                    </tr>
                    <tr>
                      <td class="help-syntax">@닉네임</td>
                      <td class="help-desc">사용자 검색</td>
                    </tr>
                    <tr>
                      <td class="help-syntax">단어 @닉</td>
                      <td class="help-desc">복합 검색 (AND)</td>
                    </tr>
                  </table>
                  <div class="help-tooltip-example">
                    <span class="help-example-label">예시</span>
                    <code>안녕 @홍길동</code>
                  </div>
                </div>
              </div>
              <svg class="filter-arrow-icon" id="filterArrowIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
              <span class="filter-toggle-text">필터</span>
            </div>
            <button class="chat-action-btn" id="chatExportBtn" title="${getMessage('export') || '내보내기'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>
            <button class="chat-action-btn" id="chatImportBtn" title="${getMessage('import') || '가져오기'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button class="chat-action-btn" id="chatSettingsBtn" title="${getMessage('settings') || '설정'}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
            <input type="file" id="chatImportInput" accept=".json" style="display:none">
          </div>
          <!-- v5.2.1: 통합 검색 - 필터 옵션 패널 -->
          <div class="chat-filter-options" id="filterOptions" style="display: none;">
            <!-- 스트리머 필터 (LIVE 모드) -->
            <div class="filter-section">
              <label class="filter-label">${getMessage('streamer') || '스트리머'}</label>
              <div class="streamer-chips" id="streamerChips">
                <button class="streamer-chip active" data-streamer="">전체</button>
                ${state.streamers.map(s => `<button class="streamer-chip" data-streamer="${s.id}">${s.nickname || s.id}</button>`).join('')}
              </div>
            </div>

            <!-- 과거 검색 섹션 -->
            <div class="filter-section history-section">
              <label class="filter-label">
                <svg class="history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                과거 데이터 검색
              </label>
              <div class="date-picker-row">
                <div class="date-picker-wrap">
                  <input type="date" id="dateStartInput" class="date-picker-input">
                  <span class="date-display" id="dateStartDisplay">시작일 선택</span>
                </div>
                <span class="date-separator">~</span>
                <div class="date-picker-wrap">
                  <input type="date" id="dateEndInput" class="date-picker-input">
                  <span class="date-display" id="dateEndDisplay">종료일 선택</span>
                </div>
              </div>
              <button class="btn-history-search" id="historySearchBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                </svg>
                과거에서 검색
              </button>
            </div>

            <!-- 초기화 -->
            <div class="filter-actions">
              <button class="btn-filter-reset" id="searchResetBtn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
                필터 초기화
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 수집 모드 선택 드롭다운 -->
      <div class="collect-mode-dropdown" id="collectModeDropdown" style="display: none;">
        <div class="dropdown-item ${state.settings.collectMode === COLLECT_MODE.ALL ? 'active' : ''}" data-mode="${COLLECT_MODE.ALL}">
          <span class="dropdown-icon">📺</span>
          <div class="dropdown-text">
            <span class="dropdown-title">모든 채팅방</span>
            <span class="dropdown-desc">참여하는 모든 방송의 채팅을 수집합니다</span>
          </div>
        </div>
        <div class="dropdown-item ${state.settings.collectMode === COLLECT_MODE.SELECTED ? 'active' : ''}" data-mode="${COLLECT_MODE.SELECTED}">
          <span class="dropdown-icon">⭐</span>
          <div class="dropdown-text">
            <span class="dropdown-title">선택한 스트리머만</span>
            <span class="dropdown-desc">지정한 스트리머의 채팅만 수집합니다</span>
          </div>
        </div>
        <div class="dropdown-item ${state.settings.collectMode === COLLECT_MODE.OFF ? 'active' : ''}" data-mode="${COLLECT_MODE.OFF}">
          <span class="dropdown-icon">🚫</span>
          <div class="dropdown-text">
            <span class="dropdown-title">수집 안함</span>
            <span class="dropdown-desc">채팅 수집 기능을 끕니다</span>
          </div>
        </div>
      </div>

      <!-- 설정 패널 (모달) -->
      <div class="chat-settings-overlay" id="chatSettingsOverlay" style="display: none;">
        <div class="chat-settings-panel">
          <div class="settings-header">
            <h3>채팅 수집 설정</h3>
            <button class="settings-close-btn" id="settingsCloseBtn">✕</button>
          </div>
          <div class="settings-content" id="settingsContent">
            <!-- renderSettings()에서 동적 렌더링 -->
          </div>
        </div>
      </div>

      <!-- 내보내기 모달 -->
      <div class="chat-export-overlay" id="chatExportOverlay" style="display: none;">
        <div class="chat-export-panel">
          <div class="export-header">
            <h3>채팅 내보내기</h3>
            <button class="export-close-btn" id="exportCloseBtn">✕</button>
          </div>
          <div class="export-content" id="exportContent">
            <!-- renderExportModal()에서 동적 렌더링 -->
          </div>
        </div>
      </div>

      <!-- 데이터 관리 모달 -->
      <div class="chat-data-manage-overlay" id="chatDataManageOverlay" style="display: none;">
        <div class="chat-data-manage-panel">
          <div class="data-manage-header">
            <h3>데이터 관리</h3>
            <button class="data-manage-close-btn" id="dataManageCloseBtn">✕</button>
          </div>
          <div class="data-manage-content" id="dataManageContent">
            <!-- renderDataManageModal()에서 동적 렌더링 -->
          </div>
        </div>
      </div>

      <!-- 삭제 확인 다이얼로그 -->
      <div class="chat-confirm-overlay" id="chatConfirmOverlay" style="display: none;">
        <div class="chat-confirm-dialog">
          <div class="confirm-icon" id="confirmIcon">⚠️</div>
          <h3 class="confirm-title" id="confirmTitle">삭제 확인</h3>
          <p class="confirm-message" id="confirmMessage">정말 삭제하시겠습니까?</p>
          <div class="confirm-backup-option" id="confirmBackupOption">
            <label class="backup-checkbox-label">
              <input type="checkbox" id="backupBeforeDelete" checked>
              <span>삭제 전 백업 파일 생성</span>
            </label>
          </div>
          <div class="confirm-actions">
            <button class="btn-confirm-cancel" id="confirmCancelBtn">취소</button>
            <button class="btn-confirm-delete" id="confirmDeleteBtn">삭제</button>
          </div>
        </div>
      </div>
    `;

    updateStatusUI();
    renderSettings();
  }

  // ===== 설정 패널 렌더링 =====
  function renderSettings() {
    const content = document.getElementById('settingsContent');
    debugLog('renderSettings - settingsContent:', content, 'collectMode:', state.settings.collectMode);
    if (!content) {
      console.warn('[ChatTab] renderSettings - settingsContent를 찾을 수 없음');
      return;
    }

    const modeLabels = {
      [COLLECT_MODE.OFF]: getMessage('collectModeOff') || '수집 안함',
      [COLLECT_MODE.ALL]: getMessage('collectModeAll') || '모든 채팅방',
      [COLLECT_MODE.SELECTED]: getMessage('collectModeSelectedOnly') || '선택한 스트리머만'
    };

    // 모니터링 중인 스트리머 목록 가져오기 (storage에서)
    const allStreamers = [...state.streamers];

    // 선택된 스트리머 중 목록에 없는 것도 추가
    for (const s of state.settings.collectStreamers) {
      if (!allStreamers.some(x => x.id === s.id)) {
        allStreamers.push(s);
      }
    }

    content.innerHTML = `
      <div class="settings-section">
        <h4>${getMessage('settingsCollectMode') || '수집 모드'}</h4>
        <div class="settings-mode-selector">
          <label class="mode-option ${state.settings.collectMode === COLLECT_MODE.ALL ? 'active' : ''}">
            <input type="radio" name="collectMode" value="${COLLECT_MODE.ALL}" ${state.settings.collectMode === COLLECT_MODE.ALL ? 'checked' : ''}>
            <span class="mode-label">
              <span class="mode-icon">📺</span>
              <span class="mode-name">${getMessage('collectModeAll') || '모든 채팅방'}</span>
            </span>
          </label>
          <label class="mode-option ${state.settings.collectMode === COLLECT_MODE.SELECTED ? 'active' : ''}">
            <input type="radio" name="collectMode" value="${COLLECT_MODE.SELECTED}" ${state.settings.collectMode === COLLECT_MODE.SELECTED ? 'checked' : ''}>
            <span class="mode-label">
              <span class="mode-icon">⭐</span>
              <span class="mode-name">${getMessage('collectModeSelected') || '선택한 스트리머'}</span>
            </span>
          </label>
          <label class="mode-option ${state.settings.collectMode === COLLECT_MODE.OFF ? 'active' : ''}">
            <input type="radio" name="collectMode" value="${COLLECT_MODE.OFF}" ${state.settings.collectMode === COLLECT_MODE.OFF ? 'checked' : ''}>
            <span class="mode-label">
              <span class="mode-icon">🚫</span>
              <span class="mode-name">${getMessage('collectModeOff') || '수집 안함'}</span>
            </span>
          </label>
        </div>
      </div>

      ${state.settings.collectMode === COLLECT_MODE.SELECTED ? `
      <div class="settings-section">
        <h4>${getMessage('settingsCollectStreamers') || '채팅 수집 스트리머'} (${state.settings.collectStreamers.length}${getMessage('unitPerson') || '명'})</h4>
        <p class="settings-hint">${getMessage('settingsCollectHint') || '선택한 스트리머 방송에 참여하면 채팅이 자동 수집됩니다.'}</p>

        <div class="streamer-add-form">
          <input type="text" id="addStreamerInput" placeholder="${getMessage('streamerIdInputPlaceholder') || '스트리머 ID 입력'}" class="streamer-input">
          <button type="button" class="btn-add-streamer" id="addStreamerBtn">${getMessage('addButton') || '추가'}</button>
        </div>

        <div class="selected-streamers-list">
          ${state.settings.collectStreamers.length === 0 ?
            `<div class="no-streamers">${getMessage('noSelectedStreamers') || '선택된 스트리머가 없습니다'}</div>` :
            state.settings.collectStreamers.map(s => `
              <div class="selected-streamer-item" data-id="${s.id}">
                <span class="streamer-name">${escapeHtml(s.nickname || s.id)}</span>
                <button class="btn-remove-streamer" data-id="${s.id}">✕</button>
              </div>
            `).join('')
          }
        </div>

        ${allStreamers.length > 0 ? `
        <div class="available-streamers">
          <h5>${getMessage('recentCollectedStreamers') || '최근 수집한 스트리머'}</h5>
          <div class="streamer-chips">
            ${allStreamers.filter(s => !isStreamerSelected(s.id)).slice(0, 10).map(s => `
              <button class="streamer-chip" data-id="${s.id}" data-nick="${s.nickname || s.id}">
                + ${escapeHtml(s.nickname || s.id)}
              </button>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
      ` : ''}

      <div class="settings-section">
        <h4>${getMessage('settingsDataRetention') || '데이터 보관'}</h4>
        <div class="retention-setting">
          <label>${getMessage('retentionPeriod') || '보관 기간'}</label>
          <select id="retentionDays" class="retention-select">
            <option value="30" ${state.settings.retentionDays === 30 ? 'selected' : ''}>30${getMessage('unitDay') || '일'}</option>
            <option value="60" ${state.settings.retentionDays === 60 ? 'selected' : ''}>60${getMessage('unitDay') || '일'}</option>
            <option value="90" ${state.settings.retentionDays === 90 ? 'selected' : ''}>90${getMessage('unitDay') || '일'}</option>
            <option value="180" ${state.settings.retentionDays === 180 ? 'selected' : ''}>180${getMessage('unitDay') || '일'}</option>
            <option value="365" ${state.settings.retentionDays === 365 ? 'selected' : ''}>1${getMessage('unitYear') || '년'}</option>
            <option value="0" ${state.settings.retentionDays === 0 ? 'selected' : ''}>${getMessage('unlimited') || '무제한'}</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h4>${getMessage('chatDataManage') || '데이터 관리'}</h4>
        <p class="settings-hint">${getMessage('settingsDataManageHint') || '수집된 채팅 데이터를 삭제하거나 정리할 수 있습니다.'}</p>
        <button class="btn-data-manage" id="openDataManageBtn">
          <span class="data-manage-icon">🗑️</span>
          <span>${getMessage('dataDelete') || '데이터 삭제'}</span>
        </button>
      </div>
    `;

    debugLog('renderSettings 완료, bindSettingsEvents 호출');
    bindSettingsEvents();
  }

  // ===== 결과 렌더링 (Lightweight MVC - DB 조회 결과용) =====
  // 참고: 실시간 메시지는 liveView.onMessages()가 처리
  function renderResults() {
    const emptyEl = document.getElementById('chatEmpty');

    // liveView가 초기화되지 않았으면 초기화
    if (!liveView) {
      initLiveView();
    }

    if (!liveView) return;

    // DB에서 로드한 결과가 있으면 렌더링
    if (state.results.length === 0) {
      if (emptyEl) emptyEl.style.display = 'flex';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // DB 결과를 시간순 정렬 후 liveView에 전달
    const sortedResults = [...state.results].sort((a, b) => a.timestamp - b.timestamp);

    // 기존 내용 클리어 후 버퍼에 저장
    liveView.clear();
    liveView.buffer.pushBatch(sortedResults);

    // v5.2.1 버그 수정: 필터가 활성화되어 있으면 필터 적용하여 렌더링
    if (liveView.isFilterActive()) {
      const filtered = liveView.filterPipeline.apply(sortedResults);
      liveView.renderer.append(filtered);
    } else {
      liveView.renderer.append(sortedResults);
    }

    // 맨 아래로 스크롤
    setTimeout(() => {
      liveView.scrollToBottom();
    }, 50);
  }

  // ===== LiveView 초기화 =====
  function initLiveView() {
    if (liveView) return;

    // #chatList: 메시지 추가 대상, #chatListContainer: 스크롤 컨테이너
    liveView = new ChatLiveView('#chatList', '#chatListContainer');
    if (!liveView.init()) {
      console.error('[ChatTab] LiveView 초기화 실패');
      liveView = null;
      return;
    }

    // 새 메시지 콜백 설정 (통계 업데이트용)
    liveView.setOnNewMessageCallback((newCount, totalCount) => {
      state.totalCount = totalCount;
      const countEl = document.getElementById('statMessageCount');
      // v5.2.1: 부드러운 숫자 애니메이션 적용
      animateNumber(countEl, totalCount);
    });

    // v5.2.0: 필터 변경 콜백 설정
    liveView.setOnFilterChangeCallback((isActive, statusText) => {
      updateFilterStatusUI();
    });

    // FAB 버튼 클릭 이벤트 바인딩
    const fabBtn = document.getElementById('chatFabBtn');
    if (fabBtn) {
      fabBtn.addEventListener('click', () => {
        if (liveView) {
          liveView.goToLatest();
        }
      });
    }

    debugLog('LiveView 초기화 완료');
  }

  // ===== 새 메시지 토스트 버튼 관리 (하위 호환) =====
  function updateFabButton() {
    if (liveView) {
      liveView.updateToastButton();
    }
  }

  function hideFabButton() {
    if (liveView) {
      liveView.hideToastButton();
    }
  }

  function scrollToBottom() {
    if (liveView) {
      liveView.goToLatest();
    }
  }

  // ===== 스트리머 추가 처리 =====
  function handleAddStreamer() {
    const addStreamerInput = document.getElementById('addStreamerInput');
    if (!addStreamerInput) {
      console.warn('[ChatTab] handleAddStreamer - input을 찾을 수 없음');
      return;
    }

    const id = addStreamerInput.value.trim();
    debugLog('handleAddStreamer 호출:', id);

    if (!id) {
      addStreamerInput.focus();
      return;
    }

    if (isStreamerSelected(id)) {
      showToast(`"${id}"는 이미 추가되어 있습니다`);
      addStreamerInput.value = '';
      addStreamerInput.focus();
      return;
    }

    // 새 스트리머 추가
    debugLog('스트리머 추가:', id);
    state.settings.collectStreamers.push({ id, nickname: id });
    saveSettings();
    const addedId = id;
    addStreamerInput.value = '';
    renderSettings();

    // 추가 성공 피드백
    showToast(`"${addedId}" 스트리머가 추가되었습니다`);

    // 새로 추가된 항목 하이라이트
    setTimeout(() => {
      const newItem = document.querySelector(`.selected-streamer-item[data-id="${addedId}"]`);
      if (newItem) {
        newItem.classList.add('just-added');
        setTimeout(() => newItem.classList.remove('just-added'), 1500);
      }
      // 새 input 필드에 포커스
      const newInput = document.getElementById('addStreamerInput');
      if (newInput) newInput.focus();
    }, 50);
  }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    // v5.2.1: 통합 검색 입력 → LIVE 필터 (메시지 + @닉네임 파싱)
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const rawQuery = e.target.value.trim();
        state.searchQuery = rawQuery;

        // 디바운스
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          // v5.2.1: 통합 검색 쿼리 파싱
          const parsed = parseUnifiedQuery(rawQuery);

          if (state.searchMode === SEARCH_MODE.LIVE && liveView) {
            // 키워드와 닉네임 필터 동시 적용
            liveView.filterPipeline.setKeyword(parsed.keyword);
            liveView.filterPipeline.setNickname(parsed.nickname);
            liveView.rerender();
            liveView._notifyFilterChange();
            updateFilterStatusUI();
          } else {
            // HISTORY 모드: 기존 DB 검색
            if (!rawQuery && !hasAdvancedFilters()) {
              loadRecentData();
            } else if (rawQuery) {
              search(rawQuery);
            }
          }
        }, SEARCH_DEBOUNCE);
      });

      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
          // Enter 시 HISTORY 모드로 전환하여 DB 검색
          if (state.searchQuery) {
            switchToHistoryMode();
            search(state.searchQuery);
          }
        }
      });
    }

    // 검색 버튼 (제거됨 - chatSearchBtn이 없으면 무시)
    const searchBtn = document.getElementById('chatSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        if (state.searchQuery) {
          switchToHistoryMode();
          search(state.searchQuery);
        }
      });
    }

    // 검색 클리어 버튼
    const searchClear = document.getElementById('chatSearchClear');
    if (searchClear && searchInput) {
      searchInput.addEventListener('input', () => {
        searchClear.style.display = searchInput.value ? 'flex' : 'none';
      });
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        state.searchQuery = '';
        searchClear.style.display = 'none';
        // v5.2.0: LIVE 모드로 복귀 및 필터 초기화
        switchToLiveMode();
      });
    }

    // v5.2.1: 필터 옵션 토글 바 (전체 영역 클릭)
    const filterToggleBar = document.getElementById('filterToggleBar');
    const filterOptions = document.getElementById('filterOptions');
    if (filterToggleBar && filterOptions) {
      filterToggleBar.addEventListener('click', (e) => {
        // 도움말 버튼 클릭 시 토글 방지
        if (e.target.closest('.search-help-wrap')) return;

        state.advancedOpen = !state.advancedOpen;
        filterOptions.style.display = state.advancedOpen ? 'block' : 'none';
        filterToggleBar.classList.toggle('active', state.advancedOpen);

        // v5.2.1: 필터 옵션 열릴 때 기본 날짜 설정 (비어있을 경우)
        if (state.advancedOpen) {
          initDefaultDates();
        }
      });
    }

    // v5.2.1: 스트리머 칩 클릭 이벤트
    const streamerChips = document.getElementById('streamerChips');
    if (streamerChips) {
      streamerChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.streamer-chip');
        if (!chip) return;

        // 활성 상태 토글
        streamerChips.querySelectorAll('.streamer-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        // 필터 적용
        const streamerId = chip.dataset.streamer;
        state.advancedFilters.streamer = streamerId;

        if (state.searchMode === SEARCH_MODE.LIVE && liveView) {
          liveView.setFilter('streamer', streamerId);
          updateFilterStatusUI();
        }
      });
    }

    // v5.2.1: 과거 검색 버튼
    const historySearchBtn = document.getElementById('historySearchBtn');
    if (historySearchBtn) {
      historySearchBtn.addEventListener('click', () => {
        switchToHistoryMode();
        search(state.searchQuery);
      });
    }

    // v5.2.1: 날짜 선택 시 표시 업데이트 (이벤트 위임 사용)
    // filterOptions는 위에서 이미 선언됨
    if (filterOptions) {
      filterOptions.addEventListener('change', (e) => {
        const target = e.target;

        if (target.id === 'dateStartInput') {
          state.advancedFilters.dateStart = target.value;
          const display = document.getElementById('dateStartDisplay');
          if (display) {
            display.textContent = target.value ? formatDateKorean(target.value) : (getMessage('selectStartDate') || '시작일 선택');
            display.classList.toggle('has-value', !!target.value);
          }
        }

        if (target.id === 'dateEndInput') {
          state.advancedFilters.dateEnd = target.value;
          const display = document.getElementById('dateEndDisplay');
          if (display) {
            display.textContent = target.value ? formatDateKorean(target.value) : (getMessage('selectEndDate') || '종료일 선택');
            display.classList.toggle('has-value', !!target.value);
          }
        }
      });

      // v5.2.1: 날짜 버튼 전체 영역 클릭 시 달력 열기
      filterOptions.addEventListener('click', (e) => {
        const dateWrap = e.target.closest('.date-picker-wrap');
        if (!dateWrap) return;

        const dateInput = dateWrap.querySelector('.date-picker-input');
        if (dateInput && typeof dateInput.showPicker === 'function') {
          try {
            dateInput.showPicker();
          } catch (err) {
            // showPicker 실패 시 focus로 폴백
            dateInput.focus();
          }
        }
      });
    }

    // 기간 버튼
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedPeriod = btn.dataset.period;
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadRecentData();
      });
    });

    // 수집 모드 버튼
    const collectModeBtn = document.getElementById('collectModeBtn');
    const collectModeDropdown = document.getElementById('collectModeDropdown');
    if (collectModeBtn && collectModeDropdown) {
      collectModeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = collectModeDropdown.style.display !== 'none';
        collectModeDropdown.style.display = isVisible ? 'none' : 'block';
      });

      // 드롭다운 항목 클릭
      collectModeDropdown.querySelectorAll('.dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const mode = item.dataset.mode;
          state.settings.collectMode = mode;
          saveSettings();
          collectModeDropdown.style.display = 'none';

          // UI 업데이트
          const modeLabels = {
            [COLLECT_MODE.OFF]: getMessage('collectModeOff') || '수집 안함',
            [COLLECT_MODE.ALL]: getMessage('collectModeAll') || '모든 채팅방',
            [COLLECT_MODE.SELECTED]: getMessage('collectModeSelected') || '선택한 스트리머'
          };
          collectModeBtn.innerHTML = `${modeLabels[mode]}<span class="mode-arrow">▼</span>`;

          // 드롭다운 active 상태 업데이트
          collectModeDropdown.querySelectorAll('.dropdown-item').forEach(i => {
            i.classList.toggle('active', i.dataset.mode === mode);
          });

          // 상태 점 업데이트
          const statusDot = document.querySelector('.chat-status-dot');
          if (statusDot) {
            statusDot.classList.toggle('ready', mode !== COLLECT_MODE.OFF);
          }

          // selected 모드면 설정 패널 열기
          if (mode === COLLECT_MODE.SELECTED) {
            openSettings();
          }

          renderSettings();
        });
      });

      // 외부 클릭 시 드롭다운 닫기
      document.addEventListener('click', () => {
        collectModeDropdown.style.display = 'none';
      });
    }

    // 설정 버튼
    const settingsBtn = document.getElementById('chatSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', openSettings);
    }

    // 설정 패널 닫기
    const settingsOverlay = document.getElementById('chatSettingsOverlay');
    const settingsCloseBtn = document.getElementById('settingsCloseBtn');
    if (settingsOverlay) {
      settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) {
          closeSettings();
        }
      });
    }
    if (settingsCloseBtn) {
      settingsCloseBtn.addEventListener('click', closeSettings);
    }

    // 설정 컨텐츠 이벤트 위임 (동적 요소 처리)
    const settingsContent = document.getElementById('settingsContent');
    if (settingsContent) {
      // 클릭 이벤트 위임
      settingsContent.addEventListener('click', (e) => {
        // 스트리머 추가 버튼
        if (e.target.id === 'addStreamerBtn' || e.target.closest('#addStreamerBtn')) {
          e.preventDefault();
          e.stopPropagation();
          handleAddStreamer();
          return;
        }

        // 스트리머 삭제 버튼
        const removeBtn = e.target.closest('.btn-remove-streamer');
        if (removeBtn) {
          const id = removeBtn.dataset.id;
          state.settings.collectStreamers = state.settings.collectStreamers.filter(s => s.id !== id);
          saveSettings();
          renderSettings();
          return;
        }

        // 스트리머 칩 클릭 (빠른 추가)
        const chip = e.target.closest('.streamer-chip');
        if (chip) {
          const id = chip.dataset.id;
          const nick = chip.dataset.nick;
          if (!isStreamerSelected(id)) {
            state.settings.collectStreamers.push({ id, nickname: nick });
            saveSettings();
            renderSettings();
            showToast(`"${nick || id}" 스트리머가 추가되었습니다`);
          }
          return;
        }
      });

      // 키보드 이벤트 위임 (Enter 키로 스트리머 추가)
      settingsContent.addEventListener('keypress', (e) => {
        if (e.target.id === 'addStreamerInput' && e.key === 'Enter') {
          e.preventDefault();
          handleAddStreamer();
        }
      });
    }

    // 내보내기
    const exportBtn = document.getElementById('chatExportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        exportData('json');
      });
    }

    // 가져오기
    const importBtn = document.getElementById('chatImportBtn');
    const importInput = document.getElementById('chatImportInput');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => {
        importInput.click();
      });
      importInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          importData(e.target.files[0]);
          e.target.value = '';
        }
      });
    }

    // ⭐ v5.1.0: LiveView 초기화 (스크롤 이벤트는 LiveView 내부에서 처리)
    initLiveView();

    // 메시지 클릭 (확장/축소) - 이벤트 위임
    const chatListContainer = document.getElementById('chatListContainer');
    if (chatListContainer && !chatListContainer._expandClickBound) {
      chatListContainer._expandClickBound = true;
      chatListContainer.addEventListener('click', (e) => {
        const messageItem = e.target.closest('.chat-item');
        if (!messageItem) return;

        // 이미 확장된 상태면 축소
        if (messageItem.classList.contains('expanded')) {
          messageItem.classList.remove('expanded');
          return;
        }

        // 다른 확장된 메시지 닫기
        chatListContainer.querySelectorAll('.chat-item.expanded').forEach(item => {
          item.classList.remove('expanded');
        });

        // 현재 메시지 확장
        messageItem.classList.add('expanded');
      });
    }

    // v5.2.1: 기존 닉네임/키워드/스트리머 이벤트 제거됨 (통합 검색으로 대체)
    // 날짜 이벤트는 필터 옵션 패널에서 처리됨 (bindEvents 상단 참조)

    // v5.2.1: 초기화 버튼 → LIVE 모드로 복귀
    const resetBtn = document.getElementById('searchResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetFilters();
        switchToLiveMode();
      });
    }
  }

  // ===== 필터 초기화 =====
  // v5.2.1: 필터 초기화
  function resetFilters() {
    state.advancedFilters = {
      nicknames: [],
      keywords: '',
      dateStart: '',
      dateEnd: '',
      streamer: ''
    };
    state.searchQuery = '';

    // UI 초기화
    const searchInput = document.getElementById('chatSearchInput');
    const dateStartInput = document.getElementById('dateStartInput');
    const dateEndInput = document.getElementById('dateEndInput');
    const dateStartDisplay = document.getElementById('dateStartDisplay');
    const dateEndDisplay = document.getElementById('dateEndDisplay');

    if (searchInput) searchInput.value = '';
    if (dateStartInput) dateStartInput.value = '';
    if (dateEndInput) dateEndInput.value = '';
    if (dateStartDisplay) {
      dateStartDisplay.textContent = getMessage('selectStartDate') || '시작일 선택';
      dateStartDisplay.classList.remove('has-value');
    }
    if (dateEndDisplay) {
      dateEndDisplay.textContent = getMessage('selectEndDate') || '종료일 선택';
      dateEndDisplay.classList.remove('has-value');
    }

    // 스트리머 칩 초기화
    const streamerChips = document.getElementById('streamerChips');
    if (streamerChips) {
      streamerChips.querySelectorAll('.streamer-chip').forEach(c => c.classList.remove('active'));
      const allChip = streamerChips.querySelector('[data-streamer=""]');
      if (allChip) allChip.classList.add('active');
    }

    // 검색 클리어 버튼 숨기기
    const searchClear = document.getElementById('chatSearchClear');
    if (searchClear) searchClear.style.display = 'none';

    // liveView 필터 초기화
    if (liveView) {
      liveView.clearFilter();
    }
    updateFilterStatusUI();
  }

  // ===== v5.2.0: 검색 모드 전환 함수 =====
  function switchToLiveMode() {
    state.searchMode = SEARCH_MODE.LIVE;

    // liveView 필터 초기화 및 rerender
    if (liveView) {
      liveView.clearFilter();
    }

    // 필터 상태 UI 업데이트
    updateFilterStatusUI();
    updateSearchModeUI();

    debugLog('LIVE 모드로 전환');
  }

  function switchToHistoryMode() {
    state.searchMode = SEARCH_MODE.HISTORY;
    updateSearchModeUI();
    debugLog('HISTORY 모드로 전환');
  }

  // ===== v5.2.1: 필터 상태 UI 업데이트 =====
  function updateFilterStatusUI() {
    const filterStatus = document.getElementById('filterStatus');
    if (!filterStatus) return;

    if (liveView && liveView.isFilterActive()) {
      const statusText = liveView.getFilterStatus();
      const filtered = liveView.filterPipeline.apply(liveView.buffer.getAll());
      filterStatus.innerHTML = `
        <span class="filter-status-text">필터: ${statusText} (${filtered.length}건)</span>
        <button class="filter-clear-btn" id="filterClearBtn">✕</button>
      `;
      filterStatus.style.display = 'flex';

      // 필터 초기화 버튼 이벤트
      const clearBtn = document.getElementById('filterClearBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          resetFilters();
          switchToLiveMode();
        });
      }
    } else {
      filterStatus.style.display = 'none';
    }

    // 필터 토글 바 상태 업데이트
    const filterToggleBar = document.getElementById('filterToggleBar');
    if (filterToggleBar) {
      const hasActiveFilter = liveView && liveView.isFilterActive();
      filterToggleBar.classList.toggle('has-filter', hasActiveFilter);
    }
  }

  // ===== v5.2.1: 스트리머 칩 업데이트 =====
  function updateStreamerChips() {
    const chipsContainer = document.getElementById('streamerChips');
    if (!chipsContainer) return;

    const currentStreamer = state.advancedFilters.streamer || '';

    chipsContainer.innerHTML = `
      <button class="streamer-chip ${currentStreamer === '' ? 'active' : ''}" data-streamer="">전체</button>
      ${state.streamers.map(s => `
        <button class="streamer-chip ${currentStreamer === s.id ? 'active' : ''}" data-streamer="${s.id}">
          ${s.nickname || s.id}
        </button>
      `).join('')}
    `;
  }

  // ===== v5.2.0: 검색 모드 UI 업데이트 =====
  function updateSearchModeUI() {
    const historyBtn = document.getElementById('chatHistoryBtn');
    const modeIndicator = document.getElementById('searchModeIndicator');

    if (historyBtn) {
      historyBtn.classList.toggle('active', state.searchMode === SEARCH_MODE.HISTORY);
    }

    if (modeIndicator) {
      modeIndicator.textContent = state.searchMode === SEARCH_MODE.LIVE ? '실시간' : '과거검색';
      modeIndicator.classList.toggle('history', state.searchMode === SEARCH_MODE.HISTORY);
    }
  }

  // ===== 설정 패널 열기/닫기 =====
  function openSettings() {
    const overlay = document.getElementById('chatSettingsOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      state.settingsOpen = true;
      renderSettings();
    }
  }

  function closeSettings() {
    const overlay = document.getElementById('chatSettingsOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      state.settingsOpen = false;
    }
  }

  // ===== 설정 패널 이벤트 바인딩 =====
  function bindSettingsEvents() {
    // 수집 모드 라디오 버튼
    document.querySelectorAll('input[name="collectMode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.settings.collectMode = e.target.value;
        saveSettings();
        renderSettings();

        // 메인 UI 업데이트
        const modeBtn = document.getElementById('collectModeBtn');
        const modeLabels = {
          [COLLECT_MODE.OFF]: getMessage('collectModeOff') || '수집 안함',
          [COLLECT_MODE.ALL]: getMessage('collectModeAll') || '모든 채팅방',
          [COLLECT_MODE.SELECTED]: getMessage('collectModeSelected') || '선택한 스트리머'
        };
        if (modeBtn) {
          modeBtn.innerHTML = `${modeLabels[state.settings.collectMode]}<span class="mode-arrow">▼</span>`;
        }

        const statusDot = document.querySelector('.chat-status-dot');
        if (statusDot) {
          statusDot.classList.toggle('ready', state.settings.collectMode !== COLLECT_MODE.OFF);
        }
      });
    });

    // 스트리머 추가/삭제/칩 이벤트는 bindEvents()에서 이벤트 위임으로 처리됨

    // 보관 기간 변경
    const retentionSelect = document.getElementById('retentionDays');
    if (retentionSelect) {
      retentionSelect.addEventListener('change', (e) => {
        state.settings.retentionDays = parseInt(e.target.value);
        saveSettings();
      });
    }

    // 데이터 관리 버튼
    const openDataManageBtn = document.getElementById('openDataManageBtn');
    if (openDataManageBtn) {
      openDataManageBtn.addEventListener('click', () => {
        closeSettings();
        openDataManageModal();
      });
    }
  }

  // ===== 데이터 관리 모달 열기 =====
  async function openDataManageModal() {
    const overlay = document.getElementById('chatDataManageOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      await renderDataManageModal();
      bindDataManageEvents();
    }
  }

  // ===== 데이터 관리 모달 닫기 =====
  function closeDataManageModal() {
    const overlay = document.getElementById('chatDataManageOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // ===== 데이터 관리 모달 렌더링 =====
  async function renderDataManageModal() {
    const content = document.getElementById('dataManageContent');
    if (!content) return;

    // 스트리머별 메시지 개수 조회
    const stats = await ChatStorage.getStats();
    const streamerCounts = await ChatStorage.getMessageCountByStreamer();
    const allStreamers = await ChatStorage.getStreamers();

    // 스트리머 목록에 메시지 개수 추가
    const streamersWithCount = allStreamers.map(s => ({
      ...s,
      messageCount: streamerCounts[s.id.toLowerCase()] || 0
    })).sort((a, b) => b.messageCount - a.messageCount);

    content.innerHTML = `
      <div class="data-manage-stats">
        <div class="stats-summary">
          <div class="stats-item">
            <span class="stats-value">${stats.messageCount.toLocaleString()}</span>
            <span class="stats-label">총 메시지</span>
          </div>
          <div class="stats-item">
            <span class="stats-value">${stats.sessionCount.toLocaleString()}</span>
            <span class="stats-label">세션</span>
          </div>
          <div class="stats-item">
            <span class="stats-value">${streamersWithCount.length}</span>
            <span class="stats-label">스트리머</span>
          </div>
        </div>
      </div>

      <div class="data-manage-section">
        <h4>스트리머별 데이터 삭제</h4>
        <p class="data-manage-hint">선택한 스트리머의 채팅 데이터를 삭제합니다.</p>

        ${streamersWithCount.length === 0 ?
          '<div class="no-data-message">수집된 데이터가 없습니다</div>' :
          `<div class="data-streamer-list">
            ${streamersWithCount.map(s => `
              <label class="data-streamer-item">
                <input type="checkbox" name="deleteStreamer" value="${s.id}" data-nick="${s.nickname || s.id}" data-count="${s.messageCount}">
                <span class="streamer-info">
                  <span class="streamer-name">${escapeHtml(s.nickname || s.id)}</span>
                  <span class="streamer-count">${s.messageCount.toLocaleString()}건</span>
                </span>
              </label>
            `).join('')}
          </div>
          <div class="data-streamer-actions">
            <button class="btn-select-all-data" id="dataSelectAll">모두 선택</button>
            <button class="btn-select-none-data" id="dataSelectNone">모두 해제</button>
          </div>
          <button class="btn-delete-selected" id="deleteSelectedBtn" disabled>
            선택한 스트리머 데이터 삭제
          </button>`
        }
      </div>

      <div class="data-manage-section data-manage-danger">
        <h4>전체 데이터 삭제</h4>
        <p class="data-manage-hint">수집된 모든 채팅 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.</p>
        <button class="btn-delete-all" id="deleteAllBtn" ${stats.messageCount === 0 ? 'disabled' : ''}>
          <span class="delete-icon">⚠️</span>
          <span>전체 데이터 삭제 (${stats.messageCount.toLocaleString()}건)</span>
        </button>
      </div>

      <div class="data-manage-actions">
        <button class="btn-data-manage-close" id="dataManageCloseBtn2">닫기</button>
      </div>
    `;
  }

  // ===== 데이터 관리 이벤트 바인딩 =====
  function bindDataManageEvents() {
    // 모달 닫기
    const closeBtn = document.getElementById('dataManageCloseBtn');
    const closeBtn2 = document.getElementById('dataManageCloseBtn2');
    const overlay = document.getElementById('chatDataManageOverlay');

    if (closeBtn) closeBtn.addEventListener('click', closeDataManageModal);
    if (closeBtn2) closeBtn2.addEventListener('click', closeDataManageModal);
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeDataManageModal();
      });
    }

    // 스트리머 체크박스 변경
    document.querySelectorAll('input[name="deleteStreamer"]').forEach(cb => {
      cb.addEventListener('change', updateDeleteSelectedButton);
    });

    // 모두 선택/해제
    const selectAllBtn = document.getElementById('dataSelectAll');
    const selectNoneBtn = document.getElementById('dataSelectNone');

    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        document.querySelectorAll('input[name="deleteStreamer"]').forEach(cb => {
          cb.checked = true;
        });
        updateDeleteSelectedButton();
      });
    }

    if (selectNoneBtn) {
      selectNoneBtn.addEventListener('click', () => {
        document.querySelectorAll('input[name="deleteStreamer"]').forEach(cb => {
          cb.checked = false;
        });
        updateDeleteSelectedButton();
      });
    }

    // 선택한 스트리머 삭제
    const deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', handleDeleteSelected);
    }

    // 전체 삭제
    const deleteAllBtn = document.getElementById('deleteAllBtn');
    if (deleteAllBtn) {
      deleteAllBtn.addEventListener('click', handleDeleteAll);
    }
  }

  // ===== 선택 삭제 버튼 상태 업데이트 =====
  function updateDeleteSelectedButton() {
    const selected = document.querySelectorAll('input[name="deleteStreamer"]:checked');
    const deleteBtn = document.getElementById('deleteSelectedBtn');
    if (deleteBtn) {
      deleteBtn.disabled = selected.length === 0;

      if (selected.length > 0) {
        let totalCount = 0;
        selected.forEach(cb => {
          totalCount += parseInt(cb.dataset.count) || 0;
        });
        deleteBtn.textContent = `${getMessage('deleteSelectedStreamerData') || '선택한 스트리머 데이터 삭제'} (${selected.length}${getMessage('unitPerson') || '명'}, ${totalCount.toLocaleString()}${getMessage('unitCount') || '건'})`;
      } else {
        deleteBtn.textContent = getMessage('deleteSelectedStreamerData') || '선택한 스트리머 데이터 삭제';
      }
    }
  }

  // ===== 선택한 스트리머 데이터 삭제 =====
  async function handleDeleteSelected() {
    const selected = Array.from(
      document.querySelectorAll('input[name="deleteStreamer"]:checked')
    );

    if (selected.length === 0) return;

    const streamerIds = selected.map(cb => cb.value);
    const streamerNames = selected.map(cb => cb.dataset.nick);
    let totalCount = 0;
    selected.forEach(cb => {
      totalCount += parseInt(cb.dataset.count) || 0;
    });

    // 삭제 확인 다이얼로그 표시
    const otherText = streamerNames.length > 3 ? ` ${getMessage('andOthers') || '외'} ${streamerNames.length - 3}${getMessage('unitPerson') || '명'}` : '';
    showConfirmDialog({
      icon: '🗑️',
      title: getMessage('deleteByStreamerTitle') || '스트리머별 데이터 삭제',
      message: `${streamerNames.slice(0, 3).join(', ')}${otherText}${getMessage('deleteConfirmSuffix') || '의 채팅 데이터'} ${totalCount.toLocaleString()}${getMessage('unitCount') || '건'}${getMessage('deleteConfirmQuestion') || '을 삭제하시겠습니까?'}`,
      showBackupOption: true,
      onConfirm: async (backupFirst) => {
        try {
          // 백업 옵션이 선택되었으면 먼저 백업
          if (backupFirst) {
            showToast(getMessage('creatingBackup') || '백업 파일 생성 중...');
            const data = await ChatStorage.exportByStreamers(streamerIds);
            await downloadBackup(data, `backup_${streamerNames.length}streamers`);
          }

          // 삭제 실행
          const result = await ChatStorage.deleteByStreamers(streamerIds);
          showToast(`${result.deletedMessages.toLocaleString()}${getMessage('unitCount') || '건'} ${getMessage('deleteComplete') || '삭제 완료'}`);

          // UI 새로고침
          await loadRecentData();
          state.streamers = await ChatStorage.getStreamers();
          await renderDataManageModal();
          bindDataManageEvents();
        } catch (e) {
          console.error('[ChatTab] Delete failed:', e);
          showToast(getMessage('deleteError') || '삭제 중 오류가 발생했습니다');
        }
      }
    });
  }

  // ===== 전체 데이터 삭제 =====
  async function handleDeleteAll() {
    const stats = await ChatStorage.getStats();

    // 삭제 확인 다이얼로그 표시
    showConfirmDialog({
      icon: '⚠️',
      title: getMessage('deleteAllTitle') || '전체 데이터 삭제',
      message: `${getMessage('deleteAllMessage') || '수집된 모든 채팅 데이터'} ${stats.messageCount.toLocaleString()}${getMessage('unitCount') || '건'}${getMessage('deleteConfirmQuestion') || '을 삭제하시겠습니까?'}\n\n${getMessage('cannotUndo') || '이 작업은 되돌릴 수 없습니다.'}`,
      showBackupOption: true,
      onConfirm: async (backupFirst) => {
        try {
          // 백업 옵션이 선택되었으면 먼저 백업
          if (backupFirst) {
            showToast(getMessage('creatingBackup') || '백업 파일 생성 중...');
            const data = await ChatStorage.exportAll();
            await downloadBackup(data, 'backup_all');
          }

          // 삭제 실행
          const result = await ChatStorage.deleteAllData();
          showToast(`${result.deletedMessages.toLocaleString()}${getMessage('unitCount') || '건'} ${getMessage('deleteComplete') || '삭제 완료'}`);

          // LiveView 초기화 (화면에 표시된 채팅 목록 정리)
          if (liveView) {
            liveView.clear();
          }

          // UI 새로고침 (데이터 다시 로드)
          await loadRecentData();
          state.streamers = await ChatStorage.getStreamers();
          await renderDataManageModal();
          bindDataManageEvents();
        } catch (e) {
          console.error('[ChatTab] Delete all failed:', e);
          showToast(getMessage('deleteError') || '삭제 중 오류가 발생했습니다');
        }
      }
    });
  }

  // ===== 확인 다이얼로그 표시 =====
  let confirmCallback = null;

  function showConfirmDialog({ icon, title, message, showBackupOption, onConfirm }) {
    const overlay = document.getElementById('chatConfirmOverlay');
    const iconEl = document.getElementById('confirmIcon');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const backupOption = document.getElementById('confirmBackupOption');
    const backupCheckbox = document.getElementById('backupBeforeDelete');

    if (!overlay) return;

    if (iconEl) iconEl.textContent = icon || '⚠️';
    if (titleEl) titleEl.textContent = title || '확인';
    if (messageEl) messageEl.textContent = message || '';
    if (backupOption) backupOption.style.display = showBackupOption ? 'block' : 'none';
    if (backupCheckbox) backupCheckbox.checked = true;

    confirmCallback = onConfirm;
    overlay.style.display = 'flex';

    // 이벤트 바인딩 (중복 방지)
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const deleteBtn = document.getElementById('confirmDeleteBtn');

    const handleCancel = () => {
      overlay.style.display = 'none';
      confirmCallback = null;
    };

    const handleConfirm = () => {
      overlay.style.display = 'none';
      const backupFirst = backupCheckbox && backupCheckbox.checked;
      if (confirmCallback) {
        confirmCallback(backupFirst);
        confirmCallback = null;
      }
    };

    // 기존 이벤트 제거 후 재바인딩
    if (cancelBtn) {
      cancelBtn.replaceWith(cancelBtn.cloneNode(true));
      document.getElementById('confirmCancelBtn').addEventListener('click', handleCancel);
    }

    if (deleteBtn) {
      deleteBtn.replaceWith(deleteBtn.cloneNode(true));
      document.getElementById('confirmDeleteBtn').addEventListener('click', handleConfirm);
    }

    // 오버레이 클릭으로 닫기
    overlay.onclick = (e) => {
      if (e.target === overlay) handleCancel();
    };
  }

  // ===== 백업 파일 다운로드 =====
  async function downloadBackup(data, filenamePrefix) {
    const content = JSON.stringify(data, null, 2);
    const filename = `${filenamePrefix}_${ChatStorage.formatDate(new Date())}.json`;
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: url,
      filename: `SOOPtalking/chat/backup/${filename}`,
      saveAs: true
    });
  }

  // ===== UI 헬퍼 =====
  function updateLoadingUI(loading) {
    const loadingEl = document.getElementById('chatLoading');
    const listEl = document.getElementById('chatList');

    if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
    if (listEl) listEl.style.opacity = loading ? '0.5' : '1';
  }

  // v5.2.1: 부드러운 숫자 애니메이션
  const animatingElements = new Map(); // 애니메이션 중인 요소 추적

  function animateNumber(element, targetValue, duration = 300) {
    if (!element) return;

    // 현재 값 파싱
    const currentText = element.textContent.replace(/,/g, '');
    const currentValue = parseInt(currentText) || 0;

    // 값이 같으면 스킵
    if (currentValue === targetValue) return;

    // 이전 애니메이션 취소
    const existingAnimation = animatingElements.get(element);
    if (existingAnimation) {
      cancelAnimationFrame(existingAnimation);
    }

    const startTime = performance.now();
    const diff = targetValue - currentValue;

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // easeOutQuad for smooth deceleration
      const easeProgress = 1 - (1 - progress) * (1 - progress);
      const value = Math.round(currentValue + diff * easeProgress);

      element.textContent = value.toLocaleString();

      if (progress < 1) {
        const animationId = requestAnimationFrame(update);
        animatingElements.set(element, animationId);
      } else {
        animatingElements.delete(element);
      }
    }

    const animationId = requestAnimationFrame(update);
    animatingElements.set(element, animationId);
  }

  function updateStatsUI(stats) {
    const msgCount = document.getElementById('statMessageCount');
    const sessionCount = document.getElementById('statSessionCount');

    animateNumber(msgCount, stats.messageCount);
    animateNumber(sessionCount, stats.sessionCount);
  }

  // v5.2.1: 한국어 날짜 포맷 (2024-01-15 → 2024년 1월 15일)
  function formatDateKorean(dateString) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    return `${year}년 ${parseInt(month)}월 ${parseInt(day)}일`;
  }

  // v5.2.1: 기본 날짜 초기화 (시작일: 1개월 전, 종료일: 오늘)
  function initDefaultDates() {
    const dateStartInput = document.getElementById('dateStartInput');
    const dateEndInput = document.getElementById('dateEndInput');
    const dateStartDisplay = document.getElementById('dateStartDisplay');
    const dateEndDisplay = document.getElementById('dateEndDisplay');

    if (!dateStartInput || !dateEndInput) return;

    // 이미 값이 있으면 스킵
    if (dateStartInput.value && dateEndInput.value) return;

    const today = new Date();
    const oneMonthAgo = new Date(today);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // ISO 형식으로 변환 (YYYY-MM-DD)
    const formatDate = (date) => {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    const startDate = formatDate(oneMonthAgo);
    const endDate = formatDate(today);

    // 입력 필드에 값 설정
    dateStartInput.value = startDate;
    dateEndInput.value = endDate;

    // 상태 업데이트
    state.advancedFilters.dateStart = startDate;
    state.advancedFilters.dateEnd = endDate;

    // 표시 업데이트
    if (dateStartDisplay) {
      dateStartDisplay.textContent = formatDateKorean(startDate);
      dateStartDisplay.classList.add('has-value');
    }
    if (dateEndDisplay) {
      dateEndDisplay.textContent = formatDateKorean(endDate);
      dateEndDisplay.classList.add('has-value');
    }

    debugLog('기본 날짜 설정:', startDate, '~', endDate);
  }

  // v5.2.1: 통합 검색 쿼리 파싱 (메시지, @닉네임)
  function parseUnifiedQuery(query) {
    if (!query) return { keyword: null, nickname: null };

    let keyword = query;
    let nickname = null;

    // @닉네임 패턴 추출
    const nicknameMatch = query.match(/@(\S+)/);
    if (nicknameMatch) {
      nickname = nicknameMatch[1];
      // @닉네임 부분 제거하고 나머지를 키워드로
      keyword = query.replace(/@\S+/g, '').trim();
    }

    return {
      keyword: keyword || null,
      nickname: nickname
    };
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getMessage(key) {
    try {
      return chrome.i18n.getMessage(key);
    } catch {
      return null;
    }
  }

  function showToast(message) {
    // 기존 sidepanel.js의 showToast 사용
    if (typeof window.showToast === 'function') {
      window.showToast(message);
    } else {
      console.log('[ChatTab]', message);
    }
  }

  // ===== Background 메시지 리스너 =====
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!state.isInitialized) return;

      switch (message.type) {
        case 'CHAT_SAVE_BATCH':
          handleChatBatch(message.messages, message.sessionId, message.streamerId, message.emergency);
          break;

        case 'CHAT_SESSION_START_UPDATE':
          handleSessionStart(message);
          break;

        case 'CHAT_SESSION_END_UPDATE':
          handleSessionEnd(message);
          break;

        case 'CHAT_COLLECTION_STATUS_UPDATE':
          state.collectionStatus = {
            isCollecting: message.isCollecting,
            isPaused: message.isPaused,
            streamerId: message.streamerId
          };
          updateStatusUI();
          break;

        // v5.3.0: 자동 백업 트리거
        case 'TRIGGER_CHAT_BACKUP':
          if (typeof BackupManager !== 'undefined') {
            BackupManager.runScheduledBackup().catch(e => {
              console.warn('[ChatTab] 자동 백업 실패:', e);
            });
          }
          break;
      }
    });
  }

  // ===== 채팅 배치 UI 업데이트 처리 =====
  // ⭐ v5.1.0: Lightweight MVC 패턴 적용 - liveView.onMessages() 사용
  // ⭐ v5.4.0: SQLite 실시간 저장 추가 (IndexedDB → SQLite 동기화)
  async function handleChatBatch(messages, sessionId, streamerId, emergency) {
    if (!messages || messages.length === 0) return;

    try {
      // 스트리머 닉네임 자동 업데이트 (메시지에서 추출)
      if (messages.length > 0 && streamerId) {
        const firstMsg = messages[0];
        if (firstMsg.streamerNick && firstMsg.streamerNick !== streamerId) {
          updateStreamerNickname(streamerId, firstMsg.streamerNick);
        }
      }

      // ⭐ v5.4.0: 받은 메시지를 SQLite에도 저장 (근본적 동기화 문제 해결)
      // Background.js는 IndexedDB에 저장하므로, 여기서 SQLite에도 저장
      try {
        if (typeof ChatStorage !== 'undefined' && ChatStorage.isReady && ChatStorage.isReady()) {
          await ChatStorage.saveMessages(messages, sessionId);
          debugLog(`${messages.length}건 SQLite 저장 완료`);
        }
      } catch (saveErr) {
        console.warn('[ChatTab] SQLite 저장 실패 (무시됨):', saveErr);
      }

      if (state.isVisible) {
        // LiveView가 초기화되지 않았으면 초기화
        if (!liveView) {
          initLiveView();
        }

        // ⭐ Lightweight MVC: liveView가 모든 렌더링 처리
        if (liveView) {
          liveView.onMessages(messages);
        }

        // 통계 업데이트 (DB 기준)
        const stats = await ChatStorage.getStats();
        updateStatsUI(stats);
      }

      debugLog(`${messages.length}건 UI 업데이트${emergency ? ' (긴급)' : ''}`);
    } catch (e) {
      console.error('[ChatTab] UI 업데이트 실패:', e);
    }
  }

  // ===== 세션 시작 UI 업데이트 처리 =====
  // ⭐ v5.0.0 버그 수정: Background에서 이미 저장하므로 여기서는 UI 업데이트만 담당
  async function handleSessionStart(sessionData) {
    try {
      // ⚠️ Background에서 이미 IndexedDB에 저장함 - 중복 저장 제거
      // await ChatDB.saveSession(session);

      // 스트리머 닉네임 자동 업데이트
      if (sessionData.streamerNick && sessionData.streamerId) {
        updateStreamerNickname(sessionData.streamerId, sessionData.streamerNick);
      }

      state.collectionStatus = {
        isCollecting: true,
        isPaused: false,
        streamerId: sessionData.streamerId,
        streamerNick: sessionData.streamerNick,
        bufferSize: 0
      };

      if (state.isVisible) {
        updateStatusUI();
        state.streamers = await ChatStorage.getStreamers();
        updateStreamerChips(); // v5.2.1: 스트리머 칩 업데이트
      }

      debugLog('세션 시작 UI 업데이트:', sessionData.streamerId);
    } catch (e) {
      console.error('[ChatTab] 세션 시작 UI 업데이트 실패:', e);
    }
  }

  // ===== 세션 종료 UI 업데이트 처리 =====
  // ⭐ v5.0.0 버그 수정: Background에서 이미 저장하므로 여기서는 UI 업데이트만 담당
  async function handleSessionEnd(sessionData) {
    try {
      // ⚠️ Background에서 이미 IndexedDB에 저장함 - 중복 저장 제거
      // await ChatDB.saveSession({...});

      state.collectionStatus = {
        isCollecting: false,
        isPaused: false,
        streamerId: null,
        streamerNick: null,
        bufferSize: 0
      };

      if (state.isVisible) {
        updateStatusUI();
      }

      debugLog('세션 종료 UI 업데이트:', sessionData.streamerId);
    } catch (e) {
      console.error('[ChatTab] 세션 종료 UI 업데이트 실패:', e);
    }
  }

  // ===== 정리 =====
  function destroy() {
    hide();
    state.isInitialized = false;
    state.results = [];
    state.flexSearch = null;
  }

  // ===== 메시지 리스너 등록 =====
  setupMessageListener();

  // ===== 공개 API =====
  return {
    init,
    show,
    hide,
    search,
    exportData,
    importData,
    destroy
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.ChatTab = ChatTab;
}
