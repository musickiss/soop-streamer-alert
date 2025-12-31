// ===== 숲토킹 v3.0.1 - Offscreen Document =====
// Side Panel과 독립적으로 녹화 실행
// OPFS(Origin Private File System)에 실시간 저장

const OPFS_FOLDER = 'SOOPtalking';

// 활성 녹화 세션
const sessions = new Map();

// ===== OPFS 관련 함수 =====

async function getOpfsFolder() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_FOLDER, { create: true });
}

// ===== 코덱 선택 =====

function getBestMimeType() {
  const codecs = [
    { mime: 'video/webm;codecs=av1,opus', name: 'AV1' },
    { mime: 'video/webm;codecs=vp9,opus', name: 'VP9' },
    { mime: 'video/webm;codecs=vp8,opus', name: 'VP8' },
    { mime: 'video/webm', name: 'WebM' }
  ];

  for (const { mime, name } of codecs) {
    if (MediaRecorder.isTypeSupported(mime)) {
      console.log('[Offscreen] 코덱 선택:', name);
      return mime;
    }
  }
  return 'video/webm';
}

// ===== 녹화 시작 =====

async function startRecording(data) {
  const { tabId, streamerId, nickname, quality = {} } = data;
  const sessionId = crypto.randomUUID();

  console.log('[Offscreen] 녹화 시작 요청:', streamerId);

  try {
    // 화면 캡처 요청
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: quality.resolution === '1440p' ? 2560 : 1920 },
        height: { ideal: quality.resolution === '1440p' ? 1440 : 1080 },
        frameRate: { ideal: quality.frameRate || 30 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    // 시스템 오디오가 없으면 경고
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn('[Offscreen] 오디오 트랙 없음 - 시스템 오디오 공유 필요');
    }

    // 파일명 생성
    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const safeStreamerId = streamerId.replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
    const fileName = `soop_${safeStreamerId}_${timestamp}.webm`;

    // OPFS 파일 생성
    const folder = await getOpfsFolder();
    const fileHandle = await folder.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();

    // MediaRecorder 설정
    const mimeType = getBestMimeType();
    const videoBitrate = (quality.videoBitrate || 4000) * 1000;
    const audioBitrate = (quality.audioBitrate || 128) * 1000;

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
      audioBitsPerSecond: audioBitrate
    });

    // 세션 저장
    const session = {
      sessionId,
      tabId,
      streamerId,
      nickname,
      fileName,
      stream,
      recorder,
      writable,
      fileHandle,
      startTime: Date.now(),
      totalBytes: 0,
      mimeType
    };
    sessions.set(sessionId, session);

    // 데이터 수신 (5초마다)
    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        try {
          session.totalBytes += e.data.size;
          await writable.write(e.data);

          const elapsedTime = Math.floor((Date.now() - session.startTime) / 1000);

          // Background에 진행 상황 알림
          chrome.runtime.sendMessage({
            type: 'RECORDING_PROGRESS',
            sessionId,
            tabId,
            streamerId,
            nickname,
            totalBytes: session.totalBytes,
            elapsedTime
          }).catch(() => {});

        } catch (err) {
          console.error('[Offscreen] 데이터 쓰기 오류:', err);
        }
      }
    };

    // 녹화 중지 시
    recorder.onstop = async () => {
      console.log('[Offscreen] 녹화 중지됨:', streamerId);

      try {
        await writable.close();
        const duration = Math.floor((Date.now() - session.startTime) / 1000);

        // Background에 완료 알림 (다운로드는 Background에서 OPFS 직접 접근)
        chrome.runtime.sendMessage({
          type: 'RECORDING_STOPPED',
          sessionId,
          tabId,
          streamerId,
          nickname,
          fileName,
          totalBytes: session.totalBytes,
          duration
        }).catch(() => {});

      } catch (err) {
        console.error('[Offscreen] 녹화 종료 처리 오류:', err);
      }

      // 스트림 정리
      stream.getTracks().forEach(track => track.stop());
      sessions.delete(sessionId);
    };

    // 에러 핸들링
    recorder.onerror = (e) => {
      console.error('[Offscreen] MediaRecorder 에러:', e.error);
      chrome.runtime.sendMessage({
        type: 'RECORDING_ERROR',
        sessionId,
        tabId,
        streamerId,
        error: e.error?.message || '녹화 에러'
      }).catch(() => {});
    };

    // 화면 공유 종료 감지
    stream.getVideoTracks()[0].onended = () => {
      console.log('[Offscreen] 화면 공유 종료됨');
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    };

    // 녹화 시작
    recorder.start(5000); // 5초마다 데이터 청크

    console.log('[Offscreen] 녹화 시작됨:', sessionId);

    return { success: true, sessionId, fileName };

  } catch (error) {
    console.error('[Offscreen] 녹화 시작 실패:', error);

    if (error.name === 'NotAllowedError') {
      return { success: false, error: '화면 공유가 취소되었습니다' };
    }
    return { success: false, error: error.message };
  }
}

// ===== 녹화 중지 =====

async function stopRecording(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return { success: false, error: '세션을 찾을 수 없습니다' };
  }

  console.log('[Offscreen] 녹화 중지 요청:', sessionId);

  try {
    if (session.recorder.state !== 'inactive') {
      session.recorder.stop();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ===== 모든 녹화 중지 =====

async function stopAllRecordings() {
  const results = [];
  for (const [sessionId] of sessions) {
    const result = await stopRecording(sessionId);
    results.push({ sessionId, ...result });
  }
  return { success: true, results };
}

// ===== 녹화 상태 조회 =====

function getRecordingStatus() {
  return {
    success: true,
    recordings: Array.from(sessions.values()).map(s => ({
      sessionId: s.sessionId,
      tabId: s.tabId,
      streamerId: s.streamerId,
      nickname: s.nickname,
      fileName: s.fileName,
      totalBytes: s.totalBytes,
      elapsedTime: Math.floor((Date.now() - s.startTime) / 1000)
    }))
  };
}

// ===== 메시지 리스너 =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Offscreen] 메시지 수신:', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      startRecording(message).then(sendResponse);
      return true;

    case 'STOP_RECORDING':
      stopRecording(message.sessionId).then(sendResponse);
      return true;

    case 'STOP_ALL_RECORDINGS':
      stopAllRecordings().then(sendResponse);
      return true;

    case 'GET_RECORDING_STATUS':
      sendResponse(getRecordingStatus());
      return;  // 동기 응답

    case 'PING':
      sendResponse({ success: true, message: 'pong' });
      return;  // 동기 응답
  }
});

console.log('[Offscreen] 숲토킹 녹화 모듈 v3.0.1 로드됨');
