/**
 * 숲토킹 v4.0 - 내 후원 탭 모듈
 * 기존 모니터링/녹화 기능과 완전 분리된 독립 모듈
 *
 * @version 4.0.0
 * @author Claude
 */
const DonationTab = (function() {
  'use strict';

  // ============================================
  // i18n 헬퍼 함수
  // ============================================
  function i18n(key) {
    return chrome.i18n.getMessage(key) || '';
  }

  // ============================================
  // 상수
  // 동기화: constants.js - STORAGE_KEYS, INTERVALS, API_URLS, LIMITS, UI
  // ============================================
  const STORAGE_KEY = 'myDonation';  // STORAGE_KEYS.MY_DONATION
  const SYNC_INTERVAL_MS = 30 * 60 * 1000;  // INTERVALS.DONATION_SYNC
  const DATA_URL = 'https://point.sooplive.co.kr/Report/AfreecaBalloonList.asp';  // API_URLS.DONATION_DATA

  // 전체 동기화 설정
  const FULL_SYNC_START_YEAR = 2020;  // LIMITS.DONATION_SYNC_START_YEAR
  const REQUEST_DELAY_MS = 300;  // INTERVALS.DONATION_REQUEST_DELAY

  // 차트 색상 (다크 테마에서 잘 보이는 밝은 색상)
  // 동기화: constants.js - UI.CHART_COLORS
  const CHART_COLORS = [
    '#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE'
  ];

  // ============================================
  // 내부 상태 (기존 state와 완전 분리)
  // ============================================
  const state = {
    isVisible: false,
    isLoading: false,
    isLoggedIn: null, // null: 미확인, true/false
    lastSync: null,
    data: null,
    settings: {
      defaultPeriod: '3m',
      autoSync: true,
      clearOnExit: false  // 브라우저 종료 시 데이터 삭제
    },
    // UI 상태
    currentSubTab: 'gift', // charge, gift, exchange
    currentPeriod: '3m',
    searchQuery: '',
    listPage: 1, // 현재 페이지
    // 전체 동기화 진행 상태
    syncProgress: {
      isFullSync: false,
      currentStep: '',
      totalSteps: 0,
      completedSteps: 0,
      chargeMonths: [], // 완료된 충전 내역 월
      giftPages: 0,     // 완료된 선물 내역 페이지
      totalGiftPages: 0
    }
  };

  // ============================================
  // DOM 요소 캐시
  // ============================================
  let container = null;
  let elements = {};
  let isInitialized = false;

  // ============================================
  // M-5: XSS 방어용 escapeHtml 함수
  // ============================================
  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // 공개 API
  // ============================================

  /**
   * 모듈 초기화
   */
  async function init() {
    // 중복 초기화 방지
    if (isInitialized) {
      show();
      return;
    }

    container = document.getElementById('donationTabContainer');
    if (!container) {
      console.error('[DonationTab] Container not found');
      return;
    }

    isInitialized = true;

    renderInitialUI();
    cacheElements();
    bindEvents();
    await loadFromStorage();

    // 데이터 유효성 검사
    const hasValidData = state.data &&
      (state.data.giftHistory?.length > 0 ||
       state.data.chargeHistory?.length > 0 ||
       state.data.balance?.current > 0);

    if (shouldSync() || !hasValidData) {
      sync();
    } else if (state.data) {
      render();
    } else {
      renderEmpty();
    }
  }

  /**
   * 탭 표시
   */
  function show() {
    state.isVisible = true;
    if (container) {
      container.style.display = 'block';
    }

    // 첫 표시 시 또는 30분 초과 시 동기화
    if (shouldSync()) {
      sync();
    } else if (state.data) {
      render();
    }
  }

  /**
   * 탭 숨김
   */
  function hide() {
    state.isVisible = false;
    if (container) {
      container.style.display = 'none';
    }
  }

  /**
   * 데이터 동기화
   */
  async function sync(fullSync = false) {
    if (state.isLoading) return;

    state.isLoading = true;
    renderLoading();

    try {
      // 전체 동기화: 기존 데이터 초기화 후 새로 불러오기 (계정 변경 시 데이터 혼합 방지)
      if (fullSync) {
        state.data = null;
        state.lastSync = null;
        await saveToStorage();
      }

      const result = await fetchDonationData(fullSync);

      if (result.success) {
        state.isLoggedIn = true;
        state.data = result.data;
        state.lastSync = Date.now();
        await saveToStorage();
        render();
        showToast(i18n('donationSyncComplete') || '동기화 완료');
      } else if (result.loginRequired) {
        state.isLoggedIn = false;
        state.data = null;
        renderLoginRequired();
      } else {
        const errorMsg = (i18n('donationSyncFailed') || '동기화 실패: $error$')
          .replace('$error$', result.error || i18n('unknownError') || '알 수 없는 오류');
        showToast(errorMsg);
        if (state.data) {
          render(); // 기존 캐시 데이터 표시
        }
      }
    } catch (error) {
      console.error('[DonationTab] Sync error:', error);
      showToast(i18n('donationSyncError') || '동기화 중 오류 발생');
      if (state.data) {
        render();
      }
    } finally {
      state.isLoading = false;
    }
  }

  /**
   * 모듈 정리
   */
  function destroy() {
    unbindEvents();
    container = null;
    elements = {};
  }

  // ============================================
  // 초기 UI 렌더링
  // ============================================

  function renderInitialUI() {
    const searchPlaceholder = i18n('donationSearchPlaceholder') || '스트리머, 금액 검색...';
    const syncText = i18n('donationSync') || '동기화';
    const fullSyncText = i18n('donationFullSync') || '전체';
    const fullSyncTooltip = i18n('donationFullSyncTooltip') || '기존 데이터 초기화 후 전체 다시 불러오기';
    const clearOnExitLabel = i18n('donationClearOnExit') || '브라우저 종료 시 수집된 데이터 삭제';
    const clearOnExitTooltip = i18n('donationClearOnExitTooltip') || '브라우저 실행 시 새롭게 정보를 수집하고, 브라우저가 닫히면 수집한 데이터를 모두 초기화합니다.';

    container.innerHTML = `
      <div class="donation-tab">
        <!-- 메인 콘텐츠 영역 -->
        <div class="donation-content" id="donationContent">
          <!-- 동적으로 렌더링 -->
        </div>

        <!-- 하단 고정: 검색 + 동기화 + 설정 (2줄) -->
        <div class="donation-bottom-bar">
          <div class="donation-bottom-row donation-search-row">
            <div class="donation-search-input-wrap">
              <svg class="donation-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input type="text" class="donation-search-input" id="donationSearchInput"
                     placeholder="${searchPlaceholder}">
              <button class="donation-search-clear" id="donationSearchClear" style="display:none;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="donation-bottom-row donation-controls-row">
            <label class="donation-clear-on-exit-label" title="${clearOnExitTooltip}">
              <input type="checkbox" id="donationClearOnExit" class="donation-clear-on-exit-checkbox">
              <span class="donation-clear-on-exit-text">${clearOnExitLabel}</span>
            </label>
            <button class="donation-sync-btn" id="donationSyncBtn" title="${syncText}">
              <svg class="donation-sync-icon" id="donationSyncIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
            <button class="donation-sync-btn donation-sync-full" id="donationFullSyncBtn" title="${fullSyncTooltip}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
            </button>
            <span class="donation-sync-time" id="donationSyncTime">-</span>
          </div>
        </div>
      </div>
    `;
  }

  function cacheElements() {
    elements.content = document.getElementById('donationContent');
    elements.searchInput = document.getElementById('donationSearchInput');
    elements.searchClear = document.getElementById('donationSearchClear');
    elements.syncBtn = document.getElementById('donationSyncBtn');
    elements.fullSyncBtn = document.getElementById('donationFullSyncBtn');
    elements.syncIcon = document.getElementById('donationSyncIcon');
    elements.syncTime = document.getElementById('donationSyncTime');
    elements.clearOnExitCheckbox = document.getElementById('donationClearOnExit');
  }

  // ============================================
  // 이벤트 바인딩
  // ============================================

  // 이벤트 핸들러 래퍼 (unbind를 위해 참조 유지)
  const eventHandlers = {
    syncClick: () => sync(false),
    fullSyncClick: () => sync(true)
  };

  function bindEvents() {
    // 검색
    elements.searchInput?.addEventListener('input', handleSearch);
    elements.searchClear?.addEventListener('click', clearSearch);

    // 동기화
    elements.syncBtn?.addEventListener('click', eventHandlers.syncClick);
    elements.fullSyncBtn?.addEventListener('click', eventHandlers.fullSyncClick);

    // 컨텐츠 영역 이벤트 위임
    elements.content?.addEventListener('click', handleContentClick);
    elements.content?.addEventListener('change', handleContentChange);

    // 빠른 후원 아바타 우클릭 (컨텍스트 메뉴)
    elements.content?.addEventListener('contextmenu', handleQuickGiftContextMenu);

    // 브라우저 종료 시 데이터 삭제 체크박스
    elements.clearOnExitCheckbox?.addEventListener('change', handleClearOnExitChange);
  }

  function unbindEvents() {
    elements.searchInput?.removeEventListener('input', handleSearch);
    elements.searchClear?.removeEventListener('click', clearSearch);
    elements.syncBtn?.removeEventListener('click', eventHandlers.syncClick);
    elements.fullSyncBtn?.removeEventListener('click', eventHandlers.fullSyncClick);
    elements.content?.removeEventListener('click', handleContentClick);
    elements.content?.removeEventListener('change', handleContentChange);
    elements.content?.removeEventListener('contextmenu', handleQuickGiftContextMenu);
    elements.clearOnExitCheckbox?.removeEventListener('change', handleClearOnExitChange);
  }

  // ============================================
  // 이벤트 핸들러
  // ============================================

  function handleSearch(e) {
    state.searchQuery = e.target.value.trim();
    state.listPage = 1; // 검색 시 페이지 리셋
    elements.searchClear.style.display = state.searchQuery ? 'block' : 'none';
    renderList();
  }

  function clearSearch() {
    state.searchQuery = '';
    state.listPage = 1; // 검색 클리어 시 페이지 리셋
    elements.searchInput.value = '';
    elements.searchClear.style.display = 'none';
    renderList();
  }

  function handleClearOnExitChange(e) {
    state.settings.clearOnExit = e.target.checked;
    saveToStorage();
  }

  function updateClearOnExitCheckbox() {
    if (elements.clearOnExitCheckbox) {
      elements.clearOnExitCheckbox.checked = state.settings.clearOnExit;
    }
  }

  function handleContentClick(e) {
    const target = e.target;

    // 서브탭 클릭
    if (target.closest('.donation-sub-tab')) {
      const tab = target.closest('.donation-sub-tab');
      state.currentSubTab = tab.dataset.tab;
      state.listPage = 1; // 탭 변경 시 페이지 리셋
      render();
      return;
    }

    // 로그인 버튼
    if (target.id === 'donationLoginBtn') {
      window.open('https://www.sooplive.co.kr/', '_blank');
      return;
    }

    // 후원하기 버튼 - 빠른 후원 스트리머가 선택되어 있으면 바로 후원
    if (target.id === 'donationGiftBtn' || target.closest('#donationGiftBtn')) {
      executeQuickGift();
      return;
    }

    // 빠른 후원 아바타 클릭
    if (target.closest('.quick-gift-avatar')) {
      const avatar = target.closest('.quick-gift-avatar');
      selectQuickGiftStreamer(avatar.dataset.id, avatar.dataset.nick);
      return;
    }

    // 빠른 후원 추가 버튼
    if (target.id === 'quickGiftAddBtn' || target.closest('#quickGiftAddBtn')) {
      openQuickGiftAddPopup();
      return;
    }
  }

  function handleContentChange(e) {
    const target = e.target;

    // 기간 필터 변경 (select의 change 이벤트)
    if (target.id === 'donationPeriodFilter') {
      state.currentPeriod = target.value;
      state.listPage = 1; // 기간 변경 시 페이지 리셋
      renderChart();
      renderList();
      return;
    }

    // 차트 타입 변경
    if (target.id === 'donationChartType') {
      state.currentChartType = target.value;
      renderChart();
      return;
    }
  }

  // ============================================
  // Storage 관리
  // ============================================

  async function loadFromStorage() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const saved = result[STORAGE_KEY];

      if (saved) {
        // ⭐ clearOnExit 설정 확인 - 새 세션이면 데이터 삭제
        if (saved.settings?.clearOnExit && !sessionStorage.getItem('donationSessionChecked')) {
          sessionStorage.setItem('donationSessionChecked', 'true');

          // 데이터만 삭제하고 settings 유지
          state.lastSync = null;
          state.isLoggedIn = null;
          state.data = null;
          state.settings = { ...state.settings, ...saved.settings };

          // 스토리지에 삭제된 상태 저장
          await saveToStorage();
        } else {
          state.lastSync = saved.lastSync || null;
          state.isLoggedIn = saved.isLoggedIn ?? null;
          state.data = saved.data || null;
          state.settings = { ...state.settings, ...saved.settings };
        }

        // 설정값 UI 반영
        state.currentPeriod = state.settings.defaultPeriod;

        // 브라우저 종료 시 데이터 삭제 체크박스 반영
        updateClearOnExitCheckbox();
      }

      updateSyncTime();
    } catch (error) {
      console.error('[DonationTab] Load from storage error:', error);
    }
  }

  async function saveToStorage() {
    try {
      const data = {
        lastSync: state.lastSync,
        isLoggedIn: state.isLoggedIn,
        data: state.data,
        settings: state.settings
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
    } catch (error) {
      // quota 초과 오류는 조용히 처리 (unlimitedStorage 권한으로 해결됨)
      if (error.message && error.message.includes('quota')) {
        console.warn('[DonationTab] Storage quota exceeded, data not saved');
      } else {
        console.error('[DonationTab] Save to storage error:', error);
      }
    }
  }

  // ============================================
  // 데이터 Fetch
  // ============================================

  function shouldSync() {
    if (!state.lastSync) return true;
    if (!state.data) return true;
    return (Date.now() - state.lastSync) > SYNC_INTERVAL_MS;
  }

  async function fetchDonationData(fullSync = false) {
    try {
      // 1단계: 기본 페이지 가져오기 (잔액 정보 + 첫 페이지 데이터)
      const baseResult = await fetchPage({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });

      if (!baseResult.success) {
        return baseResult;
      }

      let allData = baseResult.data;

      // 전체 동기화: 모든 연월 + 모든 페이지 가져오기
      if (fullSync) {
        allData = await performFullSync(allData);
      } else {
        // 일반 동기화: 최근 12개월 충전 내역 가져오기
        allData = await fetchRecentMonths(allData, 12);

        // 기존 저장된 데이터가 있으면 병합 (오래된 데이터 보존)
        if (state.data) {
          allData = mergeWithExistingData(allData, state.data);
        }
      }

      return { success: true, data: allData };
    } catch (error) {
      console.error('[DonationTab] Fetch error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 새로 가져온 데이터와 기존 저장된 데이터 병합
   * 새 데이터의 잔액 정보는 사용하고, 히스토리는 중복 제거 후 병합
   */
  function mergeWithExistingData(newData, existingData) {
    // 선물 내역 병합 (중복 제거)
    const giftKeys = new Set();
    const mergedGiftHistory = [];

    // 새 데이터 먼저 추가
    (newData.giftHistory || []).forEach(item => {
      const key = `gift_${item.date}_${item.streamer}_${item.amount}`;
      if (!giftKeys.has(key)) {
        giftKeys.add(key);
        mergedGiftHistory.push(item);
      }
    });

    // 기존 데이터 추가 (중복 아닌 것만)
    (existingData.giftHistory || []).forEach(item => {
      const key = `gift_${item.date}_${item.streamer}_${item.amount}`;
      if (!giftKeys.has(key)) {
        giftKeys.add(key);
        mergedGiftHistory.push(item);
      }
    });

    // 충전 내역 병합 (중복 제거)
    const chargeKeys = new Set();
    const mergedChargeHistory = [];

    (newData.chargeHistory || []).forEach(item => {
      const key = `charge_${item.date}_${item.amount}`;
      if (!chargeKeys.has(key)) {
        chargeKeys.add(key);
        mergedChargeHistory.push(item);
      }
    });

    (existingData.chargeHistory || []).forEach(item => {
      const key = `charge_${item.date}_${item.amount}`;
      if (!chargeKeys.has(key)) {
        chargeKeys.add(key);
        mergedChargeHistory.push(item);
      }
    });

    // 정렬 (최신순)
    mergedGiftHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    mergedChargeHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // summary 재계산
    const summary = calculateSummary(mergedGiftHistory, mergedChargeHistory);

    return {
      balance: newData.balance, // 잔액은 항상 최신 데이터 사용
      giftHistory: mergedGiftHistory,
      chargeHistory: mergedChargeHistory,
      summary
    };
  }

  /**
   * 최근 N개월 충전 내역 가져오기 (일반 동기화용)
   */
  async function fetchRecentMonths(baseData, monthsCount) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const allChargeHistory = [...(baseData.chargeHistory || [])];
    const processedKeys = new Set();

    // 이미 있는 데이터 키 등록
    allChargeHistory.forEach(item => {
      processedKeys.add(`charge_${item.date}_${item.amount}`);
    });

    // 최근 N개월 목록 생성
    const monthsToFetch = [];
    for (let i = 1; i < monthsCount; i++) {
      const targetDate = new Date(currentYear, currentMonth - 1 - i, 1);
      monthsToFetch.push({
        year: targetDate.getFullYear(),
        month: targetDate.getMonth() + 1
      });
    }

    // 각 월별로 충전 내역 가져오기
    for (const { year, month } of monthsToFetch) {
      const result = await fetchPage({ year, month, currpage_in: 1 });

      if (result.success && result.data.chargeHistory) {
        result.data.chargeHistory.forEach(item => {
          const key = `charge_${item.date}_${item.amount}`;
          if (!processedKeys.has(key)) {
            processedKeys.add(key);
            allChargeHistory.push(item);
          }
        });
      }

      await delay(REQUEST_DELAY_MS);
    }

    // 정렬 (최신순)
    allChargeHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // summary 재계산
    const summary = calculateSummary(
      baseData.giftHistory || [],
      allChargeHistory,
      baseData.exchangeHistory || []
    );

    return {
      balance: baseData.balance,
      chargeHistory: allChargeHistory,
      giftHistory: baseData.giftHistory || [],
      exchangeHistory: baseData.exchangeHistory || [],
      summary
    };
  }

  /**
   * 단일 페이지 요청
   */
  async function fetchPage(params = {}) {
    try {
      const { year, month, currpage_in = 1, currpage_out = 1 } = params;

      // GET 요청으로 변경 (POST는 500 에러 발생)
      const urlParams = new URLSearchParams();
      urlParams.append('currpage_in', currpage_in);
      urlParams.append('currpage_out', currpage_out);
      urlParams.append('gifttype', '1');
      if (year) urlParams.append('year', year);
      if (month) urlParams.append('month', String(month).padStart(2, '0'));

      const requestUrl = `${DATA_URL}?${urlParams.toString()}`;

      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      // 리다이렉트 체크 (로그인 필요)
      if (response.url.includes('login.sooplive.co.kr') || response.url.includes('login.afreecatv.com')) {
        return { success: false, loginRequired: true };
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const html = await response.text();

      // 로그인 페이지 체크 (HTML 내용으로)
      if (html.includes('login.sooplive.co.kr') || html.includes('로그인이 필요')) {
        return { success: false, loginRequired: true };
      }

      const data = parseHTML(html, params);
      return { success: true, data, html };
    } catch (error) {
      console.error('[DonationTab] fetchPage error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 전체 동기화 수행
   */
  async function performFullSync(baseData) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // 결과 누적용
    const allChargeHistory = [...(baseData.chargeHistory || [])];
    const allGiftHistory = [...(baseData.giftHistory || [])];
    const processedKeys = new Set();

    // 이미 있는 데이터 키 등록 (중복 방지)
    allChargeHistory.forEach(item => {
      processedKeys.add(`charge_${item.date}_${item.amount}`);
    });
    allGiftHistory.forEach(item => {
      processedKeys.add(`gift_${item.date}_${item.streamerNick}_${item.amount}`);
    });

    // 연월 목록 생성 (현재 ~ FULL_SYNC_START_YEAR)
    const monthsToFetch = [];
    for (let y = currentYear; y >= FULL_SYNC_START_YEAR; y--) {
      const endMonth = (y === currentYear) ? currentMonth : 12;
      for (let m = endMonth; m >= 1; m--) {
        // 현재 월은 이미 기본 페이지에서 가져왔으므로 스킵
        if (y === currentYear && m === currentMonth) continue;
        monthsToFetch.push({ year: y, month: m });
      }
    }

    state.syncProgress.isFullSync = true;
    state.syncProgress.totalSteps = monthsToFetch.length;
    state.syncProgress.completedSteps = 0;

    // 각 연월별로 충전 내역 가져오기
    for (const { year, month } of monthsToFetch) {
      const syncChargeMsg = (i18n('donationSyncCharge') || '충전내역 $date$')
      .replace('$date$', `${year}-${String(month).padStart(2, '0')}`);
    state.syncProgress.currentStep = syncChargeMsg;
      state.syncProgress.completedSteps++;
      updateSyncProgress();

      const result = await fetchPage({ year, month, currpage_in: 1 });

      if (result.success && result.data.chargeHistory) {
        result.data.chargeHistory.forEach(item => {
          const key = `charge_${item.date}_${item.amount}`;
          if (!processedKeys.has(key)) {
            processedKeys.add(key);
            allChargeHistory.push(item);
          }
        });
      }

      await delay(REQUEST_DELAY_MS);
    }

    // 선물 내역: 모든 페이지 가져오기
    state.syncProgress.currentStep = i18n('donationSyncGiftAll') || '선물내역 전체 페이지';
    updateSyncProgress();

    let giftPage = 2; // 1페이지는 이미 가져옴
    let hasMoreGiftPages = true;
    const maxGiftPages = 100; // 안전장치

    while (hasMoreGiftPages && giftPage <= maxGiftPages) {
      const syncGiftMsg = (i18n('donationSyncGift') || '선물내역 $page$페이지')
        .replace('$page$', giftPage);
      state.syncProgress.currentStep = syncGiftMsg;
      state.syncProgress.giftPages = giftPage;
      updateSyncProgress();

      const result = await fetchPage({
        year: currentYear,
        month: currentMonth,
        currpage_out: giftPage
      });

      if (result.success && result.data.giftHistory && result.data.giftHistory.length > 0) {
        let newItems = 0;
        result.data.giftHistory.forEach(item => {
          const key = `gift_${item.date}_${item.streamerNick}_${item.amount}`;
          if (!processedKeys.has(key)) {
            processedKeys.add(key);
            allGiftHistory.push(item);
            newItems++;
          }
        });

        // 새로운 데이터가 없으면 더 이상 페이지가 없는 것
        if (newItems === 0) {
          hasMoreGiftPages = false;
        } else {
          giftPage++;
        }
      } else {
        hasMoreGiftPages = false;
      }

      await delay(REQUEST_DELAY_MS);
    }

    state.syncProgress.isFullSync = false;
    state.syncProgress.totalGiftPages = giftPage - 1;

    // 정렬 (최신순)
    allChargeHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    allGiftHistory.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    // summary 재계산
    const summary = calculateSummary(allGiftHistory, allChargeHistory, []);

    return {
      balance: baseData.balance,
      chargeHistory: allChargeHistory,
      giftHistory: allGiftHistory,
      exchangeHistory: baseData.exchangeHistory || [],
      summary
    };
  }

  /**
   * 동기화 진행 상태 UI 업데이트
   */
  function updateSyncProgress() {
    if (!elements.content) return;
    if (!state.syncProgress.isFullSync) return;

    const { currentStep } = state.syncProgress;

    elements.content.innerHTML = `
      <div class="donation-loading">
        <div class="donation-loading-dots"><span></span><span></span><span></span></div>
        <div class="donation-loading-text">${currentStep}</div>
      </div>
    `;
  }

  /**
   * 딜레이 유틸리티
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function parseHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // ===== 별풍선 잔액 파싱 =====
    const balance = {
      current: 0,
      used: 0,
      expired: 0
    };

    // 페이지 텍스트에서 정보 추출
    const bodyText = doc.body?.textContent || '';

    // 패턴 0: HTML에서 <em> 태그 안의 숫자 추출 (가장 정확)
    const emBalanceMatch = html.match(/보유중인\s*별풍선은\s*<em>([0-9,]+)<\/em>\s*개/);
    if (emBalanceMatch) {
      balance.current = parseInt(emBalanceMatch[1].replace(/,/g, ''), 10);
    }

    // 패턴 1: myitem_info 클래스에서 직접 추출
    if (balance.current === 0) {
      const myitemInfo = doc.querySelector('.myitem_info');
      if (myitemInfo) {
        const emTag = myitemInfo.querySelector('em');
        if (emTag) {
          balance.current = parseInt(emTag.textContent.replace(/,/g, ''), 10);
        }
      }
    }

    // 패턴 2: textContent에서 "보유중인 별풍선은 17개"
    if (balance.current === 0) {
      const balanceMatch = bodyText.match(/보유중인\s*별풍선은\s*([0-9,]+)\s*개/);
      if (balanceMatch) {
        balance.current = parseInt(balanceMatch[1].replace(/,/g, ''), 10);
      }
    }

    // "이미 선물한 별풍선 : 1,324,303개" 추출
    const usedMatch = bodyText.match(/이미\s*선물한\s*별풍선\s*[:\s]*([0-9,]+)/);
    if (usedMatch) {
      balance.used = parseInt(usedMatch[1].replace(/,/g, ''), 10);
    }

    // ===== 충전 내역 파싱 (별풍선 충전 내역 테이블) =====
    const chargeHistory = [];
    const giftHistory = [];
    const exchangeHistory = [];

    // 충전 테이블 찾기: "구매일", "충전수", "결제수단" 등의 헤더가 있는 테이블
    const tables = doc.querySelectorAll('table');

    tables.forEach((table, tableIdx) => {
      const headerRow = table.querySelector('tr');
      const headerText = headerRow?.textContent || '';

      // 충전 내역 테이블 (구매일, 충전수, 결제수단, 결제금액, 사용기간)
      if (headerText.includes('구매일') || headerText.includes('충전수') || headerText.includes('결제금액')) {
        const rows = table.querySelectorAll('tr');
        rows.forEach((row, idx) => {
          if (idx === 0) return; // 헤더 스킵
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const dateText = cells[0]?.textContent?.trim() || '';
            const chargeText = cells[1]?.textContent?.trim() || '';
            const methodText = cells[2]?.textContent?.trim() || '';
            const priceText = cells[3]?.textContent?.trim() || '';

            const chargeMatch = chargeText.match(/([0-9,]+)/);
            const priceMatch = priceText.match(/([0-9,]+)/);

            if (chargeMatch) {
              chargeHistory.push({
                id: `charge_${tableIdx}_${idx}`,
                date: dateText,
                amount: parseInt(chargeMatch[1].replace(/,/g, ''), 10),
                method: methodText,
                price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : 0
              });
            }
          }
        });
      }

      // 선물 내역 테이블 (선물한 별풍선 | 목스리 선물 개수 | 별풍선을 선물한 스트리머 | 선물 일시)
      if (headerText.includes('선물한') || headerText.includes('스트리머') || headerText.includes('선물 일시')) {
        const rows = table.querySelectorAll('tr');
        rows.forEach((row, idx) => {
          if (idx === 0) return; // 헤더 스킵
          const cells = row.querySelectorAll('td');
          if (cells.length >= 4) {
            const amountText = cells[0]?.textContent?.trim() || '';
            const countText = cells[1]?.textContent?.trim() || '';
            const streamerText = cells[2]?.textContent?.trim() || '';
            const dateText = cells[3]?.textContent?.trim() || '';

            const amountMatch = amountText.match(/([0-9,]+)/);

            if (amountMatch) {
              giftHistory.push({
                id: `gift_${tableIdx}_${idx}`,
                date: dateText,
                amount: parseInt(amountMatch[1].replace(/,/g, ''), 10),
                streamerNick: streamerText,
                count: parseInt(countText.replace(/,/g, ''), 10) || 1
              });
            }
          }
        });
      }
    });

    // ===== 선물 내역 대체 파싱 (div 기반) =====
    // "선물한 별풍선 내역" 섹션에서 개별 항목 추출
    const giftItems = doc.querySelectorAll('.item_area, [class*="gift"], [class*="balloon"]');
    giftItems.forEach((item, idx) => {
      const text = item.textContent || '';
      // "27 김계란(kimgyeran) 2026-01-06 23:07:30" 같은 패턴
      const match = text.match(/(\d+)\s+(.+?)\s+(\d{4}-\d{2}-\d{2})/);
      if (match) {
        const existing = giftHistory.find(g => g.streamerNick === match[2] && g.date?.includes(match[3]));
        if (!existing) {
          giftHistory.push({
            id: `gift_div_${idx}`,
            amount: parseInt(match[1], 10),
            streamerNick: match[2].trim(),
            date: match[3],
            count: 1
          });
        }
      }
    });

    // 집계 계산
    const summary = calculateSummary(giftHistory, chargeHistory, exchangeHistory);

    return {
      balance,
      giftHistory,
      chargeHistory,
      exchangeHistory,
      summary
    };
  }

  function calculateSummary(giftHistory, chargeHistory, exchangeHistory = []) {
    const byStreamer = {};
    const byMonth = {};

    let totalGifted = 0;
    let totalCharged = 0;
    let totalExchanged = 0;

    // 선물 집계
    (giftHistory || []).forEach(item => {
      totalGifted += item.amount;

      // 스트리머별
      const nick = item.streamerNick || i18n('donationUnknown') || '알 수 없음';
      if (!byStreamer[nick]) {
        byStreamer[nick] = { nick, amount: 0, count: 0 };
      }
      byStreamer[nick].amount += item.amount;
      byStreamer[nick].count += 1;

      // 월별
      const month = item.date?.substring(0, 7) || 'unknown';
      if (!byMonth[month]) {
        byMonth[month] = { gifted: 0, charged: 0, exchanged: 0, streamers: new Set() };
      }
      byMonth[month].gifted += item.amount;
      byMonth[month].streamers.add(nick);
    });

    // 충전 집계
    (chargeHistory || []).forEach(item => {
      totalCharged += item.amount;
      const month = item.date?.substring(0, 7) || 'unknown';
      if (!byMonth[month]) {
        byMonth[month] = { gifted: 0, charged: 0, exchanged: 0, streamers: new Set() };
      }
      byMonth[month].charged += item.amount;
    });

    // 환전 집계
    (exchangeHistory || []).forEach(item => {
      totalExchanged += item.amount;
      const month = item.date?.substring(0, 7) || 'unknown';
      if (!byMonth[month]) {
        byMonth[month] = { gifted: 0, charged: 0, exchanged: 0, streamers: new Set() };
      }
      byMonth[month].exchanged += item.amount;
    });

    // Set을 배열로 변환
    Object.keys(byMonth).forEach(key => {
      byMonth[key].streamers = Array.from(byMonth[key].streamers);
    });

    return {
      totalGifted,
      totalCharged,
      totalExchanged,
      byStreamer,
      byMonth
    };
  }

  // ============================================
  // 렌더링
  // ============================================

  function render() {
    if (!elements.content) return;
    if (!state.data) {
      if (state.isLoggedIn === false) {
        renderLoginRequired();
      } else {
        renderEmpty();
      }
      return;
    }

    const { balance, summary } = state.data;

    // i18n 문자열
    const dataNotice1 = i18n('donationDataNotice') || '로그인 계정 기반 · 로컬에만 저장 (외부 전송 없음)';
    const dataNotice2 = i18n('donationDataNotice2') || '수집 시점에 따라 실제와 차이가 있을 수 있습니다';
    const balanceLabel = i18n('donationBalance') || '보유 별풍선';
    const usedLabel = i18n('donationUsed') || '사용';
    const unitLabel = i18n('donationUnit') || '개';
    const giftBtnText = i18n('donationGiftBtn') || '🎁 후원하기';
    const giftBtnTooltip1 = i18n('donationGiftBtnTooltip1') || '스트리머 방송국에 직접 후원합니다.';
    const giftBtnTooltip2 = i18n('donationGiftBtnTooltip2') || '후원 메시지 확인은 라이브 채팅창 재입장 필요';
    const giftBtnTooltip3 = i18n('donationGiftBtnTooltip3') || '사용자 조작 실수 등 이용에 따른 결과는 개발자가 책임지지 않습니다.';
    const tabGift = i18n('donationTabGift') || '🎁 선물';
    const tabCharge = i18n('donationTabCharge') || '💳 충전';
    const period1m = i18n('donationPeriod1m') || '1개월';
    const period3m = i18n('donationPeriod3m') || '3개월';
    const period6m = i18n('donationPeriod6m') || '6개월';
    const period1y = i18n('donationPeriod1y') || '1년';
    const periodAll = i18n('donationPeriodAll') || '전체';

    elements.content.innerHTML = `
      <!-- ===== 상단 고정 영역 ===== -->
      <div class="donation-fixed-top">
        <!-- 데이터 안내 배너 -->
        <div class="donation-data-notice">
          <span class="donation-data-notice-icon">ⓘ</span>
          <span class="donation-data-notice-text">
            ${dataNotice1}<br>
            ${dataNotice2}
          </span>
        </div>

        <!-- 별풍선 현황 카드 -->
        <div class="donation-balance-card">
          <div class="donation-balance-row">
            <div class="donation-balance-item">
              <span class="donation-balance-icon">🎈</span>
              <span class="donation-balance-text">${balanceLabel} <strong>${formatNumber(balance.current)}</strong>${unitLabel}</span>
            </div>
            <div class="donation-balance-item">
              <span class="donation-balance-icon">📤</span>
              <span class="donation-balance-text">${usedLabel} <strong>${formatNumber(balance.used)}</strong>${unitLabel}</span>
            </div>
          </div>
          <div class="donation-gift-btn-wrap">
            <button class="donation-gift-btn" id="donationGiftBtn">
              ${giftBtnText}
            </button>
            <div class="donation-gift-tooltip">
              <div class="donation-gift-tooltip-content">
                <p class="donation-gift-tooltip-title">${giftBtnTooltip1}</p>
                <p class="donation-gift-tooltip-desc">${giftBtnTooltip2}</p>
                <p class="donation-gift-tooltip-notice">${giftBtnTooltip3}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 빠른 후원 영역 -->
        <div class="quick-gift-section" id="quickGiftSection">
          <!-- 동적 렌더링 -->
        </div>

        <!-- 서브탭 -->
        <div class="donation-sub-tabs">
          <button class="donation-sub-tab ${state.currentSubTab === 'gift' ? 'active' : ''}" data-tab="gift">
            ${tabGift}
          </button>
          <button class="donation-sub-tab ${state.currentSubTab === 'charge' ? 'active' : ''}" data-tab="charge">
            ${tabCharge}
          </button>
        </div>

        <!-- 기간 필터 (충전/환전 탭만) -->
        ${state.currentSubTab !== 'gift' ? `
        <div class="donation-period-filter">
          <select class="donation-period-select" id="donationPeriodFilter">
            <option value="1m" ${state.currentPeriod === '1m' ? 'selected' : ''}>${period1m}</option>
            <option value="3m" ${state.currentPeriod === '3m' ? 'selected' : ''}>${period3m}</option>
            <option value="6m" ${state.currentPeriod === '6m' ? 'selected' : ''}>${period6m}</option>
            <option value="1y" ${state.currentPeriod === '1y' ? 'selected' : ''}>${period1y}</option>
            <option value="all" ${state.currentPeriod === 'all' ? 'selected' : ''}>${periodAll}</option>
          </select>
        </div>
        ` : ''}

        <!-- 원형 차트 영역 (고정) -->
        <div class="donation-chart-section" id="donationChartContainer">
          <!-- 동적 렌더링 -->
        </div>
      </div>

      <!-- ===== 스크롤 가능 영역 (상세 내역만) ===== -->
      <div class="donation-scrollable">
        <!-- 상세 내역 리스트 -->
        <div class="donation-list-section" id="donationListContainer">
          <!-- 동적 렌더링 -->
        </div>
      </div>
    `;

    renderChart();
    renderList();
    updateSyncTime();
    renderQuickGift();
  }

  // ============================================
  // 빠른 후원 기능
  // ============================================
  const quickGiftState = {
    selectedStreamer: null  // 빠른 후원용 선택된 스트리머
  };

  async function renderQuickGift() {
    const container = document.getElementById('quickGiftSection');
    if (!container) return;

    const giftFavorites = await getGiftFavorites();

    // 즐겨찾기가 없으면 빠른 후원 섹션 숨김
    if (giftFavorites.length === 0) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';

    // 이전에 선택된 스트리머가 여전히 즐겨찾기에 있는지 확인
    if (quickGiftState.selectedStreamer) {
      const stillExists = giftFavorites.some(f => f.id === quickGiftState.selectedStreamer.id);
      if (!stillExists) {
        quickGiftState.selectedStreamer = null;
      }
    }

    // 선택된 스트리머가 없으면 첫 번째 즐겨찾기 스트리머 자동 선택
    if (!quickGiftState.selectedStreamer && giftFavorites.length > 0) {
      quickGiftState.selectedStreamer = {
        id: giftFavorites[0].id,
        nick: giftFavorites[0].nickname
      };
    }

    const quickGiftLabel = i18n('quickGiftLabel') || '빠른 후원';
    const selectedNick = quickGiftState.selectedStreamer?.nick || '';

    // 아바타 칩 생성 (M-5: escapeHtml 적용)
    const avatarChipsHtml = giftFavorites.map(s => {
      const isSelected = quickGiftState.selectedStreamer?.id === s.id;
      const firstChar = getFirstChar(s.nickname);
      const safeNick = escapeHtml(s.nickname);
      const safeId = escapeHtml(s.id);
      return `
        <div class="quick-gift-avatar${isSelected ? ' selected' : ''}"
             data-id="${safeId}"
             data-nick="${safeNick}"
             title="${safeNick}">
          <span class="quick-gift-avatar-char">${escapeHtml(firstChar)}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="quick-gift-label">⭐ ${quickGiftLabel}</div>
      <div class="quick-gift-avatars">
        ${avatarChipsHtml}
        <button class="quick-gift-add-btn" id="quickGiftAddBtn" title="즐겨찾기 추가/편집">+</button>
      </div>
      <div class="quick-gift-selected-name">${escapeHtml(selectedNick)}</div>
    `;
  }

  // 첫 글자 추출 함수
  function getFirstChar(name) {
    if (!name) return '?';
    return name.charAt(0);
  }

  // 빠른 후원 스트리머 선택
  function selectQuickGiftStreamer(id, nick) {
    quickGiftState.selectedStreamer = { id, nick };

    // UI 업데이트
    document.querySelectorAll('.quick-gift-avatar').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });

    const nameEl = document.querySelector('.quick-gift-selected-name');
    if (nameEl) {
      nameEl.textContent = nick;
    }
  }

  // 빠른 후원 즐겨찾기에서 제거
  async function removeQuickGiftFavorite(id) {
    const favorites = await getGiftFavorites();
    const index = favorites.findIndex(f => f.id === id);

    if (index >= 0) {
      favorites.splice(index, 1);
      await saveGiftFavorites(favorites);

      // 삭제된 스트리머가 현재 선택된 경우 선택 해제
      if (quickGiftState.selectedStreamer?.id === id) {
        quickGiftState.selectedStreamer = null;
      }

      // UI 갱신
      renderQuickGift();

      const removedMsg = i18n('quickGiftRemoved') || '빠른 후원에서 제거되었습니다';
      showToast(removedMsg);
    }
  }

  // 빠른 후원 스트리머 추가 팝업
  async function openQuickGiftAddPopup() {
    const giftFavorites = await getGiftFavorites();
    const monitoringStreamers = await getMonitoringStreamers();
    const giftFavIds = new Set(giftFavorites.map(f => f.id));

    const popupTitle = i18n('quickGiftPopupTitle') || '빠른 후원 스트리머 선택';
    const maxNotice = i18n('quickGiftMaxNotice') || '최대 5명까지 선택 가능';
    const closeText = i18n('donationGiftClose') || '닫기';

    const popup = document.createElement('div');
    popup.className = 'quick-gift-popup-overlay';

    // 스트리머 목록 HTML (M-5: escapeHtml 적용)
    const streamerListHtml = monitoringStreamers.map(s => {
      const isFav = giftFavIds.has(s.id);
      const safeId = escapeHtml(s.id);
      const safeNick = escapeHtml(s.nickname);
      return `
        <div class="quick-gift-popup-item${isFav ? ' is-fav' : ''}" data-id="${safeId}" data-nick="${safeNick}">
          <span class="quick-gift-popup-nick">${safeNick}</span>
          <span class="quick-gift-popup-id">@${safeId}</span>
          <span class="quick-gift-popup-star">${isFav ? '★' : '☆'}</span>
        </div>
      `;
    }).join('');

    const emptyText = i18n('quickGiftNoStreamers') || '모니터링 중인 스트리머가 없습니다';

    popup.innerHTML = `
      <div class="quick-gift-popup">
        <div class="quick-gift-popup-header">
          <span class="quick-gift-popup-title">${popupTitle}</span>
          <button class="quick-gift-popup-close">✕</button>
        </div>
        <div class="quick-gift-popup-notice">${maxNotice}</div>
        <div class="quick-gift-popup-list">
          ${monitoringStreamers.length > 0 ? streamerListHtml : `<div class="quick-gift-popup-empty">${emptyText}</div>`}
        </div>
        <div class="quick-gift-popup-footer">
          <button class="quick-gift-popup-close-btn">${closeText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(popup);

    // 팝업 이벤트 바인딩
    popup.addEventListener('click', handleQuickGiftPopupClick);
  }

  function handleQuickGiftPopupClick(e) {
    const target = e.target;

    // 팝업 닫기
    if (target.classList.contains('quick-gift-popup-overlay') ||
        target.classList.contains('quick-gift-popup-close') ||
        target.classList.contains('quick-gift-popup-close-btn')) {
      closeQuickGiftPopup();
      return;
    }

    // 스트리머 토글
    const item = target.closest('.quick-gift-popup-item');
    if (item) {
      toggleQuickGiftPopupItem(item);
    }
  }

  async function toggleQuickGiftPopupItem(item) {
    const id = item.dataset.id;
    const nick = item.dataset.nick;
    const isFav = item.classList.contains('is-fav');

    const favorites = await getGiftFavorites();

    if (isFav) {
      // 제거
      const index = favorites.findIndex(f => f.id === id);
      if (index >= 0) {
        favorites.splice(index, 1);
      }
      item.classList.remove('is-fav');
      item.querySelector('.quick-gift-popup-star').textContent = '☆';
    } else {
      // 추가 (최대 5명 제한)
      if (favorites.length >= 5) {
        const maxMsg = i18n('quickGiftMaxReached') || '최대 5명까지만 추가할 수 있습니다';
        showToast(maxMsg);
        return;
      }
      favorites.push({ id, nickname: nick });
      item.classList.add('is-fav');
      item.querySelector('.quick-gift-popup-star').textContent = '★';
    }

    await saveGiftFavorites(favorites);
    // 빠른 후원 영역 갱신
    renderQuickGift();
  }

  function closeQuickGiftPopup() {
    const popup = document.querySelector('.quick-gift-popup-overlay');
    if (popup) {
      popup.remove();
    }
  }

  // 빠른 후원 실행 (후원하기 버튼 클릭 시)
  async function executeQuickGift() {
    if (!quickGiftState.selectedStreamer) {
      // 선택된 스트리머가 없으면 기존 모달 열기
      openGiftModal();
      return;
    }

    const { id, nick } = quickGiftState.selectedStreamer;

    // 확인 팝업 없이 바로 후원창 열기
    await processGift(id, nick);
  }

  // 빠른 후원 아바타 우클릭 핸들러
  function handleQuickGiftContextMenu(e) {
    const avatar = e.target.closest('.quick-gift-avatar');
    if (!avatar) return;

    e.preventDefault();

    const id = avatar.dataset.id;
    const nick = avatar.dataset.nick;

    // 컨텍스트 메뉴 표시
    showQuickGiftContextMenu(e.clientX, e.clientY, id, nick);
  }

  function showQuickGiftContextMenu(x, y, id, nick) {
    // 기존 컨텍스트 메뉴 제거
    closeQuickGiftContextMenu();

    const removeText = i18n('quickGiftRemove') || '빠른 후원에서 제거';

    const menu = document.createElement('div');
    menu.className = 'quick-gift-context-menu';
    menu.innerHTML = `
      <div class="quick-gift-context-item" data-action="remove" data-id="${id}">
        <span class="quick-gift-context-icon">✕</span>
        <span class="quick-gift-context-text">${removeText}</span>
      </div>
    `;

    // 위치 설정
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    document.body.appendChild(menu);

    // 클릭 이벤트
    menu.addEventListener('click', async (e) => {
      const item = e.target.closest('.quick-gift-context-item');
      if (item && item.dataset.action === 'remove') {
        await removeQuickGiftFavorite(item.dataset.id);
      }
      closeQuickGiftContextMenu();
    });

    // 외부 클릭 시 닫기
    setTimeout(() => {
      document.addEventListener('click', closeQuickGiftContextMenu, { once: true });
    }, 0);
  }

  function closeQuickGiftContextMenu() {
    const menu = document.querySelector('.quick-gift-context-menu');
    if (menu) {
      menu.remove();
    }
  }

  function renderLoading() {
    if (!elements.content) return;

    const syncingText = i18n('donationSyncing') || '동기화 중';

    elements.content.innerHTML = `
      <div class="donation-loading">
        <div class="donation-loading-dots"><span></span><span></span><span></span></div>
        <div class="donation-loading-text">${syncingText}</div>
      </div>
    `;

    // 동기화 버튼 아이콘 회전
    if (elements.syncIcon) {
      elements.syncIcon.classList.add('spinning');
    }
  }

  function renderLoginRequired() {
    if (!elements.content) return;

    const loginTitle = i18n('donationLoginRequired') || '로그인 필요';
    const loginDesc = i18n('donationLoginDesc') || 'SOOP에 로그인 후 이용 가능합니다';
    const loginBtn = i18n('donationLoginBtn') || 'SOOP 로그인';

    elements.content.innerHTML = `
      <div class="donation-login-required">
        <div class="donation-login-icon">🔒</div>
        <div class="donation-login-title">${loginTitle}</div>
        <div class="donation-login-desc">${loginDesc}</div>
        <button class="donation-login-btn" id="donationLoginBtn">${loginBtn}</button>
      </div>
    `;

    if (elements.syncIcon) {
      elements.syncIcon.classList.remove('spinning');
    }
  }

  function renderEmpty() {
    if (!elements.content) return;

    const emptyText = i18n('donationEmpty') || '동기화 버튼을 눌러 데이터를 불러오세요';

    elements.content.innerHTML = `
      <div class="donation-empty">
        <div class="donation-empty-icon">📊</div>
        <div class="donation-empty-text">${emptyText}</div>
      </div>
    `;
  }

  function renderChart() {
    const chartContainer = document.getElementById('donationChartContainer');
    if (!chartContainer || !state.data) return;

    const { summary } = state.data;

    // 원형 차트만 사용
    renderPieChart(chartContainer, summary);
  }

  function renderPieChart(container, summary) {
    let data;
    if (state.currentSubTab === 'gift') {
      // 선물: 스트리머별 합계 (전체 데이터 - 기간 필터 없음)
      const allGifts = state.data.giftHistory || [];

      const byStreamerFiltered = {};
      allGifts.forEach(item => {
        const nick = item.streamerNick || item.target || i18n('donationUnknown') || '알 수 없음';
        if (!byStreamerFiltered[nick]) {
          byStreamerFiltered[nick] = { amount: 0, count: 0 };
        }
        byStreamerFiltered[nick].amount += item.amount || 0;
        byStreamerFiltered[nick].count += 1;
      });

      data = Object.entries(byStreamerFiltered)
        .map(([nick, v]) => ({ label: nick, value: v.amount, count: v.count }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    } else {
      // 충전: chargeHistory에서 직접 월별 합계 계산 (기간 필터 적용)
      const history = state.currentSubTab === 'charge'
        ? (state.data.chargeHistory || [])
        : (state.data.exchangeHistory || []);

      // 기간 필터 먼저 적용
      const filteredHistory = filterByPeriod(history, 'date');

      // 필터링된 데이터에서 월별 합계 계산
      const byMonth = {};
      filteredHistory.forEach(item => {
        const dateStr = item.date || '';
        // YYYY-MM 형식으로 정규화
        const month = dateStr.replace(/\./g, '-').substring(0, 7);
        if (!month || month.length < 7) return;

        if (!byMonth[month]) {
          byMonth[month] = 0;
        }
        byMonth[month] += item.amount || 0;
      });

      data = Object.entries(byMonth)
        .map(([month, value]) => ({ label: month, value }))
        .filter(d => d.value > 0)
        .sort((a, b) => b.label.localeCompare(a.label)); // 최신순 정렬
    }

    if (data.length === 0) {
      container.innerHTML = `<div class="donation-chart-empty">${i18n('donationChartEmpty') || '데이터가 없습니다'}</div>`;
      return;
    }

    // 총합은 필터링된 전체 데이터로 계산
    const total = data.reduce((sum, d) => sum + d.value, 0);

    // 차트 표시용은 최대 6개, 나머지는 "기타"로 합산
    const chartData = data.slice(0, 6);
    const otherData = data.slice(6);
    const otherTotal = otherData.reduce((sum, d) => sum + d.value, 0);

    if (otherTotal > 0) {
      chartData.push({ label: i18n('donationChartOther') || '기타', value: otherTotal });
    }

    // 차트용 총합 (chartData 기준)
    const chartTotal = chartData.reduce((sum, d) => sum + d.value, 0);
    let currentAngle = 0;

    const gradientParts = chartData.map((item, idx) => {
      const startAngle = currentAngle;
      currentAngle += (item.value / chartTotal) * 360;
      return `${CHART_COLORS[idx % CHART_COLORS.length]} ${startAngle}deg ${currentAngle}deg`;
    });

    const unit = i18n('donationUnit') || '개';
    const chartTitle = state.currentSubTab === 'gift'
      ? (i18n('donationChartGift') || '스트리머별 선물')
      : (i18n('donationChartCharge') || `${getSubTabLabel()} 현황`);

    // 선물 탭일 때 정보 아이콘 추가
    const chartInfoTooltip = i18n('donationChartInfo') || '최근 3개월 통계입니다';
    const infoIcon = state.currentSubTab === 'gift' ? `
      <span class="donation-chart-info">
        <span class="donation-info-icon">ⓘ</span>
        <span class="donation-info-tooltip">${chartInfoTooltip}</span>
      </span>
    ` : '';

    container.innerHTML = `
      <div class="donation-chart-header">
        <span class="donation-chart-title">${chartTitle}${infoIcon}</span>
      </div>

      <!-- 원형 차트 (중앙 배치) -->
      <div class="donation-pie-wrapper">
        <div class="donation-pie-visual" style="background: conic-gradient(${gradientParts.join(', ')})">
          <div class="donation-pie-center">
            <div class="donation-pie-center-value">${formatNumber(total)}</div>
            <div class="donation-pie-center-unit">${unit}</div>
          </div>
        </div>
      </div>

      <!-- 데이터 목록 (차트 하단) -->
      <div class="donation-data-list">
        ${chartData.map((item, idx) => `
          <div class="donation-data-item">
            <span class="donation-data-color" style="background: ${CHART_COLORS[idx % CHART_COLORS.length]}"></span>
            <span class="donation-data-label">${item.label}</span>
            <span class="donation-data-value">${formatNumber(item.value)}${unit}</span>
            <span class="donation-data-percent">${Math.round((item.value / total) * 100)}%</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  // 페이지네이션 상태
  const ITEMS_PER_PAGE = 20;

  function renderList() {
    const listContainer = document.getElementById('donationListContainer');
    if (!listContainer || !state.data) return;

    let items = [];
    switch (state.currentSubTab) {
      case 'gift':
        items = state.data.giftHistory || [];
        break;
      case 'charge':
        items = state.data.chargeHistory || [];
        break;
    }

    // 검색 필터
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      items = items.filter(item => {
        const text = JSON.stringify(item).toLowerCase();
        return text.includes(query);
      });
    }

    // 기간 필터 (선물 탭은 전체 표시 - 3개월 데이터만 있으므로 필터 불필요)
    if (state.currentSubTab !== 'gift') {
      items = filterByPeriod(items, 'date');
    }

    if (items.length === 0) {
      const emptyMsg = state.searchQuery
        ? (i18n('donationListSearchEmpty') || '검색 결과가 없습니다')
        : (i18n('donationListEmpty') || '내역이 없습니다');
      listContainer.innerHTML = `
        <div class="donation-list-empty">
          ${emptyMsg}
        </div>
      `;
      return;
    }

    // 페이지네이션 계산
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    const currentPage = state.listPage || 1;
    const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIdx = startIdx + ITEMS_PER_PAGE;
    const pageItems = items.slice(startIdx, endIdx);

    const listHeaderText = (i18n('donationListHeader') || '📋 상세 내역 ($count$건)')
      .replace('$count$', items.length);

    listContainer.innerHTML = `
      <div class="donation-list-header">${listHeaderText}</div>
      <div class="donation-list">
        ${pageItems.map(item => renderListItem(item)).join('')}
      </div>
      ${totalPages > 1 ? renderPagination(currentPage, totalPages) : ''}
    `;

    // 페이지네이션 이벤트 바인딩
    bindPaginationEvents(listContainer, totalPages);
  }

  function renderPagination(currentPage, totalPages) {
    let pages = [];

    // 페이지 번호 생성 (최대 7개 표시)
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (currentPage <= 4) {
        pages = [1, 2, 3, 4, 5, '...', totalPages];
      } else if (currentPage >= totalPages - 3) {
        pages = [1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
      } else {
        pages = [1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages];
      }
    }

    return `
      <div class="donation-pagination">
        <button class="donation-page-btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}>‹</button>
        ${pages.map(p => {
          if (p === '...') {
            return `<span class="donation-page-ellipsis">...</span>`;
          }
          return `<button class="donation-page-btn ${p === currentPage ? 'active' : ''}" data-page="${p}">${p}</button>`;
        }).join('')}
        <button class="donation-page-btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}>›</button>
      </div>
    `;
  }

  function bindPaginationEvents(container, totalPages) {
    const buttons = container.querySelectorAll('.donation-page-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;

        const page = btn.dataset.page;
        const currentPage = state.listPage || 1;

        if (page === 'prev') {
          state.listPage = Math.max(1, currentPage - 1);
        } else if (page === 'next') {
          state.listPage = Math.min(totalPages, currentPage + 1);
        } else {
          state.listPage = parseInt(page);
        }

        renderList();

        // 리스트 상단으로 스크롤
        const listHeader = container.querySelector('.donation-list-header');
        if (listHeader) listHeader.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function renderListItem(item) {
    if (state.currentSubTab === 'gift') {
      // 날짜 포맷: "2026-01-06 23:07:30" -> "01-06 23:07"
      const dateStr = item.date || '-';
      const shortDate = dateStr.length > 10 ? dateStr.substring(5, 16) : dateStr;

      return `
        <div class="donation-list-item gift">
          <div class="donation-list-icon">🎁</div>
          <div class="donation-list-info">
            <div class="donation-list-streamer">${item.streamerNick || item.target || '-'}</div>
            <div class="donation-list-date">${shortDate}</div>
          </div>
          <div class="donation-list-amount">🎈 ${formatNumber(item.amount)}개</div>
        </div>
      `;
    } else if (state.currentSubTab === 'charge') {
      const dateStr = item.date || '-';
      const shortDate = dateStr.length > 10 ? dateStr.substring(0, 10) : dateStr;

      return `
        <div class="donation-list-item charge">
          <div class="donation-list-icon">💳</div>
          <div class="donation-list-info">
            <div class="donation-list-streamer">${item.method || '-'}</div>
            <div class="donation-list-date">${shortDate}</div>
          </div>
          <div class="donation-list-amount">+${formatNumber(item.amount)}개</div>
        </div>
      `;
    } else {
      const dateStr = item.date || '-';
      const shortDate = dateStr.length > 10 ? dateStr.substring(0, 10) : dateStr;

      return `
        <div class="donation-list-item exchange">
          <div class="donation-list-icon">💵</div>
          <div class="donation-list-info">
            <div class="donation-list-streamer">환전</div>
            <div class="donation-list-date">${shortDate}</div>
          </div>
          <div class="donation-list-amount">${formatNumber(item.amount)}개</div>
        </div>
      `;
    }
  }

  // ============================================
  // 유틸리티
  // ============================================

  function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString('ko-KR');
  }

  function getSubTabLabel() {
    switch (state.currentSubTab) {
      case 'gift': return i18n('donationTabGift')?.replace('🎁 ', '') || '선물';
      case 'charge': return i18n('donationTabCharge')?.replace('💳 ', '') || '충전';
      case 'exchange': return i18n('donationTabExchange') || '환전';
      default: return '';
    }
  }

  function filterByPeriod(data, dateField = 'label') {
    if (state.currentPeriod === 'all') return data;

    const now = new Date();
    let months = 3;
    switch (state.currentPeriod) {
      case '1m': months = 1; break;
      case '3m': months = 3; break;
      case '6m': months = 6; break;
      case '1y': months = 12; break;
    }

    const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const cutoffStr = cutoff.toISOString().substring(0, 7); // YYYY-MM 형식

    return data.filter(item => {
      const dateStr = item[dateField] || '';
      // 날짜 형식: "2024-01-15" 또는 "2024-01" 또는 "2024.01.15" 등
      // YYYY-MM 형식으로 정규화하여 비교
      const normalized = dateStr.replace(/\./g, '-').substring(0, 7);
      return normalized >= cutoffStr;
    });
  }

  function updateSyncTime() {
    if (!elements.syncTime) return;

    if (state.lastSync) {
      const date = new Date(state.lastSync);
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      elements.syncTime.textContent = `${hours}:${minutes}`;
    } else {
      elements.syncTime.textContent = '-';
    }

    if (elements.syncIcon) {
      elements.syncIcon.classList.remove('spinning');
    }
  }

  function showToast(message) {
    // 기존 sidepanel의 toast 사용
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }
  }

  // ============================================
  // 후원하기 기능
  // ============================================
  const giftState = {
    selectedStreamer: null,
    isProcessing: false
  };

  // 후원 즐겨찾기 스트리머 (별도 저장소)
  async function getGiftFavorites() {
    try {
      const result = await chrome.storage.local.get('giftFavoriteStreamers');
      return result.giftFavoriteStreamers || [];
    } catch (e) {
      return [];
    }
  }

  async function saveGiftFavorites(favorites) {
    try {
      await chrome.storage.local.set({ giftFavoriteStreamers: favorites });
    } catch (e) {
      console.error('[DonationTab] Favorites save failed:', e);
    }
  }

  // 모니터링 중인 스트리머 목록 가져오기
  async function getMonitoringStreamers() {
    try {
      const result = await chrome.storage.local.get('favoriteStreamers');
      return result.favoriteStreamers || [];
    } catch (e) {
      return [];
    }
  }

  async function toggleFavoriteStreamer(id, nick) {
    const favorites = await getGiftFavorites();
    const index = favorites.findIndex(f => f.id === id);

    if (index >= 0) {
      // 이미 있으면 제거
      favorites.splice(index, 1);
    } else {
      // 없으면 추가 (최대 5명 제한)
      if (favorites.length >= 5) {
        const maxMsg = i18n('quickGiftMaxReached') || '최대 5명까지만 추가할 수 있습니다';
        showToast(maxMsg);
        return;
      }
      favorites.push({ id, nickname: nick });
    }

    await saveGiftFavorites(favorites);
    // 모달 스트리머 목록 새로고침
    refreshStreamerList();
    // 빠른 후원 영역도 갱신
    renderQuickGift();
  }

  async function refreshStreamerList() {
    const giftFavorites = await getGiftFavorites();
    const monitoringStreamers = await getMonitoringStreamers();
    const giftFavIds = new Set(giftFavorites.map(f => f.id));
    const otherStreamers = monitoringStreamers.filter(s => !giftFavIds.has(s.id));

    const sectionEl = document.querySelector('.gift-section');
    if (!sectionEl) return;

    // i18n 문자열
    const removeFavTitle = i18n('donationGiftRemoveFav') || '즐겨찾기 해제';
    const addFavTitle = i18n('donationGiftAddFav') || '즐겨찾기 추가';
    const favSectionLabel = i18n('donationGiftFavorites') || '⭐ 후원 즐겨찾기';
    const monitoringSectionLabel = i18n('donationGiftMonitoring') || '📺 모니터링 스트리머';

    // 즐겨찾기 영역 업데이트
    const favFixedEl = sectionEl.querySelector('.gift-favorites-fixed');
    const othersEl = sectionEl.querySelector('.gift-others-section');

    // 즐겨찾기 HTML (M-5: escapeHtml 적용)
    const favoritesHtml = giftFavorites.map(s => {
      const safeId = escapeHtml(s.id);
      const safeNick = escapeHtml(s.nickname);
      return `
        <div class="gift-streamer-item${giftState.selectedStreamer?.id === s.id ? ' selected' : ''}" data-id="${safeId}" data-nick="${safeNick}">
          <span class="gift-streamer-nick">${safeNick}</span>
          <span class="gift-streamer-id">@${safeId}</span>
          <button class="gift-fav-btn is-fav" data-id="${safeId}" data-nick="${safeNick}" title="${removeFavTitle}">★</button>
        </div>
      `;
    }).join('');

    // 모니터링 HTML (M-5: escapeHtml 적용)
    const otherListHtml = otherStreamers.map(s => {
      const safeId = escapeHtml(s.id);
      const safeNick = escapeHtml(s.nickname);
      return `
        <div class="gift-streamer-item${giftState.selectedStreamer?.id === s.id ? ' selected' : ''}" data-id="${safeId}" data-nick="${safeNick}">
          <span class="gift-streamer-nick">${safeNick}</span>
          <span class="gift-streamer-id">@${safeId}</span>
          <button class="gift-fav-btn" data-id="${safeId}" data-nick="${safeNick}" title="${addFavTitle}">☆</button>
        </div>
      `;
    }).join('');

    // 즐겨찾기 영역 업데이트/생성/제거
    if (giftFavorites.length > 0) {
      if (favFixedEl) {
        favFixedEl.querySelector('.gift-favorites-list').innerHTML = favoritesHtml;
      } else {
        const newFavEl = document.createElement('div');
        newFavEl.className = 'gift-favorites-fixed';
        newFavEl.innerHTML = `
          <div class="gift-streamer-section-label">${favSectionLabel}</div>
          <div class="gift-favorites-list" id="giftFavoritesList">${favoritesHtml}</div>
        `;
        const labelEl = sectionEl.querySelector('.gift-label');
        labelEl.insertAdjacentElement('afterend', newFavEl);
      }
    } else if (favFixedEl) {
      favFixedEl.remove();
    }

    // 모니터링 영역 업데이트/생성/제거
    if (otherStreamers.length > 0) {
      if (othersEl) {
        othersEl.querySelector('.gift-streamer-list').innerHTML = otherListHtml;
      } else {
        const newOthersEl = document.createElement('div');
        newOthersEl.className = 'gift-others-section';
        newOthersEl.innerHTML = `
          <div class="gift-streamer-section-label">${monitoringSectionLabel}</div>
          <div class="gift-streamer-list" id="giftOthersList">${otherListHtml}</div>
        `;
        const selectedEl = sectionEl.querySelector('.gift-selected-streamer');
        selectedEl.insertAdjacentElement('beforebegin', newOthersEl);
      }
    } else if (othersEl) {
      othersEl.remove();
    }
  }

  async function openGiftModal() {
    const giftFavorites = await getGiftFavorites();
    const monitoringStreamers = await getMonitoringStreamers();
    const giftFavIds = new Set(giftFavorites.map(f => f.id));
    const otherStreamers = monitoringStreamers.filter(s => !giftFavIds.has(s.id));

    const balance = state.data?.balance?.current || 0;

    // i18n 문자열
    const giftTitle = i18n('donationGiftTitle') || '🎁 방송국 후원하기';
    const giftNotice = i18n('donationGiftNotice') || '방송국에 후원하는 기능입니다.';
    const giftNotice2 = i18n('donationGiftNotice2') || '후원 메시지를 확인하려면 해당 스트리머의 채팅창에 재입장해주세요.';
    const balanceText = (i18n('donationGiftBalance') || '보유: $amount$개')
      .replace('$amount$', formatNumber(balance));
    const selectStreamerLabel = i18n('donationGiftSelectStreamer') || '스트리머 선택';
    const favSectionLabel = i18n('donationGiftFavorites') || '⭐ 후원 즐겨찾기';
    const monitoringSectionLabel = i18n('donationGiftMonitoring') || '📺 모니터링 스트리머';
    const emptyStreamerText = i18n('donationGiftEmpty') || '등록된 스트리머가 없습니다';
    const noSelectionText = i18n('donationGiftSelected') || '선택된 스트리머 없음';
    const cancelText = i18n('donationGiftCancel') || '취소';
    const executeText = i18n('donationGiftExecute') || '후원하기';
    const removeFavTitle = i18n('donationGiftRemoveFav') || '즐겨찾기 해제';
    const addFavTitle = i18n('donationGiftAddFav') || '즐겨찾기 추가';

    const modal = document.createElement('div');
    modal.className = 'gift-modal-overlay';

    // 즐겨찾기 스트리머 HTML (고정 영역) (M-5: escapeHtml 적용)
    let favoritesHtml = '';
    if (giftFavorites.length > 0) {
      favoritesHtml = giftFavorites.map(s => {
        const safeId = escapeHtml(s.id);
        const safeNick = escapeHtml(s.nickname);
        return `
          <div class="gift-streamer-item" data-id="${safeId}" data-nick="${safeNick}">
            <span class="gift-streamer-nick">${safeNick}</span>
            <span class="gift-streamer-id">@${safeId}</span>
            <button class="gift-fav-btn is-fav" data-id="${safeId}" data-nick="${safeNick}" title="${removeFavTitle}">★</button>
          </div>
        `;
      }).join('');
    }

    // 모니터링 스트리머 HTML (스크롤 영역) (M-5: escapeHtml 적용)
    let otherListHtml = '';
    if (otherStreamers.length > 0) {
      otherListHtml = otherStreamers.map(s => {
        const safeId = escapeHtml(s.id);
        const safeNick = escapeHtml(s.nickname);
        return `
          <div class="gift-streamer-item" data-id="${safeId}" data-nick="${safeNick}">
            <span class="gift-streamer-nick">${safeNick}</span>
            <span class="gift-streamer-id">@${safeId}</span>
            <button class="gift-fav-btn" data-id="${safeId}" data-nick="${safeNick}" title="${addFavTitle}">☆</button>
          </div>
        `;
      }).join('');
    }

    const hasNoStreamers = giftFavorites.length === 0 && otherStreamers.length === 0;

    modal.innerHTML = `
      <div class="gift-modal">
        <div class="gift-modal-header">
          <span class="gift-modal-title">${giftTitle}
            <span class="gift-title-info">
              <span class="gift-title-info-icon">❗</span>
              <span class="gift-title-info-tooltip">${giftNotice}<br>${giftNotice2}</span>
            </span>
          </span>
          <button class="gift-modal-close">✕</button>
        </div>

        <div class="gift-modal-body">
          <div class="gift-balance-info">
            ${balanceText}
          </div>

          <div class="gift-section">
            <label class="gift-label">${selectStreamerLabel}</label>

            ${giftFavorites.length > 0 ? `
              <div class="gift-favorites-fixed">
                <div class="gift-streamer-section-label">${favSectionLabel}</div>
                <div class="gift-favorites-list" id="giftFavoritesList">
                  ${favoritesHtml}
                </div>
              </div>
            ` : ''}

            ${otherStreamers.length > 0 ? `
              <div class="gift-others-section">
                <div class="gift-streamer-section-label">${monitoringSectionLabel}</div>
                <div class="gift-streamer-list" id="giftOthersList">
                  ${otherListHtml}
                </div>
              </div>
            ` : ''}

            ${hasNoStreamers ? `<div class="gift-empty">${emptyStreamerText}</div>` : ''}

            <div class="gift-selected-streamer" id="giftSelectedStreamer">
              ${noSelectionText}
            </div>
          </div>

        </div>

        <div class="gift-modal-footer">
          <button class="gift-cancel-btn gift-modal-close">${cancelText}</button>
          <button class="gift-execute-btn" id="giftExecuteBtn" disabled>${executeText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 모달 클릭 이벤트 (document.body에 추가되므로 직접 바인딩 필요)
    modal.addEventListener('click', handleModalClick);
  }

  function handleModalClick(e) {
    const target = e.target;

    // 모달 닫기
    if (target.classList.contains('gift-modal-overlay') || target.classList.contains('gift-modal-close')) {
      closeGiftModal();
      return;
    }

    // 후원 실행 버튼
    if (target.id === 'giftExecuteBtn') {
      executeGift();
      return;
    }

    // 즐겨찾기 추가/제거 버튼 (스트리머 선택보다 먼저 체크해야 함)
    if (target.closest('.gift-fav-btn')) {
      e.stopPropagation();
      const btn = target.closest('.gift-fav-btn');
      toggleFavoriteStreamer(btn.dataset.id, btn.dataset.nick);
      return;
    }

    // 스트리머 선택
    if (target.closest('.gift-streamer-item')) {
      const item = target.closest('.gift-streamer-item');
      selectGiftStreamer(item.dataset.id, item.dataset.nick);
      return;
    }
  }

  function closeGiftModal() {
    const modal = document.querySelector('.gift-modal-overlay');
    if (modal) {
      modal.remove();
    }
    giftState.selectedStreamer = null;
  }

  function selectGiftStreamer(id, nick) {
    giftState.selectedStreamer = { id, nick };

    // UI 업데이트
    document.querySelectorAll('.gift-streamer-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.id === id);
    });

    const selectedEl = document.getElementById('giftSelectedStreamer');
    if (selectedEl) {
      selectedEl.innerHTML = `<span class="gift-selected-nick">${nick}</span> <span class="gift-selected-id">@${id}</span>`;
      selectedEl.classList.add('has-selection');
    }

    updateGiftPreview();
  }

  function updateGiftPreview() {
    const executeBtn = document.getElementById('giftExecuteBtn');

    // 스트리머 선택 여부에 따라 버튼 활성화
    executeBtn.disabled = !giftState.selectedStreamer;
  }

  async function executeGift() {
    if (!giftState.selectedStreamer || giftState.isProcessing) {
      return;
    }

    const { id, nick } = giftState.selectedStreamer;

    // 확인 팝업 표시
    showGiftConfirm(nick, async () => {
      await processGift(id, nick);
    });
  }

  function showGiftAlert(title, message) {
    const okText = i18n('donationGiftConfirmOk') || '확인';

    const alertModal = document.createElement('div');
    alertModal.className = 'gift-alert-overlay';
    alertModal.innerHTML = `
      <div class="gift-alert-modal">
        <div class="gift-alert-icon">⚠️</div>
        <div class="gift-alert-title">${title}</div>
        <div class="gift-alert-message">${message.replace(/\n/g, '<br>')}</div>
        <button class="gift-alert-btn">${okText}</button>
      </div>
    `;

    document.body.appendChild(alertModal);

    alertModal.querySelector('.gift-alert-btn').addEventListener('click', () => {
      alertModal.remove();
    });

    alertModal.addEventListener('click', (e) => {
      if (e.target === alertModal) {
        alertModal.remove();
      }
    });
  }

  function showGiftConfirm(nick, onConfirm) {
    // i18n 문자열
    const confirmTitle = i18n('donationGiftConfirmTitle') || '후원 확인';
    const confirmMessage = (i18n('donationGiftConfirmMessage') || '$name$님에게 후원하시겠습니까?')
      .replace('$name$', nick);
    const confirmNotice = i18n('donationGiftConfirmNotice') || '확인을 누르면 SOOP 후원 창이 열립니다.';
    const confirmNotice2 = i18n('donationGiftConfirmNotice2') || '후원 창에서 금액을 직접 입력해주세요.';
    const warningTitle = i18n('donationGiftWarningTitle') || '⚠️ 주의사항';
    const warning1 = i18n('donationGiftWarning1') || '본 기능은 사용자 편의를 위해 제공됩니다.';
    const warning2 = i18n('donationGiftWarning2') || '후원 실행 후 발생하는 모든 결과에 대한 책임은 사용자 본인에게 있습니다.';
    const warning3 = i18n('donationGiftWarning3') || '개발자는 이 기능 사용으로 인한 손실이나 문제에 대해 책임지지 않습니다.';
    const cancelText = i18n('donationGiftCancel') || '취소';
    const okText = i18n('donationGiftConfirmOk') || '확인';

    const confirmModal = document.createElement('div');
    confirmModal.className = 'gift-confirm-overlay';
    confirmModal.innerHTML = `
      <div class="gift-confirm-modal">
        <div class="gift-confirm-icon">🎁</div>
        <div class="gift-confirm-title">${confirmTitle}</div>
        <div class="gift-confirm-message">
          ${confirmMessage}
        </div>
        <div class="gift-confirm-notice">
          ${confirmNotice}<br>
          ${confirmNotice2}
        </div>
        <div class="gift-confirm-warning">
          <div class="gift-confirm-warning-title">${warningTitle}</div>
          <ul class="gift-confirm-warning-list">
            <li>${warning1}</li>
            <li>${warning2}</li>
            <li>${warning3}</li>
          </ul>
        </div>
        <div class="gift-confirm-buttons">
          <button class="gift-confirm-cancel">${cancelText}</button>
          <button class="gift-confirm-ok">${okText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmModal);

    confirmModal.querySelector('.gift-confirm-cancel').addEventListener('click', () => {
      confirmModal.remove();
    });

    confirmModal.querySelector('.gift-confirm-ok').addEventListener('click', () => {
      confirmModal.remove();
      onConfirm();
    });

    confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) {
        confirmModal.remove();
      }
    });
  }

  async function processGift(id, nick) {
    giftState.isProcessing = true;

    const giftUrl = `https://st.sooplive.co.kr/app/gift_starballoon.php?szBjId=${id}&szWork=BJ_STATION&sys_type=web&location=station`;
    window.open(giftUrl, `gift_${Date.now()}`, 'width=450,height=550');

    const openedMsg = (i18n('donationGiftOpened') || '$name$님 후원 창이 열렸습니다')
      .replace('$name$', nick);
    showToast(openedMsg);
    closeGiftModal();
    giftState.isProcessing = false;
  }

  // ============================================
  // 공개 API 반환
  // ============================================
  return {
    init,
    show,
    hide,
    sync,
    destroy
  };
})();

// 전역 노출 (sidepanel.js에서 접근용)
window.DonationTab = DonationTab;
