// ===== 숲토킹 v5.4.4 - DOM 선택자 설정 파일 =====
// SOOP UI 변경 시 이 파일만 수정하면 됩니다.
// chat-collector.js보다 먼저 로드됩니다.

(function() {
  'use strict';

  // SOOP 채팅창 DOM 선택자 (2025.01 기준)
  // 각 배열의 첫 번째 요소가 우선순위가 높습니다.
  window.SOOP_SELECTORS = {
    // 채팅 리스트 컨테이너
    chatContainer: [
      '#chat_area',
      '.chat_area'
    ],

    // 개별 채팅 아이템
    chatItem: [
      '.chatting-list-item'
    ],

    // 닉네임 요소 (button 내부의 .author)
    nickname: [
      '.author',
      '.username button[user_nick]',
      '[user_nick]'
    ],

    // 메시지 내용
    message: [
      '.msg',
      '.message-text p.msg',
      '.message-text'
    ],

    // 유저 ID 속성 (button에서 추출)
    userIdAttrs: [
      'user_id',
      'user_nick'
    ]
  };

  console.log('[숲토킹] 선택자 설정 로드됨 (selectors-config.js)');
})();
