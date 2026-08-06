'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');

//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, QUIZ_MAKER_TYPE, QUIZ_TYPE, BGM_TYPE } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const quiz_system = require('../quiz_system/quiz_system.js'); //퀴즈봇 메인 시스템
const utility = require('../../utility/utility.js');
const ipc_manager = require('../managers/ipc_manager');
const { CLIENT_SIGNAL, SERVER_SIGNAL } = require('../managers/multiplayer_signal.js');
const logger = require('../../utility/logger.js')('MultiplayerLobbyUI');
const cloneDeep = require("lodash/cloneDeep.js");
const {
  multiplayer_lobby_host_tag_comp,
  multiplayer_lobby_host_basket_comp,
  multiplayer_lobby_kick_select_menu,
  multiplayer_participant_select_menu,
  multiplayer_participant_select_row,
  omakase_dev_quiz_tags_select_menu,
  omakase_custom_quiz_type_tags_select_menu,
  omakase_custom_quiz_tags_select_menu,
  multiplayer_lobby_participant_comp,
  modal_multiplayer_quiz_setting,
  request_basket_reopen_comp,
  multiplayer_leave_confirm_comp,
  multiplayer_kick_confirm_comp,
} = require("./components");

const { 
  QuizbotUI,
} = require("./common-ui.js");


const { AlertQuizStartUI } = require("./alert-quiz-start-ui.js");
const { QuizInfoUI } = require('./quiz-info-ui.js');
const { UserQuizSelectUI } = require("./user-quiz-select-ui.js");

//#endregion

/** OMAKASE QUIZ Room*/
/** 오마카세 퀴즈 설정 용. 로비 형식임 */
class MultiplayerQuizLobbyUI extends QuizInfoUI
{
  static createDefaultMultiplayerQuizInfo = (interaction) =>
  {
    const guild = interaction.guild;
    let multiplayer_quiz_info = {};

    multiplayer_quiz_info['title']  = "멀티플레이 퀴즈";
    multiplayer_quiz_info['icon'] = '🌐';

    multiplayer_quiz_info['type_name'] = "**멀티플레이 퀴즈**"; 
    multiplayer_quiz_info['description'] = `\`\`\`선택 메뉴에서 플레이하실 퀴즈 장르나 항목을 선택해주세요!\n선택하신 퀴즈에서 무작위로 문제를 제출합니다.\n\n'/챗' 명령어로 전체 대화가 가능합니다.\n\`\`\``; 

    multiplayer_quiz_info['author'] = guild.name ?? guild.id;
    multiplayer_quiz_info['author_icon'] = guild.iconURL() ?? '';
    multiplayer_quiz_info['thumbnail'] = ''; //썸네일은 고정 이미지가 있지롱 ㅎ

    multiplayer_quiz_info['quiz_size'] = 60; //default, 멀티플레이에서 100문제는 너무 많소
    multiplayer_quiz_info['min_quiz_size'] = 20; //최소 퀴즈 수, 멀티는 이게 필요
    multiplayer_quiz_info['selected_question_count'] = 30; //default
    multiplayer_quiz_info['repeat_count'] = 1; //실제로는 안쓰는 값
    multiplayer_quiz_info['winner_nickname'] = "플레이어";
    multiplayer_quiz_info['quiz_path'] = undefined;//oamakase quiz는 quiz_path 불필요
    multiplayer_quiz_info['quiz_type'] = QUIZ_TYPE.OMAKASE;
    multiplayer_quiz_info['quiz_maker_type'] = QUIZ_MAKER_TYPE.OMAKASE;

    multiplayer_quiz_info['quiz_id'] = undefined;  //omasakse quiz는 quiz_id 불필요

    //오마카세 퀴즈용 추가 설정 값
    multiplayer_quiz_info['basket_mode'] = true; //장바구니 모드
    multiplayer_quiz_info['basket_items'] = {}; //장바구니 모드

    multiplayer_quiz_info['dev_quiz_tags'] = 0;
    
    multiplayer_quiz_info['custom_quiz_type_tags'] = 0;
    multiplayer_quiz_info['custom_quiz_tags'] = 0;
    multiplayer_quiz_info['certified_filter'] = true;

    multiplayer_quiz_info['room_owner'] = interaction.member.id;

    multiplayer_quiz_info['multiplayer'] = true;
    multiplayer_quiz_info['multiplayer_host_guild_id'] = guild.id;

    return multiplayer_quiz_info;
  };

