'use strict';

//multiplayer_manager.js에서 분리된 MultiplayerGuildInfo(REFACTOR_PLAN.md Phase 3)에 대한
//회귀 방지 테스트. DB 접근은 db_manager.selectGlobalScoreboard를 mock 처리해 대신한다
//(REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const MultiplayerGuildInfo = require('../../quizbot/managers/multiplayer_guild_info.js');
const db_manager = require('../../quizbot/managers/db_manager.js');

test('constructor: 초기 상태를 설정한다', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');

  assert.equal(guild_info.guild_id, 'guild_1');
  assert.equal(guild_info.guild_name, '테스트서버');
  assert.equal(guild_info.ready, false);
  assert.deepEqual(guild_info.stat, { win: 0, lose: 0, play: 0, mmr: 0 });
});

test('toJsonObject: IPC로 내보낼 필드만 뽑아낸다 (syncing/hint/skip은 제외)', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');
  guild_info.setSyncState(true);
  guild_info.requestHint();

  const json = guild_info.toJsonObject();

  assert.deepEqual(json, {
    guild_id: 'guild_1',
    guild_name: '테스트서버',
    member_count: 0,
    stat: { win: 0, lose: 0, play: 0, mmr: 0 },
    ready: false,
  });
  assert.equal(json.syncing, undefined);
  assert.equal(json.hint, undefined);
});

test('requestHint/requestSkip: 한 번만 성공하고, 이미 요청됐으면 false를 반환한다', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');

  assert.equal(guild_info.requestHint(), true);
  assert.equal(guild_info.requestHint(), false); // 이미 요청함
  assert.equal(guild_info.isHintRequested(), true);

  assert.equal(guild_info.requestSkip(), true);
  assert.equal(guild_info.requestSkip(), false);
});

test('resetRequestState: 힌트/스킵 요청 상태를 초기화한다', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');
  guild_info.requestHint();
  guild_info.requestSkip();

  guild_info.resetRequestState();

  assert.equal(guild_info.isHintRequested(), false);
  assert.equal(guild_info.isSkipRequested(), false);
});

test('setGuildState: guild_state가 없으면 무시하고, 있으면 member_count를 반영한다', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');

  guild_info.setGuildState(undefined);
  assert.equal(guild_info.getMemberCount(), 0);

  guild_info.setGuildState({ member_count: 5 });
  assert.equal(guild_info.getMemberCount(), 5);
});

test('loadStat: 기존 기록이 있으면 stat을 갱신한다', async (t) =>
{
  t.mock.method(db_manager, 'selectGlobalScoreboard', async () => ({
    rowCount: 1,
    rows: [{ win: 3, lose: 1, play: 4, mmr: 120 }],
  }));

  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');
  const result = await guild_info.loadStat();

  assert.equal(result, guild_info);
  assert.deepEqual(guild_info.stat, { win: 3, lose: 1, play: 4, mmr: 120 });
});

test('loadStat: 기록이 없으면 기본값을 유지한다', async (t) =>
{
  t.mock.method(db_manager, 'selectGlobalScoreboard', async () => ({ rowCount: 0, rows: [] }));

  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');
  const result = await guild_info.loadStat();

  assert.equal(result, guild_info);
  assert.deepEqual(guild_info.stat, { win: 0, lose: 0, play: 0, mmr: 0 });
});

test('loadStat: DB 조회가 실패하면 undefined를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'selectGlobalScoreboard', async () => { throw new Error('DB 연결 실패'); });

  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');
  const result = await guild_info.loadStat();

  assert.equal(result, undefined);
});

test('setReady/isReady: 준비 상태를 설정하고 조회한다', () =>
{
  const guild_info = new MultiplayerGuildInfo('guild_1', '테스트서버');

  assert.equal(guild_info.isReady(), false);
  guild_info.setReady(true);
  assert.equal(guild_info.isReady(), true);
});
