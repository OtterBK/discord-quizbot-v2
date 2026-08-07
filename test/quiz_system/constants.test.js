'use strict';

//quiz_system.js에서 분리된 상수(REFACTOR_PLAN.md Phase 2 첫 슬라이스)가
//원본과 동일한 값을 유지하는지 확인하는 회귀 방지 테스트.

const test = require('node:test');
const assert = require('node:assert/strict');

const { CYCLE_TYPE, QUIZ_SESSION_TYPE } = require('../../quizbot/quiz_system/constants');

test('CYCLE_TYPE: 퀴즈 생명주기 단계가 모두 정의되어 있다', () =>
{
  assert.deepEqual(CYCLE_TYPE, {
    UNDEFINED: 'UNDEFINED',
    INITIALIZING: 'INITIALIZING',
    EXPLAIN: 'EXPLAIN',
    PREPARE: 'PREPARE',
    QUESTIONING: 'QUESTIONING',
    CORRECTANSWER: 'CORRECTANSWER',
    TIMEOVER: 'TIMEOVER',
    CLEARING: 'CLEARING',
    ENDING: 'ENDING',
    FINISH: 'FINISH',
    FORCEFINISH: 'FORCEFINISH',
    HOLD: 'HOLD',
  });
});

test('QUIZ_SESSION_TYPE: 퀴즈 세션 종류가 모두 정의되어 있다', () =>
{
  assert.deepEqual(QUIZ_SESSION_TYPE, {
    NORMAL: 'NORMAL',
    DUMMY: 'DUMMY',
    MULTIPLAYER_LOBBY: 'MULTIPLAYER_LOBBY',
    MULTIPLAYER: 'MULTIPLAYER',
  });
});

test('quiz_system.js가 QUIZ_SESSION_TYPE을 그대로 재노출(re-export)한다 (하위 호환)', () =>
{
  const quiz_system = require('../../quizbot/quiz_system/quiz_system');

  assert.equal(quiz_system.QUIZ_SESSION_TYPE, QUIZ_SESSION_TYPE);
});
