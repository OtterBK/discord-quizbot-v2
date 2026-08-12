'use strict';

//#region 필요한 외부 모듈
const { RESTJSONErrorCodes, MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE } = require('../../config/system_setting.js');
const PRIVATE_CONFIG = require('../../config/private_config.json');
const logger = require('../../utility/logger.js')('QuizUI');

const { QuizbotUI } = require('./common-ui');
const { MainUI } = require("./main-ui");
const { SelectUIModeUI } = require("./select-ui-mode-ui");
const { AdminPanelUI } = require("./admin-panel-ui");
const { MultiplayerQuizLobbyUI } = require('./multiplayer-quiz-lobby-ui.js');
const { WebHandoffUI } = require('./web-handoff-ui');
const { QuizEditSelectUIModeUI } = require('./quiz-edit-select-ui-mode-ui');
const { QuizEditWebHandoffUI } = require('./quiz-edit-web-handoff-ui');
const { SERVER_SIGNAL } = require('../managers/multiplayer_signal.js');
const { web_handoff_force_take_comp } = require('./components');
const ipc_manager = require('../managers/ipc_manager');

//#endregion

/** global 변수 **/
let ui_holder_map: Record<string, any> = {}; //UI holdermap은 그냥 quizbot-ui 에서 가지고 있게 하자
let bot_client: any = undefined;

//#region exports 정의
/** exports **/
//main embed 인스턴스 반환
const initialize = (client: any): boolean =>
{
  if(client === undefined)
  {
    logger.error(`Failed to Initialize Quiz system. ${'Client is undefined'}`);
    return false;
  }
  bot_client = client;

  return true;
};

//퀴즈 플레이 툴
const createMainUIHolder = (interaction: any): any =>
{
  const guild_id = interaction.guild.id;
  if(ui_holder_map.hasOwnProperty(guild_id))
  {
    const prev_uiHolder = ui_holder_map[guild_id];

    if(prev_uiHolder.isDisplayingMultiplayerLobby())
    {
      interaction.explicit_replied = true;
      interaction.reply( { content:`\`\`\`🔸 현재 이 서버에서 멀티플레이 로비에 참가 중이기에 새로운 UI를 생성할 수 없습니다.\n만약 멀티플레이 로비에 참가 중이 아닌데도 해당 메시지가 표시된다면\n\`[/퀴즈정리]\` 명령어를 입력해보세요.\`\`\`` , flags: MessageFlags.Ephemeral });

      prev_uiHolder.sendDelayedUI(prev_uiHolder.ui, true);
      return undefined;
    }

    if(prev_uiHolder.isDisplayingWebHandoff()) //다른 유저가 웹에서 세팅 중이면 하이재킹 방어 안내만 (WEB_INTEGRATION_PLAN.md 5번)
    {
      interaction.explicit_replied = true;
      interaction.reply( { content:`\`\`\`🔒 ${prev_uiHolder.getOwnerName()} 님이 웹에서 퀴즈를 세팅하는 중입니다.\n권한을 가져오면 상대방의 웹 세션은 즉시 종료됩니다.\`\`\``, components: [web_handoff_force_take_comp], flags: MessageFlags.Ephemeral });
      return undefined;
    }

    prev_uiHolder.free();
  }
  const uiHolder = new UIHolder(interaction, new SelectUIModeUI(), UI_HOLDER_TYPE.PUBLIC); //디스코드 UI/웹 UI 선택 화면부터 시작(WEB_INTEGRATION_PLAN.md 투트랙 진입)
  uiHolder.holder_id = guild_id;
  ui_holder_map[guild_id] = uiHolder;

  uiHolder.updateUI();

  return uiHolder;
};

