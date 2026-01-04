// ===== 숲토킹 v3.6.0 - GA4 익명 통계 모듈 =====
// 완전 익명화된 사용 통계 수집 (개인정보 수집 없음)

(function() {
  'use strict';

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
  async function initAnalytics() {
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
          engagement_time_msec: 1, // 최소값 (세션 추적 비활성화)
          session_id: undefined,   // 세션 ID 제외
          debug_mode: false
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
  async function setAnalyticsEnabled(enabled) {
    analyticsEnabled = !!enabled;
    try {
      await chrome.storage.local.set({ analyticsEnabled: analyticsEnabled });
      console.log('[숲토킹 Analytics] 설정 변경:', analyticsEnabled);
    } catch (error) {
      console.warn('[숲토킹 Analytics] 설정 저장 실패:', error);
    }
  }

  function isAnalyticsEnabled() {
    return analyticsEnabled;
  }

  // ===== 사전 정의된 이벤트 =====
  const Analytics = {
    // 초기화
    init: initAnalytics,

    // 설정
    setEnabled: setAnalyticsEnabled,
    isEnabled: isAnalyticsEnabled,

    // 녹화 이벤트
    trackRecordingStart: (quality) => {
      sendEvent('recording_start', {
        quality: quality || 'unknown'
      });
    },

    trackRecordingStop: (quality, durationSec, sizeMB) => {
      sendEvent('recording_stop', {
        quality: quality || 'unknown',
        duration_bucket: getDurationBucket(durationSec),
        size_bucket: getSizeBucket(sizeMB)
      });
    },

    trackRecordingError: (errorType) => {
      sendEvent('recording_error', {
        error_type: sanitizeErrorType(errorType)
      });
    },

    // 자동 녹화 이벤트
    trackAutoRecordingStart: (quality) => {
      sendEvent('auto_recording_start', {
        quality: quality || 'unknown'
      });
    },

    // 모니터링 이벤트
    trackMonitoringToggle: (enabled, streamerCount) => {
      sendEvent('monitoring_toggle', {
        enabled: enabled ? 'on' : 'off',
        streamer_count_bucket: getCountBucket(streamerCount)
      });
    },

    // 자동 참여 이벤트
    trackAutoJoin: () => {
      sendEvent('auto_join');
    },

    // 품질 설정 이벤트
    trackQualityChange: (quality) => {
      sendEvent('quality_change', {
        quality: quality || 'unknown'
      });
    },

    // 분할 저장 이벤트
    trackFileSplit: (partNumber) => {
      sendEvent('file_split', {
        part_bucket: partNumber > 5 ? '5+' : String(partNumber)
      });
    },

    // 확장 설치/업데이트
    trackInstall: (version) => {
      sendEvent('extension_install', {
        version: version || 'unknown'
      });
    },

    trackUpdate: (fromVersion, toVersion) => {
      sendEvent('extension_update', {
        from_version: fromVersion || 'unknown',
        to_version: toVersion || 'unknown'
      });
    },

    // 일반 이벤트 (커스텀)
    trackEvent: sendEvent
  };

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
    // 에러 타입만 추출 (개인정보 제거)
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

  // ===== 전역 노출 =====
  if (typeof window !== 'undefined') {
    window.SOOPAnalytics = Analytics;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.SOOPAnalytics = Analytics;
  }

  // Service Worker 환경
  if (typeof self !== 'undefined' && typeof window === 'undefined') {
    self.SOOPAnalytics = Analytics;
  }

  console.log('[숲토킹 Analytics] 모듈 로드됨');
})();
