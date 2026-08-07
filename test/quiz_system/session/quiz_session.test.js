'use strict';

//quiz_system.js에서 분리된 QuizSession(REFACTOR_PLAN.md Phase 2)에 대한 회귀 방지 테스트.
//createCycle()이 quiz_maker_type/quiz_type 조합에 따라 올바른 lifecycle 클래스를
//고르는지(라우팅 로직), 그리고 cycle 탐색/전이 로직을 검증한다. 실제 음성 연결/오디오
//재생은 만들지 않는다 (REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const { QuizSession } = require('../../../quizbot/quiz_system/session/quiz_session.js');
const { CYCLE_TYPE, QUIZ_SESSION_TYPE } = require('../../../quizbot/quiz_system/constants');
const session_registry = require('../../../quizbot/quiz_system/session_registry');
const { QUIZ_MAKER_TYPE, QUIZ_TYPE } = require('../../../config/system_setting.js');

function makeFakeGuild()
{
  return { id: 'guild_1' };
}

function makeFakeOwner()
{
  return { id: 'owner_1', voice: { channel: { id: 'voice_channel_1' } } };
}

function makeQuizSession(quiz_info)
{
  return new QuizSession(makeFakeGuild(), makeFakeOwner(), { id: 'channel_1' }, quiz_info, QUIZ_SESSION_TYPE.NORMAL);
}

test('constructor: guild/owner/channel 정보로 초기 상태를 구성한다', () =>
{
  const quiz_session = makeQuizSession({});

  assert.equal(quiz_session.guild_id, 'guild_1');
  assert.equal(quiz_session.voice_channel.id, 'voice_channel_1');
  assert.equal(quiz_session.current_cycle_type, CYCLE_TYPE.UNDEFINED);
  assert.equal(quiz_session.force_stop, false);
  assert.equal(quiz_session.isMultiplayerSession(), false);
});

test('createCycle: quiz_maker_type에 따라 올바른 Initialize 하위 클래스를 고른다', () =>
{
  const cases = [
    [QUIZ_MAKER_TYPE.BY_DEVELOPER, 'InitializeDevQuiz'],
    [QUIZ_MAKER_TYPE.CUSTOM, 'InitializeCustomQuiz'],
    [QUIZ_MAKER_TYPE.OMAKASE, 'InitializeOmakaseQuiz'],
    ['이상한값', 'InitializeUnknownQuiz'],
  ];

  for(const [quiz_maker_type, expected_class_name] of cases)
  {
    const quiz_session = makeQuizSession({ quiz_maker_type, quiz_type: QUIZ_TYPE.TEXT });
    quiz_session.createCycle();

    const initializing_cycle = quiz_session.getCycle(CYCLE_TYPE.INITIALIZING);
    assert.equal(initializing_cycle.constructor.name, expected_class_name, `quiz_maker_type=${quiz_maker_type}`);
  }
});

test('createCycle: quiz_type에 따라 올바른 Question 하위 클래스를 고른다', () =>
{
  const cases = [
    [QUIZ_TYPE.SONG, 'QuestionSong'],
    [QUIZ_TYPE.IMAGE, 'QuestionImage'],
    [QUIZ_TYPE.INTRO, 'QuestionIntro'],
    [QUIZ_TYPE.TEXT, 'QuestionText'],
    [QUIZ_TYPE.OX, 'QuestionOX'],
    [QUIZ_TYPE.CUSTOM, 'QuestionCustom'],
    [QUIZ_TYPE.OMAKASE, 'QuestionOmakase'],
    ['이상한타입', 'QuestionUnknown'],
  ];

  for(const [quiz_type, expected_class_name] of cases)
  {
    const quiz_session = makeQuizSession({ quiz_maker_type: QUIZ_MAKER_TYPE.BY_DEVELOPER, quiz_type });
    quiz_session.createCycle();

    const questioning_cycle = quiz_session.getCycle(CYCLE_TYPE.QUESTIONING);
    assert.equal(questioning_cycle.constructor.name, expected_class_name, `quiz_type=${quiz_type}`);
  }
});

test('createCycle: 모든 세션에 공통 cycle(Explain/Prepare/CorrectAnswer/TimeOver/Clearing/Ending/Finish/HOLD)이 채워진다', () =>
{
  const quiz_session = makeQuizSession({ quiz_maker_type: QUIZ_MAKER_TYPE.BY_DEVELOPER, quiz_type: QUIZ_TYPE.TEXT });
  quiz_session.createCycle();

  for(const cycle_type of [CYCLE_TYPE.EXPLAIN, CYCLE_TYPE.PREPARE, CYCLE_TYPE.CORRECTANSWER, CYCLE_TYPE.TIMEOVER, CYCLE_TYPE.CLEARING, CYCLE_TYPE.ENDING, CYCLE_TYPE.FINISH, CYCLE_TYPE.HOLD])
  {
    assert.notEqual(quiz_session.getCycle(cycle_type), undefined, `${cycle_type} cycle이 없음`);
  }
});

test('getCycle: 없는 cycle_type을 조회하면 undefined를 반환한다', () =>
{
  const quiz_session = makeQuizSession({});

  assert.equal(quiz_session.getCycle('없는_사이클'), undefined);
});

test('goToCycle: 존재하는 cycle이면 current_cycle_type을 바꾸고 do()를 호출한다', () =>
{
  const quiz_session = makeQuizSession({});
  let do_called = false;
  quiz_session.inputLifeCycle(CYCLE_TYPE.HOLD, { do: () => { do_called = true; } });

  quiz_session.goToCycle(CYCLE_TYPE.HOLD);

  assert.equal(quiz_session.current_cycle_type, CYCLE_TYPE.HOLD);
  assert.equal(do_called, true);
});

test('goToCycle: 존재하지 않는 cycle이면 current_cycle_type을 바꾸지 않는다', () =>
{
  const quiz_session = makeQuizSession({});
  quiz_session.current_cycle_type = CYCLE_TYPE.QUESTIONING;

  quiz_session.goToCycle('없는_사이클');

  assert.equal(quiz_session.current_cycle_type, CYCLE_TYPE.QUESTIONING);
});

test('hasMoreQuestion: game_data.question_num이 quiz_data.quiz_size보다 작으면 true다', () =>
{
  const quiz_session = makeQuizSession({});
  quiz_session.game_data = { question_num: 2 };
  quiz_session.quiz_data = { quiz_size: 5 };

  assert.equal(quiz_session.hasMoreQuestion(), true);

  quiz_session.game_data.question_num = 5;
  assert.equal(quiz_session.hasMoreQuestion(), false);
});

test('free: registry에서 세션을 지우고 audio_player를 정지한다', () =>
{
  const quiz_session = makeQuizSession({});
  session_registry.quiz_session_map[quiz_session.guild_id] = quiz_session;
  quiz_session.game_data = { audio_stream_for_close: [] };

  let stopped = false;
  quiz_session.audio_player = { stop: () => { stopped = true; } };

  quiz_session.free();

  assert.equal(stopped, true);
  assert.equal(session_registry.quiz_session_map.hasOwnProperty(quiz_session.guild_id), false);
});
