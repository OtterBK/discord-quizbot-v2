'use strict';

//퀴즈함 관리+프리셋 UI(docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md, 2026-08-18 신설, 같은 날 후속으로
//프리셋 관리(이름변경/항목제거/전체삭제)+방장 권한 모델 추가) - basket-manage-flow.ts 회귀 테스트.
//이 모듈은 QuizbotUI/UIHolder 프레임워크 밖에서 자체적으로 응답을 처리하는 독립 플로우라서
//(admin-panel-ui.ts의 report_manual_processing.sendReportLog와 동일 계열), 화면 클래스처럼 생김새를
//검증하기보다 "onInteractionCreate 체인에 절대 Promise를 반환하지 않는다"는 계약과 "방장이 아니면
//라이브 퀴즈함을 못 건드린다"는 권한 모델을 집중 검증한다 - 전자는 admin-season-ui.ts에서 실제로 겪은
//사고(async 핸들러가 Promise를 그대로 반환해서 appendNewUI가 그걸 새 화면으로 오인해 크래시)와 동일한
//함정이 여기도 있을 수 있어서.

const test = require('node:test');
const assert = require('node:assert/strict');

const db_manager = require('../../quizbot/managers/db_manager.js');
const basket_manage_flow = require('../../quizbot/quiz_ui/basket-manage-flow');

test('isBasketManageEvent: basket_manage_ 접두사를 가진 customId만 true를 반환한다', () =>
{
  assert.equal(basket_manage_flow.isBasketManageEvent({ customId: 'basket_manage_open' }), true);
  assert.equal(basket_manage_flow.isBasketManageEvent({ customId: 'basket_manage_manage_delete_confirmed:5' }), true);
  assert.equal(basket_manage_flow.isBasketManageEvent({ customId: 'modal_basket_preset_save' }), false); //모달은 별도 접두사(isBasketManageModalEvent)
  assert.equal(basket_manage_flow.isBasketManageEvent({ customId: 'use_basket_mode' }), false);
  assert.equal(basket_manage_flow.isBasketManageEvent({ customId: 'start' }), false);
  assert.equal(basket_manage_flow.isBasketManageEvent({}), false);
});

test('isBasketManageModalEvent: modal_basket_preset_ 접두사를 가진 customId만 true를 반환한다', () =>
{
  assert.equal(basket_manage_flow.isBasketManageModalEvent({ customId: 'modal_basket_preset_save' }), true);
  assert.equal(basket_manage_flow.isBasketManageModalEvent({ customId: 'modal_basket_preset_rename:5' }), true);
  assert.equal(basket_manage_flow.isBasketManageModalEvent({ customId: 'basket_manage_open' }), false);
  assert.equal(basket_manage_flow.isBasketManageModalEvent({ customId: 'modal_new_season_name' }), false);
  assert.equal(basket_manage_flow.isBasketManageModalEvent({}), false);
});

