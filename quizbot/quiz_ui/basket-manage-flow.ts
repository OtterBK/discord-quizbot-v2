'use strict';

//퀴즈함 관리 + 프리셋 저장/불러오기/관리(이름변경/항목제거/삭제) (docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md,
//2026-08-18 신설, 같은 날 후속 설계 확장). OmakaseQuizRoomUI 전용(멀티플레이 로비는 스코프 밖 -
//계획서 참고). QuizbotUI/UIHolder 프레임워크를 상속하지 않는 독립 ephemeral 플로우 - admin-panel-ui.ts가
//report_manual_processing.sendReportLog를 호출만 하고 자체적으로 응답 처리하게 두는 기존 패턴과 같은
//계열. interaction.reply()로 최초 ephemeral 응답을 만들고, 이후 그 메시지 위의 컴포넌트는
//interaction.update()(discord.js가 제공하는 "이 컴포넌트가 속한 메시지 자체를 편집"하는 API)로 자기
//자신만 갱신한다 - 메인 화면(OmakaseQuizRoomUI)의 UIHolder/persistent message와는 완전히 독립된
//메시지라서, 퀴즈함 내용이 바뀔 때마다 room_ui.refreshUI() + room_ui.update()를 직접 호출해 메인 화면
//"퀴즈함 N개" 문구를 명시적으로 동기화해야 한다(설계 중 발견한 핵심 함정 - 두 메시지가 독립적이라
//자동으로 안 맞춰짐).
//
//권한 모델(2026-08-18 설계 확정): 라이브 퀴즈함(공유 상태)을 건드리는 액션(항목 제거/저장/불러오기)은
//방장(quiz_info.room_owner)만 가능 - 방장이 아니면 목록이 읽기 전용(select.setDisabled(true))으로
//뜨고 "프리셋 관리" 버튼만 보인다. "프리셋 관리"(자기 프리셋 이름변경/항목제거/전체삭제)는 라이브
//퀴즈함과 무관한 순수 개인 기능이라 방장 여부와 무관하게 누구나 접근 가능. 방장이 항목을 지워도 이미
//열려있는 다른 사람의 조회 화면엔 실시간 반영 안 함(설계 확정 - ephemeral 메시지 특성상 자연스러움).
//
//화면 상태는 4가지(전부 이 하나의 ephemeral 메시지를 interaction.update()로 계속 다시 그리는 것 -
//상태를 인스턴스로 안 들고 다니고 customId에 필요한 값(preset_id 등)을 직접 인코딩해서 무상태로 처리):
//  main              - 퀴즈함 목록(방장만 제거 가능) + 저장/불러오기/관리 버튼(방장) or 관리 버튼만(비방장)
//  preset_load_list  - (방장 전용) 내 프리셋 목록, 선택하면 즉시 불러와서 main으로 복귀
//  preset_manage_list- 내 프리셋 목록, 선택하면 preset_manage_detail로 이동
//  preset_manage_detail - 선택한 프리셋의 항목 목록(제거 가능, 25개씩 페이지네이션) + 이름변경/전체삭제 버튼

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');

const db_manager = require('../managers/db_manager.js');
const { modal_basket_preset_save } = require('./components');

//유저당 프리셋 최대 개수/이름 최대 길이 - web_express_app.ts의 RANDOM_QUIZ_PRESET_MAX_COUNT/
//RANDOM_QUIZ_PRESET_NAME_MAX_LENGTH와 동일 값(웹과 동일 정책, 공유 상수 모듈은 없어 각자 들고 있음 -
//기존 관행).
const PRESET_MAX_COUNT = 10;
const PRESET_NAME_MAX_LENGTH = 30;

//StringSelectMenu 하나당 Discord API 하드캡(퀴즈함 25→50 확장, docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md
//Phase A) - 25개 넘으면 select 2행으로 나눈다. 라이브 퀴즈함(main 상태)은 최대 50개라 이 방식으로 충분.
const ITEM_SELECT_PAGE_SIZE = 25;

//프리셋 자체는 웹에서 최대 100개까지 저장 가능(RANDOM_QUIZ_PRESET_ITEM_MAX_COUNT, web_express_app.ts) -
//라이브 퀴즈함 한도(50)보다 커서 select 2행(최대 50개)으로는 다 못 담는다. "프리셋 관리" 화면은 대신
//scoreboard-ui.ts의 TOP50 페이지네이션과 동일한 패턴(버튼으로 페이지 이동, 한 페이지에 25개씩)을 써서
//100개든 그 이상이든 행 예산(select 1행 + prev/next 1행 + 이름변경/삭제 1행 + 뒤로가기 1행 = 4행)
//안에서 전부 다룬다 - "웹에서만 편집 가능"한 상한이 없어짐.

