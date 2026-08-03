'use strict';

//quiz_system.js에서 분리된 Initialize 계열(REFACTOR_PLAN.md Phase 2)에 대한 회귀 방지 테스트.
//REFACTOR_PLAN.md 2.4가 우선순위로 꼽은 "정답 채점/힌트 로직" 위주로 검증한다.
//quiz_session은 실제 디스코드 세션 대신 필요한 속성만 갖춘 가짜 객체로 대체.

const test = require('node:test');
const assert = require('node:assert/strict');

const { Initialize, InitializeUnknownQuiz } = require('../../../quizbot/quiz_system/lifecycle/initialize.js');
const option_system = require('../../../quizbot/quiz_option/quiz_option.js');
const OPTION_TYPE = option_system.OPTION_TYPE;
const utility = require('../../../utility/utility.js');

function makeFakeQuizSession(overrides = {})
{
  return {
    guild_id: 'guild_1',
    option_data: { quiz: { use_similar_answer: OPTION_TYPE.DISABLED } },
    ...overrides,
  };
}

test('generateAnswers: answers_row가 undefined면 빈 배열을 반환한다', () =>
{
  const cycle = new Initialize(makeFakeQuizSession());

  assert.deepEqual(cycle.generateAnswers(undefined), []);
});

test('generateAnswers: 공백/대소문자를 정규화하고 중복을 제거한다', () =>
{
  const cycle = new Initialize(makeFakeQuizSession());

  const answers = cycle.generateAnswers([' Apple ', 'apple', 'APPLE']);

  assert.deepEqual(answers, ['apple']);
});

test('generateAnswers: use_similar_answer가 DISABLED면 유사 정답(초성 앞글자 조합)을 추가하지 않는다', () =>
{
  const quiz_session = makeFakeQuizSession({ option_data: { quiz: { use_similar_answer: OPTION_TYPE.DISABLED } } });
  const cycle = new Initialize(quiz_session);

  const answers = cycle.generateAnswers(['Half Life']);

  assert.deepEqual(answers, ['halflife']);
});

test('generateAnswers: use_similar_answer가 ENABLED면 여러 단어 정답의 앞글자 조합을 추가로 인정한다', () =>
{
  const quiz_session = makeFakeQuizSession({ option_data: { quiz: { use_similar_answer: OPTION_TYPE.ENABLED } } });
  const cycle = new Initialize(quiz_session);

  const answers = cycle.generateAnswers(['Half Life']);

  assert.deepEqual(answers, ['halflife', 'hl']);
});

test('generateHint: 정답이 1글자면 전체를 가린 문자 하나만 반환한다', () =>
{
  const cycle = new Initialize(makeFakeQuizSession());

  assert.equal(cycle.generateHint('ㅁ'), '◼');
});

test('generateHint: HINT_PERCENTAGE 비율만큼 글자를 드러내고 나머지는 가린다', (t) =>
{
  let call_count = 0;
  t.mock.method(utility, 'getRandom', () => [0, 1][call_count++ % 2]); // 0번, 1번 인덱스만 드러나도록 고정

  const cycle = new Initialize(makeFakeQuizSession());

  const hint = cycle.generateHint('테스트'); // 3글자, HINT_PERCENTAGE=2 -> 2글자 노출

  assert.equal(hint, '테스◼');
});

test('InitializeUnknownQuiz.enter: 알 수 없는 퀴즈 타입이면 안내 메시지를 보내고 강제 종료한다', async () =>
{
  let sent_message = undefined;
  let force_stop_called = false;
  const quiz_session = makeFakeQuizSession({
    channel: { send: (message) => { sent_message = message; } },
    quiz_info: {},
  });
  const cycle = new InitializeUnknownQuiz(quiz_session);
  cycle.forceStop = () => { force_stop_called = true; };

  await cycle.enter();

  assert.ok(sent_message);
  assert.equal(force_stop_called, true);
});
