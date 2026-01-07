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
  // 상수
  // ============================================
  const STORAGE_KEY = 'myDonation';
  const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30분
  const DATA_URL = 'https://point.sooplive.co.kr/Report/AfreecaBalloonList.asp';

  // 전체 동기화 설정
  const FULL_SYNC_START_YEAR = 2020; // 전체 동기화 시작 연도
  const REQUEST_DELAY_MS = 300; // 요청 간 딜레이 (서버 부하 방지)

  // 차트 색상 (다크 테마에서 잘 보이는 밝은 색상)
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
      defaultChartType: 'bar',
      autoSync: true
    },
    // UI 상태
    currentSubTab: 'gift', // charge, gift, exchange
    currentPeriod: '3m',
    currentChartType: 'bar',
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
  // 공개 API
  // ============================================

  /**
   * 모듈 초기화
   */
  async function init() {
    // 중복 초기화 방지
    if (isInitialized) {
      console.log('[DonationTab] Already initialized, showing...');
      show();
      return;
    }

    container = document.getElementById('donationTabContainer');
    if (!container) {
      console.error('[DonationTab] Container not found');
      return;
    }

    console.log('[DonationTab] Initializing...');
    isInitialized = true;

    renderInitialUI();
    cacheElements();
    bindEvents();
    await loadFromStorage();

    // 초기화 후 자동 동기화 (데이터가 없거나 오래된 경우)
    console.log('[DonationTab] Checking if sync needed...');
    console.log('[DonationTab] state.data:', state.data);
    console.log('[DonationTab] state.lastSync:', state.lastSync);

    // 데이터 유효성 검사 추가
    const hasValidData = state.data &&
      (state.data.giftHistory?.length > 0 ||
       state.data.chargeHistory?.length > 0 ||
       state.data.balance?.current > 0);

    console.log('[DonationTab] hasValidData:', hasValidData);

    if (shouldSync() || !hasValidData) {
      console.log('[DonationTab] Sync needed, starting sync...');
      sync();
    } else if (state.data) {
      console.log('[DonationTab] Using cached data');
      render();
    } else {
      console.log('[DonationTab] No data, rendering empty state');
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
      const result = await fetchDonationData(fullSync);

      if (result.success) {
        state.isLoggedIn = true;
        state.data = result.data;
        state.lastSync = Date.now();
        await saveToStorage();
        render();
        showToast('동기화 완료');
      } else if (result.loginRequired) {
        state.isLoggedIn = false;
        state.data = null;
        renderLoginRequired();
      } else {
        showToast('동기화 실패: ' + (result.error || '알 수 없는 오류'));
        if (state.data) {
          render(); // 기존 캐시 데이터 표시
        }
      }
    } catch (error) {
      console.error('[DonationTab] Sync error:', error);
      showToast('동기화 중 오류 발생');
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
    container.innerHTML = `
      <div class="donation-tab">
        <!-- 메인 콘텐츠 영역 -->
        <div class="donation-content" id="donationContent">
          <!-- 동적으로 렌더링 -->
        </div>

        <!-- 하단 고정: 검색 + 동기화 바 -->
        <div class="donation-bottom-bar">
          <div class="donation-search-row">
            <div class="donation-search-input-wrap">
              <span class="donation-search-icon">🔍</span>
              <input type="text" class="donation-search-input" id="donationSearchInput"
                     placeholder="스트리머, 금액 검색...">
              <button class="donation-search-clear" id="donationSearchClear" style="display:none;">✕</button>
            </div>
          </div>
          <div class="donation-sync-row">
            <button class="donation-sync-btn" id="donationSyncBtn">
              <span class="donation-sync-icon" id="donationSyncIcon">🔄</span>
              <span>동기화</span>
            </button>
            <button class="donation-sync-btn donation-sync-full" id="donationFullSyncBtn" title="전체 데이터 다시 불러오기">
              전체
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
  }

  // ============================================
  // 이벤트 바인딩
  // ============================================

  function bindEvents() {
    // 검색
    elements.searchInput?.addEventListener('input', handleSearch);
    elements.searchClear?.addEventListener('click', clearSearch);

    // 동기화
    elements.syncBtn?.addEventListener('click', () => sync(false));
    elements.fullSyncBtn?.addEventListener('click', () => sync(true));

    // 컨텐츠 영역 이벤트 위임
    elements.content?.addEventListener('click', handleContentClick);
    elements.content?.addEventListener('change', handleContentChange);
  }

  function unbindEvents() {
    elements.searchInput?.removeEventListener('input', handleSearch);
    elements.searchClear?.removeEventListener('click', clearSearch);
    elements.syncBtn?.removeEventListener('click', () => sync(false));
    elements.fullSyncBtn?.removeEventListener('click', () => sync(true));
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

  function toggleSettings() {
    const panel = elements.settingsPanel;
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  function handleSettingChange() {
    state.settings.defaultChartType = elements.settingChartType.value;
    state.settings.defaultPeriod = elements.settingPeriod.value;
    state.currentChartType = state.settings.defaultChartType;
    state.currentPeriod = state.settings.defaultPeriod;
    saveToStorage();
    render();
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
      window.open('https://login.sooplive.co.kr/', '_blank');
      return;
    }

    // 후원하기 버튼
    if (target.id === 'donationGiftBtn' || target.closest('#donationGiftBtn')) {
      openGiftModal();
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
        state.lastSync = saved.lastSync || null;
        state.isLoggedIn = saved.isLoggedIn ?? null;
        state.data = saved.data || null;
        state.settings = { ...state.settings, ...saved.settings };

        // 설정값 UI 반영
        state.currentPeriod = state.settings.defaultPeriod;
        state.currentChartType = state.settings.defaultChartType;

        if (elements.settingChartType) {
          elements.settingChartType.value = state.settings.defaultChartType;
        }
        if (elements.settingPeriod) {
          elements.settingPeriod.value = state.settings.defaultPeriod;
        }
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
      console.error('[DonationTab] Save to storage error:', error);
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
      console.log('[DonationTab] Fetching data, fullSync:', fullSync);

      // 1단계: 기본 페이지 가져오기 (잔액 정보 + 첫 페이지 데이터)
      const baseResult = await fetchPage({ year: new Date().getFullYear(), month: new Date().getMonth() + 1 });

      if (!baseResult.success) {
        return baseResult;
      }

      let allData = baseResult.data;

      // 전체 동기화: 모든 연월 + 모든 페이지 가져오기
      if (fullSync) {
        console.log('[DonationTab] Starting full sync...');
        allData = await performFullSync(allData);
      } else {
        // 일반 동기화: 최근 12개월 충전 내역 가져오기
        console.log('[DonationTab] Fetching recent 12 months...');
        allData = await fetchRecentMonths(allData, 12);
      }

      return { success: true, data: allData };
    } catch (error) {
      console.error('[DonationTab] Fetch error:', error);
      return { success: false, error: error.message };
    }
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

    console.log('[DonationTab] Fetching', monthsToFetch.length, 'months for charge history');

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
      console.log('[DonationTab] Fetching page:', requestUrl);

      const response = await fetch(requestUrl, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml'
        }
      });

      // 리다이렉트 체크 (로그인 필요)
      if (response.url.includes('login.sooplive.co.kr') || response.url.includes('login.afreecatv.com')) {
        console.log('[DonationTab] Login required (redirect)');
        return { success: false, loginRequired: true };
      }

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const html = await response.text();

      // 로그인 페이지 체크 (HTML 내용으로)
      if (html.includes('login.sooplive.co.kr') || html.includes('로그인이 필요')) {
        console.log('[DonationTab] Login required (HTML content)');
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

    console.log('[DonationTab] Full sync: fetching', monthsToFetch.length, 'months');

    // 각 연월별로 충전 내역 가져오기
    for (const { year, month } of monthsToFetch) {
      state.syncProgress.currentStep = `충전내역 ${year}-${String(month).padStart(2, '0')}`;
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
    state.syncProgress.currentStep = '선물내역 전체 페이지';
    updateSyncProgress();

    let giftPage = 2; // 1페이지는 이미 가져옴
    let hasMoreGiftPages = true;
    const maxGiftPages = 100; // 안전장치

    while (hasMoreGiftPages && giftPage <= maxGiftPages) {
      state.syncProgress.currentStep = `선물내역 ${giftPage}페이지`;
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

    console.log('[DonationTab] Full sync complete:', {
      chargeHistory: allChargeHistory.length,
      giftHistory: allGiftHistory.length
    });

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

    console.log('[DonationTab] Starting HTML parsing...');

    // ===== 별풍선 잔액 파싱 =====
    const balance = {
      current: 0,
      used: 0,
      expired: 0
    };

    // 페이지 텍스트에서 정보 추출
    const bodyText = doc.body?.textContent || '';
    console.log('[DonationTab] Body text preview:', bodyText.substring(0, 500));

    // 패턴 0: HTML에서 <em> 태그 안의 숫자 추출 (가장 정확)
    // <div class="myitem_info">...보유중인 별풍선은 <em>17</em>개 입니다.</div>
    const emBalanceMatch = html.match(/보유중인\s*별풍선은\s*<em>([0-9,]+)<\/em>\s*개/);
    if (emBalanceMatch) {
      balance.current = parseInt(emBalanceMatch[1].replace(/,/g, ''), 10);
      console.log('[DonationTab] Found balance (em tag):', balance.current);
    }

    // 패턴 1: myitem_info 클래스에서 직접 추출
    if (balance.current === 0) {
      const myitemInfo = doc.querySelector('.myitem_info');
      if (myitemInfo) {
        const emTag = myitemInfo.querySelector('em');
        if (emTag) {
          balance.current = parseInt(emTag.textContent.replace(/,/g, ''), 10);
          console.log('[DonationTab] Found balance (myitem_info em):', balance.current);
        }
      }
    }

    // 패턴 2: textContent에서 "보유중인 별풍선은 17개"
    if (balance.current === 0) {
      const balanceMatch = bodyText.match(/보유중인\s*별풍선은\s*([0-9,]+)\s*개/);
      if (balanceMatch) {
        balance.current = parseInt(balanceMatch[1].replace(/,/g, ''), 10);
        console.log('[DonationTab] Found balance (textContent):', balance.current);
      }
    }

    // "이미 선물한 별풍선 : 1,324,303개" 추출
    const usedMatch = bodyText.match(/이미\s*선물한\s*별풍선\s*[:\s]*([0-9,]+)/);
    if (usedMatch) {
      balance.used = parseInt(usedMatch[1].replace(/,/g, ''), 10);
      console.log('[DonationTab] Found used:', balance.used);
    }

    // ===== 충전 내역 파싱 (별풍선 충전 내역 테이블) =====
    const chargeHistory = [];
    const giftHistory = [];
    const exchangeHistory = [];

    // 충전 테이블 찾기: "구매일", "충전수", "결제수단" 등의 헤더가 있는 테이블
    const tables = doc.querySelectorAll('table');
    console.log('[DonationTab] Found tables:', tables.length);

    tables.forEach((table, tableIdx) => {
      const headerRow = table.querySelector('tr');
      const headerText = headerRow?.textContent || '';
      console.log('[DonationTab] Table', tableIdx, 'header:', headerText.substring(0, 100));

      // 충전 내역 테이블 (구매일, 충전수, 결제수단, 결제금액, 사용기간)
      if (headerText.includes('구매일') || headerText.includes('충전수') || headerText.includes('결제금액')) {
        console.log('[DonationTab] Found charge history table');
        const rows = table.querySelectorAll('tr');
        rows.forEach((row, idx) => {
          if (idx === 0) return; // 헤더 스킵
          const cells = row.querySelectorAll('td');
          console.log('[DonationTab] Charge row', idx, 'cells:', cells.length);
          if (cells.length >= 4) {
            const dateText = cells[0]?.textContent?.trim() || '';
            const chargeText = cells[1]?.textContent?.trim() || '';
            const methodText = cells[2]?.textContent?.trim() || '';
            const priceText = cells[3]?.textContent?.trim() || '';

            console.log('[DonationTab] Charge data:', { dateText, chargeText, methodText, priceText });

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
        console.log('[DonationTab] Found gift history table');
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

    console.log('[DonationTab] Parsed chargeHistory:', chargeHistory.length);
    console.log('[DonationTab] Parsed giftHistory:', giftHistory.length);

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

  function calculateSummary(giftHistory, chargeHistory, exchangeHistory) {
    const byStreamer = {};
    const byMonth = {};

    let totalGifted = 0;
    let totalCharged = 0;
    let totalExchanged = 0;

    // 선물 집계
    giftHistory.forEach(item => {
      totalGifted += item.amount;

      // 스트리머별
      const nick = item.streamerNick || '알 수 없음';
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
    chargeHistory.forEach(item => {
      totalCharged += item.amount;
      const month = item.date?.substring(0, 7) || 'unknown';
      if (!byMonth[month]) {
        byMonth[month] = { gifted: 0, charged: 0, exchanged: 0, streamers: new Set() };
      }
      byMonth[month].charged += item.amount;
    });

    // 환전 집계
    exchangeHistory.forEach(item => {
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

    elements.content.innerHTML = `
      <!-- ===== 상단 고정 영역 ===== -->
      <div class="donation-fixed-top">
        <!-- 데이터 안내 배너 -->
        <div class="donation-data-notice">
          <span class="donation-data-notice-icon">ⓘ</span>
          <span class="donation-data-notice-text">
            로그인 계정 기반 · 로컬에만 저장 (외부 전송 없음)<br>
            수집 시점에 따라 실제와 차이가 있을 수 있습니다
          </span>
        </div>

        <!-- 별풍선 현황 카드 -->
        <div class="donation-balance-card">
          <div class="donation-balance-row">
            <div class="donation-balance-item">
              <span class="donation-balance-icon">🎈</span>
              <span class="donation-balance-text">보유 별풍선 <strong>${formatNumber(balance.current)}</strong>개</span>
            </div>
            <div class="donation-balance-item">
              <span class="donation-balance-icon">📤</span>
              <span class="donation-balance-text">사용 <strong>${formatNumber(balance.used)}</strong>개</span>
            </div>
          </div>
          <button class="donation-gift-btn" id="donationGiftBtn">
            🎁 후원하기
          </button>
        </div>

        <!-- 서브탭 -->
        <div class="donation-sub-tabs">
          <button class="donation-sub-tab ${state.currentSubTab === 'gift' ? 'active' : ''}" data-tab="gift">
            🎁 선물
          </button>
          <button class="donation-sub-tab ${state.currentSubTab === 'charge' ? 'active' : ''}" data-tab="charge">
            💳 충전
          </button>
        </div>

        <!-- 기간 필터 (충전/환전 탭만) -->
        ${state.currentSubTab !== 'gift' ? `
        <div class="donation-period-filter">
          <select class="donation-period-select" id="donationPeriodFilter">
            <option value="1m" ${state.currentPeriod === '1m' ? 'selected' : ''}>1개월</option>
            <option value="3m" ${state.currentPeriod === '3m' ? 'selected' : ''}>3개월</option>
            <option value="6m" ${state.currentPeriod === '6m' ? 'selected' : ''}>6개월</option>
            <option value="1y" ${state.currentPeriod === '1y' ? 'selected' : ''}>1년</option>
            <option value="all" ${state.currentPeriod === 'all' ? 'selected' : ''}>전체</option>
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
  }

  function renderLoading() {
    if (!elements.content) return;

    elements.content.innerHTML = `
      <div class="donation-loading">
        <div class="donation-loading-dots"><span></span><span></span><span></span></div>
        <div class="donation-loading-text">동기화 중</div>
      </div>
    `;

    // 동기화 버튼 아이콘 회전
    if (elements.syncIcon) {
      elements.syncIcon.classList.add('spinning');
    }
  }

  function renderLoginRequired() {
    if (!elements.content) return;

    elements.content.innerHTML = `
      <div class="donation-login-required">
        <div class="donation-login-icon">🔒</div>
        <div class="donation-login-title">로그인 필요</div>
        <div class="donation-login-desc">SOOP에 로그인 후 이용 가능합니다</div>
        <button class="donation-login-btn" id="donationLoginBtn">SOOP 로그인</button>
      </div>
    `;

    if (elements.syncIcon) {
      elements.syncIcon.classList.remove('spinning');
    }
  }

  function renderEmpty() {
    if (!elements.content) return;

    elements.content.innerHTML = `
      <div class="donation-empty">
        <div class="donation-empty-icon">📊</div>
        <div class="donation-empty-text">동기화 버튼을 눌러 데이터를 불러오세요</div>
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

  function renderBarChart(container, summary) {
    let data;

    if (state.currentSubTab === 'gift') {
      // 선물: 스트리머별로 표시 (전체 데이터 - 기간 필터 없음)
      const allGifts = state.data.giftHistory || [];

      const byStreamer = {};
      allGifts.forEach(item => {
        const nick = item.streamerNick || '알 수 없음';
        if (!byStreamer[nick]) byStreamer[nick] = 0;
        byStreamer[nick] += item.amount || 0;
      });

      data = Object.entries(byStreamer)
        .map(([nick, amount]) => ({ label: nick, value: amount }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6);
    } else {
      // 충전/환전: 월별로 표시
      data = Object.entries(summary.byMonth)
        .map(([month, v]) => ({
          label: month,
          value: state.currentSubTab === 'charge' ? v.charged : v.exchanged
        }))
        .filter(d => d.value > 0);

      data = filterByPeriod(data, 'label');
      data = data.slice(0, 6);
    }

    const maxValue = Math.max(...data.map(d => d.value), 1);

    if (data.length === 0) {
      container.innerHTML = '<div class="donation-chart-empty">데이터가 없습니다</div>';
      return;
    }

    const unit = state.currentSubTab === 'gift' ? '개' : '원';
    const chartTitle = state.currentSubTab === 'gift' ? '🎁 스트리머별 선물' : `📊 ${getSubTabLabel()} 현황`;

    container.innerHTML = `
      <div class="donation-chart-title">${chartTitle}</div>
      <div class="donation-bar-chart">
        ${data.map(item => `
          <div class="donation-bar-item">
            <span class="donation-bar-label" title="${item.label}">${item.label.length > 8 ? item.label.substring(0, 8) + '..' : item.label}</span>
            <div class="donation-bar-track">
              <div class="donation-bar-fill" style="width: ${(item.value / maxValue) * 100}%"></div>
            </div>
            <span class="donation-bar-value">${formatNumber(item.value)}${unit}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPieChart(container, summary) {
    let data;
    if (state.currentSubTab === 'gift') {
      // 선물: 스트리머별 합계 (전체 데이터 - 기간 필터 없음)
      const allGifts = state.data.giftHistory || [];

      const byStreamerFiltered = {};
      allGifts.forEach(item => {
        const nick = item.streamerNick || item.target || '알 수 없음';
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
      container.innerHTML = '<div class="donation-chart-empty">데이터가 없습니다</div>';
      return;
    }

    // 총합은 필터링된 전체 데이터로 계산
    const total = data.reduce((sum, d) => sum + d.value, 0);

    // 차트 표시용은 최대 6개, 나머지는 "기타"로 합산
    const chartData = data.slice(0, 6);
    const otherData = data.slice(6);
    const otherTotal = otherData.reduce((sum, d) => sum + d.value, 0);

    if (otherTotal > 0) {
      chartData.push({ label: '기타', value: otherTotal });
    }

    // 차트용 총합 (chartData 기준)
    const chartTotal = chartData.reduce((sum, d) => sum + d.value, 0);
    let currentAngle = 0;

    const gradientParts = chartData.map((item, idx) => {
      const startAngle = currentAngle;
      currentAngle += (item.value / chartTotal) * 360;
      return `${CHART_COLORS[idx % CHART_COLORS.length]} ${startAngle}deg ${currentAngle}deg`;
    });

    const unit = '개';
    const chartTitle = state.currentSubTab === 'gift' ? '스트리머별 선물' : `${getSubTabLabel()} 현황`;

    // 선물 탭일 때 정보 아이콘 추가
    const infoIcon = state.currentSubTab === 'gift' ? `
      <span class="donation-chart-info">
        <span class="donation-info-icon">ⓘ</span>
        <span class="donation-info-tooltip">최근 3개월 통계입니다</span>
      </span>
    ` : '';

    container.innerHTML = `
      <div class="donation-chart-header">
        <span class="donation-chart-title">${chartTitle}${infoIcon}</span>
        <span class="donation-chart-total">총 ${formatNumber(total)}${unit}</span>
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

  function renderLineChart(container, summary) {
    const data = Object.entries(summary.byMonth)
      .map(([month, v]) => ({
        label: month,
        value: state.currentSubTab === 'gift' ? v.gifted
             : state.currentSubTab === 'charge' ? v.charged
             : v.exchanged
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    const filteredData = filterByPeriod(data);

    if (filteredData.length === 0) {
      container.innerHTML = '<div class="donation-chart-empty">데이터가 없습니다</div>';
      return;
    }

    const maxValue = Math.max(...filteredData.map(d => d.value), 1);
    const height = 120;
    const width = 280;
    const padding = 10;

    const points = filteredData.map((d, i) => {
      const x = padding + (i / Math.max(filteredData.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - (d.value / maxValue) * (height - padding * 2);
      return `${x},${y}`;
    });

    container.innerHTML = `
      <div class="donation-chart-title">📊 ${getSubTabLabel()} 추이</div>
      <div class="donation-line-chart">
        <svg class="donation-line-chart-svg" viewBox="0 0 ${width} ${height}">
          <defs>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#FFC107;stop-opacity:0.3" />
              <stop offset="100%" style="stop-color:#FFC107;stop-opacity:0" />
            </linearGradient>
          </defs>
          <polyline class="donation-chart-line" points="${points.join(' ')}" />
          ${points.map(p => {
            const [x, y] = p.split(',');
            return `<circle class="donation-chart-dot" cx="${x}" cy="${y}" r="3" />`;
          }).join('')}
        </svg>
        <div class="donation-chart-x-labels">
          ${filteredData.map(d => `<span>${d.label.substring(5) || d.label}</span>`).join('')}
        </div>
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
      listContainer.innerHTML = `
        <div class="donation-list-empty">
          ${state.searchQuery ? '검색 결과가 없습니다' : '내역이 없습니다'}
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

    listContainer.innerHTML = `
      <div class="donation-list-header">📋 상세 내역 (${items.length}건)</div>
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
      case 'gift': return '선물';
      case 'charge': return '충전';
      case 'exchange': return '환전';
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
      elements.syncTime.textContent = `마지막: ${hours}:${minutes}`;
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
      console.error('[DonationTab] 즐겨찾기 저장 실패:', e);
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
      // 없으면 추가
      favorites.push({ id, nickname: nick });
    }

    await saveGiftFavorites(favorites);
    // 모달 스트리머 목록 새로고침
    refreshStreamerList();
  }

  async function refreshStreamerList() {
    const giftFavorites = await getGiftFavorites();
    const monitoringStreamers = await getMonitoringStreamers();
    const giftFavIds = new Set(giftFavorites.map(f => f.id));
    const otherStreamers = monitoringStreamers.filter(s => !giftFavIds.has(s.id));

    const sectionEl = document.querySelector('.gift-section');
    if (!sectionEl) return;

    // 즐겨찾기 영역 업데이트
    const favFixedEl = sectionEl.querySelector('.gift-favorites-fixed');
    const othersEl = sectionEl.querySelector('.gift-others-section');

    // 즐겨찾기 HTML
    const favoritesHtml = giftFavorites.map(s => `
      <div class="gift-streamer-item${giftState.selectedStreamer?.id === s.id ? ' selected' : ''}" data-id="${s.id}" data-nick="${s.nickname}">
        <span class="gift-streamer-nick">${s.nickname}</span>
        <span class="gift-streamer-id">@${s.id}</span>
        <button class="gift-fav-btn is-fav" data-id="${s.id}" data-nick="${s.nickname}" title="즐겨찾기 해제">★</button>
      </div>
    `).join('');

    // 모니터링 HTML
    const otherListHtml = otherStreamers.map(s => `
      <div class="gift-streamer-item${giftState.selectedStreamer?.id === s.id ? ' selected' : ''}" data-id="${s.id}" data-nick="${s.nickname}">
        <span class="gift-streamer-nick">${s.nickname}</span>
        <span class="gift-streamer-id">@${s.id}</span>
        <button class="gift-fav-btn" data-id="${s.id}" data-nick="${s.nickname}" title="즐겨찾기 추가">☆</button>
      </div>
    `).join('');

    // 즐겨찾기 영역 업데이트/생성/제거
    if (giftFavorites.length > 0) {
      if (favFixedEl) {
        favFixedEl.querySelector('.gift-favorites-list').innerHTML = favoritesHtml;
      } else {
        const newFavEl = document.createElement('div');
        newFavEl.className = 'gift-favorites-fixed';
        newFavEl.innerHTML = `
          <div class="gift-streamer-section-label">⭐ 후원 즐겨찾기</div>
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
          <div class="gift-streamer-section-label">📺 모니터링 스트리머</div>
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

    const modal = document.createElement('div');
    modal.className = 'gift-modal-overlay';

    // 즐겨찾기 스트리머 HTML (고정 영역)
    let favoritesHtml = '';
    if (giftFavorites.length > 0) {
      favoritesHtml = giftFavorites.map(s => `
        <div class="gift-streamer-item" data-id="${s.id}" data-nick="${s.nickname}">
          <span class="gift-streamer-nick">${s.nickname}</span>
          <span class="gift-streamer-id">@${s.id}</span>
          <button class="gift-fav-btn is-fav" data-id="${s.id}" data-nick="${s.nickname}" title="즐겨찾기 해제">★</button>
        </div>
      `).join('');
    }

    // 모니터링 스트리머 HTML (스크롤 영역)
    let otherListHtml = '';
    if (otherStreamers.length > 0) {
      otherListHtml = otherStreamers.map(s => `
        <div class="gift-streamer-item" data-id="${s.id}" data-nick="${s.nickname}">
          <span class="gift-streamer-nick">${s.nickname}</span>
          <span class="gift-streamer-id">@${s.id}</span>
          <button class="gift-fav-btn" data-id="${s.id}" data-nick="${s.nickname}" title="즐겨찾기 추가">☆</button>
        </div>
      `).join('');
    }

    const hasNoStreamers = giftFavorites.length === 0 && otherStreamers.length === 0;

    modal.innerHTML = `
      <div class="gift-modal">
        <div class="gift-modal-header">
          <span class="gift-modal-title">🎁 방송국 후원하기
            <span class="gift-title-info">
              <span class="gift-title-info-icon">❗</span>
              <span class="gift-title-info-tooltip">방송국에 후원하는 기능입니다.<br>후원 메시지를 확인하려면<br>해당 스트리머의 채팅창에<br>재입장해주세요.</span>
            </span>
          </span>
          <button class="gift-modal-close">✕</button>
        </div>

        <div class="gift-modal-body">
          <div class="gift-balance-info">
            보유: <strong>${formatNumber(balance)}</strong>개
          </div>

          <div class="gift-section">
            <label class="gift-label">스트리머 선택</label>

            ${giftFavorites.length > 0 ? `
              <div class="gift-favorites-fixed">
                <div class="gift-streamer-section-label">⭐ 후원 즐겨찾기</div>
                <div class="gift-favorites-list" id="giftFavoritesList">
                  ${favoritesHtml}
                </div>
              </div>
            ` : ''}

            ${otherStreamers.length > 0 ? `
              <div class="gift-others-section">
                <div class="gift-streamer-section-label">📺 모니터링 스트리머</div>
                <div class="gift-streamer-list" id="giftOthersList">
                  ${otherListHtml}
                </div>
              </div>
            ` : ''}

            ${hasNoStreamers ? '<div class="gift-empty">등록된 스트리머가 없습니다</div>' : ''}

            <div class="gift-selected-streamer" id="giftSelectedStreamer">
              선택된 스트리머 없음
            </div>
          </div>

        </div>

        <div class="gift-modal-footer">
          <button class="gift-cancel-btn gift-modal-close">취소</button>
          <button class="gift-execute-btn" id="giftExecuteBtn" disabled>후원하기</button>
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
    const alertModal = document.createElement('div');
    alertModal.className = 'gift-alert-overlay';
    alertModal.innerHTML = `
      <div class="gift-alert-modal">
        <div class="gift-alert-icon">⚠️</div>
        <div class="gift-alert-title">${title}</div>
        <div class="gift-alert-message">${message.replace(/\n/g, '<br>')}</div>
        <button class="gift-alert-btn">확인</button>
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
    const confirmModal = document.createElement('div');
    confirmModal.className = 'gift-confirm-overlay';
    confirmModal.innerHTML = `
      <div class="gift-confirm-modal">
        <div class="gift-confirm-icon">🎁</div>
        <div class="gift-confirm-title">후원 확인</div>
        <div class="gift-confirm-message">
          <strong>${nick}</strong>님에게<br>후원하시겠습니까?
        </div>
        <div class="gift-confirm-notice">
          확인을 누르면 SOOP 후원 창이 열립니다.<br>
          후원 창에서 금액을 직접 입력해주세요.
        </div>
        <div class="gift-confirm-warning">
          <div class="gift-confirm-warning-title">⚠️ 주의사항</div>
          <ul class="gift-confirm-warning-list">
            <li>본 기능은 사용자 편의를 위해 제공됩니다.</li>
            <li>후원 실행 후 발생하는 모든 결과에 대한<br>책임은 사용자 본인에게 있습니다.</li>
            <li>개발자는 이 기능 사용으로 인한 손실이나<br>문제에 대해 책임지지 않습니다.</li>
          </ul>
        </div>
        <div class="gift-confirm-buttons">
          <button class="gift-confirm-cancel">취소</button>
          <button class="gift-confirm-ok">확인</button>
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

    showToast(`${nick}님 후원 창이 열렸습니다`);
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

// 즉시 로드 확인 로그
console.log('[DonationTab] Script loaded, DonationTab:', typeof DonationTab);
