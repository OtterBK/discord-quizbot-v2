'use strict';

//외부 modules
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  MessageFlags,
} = require('discord.js');
const { ClusterClient, getInfo } = require('discord-hybrid-sharding');
const fs = require('fs');
const ytdl = require('discord-ytdl-core');
const { Koreanbots } = require('koreanbots');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const youtubedl = require('youtube-dl-exec');
const { spawn } = require('child_process');

//로컬 modules
const PRIVATE_CONFIG = require('../config/private_config.json');
const {
  SYSTEM_CONFIG,
  CUSTOM_EVENT_TYPE,
  QUIZ_TYPE,
  QUIZ_MAKER_TYPE,
} = require('../config/system_setting.js');

const command_manager = require('./managers/command_manager');
const quizbot_ui = require('./quiz_ui/ui-system-core');
const quiz_system = require('./quiz_system/quiz_system');
const option_system = require('./quiz_option/quiz_option.js');
const utility = require('../utility/utility.js');
const logger = require('../utility/logger.js')('Main');
const db_manager = require('./managers/db_manager.js');
const ipc_manager = require('./managers/ipc_manager');
const tagged_dev_quiz_manager = require('./managers/tagged_dev_quiz_manager');
const audio_cache_manager = require('./managers/audio_cache_manager');
const multiplayer_chat_manager = require('./managers/multiplayer_chat_manager.js');
const report_manager = require('./managers/report_manager');
const ban_manager = require('./managers/ban_manager');
const { SERVER_SIGNAL } = require('./managers/multiplayer_signal.js');
const { startMonitoring } = require('./managers/monitoring_manager');

//2026-08-12(UI 개선 2라운드 B-1 [P3]) - 모든 봇 메시지가 🔸 하나로 정보/에러/성공을 뭉뚱그려
//표현하던 것을 이 파일 안에서는 심각도별로 구분: 🔸 안내/일반 정보, ⚠️ 실패/권한없음/제한된 동작,
//✅ 성공/완료. 이번엔 bot.js 범위만 정리했고, quiz_ui/* 등 나머지 파일들의 메시지는 아직 전부
//🔸(또는 파일마다 제각각)라서 별도 후속 작업 필요 - 전체 스윕은 범위가 커서 이번엔 안 함
//(docs/UI_IMPROVEMENT_PLAN_ROUND2.md B-1 참고).

/** global 변수 **/

const client = new Client({
  shards: getInfo().SHARD_LIST, // An array of shards that will get spawned
  shardCount: getInfo().TOTAL_SHARDS, // Total number of shards,
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: [], repliedUser: true }, // 모든 멘션 완전 차단 (빈 배열)
});
client.cluster = new ClusterClient(client); // initialize the Client, so we access the .broadcastEval()

let koreanbots = undefined;
if (
  PRIVATE_CONFIG.BOT.KOREANBOT_TOKEN != undefined &&
  PRIVATE_CONFIG.BOT.KOREANBOT_TOKEN != ''
) 
{
  try 
  {
    koreanbots = new Koreanbots({
      api: {
        token: PRIVATE_CONFIG.BOT.KOREANBOT_TOKEN,
      },
      clientID: PRIVATE_CONFIG.BOT.CLIENT_ID,
    });
  }
  catch (err) 
  {
    logger.error(err.stack);
    koreanbots = undefined;
  }
}

let admin_instance = undefined;