//퀴즈 제작 툴 - 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1: 최초 화면이
//UserQuizListUI(디스코드 UI 직행)에서 QuizEditSelectUIModeUI(디스코드 UI/웹 UI 투트랙 분기)로 바뀜
//(createMainUIHolder의 SelectUIModeUI와 동일 패턴). QuizEditSelectUIModeUI는 DB 조회가 없는 동기
//화면이라(UserQuizListUI와 달리 onReady()가 스스로 update()하지 않음) createMainUIHolder처럼 여기서
//직접 updateUI()를 호출해야 한다.
const createQuizToolUIHolder = (interaction: any): any =>
{
  const user_id = interaction.user.id ?? interaction.member.id;
  if(ui_holder_map.hasOwnProperty(user_id))
  {
    const prev_uiHolder = ui_holder_map[user_id];
    prev_uiHolder.free();
  }
  const uiHolder = new UIHolder(interaction, new QuizEditSelectUIModeUI(), UI_HOLDER_TYPE.PRIVATE);
  uiHolder.holder_id = user_id;
  ui_holder_map[user_id] = uiHolder;

  uiHolder.updateUI();

  return uiHolder;
};

//관리자 전용 패널 (호출부인 bot.js의 quiz_manager_panel_handler에서 이미 어드민 여부를
//확인하지만, 여기서도 한 번 더 확인한다 - 방어적 이중 체크)
const createAdminPanelUIHolder = (interaction: any): any =>
{
  const user_id = interaction.user.id ?? interaction.member.id;
  if(user_id !== PRIVATE_CONFIG?.ADMIN_ID)
  {
    return undefined;
  }

  if(ui_holder_map.hasOwnProperty(user_id))
  {
    const prev_uiHolder = ui_holder_map[user_id];
    prev_uiHolder.free();
  }
  const uiHolder = new UIHolder(interaction, new AdminPanelUI(), UI_HOLDER_TYPE.PRIVATE);
  uiHolder.holder_id = user_id;
  ui_holder_map[user_id] = uiHolder;

  uiHolder.updateUI();

  return uiHolder;
};

//퀴즈 선택 웹 연동 - '/퀴즈' 명령어에서 웹 세팅 화면으로 바로 진입할 때(select-quiz-type-ui.ts),
//force_take로 이미 발급된 세션을 이어받아 진입할 때(bot.js의 force_take 핸들러) 둘 다 여기로 옴.
//existing_session이 있으면 WebHandoffUI가 내부적으로 새 'create' 요청을 보내지 않고 바로 잠금 화면을 그린다.
//use_public_message_mode: force_take처럼 넘겨받은 interaction이 이미 deferUpdate()로 소비된 경우
//true로 넘겨야 함 - UIHolder.updatePublicUI()가 interaction.reply() 대신 channel.send()로 새 메시지를
//보내도록 전환(sendDelayedUI가 뒤로가기 등에서 쓰는 것과 동일한 public_message_mode 스위치).
const createWebHandoffUIHolder = (interaction: any, mode: string, existing_session: any = undefined, use_public_message_mode: boolean = false): any =>
{
  const guild_id = interaction.guild.id;
  if(ui_holder_map.hasOwnProperty(guild_id))
  {
    const prev_uiHolder = ui_holder_map[guild_id];
    prev_uiHolder.free();
  }

  const uiHolder = new UIHolder(interaction, new WebHandoffUI(mode, interaction, existing_session), UI_HOLDER_TYPE.PUBLIC);
  uiHolder.holder_id = guild_id;
  uiHolder.public_message_mode = use_public_message_mode;
  ui_holder_map[guild_id] = uiHolder;

  uiHolder.updateUI();

  return uiHolder;
};

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1 - createWebHandoffUIHolder와 거의 동일한
//패턴이되 PRIVATE(DM)로 생성하고 하이재킹 방어가 없다(DM은 봇-유저 1:1이라 애초에 다른 유저가 이
//홀더를 볼 방법이 없음 - force_take/use_public_message_mode 개념 자체가 불필요).
const createQuizEditWebHandoffUIHolder = (interaction: any, existing_session: any = undefined): any =>
{
  const user_id = interaction.user.id ?? interaction.member.id;
  if(ui_holder_map.hasOwnProperty(user_id))
  {
    const prev_uiHolder = ui_holder_map[user_id];
    prev_uiHolder.free();
  }

  const uiHolder = new UIHolder(interaction, new QuizEditWebHandoffUI(interaction, existing_session), UI_HOLDER_TYPE.PRIVATE);
  uiHolder.holder_id = user_id;
  ui_holder_map[user_id] = uiHolder;

  uiHolder.updateUI();

  return uiHolder;
};

