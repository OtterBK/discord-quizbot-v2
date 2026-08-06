'use strict';

//quiz_system.js에서 분리된 QuizLifeCycle/QuizLifeCycleWithUtility(REFACTOR_PLAN.md Phase 2)에
//대한 회귀 방지 테스트. 모든 lifecycle 클래스(Initialize/Explain/Prepare/Question/...)의
//공통 베이스라 여기서 깨지면 파급 범위가 매우 크다. quiz_session은 실제 디스코드 세션 대신
//필요한 속성/메서드만 갖춘 가짜 객체로 대체한다 (REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const { QuizLifeCycle, QuizLifeCycleWithUtility } = require('../../../quizbot/quiz_system/lifecycle/quiz_lifecycle.js');
const { CYCLE_TYPE } = require('../../../quizbot/quiz_system/constants.js');
const { CUSTOM_EVENT_TYPE } = require('../../../config/system_setting.js');
const feedback_manager = require('../../../quizbot/managers/feedback_manager');
const utility = require('../../../utility/utility.js');

function makeFakeQuizSession(overrides = {})
{
  return {
    guild_id: 'guild_1',
    force_stop: false,
    current_cycle_type: CYCLE_TYPE.QUESTIONING,
    goToCycle: () => {},
    forceStop: () => {},
    ...overrides,
  };
}

test('constructor: 초기 상태를 설정한다', () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new QuizLifeCycle(quiz_session);

  assert.equal(cycle.quiz_session, quiz_session);
  assert.equal(cycle.force_stop, false);
  assert.equal(cycle.next_cycle, CYCLE_TYPE.UNDEFINED);
  assert.equal(cycle.ignore_block, false);
});

test('_enter: enter() 훅이 true(기본)를 반환하면 _act()로 이어간다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession());
  let act_called = false;
  cycle._act = () => { act_called = true; };

  await cycle._enter();

  assert.equal(act_called, true);
});

test('_enter: enter() 훅이 false를 반환하면 _act()로 이어가지 않는다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession());
  let act_called = false;
  cycle.enter = async () => false;
  cycle._act = () => { act_called = true; };

  await cycle._enter();

  assert.equal(act_called, false);
});

test('_enter: quiz_session.force_stop이 true면 enter()가 true를 반환해도 _act()로 이어가지 않는다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession({ force_stop: true }));
  let act_called = false;
  cycle.enter = async () => true;
  cycle._act = () => { act_called = true; };

  await cycle._enter();

  assert.equal(act_called, false);
});

test('_enter: ignore_block이 true면 goNext가 false여도 _act()로 이어간다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession());
  cycle.ignore_block = true;
  let act_called = false;
  cycle.enter = async () => false;
  cycle._act = () => { act_called = true; };

  await cycle._enter();

  assert.equal(act_called, true);
});

test('_exit: next_cycle이 설정되어 있으면 quiz_session.goToCycle을 호출한다', async () =>
{
  let goto_target = undefined;
  const quiz_session = makeFakeQuizSession({ goToCycle: (cycle_type) => { goto_target = cycle_type; } });
  const cycle = new QuizLifeCycle(quiz_session);
  cycle.next_cycle = CYCLE_TYPE.EXPLAIN;

  await cycle._exit();

  assert.equal(goto_target, CYCLE_TYPE.EXPLAIN);
});

test('_exit: next_cycle이 UNDEFINED면 goToCycle을 호출하지 않는다', async () =>
{
  let goto_called = false;
  const quiz_session = makeFakeQuizSession({ goToCycle: () => { goto_called = true; } });
  const cycle = new QuizLifeCycle(quiz_session);

  await cycle._exit();

  assert.equal(goto_called, false);
});

test('forceStop: 세션과 자신의 force_stop 플래그를 세우고 exit() 후 FINISH로 전이한다', async () =>
{
  const quiz_session = makeFakeQuizSession();
  const cycle = new QuizLifeCycle(quiz_session);
  let exit_called = false;
  let goto_target = undefined;
  cycle.exit = () => { exit_called = true; };
  quiz_session.goToCycle = (cycle_type) => { goto_target = cycle_type; };

  await cycle.forceStop();

  assert.equal(quiz_session.force_stop, true);
  assert.equal(cycle.force_stop, true);
  assert.equal(exit_called, true);
  assert.equal(goto_target, CYCLE_TYPE.FINISH);
});

