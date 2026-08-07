//components.js에서 분리 (REFACTOR_PLAN.md Phase 4)
//멀티플레이(서버 간 대결) 로비 관련 컴포넌트.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');


/** 멀티플레이 관련 컴포넌트 */
const modal_multiplayer_create_lobby = new ModalBuilder()
  .setCustomId('modal_multiplayer_create_lobby')
  .setTitle('새로운 로비 생성')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_custom_title')
          .setLabel('방 제목을 입력해주세요.')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(20)
          .setRequired(true)
          .setPlaceholder('예시) 즐겜할 사람~')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_selected_question_count')
          .setLabel('몇 개의 문제를 제출할까요? (최대 60)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(3)
          .setRequired(true)
          .setValue('30')
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

//로비 생성하고 따라 나눈 이유는 나중에라도 생성 전용 설정 값이 있을까봐
const modal_multiplayer_quiz_setting = new ModalBuilder()
  .setCustomId('modal_quiz_setting') //modal_quiz_setting으로 해둬야. applyQuizSetting이 호출됨
  .setTitle('로비 설정')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_custom_title')
          .setLabel('방 제목을 입력해주세요.')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(20)
          .setRequired(true)
          .setPlaceholder('예시) 즐겜할 사람~')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_selected_question_count')
          .setLabel('몇 개의 문제를 제출할까요? (최대 60)')
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

//멀티플레이 방 선택 UI용 컴포넌트
const multiplayer_select_control = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_multiplayer_create_lobby')
      .setLabel('새로운 로비 생성')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('multiplayer_refresh_lobby_list')
      .setLabel('새로고침')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('multiplayer_scoreboard')
      .setLabel('순위표')
      .setStyle(ButtonStyle.Secondary),
  );

const multiplayer_lobby_host_tag_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('multiplayer_start')
      .setLabel('시작')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_setting')
      .setLabel('로비 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('use_basket_mode')
      .setLabel('장바구니 모드')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('multiplayer_leave_lobby') //다른 서버들도 같이 대기 중인 로비라 확인 절차를 거치도록 customId('back')이 아닌 별도 처리로 변경
      .setLabel('나가기')
      .setStyle(ButtonStyle.Danger),
  );

const multiplayer_lobby_host_basket_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('multiplayer_start')
      .setLabel('시작')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_setting')
      .setLabel('로비 설정')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('use_tag_mode')
      .setLabel('장르 선택 모드')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('multiplayer_leave_lobby') //다른 서버들도 같이 대기 중인 로비라 확인 절차를 거치도록 customId('back')이 아닌 별도 처리로 변경
      .setLabel('나가기')
      .setStyle(ButtonStyle.Danger),
  );

const multiplayer_lobby_participant_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('multiplayer_ready')
      .setLabel('준비')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('multiplayer_leave_lobby') //다른 서버들도 같이 대기 중인 로비라 확인 절차를 거치도록 customId('back')이 아닌 별도 처리로 변경
      .setLabel('나가기')
      .setStyle(ButtonStyle.Danger),
  );

const multiplayer_lobby_kick_select_menu = new StringSelectMenuBuilder().
  setCustomId('multiplayer_lobby_kick_select_menu').
  setPlaceholder('서버 추방하기');

const multiplayer_participant_select_menu = new StringSelectMenuBuilder().
  setCustomId('multiplayer_participant_select_menu').
  setPlaceholder('참여 중인 서버 목록 확인');

const multiplayer_participant_select_row = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('multiplayer_participant_select_row').
      setPlaceholder('참여 중인 서버 목록 확인')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('참가자 목록을 갱신하는 중...')
          .setValue('participant_select_menu_temp'),
      )
  );

//"나가기"/"서버 추방하기"는 나 혼자만의 화면이 아니라 같이 대기 중인 다른 서버에도 영향을 주는
//동작이라 확인 절차를 거치도록 함
const multiplayer_leave_confirm_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('multiplayer_leave_cancel')
      .setLabel('아니요, 나가지 않습니다.')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('multiplayer_leave_confirmed')
      .setLabel('네, 로비에서 나갑니다.')
      .setStyle(ButtonStyle.Danger),
  );

const multiplayer_kick_confirm_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('multiplayer_kick_cancel')
      .setLabel('아니요, 추방하지 않습니다.')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('multiplayer_kick_confirmed')
      .setLabel('네, 추방합니다.')
      .setStyle(ButtonStyle.Danger),
  );

const multiplayer_chat_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('chat_report_')
      .setLabel('신고')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('chat_ignore')
      .setLabel('모든 채팅 차단')
      .setStyle(ButtonStyle.Secondary),
  );

module.exports = {
  modal_multiplayer_create_lobby,
  modal_multiplayer_quiz_setting,
  multiplayer_select_control,
  multiplayer_lobby_host_tag_comp,
  multiplayer_lobby_host_basket_comp,
  multiplayer_lobby_participant_comp,
  multiplayer_lobby_kick_select_menu,
  multiplayer_participant_select_menu,
  multiplayer_participant_select_row,
  multiplayer_leave_confirm_comp,
  multiplayer_kick_confirm_comp,
  multiplayer_chat_comp,
};
