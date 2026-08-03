'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//quiz_system.js의 거의 모든 클래스가 참조하는 상수라 별도 파일로 분리.
//값/주석은 원본과 동일 (동작 변경 없음).

exports.CYCLE_TYPE =
{
  UNDEFINED: 'UNDEFINED',
  INITIALIZING: 'INITIALIZING', //초기화 cycle
  EXPLAIN: 'EXPLAIN', //게임 설명 cycle
  PREPARE: 'PREPARE', //문제 제출 준비 중
  QUESTIONING: 'QUESTIONING', //문제 제출 중
  CORRECTANSWER: 'CORRECTANSWER', //정답 맞췄을 시
  TIMEOVER: 'TIMEOVER', //정답 못맞추고 제한 시간 종료 시
  CLEARING: 'CLEARING', //한 문제 끝날 때마다 호출, 음악 종료, 메시지 삭제 등
  ENDING: 'ENDING', //점수 발표
  FINISH: 'FINISH', //세션 정상 종료. 삭제 대기 중
  FORCEFINISH: 'FORCEFINISH', //세션 강제 종료. 삭제 대기 중
  HOLD: 'HOLD', //그냥 아무것도 안하고 홀딩
};

exports.QUIZ_SESSION_TYPE =
{
  NORMAL: 'NORMAL', //
  DUMMY: 'DUMMY', //
  MULTIPLAYER_LOBBY: 'MULTIPLAYER_LOBBY', //
  MULTIPLAYER: 'MULTIPLAYER', //
};
