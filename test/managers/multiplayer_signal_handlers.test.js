'use strict';

//multiplayer_manager.js에서 분리된 multiplayer_signal_handlers.js(REFACTOR_PLAN.md Phase 3)에
//대한 회귀 방지 테스트. CLIENT_SIGNAL 디스패치(onSignalReceived)와 대표적인 handle*들의
//요청/응답 형태(REFACTOR_PLAN.md 2.4, IPC 메시지 포맷은 Explore 서브에이전트로 사전 조사한
//표 기준)를 검증한다. 실제 클러스터 브로드캐스트는 mock 처리한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const signal_handlers = require('../../quizbot/managers/multiplayer_signal_handlers.js');
const session_registry = require('../../quizbot/managers/multiplayer_session_registry.js');
const { MultiplayerSession } = require('../../quizbot/managers/multiplayer_session.js');
const { CLIENT_SIGNAL, SERVER_SIGNAL } = require('../../quizbot/managers/multiplayer_signal.js');

function resetRegistry()
{
  session_registry.multiplayer_sessions = {};
  session_registry.setClusterManager({ broadcast: () => {} });
}

test('onSignalReceived: guild_id가 없으면 무시하고 undefined를 반환한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({ signal_type: CLIENT_SIGNAL.REQUEST_LOBBY_LIST });

  assert.equal(result, undefined);
});

test('onSignalReceived: 알 수 없는 signal_type이면 undefined를 반환한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({ signal_type: 0x77, guild_id: 'guild_1' });

  assert.equal(result, undefined);
});

test('onSignalReceived: CREATE_LOBBY 신호를 받으면 로비를 만들고 registry에 등록한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.CREATE_LOBBY,
    guild_id: 'guild_1',
    guild_name: '테스트서버',
    quiz_info: { title: '테스트 퀴즈' },
  });

  assert.equal(result.state, true);
  assert.equal(result.session_id, 'guild_1');
  assert.ok(session_registry.multiplayer_sessions['guild_1'] instanceof MultiplayerSession);
});

test('onSignalReceived: CREATE_LOBBY에 quiz_info가 없으면 실패를 반환한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.CREATE_LOBBY,
    guild_id: 'guild_1',
    guild_name: '테스트서버',
  });

  assert.equal(result.state, false);
});

test('onSignalReceived: JOIN_LOBBY - 존재하지 않는 세션이면 실패를 반환한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.JOIN_LOBBY,
    guild_id: 'guild_2',
    session_id: '없는_세션',
    guild_name: '참가서버',
  });

  assert.equal(result.state, false);
});

test('onSignalReceived: JOIN_LOBBY - 이미 게임 중인 세션이면 거부한다', () =>
{
  resetRegistry();
  const session = new MultiplayerSession('guild_1', '호스트서버', { title: '테스트' });
  session.state = 2; // SESSION_STATE.INGAME (multiplayer_session.js와 값 동일)
  session_registry.multiplayer_sessions['guild_1'] = session;

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.JOIN_LOBBY,
    guild_id: 'guild_2',
    session_id: 'guild_1',
    guild_name: '참가서버',
  });

  assert.equal(result.state, false);
  assert.match(result.reason, /이미 퀴즈가 시작/);
});

test('onSignalReceived: JOIN_LOBBY - 추방된 서버는 재입장할 수 없다', () =>
{
  resetRegistry();
  const session = new MultiplayerSession('guild_1', '호스트서버', { title: '테스트' });
  session.state = 1; // SESSION_STATE.LOBBY
  session.banned_guilds = ['guild_2'];
  session_registry.multiplayer_sessions['guild_1'] = session;

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.JOIN_LOBBY,
    guild_id: 'guild_2',
    session_id: 'guild_1',
    guild_name: '참가서버',
  });

  assert.equal(result.state, false);
  assert.match(result.reason, /추방/);
});

test('onSignalReceived: LEAVE_LOBBY - 존재하지 않는 세션이면 실패를 반환한다', () =>
{
  resetRegistry();

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.LEAVE_LOBBY,
    guild_id: 'guild_2',
    session_id: '없는_세션',
  });

  assert.equal(result.state, false);
});

test('onSignalReceived: REQUEST_LOBBY_LIST - PREPARE 상태(초기화 대기 중)인 로비는 목록에서 제외한다', () =>
{
  resetRegistry();
  const preparing_session = new MultiplayerSession('guild_1', '호스트서버', { title: '테스트' });
  // 기본 상태가 PREPARE이므로 그대로 둠 (생성자가 1초 뒤 LOBBY로 바꾸지만 테스트 중엔 아직 PREPARE)
  session_registry.multiplayer_sessions['guild_1'] = preparing_session;

  const result = signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.REQUEST_LOBBY_LIST,
    guild_id: 'guild_2',
  });

  assert.deepEqual(result, []);
});

test('onSignalReceived: 브로드캐스트되는 서버 신호는 signal_type을 그대로 유지한다', (t) =>
{
  resetRegistry();
  const broadcasted = [];
  session_registry.setClusterManager({ broadcast: (msg) => broadcasted.push(msg) });

  signal_handlers.onSignalReceived({
    signal_type: CLIENT_SIGNAL.CREATE_LOBBY,
    guild_id: 'guild_1',
    guild_name: '테스트서버',
    quiz_info: { title: '테스트 퀴즈' },
  });

  // CREATE_LOBBY는 성공 시 sendMultiplayerLobbyCount()로 UPDATED_LOBBY_COUNT를 broadcast함
  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].signal.signal_type, SERVER_SIGNAL.UPDATED_LOBBY_COUNT);
});
