'use strict';

//quiz_system.js에서 분리된 MultiplayerSessionMixin/MultiplayerLobbySession/MultiplayerQuizSession
//(REFACTOR_PLAN.md Phase 2)에 대한 회귀 방지 테스트. 실제 음성 연결은 만들지 않기 위해
//MultiplayerQuizSession(생성자에서 voice 연결을 만들지 않음)을 통해 Mixin 동작을 검증하고,
//MultiplayerLobbySession 고유 동작은 Object.create로 생성자를 우회해서 검증한다
//(REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const { MultiplayerLobbySession, MultiplayerQuizSession, MULTIPLAYER_STATE } = require('../../../quizbot/quiz_system/session/multiplayer_session.js');
const { CYCLE_TYPE } = require('../../../quizbot/quiz_system/constants.js');
const ipc_manager = require('../../../quizbot/managers/ipc_manager');

function makeFakeGuild()
{
  return { id: 'guild_1' };
}

function makeFakeOwner()
{
  return { id: 'owner_1', voice: { channel: { id: 'voice_channel_1' } } };
}

function makeMultiplayerQuizSession()
{
  return new MultiplayerQuizSession(makeFakeGuild(), makeFakeOwner(), { id: 'channel_1' }, {});
}

test('constructor: 멀티플레이 관련 초기 상태를 설정한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();

  assert.equal(quiz_session.is_multiplayer_session, true);
  assert.equal(quiz_session.isMultiplayerSession(), true);
  assert.equal(quiz_session.multiplayer_state, MULTIPLAYER_STATE.INITIALIZING);
});

test('isHostSession: session_id가 guild_id와 같으면 호스트다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.session_id = quiz_session.guild_id;

  assert.equal(quiz_session.isHostSession(), true);

  quiz_session.session_id = '다른_서버';
  assert.equal(quiz_session.isHostSession(), false);
});

test('isIngame: multiplayer_state가 LOBBY가 아니면 true다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();

  quiz_session.multiplayer_state = MULTIPLAYER_STATE.LOBBY;
  assert.equal(quiz_session.isIngame(), false);

  quiz_session.multiplayer_state = MULTIPLAYER_STATE.QUESTIONING;
  assert.equal(quiz_session.isIngame(), true);
});

test('getParticipant: guild_id로 참가자 정보를 찾는다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.participant_guilds_info = [
    { guild_id: 'guild_a', guild_name: 'A서버' },
    { guild_id: 'guild_b', guild_name: 'B서버' },
  ];

  assert.deepEqual(quiz_session.getParticipant('guild_b'), { guild_id: 'guild_b', guild_name: 'B서버' });
  assert.equal(quiz_session.getParticipant('없는_길드'), undefined);
});

test('sendSignal: 세션이 만료됐으면 신호를 보내지 않는다', (t) =>
{
  const send_mock = t.mock.method(ipc_manager, 'sendMultiplayerSignal', async () => ({ state: true }));
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.session_expired = true;

  quiz_session.sendSignal({ signal_type: 'TEST' });

  assert.equal(send_mock.mock.callCount(), 0);
});

test('sendSignal: 동기화 실패/퇴장 상태면 신호를 보내지 않는다', (t) =>
{
  const send_mock = t.mock.method(ipc_manager, 'sendMultiplayerSignal', async () => ({ state: true }));
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.sync_failed = true;

  quiz_session.sendSignal({ signal_type: 'TEST' });

  assert.equal(send_mock.mock.callCount(), 0);
});

test('sendSignal: 정상 상태면 guild_id/session_id를 채워 신호를 보낸다', (t) =>
{
  const send_mock = t.mock.method(ipc_manager, 'sendMultiplayerSignal', async () => ({ state: true }));
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.session_id = 'session_1';

  quiz_session.sendSignal({ signal_type: 'TEST' });

  assert.equal(send_mock.mock.callCount(), 1);
  assert.deepEqual(send_mock.mock.calls[0].arguments[0], {
    signal_type: 'TEST',
    guild_id: 'guild_1',
    session_id: 'session_1',
  });
});

test('onReceivedApplyQuestionList: 이미 다른 상태면 무시한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.multiplayer_state = MULTIPLAYER_STATE.QUESTIONING;
  quiz_session.quiz_data = {};

  quiz_session.onReceivedApplyQuestionList({ question_list: ['q1'], quiz_size: 30 });

  assert.equal(quiz_session.quiz_data.question_list, undefined);
});

test('onReceivedApplyQuestionList: 문제 목록이 비어있으면 강제 종료한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.quiz_data = {};
  let force_stop_called = false;
  quiz_session.forceStop = () => { force_stop_called = true; };
  quiz_session.sendMessage = () => {};

  quiz_session.onReceivedApplyQuestionList({ question_list: [], quiz_size: 0 });

  assert.equal(force_stop_called, true);
});

test('onReceivedApplyQuestionList: 정상적으로 받으면 상태를 QUESTION_LIST_READY로 바꾸고 PREPARE를 호출한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.quiz_data = {};
  let called_cycle_type = undefined;
  quiz_session.getCurrentCycle = () => ({ asyncCallCycle: (cycle_type) => { called_cycle_type = cycle_type; } });

  quiz_session.onReceivedApplyQuestionList({ question_list: Array(25).fill('q'), quiz_size: 25 });

  assert.equal(quiz_session.multiplayer_state, MULTIPLAYER_STATE.QUESTION_LIST_READY);
  assert.equal(called_cycle_type, CYCLE_TYPE.PREPARE);
});

test('onReceivedConfirmHint: 현재 cycle이 QUESTIONING이 아니면 무시한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.current_cycle_type = CYCLE_TYPE.EXPLAIN;
  let show_hint_called = false;
  quiz_session.getCurrentCycle = () => ({ showHint: () => { show_hint_called = true; } });

  quiz_session.onReceivedConfirmHint({});

  assert.equal(show_hint_called, false);
});

test('onReceivedHostChanged: session_id를 새 호스트로 갱신한다', () =>
{
  const quiz_session = makeMultiplayerQuizSession();
  quiz_session.session_id = 'old_host';
  quiz_session.sendMessage = () => {};

  quiz_session.onReceivedHostChanged({ session_id: 'new_host', new_host_guild_info: { guild_name: '새서버' } });

  assert.equal(quiz_session.session_id, 'new_host');
});

test('MultiplayerLobbySession.onReceivedStatedLobby: quiz_info가 없으면 전환하지 않는다', () =>
{
  //voice 연결을 만드는 생성자를 거치지 않기 위해 Object.create로 인스턴스만 만든다.
  const lobby = Object.create(MultiplayerLobbySession.prototype);
  lobby.guild_id = 'guild_1';
  let transit_called = false;
  lobby.transitToActiveQuizSession = () => { transit_called = true; };

  lobby.onReceivedStatedLobby({ session_id: 'session_1', lobby_info: {} });

  assert.equal(transit_called, false);
});