/**  이벤트 등록  **/
//봇 최초 실행 이벤트
client.on('ready', () => 
{
  logger.info(`Initializing Quizbot...`);

  ///////////
  logger.info(`Initializing BGM Resources`);
  utility.initializeBGM();

  logger.info(`Initializing Quiz System`);
  quiz_system.initialize(client);

  logger.info(`Initializing Quiz UI`);
  quizbot_ui.initialize(client);

  logger.info(`Starting Database Manager`);
  db_manager.initialize(client).then((result) => 
  {
    if (result == false) return;

    logger.info(`Loading Option Data from Database...`);
    client.guilds.cache.forEach((guild) => 
    {
      if (guild != undefined) option_system.loadOptionData(guild.id);
    });
  });

  logger.info(`Starting IPC Manager`);
  ipc_manager.initialize(client);
  ipc_manager.adaptRelayHandler(relayMultiplayerSignal);
  ipc_manager.adaptWebSessionRelayHandler(relayWebSessionSignal);

  logger.info(`Starting UI Holder Aging Manager`);
  quizbot_ui.startUIHolderAgingManager();

  logger.info(`Initializing Tagged Dev Quiz Manager`);
  tagged_dev_quiz_manager.initialize(SYSTEM_CONFIG.TAGGED_DEV_QUIZ_INFO);

  // logger.info(`Starting FFMPEG Aging Manager`);
  // quiz_system.startFFmpegAgingManager();

  logger.info(`Initializing Multiplayer Chat Manager`);
  multiplayer_chat_manager.initialize(koreanbots);

  logger.info(`Initializing Report Manager`);
  report_manager.initialize(client);

  logger.info(`Initializing Ban Manager`);
  ban_manager.initialize();

  ///////////
  logger.info(`Register commands...`);

  command_manager.registerGlobalCommands(
    PRIVATE_CONFIG.BOT.TOKEN,
    PRIVATE_CONFIG.BOT.CLIENT_ID
  );

  ///////////
  logger.info(`Setting bot Status...`);
  client.user.setActivity(`/퀴즈 | /퀴즈만들기`);

  ///////////
  logger.info(`Started Quizbot! tag name: ${client.user.tag}!`);

  registerMainClusterService();

  syncAdmin();

  ///////////
  createCleanUp();
});

//2026-08-12(UI 개선 2라운드 B-1 [P2]) - 봇이 새 서버에 들어갔을 때 안내 메시지가 전혀 없어서,
//새 유저는 디스코드가 보여주는 슬래시커맨드 한 줄 설명이 안내의 전부였음. 시스템 채널을 우선
//시도하고, 없거나 권한이 없으면 메시지를 보낼 수 있는 첫 텍스트 채널로 폴백 - 보낼 수 있는 채널이
//아예 없으면 조용히 넘어감(checkPermission과 동일하게 SendMessages 권한 확인).
client.on('guildCreate', (guild) =>
{
  logger.info(`Joined new guild: ${guild.name} (${guild.id})`);

  const canSendMessages = (channel) => channel.permissionsFor(guild.members.me)?.has(PermissionsBitField.Flags.SendMessages) === true;

  const target_channel =
    (guild.systemChannel != undefined && canSendMessages(guild.systemChannel) ? guild.systemChannel : undefined)
    ?? guild.channels.cache
      .filter((channel) => channel.isTextBased() && canSendMessages(channel))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .first();

  if(target_channel == undefined)
  {
    return; //메시지를 보낼 수 있는 채널이 없음
  }

  target_channel.send({
    content:
      `\`\`\`🔸 안녕하세요! 퀴즈봇을 초대해주셔서 감사합니다.\n\n`
      + `/퀴즈 명령어로 바로 시작할 수 있어요. 사용법이 궁금하면 /도움말을 입력해보세요!\`\`\``,
  }).catch((err) => logger.error(`Failed to send welcome message to guild ${guild.id}, err: ${err.stack}`));
});

const registerMainClusterService = () =>
{
  if(client.cluster.id != 0) //0번 클러스터에서만 수행되는 서비스
  {
    return;
  }

  registerUpdateServerCountScheduler();
  registerMonitoringService();
};

const registerUpdateServerCountScheduler = () =>
{
  if(!koreanbots) 
  {
    return;
  }

  const update = () => 
  {
    let servers_count = ipc_manager.sync_objects.get('guild_count');
    if (servers_count == undefined || servers_count == 0) 
    {
      servers_count = client.guilds.cache.size;
    }

    logger.info(`Updating Korean bot server count: ${servers_count}`);
    koreanbots.mybot
      .update({ servers: servers_count, shards: getInfo().TOTAL_SHARDS })
      .then((res) =>
        logger.info(
          '서버 수를 정상적으로 업데이트하였습니다!\n반환된 정보:' +
            JSON.stringify(res)
        )
      )
      .catch((err) => logger.error(`${err.stack ?? err.message}`));
  };

  setInterval(() => update(), 3600000); // 60분마다 서버 수를 업데이트합니다.
};

