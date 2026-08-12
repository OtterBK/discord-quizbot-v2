'use strict';

//quiz_ui/components.js에서 도메인별로 분리된 quiz_ui/components/*.js(REFACTOR_PLAN.md Phase 4)에
//대한 회귀 방지 테스트. UI 컴포넌트 정의 자체는 정적 데이터라 "로직" 검증보다는
//분리 과정에서 이름이 빠지거나 구조가 깨지지 않았는지 확인하는 데 집중한다.
//특히 modal_quiz_setting/modal_omakase_quiz_setting/modal_multiplayer_quiz_setting이
//일부러 같은 customId를 공유하는 부분(components.js 원본 주석 참고, applyQuizSetting
//핸들러가 이 customId로 라우팅됨)은 실수로 깨지기 쉬워 명시적으로 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const components = require('../../quizbot/quiz_ui/components');
const base_components = require('../../quizbot/quiz_ui/components/base_components');
const custom_quiz_components = require('../../quizbot/quiz_ui/components/custom_quiz_components');
const omakase_components = require('../../quizbot/quiz_ui/components/omakase_components');
const multiplayer_components = require('../../quizbot/quiz_ui/components/multiplayer_components.js');
const report_components = require('../../quizbot/quiz_ui/components/report_components');
const web_handoff_components = require('../../quizbot/quiz_ui/components/web_handoff_components');

test('components.js: 6개 도메인 파일의 export를 빠짐없이 재수출한다 (총 64개)', () =>
{
  // 죽은 export였던 note_ui_component는 Phase 6에서 삭제됨 (DEPRECATED_CODE_REMOVED.md 참고)
  // quiz_delete_confirm_admin_comp/admin_panel_comp는 관리자 기능 추가로 신설됨
  // select_quiz_type_btn_component는 SelectQuizTypeUI 전용 3버튼(죽은 버튼 정리)으로 신설됨
  // multiplayer_leave_confirm_comp/multiplayer_kick_confirm_comp는 파괴적 동작 확인 절차 추가로 신설됨
  // admin_ban_unban_confirm_comp는 밴 해제 확인 절차 추가로 신설됨
  // question_preview_comp는 B-2(문제 미리듣기) 구현으로 신설됨(이미지 재로드 버튼도 question_edit_comp에서 이쪽으로 이동)
  // force_take_comp(2026-08-13 이전 이름: web_handoff_force_take_comp)는 하이재킹 방어(Phase 1)로 신설됨
  // select_ui_mode_btn_component는 퀴즈 선택 웹 연동 투트랙 진입(SelectUIModeUI) 신설로 추가됨
  const expected_names = [
    ...Object.keys(base_components),
    ...Object.keys(custom_quiz_components),
    ...Object.keys(omakase_components),
    ...Object.keys(multiplayer_components),
    ...Object.keys(report_components),
    ...Object.keys(web_handoff_components),
  ].sort();

  const actual_names = Object.keys(components).sort();

  assert.equal(actual_names.length, 64);
  assert.deepEqual(actual_names, expected_names);
});

test('components.js: 도메인 파일 사이에 이름이 겹치지 않는다', () =>
{
  const all_names = [
    ...Object.keys(base_components),
    ...Object.keys(custom_quiz_components),
    ...Object.keys(omakase_components),
    ...Object.keys(multiplayer_components),
    ...Object.keys(report_components),
    ...Object.keys(web_handoff_components),
  ];

  assert.equal(new Set(all_names).size, all_names.length);
});

test('modal_quiz_setting/modal_omakase_quiz_setting/modal_multiplayer_quiz_setting은 일부러 같은 customId를 공유한다', () =>
{
  // components.js 원본 주석: "modal_quiz_setting으로 해둬야. applyQuizSetting이 호출됨"
  assert.equal(components.modal_quiz_setting.data.custom_id, 'modal_quiz_setting');
  assert.equal(components.modal_omakase_quiz_setting.data.custom_id, 'modal_quiz_setting');
  assert.equal(components.modal_multiplayer_quiz_setting.data.custom_id, 'modal_quiz_setting');
});

test('createOptionValueComponents: 옵션 이름에 따라 서로 다른 선택지를 만든다', () =>
{
  const audio_row = base_components.createOptionValueComponents('audio_play_time');
  const hint_row = base_components.createOptionValueComponents('hint_type');

  // customId는 'option_value_select'로 공통이지만, 옵션 목록은 option_name별로 달라야 한다
  assert.equal(audio_row.components[0].data.custom_id, 'option_value_select');
  assert.notDeepEqual(audio_row.components[0].options, hint_row.components[0].options);
});

test('option_value_components: 9개 옵션 키 전부에 대해 select row를 만든다', () =>
{
  assert.equal(Object.keys(base_components.option_value_components).length, 9);
});

test('quiz_tags_select_menu/quiz_search_tags_select_menu: QUIZ_TAG 태그 수만큼 옵션이 생긴다', () =>
{
  const { QUIZ_TAG } = require('../../config/system_setting.js');
  const expected_count = Object.keys(QUIZ_TAG).length;

  assert.equal(custom_quiz_components.quiz_tags_select_menu.components[0].options.length, expected_count);
  assert.equal(custom_quiz_components.quiz_search_tags_select_menu.components[0].options.length, expected_count);
});

test('omakase_custom_quiz_type_tags_select_menu/omakase_custom_quiz_tags_select_menu: tag_value 0은 두 목록에 모두 포함되고, 나머지는 정확히 한쪽에만 포함된다', () =>
{
  const { QUIZ_TAG } = require('../../config/system_setting.js');
  const total_tag_count = Object.keys(QUIZ_TAG).length;

  const type_tags_count = omakase_components.omakase_custom_quiz_type_tags_select_menu.components[0].options.length;
  const genre_tags_count = omakase_components.omakase_custom_quiz_tags_select_menu.components[0].options.length;

  // tag_value === 0인 태그 하나가 두 select menu 모두에 중복으로 들어가는 게 원본 로직의 의도된 동작
  assert.equal(type_tags_count + genre_tags_count, total_tag_count + 1);
});

test('select_btn_component/select_btn_component2: 각각 5개씩 버튼을 만든다 (1~5, 6~10)', () =>
{
  assert.equal(base_components.select_btn_component.components.length, 5);
  assert.equal(base_components.select_btn_component2.components.length, 5);
  assert.equal(base_components.select_btn_component.components[0].data.custom_id, '1');
  assert.equal(base_components.select_btn_component2.components[0].data.custom_id, '6');
});
