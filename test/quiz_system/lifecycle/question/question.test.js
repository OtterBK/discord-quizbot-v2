'use strict';

//quiz_system.js에서 분리된 Question 베이스 클래스(REFACTOR_PLAN.md Phase 2)에 대한
//회귀 방지 테스트. REFACTOR_PLAN.md 2.4가 우선순위로 꼽은 "점수/랭킹 계산, 정답 채점,
//힌트 자동 적용 조건" 위주로 검증한다. 8개 Question 하위 클래스(Song/Image/...)의
//act()는 오디오 재생·타이머·UI 갱신이 뒤섞인 orchestration 코드라 이번 테스트에서는
//다루지 않고, 모든 하위 클래스가 공유하는 순수 판정 로직만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const Question = require('../../../../quizbot/quiz_system/lifecycle/question/question');
const { OPTION_TYPE } = require('../../../../quizbot/quiz_option/quiz_option.js');

function makeFakeQuizSession(overrides = {})
{
  return {
    guild_id: 'guild_1',
    option_data: { quiz: { score_type: OPTION_TYPE.SCORE_TYPE.TIME, max_chance: OPTION_TYPE.UNLIMITED } },
    scoreboard: new Map(),
    isMultiplayerSession: () => false,
    ...overrides,
  };
}

test('checkAnswerHit: 공백/대소문자를 정규화해서 정답 목록과 비교한다', () =>
{
  const cycle = new Question(makeFakeQuizSession());
  cycle.answers = ['halflife'];

  assert.equal(cycle.checkAnswerHit('Half Life'), true);
  assert.equal(cycle.checkAnswerHit(' HALFLIFE '), true);
  assert.equal(cycle.checkAnswerHit('halflife2'), false);
});

test('hasAnswerer/isSkipped: current_question의 플래그를 그대로 반영한다', () =>
{
  const cycle = new Question(makeFakeQuizSession());
  cycle.current_question = {};

  assert.equal(cycle.hasAnswerer(), false);
  assert.equal(cycle.isSkipped(), false);

  cycle.current_question['answer_members'] = ['user_1'];
  cycle.current_question['skip_used'] = true;

  assert.equal(cycle.hasAnswerer(), true);
  assert.equal(cycle.isSkipped(), true);
});

test('applyCorrectAnswer: 처음 맞춘 사람은 scoreboard에 새로 등록된다', () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new Question(quiz_session);
  cycle.current_question = {};

  cycle.applyCorrectAnswer('user_1', '유저1', 5);

  assert.deepEqual(quiz_session.scoreboard.get('user_1'), { name: '유저1', score: 5 });
  assert.deepEqual(cycle.current_question['answer_members'], ['user_1']);
});

test('applyCorrectAnswer: 이미 점수가 있는 사람은 누적되고 이름이 갱신된다', () =>
{
  const quiz_session = makeFakeQuizSession();
  quiz_session.scoreboard.set('user_1', { name: '이전이름', score: 3 });
  const cycle = new Question(quiz_session);
  cycle.current_question = {};

  cycle.applyCorrectAnswer('user_1', '새이름', 5);

  assert.deepEqual(quiz_session.scoreboard.get('user_1'), { name: '새이름', score: 8 });
});

test('calculateScore: score_type이 TIME이 아니면 항상 1점이다', () =>
{
  const quiz_session = makeFakeQuizSession({ option_data: { quiz: { score_type: 'NOT_TIME' } } });
  const cycle = new Question(quiz_session);

  assert.equal(cycle.calculateScore(), 1);
});

test('calculateScore: score_type이 TIME이면 빨리 맞출수록 배점이 높다(최대 10배)', () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new Question(quiz_session);
  cycle.timeover_wait = 10000; // 10초 제한시간

  cycle.timeover_timer_created = Date.now(); // 방금 시작
  const score_immediately = cycle.calculateScore();

  cycle.timeover_timer_created = Date.now() - 9000; // 9초 지나서 맞춤(제한시간 임박)
  const score_late = cycle.calculateScore();

  assert.equal(score_immediately, 10); // 즉시 맞추면 최대 배점
  assert.ok(score_late < score_immediately);
  assert.ok(score_late >= 1); // 최소 1점 보장
});

test('processChance: max_chance가 UNLIMITED면 항상 충분한 기회를 반환한다', () =>
{
  const quiz_session = makeFakeQuizSession({ option_data: { quiz: { max_chance: OPTION_TYPE.UNLIMITED } } });
  const cycle = new Question(quiz_session);

  assert.equal(cycle.processChance({ id: 'user_1' }), 10000);
  assert.equal(cycle.processChance({ id: 'user_1' }), 10000); // 여러 번 불러도 항상 충분
});

test('processChance: 시도할 때마다 남은 기회가 줄어들고, 0 미만이면 더 이상 기회가 없다', () =>
{
  const quiz_session = makeFakeQuizSession({ option_data: { quiz: { max_chance: 2 } } });
  const cycle = new Question(quiz_session);
  const member = { id: 'user_1' };

  assert.equal(cycle.processChance(member), 1); // 1번째 시도, 1번 남음
  assert.equal(cycle.processChance(member), 0); // 2번째 시도, 0번 남음(마지막 기회였음)
  assert.equal(cycle.processChance(member), -1); // 3번째 시도, 기회 초과
});

test('choiceAsIcon: 선택지를 이모지로 변환한다', () =>
{
  const cycle = new Question(makeFakeQuizSession());

  assert.equal(cycle.choiceAsIcon('o'), '⭕');
  assert.equal(cycle.choiceAsIcon('x'), '❌');
  assert.equal(cycle.choiceAsIcon('3'), '3️⃣');
  assert.equal(cycle.choiceAsIcon('알수없음'), '알수없음'); // 매핑 없으면 그대로 반환
});
