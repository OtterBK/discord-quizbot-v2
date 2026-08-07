//components.js에서 분리 (REFACTOR_PLAN.md Phase 4)
//커스텀 퀴즈(유저 제작 퀴즈) 관련 컴포넌트 - 퀴즈 목록/정보/문제 CRUD 화면에서 사용.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const cloneDeep = require('lodash/cloneDeep.js');

const { SYSTEM_CONFIG, QUIZ_TAG } = require('../../../config/system_setting.js');

//#region 커스텀 퀴즈 관련 컴포넌트
/**  Custom quiz 관련 섹션 나중에 다 모듈화하자.........굳이 해야하나..?*/
const my_quiz_control_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_create')
      .setLabel('새로운 퀴즈 만들기')
      .setStyle(ButtonStyle.Success),
  );


const quiz_edit_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_quiz_edit')
      .setLabel('퀴즈 정보 수정')
      .setStyle(ButtonStyle.Primary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('quiz_toggle_public')
      .setLabel('퀴즈 공개/비공개')
      .setStyle(ButtonStyle.Secondary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('quiz_delete')
      .setLabel('퀴즈 삭제')
      .setStyle(ButtonStyle.Danger),
  );

const quiz_info_control_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_question_add')
      .setLabel('문제 추가')
      .setStyle(ButtonStyle.Success),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
  );

//퀴즈 선택 UI에서 태그 선택용
const quiz_search_tags_select_menu =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('quiz_search_tags_select_menu').
      setPlaceholder('검색할 퀴즈 태그 선택하기')
  );
for(const [tag_name, tag_value] of Object.entries(QUIZ_TAG))
{
  const tag_option = { label: `${tag_name}`, value: `${tag_value}` };
  quiz_search_tags_select_menu.components[0].addOptions(tag_option);
}

//퀴즈 제작 UI에서 태그 지정용
const quiz_tags_select_menu =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('quiz_tags_select_menu').
      setPlaceholder('퀴즈에 붙일 태그 선택하기 (여러 개 선택 가능)').
      setMaxValues(Object.keys(QUIZ_TAG).length)
  );
for(const [tag_name, tag_value] of Object.entries(QUIZ_TAG))
{
  const tag_option = { label: `${tag_name}`, value: `${tag_value}` };
  quiz_tags_select_menu.components[0].addOptions(tag_option);
}

const question_select_menu_comp =  new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('question_select_menu').
      setPlaceholder('수정할 문제 선택하기')
  );

const quiz_delete_confirm_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('quiz_delete_cancel')
      .setLabel('아니요, 퀴즈를 삭제하지 않습니다.')
      .setStyle(ButtonStyle.Success),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('quiz_delete_confirmed')
      .setLabel('네, 퀴즈를 삭제합니다.')
      .setStyle(ButtonStyle.Danger),
  );

//관리자 전용: 퀴즈 삭제 + 제작자 영구밴을 함께 처리할 수 있는 확인 컴포넌트
//영구밴 버튼은 일반 삭제보다 훨씬 되돌리기 어려운 동작이라, 오클릭 방지를 위해 별도 행으로 분리해둠
const quiz_delete_confirm_admin_comp = [
  new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('quiz_delete_cancel')
        .setLabel('아니요, 퀴즈를 삭제하지 않습니다.')
        .setStyle(ButtonStyle.Success),
    )
    .addComponents(
      new ButtonBuilder()
        .setCustomId('quiz_delete_confirmed')
        .setLabel('네, 퀴즈만 삭제합니다.')
        .setStyle(ButtonStyle.Danger),
    ),
  new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('quiz_delete_confirmed_and_ban')
        .setLabel('⚠️ 삭제 + 제작자 영구밴 (해제 전까지 되돌릴 수 없음)')
        .setStyle(ButtonStyle.Danger),
    ),
];

//관리자 패널 메인 메뉴
const admin_panel_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('admin_panel_ban_list')
      .setLabel('밴 목록 관리')
      .setStyle(ButtonStyle.Danger),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('admin_panel_report')
      .setLabel('신고처리')
      .setStyle(ButtonStyle.Primary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('admin_panel_quiz_manage')
      .setLabel('퀴즈 관리')
      .setStyle(ButtonStyle.Primary),
  );

