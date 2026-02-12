// ===== 숲토킹 v4.0.2 - GA4 익명 통계 모듈 (ES6 Module) =====
// 완전 익명화된 사용 통계 수집 (개인정보 수집 없음)

/**
 * ===== GA4 Measurement Protocol API Secret 보안 참고사항 =====
 *
 * 이 API Secret은 Google Analytics 4 Measurement Protocol용 클라이언트 측 식별자입니다.
 *
 * 보안 특성:
 * - 서버 사이드 비밀 키가 아닌 클라이언트 측 식별자입니다.
 * - Chrome Extension 특성상 소스 코드가 공개되므로 노출이 불가피합니다.
 * - GA4 대시보드에서 도메인/IP 필터링으로 악용을 방지할 수 있습니다.
 *
 * 권장 보안 조치:
 * 1. GA4 > 관리 > 데이터 스트림 > 도메인 필터링 설정
 *    - 허용 도메인: *.sooplive.co.kr, chrome-extension://[확장 프로그램 ID]
 * 2. API Secret 주기적 로테이션 (분기별 권장)
 *    - GA4 > 관리 > 데이터 스트림 > Measurement Protocol API Secret > 새로 만들기
 * 3. 비정상 트래픽 모니터링
 *    - GA4 > 탐색 > 이벤트 소스 분석으로 의심스러운 트래픽 감지
 *
 * 수집되는 정보 (모두 익명화됨):
 * - 녹화 시작/종료 이벤트 (품질, 시간대, 파일 크기 버킷)
 * - 모니터링 토글 이벤트 (스트리머 수 버킷)
 * - 확장 설치/업데이트 이벤트 (버전)
 * - 개인 식별 정보는 일절 수집하지 않습니다.
 */

// ===== GA4 설정 =====
const GA4_CONFIG = {
  MEASUREMENT_ID: 'G-ME2E590EN1',
  API_SECRET: 'IYdNEVpCTDuzdsD_OjAPww',
  ENDPOINT: 'https://www.google-analytics.com/mp/collect'
};

// 고정 익명 Client ID (모든 사용자 동일)
const ANONYMOUS_CLIENT_ID = 'anonymous';

// 통계 수집 활성화 여부 (사용자 설정)
let analyticsEnabled = true;

// ===== 초기화 =====
export async function initAnalytics() {
  try {
    const result = await chrome.storage.local.get(['analyticsEnabled']);
    analyticsEnabled = result.analyticsEnabled !== false; // 기본값 true
    console.log('[숲토킹 Analytics] 초기화됨, 활성화:', analyticsEnabled);
  } catch (error) {
    console.warn('[숲토킹 Analytics] 초기화 실패:', error);
    analyticsEnabled = true;
  }
}

// ===== GA4 이벤트 전송 =====
async function sendEvent(eventName, params = {}) {
  // 비활성화 상태면 전송 안 함
  if (!analyticsEnabled) {
    return;
  }

  // 이벤트명 검증 (영문, 숫자, 언더스코어만)
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(eventName)) {
    console.warn('[숲토킹 Analytics] 유효하지 않은 이벤트명:', eventName);
    return;
  }

  const payload = {
    client_id: ANONYMOUS_CLIENT_ID,
    non_personalized_ads: true,
    events: [{
      name: eventName,
      params: {
        ...params,
        engagement_time_msec: 1 // 최소값 (세션 추적 비활성화)
      }
    }]
  };

  const url = `${GA4_CONFIG.ENDPOINT}?measurement_id=${GA4_CONFIG.MEASUREMENT_ID}&api_secret=${GA4_CONFIG.API_SECRET}`;

  try {
    // fire-and-forget: 응답 기다리지 않음
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }).catch(() => {
      // 네트워크 오류 무시 (앱 동작에 영향 없음)
    });
  } catch (error) {
    // 전송 실패해도 앱 동작에 영향 없음
  }
}

// ===== 설정 변경 =====
export async function setAnalyticsEnabled(enabled) {
  analyticsEnabled = !!enabled;
  try {
    await chrome.storage.local.set({ analyticsEnabled: analyticsEnabled });
    console.log('[숲토킹 Analytics] 설정 변경:', analyticsEnabled);
  } catch (error) {
    console.warn('[숲토킹 Analytics] 설정 저장 실패:', error);
  }
}

export function isAnalyticsEnabled() {
  return analyticsEnabled;
}

// ===== 헬퍼 함수: 버킷화 (개인 식별 방지) =====
function getDurationBucket(seconds) {
  if (!seconds || seconds < 0) return 'unknown';
  if (seconds < 60) return '<1min';
  if (seconds < 300) return '1-5min';
  if (seconds < 900) return '5-15min';
  if (seconds < 1800) return '15-30min';
  if (seconds < 3600) return '30-60min';
  return '60min+';
}

function getSizeBucket(mb) {
  if (!mb || mb < 0) return 'unknown';
  if (mb < 100) return '<100MB';
  if (mb < 500) return '100-500MB';
  if (mb < 1000) return '500MB-1GB';
  if (mb < 5000) return '1-5GB';
  return '5GB+';
}

function getCountBucket(count) {
  if (!count || count < 0) return '0';
  if (count <= 5) return String(count);
  if (count <= 10) return '6-10';
  if (count <= 20) return '11-20';
  return '20+';
}

function sanitizeErrorType(error) {
  if (!error) return 'unknown';
  const safeTypes = [
    'video_not_found',
    'codec_not_supported',
    'permission_denied',
    'network_error',
    'storage_full',
    'tab_closed',
    'timeout',
    'unknown'
  ];
  const normalized = String(error).toLowerCase().replace(/[^a-z_]/g, '_');
  for (const type of safeTypes) {
    if (normalized.includes(type.replace('_', ''))) {
      return type;
    }
  }
  return 'unknown';
}

// ===== 사전 정의된 이벤트 함수들 (Named Exports) =====

export function trackRecordingStart(quality) {
  sendEvent('recording_start', {
    quality: quality || 'unknown'
  });
}

export function trackRecordingStop(quality, durationSec, sizeMB) {
  sendEvent('recording_stop', {
    quality: quality || 'unknown',
    duration_bucket: getDurationBucket(durationSec),
    size_bucket: getSizeBucket(sizeMB)
  });
}

export function trackRecordingError(errorType) {
  sendEvent('recording_error', {
    error_type: sanitizeErrorType(errorType)
  });
}

export function trackAutoRecordingStart(quality) {
  sendEvent('auto_recording_start', {
    quality: quality || 'unknown'
  });
}

export function trackMonitoringToggle(enabled, streamerCount) {
  sendEvent('monitoring_toggle', {
    enabled: enabled ? 'on' : 'off',
    streamer_count_bucket: getCountBucket(streamerCount)
  });
}

export function trackAutoJoin() {
  sendEvent('auto_join');
}

export function trackQualityChange(quality) {
  sendEvent('quality_change', {
    quality: quality || 'unknown'
  });
}

export function trackFileSplit(partNumber) {
  sendEvent('file_split', {
    part_bucket: partNumber > 5 ? '5+' : String(partNumber)
  });
}

export function trackInstall(version) {
  sendEvent('extension_install', {
    version: version || 'unknown'
  });
}

export function trackUpdate(fromVersion, toVersion) {
  sendEvent('extension_update', {
    from_version: fromVersion || 'unknown',
    to_version: toVersion || 'unknown'
  });
}

export function trackEvent(eventName, params) {
  sendEvent(eventName, params);
}

console.log('[숲토킹 Analytics] ES6 모듈 로드됨');
