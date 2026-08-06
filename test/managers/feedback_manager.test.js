'use strict';

//DB(db_manager)와 디스코드 interaction 객체를 경계에서 mock 처리해
//실제 DB 연결이나 디스코드 API 호출 없이 분기 로직을 검증한다 (REFACTOR_PLAN.md 2.4).
//feedback_manager 내부는 자기 자신을 `exports.xxx(...)`로 호출하는 패턴을 쓰고 있어서,
//exports에 걸린 함수를 t.mock.method로 바꿔치기하면 내부 호출도 함께 mock 처리된다.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const feedback_manager = require('../../quizbot/managers/feedback_manager');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');

//addQuizLike 내부에서 await 없이 이어지는 updateQuizLikeCount(...).then(...) 체인이
//끝날 시간을 벌어주기 위한 microtask/타이머 flush
function flushMicrotasks()
{
  return new Promise(resolve => setImmediate(resolve));
}

test('addQuizLike: quiz_id/guild_id/user_id 중 하나라도 없으면 false를 반환한다', async () =>
{
  assert.equal(await feedback_manager.addQuizLike(undefined, 'guild', 'user'), false);
  assert.equal(await feedback_manager.addQuizLike('quiz', undefined, 'user'), false);
  assert.equal(await feedback_manager.addQuizLike('quiz', 'guild', undefined), false);
});

test('addQuizLike: insert 결과가 없으면 false를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'insertLikeInfo', async () => undefined);

  assert.equal(await feedback_manager.addQuizLike('quiz', 'guild', 'user'), false);
});

test('addQuizLike: insert된 row가 0개면(이미 추천한 경우 등) false를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'insertLikeInfo', async () => ({ rowCount: 0 }));

  assert.equal(await feedback_manager.addQuizLike('quiz', 'guild', 'user'), false);
});

test('addQuizLike: insert가 성공하면 true를 반환하고 추천 수를 갱신한다', async (t) =>
{
  const insert_mock = t.mock.method(db_manager, 'insertLikeInfo', async () => ({ rowCount: 1 }));
  const update_mock = t.mock.method(db_manager, 'updateQuizLikeCount', async () => ({ rows: [{ like_count: 3 }] }));
  const certify_mock = t.mock.method(db_manager, 'certifyQuiz', async () => undefined);

  const result = await feedback_manager.addQuizLike('quiz_1', 'guild_1', 'user_1');
  await flushMicrotasks();

  assert.equal(result, true);
  assert.equal(insert_mock.mock.callCount(), 1);
  assert.equal(update_mock.mock.callCount(), 1);
  assert.equal(certify_mock.mock.callCount(), 0); // 3 < CERTIFY_LIKE_CRITERIA(10) 이므로 인증 안 함
});

test('addQuizLike: 추천 수가 인증 기준 이상이면 퀴즈를 자동 인증한다', async (t) =>
{
  t.mock.method(db_manager, 'insertLikeInfo', async () => ({ rowCount: 1 }));
  t.mock.method(db_manager, 'updateQuizLikeCount', async () => ({ rows: [{ like_count: SYSTEM_CONFIG.CERTIFY_LIKE_CRITERIA }] }));
  const certify_mock = t.mock.method(db_manager, 'certifyQuiz', async () => undefined);

  await feedback_manager.addQuizLike('quiz_1', 'guild_1', 'user_1');
  await flushMicrotasks();

  assert.equal(certify_mock.mock.callCount(), 1);
  assert.deepEqual(certify_mock.mock.calls[0].arguments, ['quiz_1', SYSTEM_CONFIG.CERTIFY_PLAYED_COUNT_CRITERIA]);
});

test('checkAlreadyLike: quiz_id/user_id 중 하나라도 없으면 false를 반환한다', async () =>
{
  assert.equal(await feedback_manager.checkAlreadyLike(undefined, 'user'), false);
  assert.equal(await feedback_manager.checkAlreadyLike('quiz', undefined), false);
});

test('checkAlreadyLike: 조회된 row가 없으면 false를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'selectLikeInfo', async () => ({ rows: [] }));

  assert.equal(await feedback_manager.checkAlreadyLike('quiz', 'user'), false);
});

test('checkAlreadyLike: 조회된 row가 있으면 true를 반환한다', async (t) =>
{
  t.mock.method(db_manager, 'selectLikeInfo', async () => ({ rows: [{ quiz_id: 'quiz' }] }));

  assert.equal(await feedback_manager.checkAlreadyLike('quiz', 'user'), true);
});

test('addQuizLikeAuto: 이미 추천한 경우 안내 메시지만 보내고 추천 로직은 실행하지 않는다', async (t) =>
{
  t.mock.method(feedback_manager, 'checkAlreadyLike', async () => true);
  const add_like_mock = t.mock.method(feedback_manager, 'addQuizLike', async () => true);

  const reply_calls = [];
  const fake_interaction = {
    guild: { id: 'guild_1' },
    user: { id: 'user_1' },
    reply: (payload) => { reply_calls.push(payload); },
  };

  await feedback_manager.addQuizLikeAuto(fake_interaction, 'quiz_1', '테스트 퀴즈');

  assert.equal(add_like_mock.mock.callCount(), 0);
  assert.equal(reply_calls.length, 1);
  assert.match(reply_calls[0].content, /이미.*추천했네요/);
});
