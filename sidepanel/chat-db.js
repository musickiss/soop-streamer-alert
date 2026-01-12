// ===== 숲토킹 v5.0.0 - Chat Database Module =====
// IndexedDB 관리 모듈

const ChatDB = (function() {
  'use strict';

  // ===== 상수 =====
  const DB_NAME = 'sooptalkingChat';
  const DB_VERSION = 1;
  const STORE_MESSAGES = 'messages';
  const STORE_SESSIONS = 'sessions';
  const STORE_SETTINGS = 'settings';

  // ===== 상태 =====
  let db = null;

  // ===== 데이터베이스 초기화 =====
  async function init() {
    if (db) return db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[ChatDB] 데이터베이스 열기 실패:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        db = request.result;
        console.log('[ChatDB] 데이터베이스 연결 완료');
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        console.log('[ChatDB] 스키마 업그레이드 시작');

        // messages 스토어
        if (!database.objectStoreNames.contains(STORE_MESSAGES)) {
          const messagesStore = database.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
          messagesStore.createIndex('date', 'date', { unique: false });
          messagesStore.createIndex('date_streamer', ['date', 'streamerId'], { unique: false });
          messagesStore.createIndex('userId', 'userId', { unique: false });
          messagesStore.createIndex('nickname', 'nickname', { unique: false });
          messagesStore.createIndex('sessionId', 'sessionId', { unique: false });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // sessions 스토어
        if (!database.objectStoreNames.contains(STORE_SESSIONS)) {
          const sessionsStore = database.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
          sessionsStore.createIndex('date', 'date', { unique: false });
          sessionsStore.createIndex('streamerId', 'streamerId', { unique: false });
        }

        // settings 스토어
        if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
          database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }

        console.log('[ChatDB] 스키마 업그레이드 완료');
      };
    });
  }

  // ===== 메시지 저장 (배치) =====
  async function saveMessages(messages) {
    if (!db) await init();
    if (!messages || messages.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);

      let saved = 0;
      let errors = 0;

      for (const msg of messages) {
        const request = store.put(msg);
        request.onsuccess = () => saved++;
        request.onerror = () => errors++;
      }

      transaction.oncomplete = () => {
        console.log(`[ChatDB] 메시지 저장 완료: ${saved}건, 오류: ${errors}건`);
        resolve({ saved, errors });
      };

      transaction.onerror = () => {
        console.error('[ChatDB] 메시지 저장 실패:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  // ===== 세션 저장/업데이트 =====
  async function saveSession(session) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readwrite');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.put(session);

      request.onsuccess = () => resolve(session);
      request.onerror = () => reject(request.error);
    });
  }

  // ===== 날짜별 메시지 조회 =====
  async function getMessagesByDate(date, limit = 1000, offset = 0) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('date');
      const request = index.getAll(IDBKeyRange.only(date));

      request.onsuccess = () => {
        let results = request.result || [];
        // 시간순 정렬
        results.sort((a, b) => b.timestamp - a.timestamp);
        // 페이지네이션
        if (offset > 0 || limit < results.length) {
          results = results.slice(offset, offset + limit);
        }
        resolve(results);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== 기간별 메시지 조회 =====
  async function getMessagesByDateRange(startDate, endDate, limit = 5000) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('date');
      const range = IDBKeyRange.bound(startDate, endDate);
      const request = index.getAll(range, limit);

      request.onsuccess = () => {
        let results = request.result || [];
        results.sort((a, b) => b.timestamp - a.timestamp);
        resolve(results);
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== 복합 검색 =====
  async function searchMessages(query) {
    if (!db) await init();

    const {
      nicknames = [],
      keywords = [],
      dateStart = '',
      dateEnd = '',
      streamers = [],
      limit = 500
    } = query;

    // 기본 날짜 범위 (전체)
    const start = dateStart || '2020-01-01';
    const end = dateEnd || formatDate(new Date());

    // 기간별 메시지 가져오기
    let messages = await getMessagesByDateRange(start, end, 10000);

    // 닉네임 필터
    if (nicknames.length > 0) {
      const lowerNicknames = nicknames.map(n => n.toLowerCase());
      messages = messages.filter(m =>
        lowerNicknames.some(n => m.nickname.toLowerCase().includes(n))
      );
    }

    // 키워드 필터
    if (keywords.length > 0) {
      const lowerKeywords = keywords.map(k => k.toLowerCase());
      messages = messages.filter(m =>
        lowerKeywords.some(k => m.message.toLowerCase().includes(k))
      );
    }

    // 스트리머 필터
    if (streamers.length > 0) {
      const lowerStreamers = streamers.map(s => s.toLowerCase());
      messages = messages.filter(m =>
        lowerStreamers.includes(m.streamerId.toLowerCase())
      );
    }

    // 결과 제한
    return messages.slice(0, limit);
  }

  // ===== 데이터 있는 날짜 목록 조회 =====
  async function getDatesWithData() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('date');
      const request = index.openKeyCursor(null, 'nextunique');

      const dates = new Set();
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          dates.add(cursor.key);
          cursor.continue();
        } else {
          resolve(Array.from(dates).sort().reverse());
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== 스트리머 목록 조회 =====
  async function getStreamers() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readonly');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        const streamers = new Map();

        for (const session of sessions) {
          if (!streamers.has(session.streamerId)) {
            streamers.set(session.streamerId, {
              id: session.streamerId,
              nickname: session.streamerNick
            });
          }
        }

        resolve(Array.from(streamers.values()));
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ===== 통계 조회 =====
  async function getStats() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES, STORE_SESSIONS], 'readonly');

      let messageCount = 0;
      let sessionCount = 0;

      const msgRequest = transaction.objectStore(STORE_MESSAGES).count();
      msgRequest.onsuccess = () => { messageCount = msgRequest.result; };

      const sessionRequest = transaction.objectStore(STORE_SESSIONS).count();
      sessionRequest.onsuccess = () => { sessionCount = sessionRequest.result; };

      transaction.oncomplete = () => {
        resolve({ messageCount, sessionCount });
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ===== 전체 데이터 내보내기 =====
  async function exportAll() {
    if (!db) await init();

    const messages = await new Promise((resolve, reject) => {
      const request = db.transaction([STORE_MESSAGES], 'readonly')
        .objectStore(STORE_MESSAGES).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const sessions = await new Promise((resolve, reject) => {
      const request = db.transaction([STORE_SESSIONS], 'readonly')
        .objectStore(STORE_SESSIONS).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      messageCount: messages.length,
      sessionCount: sessions.length,
      messages,
      sessions
    };
  }

  // ===== 데이터 가져오기 =====
  async function importData(data, merge = true) {
    if (!db) await init();
    if (!data || !data.messages) {
      throw new Error('잘못된 데이터 형식');
    }

    const messages = data.messages;
    const sessions = data.sessions || [];

    let imported = 0;
    let skipped = 0;

    // 중복 체크를 위한 기존 ID 조회 (병합 모드)
    let existingIds = new Set();
    if (merge) {
      const existing = await new Promise((resolve, reject) => {
        const request = db.transaction([STORE_MESSAGES], 'readonly')
          .objectStore(STORE_MESSAGES).getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      existingIds = new Set(existing);
    }

    // 메시지 가져오기
    const newMessages = messages.filter(m => !existingIds.has(m.id));
    skipped = messages.length - newMessages.length;

    if (newMessages.length > 0) {
      await saveMessages(newMessages);
      imported = newMessages.length;
    }

    // 세션 가져오기
    for (const session of sessions) {
      await saveSession(session);
    }

    return { imported, skipped };
  }

  // ===== 날짜별 삭제 =====
  async function deleteByDate(date) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('date');
      const request = index.openCursor(IDBKeyRange.only(date));

      let deleted = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        console.log(`[ChatDB] ${date} 삭제 완료: ${deleted}건`);
        resolve(deleted);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ===== 오래된 데이터 정리 =====
  async function cleanupOldData(retentionDays = 90) {
    if (!db) await init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffDateStr = formatDate(cutoffDate);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('date');
      const range = IDBKeyRange.upperBound(cutoffDateStr, true);
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

      transaction.oncomplete = () => {
        console.log(`[ChatDB] 오래된 데이터 정리 완료: ${deleted}건 (${retentionDays}일 이전)`);
        resolve(deleted);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ===== 설정 저장/조회 =====
  async function saveSetting(key, value) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const request = db.transaction([STORE_SETTINGS], 'readwrite')
        .objectStore(STORE_SETTINGS)
        .put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function getSetting(key, defaultValue = null) {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const request = db.transaction([STORE_SETTINGS], 'readonly')
        .objectStore(STORE_SETTINGS)
        .get(key);
      request.onsuccess = () => {
        resolve(request.result ? request.result.value : defaultValue);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ===== 유틸리티 =====
  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ===== 데이터베이스 닫기 =====
  function close() {
    if (db) {
      db.close();
      db = null;
      console.log('[ChatDB] 데이터베이스 연결 종료');
    }
  }

  // ===== 공개 API =====
  return {
    init,
    saveMessages,
    saveSession,
    getMessagesByDate,
    getMessagesByDateRange,
    searchMessages,
    getDatesWithData,
    getStreamers,
    getStats,
    exportAll,
    importData,
    deleteByDate,
    cleanupOldData,
    saveSetting,
    getSetting,
    close,
    formatDate
  };
})();

// 전역 노출
if (typeof window !== 'undefined') {
  window.ChatDB = ChatDB;
}
