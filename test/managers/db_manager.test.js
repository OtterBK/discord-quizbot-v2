'use strict';

//db_manager.js에서 도메인별로 분리된 managers/db/*.js(REFACTOR_PLAN.md Phase 5)에 대한
//회귀 방지 테스트. 실제 DB 연결 없이 db_core.sendQuery를 mock 처리해 각 도메인 함수가
//만들어내는 쿼리 문자열/파라미터 형태(REFACTOR_PLAN.md 2.4, 외부 의존은 경계에서 mock)를 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const db_core = require('../../quizbot/managers/db/db_core');
const db_option = require('../../quizbot/managers/db/db_option');
const db_quiz = require('../../quizbot/managers/db/db_quiz');
const db_random_quiz_preset = require('../../quizbot/managers/db/db_random_quiz_preset');
const db_report = require('../../quizbot/managers/db/db_report');
const db_scoreboard = require('../../quizbot/managers/db/db_scoreboard');

test('db_manager.js: 도메인 파일들을 원본과 동일한 45개 이름으로 재수출한다', () =>
{
  // selectChatInfoById는 B-4(채팅 정지 사유 알림) 구현 중 신설됨 - 후속 조치(취소/추가처벌) 시점에
  // 원본 신고 채팅 내용을 다시 조회하기 위함 (tb_chat_info는 처리 후에도 row가 남아있음)
  // selectQuizInfoById는 퀴즈 선택 웹 연동(Phase 2) 구현 중 신설됨 - quiz_id 단건 조회가 기존엔 없었음
  // selectOwnedQuizInfoById는 퀴즈 만들기 웹 연동(Phase 3) 구현 중 신설됨 - is_private 필터 없이
  // creator_id로 소유권을 DB 레벨에서 강제하는 단건 조회(비공개 퀴즈도 본인이면 편집 가능해야 함)
  // updateOptionParameterized는 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) 중 신설됨 -
  // 서버 설정 웹 API 전용 파라미터화 쿼리(기존 updateOption은 문자열 직접 삽입, 디스코드 경로 그대로 유지)
  // db_random_quiz_preset(5개)은 랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md) 구현 중 신설됨
  // selectSeasonList/selectArchivedTop50Scoreboard/selectArchivedGuildScoreboard/endCurrentSeason은
  // 스코어보드 시즌 아카이브(docs/plans/SCOREBOARD_SEASON_PLAN.md) 구현 중 신설됨
  const expected_names = [
    'initialize',
    'executeQuery',
    ...Object.keys(db_option),
    ...Object.keys(db_quiz),
    ...Object.keys(db_random_quiz_preset),
    ...Object.keys(db_report),
    ...Object.keys(db_scoreboard),
  ].sort();

  const actual_names = Object.keys(db_manager).sort();

  assert.equal(actual_names.length, 45);
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

test('selectQuizInfoById: quiz_id를 파라미터로 넘기고 is_private=false 조건을 포함한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectQuizInfoById(42);

  assert.match(captured.query_string, /is_private = false and quiz_id = \$1/);
  assert.deepEqual(captured.values, [42]);
});

test('selectOwnedQuizInfoById: quiz_id/creator_id를 파라미터로 넘기고 is_private 필터 없이 creator_id 조건을 포함한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectOwnedQuizInfoById(42, 'user_1');

  assert.match(captured.query_string, /creator_id = \$2 and quiz_id = \$1/);
  assert.doesNotMatch(captured.query_string, /is_private/); //비공개 퀴즈도 본인이면 조회돼야 함
  assert.deepEqual(captured.values, [42, 'user_1']);
});

//2026-08-12(웹 API 보안 점검) - quiz_id_list를 문자열로 이어붙여 IN절에 직접 삽입하던 방식은
//SQL 인젝션 지점이었음(퀴즈 선택 웹 연동의 basket_items가 서버 검증 없이 여기까지 도달할 수 있었음).
//= ANY($1::int[]) 파라미터화로 교체됐는지 확인.
test('selectRandomQuestionListByBasket: quiz_id_list와 limit을 둘 다 파라미터로 넘긴다(문자열 보간 없음)', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectRandomQuestionListByBasket([1, 2, 3], 10);

  assert.match(captured.query_string, /WHERE quiz_id = ANY\(\$1::int\[\]\)/);
  assert.deepEqual(captured.values, [[1, 2, 3], 10]);
});

