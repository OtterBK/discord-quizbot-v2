'use strict';

//#region 필요한 외부 모듈
const cloneDeep = require("lodash/cloneDeep.js");
const { MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, QUIZ_MAKER_TYPE, QUIZ_TYPE } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const utility = require('../../utility/utility.js');
const {
  omakase_quiz_info_tag_comp,
  omakase_quiz_info_basket_comp,
  modal_omakase_quiz_setting,
  omakase_dev_quiz_tags_select_menu,
  omakase_custom_quiz_type_tags_select_menu,
  omakase_custom_quiz_tags_select_menu,
  request_basket_reopen_comp,
} = require("./components");

const { 
  QuizbotUI,
} = require("./common-ui");


const { QuizInfoUI } = require('./quiz-info-ui.js');
const { UserQuizSelectUI } = require("./user-quiz-select-ui.js");

//#endregion

/** OMAKASE QUIZ Room*/
/** 오마카세 퀴즈 설정 용. 로비 형식임 */
class OmakaseQuizRoomUI extends QuizInfoUI
{
  static createDefaultOmakaseQuizInfo = (interaction) =>
  {
    const guild = interaction.guild;
    let omakase_quiz_info = {};

    omakase_quiz_info['title']  = "오마카세 퀴즈";
    omakase_quiz_info['icon'] = '🍴';

    omakase_quiz_info['type_name'] = "**퀴즈봇 마음대로 퀴즈!**"; 
    omakase_quiz_info['description'] = `\`\`\`선택 메뉴에서 플레이하실 퀴즈 장르나 항목을 선택해주세요!\n선택하신 퀴즈에서 무작위로 문제를 제출합니다.\n\n장르는 여러 개 선택 가능하여 문제 개수도 지정할 수 있습니다.\n\`\`\``; 

    omakase_quiz_info['author'] = guild.name ?? guild.id;
    omakase_quiz_info['author_icon'] = guild.iconURL() ?? '';
    omakase_quiz_info['thumbnail'] = ''; //썸네일은 고정 이미지가 있지롱 ㅎ

    omakase_quiz_info['quiz_size'] = 100; //default
    omakase_quiz_info['selected_question_count'] = 30; //default
    omakase_quiz_info['repeat_count'] = 1; //실제로는 안쓰는 값
    omakase_quiz_info['winner_nickname'] = "플레이어";
    omakase_quiz_info['quiz_path'] = undefined;//oamakase quiz는 quiz_path 불필요
    omakase_quiz_info['quiz_type'] = QUIZ_TYPE.OMAKASE;
    omakase_quiz_info['quiz_maker_type'] = QUIZ_MAKER_TYPE.OMAKASE;

    omakase_quiz_info['quiz_id'] = undefined;  //omasakse quiz는 quiz_id 불필요

    //오마카세 퀴즈용 추가 설정 값
    omakase_quiz_info['basket_mode'] = true; //장바구니 모드
    omakase_quiz_info['basket_items'] = {}; //장바구니 모드

    omakase_quiz_info['dev_quiz_tags'] = 0;
    
    omakase_quiz_info['custom_quiz_type_tags'] = 0;
    omakase_quiz_info['custom_quiz_tags'] = 0;
    omakase_quiz_info['certified_filter'] = true;

    omakase_quiz_info['selected_question_count'] = 30; //default

    omakase_quiz_info['room_owner'] = interaction.member.id;

    return omakase_quiz_info;
  };

  constructor(quiz_info)
  {
    super(quiz_info);

    this.need_tags = true;

    this.modal_quiz_setting = cloneDeep(modal_omakase_quiz_setting);

    this.initializeEmbed();
    this.initializeComponents();
    this.initializeTagSelectedHandler();

    this.refreshUI();
  }

  initializeEmbed() 
  {
    this.embed = {
      color: 0x87CEEB,
      title: `${this.quiz_info['icon']} ${this.quiz_info['title']}`,
      description: undefined,
      thumbnail: { //퀴즈 섬네일 표시
        url: this.quiz_info['thumbnail'] ?? '',
      },
      footer: { //퀴즈 제작자 표시
        text: this.quiz_info['author'] ?? '',
        icon_url: this.quiz_info['author_icon'] ?? '',
      },
    };
  }

