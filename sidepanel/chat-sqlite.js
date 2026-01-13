// ===== 숲토킹 v5.3.0 - SQLite WASM Module =====
// SQLite WASM 래퍼 모듈

const ChatSQLite = (function() {
  'use strict';

  // ===== 상수 =====
  const DB_NAME = 'sooptalking_chat';
  const STORAGE_KEY = 'sqlite_db_data';

  // ===== 상태 =====
  let db = null;
  let SQL = null;
  let isInitialized = false;
  let initPromise = null;
  let autoSaveIntervalId = null;  // H-1: 인터벌 ID 저장

  // ===== 스키마 정의 =====
  const SCHEMA = `
    -- 메시지 테이블
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      streamerId TEXT NOT NULL,
      streamerNick TEXT,
      nickname TEXT NOT NULL,
      userId TEXT,
      message TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      elapsedTime TEXT,  -- v5.4.0: 방송 경과 시간 (HH:MM:SS)
      sessionId TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );

    -- 인덱스
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_streamer ON messages(streamerId, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
    CREATE INDEX IF NOT EXISTS idx_messages_nickname ON messages(nickname);
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(sessionId);

    -- Full-Text Search (unicode61 토크나이저 - 한글 지원)
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      nickname,
      message,
      content=messages,
      content_rowid=rowid,
      tokenize='unicode61'
    );

    -- FTS 자동 동기화 트리거
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, nickname, message)
      VALUES (new.rowid, new.nickname, new.message);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, nickname, message)
      VALUES ('delete', old.rowid, old.nickname, old.message);
    END;

    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, nickname, message)
      VALUES ('delete', old.rowid, old.nickname, old.message);
      INSERT INTO messages_fts(rowid, nickname, message)
      VALUES (new.rowid, new.nickname, new.message);
    END;

    -- 세션 테이블
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      streamerId TEXT NOT NULL,
      streamerNick TEXT,
      startTime INTEGER,
      endTime INTEGER,
      messageCount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      date TEXT
    );

    -- 세션 인덱스
    CREATE INDEX IF NOT EXISTS idx_sessions_streamer ON sessions(streamerId);
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

    -- 백업 메타데이터
    CREATE TABLE IF NOT EXISTS backup_meta (
      id INTEGER PRIMARY KEY,
      last_backup INTEGER,
      last_full_backup INTEGER,
      backup_count INTEGER DEFAULT 0,
      last_message_id TEXT
    );

    -- 메타데이터 초기화
    INSERT OR IGNORE INTO backup_meta (id, last_backup, last_full_backup, backup_count)
    VALUES (1, 0, 0, 0);
  `;

  // ===== 초기화 =====
  async function init() {
    if (isInitialized && db) return true;
    if (initPromise) return initPromise;

    initPromise = _doInit();
    return initPromise;
  }

  async function _doInit() {
    try {
      console.log('[ChatSQLite] 초기화 시작...');

      // sql.js 로드
      if (!SQL) {
        SQL = await initSqlJs({
          locateFile: file => chrome.runtime.getURL(`lib/${file}`)
        });
        console.log('[ChatSQLite] sql.js 로드 완료');
      }

      // 저장된 데이터베이스 로드 또는 새로 생성
      const savedData = await loadFromStorage();
      if (savedData) {
        db = new SQL.Database(savedData);
        console.log('[ChatSQLite] 저장된 데이터베이스 복원 완료');
      } else {
        db = new SQL.Database();
        console.log('[ChatSQLite] 새 데이터베이스 생성');
      }

      // 스키마 실행
      db.run(SCHEMA);
      console.log('[ChatSQLite] 스키마 설정 완료');

      // v5.4.0: elapsedTime 컬럼 마이그레이션 (기존 DB 호환)
      try {
        const tableInfo = db.exec("PRAGMA table_info(messages)");
        const columns = tableInfo[0]?.values.map(row => row[1]) || [];
        if (!columns.includes('elapsedTime')) {
          db.run('ALTER TABLE messages ADD COLUMN elapsedTime TEXT');
          console.log('[ChatSQLite] elapsedTime 컬럼 마이그레이션 완료');
        }
      } catch (e) {
        console.warn('[ChatSQLite] elapsedTime 컬럼 마이그레이션 스킵:', e.message);
      }

      isInitialized = true;
      initPromise = null;

      // 주기적 저장 설정 (5분마다) - H-1: 인터벌 ID 저장
      if (autoSaveIntervalId) {
        clearInterval(autoSaveIntervalId);
      }
      autoSaveIntervalId = setInterval(() => saveToStorage(), 5 * 60 * 1000);

      return true;
    } catch (error) {
      console.error('[ChatSQLite] 초기화 실패:', error);
      initPromise = null;
      throw error;
    }
  }

  // ===== 스토리지 관리 =====
  async function loadFromStorage() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        // Base64 → Uint8Array
        const binary = atob(result[STORAGE_KEY]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      }
    } catch (e) {
      console.warn('[ChatSQLite] 저장된 데이터 로드 실패:', e);
    }
    return null;
  }

  async function saveToStorage() {
    if (!db) return false;

    try {
      const data = db.export();
      // Uint8Array → Base64
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      const base64 = btoa(binary);

      await chrome.storage.local.set({ [STORAGE_KEY]: base64 });
      console.log(`[ChatSQLite] 데이터베이스 저장 완료 (${(base64.length / 1024).toFixed(1)}KB)`);
      return true;
    } catch (e) {
      // quota 초과 오류 처리
      if (e.message && e.message.includes('quota')) {
        console.error('[ChatSQLite] 저장 공간 부족. 확장 프로그램을 새로고침하거나 오래된 데이터를 삭제해주세요.');
      } else {
        console.error('[ChatSQLite] 데이터베이스 저장 실패:', e);
      }
      return false;
    }
  }

  // ===== 메시지 CRUD =====

  // 메시지 배치 저장
  async function saveMessages(messages) {
    if (!db) await init();
    if (!messages || messages.length === 0) return { saved: 0, errors: 0 };

    let saved = 0;
    let errors = 0;

    try {
      db.run('BEGIN TRANSACTION');

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO messages
        (id, timestamp, streamerId, streamerNick, nickname, userId, message, date, time, elapsedTime, sessionId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const msg of messages) {
        try {
          stmt.run([
            msg.id,
            msg.timestamp,
            msg.streamerId,
            msg.streamerNick || null,
            msg.nickname,
            msg.userId || null,
            msg.message,
            msg.date,
            msg.time || null,
            msg.elapsedTime || null,  // v5.4.0: 방송 경과 시간
            msg.sessionId || null
          ]);
          saved++;
        } catch (e) {
          errors++;
        }
      }

      stmt.free();
      db.run('COMMIT');

      // 대량 저장 후 즉시 스토리지 저장
      if (saved >= 100) {
        saveToStorage();
      }

      return { saved, errors };
    } catch (e) {
      db.run('ROLLBACK');
      console.error('[ChatSQLite] 메시지 저장 실패:', e);
      return { saved: 0, errors: messages.length };
    }
  }

  // 날짜별 메시지 조회
  async function getMessagesByDate(date, limit = 1000, offset = 0) {
    if (!db) await init();

    try {
      const results = db.exec(`
        SELECT * FROM messages
        WHERE date = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `, [date, limit, offset]);

      return resultsToArray(results);
    } catch (e) {
      console.error('[ChatSQLite] 날짜별 조회 실패:', e);
      return [];
    }
  }

  // 기간별 메시지 조회
  async function getMessagesByDateRange(startDate, endDate, limit = 5000) {
    if (!db) await init();

    try {
      const results = db.exec(`
        SELECT * FROM messages
        WHERE date >= ? AND date <= ?
        ORDER BY timestamp DESC
        LIMIT ?
      `, [startDate, endDate, limit]);

      return resultsToArray(results);
    } catch (e) {
      console.error('[ChatSQLite] 기간별 조회 실패:', e);
      return [];
    }
  }

  // FTS 검색
  async function searchMessages(query) {
    if (!db) await init();

    const {
      nicknames = [],
      keywords = [],
      dateStart = '',
      dateEnd = '',
      streamers = [],
      limit = 500
    } = query || {};

    try {
      let sql = 'SELECT m.* FROM messages m';
      const params = [];
      const conditions = [];

      // FTS 검색 조인 (키워드가 있을 경우)
      if (keywords.length > 0) {
        const ftsTerms = keywords.map(k => `"${k}"`).join(' OR ');
        sql += ' JOIN messages_fts fts ON m.rowid = fts.rowid';
        conditions.push(`messages_fts MATCH ?`);
        params.push(ftsTerms);
      }

      // 날짜 필터
      if (dateStart) {
        conditions.push('m.date >= ?');
        params.push(dateStart);
      }
      if (dateEnd) {
        conditions.push('m.date <= ?');
        params.push(dateEnd);
      }

      // 닉네임 필터 (LIKE 검색)
      if (nicknames.length > 0) {
        const nickConditions = nicknames.map(() => '(m.nickname LIKE ? OR m.userId LIKE ?)');
        conditions.push(`(${nickConditions.join(' OR ')})`);
        nicknames.forEach(n => {
          params.push(`%${n}%`, `%${n}%`);
        });
      }

      // 스트리머 필터
      if (streamers.length > 0) {
        const placeholders = streamers.map(() => '?').join(',');
        conditions.push(`m.streamerId IN (${placeholders})`);
        params.push(...streamers.map(s => s.toLowerCase()));
      }

      // 조건 추가
      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY m.timestamp DESC LIMIT ?';
      params.push(limit);

      const results = db.exec(sql, params);
      return resultsToArray(results);
    } catch (e) {
      console.error('[ChatSQLite] 검색 실패:', e);
      return [];
    }
  }

  // ===== 세션 CRUD =====

  async function saveSession(session) {
    if (!db) await init();

    try {
      db.run(`
        INSERT OR REPLACE INTO sessions
        (id, streamerId, streamerNick, startTime, endTime, messageCount, status, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        session.id,
        session.streamerId,
        session.streamerNick || null,
        session.startTime || null,
        session.endTime || null,
        session.messageCount || 0,
        session.status || 'active',
        session.date || formatDate(new Date())
      ]);
      return session;
    } catch (e) {
      console.error('[ChatSQLite] 세션 저장 실패:', e);
      throw e;
    }
  }

  async function getSessions() {
    if (!db) await init();

    try {
      const results = db.exec('SELECT * FROM sessions ORDER BY startTime DESC');
      return resultsToArray(results);
    } catch (e) {
      console.error('[ChatSQLite] 세션 조회 실패:', e);
      return [];
    }
  }

  // ===== 통계 =====

  async function getStats() {
    if (!db) await init();

    try {
      const msgResult = db.exec('SELECT COUNT(*) as count FROM messages');
      const sessionResult = db.exec('SELECT COUNT(*) as count FROM sessions');

      return {
        messageCount: msgResult[0]?.values[0]?.[0] || 0,
        sessionCount: sessionResult[0]?.values[0]?.[0] || 0
      };
    } catch (e) {
      console.error('[ChatSQLite] 통계 조회 실패:', e);
      return { messageCount: 0, sessionCount: 0 };
    }
  }

  // 시간대별 통계
  async function getHourlyStats(date) {
    if (!db) await init();

    try {
      const results = db.exec(`
        SELECT
          strftime('%H', timestamp/1000, 'unixepoch', 'localtime') as hour,
          COUNT(*) as count
        FROM messages
        WHERE date = ?
        GROUP BY hour
        ORDER BY hour
      `, [date]);

      if (!results[0]) return [];

      return results[0].values.map(row => ({
        hour: row[0],
        count: row[1]
      }));
    } catch (e) {
      console.error('[ChatSQLite] 시간대별 통계 실패:', e);
      return [];
    }
  }

  // 활발한 유저 TOP N
  async function getTopUsers(streamerId, limit = 10) {
    if (!db) await init();

    try {
      let sql = `
        SELECT nickname, COUNT(*) as count
        FROM messages
      `;
      const params = [];

      if (streamerId) {
        sql += ' WHERE streamerId = ?';
        params.push(streamerId);
      }

      sql += ' GROUP BY nickname ORDER BY count DESC LIMIT ?';
      params.push(limit);

      const results = db.exec(sql, params);

      if (!results[0]) return [];

      return results[0].values.map(row => ({
        nickname: row[0],
        count: row[1]
      }));
    } catch (e) {
      console.error('[ChatSQLite] TOP 유저 조회 실패:', e);
      return [];
    }
  }

  // ===== 스트리머 목록 =====

  async function getStreamers() {
    if (!db) await init();

    try {
      // v5.4.0: messages 테이블 기반으로 변경 (실제 저장된 모든 스트리머 표시)
      // sessions 테이블에서 닉네임 정보를 가져와 매핑
      const results = db.exec(`
        SELECT
          m.streamerId,
          COALESCE(s.streamerNick, m.streamerNick, m.streamerId) as nickname,
          MAX(m.timestamp) as lastTime
        FROM messages m
        LEFT JOIN sessions s ON LOWER(m.streamerId) = LOWER(s.streamerId)
        GROUP BY LOWER(m.streamerId)
        ORDER BY lastTime DESC
      `);

      if (!results[0]) return [];

      return results[0].values.map(row => ({
        id: row[0],
        nickname: row[1] || row[0]
      }));
    } catch (e) {
      console.error('[ChatSQLite] 스트리머 목록 조회 실패:', e);
      return [];
    }
  }

  // 데이터 있는 날짜 목록
  async function getDatesWithData() {
    if (!db) await init();

    try {
      const results = db.exec(`
        SELECT DISTINCT date FROM messages ORDER BY date DESC
      `);

      if (!results[0]) return [];

      return results[0].values.map(row => row[0]);
    } catch (e) {
      console.error('[ChatSQLite] 날짜 목록 조회 실패:', e);
      return [];
    }
  }

  // ===== 삭제 =====

  async function deleteByDate(date) {
    if (!db) await init();

    try {
      const countResult = db.exec('SELECT COUNT(*) FROM messages WHERE date = ?', [date]);
      const count = countResult[0]?.values[0]?.[0] || 0;

      db.run('DELETE FROM messages WHERE date = ?', [date]);

      // v5.4.0: 삭제 후 즉시 storage에 저장 (새로고침 시 복원 방지)
      await saveToStorage();

      console.log(`[ChatSQLite] ${date} 삭제 완료: ${count}건`);

      return count;
    } catch (e) {
      console.error('[ChatSQLite] 날짜별 삭제 실패:', e);
      return 0;
    }
  }

  async function deleteByStreamers(streamerIds) {
    if (!db) await init();
    if (!streamerIds || streamerIds.length === 0) return { deletedMessages: 0, deletedSessions: 0 };

    try {
      const lowerIds = streamerIds.map(id => id.toLowerCase());
      const placeholders = lowerIds.map(() => '?').join(',');

      // 메시지 개수
      const msgCountResult = db.exec(
        `SELECT COUNT(*) FROM messages WHERE LOWER(streamerId) IN (${placeholders})`,
        lowerIds
      );
      const deletedMessages = msgCountResult[0]?.values[0]?.[0] || 0;

      // 세션 개수
      const sessionCountResult = db.exec(
        `SELECT COUNT(*) FROM sessions WHERE LOWER(streamerId) IN (${placeholders})`,
        lowerIds
      );
      const deletedSessions = sessionCountResult[0]?.values[0]?.[0] || 0;

      // 삭제 실행
      db.run(`DELETE FROM messages WHERE LOWER(streamerId) IN (${placeholders})`, lowerIds);
      db.run(`DELETE FROM sessions WHERE LOWER(streamerId) IN (${placeholders})`, lowerIds);

      // v5.4.0: 삭제 후 즉시 storage에 저장 (새로고침 시 복원 방지)
      await saveToStorage();

      console.log(`[ChatSQLite] 스트리머별 삭제 완료: 메시지 ${deletedMessages}건, 세션 ${deletedSessions}건`);

      return { deletedMessages, deletedSessions };
    } catch (e) {
      console.error('[ChatSQLite] 스트리머별 삭제 실패:', e);
      return { deletedMessages: 0, deletedSessions: 0 };
    }
  }

  async function deleteAllData() {
    if (!db) await init();

    try {
      const msgCount = db.exec('SELECT COUNT(*) FROM messages')[0]?.values[0]?.[0] || 0;
      const sessionCount = db.exec('SELECT COUNT(*) FROM sessions')[0]?.values[0]?.[0] || 0;

      db.run('DELETE FROM messages');
      db.run('DELETE FROM sessions');
      db.run('DELETE FROM messages_fts');

      // v5.4.0: 삭제 후 즉시 storage에 저장 (새로고침 시 복원 방지)
      await saveToStorage();

      console.log(`[ChatSQLite] 전체 삭제 완료: 메시지 ${msgCount}건, 세션 ${sessionCount}건`);

      return { deletedMessages: msgCount, deletedSessions: sessionCount };
    } catch (e) {
      console.error('[ChatSQLite] 전체 삭제 실패:', e);
      return { deletedMessages: 0, deletedSessions: 0 };
    }
  }

  // ===== 내보내기/가져오기 =====

  async function exportAll() {
    if (!db) await init();

    try {
      const messages = await getAllMessages();
      const sessions = await getSessions();

      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        storageType: 'sqlite',
        messageCount: messages.length,
        sessionCount: sessions.length,
        messages,
        sessions
      };
    } catch (e) {
      console.error('[ChatSQLite] 내보내기 실패:', e);
      throw e;
    }
  }

  async function exportByStreamers(streamerIds) {
    if (!db) await init();
    if (!streamerIds || streamerIds.length === 0) {
      return { version: '1.0', exportedAt: new Date().toISOString(), messageCount: 0, sessionCount: 0, messages: [], sessions: [] };
    }

    try {
      const lowerIds = streamerIds.map(id => id.toLowerCase());
      const placeholders = lowerIds.map(() => '?').join(',');

      const msgResults = db.exec(
        `SELECT * FROM messages WHERE LOWER(streamerId) IN (${placeholders})`,
        lowerIds
      );
      const messages = resultsToArray(msgResults);

      const sessionResults = db.exec(
        `SELECT * FROM sessions WHERE LOWER(streamerId) IN (${placeholders})`,
        lowerIds
      );
      const sessions = resultsToArray(sessionResults);

      return {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedStreamers: streamerIds,
        messageCount: messages.length,
        sessionCount: sessions.length,
        messages,
        sessions
      };
    } catch (e) {
      console.error('[ChatSQLite] 스트리머별 내보내기 실패:', e);
      throw e;
    }
  }

  async function importData(data, merge = true) {
    if (!db) await init();
    if (!data || !data.messages) {
      throw new Error('잘못된 데이터 형식');
    }

    let imported = 0;
    let skipped = 0;

    try {
      // 중복 체크
      const existingIds = new Set();
      if (merge) {
        const existing = db.exec('SELECT id FROM messages');
        if (existing[0]) {
          existing[0].values.forEach(row => existingIds.add(row[0]));
        }
      }

      const newMessages = data.messages.filter(m => !existingIds.has(m.id));
      skipped = data.messages.length - newMessages.length;

      if (newMessages.length > 0) {
        const result = await saveMessages(newMessages);
        imported = result.saved;
      }

      // 세션 가져오기
      if (data.sessions) {
        for (const session of data.sessions) {
          await saveSession(session);
        }
      }

      return { imported, skipped };
    } catch (e) {
      console.error('[ChatSQLite] 가져오기 실패:', e);
      throw e;
    }
  }

  // 전체 메시지 조회 (내부용)
  async function getAllMessages() {
    if (!db) await init();

    try {
      const results = db.exec('SELECT * FROM messages ORDER BY timestamp DESC');
      return resultsToArray(results);
    } catch (e) {
      console.error('[ChatSQLite] 전체 메시지 조회 실패:', e);
      return [];
    }
  }

  // ===== 데이터베이스 바이너리 내보내기 (백업용) =====

  async function exportDatabase() {
    if (!db) await init();

    try {
      const data = db.export();
      return new Blob([data], { type: 'application/x-sqlite3' });
    } catch (e) {
      console.error('[ChatSQLite] 데이터베이스 내보내기 실패:', e);
      throw e;
    }
  }

  async function importDatabase(blob) {
    try {
      const arrayBuffer = await blob.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);

      // 새 데이터베이스 로드
      if (db) db.close();
      db = new SQL.Database(data);

      // 스토리지에 저장
      await saveToStorage();

      console.log('[ChatSQLite] 데이터베이스 가져오기 완료');
      return true;
    } catch (e) {
      console.error('[ChatSQLite] 데이터베이스 가져오기 실패:', e);
      throw e;
    }
  }

  // ===== 스트리머별 메시지 개수 =====

  async function getMessageCountByStreamer() {
    if (!db) await init();

    try {
      const results = db.exec(`
        SELECT LOWER(streamerId) as sid, COUNT(*) as count
        FROM messages
        GROUP BY LOWER(streamerId)
      `);

      if (!results[0]) return {};

      const counts = {};
      results[0].values.forEach(row => {
        counts[row[0]] = row[1];
      });
      return counts;
    } catch (e) {
      console.error('[ChatSQLite] 스트리머별 개수 조회 실패:', e);
      return {};
    }
  }

  // ===== 오래된 데이터 정리 =====

  async function cleanupOldData(retentionDays = 90) {
    if (!db) await init();

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      const cutoffDateStr = formatDate(cutoffDate);

      const countResult = db.exec(
        'SELECT COUNT(*) FROM messages WHERE date < ?',
        [cutoffDateStr]
      );
      const count = countResult[0]?.values[0]?.[0] || 0;

      db.run('DELETE FROM messages WHERE date < ?', [cutoffDateStr]);

      console.log(`[ChatSQLite] 오래된 데이터 정리 완료: ${count}건 (${retentionDays}일 이전)`);
      return count;
    } catch (e) {
      console.error('[ChatSQLite] 데이터 정리 실패:', e);
      return 0;
    }
  }

  // ===== 유틸리티 =====

  function resultsToArray(results) {
    if (!results || results.length === 0 || !results[0]) return [];

    const columns = results[0].columns;
    return results[0].values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ===== 상태 확인 =====

  function isReady() {
    return isInitialized && db !== null;
  }

  function close() {
    // H-1: 인터벌 정리
    if (autoSaveIntervalId) {
      clearInterval(autoSaveIntervalId);
      autoSaveIntervalId = null;
    }

    if (db) {
      saveToStorage(); // 종료 전 저장
      db.close();
      db = null;
      isInitialized = false;
      console.log('[ChatSQLite] 데이터베이스 연결 종료');
    }
  }

  // ===== 공개 API =====
  return {
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

    // 스토리지
    saveToStorage,

    // 유틸리티
    formatDate
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.ChatSQLite = ChatSQLite;
}
