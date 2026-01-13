// ===== 숲토킹 v5.3.0 - Chat Backup Manager =====
// 자동 백업 관리 모듈 (기본 활성화)

const BackupManager = (function() {
  'use strict';

  // ===== 상수 =====
  const BACKUP_DB_NAME = 'sooptalkingBackups';
  const BACKUP_DB_VERSION = 1;
  const STORE_BACKUPS = 'backups';
  const STORE_META = 'meta';

  // ===== 기본 설정 (사용자 설정 없어도 자동 백업) =====
  const DEFAULT_CONFIG = {
    enabled: true,                    // 기본 활성화
    incrementalIntervalHours: 6,      // 증분 백업 주기 (시간)
    fullBackupIntervalHours: 24,      // 전체 백업 주기 (시간)
    retentionDays: 7,                 // 보관 기간 (일)
    maxBackupSizeMB: 100,             // 최대 백업 크기 (MB)
    maxBackupCount: 28                // 최대 백업 개수 (7일 * 4회)
  };

  // ===== 상태 =====
  let backupDb = null;
  let config = { ...DEFAULT_CONFIG };
  let isRunning = false;
  let lastCheckTime = 0;

  // ===== 백업 DB 초기화 =====
  async function initBackupDB() {
    if (backupDb) return backupDb;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);

      request.onerror = () => {
        console.error('[BackupManager] 백업 DB 열기 실패:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        backupDb = request.result;
        console.log('[BackupManager] 백업 DB 연결 완료');
        resolve(backupDb);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 백업 스토어
        if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
          const store = db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }

        // 메타 스토어
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
    });
  }

  // ===== 설정 로드/저장 =====
  async function loadConfig() {
    try {
      const result = await chrome.storage.local.get('backupConfig');
      if (result.backupConfig) {
        config = { ...DEFAULT_CONFIG, ...result.backupConfig };
      }
    } catch (e) {
      console.warn('[BackupManager] 설정 로드 실패, 기본값 사용:', e);
    }
    return config;
  }

  async function saveConfig(newConfig) {
    config = { ...config, ...newConfig };
    await chrome.storage.local.set({ backupConfig: config });
    return config;
  }

  // ===== 메타데이터 관리 =====
  async function getMeta() {
    await initBackupDB();

    return new Promise((resolve) => {
      const tx = backupDb.transaction([STORE_META], 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('backupMeta');

      request.onsuccess = () => {
        resolve(request.result || {
          key: 'backupMeta',
          lastBackup: 0,
          lastFullBackup: 0,
          lastMessageId: null,
          backupCount: 0
        });
      };

      request.onerror = () => resolve({
        key: 'backupMeta',
        lastBackup: 0,
        lastFullBackup: 0,
        lastMessageId: null,
        backupCount: 0
      });
    });
  }

  async function saveMeta(meta) {
    await initBackupDB();

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_META], 'readwrite');
      const store = tx.objectStore(STORE_META);
      const request = store.put({ key: 'backupMeta', ...meta });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ===== 백업 생성 =====

  // 전체 백업
  async function createFullBackup() {
    console.log('[BackupManager] 전체 백업 시작...');

    try {
      await initBackupDB();

      // 데이터 내보내기
      let data;
      if (typeof ChatStorage !== 'undefined' && ChatStorage.isReady()) {
        if (ChatStorage.isSQLiteMode() && typeof ChatSQLite !== 'undefined') {
          // SQLite: 바이너리 내보내기
          const blob = await ChatSQLite.exportDatabase();
          data = await blobToBase64(blob);
        } else {
          // IndexedDB: JSON 내보내기
          data = await ChatStorage.exportAll();
        }
      } else if (typeof ChatDB !== 'undefined') {
        data = await ChatDB.exportAll();
      } else {
        throw new Error('저장소를 찾을 수 없음');
      }

      const backupId = `backup_full_${Date.now()}`;
      const backup = {
        id: backupId,
        type: 'full',
        timestamp: Date.now(),
        date: new Date().toISOString(),
        size: JSON.stringify(data).length,
        isSQLite: typeof ChatStorage !== 'undefined' && ChatStorage.isSQLiteMode(),
        data: data
      };

      // 백업 저장
      await saveBackup(backup);

      // 메타 업데이트
      const meta = await getMeta();
      meta.lastBackup = Date.now();
      meta.lastFullBackup = Date.now();
      meta.backupCount = (meta.backupCount || 0) + 1;
      await saveMeta(meta);

      // 오래된 백업 정리
      await cleanupOldBackups();

      console.log(`[BackupManager] 전체 백업 완료: ${backupId} (${(backup.size / 1024).toFixed(1)}KB)`);

      return backupId;
    } catch (e) {
      console.error('[BackupManager] 전체 백업 실패:', e);
      throw e;
    }
  }

  // 증분 백업 (마지막 백업 이후 변경된 데이터만)
  async function createIncrementalBackup() {
    console.log('[BackupManager] 증분 백업 시작...');

    try {
      await initBackupDB();
      const meta = await getMeta();

      // 마지막 백업 이후 데이터 조회
      const lastBackupTime = meta.lastBackup || 0;
      let newMessages = [];

      if (typeof ChatStorage !== 'undefined' && ChatStorage.isReady()) {
        // 최근 메시지만 조회 (증분)
        const now = new Date();
        const since = new Date(lastBackupTime);
        const startDate = formatDate(since);
        const endDate = formatDate(now);

        newMessages = await ChatStorage.getMessagesByDateRange(startDate, endDate, 10000);

        // 타임스탬프 기준 필터
        newMessages = newMessages.filter(m => m.timestamp > lastBackupTime);
      }

      if (newMessages.length === 0) {
        console.log('[BackupManager] 증분 백업: 새 데이터 없음');
        return null;
      }

      const backupId = `backup_incr_${Date.now()}`;
      const backup = {
        id: backupId,
        type: 'incremental',
        timestamp: Date.now(),
        date: new Date().toISOString(),
        size: JSON.stringify(newMessages).length,
        messageCount: newMessages.length,
        baseBackupTime: lastBackupTime,
        data: { messages: newMessages }
      };

      // 백업 저장
      await saveBackup(backup);

      // 메타 업데이트
      meta.lastBackup = Date.now();
      meta.backupCount = (meta.backupCount || 0) + 1;
      if (newMessages.length > 0) {
        meta.lastMessageId = newMessages[0].id;
      }
      await saveMeta(meta);

      console.log(`[BackupManager] 증분 백업 완료: ${backupId} (${newMessages.length}건)`);

      return backupId;
    } catch (e) {
      console.error('[BackupManager] 증분 백업 실패:', e);
      throw e;
    }
  }

  // ===== 백업 저장/조회 =====

  async function saveBackup(backup) {
    await initBackupDB();

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_BACKUPS], 'readwrite');
      const store = tx.objectStore(STORE_BACKUPS);
      const request = store.put(backup);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function getBackup(backupId) {
    await initBackupDB();

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_BACKUPS], 'readonly');
      const store = tx.objectStore(STORE_BACKUPS);
      const request = store.get(backupId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getBackupList() {
    await initBackupDB();

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_BACKUPS], 'readonly');
      const store = tx.objectStore(STORE_BACKUPS);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => {
        const backups = (request.result || []).map(b => ({
          id: b.id,
          type: b.type,
          timestamp: b.timestamp,
          date: b.date,
          size: b.size,
          messageCount: b.messageCount
        }));
        // 최신순 정렬
        backups.sort((a, b) => b.timestamp - a.timestamp);
        resolve(backups);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== 백업에서 복원 =====

  async function restoreFromBackup(backupId) {
    console.log(`[BackupManager] 백업 복원 시작: ${backupId}`);

    try {
      const backup = await getBackup(backupId);
      if (!backup) {
        throw new Error('백업을 찾을 수 없습니다');
      }

      if (backup.type === 'full') {
        // 전체 백업 복원
        if (backup.isSQLite && typeof ChatSQLite !== 'undefined') {
          // SQLite 바이너리 복원
          const blob = base64ToBlob(backup.data);
          await ChatSQLite.importDatabase(blob);
        } else if (typeof ChatStorage !== 'undefined') {
          // JSON 데이터 복원
          await ChatStorage.importData(backup.data, false);
        }
      } else if (backup.type === 'incremental') {
        // 증분 백업 복원 (병합)
        if (backup.data && backup.data.messages) {
          if (typeof ChatStorage !== 'undefined') {
            await ChatStorage.importData({ messages: backup.data.messages }, true);
          }
        }
      }

      console.log(`[BackupManager] 백업 복원 완료: ${backupId}`);
      return true;
    } catch (e) {
      console.error('[BackupManager] 백업 복원 실패:', e);
      throw e;
    }
  }

  // ===== 오래된 백업 정리 =====

  async function cleanupOldBackups() {
    await initBackupDB();
    await loadConfig();

    const cutoffTime = Date.now() - (config.retentionDays * 24 * 60 * 60 * 1000);

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_BACKUPS], 'readwrite');
      const store = tx.objectStore(STORE_BACKUPS);
      const index = store.index('timestamp');
      const range = IDBKeyRange.upperBound(cutoffTime);
      const request = index.openCursor(range);

      let deleted = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };

      tx.oncomplete = () => {
        if (deleted > 0) {
          console.log(`[BackupManager] 오래된 백업 정리: ${deleted}개 삭제`);
        }
        resolve(deleted);
      };

      tx.onerror = () => reject(tx.error);
    });
  }

  // 개수 기준 정리
  async function trimBackupsByCount() {
    await initBackupDB();
    await loadConfig();

    const backups = await getBackupList();

    if (backups.length <= config.maxBackupCount) {
      return 0;
    }

    // 초과 백업 삭제 (오래된 것부터)
    const toDelete = backups.slice(config.maxBackupCount);
    let deleted = 0;

    for (const backup of toDelete) {
      await deleteBackup(backup.id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[BackupManager] 초과 백업 정리: ${deleted}개 삭제`);
    }

    return deleted;
  }

  async function deleteBackup(backupId) {
    await initBackupDB();

    return new Promise((resolve, reject) => {
      const tx = backupDb.transaction([STORE_BACKUPS], 'readwrite');
      const store = tx.objectStore(STORE_BACKUPS);
      const request = store.delete(backupId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ===== 스케줄 백업 =====

  async function runScheduledBackup() {
    if (isRunning) {
      console.log('[BackupManager] 이미 백업 실행 중');
      return;
    }

    await loadConfig();

    if (!config.enabled) {
      console.log('[BackupManager] 자동 백업 비활성화됨');
      return;
    }

    isRunning = true;

    try {
      const meta = await getMeta();
      const now = Date.now();

      const hoursSinceLastBackup = (now - (meta.lastBackup || 0)) / (60 * 60 * 1000);
      const hoursSinceFullBackup = (now - (meta.lastFullBackup || 0)) / (60 * 60 * 1000);

      // 전체 백업 주기 확인
      if (hoursSinceFullBackup >= config.fullBackupIntervalHours) {
        await createFullBackup();
      }
      // 증분 백업 주기 확인
      else if (hoursSinceLastBackup >= config.incrementalIntervalHours) {
        await createIncrementalBackup();
      }

      // 초과 백업 정리
      await trimBackupsByCount();

    } catch (e) {
      console.error('[BackupManager] 스케줄 백업 실패:', e);
    } finally {
      isRunning = false;
      lastCheckTime = Date.now();
    }
  }

  // ===== 수동 내보내기 (파일 다운로드) =====

  async function exportToFile() {
    try {
      let blob;
      let filename;

      if (typeof ChatStorage !== 'undefined' && ChatStorage.isReady()) {
        if (ChatStorage.isSQLiteMode() && typeof ChatSQLite !== 'undefined') {
          blob = await ChatSQLite.exportDatabase();
          filename = `sooptalking_backup_${formatDateForFile()}.sqlite`;
        } else {
          const data = await ChatStorage.exportAll();
          blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          filename = `sooptalking_backup_${formatDateForFile()}.json`;
        }
      } else if (typeof ChatDB !== 'undefined') {
        const data = await ChatDB.exportAll();
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `sooptalking_backup_${formatDateForFile()}.json`;
      } else {
        throw new Error('저장소를 찾을 수 없습니다');
      }

      // 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      console.log(`[BackupManager] 파일 내보내기 완료: ${filename}`);
      return filename;
    } catch (e) {
      console.error('[BackupManager] 파일 내보내기 실패:', e);
      throw e;
    }
  }

  // 파일에서 가져오기
  async function importFromFile(file) {
    try {
      if (file.name.endsWith('.sqlite')) {
        // SQLite 파일
        if (typeof ChatSQLite !== 'undefined') {
          await ChatSQLite.importDatabase(file);
        } else {
          throw new Error('SQLite 모드가 지원되지 않습니다');
        }
      } else {
        // JSON 파일
        const text = await file.text();
        const data = JSON.parse(text);

        if (typeof ChatStorage !== 'undefined') {
          await ChatStorage.importData(data, true);
        } else if (typeof ChatDB !== 'undefined') {
          await ChatDB.importData(data, true);
        }
      }

      console.log(`[BackupManager] 파일 가져오기 완료: ${file.name}`);
      return true;
    } catch (e) {
      console.error('[BackupManager] 파일 가져오기 실패:', e);
      throw e;
    }
  }

  // ===== 유틸리티 =====

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateForFile() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${min}`;
  }

  // H-4: 청크 단위 Base64 변환 (UI 블로킹 방지)
  async function blobToBase64(blob) {
    // 작은 파일은 기존 방식 사용 (1MB 미만)
    if (blob.size < 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    // 큰 파일은 청크 단위 처리
    const CHUNK_SIZE = 256 * 1024; // 256KB 청크
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const chunks = [];
    const mimeType = blob.type || 'application/octet-stream';

    for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
      const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
      let binary = '';
      for (let j = 0; j < chunk.length; j++) {
        binary += String.fromCharCode(chunk[j]);
      }
      chunks.push(btoa(binary));

      // UI 블로킹 방지를 위한 양보
      if (i % (CHUNK_SIZE * 4) === 0 && i > 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    return `data:${mimeType};base64,${chunks.join('')}`;
  }

  // H-4: 청크 단위 Base64 디코딩
  function base64ToBlob(base64) {
    const parts = base64.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'application/octet-stream';
    const base64Data = parts[1];

    // 작은 데이터는 기존 방식
    if (base64Data.length < 1024 * 1024) {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }

    // 큰 데이터는 청크 단위 처리
    const CHUNK_SIZE = 256 * 1024;
    const chunks = [];

    for (let i = 0; i < base64Data.length; i += CHUNK_SIZE) {
      const chunk = base64Data.slice(i, i + CHUNK_SIZE);
      const binary = atob(chunk);
      const bytes = new Uint8Array(binary.length);
      for (let j = 0; j < binary.length; j++) {
        bytes[j] = binary.charCodeAt(j);
      }
      chunks.push(bytes);
    }

    return new Blob(chunks, { type: mime });
  }

  // ===== 상태 조회 =====

  async function getStatus() {
    await loadConfig();
    const meta = await getMeta();
    const backups = await getBackupList();

    const now = Date.now();
    const hoursSinceLastBackup = meta.lastBackup ? (now - meta.lastBackup) / (60 * 60 * 1000) : null;
    const nextBackupIn = meta.lastBackup
      ? Math.max(0, config.incrementalIntervalHours - hoursSinceLastBackup)
      : 0;

    return {
      enabled: config.enabled,
      lastBackup: meta.lastBackup ? new Date(meta.lastBackup).toISOString() : null,
      lastFullBackup: meta.lastFullBackup ? new Date(meta.lastFullBackup).toISOString() : null,
      nextBackupInHours: nextBackupIn.toFixed(1),
      backupCount: backups.length,
      totalSize: backups.reduce((sum, b) => sum + (b.size || 0), 0),
      config
    };
  }

  // ===== 공개 API =====
  return {
    // 설정
    loadConfig,
    saveConfig,

    // 백업 생성
    createFullBackup,
    createIncrementalBackup,
    runScheduledBackup,

    // 백업 조회
    getBackupList,
    getBackup,

    // 복원
    restoreFromBackup,

    // 정리
    cleanupOldBackups,
    deleteBackup,

    // 파일 내보내기/가져오기
    exportToFile,
    importFromFile,

    // 상태
    getStatus,
    getMeta
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.BackupManager = BackupManager;
}