test('on(): force_stop 버튼을 주최자가 아닌 사람이 누르면 거부 메시지를 보내고 종료하지 않는다', async () =>
{
  const owner = { id: 'owner_1' };
  let force_stop_called = false;
  let sent_message = undefined;
  const quiz_session = makeFakeQuizSession({ owner, forceStop: () => { force_stop_called = true; } });
  const cycle = new QuizLifeCycle(quiz_session);

  const fake_interaction = {
    isButton: () => true,
    customId: 'force_stop',
    member: { id: 'not_owner' },
    channel: { send: (message) => { sent_message = message; } },
  };

  await cycle.on(CUSTOM_EVENT_TYPE.interactionCreate, fake_interaction);

  assert.equal(force_stop_called, false);
  assert.match(sent_message.content, /주최자만 가능/);
});

test('on(): force_stop 버튼을 주최자가 누르면 세션을 강제 종료한다', async () =>
{
  const owner = { id: 'owner_1', user: { username: '주최자' } };
  let force_stop_called = false;
  const quiz_session = makeFakeQuizSession({ owner, forceStop: () => { force_stop_called = true; } });
  const cycle = new QuizLifeCycle(quiz_session);

  const fake_interaction = {
    isButton: () => true,
    customId: 'force_stop',
    member: owner,
    channel: { send: () => {} },
  };

  await cycle.on(CUSTOM_EVENT_TYPE.interactionCreate, fake_interaction);

  assert.equal(force_stop_called, true);
});

test('on(): like 버튼을 누르면 feedback_manager.addQuizLikeAuto를 호출한다', async (t) =>
{
  const quiz_info = { quiz_id: 'quiz_1', title: '테스트 퀴즈' };
  const quiz_session = makeFakeQuizSession({ already_liked: false, quiz_info });
  const cycle = new QuizLifeCycle(quiz_session);

  const like_mock = t.mock.method(feedback_manager, 'addQuizLikeAuto', async () => {});

  const fake_interaction = { isButton: () => true, customId: 'like' };

  await cycle.on(CUSTOM_EVENT_TYPE.interactionCreate, fake_interaction);

  assert.equal(like_mock.mock.callCount(), 1);
  assert.deepEqual(like_mock.mock.calls[0].arguments, [fake_interaction, 'quiz_1', '테스트 퀴즈']);
});

test('on(): 버튼이 아니면 onInteractionCreate 훅으로 위임한다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession());
  let received = undefined;
  cycle.onInteractionCreate = (interaction) => { received = interaction; };

  const fake_interaction = { isButton: () => false };
  await cycle.on(CUSTOM_EVENT_TYPE.interactionCreate, fake_interaction);

  assert.equal(received, fake_interaction);
});

test('on(): messageCreate/receivedMultiplayerSignal 이벤트는 각각의 훅으로 위임한다', async () =>
{
  const cycle = new QuizLifeCycle(makeFakeQuizSession());
  let message_received;
  let signal_received;
  cycle.onMessageCreate = (message) => { message_received = message; };
  cycle.onReceivedMultiplayerSignal = (signal) => { signal_received = signal; };

  await cycle.on(CUSTOM_EVENT_TYPE.messageCreate, 'fake_message');
  await cycle.on(CUSTOM_EVENT_TYPE.receivedMultiplayerSignal, 'fake_signal');

  assert.equal(message_received, 'fake_message');
  assert.equal(signal_received, 'fake_signal');
});

test('QuizLifeCycleWithUtility.sendBGM: 재생 목록을 멈추고 BGM을 재생한다', (t) =>
{
  const quiz_session = makeFakeQuizSession({ audio_player: { stop: () => {} } });
  const cycle = new QuizLifeCycleWithUtility(quiz_session);
  const play_bgm_mock = t.mock.method(utility, 'playBGM', () => {});

  cycle.sendBGM('DOOR_BELL');

  assert.equal(play_bgm_mock.mock.callCount(), 1);
  assert.deepEqual(play_bgm_mock.mock.calls[0].arguments, [quiz_session.audio_player, 'DOOR_BELL']);
});

test('QuizLifeCycleWithUtility.getScoreboardFields: score_show_max만큼만 필드를 만든다', () =>
{
  const scoreboard = new Map([
    ['user_1', { name: '유저1', score: 30 }],
    ['user_2', { name: '유저2', score: 20 }],
    ['user_3', { name: '유저3', score: 10 }],
  ]);
  const quiz_session = makeFakeQuizSession({
    option_data: { quiz: { score_show_max: 2 } },
    scoreboard,
    isMultiplayerSession: () => false,
  });
  const cycle = new QuizLifeCycleWithUtility(quiz_session);

  const fields = cycle.getScoreboardFields();

  // 첫 번째는 스코어보드 제목 필드, 이후 score_show_max(2)개만 추가
  assert.equal(fields.length, 1 + 2);
});
