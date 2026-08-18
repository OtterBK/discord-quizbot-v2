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
  omakase_basket_manage_open_comp,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");


const { QuizInfoUI } = require('./quiz-info-ui');
const { UserQuizSelectUI } = require("./user-quiz-select-ui");
const basket_manage_flow = require('./basket-manage-flow');

//퀴즈함 50개 확장(docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md Phase A) - 오마카세 한정, UserQuizSelectUI의
//기본값(25, 멀티플레이 로비용)과 분리.
const OMAKASE_MAX_BASKET_SIZE = 50;

//#endregion

/** OMAKASE QUIZ Room*/
/** 오마카세 퀴즈 설정 용. 로비 형식임 */
class OmakaseQuizRoomUI extends QuizInfoUI
{
  static createDefaultOmakaseQuizInfo = (interaction: any) =>
  {
    const guild = interaction.guild;
    const omakase_quiz_info: any = {};

    omakase_quiz_info['title']  = "랜덤 퀴즈";
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

  //퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 3 - 웹에서 받은 payload(공식/유저 태그, 인증
  //필터, 퀴즈함, 문제 수)를 quiz_info에 덮어씌운다. omakase는 DB 조회가 필요 없는 작은 데이터라
  //dev 모드처럼 동기로 처리 가능. WebHandoffUI(최초 적용)와 이 클래스 자신(확정 후 재적용)이 공유해서 씀.
  static applyWebPayloadToQuizInfo = (quiz_info: any, payload: any): any =>
  {
    quiz_info['dev_quiz_tags'] = payload['dev_quiz_tags'] ?? 0;
    quiz_info['basket_mode'] = payload['basket_mode'] ?? true;
    quiz_info['custom_quiz_type_tags'] = payload['custom_quiz_type_tags'] ?? 0;
    quiz_info['custom_quiz_tags'] = payload['custom_quiz_tags'] ?? 0;
    quiz_info['certified_filter'] = payload['certified_filter'] ?? true;
    quiz_info['basket_items'] = payload['basket_items'] ?? {};

    const requested_count = parseInt(payload['selected_question_count']);
    quiz_info['selected_question_count'] = isNaN(requested_count)
      ? 30
      : Math.max(1, Math.min(quiz_info['quiz_size'], requested_count));

    return quiz_info;
  };

  //웹에서 최초로 "선택 완료"했을 때(WebHandoffUI.handleApplied) 기본 omakase_quiz_info를 만들고 그 위에
  //웹 payload를 덮어씌운다. adapter_interaction은 실제 interaction 없이 호출해야 하는 WebHandoffUI가
  //{guild, member: {id}} 형태의 최소 어댑터 객체를 넘김(createDefaultOmakaseQuizInfo가 그 둘만 씀).
  static buildOmakaseQuizInfoFromWebPayload = (payload: any, adapter_interaction: any): any =>
  {
    const omakase_quiz_info = OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo(adapter_interaction);
    return OmakaseQuizRoomUI.applyWebPayloadToQuizInfo(omakase_quiz_info, payload);
  };

  constructor(quiz_info: any)
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

  onInteractionCreate(interaction: any)
  {
    if(this.isTagSelectedEvent(interaction)) //퀴즈 장르 설정 시
    {
      return this.handleTagSelectedEvent(interaction);
    }

    //퀴즈함 관리 + 프리셋(docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md) - 독립 ephemeral 화면이라 화면
    //전환 없이(항상 undefined 반환) 자체적으로 응답까지 처리함, super로 안 내려감. 버튼/셀렉트
    //(basket_manage_ 접두사)와 모달 제출(modal_basket_preset_ 접두사, customId 뒤에 preset_id가
    //인코딩돼 있어 정확한 값 매칭이 아니라 접두사 체크) 둘 다 확인해야 함 - 안 그러면 모달 제출이
    //그냥 무시됨(2026-08-18 구현 중 발견해 바로 수정).
    if(basket_manage_flow.isBasketManageEvent(interaction) || basket_manage_flow.isBasketManageModalEvent(interaction))
    {
      return basket_manage_flow.handleBasketManageEvent(interaction, this);
    }

    return super.onInteractionCreate(interaction);
  }

  isTagSelectedEvent(interaction: any)
  {
    return this.tag_selected_handler[interaction.customId] !== undefined;
  }

  handleTagSelectedEvent(interaction: any)
  {
    const handler = this.tag_selected_handler[interaction.customId];
    return handler(interaction);
  }

  handleTagSelected(interaction: any)
  {
    const tag_changed = this.applyQuizTagsSetting(interaction);
    if(tag_changed === false)
    {
      return;
    }

    this.refreshUI();
    return this;
  }

  handleRequestUseBasketMode(interaction: any)
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
      return new UserQuizSelectUI(basket_items, OMAKASE_MAX_BASKET_SIZE); //그럼 다시 담을 수 있게 ㄱㄱ
    }

    this.quiz_info['basket_mode'] = true;

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`퀴즈함 모드를 사용합니다.\n퀴즈함 모드는 직접 원하는 유저 퀴즈들을 선택하면\n선택한 퀴즈들에서만 무작위로 문제가 출제됩니다. \`\`\``, flags: MessageFlags.Ephemeral});

    return new UserQuizSelectUI(basket_items, OMAKASE_MAX_BASKET_SIZE);
  }

  handleRequestUseTagMode(interaction: any)
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
      //퀴즈함 표시/제거는 이제 메인 화면이 아니라 basket-manage-flow.ts의 독립 ephemeral 화면이
      //전담(docs/plans/QUIZ_BASKET_PRESET_UI_PLAN.md) - 이 화면엔 진입 버튼만 남는다.
      this.components.push(omakase_basket_manage_open_comp);
    }
  }

  //퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 3 - "선택 완료" 이후에도 웹 세션 토큰은
  //살아있어서(dev/user 모드와 동일한 이유), 웹에서 설정을 다시 바꾸고 확정하면 이 화면에 그대로
  //반영해야 한다. omakase는 DB 조회가 필요 없어 동기로 처리 가능 - dev-quiz-info-ui.ts와 같은 이유로
  //새 인스턴스를 반환하지 않고 같은 인스턴스를 갱신한다(뒤로가기 스택 누적 방지).
  onReceivedWebSessionSignal(signal: any): any
  {
    if(signal.event !== 'applied')
    {
      return undefined;
    }

    OmakaseQuizRoomUI.applyWebPayloadToQuizInfo(this.quiz_info, signal.payload);

    this.refreshUI();
    this.update();

    return this;
  }

}

module.exports = { OmakaseQuizRoomUI };