const getUIHolder = (holder_id: string): any =>
{
  if(ui_holder_map.hasOwnProperty(holder_id) === false)
  {
    return undefined;
  }

  return ui_holder_map[holder_id];
};

const relayMultiplayerSignal = (multiplayer_signal: any): boolean => //관련 세션에 멀티플레이 신호 전달
{
  let handled = false; //한 곳이라도 handle 했으면 한거임

  const guild_ids = multiplayer_signal.guild_ids;
  for(const guild_id of guild_ids)
  {
    const ui_holder = ui_holder_map[guild_id];
    if(ui_holder !== undefined)
    {
      try
      {
        handled = ui_holder.on(CUSTOM_EVENT_TYPE.receivedMultiplayerSignal, multiplayer_signal);
      }
      catch(err: any)
      {
        logger.error(`Quiz ui Relaying multiplayer Signal error occurred! ${err.stack}`);
      }
    }
  }

  return handled;
};

//relayMultiplayerSignal과 동일 패턴(WEB_INTEGRATION_PLAN.md 2번) - 다만 web session signal은
//scope_id(길드 세션이면 guild_id, 퀴즈 만들기 owner 세션이면 owner_id) 하나만 대상으로 하므로 배열
//순회가 필요 없다. ui_holder_map은 guild_id/user_id 구분 없는 flat map이라 조회 자체는 그대로다.
const relayWebSessionSignal = (web_session_signal: any): boolean =>
{
  const scope_id = web_session_signal.scope_id;
  const ui_holder = ui_holder_map[scope_id];
  if(ui_holder === undefined)
  {
    return false;
  }

  try
  {
    return ui_holder.on(CUSTOM_EVENT_TYPE.receivedWebSessionSignal, web_session_signal);
  }
  catch(err: any)
  {
    logger.error(`Quiz ui Relaying web session Signal error occurred! ${err.stack}`);
    return false;
  }
};

const setGlobalLobbyCount = (lobby_count: number): void =>
{
  MainUI.MULTIPLAYER_LOBBY_COUNT = lobby_count;
};

const eraseUIHolder = (guild: any): void =>
{
  logger.info(`${guild.id} called erase ui holder`);

  const guild_id = guild.id;
  const ui_holder = ui_holder_map[guild_id];
  if(ui_holder !== undefined)
  {
    ui_holder.free();
    delete ui_holder_map[guild_id];
  }
};

const startUIHolderAgingManager = () =>
{
  return uiHolderAgingManager();
};

//#endregion

//#region UI 관리 함수들
/** UI 관련 함수들 **/
//UI holder Aging Manager
const uiHolderAgingManager = () =>
{
  const uiholder_aging_for_oldkey_value = SYSTEM_CONFIG.UI_HOLDER_AGING_MANAGER_CRITERIA * 1000; //last updated time이 일정 값 이전인 ui는 삭제할거임
  const uiholder_aging_manager = setInterval(()=>
  {
    const criteria_value = Date.now() - uiholder_aging_for_oldkey_value; //이거보다 이전에 update 된 것은 삭제

    let free_count = 0;
    const keys = Object.keys(ui_holder_map);

    logger.info(`Aginging UI Holder... targets: ${keys.length} ,criteria: ${criteria_value}`);

    keys.forEach((key) =>
    {
      const value = ui_holder_map[key];
      if(value.last_update_time < criteria_value)
      {
        const uiHolder = ui_holder_map[key];
        uiHolder.free();
        ++free_count;
        delete ui_holder_map[key]; //삭제~
      }
    });

    logger.info(`Done Aginging UI Holder... free count: ${free_count}`);
  }, SYSTEM_CONFIG.UI_HOLDER_AGING_MANAGER_INTERVAL * 1000); //체크 주기

  return uiholder_aging_manager;
};

//#endregion

