'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 2 회귀 테스트 - 유저 퀴즈 모드.
//WebHandoffUI.buildUserQuizInfoUI(최초 적용)/UserQuizInfoUI.reapplyFromWebPayload(재선택) 둘 다
//user_quiz_info_manager.loadUserQuizInfoById를 통해 DB 조회를 하므로(t.mock.method로 경계에서 mock),
//"async fire-and-forget 후 appendNewUI/updateUI를 직접 호출" 패턴(WEB_INTEGRATION_PLAN.md "중요 제약")이
//실제로 동작하는지 async 메서드를 직접 호출해서 검증한다(dev_quiz_web_reapply.test.js와 동일한 취지).

const test = require('node:test');
const assert = require('node:assert/strict');

const user_quiz_info_manager = require('../../quizbot/managers/user_quiz_info_manager');
const db_manager = require('../../quizbot/managers/db_manager.js');
const { WebHandoffUI } = require('../../quizbot/quiz_ui/web-handoff-ui');
const { UserQuizInfoUI } = require('../../quizbot/quiz_ui/user-quiz-info.ui');

const makeUserQuizInfo = (quiz_id, title) =>
{
  const info = new user_quiz_info_manager.UserQuizInfo();
  info.quiz_id = quiz_id;
  info.data.quiz_title = title;
  info.data.creator_name = '테스터';
  info.data.birthtime = new Date('2026-01-01');
  info.data.modified_time = new Date('2026-01-01');
  info.question_list = [{}, {}, {}]; //3문제짜리로 취급
  return info;
};

const fakeInteraction = () => ({
  guild: { id: 'guild_test' },
  member: { id: 'owner_test', displayName: '테스터' },
});

test('WebHandoffUI.buildUserQuizInfoUI: quiz_id로 UserQuizInfo를 조회해 UserQuizInfoUI를 appendNewUI/updateUI로 반영한다', async (t) =>
{
  t.mock.method(user_quiz_info_manager, 'loadUserQuizInfoById', async (quiz_id) =>
  {
    assert.equal(quiz_id, 1);
    return makeUserQuizInfo(1, '유저 퀴즈 1');
  });

  const ui = new WebHandoffUI('dev', fakeInteraction());

  let appended = undefined;
  let update_called = false;
  ui.holder = {
    appendNewUI: (next_ui) => { appended = next_ui; },
    updateUI: () => { update_called = true; },
  };

  await ui.buildUserQuizInfoUI({ mode: 'user', quiz_id: 1, selected_question_count: 2 });

  assert.ok(appended instanceof UserQuizInfoUI);
  assert.equal(appended.quiz_info['selected_question_count'], 2); //onReady()의 fillInfoAsDevQuizInfo가 덮어쓰기 전에 미리 채워짐
  assert.ok(update_called);
});

test('WebHandoffUI.buildUserQuizInfoUI: 화면이 이미 다른 곳으로 넘어갔으면(holder undefined) 아무것도 하지 않는다', async (t) =>
{
  t.mock.method(user_quiz_info_manager, 'loadUserQuizInfoById', async () => makeUserQuizInfo(1, '유저 퀴즈 1'));

  const ui = new WebHandoffUI('dev', fakeInteraction());
  ui.holder = undefined; //뒤로가기 등으로 이미 사라진 상태

  await assert.doesNotReject(() => ui.buildUserQuizInfoUI({ mode: 'user', quiz_id: 1, selected_question_count: 2 }));
});

test('UserQuizInfoUI.onReceivedWebSessionSignal: 확정 후 다른 유저 퀴즈로 재선택하면 같은 인스턴스를 그대로 갱신한다', async (t) =>
{
  t.mock.method(user_quiz_info_manager, 'loadUserQuizInfoById', async (quiz_id) =>
  {
    assert.equal(quiz_id, 2);
    return makeUserQuizInfo(2, '유저 퀴즈 2');
  });
  //reapplyFromWebPayload가 새로 조회한 UserQuizInfo에 대해 loadQuestionListFromDB()를 직접 호출하므로
  //(question_count를 최신으로 유지하기 위함) db_manager.selectQuestionInfo도 경계에서 mock한다.
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [{ question_id: 1 }] }));

  const initial_info = makeUserQuizInfo(1, '유저 퀴즈 1');
  const ui = new UserQuizInfoUI(initial_info, true);
  ui.quiz_info['selected_question_count'] = 3;

  let update_called = false;
  //reapplyFromWebPayload는 update() 대신 sendDelayedUI(this, true)로 강제 재전송한다(2026-08-15,
  //웹 재선택 시 새 썸네일 이미지가 embed edit로는 간헐적으로 안 불러와지는 버그 수정)
  ui.holder = {
    updateUI: () => { update_called = true; },
    sendDelayedUI: () => { update_called = true; },
  };

  const result = ui.onReceivedWebSessionSignal({
    event: 'applied',
    payload: { mode: 'user', quiz_id: 2, selected_question_count: 1 },
  });

  assert.equal(result, undefined); //fire-and-forget이라 동기 반환값은 undefined (UIHolder.on()의 onUIReceived가 무시함)

  //reapplyFromWebPayload는 onReceivedWebSessionSignal 안에서 fire-and-forget으로 시작되므로,
  //내부 await(loadUserQuizInfoById -> loadQuestionListFromDB)가 끝날 때까지 마이크로태스크를 흘려보낸다.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ui.user_quiz_info.quiz_id, 2);
  assert.equal(ui.quiz_info.title, '유저 퀴즈 2');
  assert.equal(ui.quiz_info['selected_question_count'], 1);
  assert.ok(update_called);
});

test('UserQuizInfoUI.onReceivedWebSessionSignal: applied가 아닌 이벤트는 무시한다', () =>
{
  const initial_info = makeUserQuizInfo(1, '유저 퀴즈 1');
  const ui = new UserQuizInfoUI(initial_info, true);
  ui.holder = { updateUI: () => {} };

  const result = ui.onReceivedWebSessionSignal({ event: 'expired', payload: {} });

  assert.equal(result, undefined);
  assert.equal(ui.user_quiz_info.quiz_id, 1); //바뀌지 않아야 함
});
