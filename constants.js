// ===== 숲토킹 v5.4.8 - 통합 상수 정의 =====
// 모든 상수를 한 곳에서 관리하여 일관성 유지 및 유지보수성 향상
//
// ┌─────────────────────────────────────────────────────────────────────┐
// │  사용 가이드                                                         │
// │                                                                     │
// │  ✅ ES Module 지원 파일 (background.js, sidepanel/*.js):            │
// │     import { STORAGE_KEYS, INTERVALS } from './constants.js';       │
// │                                                                     │
// │  ⚠️ Content Script (content.js, content-main.js, chat-collector.js):│
// │     ISOLATED/MAIN world에서는 ES Module import 불가                  │
// │     → 기존 방식 유지 (파일 내 상수 정의)                              │
// │     → 값 변경 시 constants.js와 해당 파일 동시 수정 필요              │
// │                                                                     │
// │  📋 새 상수 추가 시:                                                 │
// │     1. 이 파일에 먼저 정의                                           │
// │     2. 적절한 카테고리에 배치                                        │
// │     3. 주석으로 용도 설명                                            │
// └─────────────────────────────────────────────────────────────────────┘

// ===== 스토리지 키 =====
// chrome.storage.local에서 사용하는 키 이름
export const STORAGE_KEYS = {
  // 녹화 상태 (탭별 녹화 정보)
  RECORDINGS: 'activeRecordings',

  // 즐겨찾기 스트리머 목록
  FAVORITE_STREAMERS: 'favoriteStreamers',

  // 모니터링 활성화 상태
  IS_MONITORING: 'isMonitoring',

  // 사용자 설정 (알림 등)
  SETTINGS: 'settings',

  // 내 후원 데이터
  MY_DONATION: 'myDonation',

  // SQLite DB 데이터 (채팅)
  SQLITE_DB_DATA: 'sqlite_db_data',

  // 채팅 수집 설정
  CHAT_COLLECT_SETTINGS: 'chatCollectSettings',
};

// ===== 모니터링 간격 =====
export const INTERVALS = {
  // 자동참여 ON 스트리머 체크 간격 (ms)
  MONITORING_FAST: 5000,

  // 자동참여 OFF 스트리머 체크 간격 (ms)
  MONITORING_SLOW: 30000,

  // 녹화 진행 상태 저장 간격 (ms) - 쓰로틀링
  PROGRESS_SAVE: 15000,

  // 채팅 버퍼 플러시 기본 간격 (ms)
  CHAT_FLUSH: 5000,

  // 채팅 어댑티브 플러시 최소 간격 (ms)
  CHAT_FLUSH_MIN: 2000,

  // 채팅 어댑티브 플러시 최대 간격 (ms)
  CHAT_FLUSH_MAX: 10000,

  // 채팅창 탐색 재시도 간격 (ms)
  CHAT_RETRY: 5000,

  // 후원 데이터 동기화 간격 (ms) - 30분
  DONATION_SYNC: 30 * 60 * 1000,

  // 후원 데이터 요청 간 딜레이 (ms) - 서버 부하 방지
  DONATION_REQUEST_DELAY: 300,
};

// ===== 타임아웃 =====
export const TIMEOUTS = {
  // 녹화 저장 최대 대기 시간 (ms)
  RECORDING_SAVE: 30000,

  // 비디오 로딩 대기 (ms)
  VIDEO_LOADING: 15000,

  // 스크립트 초기화 대기 (ms)
  SCRIPT_INIT: 500,
};

// ===== 제한 값 =====
export const LIMITS = {
  // SOOP 최대 동시 스트림 (녹화) 제한
  MAX_CONCURRENT_RECORDINGS: 4,

  // 채팅 버퍼 최대 크기
  CHAT_BUFFER_SIZE: 100,

  // 채팅창 탐색 최대 재시도 횟수
  CHAT_MAX_RETRY: 12,

  // 중복 방지용 해시 최대 저장 개수
  PROCESSED_IDS_MAX: 10000,

  // 중복 방지용 해시 정리 후 유지 개수
  PROCESSED_IDS_KEEP: 5000,

  // 스트리머 ID 최대 길이
  STREAMER_ID_MAX_LENGTH: 50,

  // 텍스트 sanitize 최대 길이
  TEXT_MAX_LENGTH: 1000,

  // 닉네임 최대 길이
  NICKNAME_MAX_LENGTH: 50,

  // 권장 스트리머 등록 수
  STREAMERS_RECOMMENDED: 10,

  // 후원 전체 동기화 시작 연도
  DONATION_SYNC_START_YEAR: 2020,
};

