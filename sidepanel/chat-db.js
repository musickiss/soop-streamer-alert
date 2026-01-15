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
    } = query || {};

    // 기본 날짜 범위 (전체)
    const start = dateStart || '2020-01-01';
    const end = dateEnd || formatDate(new Date());

    // 기간별 메시지 가져오기
    let messages = [];
    try {
      messages = await getMessagesByDateRange(start, end, 10000);
    } catch (e) {
      console.error('[ChatDB] 기간별 메시지 조회 실패:', e);
      return [];
    }

    if (!messages || messages.length === 0) {
      return [];
    }

    // 닉네임 또는 userId 필터
    if (nicknames && nicknames.length > 0) {
      const lowerNicknames = nicknames.map(n => String(n).toLowerCase());
      messages = messages.filter(m => {
        if (!m) return false;
        // 닉네임 매칭
        const nicknameMatch = m.nickname && lowerNicknames.some(n => m.nickname.toLowerCase().includes(n));
        // userId 매칭
        const userIdMatch = m.userId && lowerNicknames.some(n => m.userId.toLowerCase().includes(n));
        return nicknameMatch || userIdMatch;
      });
    }

    // 키워드 필터
    if (keywords && keywords.length > 0) {
      const lowerKeywords = keywords.map(k => String(k).toLowerCase());
      messages = messages.filter(m =>
        m && m.message && lowerKeywords.some(k => m.message.toLowerCase().includes(k))
      );
    }

    // 스트리머 필터
    if (streamers && streamers.length > 0) {
      const lowerStreamers = streamers.map(s => String(s).toLowerCase());
      messages = messages.filter(m =>
        m && m.streamerId && lowerStreamers.includes(m.streamerId.toLowerCase())
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
  // v5.4.0: messages 기반으로 변경 (실제 저장된 모든 스트리머 표시)
  async function getStreamers() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES, STORE_SESSIONS], 'readonly');
      const messagesStore = transaction.objectStore(STORE_MESSAGES);
      const sessionsStore = transaction.objectStore(STORE_SESSIONS);

      // 1. 세션에서 닉네임 맵 구축
      const sessionsRequest = sessionsStore.getAll();
      const nickMap = new Map(); // streamerId (lowercase) -> streamerNick

      sessionsRequest.onsuccess = () => {
        const sessions = sessionsRequest.result || [];
        for (const session of sessions) {
          if (session.streamerNick && session.streamerId) {
            const key = session.streamerId.toLowerCase();
            if (!nickMap.has(key) || nickMap.get(key) === session.streamerId) {
              nickMap.set(key, session.streamerNick);
            }
          }
        }

        // 2. 메시지에서 스트리머 목록 구축
        const messagesRequest = messagesStore.openCursor();
        const streamers = new Map(); // streamerId (lowercase) -> { id, nickname, lastTime }

        messagesRequest.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const msg = cursor.value;
            if (msg && msg.streamerId) {
              const key = msg.streamerId.toLowerCase();
              const existing = streamers.get(key);

              if (!existing || msg.timestamp > existing.lastTime) {
                // 닉네임 우선순위: 세션 닉네임 > 메시지 닉네임 > ID
                const nickname = nickMap.get(key) || msg.streamerNick || msg.streamerId;
                streamers.set(key, {
                  id: msg.streamerId,
                  nickname: nickname,
                  lastTime: msg.timestamp
                });
              }
            }
            cursor.continue();
          } else {
            // 정렬: 최근 메시지 순
            const result = Array.from(streamers.values())
              .sort((a, b) => b.lastTime - a.lastTime)
              .map(s => ({ id: s.id, nickname: s.nickname }));
            resolve(result);
          }
        };

        messagesRequest.onerror = () => reject(messagesRequest.error);
      };

      sessionsRequest.onerror = () => reject(sessionsRequest.error);
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

  // ===== 스트리머별 데이터 내보내기 =====
  async function exportByStreamers(streamerIds) {
    if (!db) await init();
    if (!streamerIds || streamerIds.length === 0) {
      return { version: '1.0', exportedAt: new Date().toISOString(), messageCount: 0, sessionCount: 0, messages: [], sessions: [] };
    }

    // 스트리머 ID를 소문자로 변환 (대소문자 무시 비교)
    const lowerStreamerIds = streamerIds.map(id => id.toLowerCase());

    // 전체 메시지 조회 후 필터링
    const allMessages = await new Promise((resolve, reject) => {
      const request = db.transaction([STORE_MESSAGES], 'readonly')
        .objectStore(STORE_MESSAGES).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    // 스트리머 ID로 필터링
    const messages = allMessages.filter(m =>
      m && m.streamerId && lowerStreamerIds.includes(m.streamerId.toLowerCase())
    );

    // 세션도 필터링
    const allSessions = await new Promise((resolve, reject) => {
      const request = db.transaction([STORE_SESSIONS], 'readonly')
        .objectStore(STORE_SESSIONS).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const sessions = allSessions.filter(s =>
      s && s.streamerId && lowerStreamerIds.includes(s.streamerId.toLowerCase())
    );

    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      exportedStreamers: streamerIds,
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

  // ===== 스트리머별 데이터 삭제 =====
  async function deleteByStreamers(streamerIds) {
    if (!db) await init();
    if (!streamerIds || streamerIds.length === 0) return { deleted: 0 };

    const lowerStreamerIds = streamerIds.map(id => id.toLowerCase());

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES, STORE_SESSIONS], 'readwrite');
      const messagesStore = transaction.objectStore(STORE_MESSAGES);
      const sessionsStore = transaction.objectStore(STORE_SESSIONS);

      let deletedMessages = 0;
      let deletedSessions = 0;

      // 메시지 삭제
      const msgRequest = messagesStore.openCursor();
      msgRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const msg = cursor.value;
          if (msg && msg.streamerId && lowerStreamerIds.includes(msg.streamerId.toLowerCase())) {
            cursor.delete();
            deletedMessages++;
          }
          cursor.continue();
        }
      };

      // 세션 삭제
      const sessionRequest = sessionsStore.openCursor();
      sessionRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const session = cursor.value;
          if (session && session.streamerId && lowerStreamerIds.includes(session.streamerId.toLowerCase())) {
            cursor.delete();
            deletedSessions++;
          }
          cursor.continue();
        }
      };

      transaction.oncomplete = () => {
        console.log(`[ChatDB] 스트리머별 삭제 완료: 메시지 ${deletedMessages}건, 세션 ${deletedSessions}건`);
        resolve({ deletedMessages, deletedSessions });
      };

      transaction.onerror = () => {
        console.error('[ChatDB] 스트리머별 삭제 실패:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  // ===== 전체 데이터 삭제 =====
  async function deleteAllData() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES, STORE_SESSIONS], 'readwrite');
      const messagesStore = transaction.objectStore(STORE_MESSAGES);
      const sessionsStore = transaction.objectStore(STORE_SESSIONS);

      let deletedMessages = 0;
      let deletedSessions = 0;

      // 메시지 개수 확인 후 전체 삭제
      const msgCountRequest = messagesStore.count();
      msgCountRequest.onsuccess = () => {
        deletedMessages = msgCountRequest.result;
        messagesStore.clear();
      };

      // 세션 개수 확인 후 전체 삭제
      const sessionCountRequest = sessionsStore.count();
      sessionCountRequest.onsuccess = () => {
        deletedSessions = sessionCountRequest.result;
        sessionsStore.clear();
      };

      transaction.oncomplete = () => {
        console.log(`[ChatDB] 전체 삭제 완료: 메시지 ${deletedMessages}건, 세션 ${deletedSessions}건`);
        resolve({ deletedMessages, deletedSessions });
      };

      transaction.onerror = () => {
        console.error('[ChatDB] 전체 삭제 실패:', transaction.error);
        reject(transaction.error);
      };
    });
  }

  // ===== 스트리머별 메시지 개수 조회 (M-3: cursor 기반으로 변경) =====
  async function getMessageCountByStreamer() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES], 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const request = store.openCursor();  // M-3: getAll() 대신 cursor 사용

      const counts = {};

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const msg = cursor.value;
          if (msg && msg.streamerId) {
            const id = msg.streamerId.toLowerCase();
            counts[id] = (counts[id] || 0) + 1;
          }
          cursor.continue();
        } else {
          resolve(counts);
        }
      };

      request.onerror = () => reject(request.error);
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

  // ===== v5.4.1: 세션 목록 조회 =====
  async function getSessions() {
    if (!db) await init();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_SESSIONS], 'readonly');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        // 최신순 정렬
        sessions.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
        resolve(sessions);
      };

      request.onerror = () => reject(request.error);
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
    exportByStreamers,
    importData,
    deleteByDate,
    deleteByStreamers,
    deleteAllData,
    getMessageCountByStreamer,
    cleanupOldData,
    getSessions,  // v5.4.1
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
