'use strict';

//report_manager.js에서 분리된 managers/report/*.js(REFACTOR_PLAN.md Phase 5)에 대한
//회귀 방지 테스트. DB(db_manager)와 디스코드 client/interaction 객체를 경계에서 mock
//처리한다(REFACTOR_PLAN.md 2.4). 특히 원본에서 bot_client가 모듈 최상위 변수였다가
//분리 과정에서 report_state.js의 getClient()/setClient()로 재배선된 부분과, 여러 파일에
//흩어진 REPORT_PROCESSED_RESULT_TYPE/FOLLOWUP_PROCESSED_RESULT_TYPE enum 참조가
//report_chat_info.js를 통해 정상적으로 공유되는지를 중점적으로 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const report_manager = require('../../quizbot/managers/report_manager.js');
const report_state = require('../../quizbot/managers/report/report_state.js');
const report_chat_info = require('../../quizbot/managers/report/report_chat_info.js');
const chat_cache = require('../../quizbot/managers/report/chat_cache.js');
const report_processing_core = require('../../quizbot/managers/report/report_processing_core.js');
const report_manual_processing = require('../../quizbot/managers/report/report_manual_processing.js');
const db_manager = require('../../quizbot/managers/db_manager.js');
const multiplayer_ban_manager = require('../../quizbot/managers/multiplayer_ban_manager.js');

test('report_manager.js: 원본과 동일하게 initialize/checkReportEvent 2개만 재수출한다', () =>
{
  assert.deepEqual(Object.keys(report_manager).sort(), ['checkReportEvent', 'initialize']);
});

test('report_state: setClient으로 넣은 client를 getClient로 그대로 돌려받는다', () =>
{
  const fake_client = { tag: 'fake_bot' };
  report_state.setClient(fake_client);

  assert.equal(report_state.getClient(), fake_client);
});

test('chat_cache.insertChatCache: 같은 chat_id로 재호출하면 cached_time이 실제로 갱신된다 (BUGS_FOUND.md Phase 5 회귀 테스트)', (t) =>
{
  // Date.now를 mock해서 시간 흐름을 통제한다.
  // 버그 상황(getChatCacheContent의 반환값=문자열에 cached_time을 대입)이었다면
  // 재호출로 cached_time이 갱신되지 않아, t=0 기준 5분 경과 시 지워졌을 것이다.
  let mocked_now = 0;
  t.mock.method(Date, 'now', () => mocked_now);

  chat_cache.insertChatCache('bug-regress-1', '원본 내용'); //t=0에 최초 캐싱

  mocked_now = 200000; //3분 20초 후, 아직 5분 안 지남
  chat_cache.insertChatCache('bug-regress-1', '원본 내용'); //재호출: cached_time을 200000으로 갱신하는 게 의도

  mocked_now = 450000; //t=0 기준으로는 5분(300000ms) 지났지만, 갱신된 t=200000 기준으로는 아직 5분 안 지남
  chat_cache.cleanUpChatCache();

  assert.equal(chat_cache.getChatCacheContent('bug-regress-1'), '원본 내용'); //버그였다면 여기서 undefined가 됐을 것
});

test('report_chat_info.getChatId: chat_report_/modal_chat_report_ 접두어를 제거하고, 둘 다 아니면 undefined다', () =>
{
  assert.equal(report_chat_info.getChatId('chat_report_guild1-user1-1000'), 'guild1-user1-1000');
  assert.equal(report_chat_info.getChatId('modal_chat_report_guild1-user1-1000'), 'guild1-user1-1000');
  assert.equal(report_chat_info.getChatId('back'), undefined);
});

test('report_chat_info.extractChatInfo: guild_id-user_id-timestamp 형식이 아니면 undefined다', () =>
{
  assert.deepEqual(report_chat_info.extractChatInfo('guild1-user1-1000'), {
    guild_id: 'guild1',
    user_id: 'user1',
    timestamp: '1000',
  });
  assert.equal(report_chat_info.extractChatInfo('invalid_format'), undefined);
});

test('checkReportEvent: chat_report_ 버튼이면 신고 모달을 띄우고 true를 반환한다', () =>
{
  chat_cache.insertChatCache('guild1-user1-1000', '원본 채팅');

  let shown_modal = undefined;
  const interaction = {
    isButton: () => true,
    isModalSubmit: () => false,
    isCommand: () => false,
    customId: 'chat_report_guild1-user1-1000',
    message: { content: '원본 채팅' },
    showModal: (modal) => { shown_modal = modal; },
  };

  const result = report_manager.checkReportEvent(interaction);

  assert.equal(result, true);
  assert.equal(interaction.explicit_replied, true);
  assert.ok(shown_modal !== undefined);
  assert.equal(shown_modal.data.custom_id, 'modal_chat_report_guild1-user1-1000');
});