// ===== 녹화 설정 =====
export const RECORDING = {
  // 비디오 비트레이트 (bps) - 6 Mbps
  VIDEO_BITRATE: 6000000,

  // 오디오 비트레이트 (bps) - 128 kbps
  AUDIO_BITRATE: 128000,

  // 목표 FPS
  TARGET_FPS: 60,

  // 코덱 우선순위 (H.264 High 우선)
  CODEC_PRIORITY: ['avc1.640028', 'avc1.4d0028', 'vp9', 'vp8'],

  // MediaRecorder timeslice (ms)
  TIMESLICE: 2000,

  // requestData 호출 간격 (ms)
  REQUEST_DATA_INTERVAL: 5000,

  // 진행 상태 업데이트 간격 (ms)
  PROGRESS_INTERVAL: 5000,

  // Canvas 그리기 간격 (ms)
  CANVAS_DRAW_INTERVAL: 8,

  // 최소 녹화 시간 (ms) - 이보다 짧으면 저장 안 함
  MIN_RECORD_TIME: 2000,

  // 비디오 비정상 상태 최대 허용 횟수
  MAX_VIDEO_UNAVAILABLE: 750,

  // 녹화 중지 재시도 최대 횟수
  MAX_STOP_RETRIES: 10,

  // 분할 대기 최대 횟수
  MAX_SPLIT_WAIT: 20,

  // 분할 전환 딜레이 (ms)
  SPLIT_TRANSITION_DELAY: 300,

  // 기본 분할 크기 (MB)
  DEFAULT_SPLIT_SIZE_MB: 500,

  // 분할 크기 옵션 (MB)
  SPLIT_SIZE_OPTIONS: [500, 1000, 2000],
};

// ===== 채팅 수집 모드 =====
export const COLLECT_MODE = {
  OFF: 'off',           // 수집하지 않음
  ALL: 'all',           // 모든 채팅방 수집
  SELECTED: 'selected', // 선택한 스트리머만 수집
};

// ===== API URL =====
export const API_URLS = {
  // 방송 상태 확인 API
  BROADCAST_STATUS: 'https://live.sooplive.co.kr/afreeca/player_live_api.php',

  // 후원 데이터 API
  DONATION_DATA: 'https://point.sooplive.co.kr/Report/AfreecaBalloonList.asp',

  // Google Analytics
  GA_ENDPOINT: 'https://www.google-analytics.com/mp/collect',
};

// ===== 데이터베이스 =====
export const DATABASE = {
  // IndexedDB 채팅 DB 이름
  CHAT_DB_NAME: 'sooptalkingChat',

  // IndexedDB 채팅 DB 버전
  CHAT_DB_VERSION: 1,
};

// ===== UI 관련 =====
export const UI = {
  // 차트 색상 (다크 테마용)
  CHART_COLORS: [
    '#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE',
  ],
};

// ===== 정규식 패턴 =====
export const PATTERNS = {
  // 스트리머 ID 검증 (영문 소문자, 숫자, 언더스코어)
  STREAMER_ID: /^[a-z0-9_]{1,50}$/,

  // URL에서 스트리머 ID 추출
  URL_STREAMER: /^\/([^\/]+)/,

  // 제목에서 스트리머 이름 추출
  TITLE_PATTERNS: [
    /^(.+?)(?:\s*[-|]|의\s*방송)/,
    /^(.+?)\s*-\s*SOOP/,
    /^(.+?)\s*\|\s*SOOP/,
  ],
};

// ===== SOOP DOM 선택자 (기본값) =====
// selectors-config.js에서 재정의 가능
export const DEFAULT_SELECTORS = {
  chatContainer: ['#chat_area', '.chat_area'],
  chatItem: ['.chatting-list-item'],
  nickname: ['.author', '.username button[user_nick]', '[user_nick]'],
  message: ['.msg', '.message-text p.msg', '.message-text'],
  userIdAttrs: ['user_id', 'user_nick'],
};

// ===== 버전 정보 =====
// manifest.json과 동기화 필요
export const VERSION = '5.5.5';

console.log('[숲토킹] 통합 상수 로드됨 (constants.js)');