//관리자 밴 목록 - 밴 해제 확인 절차 (오클릭 방지)
const admin_ban_unban_confirm_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('admin_ban_unban_cancel')
      .setLabel('아니요, 해제하지 않습니다.')
      .setStyle(ButtonStyle.Success),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('admin_ban_unban_confirmed')
      .setLabel('네, 밴을 해제합니다.')
      .setStyle(ButtonStyle.Danger),
  );

//퀴즈 만들기
const modal_quiz_info = new ModalBuilder()
  .setCustomId('modal_quiz_info')
  .setTitle('퀴즈 만들기')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_quiz_title')
          .setLabel('퀴즈 제목을 입력해주세요. (4~40자)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(4)
          .setMaxLength(40)
          .setRequired(true)
          .setPlaceholder('예시) 2023년 팝송 맞히기')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_quiz_simple_description')
          .setLabel('퀴즈에 대해 간단히 소개해주세요.')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(60)
          .setRequired(false)
          .setPlaceholder('예시: 2023년에 새로 나온 팝송을 맞히는 퀴즈입니다.')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_quiz_description')
          .setLabel('퀴즈를 자유롭게 소개해주세요.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false)
          .setPlaceholder('예시: 2023년에 인기를 얻었던 팝송을 맞히는 퀴즈입니다!\n모건 월렌, 루크 콤즈 등의 유명한 노래가 포함되어 있습니다.')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_quiz_thumbnail')
          .setLabel('퀴즈 썸네일 이미지의 링크(URL)을 입력해주세요.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false)
          .setPlaceholder('예시: https://buly.kr/D3b6HK6')
      )
  );

//문제 만들기
const modal_question_info = new ModalBuilder()
  .setCustomId('modal_question_info')
  .setTitle('문제 만들기')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_answers')
          .setLabel('주관식 정답을 입력해주세요. (정답이 여러 개면 ,로 구분)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder('카트라이더, 카트, kartrider')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_audio_url')
          .setLabel('문제와 함께 재생할 음악입니다. [20분 이하 영상만 가능]')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('유튜브 링크(URL)을 입력해주세요. [생략하면 10초 타이머 BGM이 재생됩니다.]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_audio_range')
          .setLabel(`음악 재생 구간을 지정할 수 있습니다. [최대 ${SYSTEM_CONFIG.MAX_QUESTION_AUDIO_PLAY_TIME}초 재생됨]`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(40)
          .setPlaceholder('예시: 40~80 또는 40 [생략하면 랜덤 재생]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_image_url')
          .setLabel('문제와 함께 표시할 이미지입니다. [WebP 형식은 사용 불가]')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('이미지 링크(URL)을 입력해주세요. [생략 가능]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_text')
          .setLabel('문제와 함께 표시할 텍스트를 입력해주세요.')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('자유롭게 텍스트를 입력해주세요. [생략 가능]')
      )
  );

//문제 추가 설정
const modal_question_additional_info = new ModalBuilder()
  .setCustomId('modal_question_additional_info')
  .setTitle('문제 정보 설정')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_hint')
          .setLabel('문제 힌트를 직접 지정할 수 있습니다.')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('예시: 한때 유행했던 추억의 레이싱 게임! [생략 가능]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_hint_image_url')
          .setLabel('힌트와 함께 표시할 이미지입니다. [WebP 형식은 사용 불가]')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('이미지 링크(URL)을 입력해주세요. [생략 가능]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_question_audio_repeat')
          .setLabel(`문제용 오디오를 반복 재생할 수 있습니다. [최대 ${SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT}회]`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(1)
          .setPlaceholder('예시: 3')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_use_answer_timer')
          .setLabel('문제 제출 후 정답을 맞추기까지 여유 시간을 줄지 설정합니다.')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10)
          .setPlaceholder('예시: 사용 [생략 시 미사용]')
      )
  )
  ;

