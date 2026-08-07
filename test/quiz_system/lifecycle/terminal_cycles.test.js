'use strict';

//quiz_system.js에서 분리된 말단 lifecycle 클래스들(Explain, TimeOver, CorrectAnswer,
//Clearing, Ending, Finish, HOLD)에 대한 회귀 방지 테스트. 실제 디스코드 채널/음성 연결/
//타이머 대기는 만들지 않고 필요한 부분만 흉내 낸 가짜 quiz_session으로 대체한다
//(REFACTOR_PLAN.md 2.4). UI 문구 자체보다 상태 전이 조건(다음 cycle 결정)과
//분기 로직 검증에 집중한다 (REFACTOR_PLAN.md 2.4 테스트 우선순위).

const test = require('node:test');
const assert = require('node:assert/strict');

const HOLD = require('../../../quizbot/quiz_system/lifecycle/hold');
const Finish = require('../../../quizbot/quiz_system/lifecycle/finish');
const Clearing = require('../../../quizbot/quiz_system/lifecycle/clearing');
const TimeOver = require('../../../quizbot/quiz_system/lifecycle/time_over');
const CorrectAnswer = require('../../../quizbot/quiz_system/lifecycle/correct_answer');
const Explain = require('../../../quizbot/quiz_system/lifecycle/explain');
const Ending = require('../../../quizbot/quiz_system/lifecycle/ending');

const { CYCLE_TYPE } = require('../../../quizbot/quiz_system/constants');
const session_registry = require('../../../quizbot/quiz_system/session_registry');
const utility = require('../../../utility/utility.js');

function makeFakeQuizUI()
{
  return {
    embed: {},
    components: [],
    setImage: () => {},
    send: () => {},
    update: () => {},
    delete: () => {},
  };
}

function makeFakeQuizSession(overrides = {})
{
  return {
    guild_id: 'guild_1',
    force_stop: false,
    quiz_data: { title: '테스트 퀴즈', icon: '🎯' },
    game_data: { processing_question: { answers: [], author: [] } },
    quiz_ui: makeFakeQuizUI(),
    scoreboard: new Map(),
    option_data: { quiz: { score_show_max: 10 } },
    hasMoreQuestion: () => true,
    isMultiplayerSession: () => false,
    isHostSession: () => false,
    isMultiplayerSessionExpired: () => false,
    isIngame: () => true,
    waitForSyncDone: () => {},
    sendFinishUp: () => {},
    sendFinished: () => {},
    sendMessage: () => {},
    ...overrides,
  };
}

test('HOLD.act: 아무 것도 하지 않는다', async () =>
{
  const cycle = new HOLD(makeFakeQuizSession());
  await assert.doesNotReject(cycle.act());
});

test('Finish: exit()에서 registry의 세션을 지우고 quiz_session.free()를 호출한다', async () =>
{
  let freed = false;
  const quiz_session = makeFakeQuizSession({ free: () => { freed = true; } });
  session_registry.quiz_session_map['guild_1'] = quiz_session;
  const cycle = new Finish(quiz_session);

  await cycle.exit();

  assert.equal(freed, true);
  assert.equal(session_registry.quiz_session_map.hasOwnProperty('guild_1'), false);
});

test('Finish: act()에서 오디오 정지 및 음성 연결을 해제한다', async () =>
{
  let stopped = false;
  let destroyed = false;
  const quiz_session = makeFakeQuizSession({
    audio_player: { stop: () => { stopped = true; } },
    voice_connection: { destroy: () => { destroyed = true; } },
  });
  const cycle = new Finish(quiz_session);

  await cycle.act();

  assert.equal(stopped, true);
  assert.equal(destroyed, true);
});

test('Finish: 멀티플레이 호스트+게임중+강제종료 아님이면 sendFinished를 호출한다', async () =>
{
  let finished_sent = false;
  const quiz_session = makeFakeQuizSession({
    isMultiplayerSession: () => true,
    isHostSession: () => true,
    isIngame: () => true,
    force_stop: false,
    sendFinished: () => { finished_sent = true; },
  });
  const cycle = new Finish(quiz_session);

  await cycle.act();

  assert.equal(finished_sent, true);
});

test('Finish: 강제종료인 경우 sendFinished를 호출하지 않는다', async () =>
{
  let finished_sent = false;
  const quiz_session = makeFakeQuizSession({
    isMultiplayerSession: () => true,
    isHostSession: () => true,
    isIngame: () => true,
    force_stop: true,
    sendFinished: () => { finished_sent = true; },
  });
  const cycle = new Finish(quiz_session);

  await cycle.act();

  assert.equal(finished_sent, false);
});

test('Clearing: 더 낼 문제가 없으면 ENDING으로 전이한다', async () =>
{
  const quiz_session = makeFakeQuizSession({ hasMoreQuestion: () => false });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.ENDING);
});

test('Clearing: 멀티플레이 호스트인데 더 낼 문제가 없으면 sendFinishUp을 호출한다', async () =>
{
  let finish_up_sent = false;
  const quiz_session = makeFakeQuizSession({
    hasMoreQuestion: () => false,
    isMultiplayerSession: () => true,
    isHostSession: () => true,
    sendFinishUp: () => { finish_up_sent = true; },
  });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(finish_up_sent, true);
});

