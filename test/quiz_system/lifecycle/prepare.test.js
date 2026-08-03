'use strict';

//quiz_system.js에서 분리된 Prepare(REFACTOR_PLAN.md Phase 2)에 대한 회귀 방지 테스트.
//실제 오디오 다운로드/스트림 생성은 만들지 않고, 순수 계산 로직(오디오 자르기 시작 지점
//산출, 이미지/텍스트 문제 가공)과 enter/act의 상태 전이 조건 위주로 검증한다
//(REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const Prepare = require('../../../quizbot/quiz_system/lifecycle/prepare.js');
const { QUIZ_TYPE } = require('../../../config/system_setting.js');
const utility = require('../../../utility/utility.js');

function makeFakeQuizSession(overrides = {})
{
  return {
    guild_id: 'guild_1',
    force_stop: false,
    game_data: { question_num: -1, prepared_question_queue: [] },
    quiz_data: { question_list: [] },
    hasMoreQuestion: () => true,
    isMultiplayerSession: () => false,
    ...overrides,
  };
}

test('refineAudioPoints: 중간 범위로 좁힐 수 있으면 좁혀서 반환한다', () =>
{
  const cycle = new Prepare(makeFakeQuizSession());

  const result = cycle.refineAudioPoints(0, 100, 10); // mid=50, half=5 -> [45, 55], 0<45 && 55<100 이므로 좁혀짐

  assert.deepEqual(result, { audio_min_start_point: 45, audio_max_start_point: 55 });
});

test('refineAudioPoints: 좁히면 오히려 범위를 벗어나면 원래 값을 그대로 반환한다', () =>
{
  const cycle = new Prepare(makeFakeQuizSession());

  const result = cycle.refineAudioPoints(40, 60, 100); // mid=50, half=50 -> [0, 100], 40<0 아님 -> 실패

  assert.deepEqual(result, { audio_min_start_point: 40, audio_max_start_point: 60 });
});

test('getRandomAudioStartPoint: 재생 가능한 시작 지점이 없으면 최소값을 그대로 반환한다', () =>
{
  const cycle = new Prepare(makeFakeQuizSession());

  const result = cycle.getRandomAudioStartPoint(50, 40, 10, false); // max <= min

  assert.equal(result, 50);
});

test('getRandomAudioStartPoint: use_improved_audio_cut이 true면 좁혀진 범위 안에서 랜덤 값을 뽑는다', (t) =>
{
  const random_calls = [];
  t.mock.method(utility, 'getRandom', (min, max) => { random_calls.push([min, max]); return min; });

  const cycle = new Prepare(makeFakeQuizSession());
  cycle.getRandomAudioStartPoint(0, 100, 10, true); // mid=50, half=5 -> [45, 55]

  assert.deepEqual(random_calls[0], [45, 55]);
});

test('getRandomAudioStartPoint: use_improved_audio_cut이 false면 원래 범위 그대로 랜덤 값을 뽑는다', (t) =>
{
  const random_calls = [];
  t.mock.method(utility, 'getRandom', (min, max) => { random_calls.push([min, max]); return min; });

  const cycle = new Prepare(makeFakeQuizSession());
  cycle.getRandomAudioStartPoint(0, 100, 10, false);

  assert.deepEqual(random_calls[0], [0, 100]);
});

test('prepareImage: IMAGE_LONG 타입이면 is_long을 true로 설정한다', async () =>
{
  const cycle = new Prepare(makeFakeQuizSession());
  const target_question = { question: '/path/to/image.png', type: QUIZ_TYPE.IMAGE_LONG };

  await cycle.prepareImage(target_question);

  assert.equal(target_question.image_resource, '/path/to/image.png');
  assert.equal(target_question.is_long, true);
});

test('prepareImage: 일반 IMAGE 타입이면 is_long을 false로 설정한다', async () =>
{
  const cycle = new Prepare(makeFakeQuizSession());
  const target_question = { question: '/path/to/image.png', type: QUIZ_TYPE.IMAGE };

  await cycle.prepareImage(target_question);

  assert.equal(target_question.is_long, false);
});

test('prepareText: 문제 텍스트를 줄바꿈으로 감싸고 TEXT_LONG/OX_LONG이면 is_long을 true로 설정한다', async () =>
{
  const cycle = new Prepare(makeFakeQuizSession());
  const target_question = { question: '정답이 뭘까요?', type: QUIZ_TYPE.TEXT_LONG };

  await cycle.prepareText(target_question);

  assert.equal(target_question.question, ' \n정답이 뭘까요? \n');
  assert.equal(target_question.is_long, true);
});

test('prepareText: 일반 TEXT 타입이면 is_long을 false로 설정한다', async () =>
{
  const cycle = new Prepare(makeFakeQuizSession());
  const target_question = { question: '정답이 뭘까요?', type: QUIZ_TYPE.TEXT };

  await cycle.prepareText(target_question);

  assert.equal(target_question.is_long, false);
});

test('enter: 더 낼 문제가 없으면 skip_prepare를 true로 설정한다', async () =>
{
  const quiz_session = makeFakeQuizSession({ hasMoreQuestion: () => false });
  const cycle = new Prepare(quiz_session);

  await cycle.enter();

  assert.equal(cycle.skip_prepare, true);
});

test('enter: question_list가 비어있으면 skip_prepare를 true로 설정한다', async () =>
{
  const quiz_session = makeFakeQuizSession({ quiz_data: { question_list: [] }, hasMoreQuestion: () => true });
  const cycle = new Prepare(quiz_session);

  await cycle.enter();

  assert.equal(cycle.skip_prepare, true);
});

test('act: skip_prepare가 true면 아무 것도 하지 않는다', async () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new Prepare(quiz_session);
  cycle.skip_prepare = true;

  await cycle.act();

  assert.equal(quiz_session.has_current_question, undefined);
});

test('act: force_stop이면 아무 것도 하지 않는다', async () =>
{
  const quiz_session = makeFakeQuizSession({ force_stop: true });
  const cycle = new Prepare(quiz_session);

  await cycle.act();

  assert.equal(quiz_session.has_current_question, undefined);
});

test('exit: skip_prepare면 prepared_question_queue에 아무 것도 넣지 않는다', async () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new Prepare(quiz_session);
  cycle.skip_prepare = true;

  await cycle.exit();

  assert.equal(quiz_session.game_data.prepared_question_queue.length, 0);
});

test('exit: 준비된 문제를 prepared_question_queue에 넣는다', async () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new Prepare(quiz_session);
  cycle.prepared_question = { question: '테스트 문제' };

  await cycle.exit();

  assert.deepEqual(quiz_session.game_data.prepared_question_queue, [{ question: '테스트 문제' }]);
});
