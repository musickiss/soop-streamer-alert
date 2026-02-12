// ===== 숲토킹 v5.4.4 - 메시지 큐 모듈 (ES6 Module) =====
// 순서가 중요한 메시지를 순차 처리하여 메시지 순서를 보장합니다.
// 피처 플래그로 활성화/비활성화할 수 있습니다.

import { FEATURES } from './config.js';

/**
 * 메시지 큐 클래스
 * - 순서가 중요한 메시지 타입만 큐잉합니다.
 * - 타입별로 독립적인 큐를 유지합니다.
 * - 큐 처리 중 에러가 발생해도 다음 메시지 처리를 계속합니다.
 */
export class MessageQueue {
  constructor() {
    // 타입별 메시지 큐 (순서 보장이 필요한 타입만)
    this.queues = new Map();

    // 타입별 처리 중 플래그
    this.processing = new Map();

    // 순서 보장이 필요한 메시지 타입 목록
    // 이 목록에 없는 타입은 즉시 처리됩니다.
    this.orderedTypes = [
      'CHAT_MESSAGES_BATCH',      // 채팅 배치 저장
      'SAVE_RECORDING_SEGMENT',   // 분할 녹화 저장
      'CHAT_SESSION_START',       // 세션 시작
      'CHAT_SESSION_END'          // 세션 종료
    ];
  }

  /**
   * 메시지를 큐에 추가하고 처리합니다.
   * @param {string} type - 메시지 타입
   * @param {Function} handler - 메시지 처리 함수 (async)
   * @param {Object} message - 메시지 데이터
   * @param {Object} sender - 발신자 정보
   * @param {Function} sendResponse - 응답 함수
   * @returns {Promise} 처리 완료 Promise
   */
  async enqueue(type, handler, message, sender, sendResponse) {
    // 순서 보장이 필요하지 않은 타입은 즉시 실행
    if (!this.orderedTypes.includes(type)) {
      return this._executeHandler(handler, message, sender, sendResponse);
    }

    // 큐 초기화
    if (!this.queues.has(type)) {
      this.queues.set(type, []);
      this.processing.set(type, false);
    }

    // 큐에 작업 추가
    return new Promise((resolve, reject) => {
      const task = {
        handler,
        message,
        sender,
        sendResponse,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.queues.get(type).push(task);

      if (FEATURES.messageQueueDebug) {
        console.log(`[숲토킹 Queue] ${type} 큐에 추가됨, 대기: ${this.queues.get(type).length}개`);
      }

      // 큐 처리 시작 (이미 처리 중이 아니면)
      this._processQueue(type);
    });
  }

  /**
   * 특정 타입의 큐를 순차 처리합니다.
   * @private
   */
  async _processQueue(type) {
    // 이미 처리 중이면 스킵 (중복 실행 방지)
    if (this.processing.get(type)) {
      return;
    }

    const queue = this.queues.get(type);
    if (!queue || queue.length === 0) {
      return;
    }

    this.processing.set(type, true);

    while (queue.length > 0) {
      const task = queue.shift();

      try {
        if (FEATURES.messageQueueDebug) {
          const waitTime = Date.now() - task.timestamp;
          console.log(`[숲토킹 Queue] ${type} 처리 시작 (대기: ${waitTime}ms)`);
        }

        await this._executeHandler(
          task.handler,
          task.message,
          task.sender,
          task.sendResponse
        );

        task.resolve();

      } catch (error) {
        console.error(`[숲토킹 Queue] ${type} 처리 실패:`, error);
        task.reject(error);
        // 에러가 발생해도 다음 메시지 계속 처리
      }
    }

    this.processing.set(type, false);
  }

  /**
   * 핸들러를 실행합니다.
   * @private
   */
  async _executeHandler(handler, message, sender, sendResponse) {
    try {
      await handler(message, sender, sendResponse);
    } catch (error) {
      console.error('[숲토킹 Queue] 핸들러 실행 오류:', error);
      throw error;
    }
  }

  /**
   * 특정 타입의 큐 상태를 반환합니다.
   * @param {string} type - 메시지 타입
   * @returns {Object} 큐 상태
   */
  getQueueStatus(type) {
    return {
      pending: this.queues.get(type)?.length || 0,
      processing: this.processing.get(type) || false
    };
  }

  /**
   * 모든 큐의 상태를 반환합니다.
   * @returns {Object} 전체 큐 상태
   */
  getAllQueueStatus() {
    const status = {};
    for (const type of this.orderedTypes) {
      status[type] = this.getQueueStatus(type);
    }
    return status;
  }

  /**
   * 특정 타입의 큐를 비웁니다.
   * @param {string} type - 메시지 타입
   */
  clearQueue(type) {
    if (this.queues.has(type)) {
      const queue = this.queues.get(type);
      // 대기 중인 작업들을 reject
      while (queue.length > 0) {
        const task = queue.shift();
        task.reject(new Error('Queue cleared'));
      }
    }
  }

  /**
   * 모든 큐를 비웁니다.
   */
  clearAllQueues() {
    for (const type of this.orderedTypes) {
      this.clearQueue(type);
    }
  }
}

// 싱글톤 인스턴스
export const messageQueue = new MessageQueue();

console.log('[숲토킹] 메시지 큐 모듈 로드됨');