//#region 정적 컴포넌트(런타임 값 필요 없는 것만 - 나머지는 매번 동적으로 만듦, scoreboard-ui.ts와 동일 관행)

function buildRenameModal(preset_id: number, page: number, current_name: string): any
{
  return new ModalBuilder()
    .setCustomId(`modal_basket_preset_rename:${preset_id}:${page}`)
    .setTitle('프리셋 이름 변경')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_basket_preset_rename')
          .setLabel(`새 이름 (최대 ${PRESET_NAME_MAX_LENGTH}자)`)
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(PRESET_NAME_MAX_LENGTH)
          .setValue(current_name),
      ),
    );
}

//#endregion

exports.isBasketManageEvent = (interaction: any): boolean =>
{
  return typeof interaction.customId === 'string' && interaction.customId.startsWith('basket_manage_');
};

exports.isBasketManageModalEvent = (interaction: any): boolean =>
{
  return typeof interaction.customId === 'string' && interaction.customId.startsWith('modal_basket_preset_');
};

//onInteractionCreate 체인에서 항상 undefined를 반환 - 이 플로우는 OmakaseQuizRoomUI의 화면 전환이
//아니라 자체적으로 응답까지 처리하는 사이드 플로우라서(내부 핸들러가 async라도 fire-and-forget으로만
//호출 - Promise를 그대로 반환하면 UI 프레임워크가 그걸 새 화면 인스턴스로 오인해 크래시남, 2026-08-15
//admin-season-ui.ts에서 겪은 버그와 동일 함정).
exports.handleBasketManageEvent = (interaction: any, room_ui: any): undefined =>
{
  const is_host = interaction.user.id === room_ui.quiz_info['room_owner'];

  if(interaction.isButton() && interaction.customId === 'basket_manage_open')
  {
    openMainView(interaction, room_ui, is_host);
    return undefined;
  }

  //--- main 상태 (라이브 퀴즈함 항목 제거/불러오기만 방장 전용 - 조회/저장은 누구나 가능) ---
  if(interaction.isStringSelectMenu() && (interaction.customId === 'basket_manage_item_select_1' || interaction.customId === 'basket_manage_item_select_2'))
  {
    if(is_host) { handleItemSelect(interaction, room_ui); }
    else { renderMainView(interaction, room_ui, false, `🔒 퀴즈함에서 제거하는 건 방장만 할 수 있어요.`); } //select는 비활성화하지 않아 누구나 열어서 목록을 볼 수 있음 - 선택해도 제거는 안 되고 안내만 뜸
    return undefined;
  }

  //현재 퀴즈함을 프리셋으로 저장하는 건 라이브 퀴즈함을 읽기만 할 뿐 건드리지 않으니(개인 프리셋에
  //복사) 방장이 아니어도 허용(2026-08-18 실사용 피드백 - 처음엔 방장 전용으로 설계했었음).
  if(interaction.isButton() && interaction.customId === 'basket_manage_save_request')
  {
    handleSaveRequest(interaction);
    return undefined;
  }

  if(interaction.isModalSubmit() && interaction.customId === 'modal_basket_preset_save')
  {
    handleSaveSubmit(interaction, room_ui);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId === 'basket_manage_load_request')
  {
    if(is_host) { renderPresetLoadList(interaction, undefined); }
    return undefined;
  }

  if(interaction.isButton() && interaction.customId === 'basket_manage_load_back')
  {
    renderMainView(interaction, room_ui, is_host, undefined);
    return undefined;
  }

  if(interaction.isStringSelectMenu() && interaction.customId === 'basket_manage_load_select')
  {
    if(is_host) { handleLoad(interaction, room_ui); }
    return undefined;
  }

  //--- 프리셋 관리 (방장 여부 무관 - 개인 기능) ---
  if(interaction.isButton() && interaction.customId === 'basket_manage_manage_request')
  {
    renderPresetManageList(interaction, undefined);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId === 'basket_manage_manage_back')
  {
    renderMainView(interaction, room_ui, is_host, undefined);
    return undefined;
  }

  if(interaction.isStringSelectMenu() && interaction.customId === 'basket_manage_manage_select')
  {
    handleManageSelect(interaction);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId === 'basket_manage_manage_detail_back')
  {
    renderPresetManageList(interaction, undefined);
    return undefined;
  }

  if(interaction.isStringSelectMenu() && interaction.customId.startsWith('basket_manage_manage_item_select:'))
  {
    handleManageItemRemove(interaction);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_page_prev:'))
  {
    handleManagePageChange(interaction, -1);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_page_next:'))
  {
    handleManagePageChange(interaction, 1);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_rename_request:'))
  {
    handleRenameRequest(interaction);
    return undefined;
  }

  if(interaction.isModalSubmit() && interaction.customId.startsWith('modal_basket_preset_rename:'))
  {
    handleRenameSubmit(interaction);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_delete_request:'))
  {
    handleManageDeleteRequest(interaction);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_delete_confirmed:'))
  {
    handleManageDeleteConfirmed(interaction);
    return undefined;
  }

  if(interaction.isButton() && interaction.customId.startsWith('basket_manage_manage_delete_cancel:'))
  {
    handleManageDeleteCancel(interaction);
    return undefined;
  }

  return undefined;
};

//#region 공통 조립 헬퍼

//select 자체는 방장이 아니어도 비활성화하지 않는다 - 비활성화하면 드롭다운을 열어볼 수조차 없어서
//"단순 조회"마저 막혀버림(2026-08-18 실사용 피드백으로 발견 - 최초 설계는 조회도 막았었음). 방장이
//아닌 사람이 실제로 선택해서 제출해도 handleBasketManageEvent가 제거 대신 안내만 띄우고 되돌린다.
function buildItemSelectRows(basket_items: any, is_host: boolean): any[]
{
  const entries = Object.entries(basket_items ?? {});

  if(entries.length === 0)
  {
    const empty_menu = new StringSelectMenuBuilder()
      .setCustomId('basket_manage_item_select_1')
      .setPlaceholder('퀴즈함이 비어있습니다.')
      .setDisabled(true)
      .addOptions({ label: '퀴즈함이 비어있습니다.', value: 'basket_manage_item_temp' });

    return [new ActionRowBuilder().addComponents(empty_menu)];
  }

  const rows = [];
  for(let page = 0; page * ITEM_SELECT_PAGE_SIZE < entries.length; ++page)
  {
    const page_entries = entries.slice(page * ITEM_SELECT_PAGE_SIZE, (page + 1) * ITEM_SELECT_PAGE_SIZE);

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`basket_manage_item_select_${page + 1}`)
      .setPlaceholder(is_host
        ? `선택하여 퀴즈함에서 제거하기 (${page * ITEM_SELECT_PAGE_SIZE + 1}~${page * ITEM_SELECT_PAGE_SIZE + page_entries.length}번째)`
        : `조회 전용 - 제거는 방장만 가능 (${page * ITEM_SELECT_PAGE_SIZE + 1}~${page * ITEM_SELECT_PAGE_SIZE + page_entries.length}번째)`)
      .setMaxValues(page_entries.length);

    for(const [quiz_id, item] of page_entries)
    {
      menu.addOptions({ label: `${(item as any).title}`, description: is_host ? '선택하여 퀴즈함에서 제거' : undefined, value: `${quiz_id}` });
    }

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

function buildPresetSelectMenu(custom_id: string, placeholder: string, presets: any[]): any
{
  const menu = new StringSelectMenuBuilder().setCustomId(custom_id).setPlaceholder(placeholder);

  for(const preset of presets)
  {
    menu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${preset.preset_name} (${preset.quiz_id_list.length}개)`)
        .setValue(`${preset.preset_id}`),
    );
  }

  return new ActionRowBuilder().addComponents(menu);
}

function withNotice(description: string, notice: string | undefined): string
{
  return notice === undefined ? description : `${description}\n\n${notice}`;
}

//#endregion

//#region main 상태

async function openMainView(interaction: any, room_ui: any, is_host: boolean): Promise<void>
{
  interaction.explicit_replied = true;
  await interaction.reply({ ...buildMainViewPayload(room_ui, is_host, undefined), flags: MessageFlags.Ephemeral });
}

function renderMainView(interaction: any, room_ui: any, is_host: boolean, notice: string | undefined): void
{
  interaction.explicit_replied = true;
  interaction.update(buildMainViewPayload(room_ui, is_host, notice));
}

function buildMainViewPayload(room_ui: any, is_host: boolean, notice: string | undefined): any
{
  const basket_items = room_ui.quiz_info['basket_items'] ?? {};
  const basket_item_count = Object.keys(basket_items).length;

  let description = `🧺 현재 퀴즈함: **${basket_item_count}개**`;
  if(is_host === false)
  {
    description += `\n🔒 방장만 여기서 퀴즈를 제거하거나 프리셋을 불러올 수 있어요. (조회/프리셋 저장은 누구나 가능)`;
  }
  description = withNotice(description, notice);

  const components = [...buildItemSelectRows(basket_items, is_host)];

  //저장(방장 여부 무관)/프리셋 관리(방장 여부 무관)는 항상 뜨고, 불러오기(라이브 퀴즈함을 통째로
  //덮어씀 - 방장 전용)만 방장일 때만 추가된다.
  const action_buttons = [
    new ButtonBuilder().setCustomId('basket_manage_save_request').setLabel('💾 프리셋 저장').setStyle(ButtonStyle.Primary).setDisabled(basket_item_count === 0),
  ];
  if(is_host)
  {
    action_buttons.push(new ButtonBuilder().setCustomId('basket_manage_load_request').setLabel('📥 불러오기').setStyle(ButtonStyle.Primary));
  }
  action_buttons.push(new ButtonBuilder().setCustomId('basket_manage_manage_request').setLabel('📋 프리셋 관리').setStyle(ButtonStyle.Secondary));

  components.push(new ActionRowBuilder().addComponents(...action_buttons));

  return { embeds: [{ color: 0x87CEEB, title: '🧺 퀴즈함 관리', description }], components };
}

async function handleItemSelect(interaction: any, room_ui: any): Promise<void>
{
  const basket_items = room_ui.quiz_info['basket_items'] ?? {};
  let remove_count = 0;
  for(const key of interaction.values)
  {
    const quiz_id = parseInt(key);
    if(isNaN(quiz_id)) { continue; }

    delete basket_items[quiz_id];
    ++remove_count;
  }

  room_ui.refreshUI();
  room_ui.update();

  renderMainView(interaction, room_ui, true, `🔸 퀴즈함에서 ${remove_count}개를 제거했습니다.`);
}

function handleSaveRequest(interaction: any): void
{
  interaction.explicit_replied = true;
  interaction.showModal(modal_basket_preset_save);
}

async function handleSaveSubmit(interaction: any, room_ui: any): Promise<void>
{
  const is_host = interaction.user.id === room_ui.quiz_info['room_owner']; //방장 여부 무관하게 호출되므로 재계산(메인 화면 복귀 시 버튼 구성이 달라짐)
  const preset_name = interaction.fields.getTextInputValue('txt_input_basket_preset_name').trim();
  const basket_items = room_ui.quiz_info['basket_items'] ?? {};
  const quiz_id_list = Object.keys(basket_items).map(Number);

  interaction.explicit_replied = true;

  if(preset_name.length === 0 || preset_name.length > PRESET_NAME_MAX_LENGTH)
  {
    interaction.reply({ content: `\`\`\`🔸 프리셋 이름은 1~${PRESET_NAME_MAX_LENGTH}자여야 합니다.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  if(quiz_id_list.length === 0)
  {
    interaction.reply({ content: `\`\`\`🔸 퀴즈함이 비어있어서 저장할 수 없어요.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await db_manager.selectRandomQuizPresetByName(interaction.user.id, preset_name);
  if((existing?.rows?.length ?? 0) > 0)
  {
    interaction.reply({ content: `\`\`\`🔸 이미 같은 이름의 프리셋이 있어요.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  const preset_id = await db_manager.insertRandomQuizPreset(interaction.user.id, preset_name, quiz_id_list, PRESET_MAX_COUNT);
  if(preset_id === undefined)
  {
    interaction.reply({ content: `\`\`\`🔸 프리셋 저장에 실패했습니다. 이미 ${PRESET_MAX_COUNT}개를 저장했거나, 잠시 후 다시 시도해주세요.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  interaction.update(buildMainViewPayload(room_ui, is_host, `✅ "${preset_name}" 프리셋으로 저장했습니다.`));
}

//#endregion

//#region preset_load_list 상태 (방장 전용)

async function renderPresetLoadList(interaction: any, notice: string | undefined): Promise<void>
{
  //explicit_replied는 반드시 함수 맨 첫 줄(첫 await 이전)에서 설정할 것 - await 이후로 미루면 그 사이
  //bot.js 전역 fallback이 먼저 deferUpdate()를 호출해버려서, 나중에 이 함수가 진짜 interaction.update()를
  //부를 때 "Interaction has already been acknowledged"(40060)로 실패한다(user-question-info-ui.ts의
  //duplicateQuestion에도 있는 동일 교훈인데, 이 파일 작성 중 실사용 테스트로 실제로 재현시켜서 발견).
  interaction.explicit_replied = true;

  const presets_result = await db_manager.selectRandomQuizPresetsByUser(interaction.user.id);
  const presets = presets_result?.rows ?? [];

  const components = [];
  let description = withNotice(`📥 불러올 프리셋을 선택하세요. (${presets.length}/${PRESET_MAX_COUNT}개)`, notice);

  if(presets.length === 0)
  {
    description += `\n\n🔸 저장된 프리셋이 없어요.`;
  }
  else
  {
    components.push(buildPresetSelectMenu('basket_manage_load_select', '불러올 프리셋 선택', presets));
  }

  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('basket_manage_load_back').setLabel('← 뒤로').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [{ color: 0x87CEEB, title: '🧺 퀴즈함 관리', description }], components });
}

async function handleLoad(interaction: any, room_ui: any): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(위 renderPresetLoadList 주석 참고)

  const preset_id = parseInt(interaction.values[0]);

  const presets_result = await db_manager.selectRandomQuizPresetsByUser(interaction.user.id);
  const preset = (presets_result?.rows ?? []).find((p: any) => p.preset_id === preset_id);

  if(preset === undefined)
  {
    await renderPresetLoadList(interaction, `🔸 프리셋을 찾을 수 없어요(이미 삭제됐을 수 있어요).`);
    return;
  }

  const quiz_info_result = await db_manager.selectQuizInfoByIds(preset.quiz_id_list);
  const valid_rows = quiz_info_result?.rows ?? [];

  const new_basket_items: any = {};
  for(const row of valid_rows)
  {
    new_basket_items[row.quiz_id] = { quiz_id: row.quiz_id, title: row.quiz_title };
  }

  room_ui.quiz_info['basket_items'] = new_basket_items;
  room_ui.refreshUI();
  room_ui.update();

  const dropped_count = preset.quiz_id_list.length - valid_rows.length;
  const notice = dropped_count > 0
    ? `✅ "${preset.preset_name}" 불러옴 — ${dropped_count}개 항목은 더 이상 사용할 수 없어 제외됐어요.`
    : `✅ "${preset.preset_name}" 불러왔어요.`;

  interaction.update(buildMainViewPayload(room_ui, true, notice));
}

//#endregion

//#region preset_manage_list / preset_manage_detail 상태 (방장 여부 무관)

async function renderPresetManageList(interaction: any, notice: string | undefined): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(renderPresetLoadList 주석 참고)

  const presets_result = await db_manager.selectRandomQuizPresetsByUser(interaction.user.id);
  const presets = presets_result?.rows ?? [];

  const components = [];
  let description = withNotice(
    `📋 편집할 프리셋을 선택해주세요. (${presets.length}/${PRESET_MAX_COUNT}개)\n\n🔹 웹 UI에서 편집하면 더 편해요!`,
    notice,
  );

  if(presets.length === 0)
  {
    description += `\n\n🔸 저장된 프리셋이 없어요.`;
  }
  else
  {
    components.push(buildPresetSelectMenu('basket_manage_manage_select', '편집할 프리셋 선택', presets));
  }

  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('basket_manage_manage_back').setLabel('← 뒤로').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [{ color: 0x87CEEB, title: '📋 프리셋 관리', description }], components });
}

//scoreboard-ui.ts의 TOP50 페이지네이션과 동일한 패턴 - 프리셋 전체 quiz_id_list(최대 100개, 웹 상한)를
//한 번에 들고 있다가 페이지(25개씩)만큼만 잘라서 제목 조회 + 렌더링. page는 customId에 인코딩된 값을
//그대로 받아 0~(총 페이지 수-1)로 clamp - 삭제/이동 등으로 범위를 벗어난 값이 들어와도 안전하게 처리.
async function renderPresetManageDetail(interaction: any, preset_id: number, page: number, notice: string | undefined): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(renderPresetLoadList 주석 참고)

  const presets_result = await db_manager.selectRandomQuizPresetsByUser(interaction.user.id);
  const preset = (presets_result?.rows ?? []).find((p: any) => p.preset_id === preset_id);

  if(preset === undefined)
  {
    await renderPresetManageList(interaction, `🔸 프리셋을 찾을 수 없어요(이미 삭제됐을 수 있어요).`);
    return;
  }

  const quiz_id_list: number[] = preset.quiz_id_list;
  const total_pages = Math.max(1, Math.ceil(quiz_id_list.length / ITEM_SELECT_PAGE_SIZE));
  const current_page = Math.min(Math.max(page, 0), total_pages - 1);

  const page_ids = quiz_id_list.slice(current_page * ITEM_SELECT_PAGE_SIZE, (current_page + 1) * ITEM_SELECT_PAGE_SIZE);

  const quiz_info_result = await db_manager.selectQuizInfoByIds(page_ids);
  const title_by_id: any = {};
  for(const row of (quiz_info_result?.rows ?? []))
  {
    title_by_id[row.quiz_id] = row.quiz_title;
  }

  let description = `📋 "${preset.preset_name}" (${quiz_id_list.length}개)`;
  if(total_pages > 1)
  {
    description += `\n📄 ${current_page + 1} / ${total_pages} 페이지`;
  }
  description = withNotice(description, notice);

  const components = [];

  if(page_ids.length === 0)
  {
    const empty_menu = new StringSelectMenuBuilder()
      .setCustomId(`basket_manage_manage_item_select:${preset_id}:${current_page}`)
      .setPlaceholder('프리셋이 비어있습니다.')
      .setDisabled(true)
      .addOptions({ label: '프리셋이 비어있습니다.', value: 'basket_manage_manage_item_temp' });

    components.push(new ActionRowBuilder().addComponents(empty_menu));
  }
  else
  {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`basket_manage_manage_item_select:${preset_id}:${current_page}`)
      .setPlaceholder('선택하여 프리셋에서 제거하기')
      .setMaxValues(page_ids.length);

    for(const quiz_id of page_ids)
    {
      //삭제/비공개 전환된 quiz_id도 목록엔 남아있으니(웹의 "불러오기"와 다르게 여긴 정리가 목적) 자리는
      //그대로 보여주고 제거만 가능하게 함 - 조용히 숨기면 오히려 정리를 못 하게 막는 셈이라.
      const title = title_by_id[quiz_id] ?? `(더 이상 사용할 수 없는 퀴즈 #${quiz_id})`;
      menu.addOptions({ label: `${title}`, description: '선택하여 프리셋에서 제거', value: `${quiz_id}` });
    }

    components.push(new ActionRowBuilder().addComponents(menu));
  }

  if(total_pages > 1)
  {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`basket_manage_manage_page_prev:${preset_id}:${current_page}`).setLabel('◀ 이전').setStyle(ButtonStyle.Secondary).setDisabled(current_page <= 0),
        new ButtonBuilder().setCustomId(`basket_manage_manage_page_next:${preset_id}:${current_page}`).setLabel('다음 ▶').setStyle(ButtonStyle.Secondary).setDisabled(current_page + 1 >= total_pages),
      ),
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`basket_manage_manage_rename_request:${preset_id}:${current_page}`).setLabel('✏️ 이름 변경').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`basket_manage_manage_delete_request:${preset_id}:${current_page}`).setLabel('🗑 프리셋 삭제').setStyle(ButtonStyle.Danger),
    ),
  );
  components.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('basket_manage_manage_detail_back').setLabel('← 목록으로').setStyle(ButtonStyle.Secondary)));

  await interaction.update({ embeds: [{ color: 0x87CEEB, title: '📋 프리셋 관리', description }], components });
}