test('handleBasketManageEvent: 내부 핸들러가 async여도 항상 undefined를 동기로 반환한다(Promise 반환 금지)', (t) =>
{
  t.mock.method(db_manager, 'selectRandomQuizPresetsByUser', async () => undefined);

  const interaction = {
    customId: 'basket_manage_open',
    user: { id: 'user_1' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async () => {},
  };

  const room_ui = { quiz_info: { basket_items: {}, room_owner: 'user_1' } };
  const result = basket_manage_flow.handleBasketManageEvent(interaction, room_ui);

  assert.equal(result, undefined); //Promise가 아니라 즉시 undefined여야 함(onInteractionCreate 체인 안전 계약)
});

test('handleBasketManageEvent: 인식하지 못하는 basket_manage_ customId는 아무 것도 하지 않고 undefined를 반환한다', () =>
{
  const interaction = {
    customId: 'basket_manage_unknown_action',
    user: { id: 'user_1' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
  };

  const result = basket_manage_flow.handleBasketManageEvent(interaction, { quiz_info: { room_owner: 'user_1' } });

  assert.equal(result, undefined);
});

test('handleBasketManageEvent: 방장이 아니면 퀴즈함 항목 제거는 안 되지만(조회는 가능하니 select는 활성 상태) 안내와 함께 원래 화면으로 되돌아간다', () =>
{
  const basket_items = { 1: { quiz_id: 1, title: 'A' } };
  let captured;

  const interaction = {
    customId: 'basket_manage_item_select_1',
    user: { id: 'not_the_owner' },
    values: ['1'],
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    update: (payload) => { captured = payload; },
  };

  const room_ui = { quiz_info: { basket_items, room_owner: 'owner_1' }, refreshUI: () => {}, update: () => {} };
  basket_manage_flow.handleBasketManageEvent(interaction, room_ui);

  assert.deepEqual(basket_items, { 1: { quiz_id: 1, title: 'A' } }); //제거되지 않아야 함
  assert.ok(captured.embeds[0].description.includes('방장만 할 수 있어요')); //안내 문구와 함께 원래 화면으로 복귀
});

test('handleBasketManageEvent: 방장이 아니어도 현재 퀴즈함을 프리셋으로 저장할 수 있다(라이브 상태를 읽기만 할 뿐 건드리지 않으므로)', () =>
{
  let modal_shown = false;
  const interaction = {
    customId: 'basket_manage_save_request',
    user: { id: 'not_the_owner' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    showModal: () => { modal_shown = true; },
  };

  const room_ui = { quiz_info: { basket_items: { 1: { quiz_id: 1, title: 'A' } }, room_owner: 'owner_1' } };
  basket_manage_flow.handleBasketManageEvent(interaction, room_ui);

  assert.equal(modal_shown, true);
});

test('handleBasketManageEvent: 방장이면 퀴즈함 항목 제거가 정상 처리되고 메인 화면이 동기화된다', () =>
{
  const basket_items = { 1: { quiz_id: 1, title: 'A' }, 2: { quiz_id: 2, title: 'B' } };
  let captured;
  let refreshed = false;
  let updated = false;

  const interaction = {
    customId: 'basket_manage_item_select_1',
    user: { id: 'owner_1' },
    values: ['1'],
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    update: async (payload) => { captured = payload; },
  };

  const room_ui = {
    quiz_info: { basket_items, room_owner: 'owner_1' },
    refreshUI: () => { refreshed = true; },
    update: () => { updated = true; },
  };

  basket_manage_flow.handleBasketManageEvent(interaction, room_ui);

  //비동기 내부 처리 완료까지 한 틱 대기
  return new Promise((resolve) => setTimeout(() => {
    assert.deepEqual(Object.keys(basket_items), ['2']); //1번만 제거됨
    assert.equal(refreshed, true);
    assert.equal(updated, true);
    assert.ok(captured.embeds[0].description.includes('1개를 제거'));
    resolve();
  }, 50));
});

test('handleBasketManageEvent: 방장이 아니어도 프리셋 관리 화면 진입은 허용한다(개인 기능, 방 소유권과 무관)', (t) =>
{
  t.mock.method(db_manager, 'selectRandomQuizPresetsByUser', async () => ({ rows: [] }));

  let captured;
  const interaction = {
    customId: 'basket_manage_manage_request',
    user: { id: 'not_the_owner' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    update: async (payload) => { captured = payload; },
  };

  const room_ui = { quiz_info: { room_owner: 'owner_1' } };
  basket_manage_flow.handleBasketManageEvent(interaction, room_ui);

  return new Promise((resolve) => setTimeout(() => {
    assert.ok(captured.embeds[0].description.includes('편집할 프리셋을 선택해주세요'));
    assert.ok(captured.embeds[0].description.includes('웹 UI에서 편집하면 더 편해요'));
    resolve();
  }, 50));
});

//프리셋 관리의 항목 제거 UI는 웹 상한(100개)까지 select 2행이 아니라 scoreboard-ui.ts와 동일한
//prev/next 페이지네이션(25개씩)으로 처리한다 - "웹에서만 편집 가능"한 상한이 없어짐(2026-08-18
//같은 날 세 번째 후속). 페이지 경계(첫/마지막 페이지 버튼 비활성화)와 페이지 이동이 정확한지 검증.
test('프리셋 관리 상세: 100개짜리 프리셋이 25개씩 4페이지로 나뉘고, prev/next로 정확히 이동한다', (t) =>
{
  const full_ids = Array.from({ length: 100 }, (_, i) => i + 1);
  t.mock.method(db_manager, 'selectRandomQuizPresetsByUser', async () => ({
    rows: [{ preset_id: 1, preset_name: '큰프리셋', quiz_id_list: full_ids }],
  }));
  t.mock.method(db_manager, 'selectQuizInfoByIds', async (ids) => ({ rows: ids.map((id) => ({ quiz_id: id, quiz_title: `Q${id}` })) }));

  let captured;
  const select_interaction = {
    customId: 'basket_manage_manage_select', user: { id: 'u1' }, values: ['1'],
    isButton: () => false, isStringSelectMenu: () => true, isModalSubmit: () => false,
    update: async (payload) => { captured = payload; },
  };
  basket_manage_flow.handleBasketManageEvent(select_interaction, { quiz_info: { room_owner: 'owner_1' } });

  return new Promise((resolve) => setTimeout(() => {
    assert.ok(captured.embeds[0].description.includes('1 / 4 페이지'));
    const page1_menu = captured.components[0].components[0];
    assert.equal(page1_menu.options.length, 25);
    assert.equal(page1_menu.data.custom_id, 'basket_manage_manage_item_select:1:0');

    const [prev_btn, next_btn] = captured.components[1].components;
    assert.equal(prev_btn.data.disabled, true); //첫 페이지라 이전 버튼 비활성화
    assert.equal(next_btn.data.disabled, false);

    //다음 페이지로 이동
    let captured2;
    const next_interaction = {
      customId: next_btn.data.custom_id, user: { id: 'u1' },
      isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
      update: async (payload) => { captured2 = payload; },
    };
    basket_manage_flow.handleBasketManageEvent(next_interaction, { quiz_info: { room_owner: 'owner_1' } });

    setTimeout(() => {
      assert.ok(captured2.embeds[0].description.includes('2 / 4 페이지'));
      const page2_menu = captured2.components[0].components[0];
      assert.equal(page2_menu.data.custom_id, 'basket_manage_manage_item_select:1:1');
      assert.equal(page2_menu.options[0].data.value, '26'); //두 번째 페이지는 26번째 항목부터

      //마지막 페이지(인덱스 2에서 next)로 이동 - 다음 버튼이 비활성화돼야 함
      let captured3;
      const last_interaction = {
        customId: 'basket_manage_manage_page_next:1:2', user: { id: 'u1' },
        isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
        update: async (payload) => { captured3 = payload; },
      };
      basket_manage_flow.handleBasketManageEvent(last_interaction, { quiz_info: { room_owner: 'owner_1' } });

      setTimeout(() => {
        assert.ok(captured3.embeds[0].description.includes('4 / 4 페이지'));
        const [, last_next_btn] = captured3.components[1].components;
        assert.equal(last_next_btn.data.disabled, true); //마지막 페이지라 다음 버튼 비활성화
        resolve();
      }, 50);
    }, 50);
  }, 50));
});

//실사용 중 실제로 재현된 버그(DiscordAPIError[40060] Interaction has already been acknowledged) -
//DB 조회가 끝나기 전에 explicit_replied를 늦게 설정하면, 그 사이 bot.js 전역 fallback이 먼저
//deferUpdate()를 호출해버려서 나중에 진짜 응답(interaction.update() 등)이 실패한다
//(user-question-info-ui.ts의 duplicateQuestion에도 있는 동일 교훈). 첫 await 이전에 동기적으로
//설정됐는지를 "DB 조회가 아직 안 끝난 시점"에 직접 확인해서 회귀를 막는다.
test('DB 조회가 필요한 모든 핸들러는 첫 await 전에 explicit_replied를 동기적으로 설정한다(응답 충돌 방지)', async (t) =>
{
  //db_manager 호출이 즉시 resolve되지 않게 만들어서, "아직 await 중인 시점"에 flag가 이미 설정돼
  //있는지를 검증할 수 있는 창을 인위적으로 늘림.
  let resolve_db_call;
  const pending = new Promise((resolve) => { resolve_db_call = resolve; });
  t.mock.method(db_manager, 'selectRandomQuizPresetsByUser', () => pending);

  const cases = [
    { customId: 'basket_manage_load_request', isButton: true, room_owner: 'u1' },
    { customId: 'basket_manage_manage_request', isButton: true, room_owner: 'someone_else' },
  ];

  for(const test_case of cases)
  {
    const interaction = {
      customId: test_case.customId,
      user: { id: 'u1' },
      isButton: () => test_case.isButton,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      update: async () => {},
      reply: async () => {},
    };

    basket_manage_flow.handleBasketManageEvent(interaction, { quiz_info: { room_owner: test_case.room_owner } });

    //아직 DB 조회가 안 끝난 시점(동기 실행 직후) - 여기서 이미 true여야 함.
    assert.equal(interaction.explicit_replied, true, `${test_case.customId}: DB 조회 완료 전에 이미 설정돼 있어야 함`);
  }

  resolve_db_call({ rows: [] });
  await new Promise((resolve) => setTimeout(resolve, 50)); //남은 프로미스 체인 정리
});
