// ===== 숲토킹 v5.3.0 - Chat Storage Abstraction Layer =====
// SQLite / IndexedDB 통합 저장소 인터페이스

const ChatStorage = (function() {
  'use strict';

  // ===== 상태 =====
  let storageType = null; // 'sqlite' | 'indexeddb'
  let isInitialized = false;
  let initPromise = null;

  // H-2: 폴백 재시도 로직
  let sqliteRetryCount = 0;
  const MAX_SQLITE_RETRIES = 3;

  // ===== 초기화 =====
  async function init() {
    if (isInitialized) return true;
    if (initPromise) return initPromise;

    initPromise = _doInit();
    return initPromise;
  }

  async function _doInit() {
    console.log('[ChatStorage] 초기화 시작...');

    // 1. SQLite 시도
    try {
      if (typeof ChatSQLite !== 'undefined') {
        await ChatSQLite.init();
        if (ChatSQLite.isReady()) {
          storageType = 'sqlite';
          isInitialized = true;
          initPromise = null;
          console.log('[ChatStorage] SQLite 모드로 초기화 완료');

          // v5.4.0: SQLite 초기화 후 IndexedDB에서 자동 마이그레이션
          _autoMigrateFromIndexedDB();

          return true;
        }
      }
    } catch (e) {
      console.warn('[ChatStorage] SQLite 초기화 실패, IndexedDB로 폴백:', e);
    }

    // 2. IndexedDB 폴백
    try {
      if (typeof ChatDB !== 'undefined') {
        await ChatDB.init();
        storageType = 'indexeddb';
        isInitialized = true;
        initPromise = null;
        console.log('[ChatStorage] IndexedDB 모드로 초기화 완료');
        return true;
      }
    } catch (e) {
      console.error('[ChatStorage] IndexedDB 초기화도 실패:', e);
    }

    initPromise = null;
    throw new Error('저장소 초기화 실패');
  }

  // v5.4.0: IndexedDB → SQLite 자동 마이그레이션 (비동기, 백그라운드 실행)
  async function _autoMigrateFromIndexedDB() {
    try {
      // IndexedDB 초기화 확인
      if (typeof ChatDB === 'undefined') return;
      await ChatDB.init();

      // IndexedDB에 데이터가 있는지 확인
      const indexedDBStats = await ChatDB.getStats();
      if (!indexedDBStats || indexedDBStats.messageCount === 0) {
        console.log('[ChatStorage] IndexedDB에 마이그레이션할 데이터 없음');
        return;
      }

      // SQLite 통계 확인
      const sqliteStats = await ChatSQLite.getStats();
      const sqliteCount = sqliteStats?.messageCount || 0;
      const indexedDBCount = indexedDBStats.messageCount;

      // IndexedDB에 더 많은 데이터가 있으면 누락분 마이그레이션
      if (indexedDBCount > sqliteCount) {
        const diff = indexedDBCount - sqliteCount;
        console.log(`[ChatStorage] 자동 마이그레이션 시작: IndexedDB ${indexedDBCount}건 → SQLite (현재 ${sqliteCount}건, 누락 약 ${diff}건)`);

        // 마이그레이션 실행 (INSERT OR REPLACE로 중복 자동 처리)
        const result = await migrateFromIndexedDB();
        console.log(`[ChatStorage] 자동 마이그레이션 완료: ${result.migrated}건 처리됨`);
      } else {
        console.log(`[ChatStorage] 마이그레이션 불필요: SQLite ${sqliteCount}건 >= IndexedDB ${indexedDBCount}건`);
      }

    } catch (e) {
      console.warn('[ChatStorage] 자동 마이그레이션 실패 (무시됨):', e);
    }
  }

  // ===== 내부 헬퍼 =====
  function getBackend() {
    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return ChatSQLite;
    }
    if (typeof ChatDB !== 'undefined') {
      return ChatDB;
    }
    throw new Error('저장소 백엔드를 찾을 수 없습니다');
  }

  // SQLite 실패 시 IndexedDB로 폴백 래퍼 (H-2: 재시도 로직 포함)
  async function withFallback(sqliteMethod, indexedDBMethod, ...args) {
    // SQLite 모드인 경우
    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      try {
        const result = await ChatSQLite[sqliteMethod](...args);
        // 성공 시 재시도 카운터 리셋
        sqliteRetryCount = 0;
        return result;
      } catch (e) {
        sqliteRetryCount++;
        console.warn(`[ChatStorage] SQLite ${sqliteMethod} 실패 (${sqliteRetryCount}/${MAX_SQLITE_RETRIES}):`, e);

        // H-2: 재시도 횟수 초과 시에만 영구 폴백
        if (sqliteRetryCount >= MAX_SQLITE_RETRIES) {
          console.warn('[ChatStorage] SQLite 재시도 횟수 초과, IndexedDB로 영구 전환');
          if (typeof ChatDB !== 'undefined' && ChatDB[indexedDBMethod]) {
            storageType = 'indexeddb';
            return await ChatDB[indexedDBMethod](...args);
          }
        }

        // 재시도 횟수 이내면 IndexedDB로 임시 폴백 (storageType 유지)
        if (typeof ChatDB !== 'undefined' && ChatDB[indexedDBMethod]) {
          return await ChatDB[indexedDBMethod](...args);
        }
        throw e;
      }
    }

    // IndexedDB 모드
    if (typeof ChatDB !== 'undefined' && ChatDB[indexedDBMethod]) {
      return await ChatDB[indexedDBMethod](...args);
    }

    throw new Error('저장소 백엔드를 찾을 수 없습니다');
  }

  // H-2: SQLite 모드로 복구 시도
  async function tryResetToSQLite() {
    if (storageType === 'sqlite') return true;

    try {
      if (typeof ChatSQLite !== 'undefined') {
        await ChatSQLite.init();
        if (ChatSQLite.isReady()) {
          storageType = 'sqlite';
          sqliteRetryCount = 0;
          console.log('[ChatStorage] SQLite 모드로 복구 완료');
          return true;
        }
      }
    } catch (e) {
      console.warn('[ChatStorage] SQLite 복구 실패:', e);
    }
    return false;
  }

  // ===== 메시지 API =====

  async function saveMessages(messages) {
    if (!isInitialized) await init();
    return withFallback('saveMessages', 'saveMessages', messages);
  }

  async function getMessagesByDate(date, limit = 1000, offset = 0) {
    if (!isInitialized) await init();
    return withFallback('getMessagesByDate', 'getMessagesByDate', date, limit, offset);
  }

  async function getMessagesByDateRange(startDate, endDate, limit = 5000) {
    if (!isInitialized) await init();
    return withFallback('getMessagesByDateRange', 'getMessagesByDateRange', startDate, endDate, limit);
  }

  async function searchMessages(query) {
    if (!isInitialized) await init();
    return withFallback('searchMessages', 'searchMessages', query);
  }

  // ===== 세션 API =====

  async function saveSession(session) {
    if (!isInitialized) await init();
    return withFallback('saveSession', 'saveSession', session);
  }

  async function getSessions() {
    if (!isInitialized) await init();

    // SQLite는 getSessions(), IndexedDB는 없으므로 대체 구현 필요
    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return await ChatSQLite.getSessions();
    }

    // IndexedDB의 경우 세션 목록 조회 구현
    if (typeof ChatDB !== 'undefined') {
      // ChatDB에는 getSessions가 없으므로 getStreamers로 대체
      return [];
    }

    return [];
  }

  // ===== 통계 API =====

  async function getStats() {
    if (!isInitialized) await init();
    return withFallback('getStats', 'getStats');
  }

  // SQLite 전용 통계 (폴백 없음)
  async function getHourlyStats(date) {
    if (!isInitialized) await init();

    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return await ChatSQLite.getHourlyStats(date);
    }

    // IndexedDB는 지원 안함
    console.warn('[ChatStorage] getHourlyStats는 SQLite 모드에서만 지원됩니다');
    return [];
  }

  async function getTopUsers(streamerId, limit = 10) {
    if (!isInitialized) await init();

    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return await ChatSQLite.getTopUsers(streamerId, limit);
    }

    // IndexedDB는 지원 안함
    console.warn('[ChatStorage] getTopUsers는 SQLite 모드에서만 지원됩니다');
    return [];
  }

  // ===== 목록 API =====

  async function getStreamers() {
    if (!isInitialized) await init();
    return withFallback('getStreamers', 'getStreamers');
  }

  async function getDatesWithData() {
    if (!isInitialized) await init();
    return withFallback('getDatesWithData', 'getDatesWithData');
  }

  async function getMessageCountByStreamer() {
    if (!isInitialized) await init();
    return withFallback('getMessageCountByStreamer', 'getMessageCountByStreamer');
  }

  // ===== 삭제 API =====
  // v5.4.0: 삭제 시 SQLite와 IndexedDB 모두에서 삭제 (자동 마이그레이션으로 인한 데이터 복원 방지)

  async function deleteByDate(date) {
    if (!isInitialized) await init();

    // SQLite에서 삭제
    const result = await withFallback('deleteByDate', 'deleteByDate', date);

    // IndexedDB에서도 삭제 (백그라운드, 오류 무시)
    _deleteFromIndexedDB('deleteByDate', date);

    return result;
  }

  async function deleteByStreamers(streamerIds) {
    if (!isInitialized) await init();

    // SQLite에서 삭제
    const result = await withFallback('deleteByStreamers', 'deleteByStreamers', streamerIds);

    // IndexedDB에서도 삭제 (백그라운드, 오류 무시)
    _deleteFromIndexedDB('deleteByStreamers', streamerIds);

    return result;
  }

  async function deleteAllData() {
    if (!isInitialized) await init();

    // SQLite에서 삭제
    const result = await withFallback('deleteAllData', 'deleteAllData');

    // IndexedDB에서도 삭제 (백그라운드, 오류 무시)
    _deleteFromIndexedDB('deleteAllData');

    return result;
  }

  async function cleanupOldData(retentionDays = 90) {
    if (!isInitialized) await init();

    // SQLite에서 정리
    const result = await withFallback('cleanupOldData', 'cleanupOldData', retentionDays);

    // IndexedDB에서도 정리 (백그라운드, 오류 무시)
    _deleteFromIndexedDB('cleanupOldData', retentionDays);

    return result;
  }

  // v5.4.0: IndexedDB 삭제 헬퍼 (백그라운드 실행, 오류 무시)
  async function _deleteFromIndexedDB(method, ...args) {
    try {
      if (typeof ChatDB !== 'undefined' && ChatDB[method]) {
        await ChatDB.init();
        await ChatDB[method](...args);
        console.log(`[ChatStorage] IndexedDB ${method} 동기 삭제 완료`);
      }
    } catch (e) {
      console.warn(`[ChatStorage] IndexedDB ${method} 삭제 실패 (무시됨):`, e);
    }
  }

  // ===== 내보내기/가져오기 API =====

  async function exportAll() {
    if (!isInitialized) await init();
    const data = await withFallback('exportAll', 'exportAll');
    data.storageType = storageType;
    return data;
  }

  async function exportByStreamers(streamerIds) {
    if (!isInitialized) await init();
    const data = await withFallback('exportByStreamers', 'exportByStreamers', streamerIds);
    data.storageType = storageType;
    return data;
  }

  async function importData(data, merge = true) {
    if (!isInitialized) await init();
    return withFallback('importData', 'importData', data, merge);
  }

  // ===== 데이터베이스 바이너리 (SQLite 전용) =====

  async function exportDatabase() {
    if (!isInitialized) await init();

    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return await ChatSQLite.exportDatabase();
    }

    // IndexedDB의 경우 JSON으로 내보내기
    const data = await exportAll();
    return new Blob([JSON.stringify(data)], { type: 'application/json' });
  }

  async function importDatabase(blob) {
    if (!isInitialized) await init();

    // SQLite 바이너리인지 확인
    const header = await blob.slice(0, 16).text();
    if (header.startsWith('SQLite format 3')) {
      if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
        return await ChatSQLite.importDatabase(blob);
      }
    }

    // JSON 형식 시도
    try {
      const text = await blob.text();
      const data = JSON.parse(text);
      return await importData(data, false);
    } catch (e) {
      throw new Error('지원하지 않는 데이터베이스 형식입니다');
    }
  }

  // ===== 설정 API =====

  async function saveSetting(key, value) {
    if (!isInitialized) await init();

    // IndexedDB의 설정 API 사용
    if (typeof ChatDB !== 'undefined' && ChatDB.saveSetting) {
      return await ChatDB.saveSetting(key, value);
    }

    // 폴백: chrome.storage.local 사용
    return chrome.storage.local.set({ [`setting_${key}`]: value });
  }

  async function getSetting(key, defaultValue = null) {
    if (!isInitialized) await init();

    // IndexedDB의 설정 API 사용
    if (typeof ChatDB !== 'undefined' && ChatDB.getSetting) {
      return await ChatDB.getSetting(key, defaultValue);
    }

    // 폴백: chrome.storage.local 사용
    const result = await chrome.storage.local.get(`setting_${key}`);
    return result[`setting_${key}`] ?? defaultValue;
  }

  // ===== 상태 API =====

  function getStorageType() {
    return storageType;
  }

  function isReady() {
    return isInitialized;
  }

  function isSQLiteMode() {
    return storageType === 'sqlite';
  }

  // 저장소 강제 저장 (SQLite)
  async function forceSave() {
    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      return await ChatSQLite.saveToStorage();
    }
    return true;
  }

  // ===== 유틸리티 =====

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function close() {
    if (storageType === 'sqlite' && typeof ChatSQLite !== 'undefined') {
      ChatSQLite.close();
    }
    if (typeof ChatDB !== 'undefined') {
      ChatDB.close();
    }
    isInitialized = false;
    storageType = null;
  }

  // ===== 마이그레이션 (IndexedDB → SQLite) =====

  async function migrateFromIndexedDB(onProgress) {
    if (storageType !== 'sqlite') {
      throw new Error('SQLite 모드에서만 마이그레이션 가능');
    }

    console.log('[ChatStorage] IndexedDB → SQLite 마이그레이션 시작');

    try {
      // IndexedDB에서 데이터 내보내기
      const data = await ChatDB.exportAll();

      if (!data.messages || data.messages.length === 0) {
        console.log('[ChatStorage] 마이그레이션할 데이터 없음');
        return { migrated: 0, sessions: 0 };
      }

      // 배치로 마이그레이션
      const BATCH_SIZE = 1000;
      let migrated = 0;

      for (let i = 0; i < data.messages.length; i += BATCH_SIZE) {
        const batch = data.messages.slice(i, i + BATCH_SIZE);
        await ChatSQLite.saveMessages(batch);
        migrated += batch.length;

        if (onProgress) {
          onProgress({
            current: migrated,
            total: data.messages.length,
            percent: Math.round((migrated / data.messages.length) * 100)
          });
        }
      }

      // 세션 마이그레이션
      let sessionsMigrated = 0;
      if (data.sessions) {
        for (const session of data.sessions) {
          await ChatSQLite.saveSession(session);
          sessionsMigrated++;
        }
      }

      console.log(`[ChatStorage] 마이그레이션 완료: 메시지 ${migrated}건, 세션 ${sessionsMigrated}건`);

      return { migrated, sessions: sessionsMigrated };
    } catch (e) {
      console.error('[ChatStorage] 마이그레이션 실패:', e);
      throw e;
    }
  }

  // ===== 공개 API =====
  return {
    // 초기화
    init,
    isReady,
    close,

    // 메시지
    saveMessages,
    getMessagesByDate,
    getMessagesByDateRange,
    searchMessages,

    // 세션
    saveSession,
    getSessions,

    // 통계
    getStats,
    getHourlyStats,
    getTopUsers,

    // 목록
    getStreamers,
    getDatesWithData,
    getMessageCountByStreamer,

    // 삭제
    deleteByDate,
    deleteByStreamers,
    deleteAllData,
    cleanupOldData,

    // 내보내기/가져오기
    exportAll,
    exportByStreamers,
    importData,
    exportDatabase,
    importDatabase,

    // 설정
    saveSetting,
    getSetting,

    // 상태
    getStorageType,
    isSQLiteMode,
    forceSave,
    tryResetToSQLite,  // H-2: SQLite 복구 함수

    // 마이그레이션
    migrateFromIndexedDB,

    // 유틸리티
    formatDate
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.ChatStorage = ChatStorage;
}