function handleManagePageChange(interaction: any, delta: number): void
{
  const [, preset_id, page] = interaction.customId.split(':');
  renderPresetManageDetail(interaction, parseInt(preset_id), parseInt(page) + delta, undefined);
}

function handleManageSelect(interaction: any): void
{
  const preset_id = parseInt(interaction.values[0]);
  renderPresetManageDetail(interaction, preset_id, 0, undefined);
}

async function handleManageItemRemove(interaction: any): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(renderPresetLoadList 주석 참고)

  const [, preset_id_str, page_str] = interaction.customId.split(':');
  const preset_id = parseInt(preset_id_str);

  let remove_count = 0;
  for(const key of interaction.values)
  {
    const quiz_id = parseInt(key);
    if(isNaN(quiz_id)) { continue; }

    const result = await db_manager.deleteRandomQuizPresetItem(preset_id, interaction.user.id, quiz_id);
    if((result?.rows?.length ?? 0) > 0) { ++remove_count; }
  }

  //같은 페이지에 머무름(제거 후 그 페이지에 남은 항목이 줄었을 수 있는데, renderPresetManageDetail이
  //총 페이지 수 기준으로 다시 clamp해주므로 마지막 페이지가 통째로 비면 자동으로 이전 페이지로 보정됨).
  await renderPresetManageDetail(interaction, preset_id, parseInt(page_str), `🔸 프리셋에서 ${remove_count}개를 제거했습니다.`);
}