  constructor(quiz_info, interaction, is_readonly=true, session_id = undefined)
  {
    super(quiz_info);

    this.need_tags = true;

    this.guild = interaction.guild;
    this.guild_id = interaction.guild.id;
    this.guild_name = interaction.guild.name;
    this.owner = interaction.member;
    this.channel = interaction.channel;

    this.readonly = is_readonly;

    this.max_quiz_count = 60; //멀티플레이에서는 최대 60까지만

    this.session_id = session_id;
    this.participant_guilds_info = []; //guild_id, guild_name //참여 중인 길드 정보

    this.modal_quiz_setting = cloneDeep(modal_multiplayer_quiz_setting);

    this.initializeEmbed();
    this.initializeComponents();

    this.connectToMultiplayerSession(interaction);
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
    if(this.multiplayer_participant_select_component === undefined)
    {
      this.multiplayer_participant_select_component = cloneDeep(multiplayer_participant_select_row);
    }

    if(this.readonly)
    {
      this.components = [multiplayer_lobby_participant_comp, this.multiplayer_participant_select_component];
    }
    else
    {
      this.components = [];
    }
  }

  connectToMultiplayerSession(interaction)
  {
    if(this.readonly)
    {
      this.requestToJoinLobby(interaction);
    }
    else
    {
      this.applyQuizSettings(interaction);
      this.requestToCreateLobby(interaction);
    }
  }

  onAwaked() //멀티에서는 장바구니 담기 때문에 신호 보내야함
  {
    super.onAwaked();
    this.sendEditLobbySignal();
  }