//2026-08-12(웹 API 보안 점검, 다음 세션 최우선 항목) - is_private/is_use 필터가 없어서, quiz_id만
//알면(순차 발급이라 열거 가능) 다른 유저의 비공개 퀴즈 문제가 그대로 출제될 수 있었음. 웹 API를
//프론트엔드 없이 직접 호출하는 경로(basket_items는 서버 검증 없이 quiz_id 정수 필터링만 거침)로
//도달 가능 - 짝 함수 selectRandomQuestionListByTags와 동일하게 is_private = false and is_use = true를
//요구하도록 수정됐는지 확인.
test('selectRandomQuestionListByBasket: 비공개(is_private) 또는 삭제된(is_use=false) 퀴즈를 걸러낸다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectRandomQuestionListByBasket([1, 2, 3], 10);

  assert.match(captured.query_string, /and is_private = false/);
  assert.match(captured.query_string, /and is_use = true/);
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

//스코어보드 시즌 아카이브(docs/plans/SCOREBOARD_SEASON_PLAN.md, 2026-08-15 신설) - db_scoreboard.ts 회귀 테스트.
test('selectSeasonList: 파라미터 없이 시즌 목록을 최신순으로 조회한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectSeasonList();

  assert.match(captured.query_string, /FROM tb_scoreboard_season/);
  assert.match(captured.query_string, /ORDER BY season_id DESC/);
  assert.deepEqual(captured.values, undefined);
});

test('selectArchivedTop50Scoreboard: season_id로 그 시즌의 상위 50개를 조회한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectArchivedTop50Scoreboard(3);

  assert.match(captured.query_string, /FROM tb_global_scoreboard_archive/);
  assert.match(captured.query_string, /WHERE season_id = \$1 AND mmr != 0/);
  assert.deepEqual(captured.values, [3]);
});

test('selectArchivedGuildScoreboard: season_id/guild_id로 그 시즌의 해당 길드 기록을 조회한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectArchivedGuildScoreboard(3, 'guild_1');

  assert.match(captured.query_string, /FROM tb_global_scoreboard_archive/);
  assert.match(captured.query_string, /WHERE season_id = \$1 AND guild_id = \$2/);
  assert.deepEqual(captured.values, [3, 'guild_1']);
});

test('endCurrentSeason: 시즌 행을 만들고 현재 스코어보드를 아카이브에 복사한 뒤 라이브 테이블을 비운다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    if(/INSERT INTO tb_scoreboard_season/.test(query_string))
    {
      return { rows: [{ season_id: 5 }] };
    }
    return { rows: [] };
  });

  const result = await db_manager.endCurrentSeason('3시즌');

  assert.deepEqual(result, { season_id: 5, season_name: '3시즌' });
  assert.equal(captured_queries.length, 3);
  assert.match(captured_queries[0].query_string, /INSERT INTO tb_scoreboard_season \(season_name\) VALUES \(\$1\)/);
  assert.deepEqual(captured_queries[0].values, ['3시즌']);
  assert.match(captured_queries[1].query_string, /INSERT INTO tb_global_scoreboard_archive/);
  assert.deepEqual(captured_queries[1].values, [5]);
  assert.match(captured_queries[2].query_string, /DELETE FROM tb_global_scoreboard/);
});

test('endCurrentSeason: 시즌 행 생성이 실패하면 undefined를 반환하고 아카이브/삭제는 시도하지 않는다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    return undefined;
  });

  const result = await db_manager.endCurrentSeason('3시즌');

  assert.equal(result, undefined);
  assert.equal(captured_queries.length, 1);
});

test('endCurrentSeason: 아카이브 복사가 실패하면 방금 만든 시즌 행을 정리하고 undefined를 반환한다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    if(/INSERT INTO tb_scoreboard_season/.test(query_string))
    {
      return { rows: [{ season_id: 5 }] };
    }
    if(/INSERT INTO tb_global_scoreboard_archive/.test(query_string))
    {
      return undefined; //아카이브 복사 실패
    }
    return { rows: [] };
  });

  const result = await db_manager.endCurrentSeason('3시즌');

  assert.equal(result, undefined);
  assert.equal(captured_queries.length, 3); //insert season -> insert archive(실패) -> 정리용 delete
  assert.match(captured_queries[2].query_string, /DELETE FROM tb_scoreboard_season WHERE season_id = \$1/);
  assert.deepEqual(captured_queries[2].values, [5]);
});

//랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md, 2026-08-13 신설) - db_random_quiz_preset.ts 회귀 테스트.
test('selectRandomQuizPresetsByUser: user_id로 조회하고 quiz_id_list를 sort_order 기준으로 집계한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.selectRandomQuizPresetsByUser('user_1');

  assert.match(captured.query_string, /where p\.user_id = \$1/);
  assert.match(captured.query_string, /array_agg\(i\.quiz_id order by i\.sort_order\)/);
  assert.deepEqual(captured.values, ['user_1']);
});

test('insertRandomQuizPreset: preset을 만든 뒤 quiz_id_list를 sort_order와 함께 일괄 삽입한다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    if(/insert into tb_random_quiz_preset \(/.test(query_string))
    {
      return { rows: [{ preset_id: 7 }] };
    }
    return { rows: [] };
  });

  const preset_id = await db_manager.insertRandomQuizPreset('user_1', '내 프리셋', [3, 1, 2], 10);

  assert.equal(preset_id, 7);
  assert.equal(captured_queries.length, 2);
  assert.match(captured_queries[0].query_string, /where \(select count\(\*\) from tb_random_quiz_preset where user_id = \$1\) < \$3/);
  assert.deepEqual(captured_queries[0].values, ['user_1', '내 프리셋', 10]);
  assert.match(captured_queries[1].query_string, /unnest\(\$2::int\[\]\) with ordinality/);
  assert.deepEqual(captured_queries[1].values, [7, [3, 1, 2]]);
});

//10개 제한이 순수 애플리케이션 레벨 체크(countRandomQuizPresetsByUser)에만 있으면, 두 요청이 거의
//동시에 들어올 때(API 직접 호출) 둘 다 "아직 9개"를 보고 통과해 제한을 넘길 수 있다(TOCTOU) - INSERT
//문 자체의 WHERE 절이 그 순간의 실제 개수를 다시 확인해서 이미 max_count에 도달했으면 0 row를
//반환하는지(=삽입 자체가 막히는지) 확인.
test('insertRandomQuizPreset: WHERE 절 조건에 걸려 0 row가 반환되면(이미 max_count 도달) undefined를 반환하고 item은 삽입하지 않는다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    return { rows: [] }; //WHERE 조건에 안 걸려 0 row
  });

  const preset_id = await db_manager.insertRandomQuizPreset('user_1', '내 프리셋', [1], 10);

  assert.equal(preset_id, undefined);
  assert.equal(captured_queries.length, 1); //preset insert가 막히면 item insert 자체를 시도하지 않음
});

test('insertRandomQuizPreset: 항목 삽입이 실패하면 방금 만든 preset을 삭제하고 undefined를 반환한다', async (t) =>
{
  const captured_queries = [];
  t.mock.method(db_core, 'sendQuery', async (query_string, values) =>
  {
    captured_queries.push({ query_string, values });
    if(/insert into tb_random_quiz_preset \(/.test(query_string))
    {
      return { rows: [{ preset_id: 7 }] };
    }
    if(/insert into tb_random_quiz_preset_item/.test(query_string))
    {
      return undefined; //item 삽입 실패
    }
    return { rows: [] };
  });

  const preset_id = await db_manager.insertRandomQuizPreset('user_1', '내 프리셋', [1]);

  assert.equal(preset_id, undefined);
  assert.equal(captured_queries.length, 3); //insert preset -> insert item(실패) -> 정리용 delete
  assert.match(captured_queries[2].query_string, /delete from tb_random_quiz_preset where preset_id = \$1/);
  assert.deepEqual(captured_queries[2].values, [7]);
});

test('deleteRandomQuizPreset: preset_id와 user_id를 둘 다 조건에 넣어 소유권을 강제한다', async (t) =>
{
  let captured = undefined;
  t.mock.method(db_core, 'sendQuery', async (query_string, values) => { captured = { query_string, values }; return undefined; });

  await db_manager.deleteRandomQuizPreset(7, 'user_1');

  assert.match(captured.query_string, /where preset_id = \$1 and user_id = \$2/);
  assert.deepEqual(captured.values, [7, 'user_1']);
});

test('sendQuery: is_initialized가 false면 실제 pool.query를 호출하지 않고 undefined를 반환한다', async () =>
{
  // db_core는 테스트 중 initialize()를 호출하지 않으므로 is_initialized는 항상 false다.
  const result = await db_core.sendQuery('select 1');
  assert.equal(result, undefined);
});
