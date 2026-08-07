'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//guild_id별 활성 퀴즈 세션과 bot_client 참조는 quiz_system.js 안의 여러 클래스와
//exports 함수가 함께 읽고 쓰는 공유 가변 상태였다. quiz_system.js를 여러 파일로
//쪼개기 전에, 이 상태를 한 곳에서 소유하는 모듈로 먼저 분리해둔다 (동작 변경 없음).

const quiz_session_map: Record<string, any> = {};
const bot_client: any = undefined;

exports.quiz_session_map = quiz_session_map;
exports.bot_client = bot_client;

//기존 세션이 있으면 free() 하고 새 세션으로 교체 등록한다.
//quiz_system.js의 startQuiz(범용 팩토리)와, MultiplayerLobbySession이 실제 퀴즈
//세션으로 전환할 때(같은 파일 내 형제 클래스를 직접 생성) 양쪽에서 공통으로 쓰는
//로직이라 여기로 뽑아둔다 - 상위 facade를 거치지 않고도 registry 교체가 가능해야
//나중에 클래스들을 파일로 쪼갤 때 순환참조가 생기지 않는다.
exports.replaceSession = (guild_id: string, new_session: any): any =>
{
  if(exports.quiz_session_map.hasOwnProperty(guild_id))
  {
    const prev_quiz_session = exports.quiz_session_map[guild_id];
    prev_quiz_session.free();
  }

  exports.quiz_session_map[guild_id] = new_session;

  return new_session;
};
