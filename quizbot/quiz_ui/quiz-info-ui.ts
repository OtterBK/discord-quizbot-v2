'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, DEV_QUIZ_TAG, QUIZ_TAG } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../utility/utility.js');
const quiz_system = require('../quiz_system/quiz_system'); //퀴즈봇 메인 시스템
const ipc_manager = require('../managers/ipc_manager');
const {
  quiz_info_comp,
  modal_quiz_setting,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

const { AlertQuizStartUI } = require("./alert-quiz-start-ui");
const { ServerSettingUI } = require("./server-setting-ui");
const { cloneDeep } = require('lodash');

//#endregion

/** 퀴즈 정보 표시 UI, Dev퀴즈/User퀴즈 둘 다 사용 */
class QuizInfoUI extends QuizbotUI
{
  quiz_info: any;
  max_quiz_count: number;
  need_tags: boolean;
  custom_quiz_warned: boolean;

  constructor(quiz_info: any = {})
  {
    super();

    this.quiz_info = quiz_info;
    this.max_quiz_count = 100;
    this.need_tags = false;
    this.custom_quiz_warned = false; //커스텀 퀴즈 설정 시 주의 사항 안내했는지 여부
    this.readonly = false;

    this.embed = {
      color: 0x87CEEB,
      title: `${this.quiz_info['icon'] ?? ''} ${this.quiz_info['title'] ?? ''}`,
      description: undefined,
      thumbnail: { //퀴즈 섬네일 표시
        url: this.quiz_info['thumbnail'] ?? '',
      },
      footer: { //퀴즈 제작자 표시
        text: this.quiz_info['author'] ?? '',
        icon_url: this.quiz_info['author_icon'] ?? '',
      },
    };

    this.components = [quiz_info_comp]; //여기서는 component를 바꿔서 해주자

    this.modal_quiz_setting = cloneDeep(modal_quiz_setting);

    this.initializeQuizInfoUIEventHandler();

  }

  initializeQuizInfoUIEventHandler()
  {
    this.quiz_info_ui_handler =
    {
      'start': this.handleStartQuiz.bind(this),
      'scoreboard': this.handleRequestScoreboard.bind(this),
      'settings': this.handleRequestSettingUI.bind(this),
      'request_modal_quiz_setting': this.handleRequestModalQuizSetting.bind(this),
      'modal_quiz_setting': this.handleSubmitModalQuizSetting.bind(this),
      'use_tag_mode': this.handleRequestUseTagMode.bind(this),
      'use_basket_mode': this.handleRequestUseBasketMode.bind(this),
    };
  }

  refreshUI()
  {
    const description = this.getDescription();

    this.embed.description = description;
  }

  getDescription()
  {
    const description = text_contents.quiz_info_ui.description;

    const all_question_count = this.quiz_info['quiz_size'] ?? this.max_quiz_count;

    return description
      .replace('${quiz_size}', `[ ${this.quiz_info['selected_question_count'] ?? this.quiz_info['quiz_size']} / ${all_question_count} ]`)
      .replace('${quiz_type_name}', `${this.quiz_info['type_name'] ?? ''}`)
      .replace('${quiz_description}', `${this.quiz_info['description'] ?? ''}`);
  }

  getTagInfoText()
  {
    let tag_info_text = "\n";

    // 공식 퀴즈 설정
    tag_info_text += `📕 **공식 퀴즈 설정**\n`;
    const dev_quiz_tags = this.quiz_info['dev_quiz_tags'];
    const dev_quiz_tags_string = this.formatTagsString(dev_quiz_tags);
    tag_info_text += `🔸 퀴즈 유형: \`음악 퀴즈\`\n`;
    tag_info_text += `🔹 퀴즈 장르: \`${dev_quiz_tags_string}\`\n\n`;

    tag_info_text += `📗 **유저 퀴즈 설정**\n`;
    const use_basket_mode = this.quiz_info['basket_mode'] ?? true;
    if(use_basket_mode === false)
    {
      // 유저 퀴즈 설정
      const custom_quiz_type_tags = this.quiz_info['custom_quiz_type_tags'];
      const custom_quiz_tags = this.quiz_info['custom_quiz_tags'];

      const custom_quiz_type_tags_string = this.getCustomQuizTypeString(custom_quiz_type_tags);
      const custom_quiz_tags_string = this.getCustomQuizTagsString(custom_quiz_tags, custom_quiz_type_tags);

      tag_info_text += `🔸 퀴즈 유형: \`${custom_quiz_type_tags_string}\`\n`;
      tag_info_text += `🔹 퀴즈 장르: \`${custom_quiz_tags_string}\`\n`;

      const certified_filter = this.quiz_info['certified_filter'] ?? true;
      tag_info_text += `🔹 인증(추천 10개↑) 필터: \`${certified_filter ? '인증된 퀴즈만 출제' : '모든 퀴즈 출제' }\`\n\n`;
    }
    else
    {
      //퀴즈함에 몇 개 담겼는지 가시성 있게 표시(2026-08-19 피드백) - basket_items는 오마카세/멀티
      //둘 다 quiz_info에 직접 들고 있어 room_ui 종류와 무관하게 여기서 바로 셀 수 있음.
      const basket_item_count = Object.keys(this.quiz_info['basket_items'] ?? {}).length;
      tag_info_text += `🔸 \`퀴즈함 모드 사용 중\` (${basket_item_count}개 담김)\n\n`;
    }

    return tag_info_text;
  }

  formatTagsString(tags: any)
  {
    const tagsString = utility.convertTagsValueToString(tags, DEV_QUIZ_TAG);
    return tagsString === '' ? '선택 안함' : tagsString;
  }

  getCustomQuizTypeString(typeTags: any)
  {
    if (typeTags === 0)
    {
      return '선택 안함';
    }
    return utility.convertTagsValueToString(typeTags, QUIZ_TAG);
  }

  getCustomQuizTagsString(quizTags: any, typeTags: any)
  {
    if (quizTags === 0)
    {
      return typeTags !== 0 ? '모든 장르(분류되지 않은 퀴즈 포함)' : '선택 안함';
    }
    return utility.convertTagsValueToString(quizTags, QUIZ_TAG);
  }

  onInteractionCreate(interaction: any)
  {
    if(this.isUnsupportedInteraction(interaction))
    {
      return;
    }

    if(this.isQuizInfoUIEvent(interaction))
    {
      return this.handleQuizInfoUIEvent(interaction);
    }
  }

  onAwaked() //ui 재활성화 됐을 때, UserQuestionInfo 에서 back 쳐서 돌아왔을 때, select menu 랑 문제 수 갱신해줘야함. 장바구니도 고려
  {
    this.refreshUI();
  }

  isQuizInfoUIEvent(interaction: any)
  {
    return this.quiz_info_ui_handler[interaction.customId] !== undefined;
  }

  handleQuizInfoUIEvent(interaction: any)
  {
    const handler = this.quiz_info_ui_handler[interaction.customId];
    return handler(interaction);
  }

  handleStartQuiz(interaction: any)
  {
    const quiz_info = this.quiz_info;

    if(this.checkTagSelected() === false)
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🔸 시작하시려면 퀴즈 유형 및 장르를 1개라도 선택해주세요!\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    const guild = interaction.guild;
    const owner = interaction.member; //주최자
    const channel = interaction.channel;

    const check_ready = quiz_system.checkReadyForStartQuiz(guild, owner); //퀴즈를 플레이할 준비가 됐는지(음성 채널 참가 확인 등)
    if(check_ready === undefined || check_ready.result === false)
    {
      const reason = check_ready.reason;
      const reason_message = text_contents.quiz_info_ui.failed_start.replace("${reason}", reason);

      interaction.explicit_replied = true;
      interaction.reply({content: reason_message, flags: MessageFlags.Ephemeral});
      return;
    }

    quiz_system.startQuiz(guild, owner, channel, quiz_info); //퀴즈 시작

    //퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - 이 길드에 살아있는 웹 세션이 있다면 파기 요청.
    //fire-and-forget(응답 기다릴 필요 없음), 세션이 없는 길드(대부분의 경우)에도 안전한 no-op이라
    //무조건 시도한다.
    ipc_manager.sendWebSessionRequest({ action: 'release', guild_id: guild.id }).catch(() => {});

    return new AlertQuizStartUI(quiz_info, owner.displayName);
  }

  handleRequestScoreboard(interaction: any)
  {
    //TODO 순위표 만들기
  }

  handleRequestSettingUI(interaction: any)
  {
    return new ServerSettingUI(interaction.guild.id);
  }

  handleRequestModalQuizSetting(interaction: any)
  {
    const modal_current_quiz_setting = this.modal_quiz_setting;

    const selected_question_count_component = this.getComponentFromModalComponent(modal_current_quiz_setting, 'txt_input_selected_question_count');
    if(selected_question_count_component !== undefined)
    {
      selected_question_count_component.setLabel(`몇 개의 문제를 제출할까요? (최대 ${this.quiz_info['quiz_size'] ?? this.max_quiz_count})`);
      selected_question_count_component.setValue(`${this.quiz_info.selected_question_count ?? this.quiz_info.quiz_size}`);
    }

    const custom_title_component = this.getComponentFromModalComponent(modal_current_quiz_setting, 'txt_input_custom_title');
    if(custom_title_component !== undefined)
    {
      custom_title_component.setValue(`${this.quiz_info.title ?? ''}`);
    }

    const certified_filter_off_component = this.getComponentFromModalComponent(modal_current_quiz_setting, 'txt_input_certified_quiz_filter_off');
    if(certified_filter_off_component !== undefined)
    {
      const use_certified_filter = this.quiz_info.certified_filter ?? true;
      certified_filter_off_component.setValue(`${use_certified_filter ? '' : '네'}`);
    }

    interaction.explicit_replied = true;
    interaction.showModal(modal_current_quiz_setting); //퀴즈 설정 모달 전달
  }

  handleSubmitModalQuizSetting(interaction: any)
  {
    const need_refresh = this.applyQuizSettings(interaction);

    if(!interaction.explicit_replied)
    {
      interaction.explicit_replied = true;
      interaction.deferUpdate();
    }

    if(need_refresh === false)
    {
      return;
    }

    this.refreshUI();
    return this;
  }

  checkHasComponentFieldFromModalSubmit(interaction: any, custom_id: string)
  {
    const exists = interaction.fields.components.some((row: any) =>
      row.components.some((component: any) => component.customId === custom_id)
    );

    return exists;
  }

  getComponentFromModalComponent(modal_comp: any, custom_id: string)
  {
    const target_component = modal_comp.components
      .flatMap((actionRow: any) => actionRow.components)
      .find((component: any) =>
      {
        if(component.data.custom_id === custom_id)
        {
          return true;
        }
      });

    return target_component;
  }

  applyQuizSettings(interaction: any)
  {
    let need_refresh: any = false;

    need_refresh |= (this.applySelectedQuestionCount(interaction) as any);
    need_refresh |= (this.applyCustomTitle(interaction) as any);
    need_refresh |= (this.applyCertifiedFilter(interaction) as any);

    return need_refresh;
  }

  applySelectedQuestionCount(interaction: any)
  {
    if(this.checkHasComponentFieldFromModalSubmit(interaction, 'txt_input_selected_question_count') === false)
    {
      return false;
    }

    const input_selected_question_count = interaction.fields.getTextInputValue('txt_input_selected_question_count');

    if(input_selected_question_count === undefined || input_selected_question_count === '')
    {
      return false;
    }

    const quiz_info = this.quiz_info;
    const all_question_count = quiz_info['quiz_size'] ?? this.max_quiz_count;
    const min_quiz_size = quiz_info['min_quiz_size'] ?? 1;

    let selected_question_count = parseInt(input_selected_question_count.trim());
    if(isNaN(selected_question_count) || selected_question_count <= 0) //입력 값 잘못된거 처리
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🔸 문제 수 설정에 입력된 ${input_selected_question_count} 값은 잘못됐습니다.\n양수의 숫자만 입력해주세요.\`\`\``, flags: MessageFlags.Ephemeral});
      return false;
    }

    if(selected_question_count > all_question_count)
    {
      selected_question_count = all_question_count;
    }

    if(selected_question_count < min_quiz_size)
    {
      selected_question_count = min_quiz_size;
    }

    // interaction.explicit_replied = true;
    // interaction.reply({content: `\`\`\`🔸 제출할 문제 수를 ${selected_question_count}개로 설정했습니다.\`\`\``, flags: MessageFlags.Ephemeral});
    quiz_info['selected_question_count'] = selected_question_count;

    return true;
  }

  applyCustomTitle(interaction: any)
  {
    if(this.checkHasComponentFieldFromModalSubmit(interaction, 'txt_input_custom_title') === false)
    {
      return false;
    }

    const lobby_name = interaction.fields.getTextInputValue('txt_input_custom_title');
    if(lobby_name === undefined || lobby_name === '' || this.quiz_info['title'] === lobby_name)
    {
      return true;
    }

    this.quiz_info['title'] = lobby_name;
    return true;
  }

  applyCertifiedFilter(interaction: any)
  {
    if(this.checkHasComponentFieldFromModalSubmit(interaction, 'txt_input_certified_quiz_filter_off') === false)
    {
      return false;
    }

    const is_offed = interaction.fields.getTextInputValue('txt_input_certified_quiz_filter_off');

    //예전엔 뭐라도 입력만 하면(스페이스 하나 실수로 입력해도) off로 처리돼서 오입력 위험이 있었음.
    //명확한 긍정 응답을 입력했을 때만 off로 처리하도록 변경
    const use_certified_filter = !['네', '예', 'ㅇ', 'y', 'Y'].includes(is_offed.trim());

    if(this.quiz_info['certified_filter'] === use_certified_filter)
    {
      return false;
    }

    this.quiz_info['certified_filter'] = use_certified_filter;

    if(use_certified_filter === false)
    {
      interaction.channel.send({content: `\`\`\`⚠ 주의! 인증 필터가 꺼졌습니다.\n인증되지 않은 퀴즈를 포함한 모든 퀴즈가 출제 문제로 사용됩니다.\n출제될 문제는 다양해지지만 일반적으론 권장되지 않습니다.\`\`\``});
    }
    else
    {
      interaction.channel.send({content: `\`\`\`🔸 인증 필터가 켜졌습니다.\n인증된 퀴즈만 출제 문제로 사용됩니다.\`\`\``});
    }

    return true;
  }

  applyQuizTagsSetting(interaction: any)
  {
    const quiz_info = this.quiz_info;

    const tags_value = utility.calcTagsValue(interaction.values);
    let tags_value_type = '';
    if(interaction.customId === 'dev_quiz_tags_select_menu') //공식 퀴즈 장르 설정 시
    {
      tags_value_type = 'dev_quiz_tags';
    }
    else if(interaction.customId === 'custom_quiz_type_tags_select_menu') //유저 퀴즈 유형 설정 시
    {
      tags_value_type = 'custom_quiz_type_tags';
      this.sendCustomQuizWarning(interaction.channel);
    }
    else if(interaction.customId === 'custom_quiz_tags_select_menu') //유저 퀴즈 장르 설정 시
    {
      tags_value_type = 'custom_quiz_tags';
      this.sendCustomQuizWarning(interaction.channel);
    }

    if(tags_value_type === '')
    {
      return false;
    }

    const previous_tags_value = quiz_info[tags_value_type];
    if(previous_tags_value === tags_value) //같으면 할 게 없다
    {
      return false;
    }

    quiz_info[tags_value_type] = tags_value;

    return true;
  }

  sendCustomQuizWarning(channel: any)
  {
    if(this.custom_quiz_warned === true)
    {
      return;
    }

    this.custom_quiz_warned = true;
    const warn_message = "```⚠ 주의! 퀴즈 유형에 유저 퀴즈를 설정하셨습니다.\n공식 퀴즈와 달리 유저 퀴즈는 장르 구분이 정확하지 않을 수 있습니다.\n또한 유저 퀴즈는 플레이 중 오류가 발생할 수 있으니 주의 바랍니다.```";
    channel.send({content: warn_message});
  }

  checkTagSelected()
  {
    return this.need_tags == false || this.quiz_info['dev_quiz_tags'] !== 0 || this.quiz_info['custom_quiz_type_tags'] !== 0 || (this.quiz_info['basket_mode'] && Object.keys(this.quiz_info['basket_items']).length > 0);
  }

  handleRequestUseBasketMode(interaction: any)
  {
    //일반적으론 지원하지 않음
  }

  handleRequestUseTagMode(interaction: any)
  {
    //일반적으로 지원하지 않음
  }

}

module.exports = { QuizInfoUI };
