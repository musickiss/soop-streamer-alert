// ===== 숲토킹 v2.0 - Offscreen HLS 다운로드 엔진 =====
// .ts 세그먼트를 실시간으로 다운로드하고 저장

(function() {
  'use strict';

  // ===== 다운로드 세션 관리 =====
  const downloadSessions = new Map();

  // ===== 설정 =====
  const CONFIG = {
    SEGMENT_FETCH_TIMEOUT: 10000,
    PLAYLIST_REFRESH_INTERVAL: 2000,
    MAX_RETRY_COUNT: 3,
    RETRY_DELAY: 1000,
    SAVE_INTERVAL: 60000, // 1분마다 저장
    SEGMENT_BUFFER_SIZE: 30, // 30개 세그먼트씩 저장
  };

  // ===== Background 프록시를 통한 fetch (DNS 문제 우회) =====
  async function fetchViaBackground(url, responseType = 'arraybuffer') {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'PROXY_FETCH',
        url: url,
        responseType: responseType
      }, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.success) {
          reject(new Error(response?.error || 'Fetch 실패'));
          return;
        }
        resolve(response);
      });
    });
  }

  // m3u8 플레이리스트 가져오기 (텍스트)
  async function fetchM3u8(url) {
    const response = await fetchViaBackground(url, 'text');
    return response.data;
  }

  // ts 세그먼트 가져오기 (바이너리)
  async function fetchSegment(url) {
    const response = await fetchViaBackground(url, 'arraybuffer');
    // base64 -> Uint8Array 변환
    const binary = atob(response.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // 재시도 로직이 포함된 fetch
  async function fetchM3u8WithRetry(url, retries = CONFIG.MAX_RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetchM3u8(url);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (i + 1)));
      }
    }
  }

  async function fetchSegmentWithRetry(url, retries = CONFIG.MAX_RETRY_COUNT) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fetchSegment(url);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY * (i + 1)));
      }
    }
  }

  function generateSessionId() {
    return `dl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  function formatFileName(nickname, streamerId, date) {
    const d = new Date(date);
    const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    return `${nickname}_${dateStr}_${timeStr}.ts`;
  }

  // ===== m3u8 파싱 =====
  function parseM3u8(content, baseUrl) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l);
    const segments = [];
    let mediaSequence = 0;
    let targetDuration = 2;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        mediaSequence = parseInt(line.split(':')[1], 10);
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        targetDuration = parseFloat(line.split(':')[1]);
      } else if (line.startsWith('#EXTINF:')) {
        const duration = parseFloat(line.split(':')[1].split(',')[0]);
        const segmentUrl = lines[i + 1];
        if (segmentUrl && !segmentUrl.startsWith('#')) {
          const fullUrl = segmentUrl.startsWith('http') ? segmentUrl : baseUrl + segmentUrl;
          segments.push({
            url: fullUrl,
            duration,
            sequence: mediaSequence + segments.length
          });
        }
      }
    }

    return { segments, mediaSequence, targetDuration };
  }

  // ===== 다운로드 세션 클래스 =====
  class DownloadSession {
    constructor(options) {
      this.sessionId = generateSessionId();
      this.streamerId = options.streamerId;
      this.broadNo = options.broadNo;
      this.nickname = options.nickname;
      this.title = options.title;
      this.m3u8Url = options.m3u8Url;
      this.baseUrl = options.baseUrl;
      this.quality = options.quality || 'original';
      this.isBackgroundDownload = options.isBackgroundDownload || false;

      this.isRunning = false;
      this.isPaused = false;
      this.startTime = Date.now();
      this.lastSequence = -1;
      this.downloadedSegments = [];
      this.totalBytes = 0;
      this.segmentCount = 0;
      this.lastSaveTime = Date.now();
      this.savedParts = [];
    }

    async start() {
      if (this.isRunning) return;

      this.isRunning = true;
      console.log(`[HLS] 다운로드 시작: ${this.streamerId} (${this.sessionId})`);

      this.notifyBackground('DOWNLOAD_STARTED', this.getStatus());

      // 메인 다운로드 루프
      await this.downloadLoop();
    }

    async downloadLoop() {
      while (this.isRunning) {
        try {
          // m3u8 플레이리스트 가져오기 (Background 프록시 사용)
          const content = await fetchM3u8WithRetry(this.m3u8Url);
          const { segments, targetDuration } = parseM3u8(content, this.baseUrl);

          // 새로운 세그먼트 다운로드
          for (const segment of segments) {
            if (!this.isRunning) break;
            if (segment.sequence <= this.lastSequence) continue;

            try {
              const segmentData = await this.downloadSegment(segment);
              this.downloadedSegments.push(segmentData);
              this.totalBytes += segmentData.byteLength;
              this.segmentCount++;
              this.lastSequence = segment.sequence;

              // 진행 상태 알림
              this.notifyBackground('DOWNLOAD_PROGRESS', this.getStatus());

              // 주기적 저장 체크
              if (Date.now() - this.lastSaveTime >= CONFIG.SAVE_INTERVAL ||
                  this.downloadedSegments.length >= CONFIG.SEGMENT_BUFFER_SIZE) {
                await this.saveCurrentBuffer();
              }
            } catch (error) {
              console.warn(`[HLS] 세그먼트 다운로드 실패:`, error.message);
            }
          }

          // 다음 갱신까지 대기
          await new Promise(r => setTimeout(r, CONFIG.PLAYLIST_REFRESH_INTERVAL));
        } catch (error) {
          console.error('[HLS] 플레이리스트 오류:', error.message);
          await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY));
        }
      }
    }

    async downloadSegment(segment) {
      // Background 프록시를 통해 세그먼트 다운로드
      return await fetchSegmentWithRetry(segment.url);
    }

    async saveCurrentBuffer() {
      if (this.downloadedSegments.length === 0) return;

      const combinedData = this.combineSegments(this.downloadedSegments);
      this.savedParts.push(combinedData);
      this.downloadedSegments = [];
      this.lastSaveTime = Date.now();

      console.log(`[HLS] 버퍼 저장: ${this.savedParts.length}번째 파트`);
    }

    combineSegments(segments) {
      const totalLength = segments.reduce((sum, s) => sum + s.byteLength, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const segment of segments) {
        combined.set(segment, offset);
        offset += segment.byteLength;
      }
      return combined;
    }

    async stop() {
      if (!this.isRunning) return null;

      this.isRunning = false;
      console.log(`[HLS] 다운로드 중지: ${this.streamerId}`);

      // 남은 세그먼트 저장
      if (this.downloadedSegments.length > 0) {
        await this.saveCurrentBuffer();
      }

      // 최종 파일 병합 및 저장
      const finalData = await this.finalize();
      return finalData;
    }

    async finalize() {
      if (this.savedParts.length === 0) {
        return null;
      }

      // 모든 파트 병합
      const totalLength = this.savedParts.reduce((sum, p) => sum + p.byteLength, 0);
      const finalData = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of this.savedParts) {
        finalData.set(part, offset);
        offset += part.byteLength;
      }

      const fileName = formatFileName(this.nickname, this.streamerId, this.startTime);

      // Blob 생성
      const blob = new Blob([finalData], { type: 'video/mp2t' });
      const url = URL.createObjectURL(blob);

      // Background에 다운로드 요청
      this.notifyBackground('DOWNLOAD_COMPLETE', {
        sessionId: this.sessionId,
        fileName,
        blobUrl: url,
        fileSize: totalLength,
        duration: Date.now() - this.startTime,
        segmentCount: this.segmentCount
      });

      return { fileName, fileSize: totalLength, blobUrl: url };
    }

    getStatus() {
      return {
        sessionId: this.sessionId,
        streamerId: this.streamerId,
        nickname: this.nickname,
        title: this.title,
        isRunning: this.isRunning,
        isBackgroundDownload: this.isBackgroundDownload,
        startTime: this.startTime,
        elapsedTime: Date.now() - this.startTime,
        totalBytes: this.totalBytes,
        segmentCount: this.segmentCount,
        quality: this.quality
      };
    }

    notifyBackground(type, data) {
      chrome.runtime.sendMessage({
        type: `OFFSCREEN_${type}`,
        data
      }).catch(() => {});
    }
  }

  // ===== 메시지 핸들러 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'START_HLS_DOWNLOAD':
            const session = new DownloadSession(message.options);
            downloadSessions.set(session.sessionId, session);
            session.start();
            sendResponse({ success: true, sessionId: session.sessionId });
            break;

          case 'STOP_HLS_DOWNLOAD':
            const sessionToStop = downloadSessions.get(message.sessionId);
            if (sessionToStop) {
              const result = await sessionToStop.stop();
              downloadSessions.delete(message.sessionId);
              sendResponse({ success: true, result });
            } else {
              sendResponse({ success: false, error: '세션을 찾을 수 없습니다.' });
            }
            break;

          case 'GET_ALL_DOWNLOAD_STATUS':
            const statuses = [];
            for (const [id, s] of downloadSessions) {
              statuses.push(s.getStatus());
            }
            sendResponse({ success: true, data: statuses });
            break;

          case 'GET_DOWNLOAD_STATUS':
            const targetSession = downloadSessions.get(message.sessionId);
            if (targetSession) {
              sendResponse({ success: true, data: targetSession.getStatus() });
            } else {
              sendResponse({ success: false, error: '세션을 찾을 수 없습니다.' });
            }
            break;

          default:
            sendResponse({ success: false, error: '알 수 없는 메시지' });
        }
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  });

  console.log('[숲토킹] Offscreen HLS 다운로드 엔진 로드됨');
})();