/** UI 프레임 관련 **/

const UI_HOLDER_TYPE =
{
  PUBLIC : "public", //길드 메시지 UI, 길드용임
  PRIVATE : "private" //개인 메시지 UI, 개인용임
};

// UI들 표시해주는 홀더
class UIHolder
{
  //free()에서 base_interaction/guild/ui/prev_ui_stack을 undefined로 되돌리는 등
  //생성자에서 지정한 타입과 다른 값(undefined)으로 재대입되는 필드가 여럿이라
  //(예: holder_id도 최초엔 undefined였다가 나중에 외부에서 string으로 대입됨)
  //common-ui.ts의 QuizbotUI와 같은 이유로 인덱스 시그니처를 둔다.
  [key: string]: any;

  constructor(interaction: any, ui: any, ui_holder_type: string)
  {
    this.base_interaction = interaction; //Public 용 interaction, Public은 명령어에 의해 생성되기 때문에 있음
    this.base_message = undefined; //Private 용 Message, 얘는 개인 메시지로 보내야해서 interaction이 없다
    this.holder_id = undefined;
    this.guild = interaction.guild;
    this.guild_id = interaction.guild?.id;
    this.user = interaction.user;
    this.user_id = interaction.user.id;
    this.ui = ui ?? new MainUI();
    this.ui_holder_type = ui_holder_type;
    this.channel = interaction.channel;
    this.public_message_mode = false; //이게 true면 public ui 여도 interaction 이 아닌, message 기반으로 동작한다.

    this.initialized = false;
    this.prev_ui_stack = []; //뒤로가기용 UI스택

    this.message_created_time = Date.now();
    this.last_update_time = Date.now(); //uiholder aging manager에서 삭제 기준이될 값

    this.ui.holder = this;

    this.ui.onReady();
  }

  free() //자원 정리
  {
    const holder_id = this.guild_id ?? this.user_id;

    //퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - 이 홀더가 (이유 불문) 사라지는 시점에 이 길드의
    //웹 세션이 살아있다면 조용히 정리한다. 안 하면 확정 후에도 살아있는 웹 세션 토큰이 화면이 이미
    //다른 걸로 바뀐 뒤에도 guild_token_map을 계속 점유해서, 새로 /퀴즈 → 웹 세션을 열려는 시도가
    //already_locked로 막히는 고아 토큰 문제가 생김. fire-and-forget, 세션 없는 길드에도 안전한 no-op.
    //this.ui?.token(WebHandoffUI/DevQuizInfoUI 등이 들고 있는 토큰)을 같이 넘겨서, force_take로 이미
    //새 소유자에게 넘어간 뒤(guild_token_map이 새 토큰으로 교체된 뒤) 옛 홀더가 free()되는 경우 새
    //토큰을 잘못 지우지 않게 한다(2026-08-12 발견 - releaseSession의 expected_token 체크와 짝).
    if(this.guild_id !== undefined)
    {
      ipc_manager.sendWebSessionRequest({ action: 'release', guild_id: this.guild_id, token: this.ui?.token }).catch(() => {});
    }

    //퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1 - PRIVATE 홀더(퀴즈 만들기는 항상
    //PRIVATE, guild_id가 애초에 undefined라 위 분기와 겹치지 않음)가 사라지는 시점에 owner 세션도
    //동일한 이유로 조용히 정리한다. fire-and-forget, 세션 없는 유저에도 안전한 no-op.
    if(this.ui_holder_type === UI_HOLDER_TYPE.PRIVATE)
    {
      ipc_manager.sendWebSessionRequest({ action: 'release_owner_session', owner_id: this.user_id }).catch(() => {});
    }

    if(this.ui !== undefined)
    {
      if(this.ui.expired === false)
      {
        this.ui.onExpired();
      }
    }

    for(const stack_ui of this.prev_ui_stack)
    {
      if(stack_ui.expired === false)
      {
        stack_ui.onExpired();
      }
    }

    this.base_interaction = undefined;
    this.guild = undefined;
    this.ui = undefined;
    this.prev_ui_stack = undefined; //뒤로가기용 UI스택

    logger.info(`Free UI Holder holder_id:${this.holder_id}`);

    delete ui_holder_map[holder_id];
  }

