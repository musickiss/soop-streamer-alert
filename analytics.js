// ===== 숲토킹 v4.0.2 - GA4 익명 통계 모듈 (ES6 Module) =====
// 완전 익명화된 사용 통계 수집 (개인정보 수집 없음)

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
