// ===== 숲토킹 v5.4.2 - Chat Storage Abstraction Layer =====
// SQLite / IndexedDB 통합 저장소 인터페이스
// v5.4.2: CSV 자동 백업 (2만건 분할), 백업 후 자동 삭제

const ChatStorage = (function() {
  'use strict';

  // ===== 상태 =====
  let storageType = null; // 'sqlite' | 'indexeddb'
  let isInitialized = false;
  let initPromise = null;

  // H-2: 폴백 재시도 로직
  let sqliteRetryCount = 0;
  const MAX_SQLITE_RETRIES = 3;

  // v5.4.2: 자동 백업/정리 설정
  const AUTO_BACKUP_CONFIG = {
    keepMessages: 20000,             // DB에 유지할 최신 메시지 수
    triggerThreshold: 30000,         // 이 수를 초과하면 백업 트리거
    migrationBatchSize: 500,         // 마이그레이션 배치 크기
    migrationDelayMs: 100,           // 배치 간 딜레이
    backupFolder: 'SOOPtalking/chat/auto-backup',  // 자동 백업 폴더
    csvRowLimit: 20000               // CSV 파일당 최대 행 수
  };

  // v5.4.1: 마이그레이션 상태
  let migrationInProgress = false;
  let migrationProgress = { current: 0, total: 0, percent: 0 };

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

  // v5.4.1: IndexedDB → SQLite 청크 마이그레이션 (메모리 안전)
  async function _autoMigrateFromIndexedDB() {
    if (migrationInProgress) {
      console.log('[ChatStorage] 마이그레이션 이미 진행 중');
      return;
    }

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

        // v5.4.1: 청크 단위 마이그레이션 실행
        const result = await migrateFromIndexedDBChunked();
        console.log(`[ChatStorage] 자동 마이그레이션 완료: ${result.migrated}건 처리됨`);

        // 마이그레이션 완료 후 IndexedDB 정리
        if (result.migrated > 0) {
          console.log('[ChatStorage] IndexedDB 데이터 정리 시작...');
          await _cleanupIndexedDBAfterMigration();
        }
      } else {
        console.log(`[ChatStorage] 마이그레이션 불필요: SQLite ${sqliteCount}건 >= IndexedDB ${indexedDBCount}건`);

        // 마이그레이션 완료 상태면 IndexedDB 정리
        if (indexedDBCount > 0) {
          console.log('[ChatStorage] 중복 데이터 정리를 위해 IndexedDB 삭제');
          await _cleanupIndexedDBAfterMigration();
        }
      }

      // v5.4.1: 용량/기간 기반 자동 백업 및 정리
      await _autoBackupAndCleanup();

    } catch (e) {
      console.warn('[ChatStorage] 자동 마이그레이션 실패 (무시됨):', e);
    } finally {
      migrationInProgress = false;
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

  // ===== v5.4.1: 청크 단위 마이그레이션 (메모리 안전) =====

  async function migrateFromIndexedDBChunked(onProgress) {
    if (storageType !== 'sqlite') {
      throw new Error('SQLite 모드에서만 마이그레이션 가능');
    }

    if (migrationInProgress) {
      console.log('[ChatStorage] 마이그레이션 이미 진행 중');
      return { migrated: 0, sessions: 0 };
    }

    migrationInProgress = true;
    console.log('[ChatStorage] 청크 마이그레이션 시작...');

    try {
      // 날짜 목록 조회 (메모리 효율적)
      const dates = await ChatDB.getDatesWithData();
      if (!dates || dates.length === 0) {
        console.log('[ChatStorage] 마이그레이션할 데이터 없음');
        return { migrated: 0, sessions: 0 };
      }

      // 날짜별 총 건수 계산
      const stats = await ChatDB.getStats();
      const totalMessages = stats?.messageCount || 0;

      console.log(`[ChatStorage] 총 ${totalMessages}건, ${dates.length}개 날짜 마이그레이션`);

      let migrated = 0;
      const BATCH_SIZE = AUTO_BACKUP_CONFIG.migrationBatchSize;
      const DELAY_MS = AUTO_BACKUP_CONFIG.migrationDelayMs;

      // 날짜별로 청크 처리
      for (const date of dates) {
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
          // 배치 단위로 조회
          const messages = await ChatDB.getMessagesByDate(date, BATCH_SIZE, offset);

          if (!messages || messages.length === 0) {
            hasMore = false;
            break;
          }

          // SQLite에 저장
          await ChatSQLite.saveMessages(messages);
          migrated += messages.length;
          offset += messages.length;

          // 진행률 업데이트
          migrationProgress = {
            current: migrated,
            total: totalMessages,
            percent: Math.round((migrated / totalMessages) * 100)
          };

          if (onProgress) {
            onProgress(migrationProgress);
          }

          console.log(`[ChatStorage] 마이그레이션 진행: ${migrated}/${totalMessages} (${migrationProgress.percent}%)`);

          // UI 블로킹 방지를 위한 딜레이
          if (messages.length === BATCH_SIZE) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          } else {
            hasMore = false;
          }
        }
      }

      // 세션 마이그레이션
      let sessionsMigrated = 0;
      try {
        const sessions = await _getIndexedDBSessions();
        for (const session of sessions) {
          await ChatSQLite.saveSession(session);
          sessionsMigrated++;
        }
      } catch (e) {
        console.warn('[ChatStorage] 세션 마이그레이션 실패:', e);
      }

      console.log(`[ChatStorage] 청크 마이그레이션 완료: 메시지 ${migrated}건, 세션 ${sessionsMigrated}건`);

      return { migrated, sessions: sessionsMigrated };
    } catch (e) {
      console.error('[ChatStorage] 청크 마이그레이션 실패:', e);
      throw e;
    }
  }

  // IndexedDB 세션 조회 헬퍼
  async function _getIndexedDBSessions() {
    if (typeof ChatDB === 'undefined') return [];

    try {
      // ChatDB에 getSessions가 있으면 사용
      if (ChatDB.getSessions) {
        return await ChatDB.getSessions();
      }

      // exportAll에서 세션만 추출
      const data = await ChatDB.exportAll();
      return data.sessions || [];
    } catch (e) {
      console.warn('[ChatStorage] IndexedDB 세션 조회 실패:', e);
      return [];
    }
  }

  // ===== v5.4.1: 마이그레이션 후 IndexedDB 정리 =====

  async function _cleanupIndexedDBAfterMigration() {
    try {
      if (typeof ChatDB === 'undefined') return;

      // IndexedDB 데이터 삭제
      await ChatDB.deleteAllData();
      console.log('[ChatStorage] IndexedDB 데이터 정리 완료');
    } catch (e) {
      console.warn('[ChatStorage] IndexedDB 정리 실패:', e);
    }
  }

  // ===== v5.4.2: CSV 자동 백업 및 정리 (3만건 초과 시 오래된 데이터 백업) =====

  async function _autoBackupAndCleanup() {
    try {
      if (storageType !== 'sqlite' || typeof ChatSQLite === 'undefined') return;

      // 전체 메시지 수 확인
      const stats = await ChatSQLite.getStats();
      const totalMessages = stats?.messageCount || 0;

      console.log(`[ChatStorage] 현재 메시지 수: ${totalMessages}건`);

      // 3만건 초과 시에만 백업 트리거
      if (totalMessages <= AUTO_BACKUP_CONFIG.triggerThreshold) {
        console.log(`[ChatStorage] 자동 백업 불필요 (${AUTO_BACKUP_CONFIG.triggerThreshold}건 이하)`);
        return;
      }

      // 삭제할 메시지 수 계산 (최신 2만건 유지)
      const toDelete = totalMessages - AUTO_BACKUP_CONFIG.keepMessages;
      console.log(`[ChatStorage] 자동 백업 시작: 총 ${totalMessages}건 중 오래된 ${toDelete}건 백업 예정`);

      // CSV 백업 및 삭제 실행
      const result = await _backupOldMessagesAndDelete(toDelete);

      console.log(`[ChatStorage] 자동 백업 완료: ${result.files}개 파일, ${result.deleted}건 삭제됨, 현재 ${totalMessages - result.deleted}건 유지`);
    } catch (e) {
      console.warn('[ChatStorage] CSV 자동 백업/정리 실패:', e);
    }
  }

  // ===== v5.4.2: CSV 변환 함수 (UTF-8 BOM 포함) =====

  function _messagesToCSV(messages) {
    // UTF-8 BOM 추가 (Excel 한글 호환)
    const BOM = '\uFEFF';

    // CSV 헤더
    const headers = ['날짜', '시간', '스트리머ID', '스트리머명', '사용자ID', '사용자명', '메시지', '타입'];

    // CSV 행 생성
    const rows = messages.map(msg => {
      const date = new Date(msg.timestamp);
      const dateStr = formatDate(date);
      const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;

      return [
        dateStr,
        timeStr,
        msg.streamerId || '',
        msg.streamerName || '',
        msg.userId || '',
        msg.userName || '',
        _escapeCSV(msg.message || ''),
        msg.type || 'chat'
      ].join(',');
    });

    return BOM + headers.join(',') + '\n' + rows.join('\n');
  }

  // CSV 특수문자 이스케이프
  function _escapeCSV(str) {
    if (!str) return '';
    // 쌍따옴표, 쉼표, 줄바꿈이 있으면 쌍따옴표로 감싸기
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // ===== v5.4.2: 오래된 메시지 백업 및 삭제 (날짜 단위 안전 처리) =====

  async function _backupOldMessagesAndDelete(targetDeleteCount) {
    const ROW_LIMIT = AUTO_BACKUP_CONFIG.csvRowLimit;

    let totalDeleted = 0;
    let filesCreated = 0;
    let partNumber = 1;

    // 날짜 목록 조회 (오래된 순)
    const dates = await ChatSQLite.getDatesWithData();
    dates.sort(); // 오래된 날짜부터

    let currentBatch = [];
    let completeDates = []; // 완전히 백업된 날짜들
    let collectedCount = 0; // 수집된 총 메시지 수

    for (const date of dates) {
      // 목표 삭제 수에 도달하면 중단
      if (collectedCount >= targetDeleteCount) {
        break;
      }

      // 해당 날짜의 모든 메시지 조회
      const messagesForDate = await ChatSQLite.getMessagesByDate(date, 100000, 0);

      if (!messagesForDate || messagesForDate.length === 0) {
        continue;
      }

      // 이 날짜를 추가하면 목표를 초과하는지 확인
      // 날짜 단위로만 처리하므로, 목표에 근접하면 해당 날짜까지만 포함
      if (collectedCount + messagesForDate.length > targetDeleteCount) {
        // 이미 수집한 것이 있으면, 현재 날짜는 건너뛰고 종료
        // (날짜 중간에 자르지 않음 - 데이터 무결성 보장)
        console.log(`[ChatStorage] ${date} 추가 시 목표 초과 (${collectedCount} + ${messagesForDate.length} > ${targetDeleteCount}) - 현재까지만 처리`);
        break;
      }

      // 현재 배치가 2만건을 넘으면 먼저 저장
      if (currentBatch.length > 0 && currentBatch.length + messagesForDate.length > ROW_LIMIT) {
        const downloaded = await _downloadCSVPart(currentBatch, partNumber);
        if (downloaded) {
          // 완전히 백업된 날짜들만 삭제
          for (const d of completeDates) {
            await ChatSQLite.deleteByDate(d);
            console.log(`[ChatStorage] ${d} 삭제 완료`);
          }
          totalDeleted += currentBatch.length;
          filesCreated++;
          partNumber++;
        } else {
          // 다운로드 실패 시 중단 (데이터 손실 방지)
          console.error('[ChatStorage] CSV 다운로드 실패 - 백업 중단');
          return { files: filesCreated, deleted: totalDeleted };
        }
        currentBatch = [];
        completeDates = [];
      }

      // 이 날짜의 메시지 추가
      currentBatch.push(...messagesForDate);
      completeDates.push(date);
      collectedCount += messagesForDate.length;

      console.log(`[ChatStorage] ${date} 수집: ${messagesForDate.length}건 (누적: ${collectedCount}/${targetDeleteCount})`);

      // UI 블로킹 방지
      await new Promise(r => setTimeout(r, 50));
    }

    // 남은 배치 저장
    if (currentBatch.length > 0) {
      const downloaded = await _downloadCSVPart(currentBatch, partNumber);
      if (downloaded) {
        for (const d of completeDates) {
          await ChatSQLite.deleteByDate(d);
          console.log(`[ChatStorage] ${d} 삭제 완료`);
        }
        totalDeleted += currentBatch.length;
        filesCreated++;
      }
    }

    return { files: filesCreated, deleted: totalDeleted };
  }

  // CSV 파일 다운로드
  async function _downloadCSVPart(messages, partNumber) {
    try {
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
      const filename = `chat_backup_${dateStr}_${timeStr}_part${partNumber}.csv`;

      // CSV 생성
      const csvContent = _messagesToCSV(messages);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      // 다운로드
      await chrome.downloads.download({
        url: blobUrl,
        filename: `${AUTO_BACKUP_CONFIG.backupFolder}/${filename}`,
        saveAs: false
      });

      console.log(`[ChatStorage] CSV 다운로드 완료: ${filename} (${messages.length}건)`);

      // Blob URL 정리
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

      return true;
    } catch (e) {
      console.error('[ChatStorage] CSV 다운로드 실패:', e);
      return false;
    }
  }

  // 마이그레이션 진행률 조회
  function getMigrationProgress() {
    return {
      inProgress: migrationInProgress,
      ...migrationProgress
    };
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
    migrateFromIndexedDBChunked,  // v5.4.1: 청크 마이그레이션
    getMigrationProgress,         // v5.4.1: 진행률 조회

    // 유틸리티
    formatDate
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.ChatStorage = ChatStorage;
}