  getUI()
  {
    return this.ui;
  }

  getUIEmbed()
  {
    return this.ui.embed;
  }

  getUIComponents()
  {
    return this.ui.components;
  }

  //이벤트 처리
  on(event_name: string, event_object: any)
  {
    if(this.ui === undefined)
    {
      return;
    }

    if(event_name === CUSTOM_EVENT_TYPE.interactionCreate)
    {
      const interaction = event_object;
      if(interaction.isButton() && interaction.customId === 'back')  //뒤로가기 버튼 처리
      {
        this.goToBack();
        return;
      }
    }

    const new_ui = this.ui.on(event_name, event_object); //UI가 새로 변경됐다면 업데이트 진행
    this.onUIReceived(new_ui);
  }

  goToBack() //뒤로가기
  {
    if(this.prev_ui_stack.length === 0)
    {
      return;
    }

    if(this.ui.expired === false)
    {
      this.ui.onExpired();
    }

    this.ui = this.prev_ui_stack.pop();
    this.ui.onAwaked(); //페이지 재활성화 됐을 때
    this.updateUI();
  }

  appendNewUI(new_ui: any)
  {
    this.prev_ui_stack.push(this.ui);
    this.ui = new_ui;
    this.ui.holder = this; //holder도 등록해준다. strong reference cycle 방지를 위해 weak타입으로...하려 했는데 weak이 설치가 안되네, free()를 믿자

    new_ui.onReady(); //ui 등록 완료됐을 때 이벤트
  }

  onUIReceived(new_ui: any)
  {
    if(new_ui === undefined)
    {
      return;
    }

    if(this.ui !== new_ui) //ui stack 에 쌓는 것은 새 UI 인스턴스가 생성됐을 때만
    {
      this.appendNewUI(new_ui);
    }
    this.updateUI();
  }

  //UI 재전송
  updateUI()
  {
    if(this.ui === undefined)
    {
      return;
    }

    this.last_update_time = Date.now();

    if(this.ui_holder_type === UI_HOLDER_TYPE.PUBLIC)
    {
      this.updatePublicUI();
    }
    else if(this.ui_holder_type === UI_HOLDER_TYPE.PRIVATE)
    {
      this.updatePrivateUI();
    }
  }

  handleUpdatePublicUIError(err: any, is_retry: boolean)
  {
    if(err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownInteraction) //삭제된 메시지에 update 시도한거라 별도로 핸들링 하지 않는다.
    {
      return;
    }

    if(err.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType) //embed에서 url들이 잘못됐다. 이 경우 그냥 url 다 지워
    {
      logger.warn(`Invalid Form Body from Public UI, Remove all url. guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}`);
      this.ui.resetEmbedURL();

      if(is_retry === false)
      {
        this.updatePublicUI(true); //재시도
      }
      else
      {
        logger.error(`Failed to Retry Public UI guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}, err: ${err.stack}`);
      }

      return;
    }

    logger.error(`Failed to Update Public UI guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}, err: ${err.stack}`);
  }