test('checkReportEvent: modal_chat_report_ 제출이면 chat_info/content 캐시가 있어야 접수 처리된다', (t) =>
{
  t.mock.method(db_manager, 'insertChatInfo', async () => undefined);
  t.mock.method(db_manager, 'insertReportInfo', async () => undefined);
  // PRIVATE_CONFIG.ADMIN_ID가 설정돼 있으면 report_state.getClient().users.fetch(...)까지 타므로 미리 채워둔다.
  report_state.setClient({ users: { fetch: async () => undefined } });

  chat_cache.insertChatCache('guild1-user1-2000', '신고 대상 채팅');

  let replied_with = undefined;
  const interaction = {
    isButton: () => false,
    isModalSubmit: () => true,
    isCommand: () => false,
    customId: 'modal_chat_report_guild1-user1-2000',
    user: { id: 'reporter_1' },
    fields: { getTextInputValue: () => '신고 사유' },
    reply: (opts) => { replied_with = opts; },
  };

  const result = report_manager.checkReportEvent(interaction);

  assert.equal(result, true);
  assert.match(replied_with.content, /신고가 접수되었습니다/);
});

test('checkReportEvent: modal_chat_report_ 제출인데 캐시가 없으면 실패 메시지를 응답한다', () =>
{
  let replied_with = undefined;
  const interaction = {
    isButton: () => false,
    isModalSubmit: () => true,
    isCommand: () => false,
    customId: 'modal_chat_report_없는-캐시-3000',
    user: { id: 'reporter_1' },
    fields: { getTextInputValue: () => '신고 사유' },
    reply: (opts) => { replied_with = opts; },
  };

  const result = report_manager.checkReportEvent(interaction);

  assert.equal(result, true);
  assert.match(replied_with.content, /신고에 실패했습니다/);
});

test('checkReportEvent: 신고 관련 이벤트가 아니면 undefined를 반환한다', () =>
{
  const interaction = { isButton: () => false, isModalSubmit: () => false, isCommand: () => false };

  assert.equal(report_manager.checkReportEvent(interaction), undefined);
});

test('report_processing_core.processReportCore: DENY면 ban 처리 없이 [null, deleted_log]를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'updateChatInfoResult', async () => undefined);
  t.mock.method(db_manager, 'deleteReportedLog', async () => ({ rowCount: 1, rows: [{ reporter_id: 'r1' }] }));
  t.mock.method(db_manager, 'selectBanHistory', async () => { throw new Error('DENY 처리에서는 밴 조회가 발생하면 안 된다'); });

  const [ban_history, deleted_log] = await report_processing_core.processReportCore('g1-u1-1000', report_chat_info.REPORT_PROCESSED_RESULT_TYPE.DENY);

  assert.equal(ban_history, null);
  assert.equal(deleted_log.rowCount, 1);
});

test('report_processing_core.applyBan: 기존 밴 이력이 없으면 count부터 새로 시작해 3제곱 일수만큼 제재한다', async (t) =>
{
  t.mock.method(db_manager, 'selectBanHistory', async () => ({ rowCount: 0 }));
  t.mock.method(db_manager, 'updateBanHistory', async () => undefined);

  const before = Date.now();
  const ban_history = await report_processing_core.applyBan('user_1', 1);

  assert.equal(ban_history.ban_count, 1);
  // 1일(24*60*60*1000) * (1^3)
  assert.ok(ban_history.ban_expiration_timestamp >= before + 24 * 60 * 60 * 1000);
});

test('report_manual_processing.processFollowUpAction: ps_flwup_guild_ban_이면 report_state의 client로 guild를 조회하고 multiplayer_ban_manager로 밴한다 (실제 banned_user.txt는 건드리지 않는다)', async (t) =>
{
  t.mock.method(multiplayer_ban_manager, 'banGuild', () => true);

  let fetched_guild_id = undefined;
  const fake_client = {
    guilds: {
      fetch: async (guild_id) => { fetched_guild_id = guild_id; return { id: guild_id, name: '테스트길드' }; },
    },
  };
  report_state.setClient(fake_client);

  let replied_with = undefined;
  const interaction = {
    customId: 'ps_flwup_guild_ban_guild9-user9-9000',
    reply: (opts) => { replied_with = opts; },
  };

  await report_manual_processing.processFollowUpAction(interaction);

  assert.equal(fetched_guild_id, 'guild9');
  assert.ok(replied_with !== undefined);
  assert.match(replied_with.content, /banned/);
});