//문제 정답 시 설정
const modal_question_answering_info = new ModalBuilder()
  .setCustomId('modal_question_answering_info')
  .setTitle('문제 정답 공개 시 설정')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_answering_audio_url')
          .setLabel('정답 공개 시 재생할 오디오입니다. [20분 이하 영상만 가능]')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('유튜브 링크(URL)을 입력해주세요. [생략 가능]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_answering_audio_range')
          .setLabel(`정답 음악 재생 구간을 지정할 수 있습니다. [최대 ${SYSTEM_CONFIG.MAX_ANSWER_AUDIO_PLAY_TIME}초 재생됨]`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('예시) 40~50 (생략 시, 랜덤 재생)')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_answering_image_url')
          .setLabel('정답 공개 시 표시할 이미지입니다. [WebP 형식은 사용 불가]')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('이미지 링크(URL)을 입력해주세요. [생략 가능]')
      )
  )
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_answering_text')
          .setLabel('정답 공개 시 표시할 텍스트입니다.')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500)
          .setPlaceholder('자유롭게 텍스트를 입력해주세요. [생략 가능]')
      )
  );

const modal_question_info_edit = cloneDeep(modal_question_info); //문제 수정용 modal
modal_question_info_edit.setCustomId('modal_question_info_edit');

const question_edit_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_question_info_edit')
      .setLabel('기본 정보 설정')
      .setStyle(ButtonStyle.Primary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_question_additional_info')
      .setLabel('추가 정보 설정')
      .setStyle(ButtonStyle.Primary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_question_answering_info')
      .setLabel('정답 공개 설정')
      .setStyle(ButtonStyle.Primary),
  );

const question_preview_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('question_refresh')
      .setLabel('이미지 재로드')
      .setStyle(ButtonStyle.Primary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('question_preview')
      .setLabel('문제용 오디오 미리듣기')
      .setStyle(ButtonStyle.Secondary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('answer_preview')
      .setLabel('정답용 오디오 미리듣기')
      .setStyle(ButtonStyle.Secondary),
  );

const question_edit_comp2 = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('request_modal_question_add')
      .setLabel('새로운 문제 추가')
      .setStyle(ButtonStyle.Success),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('question_duplicate')
      .setLabel('현재 문제 복제')
      .setStyle(ButtonStyle.Secondary),
  )
  .addComponents(
    new ButtonBuilder()
      .setCustomId('question_delete')
      .setLabel('현재 문제 삭제')
      .setStyle(ButtonStyle.Danger),
  );

const question_answer_type_select_menu = new ActionRowBuilder()
  .addComponents(
    new StringSelectMenuBuilder().
      setCustomId('question_answer_type_select_menu').
      setPlaceholder('문제 유형 선택')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('주관식')
          .setDescription('플레이어는 메시지로 정답을 입력하는 방식입니다.')
          .setDefault(true)
          .setValue('answer_type_short_answer'),

        new StringSelectMenuOptionBuilder()
          .setLabel('O/X 선택')
          .setDescription('플레이어는 O 또는 X 만 선택할 수 있습니다.')
          .setValue('answer_type_ox'),

        new StringSelectMenuOptionBuilder()
          .setLabel('객관식')
          .setDescription('플레이어는 1,2,3,4,5 중 하나를 선택해야합니다.')
          .setValue('answer_type_multiple_choice'),
      )
  );

const question_control_btn_component = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('prev_question')
      .setLabel('이전 문제')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('back')
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('next_question')
      .setLabel('다음 문제')
      .setStyle(ButtonStyle.Secondary),
  );

//사용자 개발 퀴즈 선택 UI
const btn_search = new ButtonBuilder()
  .setCustomId('request_modal_complex_page_jump')
  .setLabel('검색')
  .setStyle(ButtonStyle.Secondary);

//사용자 개발 퀴즈 선택 UI
const btn_done = new ButtonBuilder()
  .setCustomId('back')
  .setLabel('완료')
  .setStyle(ButtonStyle.Success);

//#endregion

module.exports = {
  my_quiz_control_comp,
  quiz_edit_comp,
  quiz_info_control_comp,
  quiz_search_tags_select_menu,
  quiz_tags_select_menu,
  question_select_menu_comp,
  quiz_delete_confirm_comp,
  quiz_delete_confirm_admin_comp,
  admin_panel_comp,
  admin_ban_unban_confirm_comp,
  modal_quiz_info,
  modal_question_info,
  modal_question_additional_info,
  modal_question_answering_info,
  modal_question_info_edit,
  question_edit_comp,
  question_preview_comp,
  question_edit_comp2,
  question_answer_type_select_menu,
  question_control_btn_component,
  btn_search,
  btn_done,
};