  updatePublicUI(is_retry = false) //Public 메시지용 update
  {
    if(this.initialized === false || this.base_message === undefined)
    {
      this.initialized = true;

      if(this.public_message_mode)
      {
        this.channel.send( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
          .then((message: any) =>
          {
            this.base_message = message;
          })
          .catch((err: any) =>
          {
            this.handleUpdatePublicUIError(err, is_retry);
          });
      }
      else
      {
        this.base_interaction.explicit_replied = true;
        this.base_interaction.reply( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
          .then(() => this.base_interaction.fetchReply())
          .then((message: any) =>
          {
            this.base_message = message;
          })
          .catch((err: any) =>
          {
            this.handleUpdatePublicUIError(err, is_retry);
          });
      }

      this.message_created_time = Date.now();

      return;
    }

    if(this.public_message_mode)
    {
      this.base_message.edit( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
        .catch((err: any) =>
        {
          this.handleUpdatePublicUIError(err, false);
        });
    }
    else
    {
      this.base_interaction.editReply( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
        .catch((err: any) =>
        {
          this.handleUpdatePublicUIError(err, false);
        });
    }
  }

  handleUpdatePrivateUIError(err: any, is_retry: boolean)
  {
    if(err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownInteraction) //삭제된 메시지에 update 시도한거라 별도로 핸들링 하지 않는다.
    {
      return;
    }

    if(err.code === RESTJSONErrorCodes.InvalidFormBodyOrContentType) //embed에서 url들이 잘못됐다. 이 경우 그냥 url 다 지워
    {
      logger.warn(`Invalid Form Body from Private UI, Remove all url. guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}`);
      this.ui.resetEmbedURL();

      if(is_retry === false)
      {
        this.updatePrivateUI(true); //재시도
      }
      else
      {
        logger.error(`Failed to Retry Private UI guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}, err: ${err.stack}`);
      }

      return;
    }

    logger.error(`Failed to Update Private UI guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(this.getUIEmbed())}, err: ${err.stack}`);
  }

  updatePrivateUI(is_retry = false) //Private 메시지용 update
  {
    if(this.initialized === false || this.base_message === undefined)
    {
      this.initialized = true;

      this.user.send( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
        .then((message: any) =>
        {
          this.base_message = message;
        })
        .catch((err: any) =>
        {
          this.handleUpdatePrivateUIError(err, is_retry);
        });

      this.message_created_time = Date.now();

      return;
    }

    this.base_message.edit( {embeds: [this.getUIEmbed()], components: this.getUIComponents()} )
      .catch((err: any) =>
      {
        this.handleUpdatePrivateUIError(err, is_retry);
      });
  }

  sendDelayedUI(ui: any, do_resend: boolean) //interaction 이벤트 떄만이 아니라 아무 때나 ui update
  {
    if(do_resend && ui !== undefined)
    {
      if(this.base_message !== undefined)
      {
        this.base_message.delete()
          .catch((err: any) =>
          {
            return;
          });
        this.base_message = undefined;
      }

      if(this.base_interaction !== undefined)
      {
        this.base_interaction.deleteReply()
          .catch((err: any) =>
          {
            return;
          });
        this.base_interaction = undefined;
        this.public_message_mode = true;
      }
    }

    this.onUIReceived(ui);
  }

  getMessageCreatedTime()
  {
    return this.message_created_time;
  }

  getOwnerName()
  {
    return this.user.displayName;
  }

  getOwnerId()
  {
    return this.user_id;
  }

  isPublicUI()
  {
    return this.ui_holder_type === UI_HOLDER_TYPE.PUBLIC;
  }

  isDisplayingMultiplayerLobby() //잉...멀티플레이 로비 띄워뒀으면 새로운 ui띄우는거 막으려구... 흑흑 좀 애매한데 걍 이렇게 ㄱㄱ
  {
    return this.ui instanceof MultiplayerQuizLobbyUI;
  }

  isDisplayingWebHandoff() //웹에서 세팅 중이면 새로운 ui 띄우는 대신 하이재킹 방어 안내(force_take)로 처리
  {
    return this.ui instanceof WebHandoffUI;
  }

  sendMessageReply(message: any) //사실 상 base message 강조를 목적으로 하는 답장 보내기
  {
    if(this.base_message === undefined)
    {
      logger.error(`Failed to Reply of base message guild_id:${this.guild_id}, user_id:${this.user_id}, embeds: ${JSON.stringify(message)}, err: base message is undefined!`);
      return;
    }

    return this.base_message.reply(message);
  }
}

//#endregion

module.exports = { initialize, createMainUIHolder, createQuizToolUIHolder, createAdminPanelUIHolder, createWebHandoffUIHolder, createQuizEditWebHandoffUIHolder, getUIHolder, relayMultiplayerSignal, relayWebSessionSignal, setGlobalLobbyCount, eraseUIHolder, startUIHolderAgingManager, uiHolderAgingManager, UIHolder };
