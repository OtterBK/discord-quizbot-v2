'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//guild_id별 활성 퀴즈 세션과 bot_client 참조는 quiz_system.js 안의 여러 클래스와
//exports 함수가 함께 읽고 쓰는 공유 가변 상태였다. quiz_system.js를 여러 파일로
//쪼개기 전에, 이 상태를 한 곳에서 소유하는 모듈로 먼저 분리해둔다 (동작 변경 없음).

exports.quiz_session_map = {};
exports.bot_client = undefined;
