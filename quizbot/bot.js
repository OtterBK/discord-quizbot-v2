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

const command_manager = require('./managers/command_manager.js');
const quizbot_ui = require('./quiz_ui/ui-system-core.js');
const quiz_system = require('./quiz_system/quiz_system.js');
const option_system = require('./quiz_option/quiz_option.js');
const utility = require('../utility/utility.js');
const logger = require('../utility/logger.js')('Main');
const db_manager = require('./managers/db_manager.js');
const ipc_manager = require('./managers/ipc_manager.js');
const tagged_dev_quiz_manager = require('./managers/tagged_dev_quiz_manager.js');
const audio_cache_manager = require('./managers/audio_cache_manager.js');
const multiplayer_chat_manager = require('./managers/multiplayer_chat_manager.js');
const report_manager = require('./managers/report_manager.js');
const ban_manager = require('./managers/ban_manager.js');
const { SERVER_SIGNAL } = require('./managers/multiplayer_signal.js');
const { startMonitoring } = require('./managers/monitoring_manager.js');

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
        `\`\`\`🔸 이 채널에 메시지를 보낼 권한이 없습니다.😥\n봇에게 필요한 권한을 부여하거나 서버 관리자에게 봇을 추방하고 다시 초대하도록 요청해보세요.\`\`\``,
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
        `\`\`\`🔸 이 채널의 속성을 확인할 수 있는 권한이 없습니다.😥\n봇에게 필요한 권한을 부여하거나 서버 관리자에게 봇을 추방하고 다시 초대하도록 요청해보세요.\`\`\``,
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
      content: `\`\`\`🔸 개인 메시지 채널에서는 퀴즈 플레이가 불가능합니다.\`\`\``,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if(checkPermission(interaction) === false)
  {
    return;
  }

  const uiHolder = quizbot_ui.createMainUIHolder(interaction); //메인 메뉴 전송
  if(uiHolder != undefined)
  {
    //임시로 잠시 해둠 -> 실시간 공지 보내기
    if (fs.existsSync(SYSTEM_CONFIG.CURRENT_NOTICE_PATH)) 
    {
      const current_notice = fs.readFileSync(SYSTEM_CONFIG.CURRENT_NOTICE_PATH, {
        encoding: 'utf8',
        flag: 'r',
      });
  
      if(current_notice.length >= 0)
      {
        interaction.channel.send({ 
          content: `\`\`\`${current_notice}\`\`\``,
          // components: [new ActionRowBuilder()
          //   .addComponents(
          //     new ButtonBuilder()
          //       .setLabel('보드게임봇 테스트 참여하기')
          //       .setURL('https://koreanbots.dev/bots/952896575145930773')
          //       .setStyle(ButtonStyle.Link),
          //   ) ],
        });
      }
    }
  }
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
    interaction.reply({ content: `\`\`\`🔸 퀴즈 생성 권한이 영구적으로 제한되었습니다.\`\`\``, flags: MessageFlags.Ephemeral });
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
      `\`\`\`🔸 개인 메시지로 퀴즈 제작 화면을 보내드렸어요!\n퀴즈봇과의 개인 메시지를 확인해주세요 🛠\`\`\``,
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

const clear_quiz_handler = (interaction) =>
{
  interaction.explicit_replied = true; 
  interaction.reply({ content: `\`\`\`🔸 서버에서 진행 중인 모든 세션을 정리했습니다.\n이 명령어는 봇 이용에 문제가 발생했을 때만 사용하세요.\`\`\`` });
  logger.info(`Cleared quiz session of ${interaction.guild.id} by ${interaction.user.id}`);

  const guild = interaction.guild;

  quizbot_ui.eraseUIHolder(guild);
  quiz_system.forceStopSession(guild);
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
        content: `\`\`\`🔸 해당 UI를 생성한 ${uiHolder.getOwnerName()}님만이 조작할 수 있어요.\nUI를 새로 만들려면 [/퀴즈] 명령어를 다시 입력해주세요!\`\`\``,
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
    //quiz_session, ui_holder 거쳤는데도 reply 되지 않았다면
    try 
    {
      interaction.explicit_replied = true; 
      await interaction.deferUpdate();//ㅇㅋ deffer로 보내
    }
    catch (err) 
    {
      return; //이 경우에는 아마 unknown interaction 에러임
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

/** 메인 **/
//봇 활성화
client.login(PRIVATE_CONFIG.BOT.TOKEN);
