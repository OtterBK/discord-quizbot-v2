'use strict';

//multiplayer_manager.js(MultiplayerSession.calcWinnerMMR/calcLoserMMR)에서 분리된
//순수 MMR 계산 함수(REFACTOR_PLAN.md Phase 3)에 대한 회귀 방지 테스트.
//REFACTOR_PLAN.md 2.4가 명시적으로 우선순위로 꼽은 "MMR 계산" 로직.

const test = require('node:test');
const assert = require('node:assert/strict');

const { calcWinnerMMR, calcLoserMMR } = require('../../quizbot/managers/multiplayer_mmr');

test('calcWinnerMMR: guild_info가 없으면(탈주 등) 0을 반환한다', () =>
{
  assert.equal(calcWinnerMMR(undefined, 30, 4), 0);
});

test('calcWinnerMMR: 승률 100%로 전체 문제를 다 풀면 기본 점수 + 최대 승률 보너스를 받는다', () =>
{
  // 2명이라 인원 보너스 없음(participant_bonus=0), 60문제 중 60번째(현재 진행도 100%)
  const mmr = calcWinnerMMR({ stat: { win: 10, lose: 0 } }, 59, 2);

  assert.equal(mmr, 120); // 기본 80 + 승률 보너스(최대치, 80*0.5=40)
});

test('calcWinnerMMR: 인원이 많을수록(3명부터) 보너스가 붙는다', () =>
{
  const mmr_2p = calcWinnerMMR({ stat: { win: 0, lose: 10 } }, 59, 2); // 승률 0% -> 보너스 없음
  const mmr_5p = calcWinnerMMR({ stat: { win: 0, lose: 10 } }, 59, 5); // 인원 보너스만 적용

  assert.equal(mmr_2p, 80); // 80 * (1+0) * 1
  assert.equal(mmr_5p, 152); // 80 * (1 + max(0,5-2)*0.3) * 1 = 80*1.9
});

test('calcWinnerMMR: 승률이 50% 미만이면 승률 보너스를 받지 않는다', () =>
{
  const mmr = calcWinnerMMR({ stat: { win: 1, lose: 9 } }, 59, 2); // 승률 10%

  assert.equal(mmr, 80); // 보너스 없이 기본 점수만
});

test('calcWinnerMMR: 진행한 문제 수가 적을수록 획득 점수도 비례해서 줄어든다', () =>
{
  const mmr_full = calcWinnerMMR({ stat: { win: 0, lose: 0 } }, 59, 2); // 60/60문제
  const mmr_half = calcWinnerMMR({ stat: { win: 0, lose: 0 } }, 29, 2); // 30/60문제

  assert.equal(mmr_full, 80);
  assert.equal(mmr_half, 40);
});

test('calcLoserMMR: guild_info가 없으면(탈주) 최대 페널티를 받는다', () =>
{
  assert.equal(calcLoserMMR(undefined, 0, 30, 100), -100);
});

test('calcLoserMMR: 점수가 없으면(0점) 감면 없이 문제 진행률만큼만 페널티를 받는다', () =>
{
  const mmr = calcLoserMMR({ stat: {} }, 0, 30, 100); // 30/60 = 50% 진행

  assert.equal(mmr, -40); // -100 * 0.8 * 0.5
});

test('calcLoserMMR: 최고 점수 대비 자신의 점수 비율만큼 페널티가 감면된다', () =>
{
  const mmr = calcLoserMMR({ stat: {} }, 50, 30, 100); // top_score의 절반을 냄

  assert.equal(mmr, -34); // -40 + (40 * 0.5 * 0.3)
});

test('calcLoserMMR: 자신이 최고 점수보다 높으면(동점자 등) 감면 없이 그대로다', () =>
{
  const mmr = calcLoserMMR({ stat: {} }, 150, 30, 100); // score > top_score

  assert.equal(mmr, -40); // score_ratio가 0으로 처리됨
});

test('calcLoserMMR: 최고 점수가 0이면(전원 0점) 감면 없이 그대로다', () =>
{
  const mmr = calcLoserMMR({ stat: {} }, 0, 30, 0);

  assert.equal(mmr, -40);
});

test('calcLoserMMR: 문제 진행률 페널티 감면은 최대 50%로 제한된다', () =>
{
  const mmr_full_quiz = calcLoserMMR({ stat: {} }, 0, 59, 100); // 거의 다 풀어도
  const mmr_over_max = calcLoserMMR({ stat: {} }, 0, 120, 100); // max_question_size(60)를 넘어가도

  assert.equal(mmr_full_quiz, -40); // min(0.5, 60/60=1) -> 0.5로 제한
  assert.equal(mmr_over_max, -40); // min(0.5, 120/60=2) -> 0.5로 제한, 동일
});