//현재 이름은 렌더링된 embed 텍스트를 파싱하는 대신(문구가 바뀌면 깨지는 취약한 방식) DB에서 다시
//조회 - 프리셋 개수가 유저당 최대 10개라 가벼움, 이 화면의 다른 렌더 함수들과 동일 관행.
async function handleRenameRequest(interaction: any): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(renderPresetLoadList 주석 참고)

  const [, preset_id_str, page_str] = interaction.customId.split(':');
  const preset_id = parseInt(preset_id_str);

  const presets_result = await db_manager.selectRandomQuizPresetsByUser(interaction.user.id);
  const preset = (presets_result?.rows ?? []).find((p: any) => p.preset_id === preset_id);

  if(preset === undefined)
  {
    await renderPresetManageList(interaction, `🔸 프리셋을 찾을 수 없어요(이미 삭제됐을 수 있어요).`);
    return;
  }

  interaction.showModal(buildRenameModal(preset_id, parseInt(page_str), preset.preset_name));
}

async function handleRenameSubmit(interaction: any): Promise<void>
{
  const [, preset_id_str, page_str] = interaction.customId.split(':');
  const preset_id = parseInt(preset_id_str);
  const new_name = interaction.fields.getTextInputValue('txt_input_basket_preset_rename').trim();

  interaction.explicit_replied = true;

  if(new_name.length === 0 || new_name.length > PRESET_NAME_MAX_LENGTH)
  {
    interaction.reply({ content: `\`\`\`🔸 프리셋 이름은 1~${PRESET_NAME_MAX_LENGTH}자여야 합니다.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await db_manager.selectRandomQuizPresetByName(interaction.user.id, new_name);
  if((existing?.rows?.length ?? 0) > 0 && existing.rows[0].preset_id !== preset_id)
  {
    interaction.reply({ content: `\`\`\`🔸 이미 같은 이름의 프리셋이 있어요.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  await db_manager.updateRandomQuizPresetName(preset_id, interaction.user.id, new_name);

  await renderPresetManageDetail(interaction, preset_id, parseInt(page_str), `✅ 이름을 "${new_name}"(으)로 변경했습니다.`);
}

function handleManageDeleteRequest(interaction: any): void
{
  const [, preset_id, page] = interaction.customId.split(':');

  interaction.explicit_replied = true;
  interaction.update({
    embeds: [{ color: 0xE74C3C, title: '📋 프리셋 관리', description: `🔸 정말 이 프리셋을 삭제하시겠어요? 되돌릴 수 없습니다.` }],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`basket_manage_manage_delete_cancel:${preset_id}:${page}`).setLabel('아니요, 삭제하지 않습니다.').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`basket_manage_manage_delete_confirmed:${preset_id}:${page}`).setLabel('네, 삭제합니다.').setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function handleManageDeleteConfirmed(interaction: any): Promise<void>
{
  interaction.explicit_replied = true; //첫 await 이전에 설정(renderPresetLoadList 주석 참고)

  const preset_id = parseInt(interaction.customId.split(':')[1]);

  await db_manager.deleteRandomQuizPreset(preset_id, interaction.user.id);

  await renderPresetManageList(interaction, `🔸 프리셋을 삭제했습니다.`);
}

function handleManageDeleteCancel(interaction: any): void
{
  const [, preset_id, page] = interaction.customId.split(':');
  renderPresetManageDetail(interaction, parseInt(preset_id), parseInt(page), undefined);
}

//#endregion
