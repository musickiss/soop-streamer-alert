// ===== 숲토킹 v5.0.0 - Chat Tab Module =====
// 채팅 탭 UI 및 AI 검색

const ChatTab = (function() {
  'use strict';

  // ===== 상수 =====
  const PAGE_SIZE = 50;
  const SEARCH_DEBOUNCE = 300;

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
      collectEnabled: true,
      retentionDays: 90
    }
  };

  let searchDebounceTimer = null;
  let statusUpdateInterval = null;

  // ===== 초기화 =====
  async function init() {
    if (state.isInitialized) return;

    console.log('[ChatTab] 초기화 시작');

    try {
      // ChatDB 초기화
      await ChatDB.init();

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
      state.streamers = await ChatDB.getStreamers();

      // 데이터 있는 날짜 로드
      state.datesWithData = await ChatDB.getDatesWithData();

      state.isInitialized = true;
      console.log('[ChatTab] 초기화 완료');
    } catch (error) {
      console.error('[ChatTab] 초기화 실패:', error);
    }
  }

  // ===== 설정 로드/저장 =====
  async function loadSettings() {
    try {
      const collectEnabled = await ChatDB.getSetting('collectEnabled', true);
      const retentionDays = await ChatDB.getSetting('retentionDays', 90);
      state.settings = { collectEnabled, retentionDays };
    } catch (e) {
      console.error('[ChatTab] 설정 로드 실패:', e);
    }
  }

  async function saveSettings() {
    try {
      await ChatDB.saveSetting('collectEnabled', state.settings.collectEnabled);
      await ChatDB.saveSetting('retentionDays', state.settings.retentionDays);
    } catch (e) {
      console.error('[ChatTab] 설정 저장 실패:', e);
    }
  }

  // ===== 탭 표시 =====
  async function show() {
    if (!state.isInitialized) {
      await init();
    }

    state.isVisible = true;
    render();
    bindEvents();

    // 수집 상태 주기적 업데이트
    updateCollectionStatus();
    statusUpdateInterval = setInterval(updateCollectionStatus, 5000);

    // 최근 데이터 로드
    await loadRecentData();
  }

  // ===== 탭 숨김 =====
  function hide() {
    state.isVisible = false;

    if (statusUpdateInterval) {
      clearInterval(statusUpdateInterval);
      statusUpdateInterval = null;
    }
  }

  // ===== 수집 상태 업데이트 =====
  async function updateCollectionStatus() {
    try {
      // 현재 활성 SOOP 탭 확인
      const tabs = await chrome.tabs.query({ url: '*://play.sooplive.co.kr/*' });

      if (tabs.length > 0) {
        // 첫 번째 SOOP 탭에서 상태 조회
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            type: 'GET_CHAT_COLLECTION_STATUS'
          });

          if (response) {
            state.collectionStatus = {
              isCollecting: response.isCollecting || false,
              streamerId: response.streamerId || null,
              streamerNick: response.streamerNick || null,
              bufferSize: response.bufferSize || 0,
              isPaused: response.isPaused || false
            };
          }
        } catch (e) {
          // 탭에서 응답 없음
          state.collectionStatus = {
            isCollecting: false,
            streamerId: null,
            bufferSize: 0
          };
        }
      } else {
        state.collectionStatus = {
          isCollecting: false,
          streamerId: null,
          bufferSize: 0
        };
      }

      // UI 업데이트
      updateStatusUI();
    } catch (e) {
      console.error('[ChatTab] 상태 업데이트 실패:', e);
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
      const messages = await ChatDB.getMessagesByDateRange(startDate, endDate, PAGE_SIZE * 10);

      state.results = messages;
      state.totalCount = messages.length;

      renderResults();

      // 통계 업데이트
      const stats = await ChatDB.getStats();
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
      startDate: ChatDB.formatDate(start),
      endDate: ChatDB.formatDate(end)
    };
  }

  // ===== 검색 =====
  async function search(queryText) {
    if (!queryText && !hasAdvancedFilters()) {
      await loadRecentData();
      return;
    }

    state.isLoading = true;
    updateLoadingUI(true);

    try {
      let query = {};

      // AI 파싱 시도
      if (queryText) {
        query = await parseSearchQuery(queryText);
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
      const results = await ChatDB.searchMessages(query);

      state.results = results;
      state.totalCount = results.length;
      state.currentPage = 1;

      renderResults();
    } catch (e) {
      console.error('[ChatTab] 검색 실패:', e);
      showToast(getMessage('searchError') || '검색 중 오류가 발생했습니다');
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
      console.log('[ChatTab] AI 파싱 성공:', aiResult);
      return aiResult;
    }

    // 2단계: 규칙 기반 파서
    const ruleResult = parseWithRules(input);
    console.log('[ChatTab] 규칙 파싱 결과:', ruleResult);
    return ruleResult;
  }

  // ===== Chrome Built-in AI =====
  async function parseWithBuiltInAI(input) {
    try {
      // AI API 확인
      if (!('ai' in self) || !self.ai?.languageModel) {
        console.log('[ChatTab] Chrome Built-in AI 미지원');
        return null;
      }

      const capabilities = await self.ai.languageModel.capabilities();
      if (capabilities.available === 'no') {
        console.log('[ChatTab] Chrome Built-in AI 사용 불가');
        return null;
      }

      // 세션 생성
      const session = await self.ai.languageModel.create({
        systemPrompt: `채팅 검색 쿼리를 JSON으로 변환하세요.
출력 형식만 반환 (설명 없이 JSON만): {"nicknames":[],"keywords":[],"dateStart":"","dateEnd":"","streamers":[]}
날짜 형식: YYYY-MM-DD
오늘 날짜: ${ChatDB.formatDate(new Date())}
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
      console.log('[ChatTab] AI 파싱 실패:', e.message);
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
      query.dateStart = query.dateEnd = ChatDB.formatDate(today);
    } else if (/어제/.test(input)) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      query.dateStart = query.dateEnd = ChatDB.formatDate(yesterday);
    } else if (/이번\s*주/.test(input)) {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      query.dateStart = ChatDB.formatDate(weekStart);
      query.dateEnd = ChatDB.formatDate(today);
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

  // ===== 내보내기 =====
  async function exportData(format = 'json') {
    try {
      const data = await ChatDB.exportAll();

      let content, filename, mimeType;

      if (format === 'csv') {
        // CSV 변환
        const headers = ['timestamp', 'date', 'time', 'userId', 'nickname', 'message', 'streamerId', 'streamerNick'];
        const rows = data.messages.map(m =>
          headers.map(h => `"${String(m[h] || '').replace(/"/g, '""')}"`).join(',')
        );
        content = [headers.join(','), ...rows].join('\n');
        filename = `sooptalking_chat_${ChatDB.formatDate(new Date())}.csv`;
        mimeType = 'text/csv;charset=utf-8';
      } else {
        // JSON
        content = JSON.stringify(data, null, 2);
        filename = `sooptalking_chat_${ChatDB.formatDate(new Date())}.json`;
        mimeType = 'application/json';
      }

      // 다운로드
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);

      await chrome.downloads.download({
        url: url,
        filename: `SOOPtalking/chat/${filename}`,
        saveAs: true
      });

      showToast(getMessage('exportSuccess') || '내보내기 완료');
    } catch (e) {
      console.error('[ChatTab] 내보내기 실패:', e);
      showToast(getMessage('exportError') || '내보내기 실패');
    }
  }

  // ===== 가져오기 =====
  async function importData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.messages || !Array.isArray(data.messages)) {
        throw new Error('잘못된 파일 형식');
      }

      const result = await ChatDB.importData(data, true);

      showToast(`${result.imported}건 가져오기 완료 (중복 ${result.skipped}건 제외)`);

      // 데이터 새로고침
      await loadRecentData();
      state.datesWithData = await ChatDB.getDatesWithData();
      state.streamers = await ChatDB.getStreamers();
    } catch (e) {
      console.error('[ChatTab] 가져오기 실패:', e);
      showToast(getMessage('importError') || '가져오기 실패: ' + e.message);
    }
  }

  // ===== 렌더링 =====
  function render() {
    const container = document.getElementById('chatTabContainer');
    if (!container) return;

    container.innerHTML = `
      <div class="chat-tab-content">
        <!-- 메인 스크롤 영역 -->
        <div class="chat-main-area">
          <!-- 수집 현황 -->
          <div class="chat-collection-status">
            <div class="status-info">
              <span class="chat-status-dot"></span>
              <span class="status-text" id="chatStatusText">${getMessage('chatNotCollecting') || '수집 대기 중'}</span>
            </div>
            <label class="toggle-switch small">
              <input type="checkbox" id="chatCollectToggle" ${state.settings.collectEnabled ? 'checked' : ''}>
              <span class="toggle-track"></span>
            </label>
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

          <!-- 채팅 목록 -->
          <div class="chat-list-container">
            <div class="chat-list" id="chatList">
              <!-- 동적 렌더링 -->
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

          <!-- 더보기 버튼 -->
          <div class="chat-load-more" id="loadMoreContainer" style="display: none;">
            <button class="load-more-btn" id="loadMoreBtn">${getMessage('loadMore') || '더보기'}</button>
          </div>
        </div>

        <!-- 데이터 관리 버튼 -->
        <div class="chat-data-actions">
          <button class="action-btn" id="chatExportBtn" title="${getMessage('export') || '내보내기'}">📤</button>
          <button class="action-btn" id="chatImportBtn" title="${getMessage('import') || '가져오기'}">📥</button>
          <button class="action-btn" id="chatSettingsBtn" title="${getMessage('settings') || '설정'}">⚙️</button>
          <input type="file" id="chatImportInput" accept=".json" style="display:none">
        </div>

        <!-- AI 검색 (하단 고정) -->
        <div class="chat-ai-search">
          <div class="search-input-wrapper">
            <input type="text"
                   class="search-input"
                   id="chatSearchInput"
                   placeholder="${getMessage('searchPlaceholder') || '닉네임A가 "안녕"이라고 말한 거...'}"
                   autocomplete="off">
            <button class="search-btn" id="chatSearchBtn">🔍</button>
          </div>
          <button class="advanced-toggle" id="advancedToggle">
            ${getMessage('advancedSearch') || '상세검색'} <span class="toggle-arrow">▲</span>
          </button>

          <!-- 상세 검색 -->
          <div class="advanced-search" id="advancedSearch" style="display: none;">
            <div class="search-field">
              <label>${getMessage('nickname') || '닉네임'}</label>
              <div class="tag-input" id="nicknameTagInput">
                <div class="tags-container" id="nicknameTags"></div>
                <input type="text" id="nicknameInput" placeholder="${getMessage('nicknamePlaceholder') || '닉네임 입력 후 Enter'}">
              </div>
            </div>
            <div class="search-field">
              <label>${getMessage('keyword') || '키워드'}</label>
              <input type="text" id="keywordInput" placeholder="${getMessage('keywordPlaceholder') || '검색할 단어'}">
            </div>
            <div class="search-field">
              <label>${getMessage('period') || '기간'}</label>
              <div class="date-range">
                <input type="date" id="dateStartInput">
                <span>~</span>
                <input type="date" id="dateEndInput">
              </div>
            </div>
            <div class="search-field">
              <label>${getMessage('streamer') || '스트리머'}</label>
              <select id="streamerSelect">
                <option value="">${getMessage('all') || '전체'}</option>
                ${state.streamers.map(s => `<option value="${s.id}">${s.nickname || s.id}</option>`).join('')}
              </select>
            </div>
            <div class="search-actions">
              <button class="btn-secondary" id="searchResetBtn">${getMessage('reset') || '초기화'}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    updateStatusUI();
  }

  // ===== 결과 렌더링 =====
  function renderResults() {
    const listEl = document.getElementById('chatList');
    const emptyEl = document.getElementById('chatEmpty');
    const loadMoreEl = document.getElementById('loadMoreContainer');

    if (!listEl) return;

    if (state.results.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = 'flex';
      if (loadMoreEl) loadMoreEl.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    // 표시할 결과
    const displayCount = state.currentPage * PAGE_SIZE;
    const displayResults = state.results.slice(0, displayCount);

    // 날짜별 그룹화
    const grouped = {};
    for (const msg of displayResults) {
      if (!grouped[msg.date]) {
        grouped[msg.date] = [];
      }
      grouped[msg.date].push(msg);
    }

    // HTML 생성
    let html = '';
    const dates = Object.keys(grouped).sort().reverse();

    for (const date of dates) {
      const dateObj = new Date(date);
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const dayName = dayNames[dateObj.getDay()];

      html += `
        <div class="chat-date-group">
          <div class="date-header">${date} (${dayName})</div>
          <div class="date-messages">
      `;

      for (const msg of grouped[date]) {
        html += `
          <div class="chat-message-item">
            <div class="message-header">
              <span class="message-time">${msg.time}</span>
              <span class="message-streamer">${escapeHtml(msg.streamerNick || msg.streamerId)}</span>
            </div>
            <div class="message-content">
              <span class="message-nickname">${escapeHtml(msg.nickname)}</span>
              <span class="message-text">${escapeHtml(msg.message)}</span>
            </div>
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    }

    listEl.innerHTML = html;

    // 더보기 버튼
    if (loadMoreEl) {
      loadMoreEl.style.display = displayCount < state.results.length ? 'flex' : 'none';
    }
  }

  // ===== 이벤트 바인딩 =====
  function bindEvents() {
    // 검색 입력
    const searchInput = document.getElementById('chatSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;

        // 디바운스
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          if (state.searchQuery) {
            search(state.searchQuery);
          }
        }, SEARCH_DEBOUNCE);
      });

      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          search(state.searchQuery);
        }
      });
    }

    // 검색 버튼
    const searchBtn = document.getElementById('chatSearchBtn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        search(state.searchQuery);
      });
    }

    // 상세검색 토글
    const advancedToggle = document.getElementById('advancedToggle');
    const advancedSearch = document.getElementById('advancedSearch');
    if (advancedToggle && advancedSearch) {
      advancedToggle.addEventListener('click', () => {
        state.advancedOpen = !state.advancedOpen;
        advancedSearch.style.display = state.advancedOpen ? 'block' : 'none';
        advancedToggle.classList.toggle('expanded', state.advancedOpen);
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

    // 수집 토글
    const collectToggle = document.getElementById('chatCollectToggle');
    if (collectToggle) {
      collectToggle.addEventListener('change', (e) => {
        state.settings.collectEnabled = e.target.checked;
        saveSettings();
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

    // 더보기
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        state.currentPage++;
        renderResults();
      });
    }

    // 닉네임 태그 입력
    const nicknameInput = document.getElementById('nicknameInput');
    if (nicknameInput) {
      nicknameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = e.target.value.trim();
          if (value && !state.advancedFilters.nicknames.includes(value)) {
            state.advancedFilters.nicknames.push(value);
            renderNicknameTags();
            e.target.value = '';
          }
        }
      });
    }

    // 키워드 입력
    const keywordInput = document.getElementById('keywordInput');
    if (keywordInput) {
      keywordInput.addEventListener('input', (e) => {
        state.advancedFilters.keywords = e.target.value;
      });
    }

    // 날짜 입력
    const dateStartInput = document.getElementById('dateStartInput');
    const dateEndInput = document.getElementById('dateEndInput');
    if (dateStartInput) {
      dateStartInput.addEventListener('change', (e) => {
        state.advancedFilters.dateStart = e.target.value;
      });
    }
    if (dateEndInput) {
      dateEndInput.addEventListener('change', (e) => {
        state.advancedFilters.dateEnd = e.target.value;
      });
    }

    // 스트리머 선택
    const streamerSelect = document.getElementById('streamerSelect');
    if (streamerSelect) {
      streamerSelect.addEventListener('change', (e) => {
        state.advancedFilters.streamer = e.target.value;
      });
    }

    // 초기화 버튼
    const resetBtn = document.getElementById('searchResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetFilters();
      });
    }
  }

  // ===== 닉네임 태그 렌더링 =====
  function renderNicknameTags() {
    const container = document.getElementById('nicknameTags');
    if (!container) return;

    container.innerHTML = state.advancedFilters.nicknames.map((nick, idx) => `
      <span class="tag">
        ${escapeHtml(nick)}
        <span class="tag-remove" data-idx="${idx}">×</span>
      </span>
    `).join('');

    // 삭제 이벤트
    container.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        state.advancedFilters.nicknames.splice(idx, 1);
        renderNicknameTags();
      });
    });
  }

  // ===== 필터 초기화 =====
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
    const keywordInput = document.getElementById('keywordInput');
    const dateStartInput = document.getElementById('dateStartInput');
    const dateEndInput = document.getElementById('dateEndInput');
    const streamerSelect = document.getElementById('streamerSelect');

    if (searchInput) searchInput.value = '';
    if (keywordInput) keywordInput.value = '';
    if (dateStartInput) dateStartInput.value = '';
    if (dateEndInput) dateEndInput.value = '';
    if (streamerSelect) streamerSelect.value = '';

    renderNicknameTags();
    loadRecentData();
  }

  // ===== UI 헬퍼 =====
  function updateLoadingUI(loading) {
    const loadingEl = document.getElementById('chatLoading');
    const listEl = document.getElementById('chatList');

    if (loadingEl) loadingEl.style.display = loading ? 'flex' : 'none';
    if (listEl) listEl.style.opacity = loading ? '0.5' : '1';
  }

  function updateStatsUI(stats) {
    const msgCount = document.getElementById('statMessageCount');
    const sessionCount = document.getElementById('statSessionCount');

    if (msgCount) msgCount.textContent = stats.messageCount.toLocaleString();
    if (sessionCount) sessionCount.textContent = stats.sessionCount.toLocaleString();
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
      }
    });
  }

  // ===== 채팅 배치 저장 처리 =====
  async function handleChatBatch(messages, sessionId, streamerId, emergency) {
    if (!messages || messages.length === 0) return;

    try {
      await ChatDB.saveMessages(messages);

      if (state.isVisible) {
        state.totalCount += messages.length;
        state.results = [...messages, ...state.results].slice(0, 5000);
        renderResults();

        const stats = await ChatDB.getStats();
        updateStatsUI(stats);
      }

      console.log(`[ChatTab] ${messages.length}건 저장${emergency ? ' (긴급)' : ''}`);
    } catch (e) {
      console.error('[ChatTab] 메시지 저장 실패:', e);
    }
  }

  // ===== 세션 시작 처리 =====
  async function handleSessionStart(sessionData) {
    try {
      const session = {
        id: sessionData.sessionId,
        streamerId: sessionData.streamerId,
        streamerNick: sessionData.streamerNick,
        date: ChatDB.formatDate(new Date()),
        startTime: sessionData.startTime,
        endTime: null,
        messageCount: 0
      };

      await ChatDB.saveSession(session);

      state.collectionStatus = {
        isCollecting: true,
        isPaused: false,
        streamerId: sessionData.streamerId,
        streamerNick: sessionData.streamerNick,
        bufferSize: 0
      };

      if (state.isVisible) {
        updateStatusUI();
        state.streamers = await ChatDB.getStreamers();
      }

      console.log('[ChatTab] 세션 시작:', sessionData.streamerId);
    } catch (e) {
      console.error('[ChatTab] 세션 시작 처리 실패:', e);
    }
  }

  // ===== 세션 종료 처리 =====
  async function handleSessionEnd(sessionData) {
    try {
      await ChatDB.saveSession({
        id: sessionData.sessionId,
        streamerId: sessionData.streamerId,
        date: ChatDB.formatDate(new Date()),
        endTime: sessionData.endTime
      });

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

      console.log('[ChatTab] 세션 종료:', sessionData.streamerId);
    } catch (e) {
      console.error('[ChatTab] 세션 종료 처리 실패:', e);
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