  initializeComponents() 
  {
    this.components = []; //여기서는 component를 바꿔서 해주자
  }

  initializeTagSelectedHandler()
  {
    this.tag_selected_handler = 
    {
      'dev_quiz_tags_select_menu': this.handleTagSelected.bind(this),
      'custom_quiz_type_tags_select_menu': this.handleTagSelected.bind(this),
      'custom_quiz_tags_select_menu':  this.handleTagSelected.bind(this),
    };
  }

  onInteractionCreate(interaction) 
  {
    if(this.isTagSelectedEvent(interaction)) //퀴즈 장르 설정 시
    {
      return this.handleTagSelectedEvent(interaction);
    }

    return super.onInteractionCreate(interaction);
  }

  isTagSelectedEvent(interaction)
  {
    return this.tag_selected_handler[interaction.customId] !== undefined;
  }

  handleTagSelectedEvent(interaction)
  {
    const handler = this.tag_selected_handler[interaction.customId];
    return handler(interaction);
  }

  handleTagSelected(interaction)
  {
    const tag_changed = this.applyQuizTagsSetting(interaction);
    if(tag_changed === false)
    {
      return;
    }

    this.refreshUI();
    return this;
  }

  handleRequestUseBasketMode(interaction)
  {
    let basket_items = this.quiz_info['basket_items'];
    if(basket_items === undefined)
    {
      this.quiz_info['basket_items'] = {};
      basket_items = this.quiz_info['basket_items'];
    }

    const use_basket_mode = this.quiz_info['basket_mode'] ?? true;
    if(use_basket_mode === true) //이미 사용 중이다?
    {
      return new UserQuizSelectUI(basket_items); //그럼 다시 담을 수 있게 ㄱㄱ
    }

    this.quiz_info['basket_mode'] = true;

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`장바구니 모드를 사용합니다.\n장바구니 모드는 직접 원하는 유저 퀴즈들을 선택하면\n선택한 퀴즈들에서만 무작위로 문제가 출제됩니다. \`\`\``, flags: MessageFlags.Ephemeral});

    return new UserQuizSelectUI(basket_items);
  }

  handleLoadBasketItems(interaction)
  {
    const guild_id = interaction.guild.id;
    const cached_basket_items = QuizInfoUI.BASKET_CACHE[guild_id];

    if(!cached_basket_items)
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🔸 최근 장바구니 데이터가 없어요...\n🔸 장바구니 데이터는 서버가 재시작 될 때까지만 유효합니다.\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    this.quiz_info['basket_items'] = cloneDeep(cached_basket_items);

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`🔸 ${Object.keys(this.quiz_info.basket_items).length} 개의 장바구니 데이터를 불러왔어요.\`\`\``, flags: MessageFlags.Ephemeral});

    this.refreshUI();
    return this;
  }

  handleRequestUseTagMode(interaction)
  {
    this.quiz_info['basket_mode'] = false;

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`🔸 장르 선택 모드를 사용합니다.\n선택하신 장르에 따라 퀴즈봇이 문제를 제출합니다.\`\`\``, flags: MessageFlags.Ephemeral});

    this.refreshUI();
    return this;
  }

  refreshUI()
  {
    let description = this.getDescription();
    
    description += this.getTagInfoText();

    this.embed.description = description;

    this.setUpOmakaseQuizSelectComponent();
  }

  setUpOmakaseQuizSelectComponent()
  {
    this.initializeComponents(); //컴포넌트 초기화하고

    const use_basket_mode = this.quiz_info['basket_mode'] ?? true;

    if(use_basket_mode === false)
    {
      this.components.push(omakase_quiz_info_tag_comp);
    }
    else
    {
      this.components.push(omakase_quiz_info_basket_comp);
    }

    this.components.push(omakase_dev_quiz_tags_select_menu);

    if(use_basket_mode === false)
    {
      this.components.push(omakase_custom_quiz_type_tags_select_menu);
      this.components.push(omakase_custom_quiz_tags_select_menu);
    }
    else
    {
      this.setupBasketSelectMenu();
      this.components.push(this.basket_select_component);
      this.components.push(request_basket_reopen_comp);
    }   
  }

}

module.exports = { OmakaseQuizRoomUI };