const registerMonitoringService = () =>
{
  startMonitoring();
};

const syncAdmin = () =>
{
  if (!PRIVATE_CONFIG.ADMIN_ID) 
  {
    return;
  }
  
  //해당 cluster에서 admin instance 찾아본다
  const admin_id = PRIVATE_CONFIG.ADMIN_ID;

  logger.info(`Finding Admin instance for ${admin_id}`);

  client.users
    .fetch(admin_id)
    .then((instance) => 
    {
      if (instance == undefined) 
      {
        return;
      }

      admin_instance = instance;
      admin_instance.send(
        `Hello Quizbot Admin! Quizbot has been started! this is ${client.cluster.id} cluster`
      ); //찾았으면 인사해주자

      logger.info(
        `Found admin instance in cluster ${client.cluster.id}! syncing this admin instance`
      );
      client.cluster.send(
      //cluster manager 한테 알림
        {
          ipc_message_type: ipc_manager.IPC_MESSAGE_TYPE.SYNC_ADMIN,
          admin_instance: admin_instance,
        }
      );
    })
    .catch((err) => 
    {
      logger.error(
        `Cannot find admin instance in cluster ${client.cluster.id} err: ${err.message}`
      );
    });
};

const checkPermission = (interaction) =>
{
  if (
    interaction.guild.members.me
      .permissionsIn(interaction.channel.id)
      .has(PermissionsBitField.Flags.SendMessages) == false
  ) 
  {
    interaction.explicit_replied = true; 
    interaction.reply({
      content:
        `\`\`\`⚠️ 이 채널에 메시지를 보낼 권한이 없습니다.😥\n봇에게 필요한 권한을 부여하거나 서버 관리자에게 봇을 추방하고 다시 초대하도록 요청해보세요.\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  if (
    interaction.guild.members.me
      .permissionsIn(interaction.channel.id)
      .has(PermissionsBitField.Flags.ViewChannel) == false
  ) 
  {
    interaction.explicit_replied = true; 
    interaction.reply({
      content:
        `\`\`\`⚠️ 이 채널의 속성을 확인할 수 있는 권한이 없습니다.😥\n봇에게 필요한 권한을 부여하거나 서버 관리자에게 봇을 추방하고 다시 초대하도록 요청해보세요.\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
};

//명령어별 처리
const start_quiz_handler = async (interaction) => 
{
  if (interaction.guild == undefined) 
  {
    interaction.reply({
      content: `\`\`\`⚠️ 개인 메시지 채널에서는 퀴즈 플레이가 불가능합니다.\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if(checkPermission(interaction) === false)
  {
    return;
  }

  //실시간 공지(resources/current_notice.txt)는 예전엔 여기서 별도 메시지로 보냈으나(2026-08-13
  //변경) - SelectUIModeUI(select-ui-mode-ui.ts)의 embed 필드로 옮김. 상세는 그 파일 상단 주석 참고.
  quizbot_ui.createMainUIHolder(interaction); //메인 메뉴 전송
};

const create_quiz_tool_btn_component = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('btn_create_quiz_tool')
    .setLabel('퀴즈만들기')
    .setStyle(ButtonStyle.Success)
);
const create_quiz_handler = async (interaction) =>
{
  //퀴즈만들기 ban 시스템
  if (ban_manager.isBanned([interaction.user.id]))
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`⚠️ 퀴즈 생성 권한이 영구적으로 제한되었습니다.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  if(interaction.guild)
  {
    //샤딩돼 있어서 길드에서 요청할경우 ui_holder_map 주소가 달라 못찾음
    interaction.explicit_replied = true; 
    interaction.reply({
      content:
        `\`\`\`🔸 퀴즈 제작에 참여해주셔서 감사합니다!\n퀴즈봇이 메시지를 보낼거에요. 확인해보세요!\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    interaction.member.send({
      content:
        `\`\`\`🔸 퀴즈만들기는 개인채널(DM)으로만 요청 가능해요!\n여기서 다시 한번 '/퀴즈만들기' 를 입력하시거나 버튼을 클릭하세요!\`\`\``,
      components: [create_quiz_tool_btn_component],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const uiHolder = quizbot_ui.createQuizToolUIHolder(interaction);
  interaction.explicit_replied = true;
  interaction.reply({
    content:
      `\`\`\`✅ 개인 메시지로 퀴즈 제작 화면을 보내드렸어요!\n퀴즈봇과의 개인 메시지를 확인해주세요 🛠\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
};

//2026-08-12(UI 개선 2라운드 B-1 [P2]) - 도움말/온보딩이 전혀 없던 문제 신설. 관리자 전용 명령어
//(quizmgr, 2026-08-14부터 유일한 관리자 진입점 - /신고처리는 삭제됨)는 의도적으로 여기서 언급 안 함
//(루트 CLAUDE.md "관리자 전용 기능" - 호기심 유발 방지 관례).
const help_handler = (interaction) =>
{
  interaction.explicit_replied = true;
  interaction.reply({
    content:
      `\`\`\`🔸 퀴즈봇 사용법\n\n`
      + `/퀴즈 - 퀴즈 메뉴를 열어요. 공식/유저 제작/랜덤 퀴즈를 고르고 시작할 수 있어요.\n`
      + `/퀴즈만들기 - 나만의 퀴즈를 직접 만들 수 있어요. (개인 메시지로 진행돼요)\n`
      + `/답 [답안] - 진행 중인 문제의 정답을 제출해요. (서버 설정에 따라 채팅으로 바로 입력해도 인식될 수 있어요)\n`
      + `/챗 [메시지] - 멀티플레이 대결 중 상대 서버에 메시지를 보내요.\n`
      + `/채팅전환 - 멀티플레이 전체 채팅 기능을 켜고 꺼요.\n`
      + `/퀴즈정리 - 문제가 생겼을 때 진행 중인 세션을 강제로 정리해요. (일반적인 상황에서는 사용하지 마세요)\n\n`
      + `각 화면의 버튼/메뉴를 눌러보면 더 많은 기능을 찾을 수 있어요!\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
};

const quizmgr_btn_component = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('btn_quizmgr')
    .setLabel('내부 도구 열기')
    .setStyle(ButtonStyle.Success)
);
//관리자 전용 패널 진입점. 어드민이 아니면 아무 응답도 하지 않고 그대로 return한다
//(reply/deferReply 등 일체 호출 안 함 -> 3초 후 자연스럽게 인터랙션 타임아웃) -
//명령어가 존재한다는 것, 권한이 없다는 것조차 티내지 않기 위함(의도된 동작).
const quiz_manager_panel_handler = async (interaction) =>
{
  if (interaction.user.id !== PRIVATE_CONFIG.ADMIN_ID)
  {
    return;
  }

  if(interaction.guild)
  {
    //샤딩돼 있어서 길드에서 요청할경우 ui_holder_map 주소가 달라 못찾음
    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🔸 개인 메시지를 확인해주세요.\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    interaction.member.send({
      content: `\`\`\`🔸 여기서 다시 한번 '/quizmgr' 를 입력하시거나 버튼을 클릭하세요!\`\`\``,
      components: [quizmgr_btn_component],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  quizbot_ui.createAdminPanelUIHolder(interaction);
  interaction.explicit_replied = true;
  interaction.reply({
    content: `\`\`\`🔸 개인 메시지를 확인해주세요.\`\`\``,
    flags: MessageFlags.Ephemeral,
  });
};

//길드 화면 하이재킹 방어 - 다른 유저가 ephemeral "권한 가져오기" 버튼을 눌렀을 때. uiHolder 소유자가
//아니므로 정상적인 uiHolder.on() 라우팅을 거치지 않고 여기서 바로 처리한다.
//2026-08-13 - 예전엔 웹 UI(WebHandoffUI) 세팅 중일 때만 이 버튼이 뜰 수 있었고, 대상 웹 세션 토큰을
//IPC로 미리 새로 발급받은(`force_take` 액션) 뒤 곧장 WebHandoffUI로 진입시켰음. 지금은 디스코드
//UI(MainUI 등) 사용 중에도 같은 버튼이 뜨므로 "웹 세션"이라는 특정 개념에 묶이지 않게 단순화 —
//그냥 이전 홀더를 free()하면(웹 세션이 있었다면 free()가 알아서 release IPC까지 보냄, UIHolder.free()
//참고) `createMainUIHolder`가 일반 `/퀴즈` 진입과 완전히 동일하게 새 SelectUIModeUI를 이 버튼
//인터랙션으로 띄워준다(디스코드 UI/웹 UI 투트랙 선택 — 새 소유자가 원치 않는 트랙으로 강제되지 않음).
const handle_ui_force_take = (interaction) =>
{
  const guild_id = interaction.guild?.id;
  const prev_holder = guild_id === undefined ? undefined : quizbot_ui.getUIHolder(guild_id);

  if(prev_holder === undefined)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`⚠️ 이미 상황이 바뀌었어요. [/퀴즈]를 다시 입력해주세요.\`\`\``, flags: MessageFlags.Ephemeral });
    return;
  }

  prev_holder.free();

  quizbot_ui.createMainUIHolder(interaction); //이 버튼 인터랙션 자체로 새 공개 메시지를 띄움(interaction.reply)
};

//2026-08-12(UI 개선 2라운드 B-1 [P3]) - 확인 절차 없이 즉시 서버 전체 세션을 지우던 것을 확인/취소
//2버튼 프롬프트로 변경(다른 화면의 파괴적 동작 확인 패턴과 동일, quiz_ui/CLAUDE.md B-5/B-6 참고).
//진행 중인 사람이 있을 수 있는데 실수로 누르면 되돌릴 방법이 없었음.
const clear_quiz_confirm_component = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('confirm_clear_quiz')
    .setLabel('정리하기')
    .setStyle(ButtonStyle.Danger),
  new ButtonBuilder()
    .setCustomId('cancel_clear_quiz')
    .setLabel('취소')
    .setStyle(ButtonStyle.Secondary)
);

const clear_quiz_handler = (interaction) =>
{
  interaction.explicit_replied = true;
  interaction.reply({
    content: `\`\`\`⚠️ 서버에서 진행 중인 모든 세션을 정리할까요?\n이 명령어는 봇 이용에 문제가 발생했을 때만 사용하세요.\`\`\``,
    components: [clear_quiz_confirm_component],
    flags: MessageFlags.Ephemeral,
  });
};

const handle_confirm_clear_quiz = (interaction) =>
{
  const guild = interaction.guild;

  quizbot_ui.eraseUIHolder(guild);
  quiz_system.forceStopSession(guild);

  logger.info(`Cleared quiz session of ${guild.id} by ${interaction.user.id}`);

  interaction.explicit_replied = true;
  interaction.update({ content: `\`\`\`✅ 정리했어요.\`\`\``, components: [] }); //확인 프롬프트(본인에게만 보임) 정리
  interaction.channel.send({ content: `\`\`\`✅ 서버에서 진행 중인 모든 세션을 정리했습니다.\n이 명령어는 봇 이용에 문제가 발생했을 때만 사용하세요.\`\`\`` }); //진행 중이던 다른 참가자들도 알 수 있도록 채널에 공개 안내(기존 동작 유지)
};

const handle_cancel_clear_quiz = (interaction) =>
{
  interaction.explicit_replied = true;
  interaction.update({ content: `\`\`\`🔸 취소했어요.\`\`\``, components: [] });
};

// 상호작용 이벤트
client.on(CUSTOM_EVENT_TYPE.interactionCreate, async (interaction) => 
{
  //임시로 잠시 해둠 -> 점검모드
  if (fs.existsSync(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH)) 
  {
    const maintenance_notice = fs.readFileSync(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH, {
      encoding: 'utf8',
      flag: 'r',
    });

    if(PRIVATE_CONFIG.ADMIN_ID !== interaction.user.id) //점검 모드에서는 어드민만 가능 
    {
      interaction.reply({content: `\`\`\`⚠ ${maintenance_notice}\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }
  }

  const main_command = interaction.commandName;
  if (main_command === '퀴즈' || main_command === 'quiz')
  {
    await start_quiz_handler(interaction);
    return;
  }

  if (main_command === '도움말')
  {
    help_handler(interaction);
    return;
  }

  if (
    main_command === '퀴즈만들기' ||
    interaction.customId == 'btn_create_quiz_tool'
  )
  {
    await create_quiz_handler(interaction);
    return;
  }

  if (
    main_command === 'quizmgr' ||
    interaction.customId == 'btn_quizmgr'
  )
  {
    await quiz_manager_panel_handler(interaction);
    return;
  }

  if (main_command === '퀴즈정리')
  {
    clear_quiz_handler(interaction);
    return;
  }

  if (interaction.customId === 'confirm_clear_quiz')
  {
    handle_confirm_clear_quiz(interaction);
    return;
  }

  if (interaction.customId === 'cancel_clear_quiz')
  {
    handle_cancel_clear_quiz(interaction);
    return;
  }

  if (main_command === '챗') 
  {
    multiplayer_chat_manager.sendMultiplayerChat(interaction);
    return;
  }

  if (main_command === '채팅전환') 
  {
    multiplayer_chat_manager.toggleMultiplayerChat(interaction);
    return;
  }

  if(report_manager.checkReportEvent(interaction)) ////신고 관련 체크
  {
    return;
  }

  if(interaction.isButton() && interaction.customId === 'ui_force_take') //길드 화면 하이재킹 방어 - 소유자가 아닌 유저의 요청이라 uiHolder 소유자 체크(아래)를 거치기 전에 별도 처리
  {
    handle_ui_force_take(interaction);
    return;
  }

  const quiz_session =
    interaction.guild == undefined
      ? undefined
      : quiz_system.getQuizSession(interaction.guild.id);
  if (quiz_session != undefined) 
  {
    quiz_session.on(CUSTOM_EVENT_TYPE.interactionCreate, interaction);
  }

  //ui button, select menu, modal 이벤트
  const holder_id =
    interaction.guild == undefined ? interaction.user.id : interaction.guild.id;
  const uiHolder = quizbot_ui.getUIHolder(holder_id);
  if (uiHolder != undefined) 
  {
    if (interaction.user.id != uiHolder.getOwnerId() && uiHolder.isPublicUI() && (quiz_session === undefined || (quiz_session.isMultiplayerSession() && !quiz_session.isIngame())))
    {
      //이제 Public UI 조작은 주인만 가능~
      interaction.reply({
        content: `\`\`\`⚠️ 해당 UI를 생성한 ${uiHolder.getOwnerName()}님만이 조작할 수 있어요.\nUI를 새로 만들려면 [/퀴즈] 명령어를 다시 입력해주세요!\`\`\``,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    uiHolder.on(CUSTOM_EVENT_TYPE.interactionCreate, interaction);
  }

  //그 외의 명령어
  //문제가 있다! reply나, showModal 함수가 async 라서 replied 멤버 변수가 즉각즉각 true가 되질 않는다... 흑흑
  //위쪽에 이에 대한 꼼수를 하나 해뒀다...-> 그냥 노가다해서 reply, defferUpdate, showModal 하는 곳에 explicit_replied 라는 임의 값을 true로 설정했다.
  if (
    (interaction.isButton() || interaction.isStringSelectMenu()) &&
    (!interaction.replied && !interaction.deferred && !interaction.explicit_replied)
  )
  {
    //quiz_session, ui_holder 거쳤는데도 reply 되지 않은 경우 - 대부분은 uiHolder/quiz_session이
    //editReply(base_interaction)나 message.edit(base_message)로 화면을 갱신하는 정상 처리 경로라
    //(새 UI로 전환되는 거의 모든 버튼 클릭이 이 패턴), 정작 지금 이 인터랙션 자체는 한 번도 reply되지
    //않는다 - 화면은 멀쩡히 갱신됐으니 이 경우는 deferUpdate로 조용히 ack만 해야 한다.
    //진짜 "화면이 만료됨"은 uiHolder/quiz_session 둘 다 못 찾은 경우(UIHolder GC, 봇 재시작 등)뿐이다.
    //2026-08-12(UI 개선 2라운드 B-1 [P2])에서 "이 버튼은 만료됐어요" 안내를 추가했었는데, uiHolder가
    //있어도(=정상 처리된 경우에도) 무조건 뜨는 버그였음(2026-08-13 재수정) - uiHolder/quiz_session이
    //하나라도 있었으면 정상 처리로 보고 안내를 생략한다.
    const nothing_handled_this_interaction = quiz_session === undefined && uiHolder === undefined;

    try
    {
      interaction.explicit_replied = true;
      await interaction.deferUpdate();//ㅇㅋ deffer로 보내

      if(nothing_handled_this_interaction)
      {
        await interaction.followUp({ content: `\`\`\`⚠️ 이 버튼은 만료됐어요. 메뉴를 다시 열어주세요.\`\`\``, flags: MessageFlags.Ephemeral });
      }
    }
    catch (err)
    {
      //이 경우에는 아마 unknown interaction 에러(인터랙션 토큰 자체가 만료됨) - 응답할 방법이
      //없어 로그만 남긴다.
      logger.info(`Failed to notify expired interaction, customId: ${interaction.customId}, err: ${err.message}`);
      return;
    }
  }
});

//메시지 이벤트
client.on(CUSTOM_EVENT_TYPE.messageCreate, async (message) => 
{
  if (message.author == client.user) 
  {
    return;
  }

  let guildID = message.guild.id;
  if(!guildID) //DM이면
  {
    return;
  }

  const quiz_session = quiz_system.getQuizSession(guildID);
  if (quiz_session != undefined) 
  {
    quiz_session.on(CUSTOM_EVENT_TYPE.messageCreate, message);
  }
});

//전역 에러 처리
let error_count = 0;
process.on('uncaughtException', (err) => 
{
  try 
  {
    if (err == undefined) 
    {
      return;
    }

    if (err.message?.startsWith('Status code:') == false) 
    {
      //403 또는 410 에러 발생 시,
      logger.error(
        `Uncaught exception error!!! err_message: ${err.message}\nerr_stack: ${err.stack}`
      );
      return;
    }

    ++error_count;
    logger.error(
      `Status Code error!!! Current error count ${error_count}, err_message: ${err.message}\n`
    );

    if (error_count >= 4) 
    {
      if (admin_instance != undefined) 
      {
        //해당 클러스터에서 admin_instance 알고 있을 경우
        logger.warn(
          `Detected Expect Audio Error Status! Alerting to Admin ${PRIVATE_CONFIG.ADMIN_ID}`
        );
        admin_instance.send('Status code error detected! Check Log!');
      }

      error_count = 0;
    }
  }
  catch (err)
  {
    logger.error(`Cannot Handle Uncaught Error. err: ${err.message}`);
  }
});

//UI 핸들러(quiz_ui/*.js) 등에서 발생한 예외가 catch 없이 프라미스 체인 밖으로 새어나가면
//지금까지는 아무 로그도 안 남고 유저에게도 조용히 무반응으로만 보였음 - 최소한 로그는 남도록 처리
process.on('unhandledRejection', (reason) =>
{
  logger.error(`Unhandled promise rejection!!! reason: ${reason?.stack ?? reason}`);
});

const createCleanUp = function ()
{
  const interval = 60000;
  logger.info(`Creating cleanup timer. current interval: ${interval}ms`);

  let recent_error_count = 0;
  setInterval(() => 
  {
    if (recent_error_count == error_count) 
    {
      //1분동안 에러 난거 없으면 카운트 초기화
      logger.debug(`Cleaning up error count ${error_count} -> 0`);
      error_count = 0;
      return;
    }

    recent_error_count = error_count;
  }, interval); // 1분마다 cleanup
};

const relayMultiplayerSignal = (signal) =>
{
  if(signal.signal_type === SERVER_SIGNAL.UPDATED_LOBBY_COUNT) //이것만 예외
  {
    quizbot_ui.setGlobalLobbyCount(signal.lobby_count); //캐싱해둠
    return;
  }

  const quiz_session_handled = quiz_system.relayMultiplayerSignal(signal);
  const quiz_ui_handled = quizbot_ui.relayMultiplayerSignal(signal);

  // if(quiz_session_handled && quiz_ui_handled)  //아니아니 STARTED_LOBBY 신호는 어차피 double handle
  // {
  //   logger.warn(`Double handled ${signal.signal_type}`);
  // }
};

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - Phase 1부터 WebHandoffUI로 실제 라우팅.
const relayWebSessionSignal = (signal) =>
{
  quizbot_ui.relayWebSessionSignal(signal);
};

/** 메인 **/
//봇 활성화
client.login(PRIVATE_CONFIG.BOT.TOKEN);
