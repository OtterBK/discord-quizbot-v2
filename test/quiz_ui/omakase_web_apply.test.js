'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 3 회귀 테스트 - 랜덤(오마카세) 퀴즈 모드.
//dev/user 모드와 달리 DB 조회가 필요 없는 작은 데이터라 WebHandoffUI.buildOmakaseQuizInfoUI/
//OmakaseQuizRoomUI.onReceivedWebSessionSignal 둘 다 동기로 동작한다 - mock 없이 직접 검증 가능.

const test = require('node:test');
const assert = require('node:assert/strict');

const { WebHandoffUI } = require('../../quizbot/quiz_ui/web-handoff-ui');
const { OmakaseQuizRoomUI } = require('../../quizbot/quiz_ui/omakase-quiz-room-ui');

const fakeInteraction = () => ({
  guild: { id: 'guild_test', name: '테스트길드', iconURL: () => '' },
  member: { id: 'owner_test', displayName: '테스터' },
});

test('WebHandoffUI.buildOmakaseQuizInfoUI: 웹 payload를 기본 omakase_quiz_info 위에 덮어씌워 OmakaseQuizRoomUI를 동기로 반환한다', () =>
{
  const ui = new WebHandoffUI('dev', fakeInteraction());

  const result = ui.buildOmakaseQuizInfoUI({
    mode: 'omakase',
    dev_quiz_tags: 16,
    basket_mode: false,
    custom_quiz_type_tags: 1,
    custom_quiz_tags: 8,
    certified_filter: false,
    basket_items: {},
    selected_question_count: 50,
  });

  assert.ok(result instanceof OmakaseQuizRoomUI);
  assert.equal(result.quiz_info['dev_quiz_tags'], 16);
  assert.equal(result.quiz_info['basket_mode'], false);
  assert.equal(result.quiz_info['custom_quiz_type_tags'], 1);
  assert.equal(result.quiz_info['custom_quiz_tags'], 8);
  assert.equal(result.quiz_info['certified_filter'], false);
  assert.equal(result.quiz_info['selected_question_count'], 50);
});

test('WebHandoffUI.buildOmakaseQuizInfoUI: selected_question_count가 quiz_size(100)를 넘으면 클램프된다', () =>
{
  const ui = new WebHandoffUI('dev', fakeInteraction());

  const result = ui.buildOmakaseQuizInfoUI({ mode: 'omakase', selected_question_count: 9999 });

  assert.equal(result.quiz_info['selected_question_count'], 100);
});

test('OmakaseQuizRoomUI.onReceivedWebSessionSignal: 확정 후 웹에서 설정을 바꾸면 같은 인스턴스를 그대로 갱신한다', () =>
{
  const initial_info = OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo(fakeInteraction());
  const ui = new OmakaseQuizRoomUI(initial_info);
  ui.holder = { guild_id: 'guild_test', updateUI: () => {} };

  const basket_items = { 1: { quiz_id: 1, title: '유저 퀴즈 1' } };
  const result = ui.onReceivedWebSessionSignal({
    event: 'applied',
    payload: { dev_quiz_tags: 32, basket_mode: true, basket_items, selected_question_count: 15 },
  });

  assert.equal(result, ui); //새 인스턴스가 아니라 같은 인스턴스를 반환해야 함(prev_ui_stack 누적 방지)
  assert.equal(ui.quiz_info['dev_quiz_tags'], 32);
  assert.equal(ui.quiz_info['basket_mode'], true);
  assert.deepEqual(ui.quiz_info['basket_items'], basket_items);
  assert.equal(ui.quiz_info['selected_question_count'], 15);
});

test('OmakaseQuizRoomUI.onReceivedWebSessionSignal: applied가 아닌 이벤트는 무시한다', () =>
{
  const initial_info = OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo(fakeInteraction());
  const ui = new OmakaseQuizRoomUI(initial_info);
  ui.holder = { guild_id: 'guild_test', updateUI: () => {} };

  const result = ui.onReceivedWebSessionSignal({ event: 'expired', payload: {} });

  assert.equal(result, undefined);
  assert.equal(ui.quiz_info['dev_quiz_tags'], 0); //바뀌지 않아야 함
});
