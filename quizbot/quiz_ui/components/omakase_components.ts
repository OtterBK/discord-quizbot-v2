//components.js에서 분리 (REFACTOR_PLAN.md Phase 4)
//오마카세 퀴즈 관련 컴포넌트. modal_quiz_setting은 오마카세 전용은 아니고
//quiz-info-ui.js(기본 제공 퀴즈 시작 화면)에서도 쓰이지만, 원본 파일에서
//이 구역에 위치해 있던 것을 그대로 유지했다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const { QUIZ_TAG, DEV_QUIZ_TAG } = require('../../../config/system_setting.js');

//#region 오마카세 퀴즈 관련 컴포넌트

//#region OMAKASE QUIZ

const modal_quiz_setting = new ModalBuilder()
  .setCustomId('modal_quiz_setting')
  .setTitle('퀴즈 설정')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_selected_question_count')
          .setLabel('몇 개의 문제를 제출할까요? (최대 100)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(3)
          .setPlaceholder('예시) 30')
      ),
  );

//퀴즈함 관리 + 프리셋(docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md, 2026-08-18 신설, 2026-08-19 멀티플레이
//로비까지 이식) - OmakaseQuizRoomUI 전용(멀티플레이는 같은 형태를 multiplayer_components.js의
//multiplayer_basket_manage_open_comp로 별도 싱글턴을 만들어 씀 - 이 디렉터리 관행상 화면 종류별로
//컴포넌트 싱글턴을 공유하지 않음). 예전엔 여기 "최근 퀴즈함으로 덮어쓰기"(BASKET_CACHE 기반,
//request_basket_reopen_comp) 버튼이 있었는데 "🧺 퀴즈함 보기"로 교체됨 - 이 버튼이
//basket-manage-flow.ts의 독립 ephemeral 화면을 연다. request_basket_reopen_comp 자체는 멀티플레이
//이식 완료로 더 이상 쓰는 곳이 없어져 삭제(원문은 docs/archive/DEPRECATED_CODE_REMOVED.md 보존).
const omakase_basket_manage_open_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('use_basket_mode')
      .setLabel('퀴즈함에 퀴즈 더 담기')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('basket_manage_open')
      .setLabel('🧺 퀴즈함 보기')
      .setStyle(ButtonStyle.Primary),
  );

const modal_basket_preset_save = new ModalBuilder()
  .setCustomId('modal_basket_preset_save')
  .setTitle('프리셋으로 저장')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_basket_preset_name')
          .setLabel('프리셋 이름 (최대 30자)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(30)
      ),
  );

//오마카세 퀴즈용
const omakase_quiz_info_tag_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('start')
      .setLabel('시작')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_setting')
      .setLabel('퀴즈 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('settings')
      .setLabel('서버 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('use_basket_mode')
      .setLabel('퀴즈함 모드')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
  );

const omakase_quiz_info_basket_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('start')
      .setLabel('시작')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_setting')
      .setLabel('퀴즈 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('settings')
      .setLabel('서버 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('use_tag_mode')
      .setLabel('장르 선택 모드')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
  );


//오마카세 퀴즈용 퀴즈 설정 modal
const modal_omakase_quiz_setting = new ModalBuilder()
  .setCustomId('modal_quiz_setting')
  .setTitle('랜덤 퀴즈 설정')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_selected_question_count')
          .setLabel('몇 개의 문제를 제출할까요? (최대 100)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(3)
          .setPlaceholder('예시) 30')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_certified_quiz_filter_off')
          .setLabel('인증(추천 10개↑) 필터를 끌까요? (웬만해선 끄지 마세요)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(1)
          .setPlaceholder('예시) 네')
      )
  );


//오마카세 퀴즈에서 공식 퀴즈 장르 지정용
const omakase_dev_quiz_tags_select_menu =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('dev_quiz_tags_select_menu').
      setPlaceholder('공식 퀴즈 장르 선택하기').
      setMaxValues(Object.keys(DEV_QUIZ_TAG).length)
  );
for(const [tag_name, tag_value] of Object.entries(DEV_QUIZ_TAG))
{
  const tag_option = { label: `${tag_name}`, value: `${tag_value}` };
  omakase_dev_quiz_tags_select_menu.components[0].addOptions(tag_option);
}

//오마카세 퀴즈에서 유저 퀴즈 유형 지정용
const omakase_custom_quiz_type_tags_select_menu =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('custom_quiz_type_tags_select_menu').
      setPlaceholder('유저 퀴즈 유형 선택하기').
      setMaxValues(Object.keys(QUIZ_TAG).length)
  );
{
  let total_menu_count = 0;
  for(const [tag_name, tag_value] of Object.entries(QUIZ_TAG))
  {
    if((tag_value as number) > 4) //4이하까지만 유형 태그임
    {
      continue;
    }

    const tag_option = { label: `${tag_name}`, value: `${tag_value}` };
    omakase_custom_quiz_type_tags_select_menu.components[0].addOptions(tag_option);
    total_menu_count++;
  }
  omakase_custom_quiz_type_tags_select_menu.components[0].setMaxValues(total_menu_count);
}


//오마카세 퀴즈에서 유저 퀴즈 장르 지정용
const omakase_custom_quiz_tags_select_menu =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('custom_quiz_tags_select_menu').
      setPlaceholder('유저 퀴즈 장르 선택하기').
      setMaxValues(Object.keys(QUIZ_TAG).length)
  );
{
  let total_menu_count = 0;
  for(const [tag_name, tag_value] of Object.entries(QUIZ_TAG))
  {
    if(tag_value !== 0 && (tag_value as number) <= 4) //4이하는 장르 태그가 아님
    {
      continue;
    }

    const tag_option = { label: `${tag_name}`, value: `${tag_value}` };
    omakase_custom_quiz_tags_select_menu.components[0].addOptions(tag_option);
    total_menu_count++;
  }
  omakase_custom_quiz_tags_select_menu.components[0].setMaxValues(total_menu_count);
}

module.exports = {
  modal_quiz_setting,
  omakase_basket_manage_open_comp,
  modal_basket_preset_save,
  omakase_quiz_info_tag_comp,
  omakase_quiz_info_basket_comp,
  modal_omakase_quiz_setting,
  omakase_dev_quiz_tags_select_menu,
  omakase_custom_quiz_type_tags_select_menu,
  omakase_custom_quiz_tags_select_menu,
};
