'use strict';

//db_manager.js에서 도메인별로 분리된 managers/db/*.js(REFACTOR_PLAN.md Phase 5)에 대한
//회귀 방지 테스트. 실제 DB 연결 없이 db_core.sendQuery를 mock 처리해 각 도메인 함수가
//만들어내는 쿼리 문자열/파라미터 형태(REFACTOR_PLAN.md 2.4, 외부 의존은 경계에서 mock)를 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const db_core = require('../../quizbot/managers/db/db_core.js');
const db_option = require('../../quizbot/managers/db/db_option.js');
const db_quiz = require('../../quizbot/managers/db/db_quiz.js');
const db_report = require('../../quizbot/managers/db/db_report.js');
const db_scoreboard = require('../../quizbot/managers/db/db_scoreboard.js');

test('db_manager.js: 도메인 파일들을 원본과 동일한 32개 이름으로 재수출한다', () =>
{
  const expected_names = [
    'initialize',
    'executeQuery',
    ...Object.keys(db_option),
    ...Object.keys(db_quiz),
    ...Object.keys(db_report),
    ...Object.keys(db_scoreboard),
  ].sort();

  const actual_names = Object.keys(db_manager).sort();

  assert.equal(actual_names.length, 32);
  assert.deepEqual(actual_names, expected_names);
});

test('db_manager.js: sendQuery 자체는 재수출하지 않는다 (원본에 없던 export이므로)', () =>
{
  assert.equal(db_manager.sendQuery, undefined);
});

test('selectOption: guild_id/option_fields를 그대로 쿼리 문자열에 삽입한다', async (t) =>
{
  let captured_query = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string) => { captured_query = query_string; return undefined; });

  await db_manager.selectOption('123', 'audio_play_time, hint_type');

  assert.match(captured_query, /select audio_play_time, hint_type from tb_option/);
  assert.match(captured_query, /where guild_id = 123;/);
});

test('insertQuizInfo: value_fields 개수만큼 $1,$2... placeholder를 생성한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.insertQuizInfo('creator_id,quiz_title,tags_value', ['user_1', '제목', 5]);

  assert.match(captured.query_string, /values \(\$1,\$2,\$3\)/);
  assert.deepEqual(captured.values, ['user_1', '제목', 5]);
});

test('selectRandomQuestionListByBasket: basket_condition_query를 IN 절에 그대로 삽입하고 limit은 파라미터로 넘긴다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectRandomQuestionListByBasket('(1,2,3)', 10);

  assert.match(captured.query_string, /WHERE quiz_id IN \(1,2,3\)/);
  assert.deepEqual(captured.values, [10]);
});

test('selectRandomQuestionListByTags: certified_filter가 true면 certified 조건을 쿼리에 추가한다', async (t) =>
{
  let captured_with_filter = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string) => { captured_with_filter = query_string; return undefined; });
  await db_manager.selectRandomQuestionListByTags(1, 0, 10, true);
  assert.match(captured_with_filter, /and certified = true/);

  let captured_without_filter = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string) => { captured_without_filter = query_string; return undefined; });
  await db_manager.selectRandomQuestionListByTags(1, 0, 10, false);
  assert.doesNotMatch(captured_without_filter, /and certified = true/);
});

test('insertChatInfo: tb_chat_info에 chat_id 충돌 시 무시(ON CONFLICT DO NOTHING)한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.insertChatInfo('chat_id,content,sender_id,result', ['chat_1', '내용', 'user_1', 0]);

  assert.match(captured.query_string, /INSERT INTO tb_chat_info/);
  assert.match(captured.query_string, /ON CONFLICT \(chat_id\) DO NOTHING/);
  assert.deepEqual(captured.values, ['chat_1', '내용', 'user_1', 0]);
});

test('updateGlobalScoreboard: 6개 파라미터를 순서대로 넘긴다 (guild_id, win, lose, play, mmr, guild_name)', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.updateGlobalScoreboard('guild_1', 1, 0, 1, 25, '테스트길드');

  assert.match(captured.query_string, /INSERT INTO tb_global_scoreboard/);
  assert.deepEqual(captured.values, ['guild_1', 1, 0, 1, 25, '테스트길드']);
});

test('sendQuery: is_initialized가 false면 실제 pool.query를 호출하지 않고 undefined를 반환한다', async () =>
{
  // db_core는 테스트 중 initialize()를 호출하지 않으므로 is_initialized는 항상 false다.
  const result = await db_core.sendQuery('select 1');
  assert.equal(result, undefined);
});
