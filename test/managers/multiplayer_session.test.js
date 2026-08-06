'use strict';

//multiplayer_manager.js에서 분리된 MultiplayerSession(REFACTOR_PLAN.md Phase 3)에 대한
//회귀 방지 테스트. 실제 클러스터 브로드캐스트/DB는 mock 처리한다 (REFACTOR_PLAN.md 2.4).
//특히 changeHost()가 session_registry에 새 host_id로 재등록하는지는 이번 Phase에서
//직접 발견/수정한 버그(BUGS_FOUND.md 참고)라 명시적으로 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { MultiplayerSession, SESSION_STATE } = require('../../quizbot/managers/multiplayer_session.js');
const session_registry = require('../../quizbot/managers/multiplayer_session_registry.js');
const multiplayer_mmr = require('../../quizbot/managers/multiplayer_mmr');
const db_manager = require('../../quizbot/managers/db_manager.js');

function resetRegistry()
{
  session_registry.multiplayer_sessions = {};
}

test('constructor: 방장 정보로 초기 상태를 구성한다 (PREPARE 상태로 시작)', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', { title: '테스트 퀴즈' });

  assert.equal(session.getSessionId(), 'guild_1');
  assert.equal(session.getSessionHostId(), 'guild_1');
  assert.equal(session.getState(), SESSION_STATE.PREPARE);
  assert.equal(session.getParticipantCount(), 1);
  assert.equal(session.getOwnerGuildInfo().isReady(), true); // 방장은 처음부터 준비 완료
});

test('getAverageMMR: 참가자들의 평균 MMR을 반올림해서 반환한다', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.participant_guilds = [
    { stat: { mmr: 100 } },
    { stat: { mmr: 50 } },
    { stat: { mmr: 60 } },
  ];

  assert.equal(session.getAverageMMR(), 70); // (100+50+60)/3 = 70
});

test('checkBanned: 추방된 길드인지 확인한다', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.banned_guilds = ['guild_banned'];

  assert.equal(session.checkBanned('guild_banned'), true);
  assert.equal(session.checkBanned('guild_other'), false);
});

test('removeParticipant: 참가자를 목록에서 제거하고 제거된 정보를 반환한다', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  const second_guild_info = { guild_id: 'guild_2', guild_name: 'G2' };
  session.participant_guilds.push(second_guild_info);

  const removed = session.removeParticipant('guild_2');

  assert.equal(removed, second_guild_info);
  assert.equal(session.getParticipantCount(), 1);
  assert.equal(session.getParticipant('guild_2'), undefined);
});

test('getRequestConfirmCriteria: 과반수(절반+1) 인원을 기준으로 한다', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', {});

  session.participant_guilds = new Array(1);
  assert.equal(session.getRequestConfirmCriteria(), 1); // floor(1/2)+1 = 1

  session.participant_guilds = new Array(4);
  assert.equal(session.getRequestConfirmCriteria(), 3); // floor(4/2)+1 = 3

  session.participant_guilds = new Array(5);
  assert.equal(session.getRequestConfirmCriteria(), 3); // floor(5/2)+1 = 3
});

test('changeHost: session_registry에서 예전 host_id를 지우고 새 host_id로 재등록한다 (회귀 방지)', () =>
{
  resetRegistry();
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.sendSignal = () => {}; // 실제 브로드캐스트는 생략
  session_registry.multiplayer_sessions['guild_1'] = session;

  const new_host_guild_info = { guild_id: 'guild_2', guild_name: 'G2', toJsonObject: () => ({ guild_id: 'guild_2', guild_name: 'G2' }) };
  session.changeHost(new_host_guild_info);

  assert.equal(session.getSessionId(), 'guild_2');
  assert.equal(session_registry.multiplayer_sessions.hasOwnProperty('guild_1'), false);
  assert.equal(session_registry.multiplayer_sessions['guild_2'], session);
});

test('delete: registry에서 자신을 지우고 로비 수 갱신 신호를 보낸다', (t) =>
{
  resetRegistry();
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session_registry.multiplayer_sessions['guild_1'] = session;
  const lobby_count_mock = t.mock.method(session_registry, 'sendMultiplayerLobbyCount', () => {});

  session.delete();

  assert.equal(session_registry.multiplayer_sessions.hasOwnProperty('guild_1'), false);
  assert.equal(lobby_count_mock.mock.callCount(), 1);
});

test('calcWinnerMMR/calcLoserMMR: multiplayer_mmr.js에 인스턴스 상태를 그대로 위임한다', () =>
{
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.question_num = 29;
  session.scoreboard = new Map([['a', {}], ['b', {}]]); // size 2
  session.top_score = 100;

  const guild_info = { stat: { win: 5, lose: 5 } };

  const expected_winner = multiplayer_mmr.calcWinnerMMR(guild_info, 29, 2);
  const expected_loser = multiplayer_mmr.calcLoserMMR(guild_info, 50, 29, 100);

  assert.equal(session.calcWinnerMMR(guild_info), expected_winner);
  assert.equal(session.calcLoserMMR(guild_info, 50), expected_loser);
});

test('processWinner: db_manager.updateGlobalScoreboard를 승리 기록으로 호출한다', (t) =>
{
  const update_mock = t.mock.method(db_manager, 'updateGlobalScoreboard', async () => {});
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.question_num = 59;

  session.processWinner('guild_1');

  assert.equal(update_mock.mock.callCount(), 1);
  const args = update_mock.mock.calls[0].arguments;
  assert.equal(args[0], 'guild_1'); // guild_id
  assert.equal(args[1], 1); // win_add
  assert.equal(args[2], 0); // lose_add
  assert.equal(args[3], 1); // play_add
});

test('processLoser: db_manager.updateGlobalScoreboard를 패배 기록으로 호출한다', (t) =>
{
  const update_mock = t.mock.method(db_manager, 'updateGlobalScoreboard', async () => {});
  const session = new MultiplayerSession('guild_1', '테스트서버', {});
  session.question_num = 59;
  session.top_score = 100;

  session.processLoser('guild_1', 30);

  assert.equal(update_mock.mock.callCount(), 1);
  const args = update_mock.mock.calls[0].arguments;
  assert.equal(args[0], 'guild_1');
  assert.equal(args[1], 0); // win_add
  assert.equal(args[2], 1); // lose_add
  assert.equal(args[3], 1); // play_add
});