  requestToJoinLobby(interaction)
  {
    //기존 로비 참가이니
    interaction.explicit_replied = true;
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.JOIN_LOBBY,
        guild_id: interaction.guild.id,
        guild_name: interaction.guild.name,
        session_id: this.session_id
      }
    ).then(result => 
    {
      if(result.state === true)
      {
        interaction.reply({ content: `\`\`\`🌐 로비에 참가하였습니다.\`\`\`` , flags: MessageFlags.Ephemeral});

        this.handleConnectSucceed(result);
      }
      else
      {
        interaction.reply({content: `\`\`\`🌐 참가에 실패했습니다.\n원인: ${result.reason}\`\`\``});

        this.goToBack();
      }
    }); //멀티플레이 lobby 목록 요청 조회
  }

  requestToCreateLobby(interaction)
  {
    //새로운 로비 생성이니
    interaction.explicit_replied = true;
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.CREATE_LOBBY,
        guild_id: this.guild_id,
        guild_name: this.guild_name,
        quiz_info: this.quiz_info,
      }
    )
      .then(result => 
      {
        if(result.state === true)
        {
          interaction.reply({ content: `\`\`\`🌐 새로운 로비를 생성하였습니다.\`\`\`` , flags: MessageFlags.Ephemeral});

          this.handleConnectSucceed(result);
        }
        else
        {
          interaction.reply({ content: `\`\`\`🌐 로비 생성에 실패하였습니다.\n원인: ${result.reason}\`\`\``, flags: MessageFlags.Ephemeral });

          this.goToBack();
        }
      });
  }

  handleConnectSucceed(result)
  {
    this.session_id = result.session_id; //불변
    this.applyMultiplayerLobbyInfo(result.lobby_info);      

    const multiplayer_lobby_session = quiz_system.startQuiz(this.guild, this.owner, this.channel, this.quiz_info, quiz_system.QUIZ_SESSION_TYPE.MULTIPLAYER_LOBBY); //Lobby용 퀴즈 세션 생성
    multiplayer_lobby_session.setSessionId(this.session_id);

    this.refreshTimer = setInterval(() => 
    {
      this.checkNeedToRefresh();
    }, 60000); //1분마다 UI 만료시간 체크

    this.initializeTagSelectedHandler();
    this.initializeMultiplayerQuizLobbyUIEventHandler();
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

    this.sendEditLobbySignal(interaction);

    return;
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

    this.sendEditLobbySignal(interaction);

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

    this.sendEditLobbySignal(interaction);
  }

  handleRequestUseTagMode(interaction)
  {
    this.quiz_info['basket_mode'] = false;

    this.sendEditLobbySignal(interaction);

    interaction.explicit_replied = true;
    interaction.reply({content: `\`\`\`🔸 장르 선택 모드를 사용합니다.\n선택하신 장르에 따라 퀴즈봇이 문제를 제출합니다.\`\`\``, flags: MessageFlags.Ephemeral});

    // this.refreshUI();
    // return this;
  }

  initializeMultiplayerQuizLobbyUIEventHandler()
  {
    this.multiplayer_quiz_lobby_ui_handler = 
    {
      'multiplayer_start': this.requestStartLobby.bind(this),
      'multiplayer_lobby_kick_select_menu': this.requestKick.bind(this),
      'multiplayer_kick_confirmed': this.confirmKick.bind(this),
      'multiplayer_kick_cancel': this.cancelKick.bind(this),
      'multiplayer_ready': this.requestReadyLobby.bind(this),
      'multiplayer_participant_select_menu': () => this, //비호스트용 열람 전용 메뉴, 선택해도 상태 변화 없음(의도된 동작)
      'multiplayer_leave_lobby': this.requestLeaveLobby.bind(this),
      'multiplayer_leave_confirmed': this.confirmLeaveLobby.bind(this),
      'multiplayer_leave_cancel': this.cancelLeaveLobby.bind(this),
    };
  }

  isMultiplayerQuizLobbyUIEvent(interaction)
  {
    return this.multiplayer_quiz_lobby_ui_handler[interaction.customId] !== undefined;
  }

  handleMultiplayerQuizLobbyUIEvent(interaction)
  {
    const handler = this.multiplayer_quiz_lobby_ui_handler[interaction.customId];
    return handler(interaction);
  }

  requestStartLobby(interaction)
  {
    if(this.checkTagSelected() === false)
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🌐 시작하시려면 퀴즈 유형 및 항목을 1개라도 선택해주세요!\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    if(this.quiz_info.selected_question_count === 0)
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🌐 이 퀴즈의 문제 수가 0개라 시작할 수 없습니다.\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    if(this.participant_guilds_info.length < 2)
    {
      interaction.explicit_replied = true;
      interaction.reply({content: `\`\`\`🌐 시작하시려면 적어도 참가 중인 서버가 2개 이상이어야 합니다.\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    interaction.explicit_replied = true;
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.START_LOBBY,
        guild_id: this.guild_id,
        session_id: this.session_id,
        // quiz_info: this.quiz_info //TODO 이거 다시 보낼 필요는 없긴 한데...
      }
    )
      .then(result => 
      {
        if(result.state === true)
        {
          interaction.deferUpdate();
          // interaction.reply({ content: `\`\`\`🌐 게임을 시작합니다.\`\`\`` , flags: MessageFlags.Ephemeral});
        }
        else
        { 
          interaction.reply({ content: `\`\`\`🌐 게임 시작에 실패했습니다.\n원인: ${result.reason}\`\`\``, flags: MessageFlags.Ephemeral });
        }
      });
  }

  requestReadyLobby(interaction)
  {
    interaction.explicit_replied = true;
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_READY,
        guild_id: this.guild_id,
        session_id: this.session_id,
      }
    )
      .then(result => 
      {
        if(result.state === true)
        {
          interaction.reply({ content: `\`\`\`🌐 준비 완료했습니다.\`\`\``, flags: MessageFlags.Ephemeral});
        }
        else
        { 
          interaction.reply({ content: `\`\`\`🌐 준비 요청에 실패했습니다.\n원인: ${result.reason}\`\`\``, flags: MessageFlags.Ephemeral });
        }
      });
  }

  requestKick(interaction) //서버 선택 시 즉시 추방하지 않고 확인 절차부터 거침(오클릭 방지)
  {
    const selected_value = interaction.values[0];

    if(isNaN(selected_value))
    {
      return;
    }

    if(selected_value > this.participant_guilds_info)
    {
      interaction.explicit_replied = true;
      interaction.reply({ content: `\`\`\`🌐 잘못된 선택값입니다...(어라... 이럴리가 없는뎅...)\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }

    const target_guild_info = this.participant_guilds_info[selected_value];
    this.pending_kick_target_guild_info = target_guild_info; //확인/취소 버튼 클릭 시 참조

    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🌐 정말 [ ${target_guild_info.guild_name} ] 서버를 추방하시겠습니까?\`\`\``,
      components: [multiplayer_kick_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmKick(interaction)
  {
    const target_guild_info = this.pending_kick_target_guild_info;
    if(target_guild_info === undefined)
    {
      interaction.explicit_replied = true;
      interaction.reply({ content: `\`\`\`🌐 이미 처리됐거나 만료된 요청입니다.\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }
    this.pending_kick_target_guild_info = undefined;

    const target_guild_name = target_guild_info.guild_name;
    const target_guild_id = target_guild_info.guild_id;

    interaction.explicit_replied = true;
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_KICK_PARTICIPANT,
        guild_id: this.guild_id,
        session_id: this.session_id,
        target_guild_id: target_guild_id,
      }
    )
      .then(result =>
      {
        if(result.state === true)
        {
          interaction.reply({ content: `\`\`\`🌐 ${target_guild_name} 서버를 추방하였습니다.\`\`\``, flags: MessageFlags.Ephemeral });
        }
        else
        {
          interaction.reply({ content: `\`\`\`🌐 ${target_guild_name} 서버 추방에 실패했습니다.\n원인: ${result.reason}\`\`\``, flags: MessageFlags.Ephemeral });
        }
      });
  }

  cancelKick(interaction)
  {
    this.pending_kick_target_guild_info = undefined;
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🌐 추방을 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  requestLeaveLobby(interaction) //"나가기" 버튼 - 다른 서버들도 같이 대기 중인 로비라 확인 절차를 거침
  {
    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🌐 정말 로비에서 나가시겠습니까?\n(다른 서버가 함께 대기 중이라면 그 서버들에게도 영향이 갑니다)\`\`\``,
      components: [multiplayer_leave_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmLeaveLobby(interaction)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🌐 로비에서 나갑니다.\`\`\``, flags: MessageFlags.Ephemeral });
    this.leaveLobby();
  }

  cancelLeaveLobby(interaction)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🌐 나가기를 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  handleSubmitModalQuizSetting(interaction)
  {
    const need_refresh = this.applyQuizSettings(interaction);

    if(need_refresh === false)
    {
      return;
    }

    this.sendEditLobbySignal(interaction);
  }

  onInteractionCreate(interaction) 
  {
    if(this.isTagSelectedEvent(interaction))
    {
      return this.handleTagSelectedEvent(interaction);
    }

    if(this.isMultiplayerQuizLobbyUIEvent(interaction))
    {
      return this.handleMultiplayerQuizLobbyUIEvent(interaction);
    }

    return super.onInteractionCreate(interaction);
  }


  refreshUI() 
  {
    const quiz_info = this.quiz_info;
  
    // Embed 설정
    this.updateLobbyEmbed(quiz_info);
  
    // Description 설정
    let description = this.getDescription();
  
    // Tag 정보 설정
    description += this.getTagInfoText();
  
    this.embed.description = description;

    // 참가자 목록 설정
    this.setupParticipantSelectMenu();

    //퀴즈 선택 모드에 따라(장바구니 모드 on/off) 다르게 처리
    this.setUpOmakaseQuizSelectComponent();
  }

  setUpOmakaseQuizSelectComponent()
  {
    this.initializeComponents(); //컴포넌트 초기화하고

    const use_basket_mode = this.quiz_info['basket_mode'] ?? true;

    if(this.readonly) //readonly면 불필요. 
    {
      if(use_basket_mode)
      {
        this.setupBasketSelectMenu(); //이거정도는 필요 ㅋ
        this.components.push(this.basket_select_component);
      }
      
      return;
    }

    if(use_basket_mode === false)
    {
      this.components.push(multiplayer_lobby_host_tag_comp);
    }
    else
    {
      this.components.push(multiplayer_lobby_host_basket_comp);
    }

    this.components.push(this.multiplayer_participant_select_component);
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
  
  updateLobbyEmbed(quiz_info) 
  {
    this.embed.title = `${quiz_info['icon']} ${quiz_info['title']}`;
    this.embed.thumbnail.url = quiz_info['thumbnail'] ?? '';
    this.embed.footer.text = ''; //footer는 쓰지말자 굳이 싶다.
    this.embed.footer.icon_url =  '';
  }
  
  setupParticipantSelectMenu() 
  {
    let participant_select_menu_for_current_lobby = this.readonly
      ? cloneDeep(multiplayer_participant_select_menu)
      : cloneDeep(multiplayer_lobby_kick_select_menu);
  
    for (let i = 0; i < this.participant_guilds_info.length; ++i) 
    {
      const guilds_info = this.participant_guilds_info[i];
      const stat = guilds_info.stat;
      const option = { label: `${guilds_info.guild_name}`, description: `전적: ${stat.win}승 ${stat.lose}패. MMR: ${stat.mmr}`, value: `${i}` };
      
      // if (this.session_id === guilds_info.guild_id) 
      // {
      //   option['description'] = `호스트 서버`;
      // }
      
      participant_select_menu_for_current_lobby.addOptions(option);
    }
  
    if (this.participant_guilds_info.length !== 0) 
    {
      this.multiplayer_participant_select_component.components[0] = participant_select_menu_for_current_lobby;
    }
  }
  
  applyMultiplayerLobbyInfo(lobby_info, do_send=true)
  {
    this.quiz_info = lobby_info.quiz_info;
    this.participant_guilds_info = lobby_info.participant_guilds_info;

    this.refreshUI();

    if(do_send)
    {
      this.sendDelayedUI(this, false);
    }

    logger.debug(`Applying lobby info to ${this.guild_id}`);
  }

  // applyMultiplayerLobbySettings(interaction)
  // {
  //   let need_refresh = false;
  //   const lobby_name = interaction.fields.getTextInputValue('txt_input_lobby_name');

  //   if(this.quiz_info['title'] !== lobby_name)
  //   {
  //     this.quiz_info['title'] = lobby_name;
  //     need_refresh = true;
  //   }

  //   return need_refresh;
  // }

  checkNeedToRefresh()
  {
    const criteria = Date.now() - 600000; //넉넉잡아 10분
    if(this.getMessageCreatedTime() < criteria) //생성된지 15분 이상된 Message의 Interaction들은 더 이상 동작하지 않는다. 다시 보내줘야함
    {
      logger.debug(`Resending lobby ui to ${this.guild_id}`);
      this.channel.send( { content: `\`\`\`🌐 UI가 만료되어 재생성하였습니다.\`\`\`` } );
      this.sendDelayedUI(this, true); //만료된거면 무조건 재생성
    }
  }
  
  // 멀티플레이 신호 handling 관련
  onReceivedMultiplayerSignal(signal)
  {
    const signal_type = signal.signal_type;

    switch (signal_type) 
    {
    case SERVER_SIGNAL.JOINED_LOBBY:
      this.onReceivedJoinedLobby(signal);
      break;

    case SERVER_SIGNAL.LEAVED_LOBBY:
      this.onReceivedLeavedLobby(signal);
      break;

    case SERVER_SIGNAL.EXPIRED_SESSION:
      this.onReceivedExpiredLobby(signal);
      break;

    case SERVER_SIGNAL.EDITED_LOBBY:
      this.onReceivedEditedLobby(signal);
      break;

    case SERVER_SIGNAL.PARTICIPANT_INFO_UPDATE:
      this.onReceivedUpdatedStat(signal);
      break;

    case SERVER_SIGNAL.KICKED_PARTICIPANT:
      this.onReceivedKickedParticipant(signal);
      break;

    case SERVER_SIGNAL.STARTED_LOBBY:
      this.onReceivedStartedLobby(signal);
      break;
    
    case SERVER_SIGNAL.CONFIRM_READY:
      this.onReceivedConfirmReady(signal);
      break;

    default:
      // 다른 신호 처리
      break;
    }
  }

  // JOINED_LOBBY 처리
  onReceivedJoinedLobby(signal)
  {
    const joined_guild_info = signal.joined_guild_info;
    if (joined_guild_info?.guild_id === this.guild_id) 
    {
      return; // 참가자가 자신일 경우 무시
    }

    this.applyMultiplayerLobbyInfo(signal.lobby_info); 
    this.sendMessageReply({content: `\`\`\`🌐 ${signal.joined_guild_info?.guild_name} 서버가 참가하였습니다.\`\`\``});

  }

  // LEAVED_LOBBY 처리
  onReceivedLeavedLobby(signal)
  {
    this.applyMultiplayerLobbyInfo(signal.lobby_info);
    
    this.sendMessageReply({content: `\`\`\`🌐 ${signal.leaved_guild_info?.guild_name} 서버가 퇴장하였습니다.\`\`\``});
  }

  // EXPIRED_SESSION 처리
  onReceivedExpiredLobby(signal)
  {
    this.sendMessageReply({ content: `\`\`\`🌐 로비의 호스트가 떠났습니다. 해당 세션은 더 이상 유효하지 않습니다.\`\`\`` });
    this.leaveLobby();
  }

  // EDITED_LOBBY 처리
  onReceivedEditedLobby(signal)
  {
    this.applyMultiplayerLobbyInfo(signal.lobby_info);

    if(this.guild_id === signal.session_id) //호스트면
    {
      this.sendMessageReply({ content: `\`\`\`🌐 로비 정보가 변경되었습니다.\`\`\`` });
    }
    else
    {
      this.sendMessageReply({ content: `\`\`\`🌐 로비 정보가 변경되었습니다. 준비 완료 상태가 해제됩니다.\`\`\`` });
    }
  }

  // STAT 로드됨 처리
  onReceivedUpdatedStat(signal)
  {
    this.applyMultiplayerLobbyInfo(signal.lobby_info);

    const updated_guild_info = signal.updated_guild_info;
    if(updated_guild_info !== undefined)
    {
      this.channel.send({ content: `\`\`\`🌐 [${updated_guild_info.guild_name}] 서버의 현 시즌 전적: ${updated_guild_info.stat.win}승 ${updated_guild_info.stat.lose}패. MMR: ${updated_guild_info.stat.mmr}\`\`\``});
    }
  }

  // KICKED_PARTICIPANT 처리
  onReceivedKickedParticipant(signal)
  {
    const kicked_guild_info = signal.kicked_guild_info;
    if (this.guild_id === kicked_guild_info.guild_id) 
    {
      this.sendMessageReply({ content: `\`\`\`🌐 호스트에 의해 ${this.quiz_info.title} 로비에서 추방됐습니다.\`\`\`` });
      this.leaveLobby();
    } 
    else 
    {
      this.sendMessageReply({ content: `\`\`\`🌐 ${kicked_guild_info.guild_name} 서버가 로비에서 추방됐습니다.\`\`\`` });
    }
  }

  // STARTED_LOBBY 처리
  onReceivedStartedLobby(signal)
  {
    this.startLobby(signal.lobby_info, signal.owner_name);
    this.channel.send({content: `\`\`\`🌐 호스트가 게임을 시작하였습니다.\`\`\``});
  }

  // CONFIRM_READY 처리
  onReceivedConfirmReady(signal)
  {
    this.sendMessageReply({ content: `\`\`\`🌐 ${signal.ready_guild_info.guild_name} 서버 준비 완료.\`\`\`` });
  }

  sendEditLobbySignal(interaction=undefined)
  {
    ipc_manager.sendMultiplayerSignal(
      {
        signal_type: CLIENT_SIGNAL.EDIT_LOBBY,
        guild_id: this.guild_id,
        session_id: this.session_id,
        quiz_info: this.quiz_info,
      }
    )
      .then(result => 
      {
        if(interaction === undefined)
        {
          return;
        }

        if(result.state === true)
        {
          if(!interaction.explicit_replied)
          {
            interaction.explicit_replied = true;
            interaction.deferUpdate();
          }
        // interaction.reply({ content: `\`\`\`🌐 설정이 반영되었습니다.\`\`\`` , flags: MessageFlags.Ephemeral});
        }
        else
        {
          interaction.explicit_replied = true;
          interaction.reply({ content: `\`\`\`🌐 설정을 반영하지 못했습니다.\n원인: ${result.reason}\`\`\``, flags: MessageFlags.Ephemeral });
        }
      });
  }

  startLobby(finalized_lobby_info, owner_name='')
  {
    logger.debug(`Expire multiplayer lobby ui refresh timer(${this.refreshTimer}) by start lobby`);
    clearInterval(this.refreshTimer);

    this.expired = true; //다시 onExpired 호출 안하게

    const alert_ui = new AlertQuizStartUI(finalized_lobby_info.quiz_info, owner_name); 
    this.sendDelayedUI(alert_ui, true);
  }

  leaveLobby()
  {
    this.goToBack();

    if(this.expired === false) //뭔가의 이유로 goToBack 실패 시, 수동으로 expire 호출
    {
      this.onExpired();
    }
  }

  //해당 UI가 날라갈때
  onExpired()
  {
    logger.debug(`Disconnecting voice state by leaving lobby guild_id: ${this.guild.id}`);
    quiz_system.forceStopSession(this.guild);

    logger.debug(`Expire multiplayer lobby ui refresh timer(${this.refreshTimer}) by expire ui. guild_id: ${this.guild.id}`);
    clearInterval(this.refreshTimer);
    
    super.onExpired();

    this.channel.send({ content: `\`\`\`🌐 로비에서 퇴장하셨습니다.\`\`\`` });
  }
  

}

module.exports = { MultiplayerQuizLobbyUI };