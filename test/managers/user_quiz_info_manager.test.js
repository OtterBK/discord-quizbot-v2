'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 2 - loadUserQuizInfoById 회귀 테스트.
//db_manager.selectQuizInfoById를 mock 처리해 DB 연결 없이 UserQuizInfo 조립 로직만 검증한다.
//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - loadOwnedUserQuizInfoById도 동일 관례로 추가.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const { loadUserQuizInfoById, loadOwnedUserQuizInfoById, UserQuizInfo } = require('../../quizbot/managers/user_quiz_info_manager');

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
