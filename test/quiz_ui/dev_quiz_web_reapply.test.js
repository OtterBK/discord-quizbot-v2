'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) 회귀 테스트.
//2026-08-08 실사용 테스트에서 발견된 버그: dev-quiz-select-ui.ts <-> dev-quiz-info-ui.ts 순환 require
//때문에, 실제 bot.js 로드 순서(ui-system-core -> web-handoff-ui -> dev-quiz-select-ui -> dev-quiz-info-ui)로
//require하면 dev-quiz-info-ui.ts가 캡처하는 DevQuizSelectUI가 undefined가 되어 확정 후 재선택 시
//"Cannot read properties of undefined (reading 'buildDevQuizInfoFromWebPayload')"로 죽었음.
//dev-quiz-info-ui.ts에서 require를 함수 안으로 미뤄서 고쳤고(순환 자체는 여전히 존재).
//
//ui-system-core.ts를 통해서 로드하고 싶지만, main-ui.ts -> select-quiz-type-ui.ts가
//require("./user-quiz-select-ui.js")처럼 .js 확장자를 하드코딩해 둔 곳이 있어서(dist/ 빌드 후
//.ts->.js로 실제로 이름이 바뀌는 걸 전제로 함, tsconfig.json 주석 참고) ts-node로 소스를 직접 실행하는
//node:test에서는 그 경로 자체가 MODULE_NOT_FOUND로 죽는다(quiz_ui 트리 전체를 유닛테스트하지 않는
//관례의 실제 이유). 다행히 순환 require는 dev-quiz-select-ui.ts <-> dev-quiz-info-ui.ts 딱 이 둘
//사이에서만 일어나므로, 이 둘만 직접 require해도 버그를 그대로 재현/검증할 수 있다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { DevQuizSelectUI } = require('../../quizbot/quiz_ui/dev-quiz-select-ui'); //반드시 dev-quiz-info-ui보다 먼저 - 순환의 첫 진입점이 이쪽이어야 버그가 있었을 때 재현됨
const { DevQuizInfoUI } = require('../../quizbot/quiz_ui/dev-quiz-info-ui');

const findFirstTwoLeaves = () =>
{
  const leaves = [];
  const walk = (nodes) =>
  {
    for(const node of nodes)
    {
      if(leaves.length >= 2)
      {
        return;
      }
      if(node.is_quiz)
      {
        leaves.push(node);
      }
      else if(node.sub_contents !== undefined)
      {
        walk(node.sub_contents);
      }
    }
  };
  walk(DevQuizSelectUI.quiz_contents_sorted_by_name);
  return leaves;
};

test('순환 require 회귀: 실제 로드 순서로 require해도 buildDevQuizInfoFromWebPayload가 undefined가 아니다', () =>
{
  assert.equal(typeof DevQuizSelectUI, 'function');
  assert.equal(typeof DevQuizSelectUI.buildDevQuizInfoFromWebPayload, 'function');
});

test('DevQuizInfoUI.onReceivedWebSessionSignal: 확정 후 다른 퀴즈로 재선택하면 같은 인스턴스를 그대로 갱신한다', () =>
{
  const [quiz1, quiz2] = findFirstTwoLeaves();
  assert.notEqual(quiz1, undefined, '테스트하려면 공식 퀴즈가 최소 2개 있어야 함');
  assert.notEqual(quiz2, undefined, '테스트하려면 공식 퀴즈가 최소 2개 있어야 함');

  const initial_info = DevQuizSelectUI.generateDevQuizInfo(quiz1);
  initial_info.selected_question_count = 5;

  const ui = new DevQuizInfoUI(initial_info);
  ui.holder = { updateUI: () => {} }; //update()가 죽지 않게 최소 mock

  const result = ui.onReceivedWebSessionSignal({
    event: 'applied',
    payload: { content_path: quiz2.content_path, selected_question_count: 7 },
  });

  assert.equal(result, ui); //새 인스턴스가 아니라 같은 인스턴스를 반환해야 함(prev_ui_stack 누적 방지)
  assert.equal(ui.quiz_info.title, quiz2.name);
  assert.equal(ui.quiz_info.selected_question_count, 7);
});

test('DevQuizInfoUI.onReceivedWebSessionSignal: applied가 아닌 이벤트는 무시한다', () =>
{
  const [quiz1] = findFirstTwoLeaves();
  const initial_info = DevQuizSelectUI.generateDevQuizInfo(quiz1);

  const ui = new DevQuizInfoUI(initial_info);
  ui.holder = { updateUI: () => {} };

  const result = ui.onReceivedWebSessionSignal({ event: 'expired', payload: {} });

  assert.equal(result, undefined);
  assert.equal(ui.quiz_info.title, quiz1.name); //바뀌지 않아야 함
});
