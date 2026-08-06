'use strict';

//#region 필요한 외부 모듈
const cloneDeep = require("lodash/cloneDeep.js");
const ytdl = require('discord-ytdl-core');
const { MessageFlags, ButtonStyle } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, ANSWER_TYPE } = require('../../config/system_setting.js');
const utility = require('../../utility/utility.js');
const logger = require('../../utility/logger.js')('QuizUI');

const { UserQuestionInfo } = require('../managers/user_quiz_info_manager');

const {
  modal_question_info,
  modal_question_additional_info,
  modal_question_info_edit,
  modal_question_answering_info,
  question_edit_comp,
  question_edit_comp2,
  question_answer_type_select_menu,
  question_control_btn_component,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

//#endregion

/** 퀴즈의 문제 정보 */
/** 건드릴 엄두가 안난다... 우선 돌아가면 장땡 ㄱㄱ */
class UserQuestionInfoUI extends QuizbotUI
{

  constructor(quiz_info: any, question_index: number)
  {
    super();

    this.question_index = question_index;
    this.quiz_info = quiz_info;
    this.question_list = quiz_info.question_list;
    this.current_question_info = undefined;
    this.current_question_index = question_index;
    this.pending_question_delete_confirm = false; //문제 삭제는 오클릭 방지를 위해 2번 눌러야 실제로 삭제됨

    this.initializeEmbed();
    this.initializeComponents();

    this.displayQuestionInfo(question_index);
  }

  initializeEmbed()
  {

    this.embed = {
      color: 0x05f1f1,
      title: `**${this.question_index+1}번째 문제**`,
      description: '데이터를 불러오는 중...\n잠시만 기다려주세요.',
      image: { //문제 이미지 표시
        url: '',
      },
      thumbnail: { //정답 이미지 표시
        url: '',
      },
      footer: { //문제 번호 표시
        text: `📦 ${this.question_index + 1} / ${this.question_list.length}`,
      },
    };
  }

  initializeComponents()
  {

    this.question_answer_type_select_menu = question_answer_type_select_menu;
    this.question_edit_comp2 = cloneDeep(question_edit_comp2); //'현재 문제 삭제' 버튼 라벨을 확인 단계에서 바꿔치기해야 해서 인스턴스별로 참조를 들고 있음
    this.components = [question_edit_comp, this.question_answer_type_select_menu, this.question_edit_comp2, question_control_btn_component]; //문제 관련 comp
  }

  /** '현재 문제 삭제' 버튼을 처음 상태(삭제 확인 대기 아님)로 되돌림 */
  resetQuestionDeleteConfirm()
  {
    this.pending_question_delete_confirm = false;
    this.question_edit_comp2.components[1]
      .setLabel('현재 문제 삭제')
      .setStyle(ButtonStyle.Danger);
  }

  onInteractionCreate(interaction: any)
  {
    //삭제 확인 대기 중이었는데 다른 버튼/메뉴를 눌렀다면, 오클릭 방지를 위해 확인 대기 상태를 해제
    if(this.pending_question_delete_confirm === true && interaction.customId !== 'question_delete')
    {
      this.resetQuestionDeleteConfirm();
    }

    if(interaction.isModalSubmit())
    {
      return this.doModalSubmitEvent(interaction);
    }

    if(interaction.isButton())
    {
      return this.doButtonEvent(interaction);
    }

    if(interaction.isStringSelectMenu())
    {
      return this.doSelectEvent(interaction);
    }
  }

  doModalSubmitEvent(modal_interaction: any)
  {
    if(modal_interaction.customId === 'modal_question_info_edit'
      || modal_interaction.customId === 'modal_question_additional_info'
      || modal_interaction.customId === 'modal_question_answering_info')
    {
      this.editQuestionInfo(this.current_question_info, modal_interaction);
      return;
    }

    if(modal_interaction.customId === 'modal_question_info')
    {
      this.addQuestion(modal_interaction);
      return;
    }
  }

  doButtonEvent(interaction: any)
  {
    const question_info = this.current_question_info;
    if(interaction.customId === 'request_modal_question_info_edit')
    {
      const modal_current_question_info_edit = cloneDeep(modal_question_info_edit);

      modal_current_question_info_edit.components[0].components[0].setValue(question_info.data.answers ?? '');
      modal_current_question_info_edit.components[1].components[0].setValue(question_info.data.question_audio_url ?? '');
      modal_current_question_info_edit.components[2].components[0].setValue(question_info.data.audio_range_row ?? '');
      modal_current_question_info_edit.components[3].components[0].setValue(question_info.data.question_image_url ?? '');
      modal_current_question_info_edit.components[4].components[0].setValue(question_info.data.question_text ?? '');

      //정답 방식별로 툴팁 제공
      const answer_type = question_info.data.answer_type;
      if(answer_type === ANSWER_TYPE.SHORT_ANSWER)
      {
        modal_current_question_info_edit.components[0].components[0].setLabel('주관식 정답을 입력해주세요. (정답이 여러 개면 ,로 구분)');
        modal_current_question_info_edit.components[0].components[0].setPlaceholder('카트라이더, 카트, kartrider');
      }
      else if(answer_type === ANSWER_TYPE.OX)
      {
        modal_current_question_info_edit.components[0].components[0].setLabel('OX 정답을 입력해주세요. O 또는 X');
        modal_current_question_info_edit.components[0].components[0].setPlaceholder('O, X');
      }
      else if(answer_type === ANSWER_TYPE.MULTIPLE_CHOICE)
      {
        modal_current_question_info_edit.components[0].components[0].setLabel('객관식 정답을 입력해주세요. 1, 2, 3, 4, 5 중 선택');
        modal_current_question_info_edit.components[0].components[0].setPlaceholder('1, 2, 3, 4, 5');
      }

      interaction.explicit_replied = true;
      interaction.showModal(modal_current_question_info_edit);
      return;
    }

    if(interaction.customId === 'request_modal_question_additional_info')
    {
      const modal_current_question_additional_info = cloneDeep(modal_question_additional_info);

      modal_current_question_additional_info.components[0].components[0].setValue(question_info.data.hint ?? '');
      modal_current_question_additional_info.components[1].components[0].setValue(question_info.data.hint_image_url ?? '');
      modal_current_question_additional_info.components[2].components[0].setValue(`${question_info.data.question_audio_repeat ?? ''}` );
      modal_current_question_additional_info.components[3].components[0].setValue(question_info.data.use_answer_timer === true ? '사용' : '');

      interaction.explicit_replied = true;
      interaction.showModal(modal_current_question_additional_info);
      return;
    }

    if(interaction.customId === 'request_modal_question_answering_info')
    {
      const modal_current_question_answering_info = cloneDeep(modal_question_answering_info);

      modal_current_question_answering_info.components[0].components[0].setValue(question_info.data.answer_audio_url ?? '');
      modal_current_question_answering_info.components[1].components[0].setValue(question_info.data.answer_audio_range_row ?? '');
      modal_current_question_answering_info.components[2].components[0].setValue(question_info.data.answer_image_url ?? '');
      modal_current_question_answering_info.components[3].components[0].setValue(question_info.data.answer_text ?? '');

      interaction.explicit_replied = true;
      interaction.showModal(modal_current_question_answering_info);
      return;
    }

    if(interaction.customId === 'question_refresh')
    {
      this.displayQuestionInfo(this.current_question_index);
      return this;
    }

    if(interaction.customId === 'request_modal_question_add')
    {
      interaction.explicit_replied = true;
      interaction.showModal(modal_question_info);
      return;
    }

    if(interaction.customId === 'question_delete')
    {
      if(this.pending_question_delete_confirm !== true) //확인 절차 없이 원클릭으로 바로 삭제되던 것을 2클릭 확인 방식으로 변경
      {
        this.pending_question_delete_confirm = true;
        this.question_edit_comp2.components[1]
          .setLabel('⚠️ 정말 삭제하려면 한 번 더 눌러주세요');
        return this;
      }

      this.resetQuestionDeleteConfirm();

      const index_to_remove = this.question_list.indexOf(this.current_question_info);
      if(index_to_remove !== -1)
      {
        this.question_list.splice(index_to_remove, 1);
      }

      const question_info = this.current_question_info;
      question_info.delete();
      this.quiz_info.updateModifiedTime();

      logger.info(`Deleted Question... question_id: ${question_info.question_id}, user_id: ${interaction.user.id}`);

      this.current_question_info = undefined;

      if(this.question_list.length === 0) //더 이상 표시할게 없다면
      {
        this.current_question_index = -1;
        this.goToBack();
        return;
      }
      else
      {
        this.current_question_index = (this.current_question_index + 1) > this.question_list.length ? this.question_list.length : this.current_question_index + 1;
        return this.goToPrevQuestion();
      }
    }

    if(interaction.customId === 'prev_question')
    {
      return this.goToPrevQuestion();
    }

    if(interaction.customId === 'next_question')
    {
      return this.goToNextQuestion();
    }
  }

  doSelectEvent(interaction: any)
  {
    if(interaction.customId === 'question_answer_type_select_menu') //정답 유형 수정 버튼... 나중에 가서 함수로 빼자
    {
      this.applyQuestionAnswerType(interaction);
      return;
    }
  }

  goToPrevQuestion()
  {
    if(this.current_question_index > 0)
    {
      this.displayQuestionInfo(--this.current_question_index);
      return this;
    }
    return undefined;
  }

  goToNextQuestion()
  {
    if(this.current_question_index < this.question_list.length - 1)
    {
      this.displayQuestionInfo(++this.current_question_index);
      return this;
    }
    return undefined;
  }

  displayQuestionInfo(question_index: number)
  {
    const question_list = this.question_list;

    if(question_index < 0 || question_index >= question_list.length) //이상한거 조회 요청하면
    {
      return;
    }

    const question_info = question_list[question_index];
    this.current_question_info = question_info;

    //url valid check, 값 없으면 true로
    const is_valid_question_audio_url = ((question_info.data.question_audio_url ?? '').length === 0) || ytdl.validateURL(question_info.data.question_audio_url);
    const is_valid_question_image_url = ((question_info.data.question_image_url ?? '').length === 0) || utility.isValidURL(question_info.data.question_image_url);

    const is_valid_hint_image_url = ((question_info.data.hint_image_url ?? '').length === 0) || utility.isValidURL(question_info.data.hint_image_url);

    const is_valid_answer_audio_url = ((question_info.data.answer_audio_url ?? '').length === 0) || ytdl.validateURL(question_info.data.answer_audio_url);
    const is_valid_answer_image_url = ((question_info.data.answer_image_url ?? '').length === 0) || utility.isValidURL(question_info.data.answer_image_url);

    //convert range row to string
    const question_audio_range_string = this.convertAudioRangeToString(question_info.data.audio_start, question_info.data.audio_end, 'question');
    const answer_audio_range_string = this.convertAudioRangeToString(question_info.data.answer_audio_start, question_info.data.answer_audio_end, 'answer');

    /** display */
    this.embed.title = `**[ 📁 ${question_index+1}번째 문제** ]`;
    this.embed.image.url = is_valid_question_image_url ? question_info.data.question_image_url : '';
    this.embed.thumbnail.url = is_valid_answer_image_url ? question_info.data.answer_image_url : '';
    this.embed.footer.text = `📦 ${question_index + 1} / ${this.question_list.length} 문제`;

    let description = '';
    description += " \n------ 기본 정보 ------\n\n```";
    description += `🔸 정답: [${question_info.data.answers}]\n\n`;
    description += `🔸 문제용 오디오:\n[${question_info.data.question_audio_url ?? ''}]\n`;
    if(is_valid_question_audio_url === false)
    {
      description += '❗ 해당 오디오 URL은 사용이 불가능합니다.';
    }
    description += "\n\n";

    description += `🔸 오디오 재생 구간: ${question_audio_range_string}\n\n`;

    description += `🔸 문제용 이미지:\n[${question_info.data.question_image_url ?? ''}]\n`;
    if(is_valid_question_image_url === false)
    {
      description += '❗ 해당 이미지 URL은 사용이 불가능합니다.';
    }
    else
    {
      // description += `만약 이미지 로딩이 안된다면 다른 URL 사용을 권장합니다.`;
    }

    if(question_info.data.question_image_url?.includes('cdn.discordapp.com')) //디코에 올린거로는 안됨. 시간 지나면 사라짐
    {
      description += '❗ 디스코드에 업로드하신 이미지 URL 같아요.\n이 경우 일정 시간이 지나면 이미지가 삭제돼요.';
    }
    description += "\n\n";

    description += `🔸 문제용 텍스트:\n[${question_info.data.question_text ?? ''}]\n`;


    description += " ```\n------ 추가 정보 ------\n\n```";
    description += `🔸 힌트: [${ ( (question_info.data.hint ?? '').length === 0 ? '자동 지정' : question_info.data.hint) }]\n\n`;
    description += `🔸 힌트용 이미지:\n[${question_info.data.hint_image_url ?? ''}]\n`;
    if(is_valid_hint_image_url === false)
    {
      description += '❗ 해당 이미지 URL은 사용이 불가능합니다.';
    }

    if(question_info.data.hint_image_url?.includes('cdn.discordapp.com')) //디코에 올린거로는 안됨. 시간 지나면 사라짐
    {
      description += '❗ 디스코드에 업로드하신 이미지 URL 같아요.\n이 경우 일정 시간이 지나면 이미지가 삭제돼요.';
    }
    description += "\n\n";

    description += `🔸 오디오 반복: [${ question_info.data.question_audio_repeat ?? 1 }회]\n\n`;
    description += `🔸 정답 여유 시간 여부: [${(question_info.data.use_answer_timer === true ? '예' : '아니요')}]\n`;

    description += " ```\n------ 정답 이벤트 정보 ------\n\n```";
    description += `🔸 정답용 오디오:\n[${question_info.data.answer_audio_url ?? ''}]\n`;
    if(is_valid_answer_audio_url === false)
    {
      description += '❗ 해당 오디오 URL은 사용이 불가능합니다.';
    }
    description += "\n\n";

    description += `🔸 정답용 오디오 재생 구간: ${answer_audio_range_string}\n\n`;

    description += `🔸 정답용 이미지:\n[${question_info.data.answer_image_url ?? ''}]\n`;
    if(is_valid_answer_image_url === false)
    {
      description += '❗ 해당 이미지 URL은 사용이 불가능합니다.';
    }

    if(question_info.data.answer_image_url?.includes('cdn.discordapp.com')) //디코에 올린거로는 안됨. 시간 지나면 사라짐
    {
      description += '❗ 디스코드에 업로드하신 이미지 URL 같아요.\n이 경우 일정 시간이 지나면 이미지가 삭제돼요.';
    }
    description += "\n\n";

    description += `🔸 정답용 텍스트:\n[${question_info.data.answer_text ?? ''}]\n`;

    description += `\`\`\`\n---------------------\n\n`;

    this.embed.description = description;

    if(question_list.length >= 50) //최대 50개까지만 문제 만들 수 있음
    {
      this.components[2].components[0].setDisabled(true); //이게 새로운 문제 만들기 버튼임
    }

    const answer_type = question_info.data.answer_type ?? ANSWER_TYPE.SHORT_ANSWER;
    const answer_type_value_id = this.question_answer_type_select_menu.components[0].options[(answer_type - 1)].data.value;
    this.selectDefaultOptionByValue(this.question_answer_type_select_menu.components[0], answer_type_value_id);

    const valid_check = is_valid_question_audio_url
                      & is_valid_question_image_url
                      & is_valid_hint_image_url
                      & is_valid_answer_audio_url
                      & is_valid_answer_image_url;

    return valid_check;
  }

  convertAudioRangeToString(audio_start: any, audio_end: any, type: string) //range value 값 받아서 info 표시용 string 으로 변환
  {
    let audio_range_string = '[랜덤 구간 재생]'; //이게 디폴트

    //audio_start가 0일 때 `0 && ...`가 falsy라 통째로 걸러져서 0초 시작인데도
    //"랜덤 구간 재생"으로 잘못 표시되던 버그. 실제 재생 로직은 0초부터 정상 동작하고
    //있었고(디스코드 유저 제보로 확인), 이 표시 함수만 잘못돼 있었음
    if(audio_start !== undefined && audio_start >= 0)
    {
      audio_range_string = `[${audio_start}초 ~ `;

      if(!audio_end)
      {
        audio_range_string += '오디오 끝까지]';
      }
      else
      {
        audio_range_string += `${audio_end}초]`;
      }

      audio_range_string += `\n(이 구간 내에서 무작위로 최대 ${type === 'question' ? SYSTEM_CONFIG.MAX_QUESTION_AUDIO_PLAY_TIME : SYSTEM_CONFIG.MAX_ANSWER_AUDIO_PLAY_TIME}초만 재생)`;
    }

    return audio_range_string;
  }

  applyQuestionInfo(user_question_info: any, modal_interaction: any)
  {
    const input_question_answers = modal_interaction.fields.getTextInputValue('txt_input_question_answers');
    const input_question_audio_url = modal_interaction.fields.getTextInputValue('txt_input_question_audio_url');
    const input_question_audio_range = modal_interaction.fields.getTextInputValue('txt_input_question_audio_range');
    const input_question_image_url = modal_interaction.fields.getTextInputValue('txt_input_question_image_url');
    const input_question_text = modal_interaction.fields.getTextInputValue('txt_input_question_text');

    user_question_info.data.quiz_id = this.quiz_info.quiz_id;

    user_question_info.data.answers = input_question_answers;
    user_question_info.data.question_audio_url = input_question_audio_url;

    user_question_info.data.audio_range_row = input_question_audio_range; //row 값도 저장

    // 필요 없다
    // if(input_question_audio_range !== undefined
    //   && input_question_audio_range !== ''
    //   && input_question_audio_range.split("~").length === 1) //~ 안치고 숫자 1개만 쳤다면
    // {
    //   user_question_info.data.audio_range_row += " ~ "; //물결 붙여줌
    // }

    const [audio_start_value, audio_end_value, audio_play_time] = this.parseAudioRangePoints(input_question_audio_range);

    user_question_info.data.audio_start = audio_start_value;
    user_question_info.data.audio_end = audio_end_value;
    user_question_info.data.audio_play_time = audio_play_time;

    user_question_info.data.question_image_url = input_question_image_url;
    user_question_info.data.question_text = input_question_text;
  }

  applyQuestionAdditionalInfo(user_question_info: any, modal_interaction: any)
  {
    const input_hint = modal_interaction.fields.getTextInputValue('txt_input_hint');
    const input_hint_image_url = modal_interaction.fields.getTextInputValue('txt_input_hint_image_url');
    const input_question_audio_repeat = modal_interaction.fields.getTextInputValue('txt_input_question_audio_repeat');
    const input_use_answer_timer = modal_interaction.fields.getTextInputValue('txt_input_use_answer_timer');

    user_question_info.data.quiz_id = this.quiz_info.quiz_id;

    user_question_info.data.hint = input_hint ?? "";
    user_question_info.data.hint_image_url = input_hint_image_url ?? "";
    user_question_info.data.question_audio_repeat = this.redefineRepeatCount(input_question_audio_repeat);
    //예전엔 뭐라도 입력만 하면(스페이스 하나 실수로 입력해도) 사용으로 처리돼서 오입력 위험이 있었음.
    //명확한 긍정 응답을 입력했을 때만 사용으로 처리하도록 변경
    user_question_info.data.use_answer_timer = ['사용', '네', '예', 'y', 'Y'].includes(input_use_answer_timer.trim());
  }

  applyQuestionAnsweringInfo(user_question_info: any, modal_interaction: any)
  {
    const input_answering_audio_url = modal_interaction.fields.getTextInputValue('txt_input_answering_audio_url');
    const input_answering_audio_range = modal_interaction.fields.getTextInputValue('txt_input_answering_audio_range');
    const input_answering_image_url = modal_interaction.fields.getTextInputValue('txt_input_answering_image_url');
    const input_answering_text = modal_interaction.fields.getTextInputValue('txt_input_answering_text');

    user_question_info.data.quiz_id = this.quiz_info.quiz_id;

    user_question_info.data.answer_audio_url = input_answering_audio_url ?? "";
    user_question_info.data.answer_image_url = input_answering_image_url ?? "";
    user_question_info.data.answer_text = input_answering_text ?? "";

    user_question_info.data.answer_audio_range_row = input_answering_audio_range;

    const [audio_start_value, audio_end_value, audio_play_time] = this.parseAudioRangePoints(input_answering_audio_range);

    user_question_info.data.answer_audio_start = audio_start_value;
    user_question_info.data.answer_audio_end = audio_end_value;
    user_question_info.data.answer_audio_play_time = audio_play_time;
  }

  parseAudioRangePoints(audio_range_row: any)
  {
    if(audio_range_row.undefined || audio_range_row.length === 0) //생략 시,
    {
      return [undefined, undefined, undefined];
    }

    audio_range_row = audio_range_row.trim();
    if(audio_range_row.endsWith('~')) //25 ~ 이런식으로 쳤으면 ~ 제거
    {
      audio_range_row = audio_range_row.slice(0, audio_range_row.length - 1);
    }

    if(audio_range_row.length === 0) //정제하니깐 생략 시,
    {
      return [undefined, undefined, undefined];
    }

    const audio_range_split = audio_range_row.split('~');

    const audio_start = audio_range_split[0].trim();
    const audio_end = (audio_range_split.length >= 2 ? audio_range_split[1].trim() : undefined);
    let audio_play_time = undefined;

    let audio_start_value = (isNaN(audio_start) || audio_start < 0) ? undefined : Math.floor(audio_start); //소수점과 음수값일 경우 처리
    let audio_end_value = (isNaN(audio_end) || audio_end < 0) ? undefined : Math.floor(audio_end);

    if(audio_start_value !== undefined
      && audio_end_value !== undefined)
    {
      if(audio_start_value > audio_end_value) //start > end 처리
      {
        const temp = audio_start_value;
        audio_start_value = audio_end_value;
        audio_end_value = temp;
      }

      audio_play_time = (audio_end_value - audio_start_value);
    }

    return [audio_start_value, audio_end_value, audio_play_time];
  }

  redefineRepeatCount(audio_repeat_count: any)
  {
    if(!audio_repeat_count || isNaN(audio_repeat_count)) //생략 시,
    {
      return 1; //기본 1회
    }

    const count = parseInt(audio_repeat_count);

    if(count <= 0)
    {
      return 1;
    }

    if(count > SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT)
    {
      return SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT;
    }

    return count;
  }

  async addQuestion(modal_interaction: any)
  {
    if(this.question_list !== undefined && this.question_list.length >= 50) //최대 50개까지만 문제 만들 수 있음
    {
      modal_interaction.explicit_replied = true;
      modal_interaction.reply({ content: `\`\`\`하나의 퀴즈에는 최대 50개의 문제만 만들 수 있습니다.\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }

    const user_question_info = new UserQuestionInfo();

    this.applyQuestionInfo(user_question_info, modal_interaction); //채우고 저장해주자

    const previous_answer_type = this.current_question_info?.data?.answer_type ?? ANSWER_TYPE.SHORT_ANSWER;
    user_question_info.data.answer_type = previous_answer_type; //보통 같은 정답 유형의 문제를 만들거니깐, ux고려해서 이전 선택한 정답 유형 그대로 만들게하자

    const question_id = await user_question_info.saveDataToDB();

    if(question_id === undefined)
    {
      modal_interaction.explicit_replied = true;
      modal_interaction.reply({ content: `\`\`\`${this.quiz_info.quiz_id} / ${modal_interaction.user.id}에서 문제를 생성하는데 실패했습니다...😓.\n해당 문제가 지속될 경우 otter6975@gmail.com 이나 디스코드 DM으로 문의 바랍니다.\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }

    this.quiz_info.updateModifiedTime();

    modal_interaction.explicit_replied = true;
    modal_interaction.deferUpdate();

    this.current_question_index = this.question_list.push(user_question_info) - 1; //새로 추가했으면 무조건 마지막에 넣었을테니
    const valid_check = this.displayQuestionInfo(this.current_question_index);

    this.sendDelayedUI(this, true); //24.05.07 embed 이미지 버그에 따라 새로운 문제면 resend

    logger.info(`Created New Question... question_id: ${user_question_info.question_id}/${question_id}, user_id: ${modal_interaction.user.id}}, quiz_title: ${this.quiz_info.data.quiz_title}`);
  }

  async editQuestionInfo(user_question_info: any, modal_interaction: any)
  {
    if(user_question_info === undefined)
    {
      logger.info(`Failed edit Question info, current_question_info is undefined quiz_id: ${this.quiz_info.quiz_id}, current_question_index: ${this.current_question_index}`);
      return;
    }

    const previous_question_image_url = user_question_info.data.question_image_url;
    //const previous_hint_image_url = user_question_info.data.hint_image_url; //어차피 hint 이미지는 미리보기 없으니 제외
    const previous_answer_image_url = user_question_info.data.answer_image_url;

    if(modal_interaction.customId === 'modal_question_info_edit')
    {
      this.applyQuestionInfo(user_question_info, modal_interaction);
    }
    else if(modal_interaction.customId === 'modal_question_additional_info')
    {
      this.applyQuestionAdditionalInfo(user_question_info, modal_interaction);
    }
    else if(modal_interaction.customId === 'modal_question_answering_info')
    {
      this.applyQuestionAnsweringInfo(user_question_info, modal_interaction);
    }

    const question_id = await user_question_info.saveDataToDB();

    if(question_id === undefined)
    {
      modal_interaction.explicit_replied = true;
      modal_interaction.reply({content: `\`\`\`${this.quiz_info.quiz_id} / ${modal_interaction.user.id}에서 문제를 저장하는데 실패했습니다...😓.\n해당 문제가 지속될 경우 otter6975@gmail.com 이나 디스코드 DM으로 문의 바랍니다.\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    this.quiz_info.updateModifiedTime();

    modal_interaction.explicit_replied = true;
    modal_interaction.deferUpdate();

    const valid_check = this.displayQuestionInfo(this.current_question_index);

    //24.05.07 embed 이미지 로드 간혈적으로 안되는 원인 안 것 같다.
    //embed를 새로 생성하는 것이 아닌 edit을 했을 때, 새로운 이미지 url을 사용하면 이게 바로 바로 로드가 안된다.
    //백그라운드에서 로드는 되는데, 로드 완료 후 표시를 안하는 듯하다.
    //따라서 이미지 url 변경일 경우에는 resend
    if(previous_question_image_url !== user_question_info.data.question_image_url
      || previous_answer_image_url !== user_question_info.data.answer_image_url) //이미지 url이 뭐라도 바뀌었다면
    {
      this.sendDelayedUI(this, true); //24.05.07 embed 이미지 버그에 따라 새로운 문제면 resend
    }
    else
    {
      this.update(); //ui update -> 단순 업데이트
    }

    logger.info(`Edited Question... question_id: ${user_question_info.question_id}/${question_id}`);
  }

  async applyQuestionAnswerType(interaction: any)
  {
    const user_question_info = this.current_question_info;
    if(user_question_info === undefined)
    {
      logger.info(`Failed edit Question info from Select Event, current_question_info is undefined quiz_id: ${this.quiz_info.quiz_id}, current_question_index: ${this.current_question_index}`);
      return;
    }

    const selected_answer_type = interaction.values[0];

    if(selected_answer_type === 'answer_type_short_answer')
    {
      user_question_info.data.answer_type = ANSWER_TYPE.SHORT_ANSWER;
    }
    else if(selected_answer_type === 'answer_type_ox')
    {
      user_question_info.data.answer_type = ANSWER_TYPE.OX;
    }
    else if(selected_answer_type === 'answer_type_multiple_choice')
    {
      user_question_info.data.answer_type = ANSWER_TYPE.MULTIPLE_CHOICE;
    }

    const question_id = await user_question_info.saveDataToDB();

    if(question_id === undefined)
    {
      interaction.channel.send({content: `\`\`\`${this.quiz_info.quiz_id} / ${interaction.user.id}에서 문제를 저장하는데 실패했습니다...😓.\n해당 문제가 지속될 경우 otter6975@gmail.com 이나 디스코드 DM으로 문의 바랍니다.\`\`\``});
      return;
    }

    this.quiz_info.updateModifiedTime();

    this.displayQuestionInfo(this.current_question_index);
  }

}

module.exports = { UserQuestionInfoUI };
