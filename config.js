// ===== 숲토킹 v5.4.4 - 피처 플래그 설정 =====
// 새 기능을 안전하게 배포하기 위한 피처 플래그입니다.
// 문제 발생 시 해당 플래그를 false로 설정하여 즉시 비활성화할 수 있습니다.

export const FEATURES = {
  // 메시지 큐 활성화 (순서 보장)
  // true: 순서가 중요한 메시지(채팅, 분할 저장)를 큐에서 순차 처리
  // false: 기존 방식 (즉시 처리)
  useMessageQueue: false,

  // 디버그 로그 활성화
  // true: 메시지 큐 처리 상세 로그 출력
  // false: 로그 최소화
  messageQueueDebug: false
};

console.log('[숲토킹] 피처 플래그 로드됨:', FEATURES);
