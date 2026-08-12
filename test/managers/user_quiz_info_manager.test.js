'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 2 - loadUserQuizInfoById 회귀 테스트.
//db_manager.selectQuizInfoById를 mock 처리해 DB 연결 없이 UserQuizInfo 조립 로직만 검증한다.
//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - loadOwnedUserQuizInfoById도 동일 관례로 추가.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const { loadUserQuizInfoById, loadOwnedUserQuizInfoById, loadQuestionListByBasket, UserQuizInfo } = require('../../quizbot/managers/user_quiz_info_manager');

test('loadUserQuizInfoById: quiz_id로 조회한 row를 UserQuizInfo로 조립한다', async (t) =>
{
  t.mock.method(db_manager, 'selectQuizInfoById', async (quiz_id) =>
  {
    assert.equal(quiz_id, 42);
    return { rows: [{ quiz_id: 42, quiz_title: '테스트 퀴즈', creator_id: 'user_1', tags_value: 5, is_private: false }] };
  });

  const user_quiz_info = await loadUserQuizInfoById(42);

  assert.ok(user_quiz_info instanceof UserQuizInfo);
  assert.equal(user_quiz_info.quiz_id, 42);
  assert.equal(user_quiz_info.data.quiz_title, '테스트 퀴즈');
  assert.equal(user_quiz_info.data.tags_value, 5);
});

test('loadUserQuizInfoById: 결과가 없으면 undefined를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'selectQuizInfoById', async () => ({ rows: [] }));

  const user_quiz_info = await loadUserQuizInfoById(999);

  assert.equal(user_quiz_info, undefined);
});

test('loadOwnedUserQuizInfoById: quiz_id/creator_id로 조회한 row를 UserQuizInfo로 조립한다', async (t) =>
{
  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async (quiz_id, creator_id) =>
  {
    assert.equal(quiz_id, 42);
    assert.equal(creator_id, 'user_1');
    return { rows: [{ quiz_id: 42, quiz_title: '비공개 퀴즈', creator_id: 'user_1', is_private: true }] };
  });

  const user_quiz_info = await loadOwnedUserQuizInfoById(42, 'user_1');

  assert.ok(user_quiz_info instanceof UserQuizInfo);
  assert.equal(user_quiz_info.quiz_id, 42);
  assert.equal(user_quiz_info.data.quiz_title, '비공개 퀴즈');
  assert.equal(user_quiz_info.data.is_private, true);
});

test('loadOwnedUserQuizInfoById: 결과가 없으면(다른 사람 퀴즈이거나 존재하지 않음) undefined를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({ rows: [] }));

  const user_quiz_info = await loadOwnedUserQuizInfoById(999, 'user_1');

  assert.equal(user_quiz_info, undefined);
});

//웹 API 보안 점검(2026-08-12, docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md) - 퀴즈 선택 웹
//연동(mode:omakase/multiplayer)의 basket_items가 서버 검증 없이 quiz_id_list까지 도달할 수 있어서,
//DB 호출부(selectRandomQuestionListByBasket)를 문자열 보간에서 파라미터화(ANY($1::int[]))로 바꿨다 -
//이 함수는 그 호출부가 배열을 그대로 전달하는지, 빈 배열이면 DB를 아예 안 부르는지만 확인한다(정수
//필터링 자체는 호출부인 initialize.ts OmakaseQuizInitialize의 책임).
test('loadQuestionListByBasket: quiz_id_list가 비어있으면 DB를 호출하지 않고 [0, []]를 반환한다', async (t) =>
{
  let called = false;
  t.mock.method(db_manager, 'selectRandomQuestionListByBasket', async () => { called = true; return { rows: [] }; });

  const [total_count, question_list] = await loadQuestionListByBasket([], 10);

  assert.equal(called, false);
  assert.equal(total_count, 0);
  assert.deepEqual(question_list, []);
});

test('loadQuestionListByBasket: quiz_id_list를 그대로 selectRandomQuestionListByBasket에 넘긴다', async (t) =>
{
  t.mock.method(db_manager, 'selectRandomQuestionListByBasket', async (quiz_id_list, limit) =>
  {
    assert.deepEqual(quiz_id_list, [1, 2, 3]);
    assert.equal(limit, 10);
    return { rows: [{ question_id: 7, quiz_id: 1, total_count: '1' }] };
  });

  const [total_count, question_list] = await loadQuestionListByBasket([1, 2, 3], 10);

  assert.equal(total_count, 1);
  assert.equal(question_list.length, 1);
  assert.equal(question_list[0].question_id, 7);
});
