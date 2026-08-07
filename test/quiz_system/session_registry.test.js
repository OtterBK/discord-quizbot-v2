'use strict';

//quiz_system.js에서 분리된 session_registry.js(REFACTOR_PLAN.md Phase 2 두 번째 슬라이스)가
//quiz_system.js의 exports 함수들과 여전히 같은 상태를 공유하는지 확인하는 회귀 방지 테스트.
//실제 디스코드 client/음성 채널 등은 만들지 않고, 필요한 메서드만 흉내 낸 가짜 세션 객체로 대체한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const session_registry = require('../../quizbot/quiz_system/session_registry');
const quiz_system = require('../../quizbot/quiz_system/quiz_system.js');
const { CUSTOM_EVENT_TYPE } = require('../../config/system_setting.js');

//각 테스트 사이에 registry 상태가 섞이지 않도록 초기화
function resetRegistry()
{
  session_registry.quiz_session_map = {};
  session_registry.bot_client = undefined;
}

test('initialize: client가 있으면 session_registry.bot_client에 저장하고 true를 반환한다', () =>
{
  resetRegistry();
  const fake_client = { id: 'fake_client' };

  const result = quiz_system.initialize(fake_client);

  assert.equal(result, true);
  assert.equal(session_registry.bot_client, fake_client);
});

test('initialize: client가 없으면 false를 반환하고 bot_client를 건드리지 않는다', () =>
{
  resetRegistry();

  const result = quiz_system.initialize(undefined);

  assert.equal(result, false);
  assert.equal(session_registry.bot_client, undefined);
});

test('getQuizSession/getLocalQuizSessionCount: session_registry.quiz_session_map을 그대로 조회한다', () =>
{
  resetRegistry();
  const fake_session = { guild_id: 'guild_1' };
  session_registry.quiz_session_map['guild_1'] = fake_session;

  assert.equal(quiz_system.getQuizSession('guild_1'), fake_session);
  assert.equal(quiz_system.getQuizSession('없는_길드'), undefined);
  assert.equal(quiz_system.getLocalQuizSessionCount(), 1);
});

test('getMultiplayerQuizSessionCount: isMultiplayerSession()이 true인 세션만 센다', () =>
{
  resetRegistry();
  session_registry.quiz_session_map['guild_1'] = { isMultiplayerSession: () => true };
  session_registry.quiz_session_map['guild_2'] = { isMultiplayerSession: () => false };
  session_registry.quiz_session_map['guild_3'] = { isMultiplayerSession: () => true };

  assert.equal(quiz_system.getMultiplayerQuizSessionCount(), 2);
});

test('relayMultiplayerSignal: 대상 guild_id에 해당하는 세션에게만 신호를 전달한다', () =>
{
  resetRegistry();
  const received = [];
  session_registry.quiz_session_map['guild_1'] = {
    on: (event_name, signal) => { received.push({ event_name, signal }); return true; },
  };

  const handled = quiz_system.relayMultiplayerSignal({ guild_ids: ['guild_1', '없는_길드'] });

  assert.equal(handled, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].event_name, CUSTOM_EVENT_TYPE.receivedMultiplayerSignal);
});

test('forceStopSession: 세션을 registry에서 제거하고 forceStop()을 호출한다', () =>
{
  resetRegistry();
  let force_stop_called = false;
  session_registry.quiz_session_map['guild_1'] = { forceStop: () => { force_stop_called = true; } };

  quiz_system.forceStopSession({ id: 'guild_1', members: { me: { voice: null } } });

  assert.equal(force_stop_called, true);
  assert.equal(session_registry.quiz_session_map.hasOwnProperty('guild_1'), false);
});

test('replaceSession: 기존 세션이 없으면 그냥 새 세션을 등록한다', () =>
{
  resetRegistry();
  const new_session = { name: 'new' };

  const result = session_registry.replaceSession('guild_1', new_session);

  assert.equal(result, new_session);
  assert.equal(session_registry.quiz_session_map['guild_1'], new_session);
});

test('replaceSession: 기존 세션이 있으면 free()로 정리하고 새 세션으로 교체한다', () =>
{
  resetRegistry();
  let old_session_freed = false;
  session_registry.quiz_session_map['guild_1'] = { free: () => { old_session_freed = true; } };
  const new_session = { name: 'new' };

  session_registry.replaceSession('guild_1', new_session);

  assert.equal(old_session_freed, true);
  assert.equal(session_registry.quiz_session_map['guild_1'], new_session);
});

test('startQuiz: MULTIPLAYER_LOBBY 세션이 실제 퀴즈로 전환될 때 상위 startQuiz를 거치지 않고도 registry가 교체된다', () =>
{
  //MultiplayerLobbySession.transitToActiveQuizSession()이 exports.startQuiz를 거치지 않고
  //session_registry.replaceSession을 직접 호출하도록 바꾼 부분에 대한 회귀 방지 테스트.
  //(discord.js voice 연결 등 무거운 의존성 때문에 실제 세션 생성자를 그대로 쓰지 못하므로,
  //여기서는 replaceSession이 세션 종류와 무관하게 정상 동작하는지만 확인한다.)
  resetRegistry();
  let lobby_freed = false;
  session_registry.quiz_session_map['guild_1'] = { free: () => { lobby_freed = true; } };
  const fake_multiplayer_quiz_session = { isMultiplayerSession: () => true };

  const result = session_registry.replaceSession('guild_1', fake_multiplayer_quiz_session);

  assert.equal(lobby_freed, true);
  assert.equal(result, fake_multiplayer_quiz_session);
  assert.equal(session_registry.quiz_session_map['guild_1'], fake_multiplayer_quiz_session);
});