test('Clearing: 문제가 더 있고 싱글 세션이면 QUESTIONING을 유지한다', async () =>
{
  const quiz_session = makeFakeQuizSession({ hasMoreQuestion: () => true, isMultiplayerSession: () => false });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.QUESTIONING);
});

test('Clearing: 문제가 더 있고 멀티세션이 만료됐으면 ENDING으로 전이한다', async () =>
{
  const quiz_session = makeFakeQuizSession({
    hasMoreQuestion: () => true,
    isMultiplayerSession: () => true,
    isMultiplayerSessionExpired: () => true,
  });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.ENDING);
});

test('Clearing: 문제가 더 있고 멀티세션이 살아있으면 HOLD로 전이하며 동기화를 기다린다', async () =>
{
  let wait_called = false;
  const quiz_session = makeFakeQuizSession({
    hasMoreQuestion: () => true,
    isMultiplayerSession: () => true,
    isMultiplayerSessionExpired: () => false,
    waitForSyncDone: () => { wait_called = true; },
  });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.HOLD);
  assert.equal(wait_called, true);
});

test('Clearing: 문제가 더 있다고 하지만 question_list가 비어있으면 강제로 ENDING 처리한다', async () =>
{
  let warned_message_sent = false;
  const quiz_session = makeFakeQuizSession({
    hasMoreQuestion: () => true,
    has_current_question: false,
    quiz_data: { title: '테스트', question_list: [] },
    sendMessage: () => { warned_message_sent = true; },
  });
  const cycle = new Clearing(quiz_session);

  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.ENDING);
  assert.equal(warned_message_sent, true);
});

test('TimeOver.act: play_bgm_on_question_finish가 true이고 custom_wait이 없으면 실패 BGM을 재생한다', async (t) =>
{
  t.mock.method(utility, 'sleep', async () => {});
  const sendbgm_calls = [];
  const quiz_session = makeFakeQuizSession({
    game_data: { processing_question: { play_bgm_on_question_finish: true } },
  });
  const cycle = new TimeOver(quiz_session);
  cycle.sendBGM = (bgm_type) => sendbgm_calls.push(bgm_type);

  await cycle.act();

  assert.equal(sendbgm_calls.length, 1);
});

test('TimeOver.act: custom_wait이 있으면(정답 오디오 재생 중) BGM을 따로 재생하지 않는다', async (t) =>
{
  t.mock.method(utility, 'sleep', async () => {});
  const sendbgm_calls = [];
  const quiz_session = makeFakeQuizSession({
    game_data: { processing_question: { play_bgm_on_question_finish: true } },
  });
  const cycle = new TimeOver(quiz_session);
  cycle.custom_wait = 3000;
  cycle.sendBGM = (bgm_type) => sendbgm_calls.push(bgm_type);

  await cycle.act();

  assert.equal(sendbgm_calls.length, 0);
});

test('CorrectAnswer.enter: 정답자 목록으로 embed를 구성하고 quiz_ui.send를 호출한다', async () =>
{
  let sent = false;
  const scoreboard = new Map([['user_1', { name: '유저1', score: 10 }]]);
  const quiz_session = makeFakeQuizSession({
    scoreboard,
    game_data: { processing_question: { answer_members: ['user_1'], answers: ['정답'], author: ['작곡가'] } },
  });
  quiz_session.quiz_ui.send = () => { sent = true; };
  const cycle = new CorrectAnswer(quiz_session);

  await cycle.enter();

  assert.equal(sent, true);
  assert.match(quiz_session.quiz_ui.embed.description, /유저1/);
});

test('Explain: explain_list를 순회하며 마지막에 exit()로 넘어가고, 멀티세션이면 HOLD로 대기한다', async (t) =>
{
  t.mock.method(utility, 'sleep', async () => {});
  t.mock.method(utility, 'playBGM', () => {});
  let wait_called = false;
  const quiz_session = makeFakeQuizSession({
    isMultiplayerSession: () => true,
    waitForSyncDone: () => { wait_called = true; },
  });
  const cycle = new Explain(quiz_session);

  await cycle.act();
  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.HOLD);
  assert.equal(wait_called, true);
});

test('Explain: 싱글 세션이면 exit()에서 next_cycle을 바꾸지 않는다(QUESTIONING 유지)', async (t) =>
{
  t.mock.method(utility, 'sleep', async () => {});
  t.mock.method(utility, 'playBGM', () => {});
  const quiz_session = makeFakeQuizSession({ isMultiplayerSession: () => false });
  const cycle = new Explain(quiz_session);

  await cycle.act();
  await cycle.exit();

  assert.equal(cycle.next_cycle, CYCLE_TYPE.QUESTIONING);
});

test('Ending: 정답자가 없으면 안내 문구를 추가하고 실패 BGM을 재생한다', async (t) =>
{
  t.mock.method(utility, 'sleep', async () => {});
  const sendbgm_calls = [];
  const quiz_session = makeFakeQuizSession({ already_liked: true, scoreboard: new Map() });
  quiz_session.channel = { send: () => {} };
  const cycle = new Ending(quiz_session);
  cycle.sendBGM = (bgm_type) => sendbgm_calls.push(bgm_type);

  await cycle.act();

  // 순서대로: BELL(시작) -> FAIL(정답자 없음) -> ENDING(마무리)
  assert.equal(sendbgm_calls.length, 3);
  assert.ok(sendbgm_calls[1].includes('FAIL'));
});
