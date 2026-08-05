//components.js에서 분리 (REFACTOR_PLAN.md Phase 4)
//기본 퀴즈 UI들 - 페이지네이션, 메인 화면, 서버 옵션 설정 등 여러 화면에서
//공통으로 쓰이는/기초적인 컴포넌트.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];

//#region 기본 퀴즈 UI들
/** 기본 퀴즈 UI들 */
//ButtonStyle 바꿀 수도 있으니깐 개별로 넣어놓자
const select_btn_component = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('1')
    // .setLabel('1️⃣')
      .setLabel('1')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('2')
    // .setLabel('2️⃣')
      .setLabel('2')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('3')
    // .setLabel('3️⃣')
      .setLabel('3')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('4')
    // .setLabel('4️⃣')
      .setLabel('4')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('5')
    // .setLabel('5️⃣')
      .setLabel('5')
      .setStyle(ButtonStyle.Primary),
  );

//24.01.08 부터는 10개씩 보여준다. 대신 페이지 이동 뺐음
const select_btn_component2 = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('6')
      .setLabel('6')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('7')
      .setLabel('7')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('8')
      .setLabel('8')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('9')
      .setLabel('9')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('10')
      .setLabel('10')
      .setStyle(ButtonStyle.Primary),
  );

//페이지 이동
const modal_page_jump = new ModalBuilder()
  .setCustomId('modal_page_jump')
  .setTitle('페이지 이동')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_page_jump')
          .setLabel('몇 페이지로 이동할까요?')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(4)
          .setRequired(true)
          .setPlaceholder('예시) 1')
      ),
  );

const modal_complex_page_jump = new ModalBuilder() //검색과 이동을 한번에 하는 용도
  .setCustomId('modal_complex_page_jump')
  .setTitle('퀴즈 검색')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_keyword')
          .setLabel('어떤 단어로 검색할까요?')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(10)
          .setRequired(false)
          .setPlaceholder('아무것도 입력하지 않으면 모든 퀴즈가 표시됩니다.')
      ),
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_page_jump')
          .setLabel('몇 페이지로 이동할까요?')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(4)
          .setRequired(true)
          .setValue('1')
          .setPlaceholder('예시) 1')
      ),
  );

const page_select_menu = new StringSelectMenuBuilder().
  setCustomId('page_jump').
  setPlaceholder('페이지 이동');

const page_select_row = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('page_jump_temp').
      setPlaceholder('페이지 이동')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('페이지 정보를 계산하는 중...')
          .setValue('page_select_menu_temp'),
      )
  );

const control_btn_component = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('prev')
      .setLabel('이전 페이지')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('request_modal_page_jump')
      .setLabel('페이지 이동')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('next')
      .setLabel('다음 페이지')
      .setStyle(ButtonStyle.Secondary),
  );

const main_ui_component = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setLabel('개인 정보 보호 정책')
      .setURL('http://quizbot2.kro.kr')
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel('봇 공유')
      .setURL('https://koreanbots.dev/bots/788060831660114012')
      .setStyle(ButtonStyle.Link),
  );

const option_control_btn_component = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('save_option_data')
      .setLabel('저장')
      .setDisabled(true)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Danger),
  );

const option_component = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('option_select')
      .setPlaceholder(`${text_contents.server_setting_ui.select_menu.title}`)
      .addOptions(

        text_contents.server_setting_ui.select_menu.options.map(option_info => 
        {
          return { label: option_info.label, description: option_info.description, value: option_info.value };
        })

      ),
  );

const option_value_components = {

  audio_play_time:  createOptionValueComponents('audio_play_time'),
  hint_type:  createOptionValueComponents('hint_type'),
  skip_type:  createOptionValueComponents('skip_type'),
  use_similar_answer:  createOptionValueComponents('use_similar_answer'),
  score_type:  createOptionValueComponents('score_type'),
  improved_audio_cut:  createOptionValueComponents('improved_audio_cut'),
  use_message_intent:  createOptionValueComponents('use_message_intent'),
  score_show_max:  createOptionValueComponents('score_show_max'),
  max_chance:  createOptionValueComponents('max_chance'),
  
};

function createOptionValueComponents(option_name)
{
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('option_value_select')
        .setPlaceholder(`${text_contents.server_setting_ui.select_menu.option_values.title}`)
        .addOptions(
    
          text_contents.server_setting_ui.select_menu.option_values[option_name].map(option_value_info => 
          {
            return { label: option_value_info.label, description: option_value_info.description, value: option_value_info.value };
          })
    
        ),
    );
}

const quiz_info_comp = new ActionRowBuilder()
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
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
  );

const only_back_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
  );

const sort_by_select_menu = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('sort_by_select').
      setPlaceholder('정렬 방식 선택')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('업데이트순')
          .setDescription('가장 최근에 업데이트된 퀴즈부터 표시합니다.')
          .setDefault(true)
          .setValue('modified_time'),

        new StringSelectMenuOptionBuilder()
          .setLabel('주간 인기순')
          .setDescription('이번주에 가장 많이 플레이된 퀴즈부터 표시합니다.')
          .setValue('played_count_of_week'),

        new StringSelectMenuOptionBuilder()
          .setLabel('전체 인기순')
          .setDescription('가장 많이 플레이된 퀴즈부터 표시합니다.')
          .setValue('played_count'),

        new StringSelectMenuOptionBuilder()
          .setLabel('전체 추천순')
          .setDescription('가장 많이 추천 받은 퀴즈부터 표시합니다.')
          .setValue('like_count'),

        new StringSelectMenuOptionBuilder()
          .setLabel('최신 퀴즈순')
          .setDescription('최근 생성된 퀴즈부터 표시합니다.')
          .setValue('birthtime'),

        new StringSelectMenuOptionBuilder()
          .setLabel('오래된 퀴즈순')
          .setDescription('가장 오래전에 생성된 퀴즈부터 표시합니다.')
          .setValue('birthtime_reverse'),
      )
  );

//#endregion

module.exports = {
  select_btn_component,
  select_btn_component2,
  modal_page_jump,
  modal_complex_page_jump,
  page_select_menu,
  page_select_row,
  control_btn_component,
  main_ui_component,
  option_control_btn_component,
  option_component,
  option_value_components,
  createOptionValueComponents,
  quiz_info_comp,
  only_back_comp,
  sort_by_select_menu,
};
