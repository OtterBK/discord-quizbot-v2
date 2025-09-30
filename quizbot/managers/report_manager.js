const fs = require('fs');
const cloneDeep = require("lodash/cloneDeep.js");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder} = require('discord.js');

const PRIVATE_CONFIG = require('../../config/private_config.json');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('ReportManager');
const db_manager = require('./db_manager.js');
const { createProfanityChecker } = require('../../utility/profanity_checker.js');
const {
  modal_chat_report,
} = require("../quiz_ui/components.js");

/** 초기화 */

const chat_content_cache = {}; //chat_id, chat_content

let bot_client = undefined;
const initialize = (client) => 
{
  bot_client = client;

  setInterval(() =>
  {
    autoProcessReportLog();
  }
  , 180000); //3분마다 자동 처리 시도

  setInterval(() =>
  {
    cleanUpChatCache();
  }, 60000); //1분마다 캐시 정리
};

/** 채팅 캐시 쪽 */

const cleanUpChatCache = () =>
{
  const aging_criteria = Date.now() - 300000; //5분
  const aging_target = [];

  const keys = Object.keys(chat_content_cache);

  for(const chat_id of keys)
  {
    const cache_info = chat_content_cache[chat_id];
    if(cache_info.cached_time < aging_criteria)
    {
      aging_target.push(chat_id);
    }
  }

  if(aging_target.length === 0)
  {
    return;
  }

  logger.info(`Aging Chat Content Cache size: ${aging_target.length}/${keys.length}`);

  for(const chat_id of aging_target)    
  {
    delete chat_content_cache[chat_id];
  }
};

const insertChatCache = (chat_id, content) =>
{
  if(chat_id === undefined)
  {
    return;
  }

  const prev_cache = getChatCacheContent(chat_id);
  if(prev_cache !== undefined)
  {
    prev_cache.cached_time = Date.now();
    return;
  }

  chat_content_cache[chat_id] = {
    content: content,
    cached_time: Date.now(),
  };
};

const getChatCacheContent = (chat_id) =>
{
  if(chat_id === undefined)
  {
    return undefined;
  }

  const cache_content = chat_content_cache[chat_id];
  if(cache_content === undefined)
  {
    return undefined;
  }

  return cache_content.content;
};

/** 신고 관련 이벤트 확인용 */

const isReportChatButton = (interaction) =>
{
  if(interaction.isButton() && interaction.customId.startsWith('chat_report_'))
  {
    return true;
  }

  return false;
};

const isReportChatModal = (interaction) =>
{
  if(interaction.isModalSubmit() && interaction.customId.startsWith('modal_chat_report_'))
  {
    return true;
  }

  return false;
};

const isReportManageCommand = (interaction) =>
{
  if(interaction.isCommand() && interaction.commandName === '신고처리')
  {
    return true;
  }

  return false;
};

const isReportProcessButton = (interaction) =>
{
  if(interaction.isButton() && interaction.customId.startsWith('ps_rpt_'))
  {
    return true;
  }
  
  return false;
};

const isFollowUpProcessButton = (interaction) =>
{
  if(interaction.isButton() && interaction.customId.startsWith('ps_flwup_'))
  {
    return true;
  }
  
  return false;
};

const checkReportEvent = (interaction) =>
{
  if(isReportChatButton(interaction))
  {
    requestReportChatModal(interaction);
    return true;
  }
    
  if(isReportChatModal(interaction))
  {
    submitReportChatModal(interaction);
    return true;
  }

  if(isReportManageCommand(interaction))
  {
    sendReportLog(interaction);
    return true;
  }

  if(isReportProcessButton(interaction))
  {
    processReportLog(interaction);
    return true;
  }

  if(isFollowUpProcessButton(interaction))
  {
    processFollowUpAction(interaction);
    return true;
  }
};

/** 신고 접수 관련 */

const requestReportChatModal = (interaction) =>
{
  interaction.explicit_replied = true;

  const chat_id = getChatId(interaction.customId);
  if(chat_id === undefined)
  {
    return;
  }

  insertChatCache(chat_id, interaction.message.content);

  const report_chat_modal = cloneDeep(modal_chat_report);
  report_chat_modal.setCustomId(`modal_chat_report_${chat_id}`); //chat_id가 아닌 customId 그대로

  interaction.showModal(report_chat_modal);
};

const submitReportChatModal = (interaction) =>
{
  interaction.explicit_replied = true;
    
  const chat_id = getChatId(interaction.customId);
  const content = getChatCacheContent(chat_id);
  const chat_info = extractChatInfo(chat_id);
  if(chat_info === undefined || content === undefined)
  {
    interaction.reply({content: `\`\`\`🔸 신고에 실패했습니다. (No Cache Content)\n다시 시도해보세요.\`\`\``});
    return;
  }

  const sender_id = chat_info.user_id;
  const reporter_id = interaction.user.id;
  const report_detail = interaction.fields.getTextInputValue('txt_input_report_detail');
  const result = 0;
  const report_type = REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  interaction.reply({content: `\`\`\`🔸 신고가 접수되었습니다. 감사합니다.\`\`\``, ephemeral: true});

  db_manager.insertChatInfo(chat_info_key_fields, [chat_id, content, sender_id, result]);
  db_manager.insertReportInfo(report_info_key_fields, [chat_id, reporter_id, report_detail, report_type]);

  logger.info(`${sender_id} Reported Message ${content}`);

  if(PRIVATE_CONFIG.ADMIN_ID)
  {
    bot_client.users.fetch(PRIVATE_CONFIG.ADMIN_ID).then((instance) => 
    {
      if (instance) 
      {
        instance.send(`\`\`\`새로운 신고가 접수되었습니다.\`\`\``);
      }
    });
  }
};
  
/** Chat 쪽 DB 관련 */

const getChatId = (custom_id) =>
{
  let chat_id = custom_id.replace('modal_chat_report_', '');
  if(chat_id === custom_id)
  {
    chat_id = custom_id.replace('chat_report_', '');
  }

  if(chat_id === custom_id) //안바뀌었으면 없는거임
  {
    return undefined;
  }

  return chat_id;
};

/** Chat ID 에서 정보 추출 */
const extractChatInfo = (chat_id) =>
{
  const info = chat_id.split('-');
  if(info.length != 3)
  {
    return undefined;
  }

  return {
    guild_id: info[0],
    user_id: info[1],
    timestamp: info[2],
  };
};

const CHAT_INFO_COLUMN = 
[
  "chat_id",
  "content",
  "sender_id",
  "result",
];

const REPORT_INFO_COLUMN =
[
  "target_id",
  "reporter_id",
  "report_detail",
  "report_type",
];

let chat_info_key_fields = '';
CHAT_INFO_COLUMN.forEach((field) =>
{
  if(chat_info_key_fields != '')
  {
    chat_info_key_fields += ', ';
  }
  chat_info_key_fields += `${field}`;
});

let report_info_key_fields = '';
REPORT_INFO_COLUMN.forEach((field) =>
{
  if(report_info_key_fields != '')
  {
    report_info_key_fields += ', ';
  }
  report_info_key_fields += `${field}`;
});

const REPORT_PROCESSED_RESULT_TYPE = 
{
  IN_PROGRESS: 0,
  BANNED: 1,
  DENY: 2,
};

const FOLLOWUP_PROCESSED_RESULT_TYPE = 
{
  IN_PROGRESS: 0,
  UNBANNED: 1,
  BANNED: 2,
  GUILD_BANNED: 3,
};

/** 신고 처리 핵심 */
const processReportCore = async (chat_id, process_type) =>
{
  const chat_info = extractChatInfo(chat_id);
  if(chat_info === undefined)
  {
    logger.error(`cannot extract chat_info from ${chat_id}`);
    return;
  }

  await db_manager.updateChatInfoResult(chat_id, process_type); //처리 결과 업데이트.

  let processed_ban_history = null;
  let processed_report_log_list = null;
  processed_report_log_list = await db_manager.deleteReportedLog(chat_id); //처리된 신고 사항은 삭제

  if(process_type === REPORT_PROCESSED_RESULT_TYPE.DENY)
  {
    return [processed_ban_history, processed_report_log_list];
  }

  // 밴 처리
  processed_ban_history = await applyBan(chat_info.user_id, 1); //유저 밴 처리

  return [processed_ban_history, processed_report_log_list];
};

const applyBan = async (user_id, count = 1) =>
{
  const ban_history_result = await db_manager.selectBanHistory(user_id);
    
  let ban_history = null;
  if(ban_history_result.rowCount === 0)
  {
    ban_history = {
      user_id: user_id,
      ban_count: 0,
      ban_expiration_timestamp: 0,
    };
  }
  else
  {
    ban_history = ban_history_result.rows[0];
  }

  ban_history.ban_count += count;

  const ban_count = ban_history.ban_count;
  ban_history.ban_expiration_timestamp = Date.now() + ((24 * 60 * 60 * 1000) * (ban_count * ban_count * ban_count)); //ban_count 의 3제곱 * 1일 만큼 제재

  db_manager.updateBanHistory(ban_history.user_id, ban_history.ban_count, ban_history.ban_expiration_timestamp);

  return ban_history;
};

const sendProcessedBanResult = async (executor_user, ban_history, chat_id, chat_content) =>
{
  if(!executor_user)
  {
    return;
  }

  if(chat_content)
  {
    chat_content = chat_content.replace(/`/g, "");
  }

  const expiration_date = new Date(ban_history.ban_expiration_timestamp).toLocaleString();
  const result_message = `제재 완료\nCHAT_ID:${chat_id}\nUSER_ID: ${ban_history.user_id}\nBAN_COUNT: ${ban_history.ban_count}\n밴 만료일자: ${expiration_date}\n\n신고된 내용:\n${chat_content}`;

  const follow_up_comp = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`ps_flwup_user_unban_${chat_id}`)
        .setLabel('취소')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ps_flwup_user_ban_${chat_id}`)
        .setLabel('추가처벌')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ps_flwup_guild_ban_${chat_id}`)
        .setLabel('길드정지')
        .setStyle(ButtonStyle.Danger),
    );

  executor_user.send({content: `\`\`\`${result_message}\`\`\``, components: [follow_up_comp]});
};

const notifyProcessedReportLog = async (report_log_list) =>
{
  if(report_log_list === undefined || report_log_list.rowCount === 0)
  {
    return;
  }

  const notified = [];
  for(const report_log of report_log_list.rows) //신고 처리 결과들 제보자들한테 알림
  {
    if(notified.includes(report_log.reporter_id))
    {
      continue;
    }

    const reporter_id = report_log.reporter_id;
    const user = await bot_client.users.fetch(reporter_id);

    if(user) 
    {
      user.send(`\`\`\`🔹 감사합니다. 신고하신 유저에 대한 제재가 완료됐습니다.\n\n🔸 신고하신 내용:\n${report_log.report_detail}\`\`\``);
    }

    notified.push(reporter_id);
  }
}

/** 수동 신고 처리 관련 */
const sendReportLog = async (interaction) =>
{
  const user = interaction.user;

  if(PRIVATE_CONFIG.ADMIN_ID !== user.id) //어드민 아니면 일부러 응답 안줌
  {
    return;
  }

  if(interaction.guild)
  {
    interaction.reply({content: `\`\`\`개인 메시지 채널에서만 사용 가능합니다.\`\`\``, ephemeral: true});
    return;
  }

  let reported_chat_info_list = undefined;
  try
  {
    reported_chat_info_list = await db_manager.selectReportChatInfo(10); //10개씩 조회하자
  }
  catch(err)
  {
    const err_message = `select reported chat info list error. err: ${err.stack}`;

    logger.error(err_message);
    user.send({content: `\`\`\`${err_message}\`\`\``, ephemeral: true});

    return;
  }

  if(reported_chat_info_list === undefined)
  {
    const err_message = `reported_chat_info_list is undefined error`;

    logger.error(err_message);
    user.send({content: `\`\`\`${err_message}\`\`\``});

    return;
  }

  if(reported_chat_info_list.rowCount === 0)
  {
    interaction.reply({content: `\`\`\`처리할 신고 사항이 없습니다.\`\`\``});
    return;
  }

  for(const reported_chat_info of reported_chat_info_list.rows)
  {
    await sendReportProcessingUI(user, reported_chat_info);
  }

  interaction.reply({content: `\`\`\`${reported_chat_info_list.rowCount}개의 신고 항목 조회함\`\`\``, ephemeral: true});
};

const sendReportProcessingUI = async (user, reported_chat_info) =>
{
  const target_id = reported_chat_info.chat_id;
  const sender_id = reported_chat_info.sender_id;

  let target_report_log_list = undefined;

  try
  {
    target_report_log_list = await db_manager.selectReportLog(target_id);
  }
  catch(err)
  {
    const err_message = `select reported chat log error. err: ${err.stack}`;

    logger.error(err_message);
    user.send({content: `\`\`\`${err_message}\`\`\``});

    return;
  }

  if(target_report_log_list === undefined || target_report_log_list.rowCount === 0)
  {
    const err_message = `target_report_log_list is undefined or rowCount 0 error`;

    logger.error(err_message);
    user.send({content: `\`\`\`${err_message}\`\`\``});

    return;
  }

  const embed = {
    color: 0x8B0000,
    title: `${target_id}`,
    description: `${reported_chat_info.content}`,
    footer: {
      text: `${sender_id}`,
    },
  };

  const extracted_chat_info = extractChatInfo(target_id);
  if(extracted_chat_info !== undefined)
  {
    const iso_timestamp = new Date(parseInt(extracted_chat_info.timestamp)).toISOString();
    embed.timestamp = iso_timestamp;
  }

  const reported_log_detail_menu = new StringSelectMenuBuilder().
    setCustomId('reported_log_detail_menu').
    setPlaceholder('신고 내역');

  let temp_count = 0;
  for(const target_report_log of target_report_log_list.rows)
  {
    if(++temp_count > 25)
    {
      break;
    }

    reported_log_detail_menu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${target_report_log.reporter_id}`)
        .setDescription(`${target_report_log.report_detail}`)
        .setValue(`report_log_temp_${temp_count}`),
    );
  }

  const reported_log_detail_row = new ActionRowBuilder()
    .addComponents(reported_log_detail_menu);

  const process_report_comp = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`ps_rpt_user_ban_${target_id}`)
        .setLabel('처벌')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ps_rpt_deny_${target_id}`)
        .setLabel('반려')
        .setStyle(ButtonStyle.Secondary),
    );
  
  user.send({embeds: [embed], components: [reported_log_detail_row, process_report_comp]});
};

const processReportLog = async (interaction) =>
{
  const custom_id = interaction.customId;
  let chat_id = null;
  let process_type = REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  if(custom_id.includes('ps_rpt_user_ban_'))
  {
    process_type = REPORT_PROCESSED_RESULT_TYPE.BANNED;
    chat_id = custom_id.replace('ps_rpt_user_ban_', '');
  }
  else if(custom_id.includes('ps_rpt_deny_'))
  {
    process_type = REPORT_PROCESSED_RESULT_TYPE.DENY;
    chat_id = custom_id.replace('ps_rpt_deny_', '');
  }

  if(process_type === REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS)
  {
    const err_message = `cannot extract chat_id from ${interaction.customId}`;
    logger.error(err_message);
    
    interaction.reply({content: `\`\`\`${err_message}\`\`\``, ephemeral: true});
    return;
  }

  const [processed_ban_history, processed_report_log_list] = await processReportCore(chat_id, process_type);
  
  const chat_content = interaction.message?.embeds?.[0]?.description ?? '(내용 없음)';
  sendProcessedBanResult(interaction.user, processed_ban_history, chat_id, chat_content);

  notifyProcessedReportLog(processed_report_log_list);

  interaction.message.delete();
};

/** 제재 후 후속 조치 */
const processFollowUpAction = async (interaction) =>
{
  interaction.explicit_replied = true;

  let custom_id = interaction.customId;
  let chat_id = null;
  let followup_processed_type = FOLLOWUP_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  if(custom_id.includes('ps_flwup_user_unban_')) //밴 취소
  {
    chat_id = custom_id.replace('ps_flwup_user_unban_', '');
    followup_processed_type = FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED;
  }
  else if(custom_id.includes('ps_flwup_user_ban_')) //밴 더 추가
  {
    chat_id = custom_id.replace('ps_flwup_user_ban_', '');
    followup_processed_type = FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED;
  }
  else if(custom_id.includes('ps_flwup_guild_ban_')) //길드 통채로 밴
  {
    chat_id = custom_id.replace('ps_flwup_guild_ban_', '');
    followup_processed_type = FOLLOWUP_PROCESSED_RESULT_TYPE.GUILD_BANNED;
  }

  if(followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.IN_PROGRESS)
  {
    const err_message = `cannot extract chat_id from ${interaction.customId}`;
    logger.error(err_message);
    
    interaction.reply({content: `\`\`\`${err_message}\`\`\``, ephemeral: true});
    return;
  }

    const chat_info = extractChatInfo(chat_id);
    if(chat_info === undefined)
    {
      const err_message = `cannot extract chat_info from ${chat_id}`;
      logger.error(err_message);
      
      interaction.reply({content: `\`\`\`${err_message}\`\`\``, ephemeral: true});
      return;
    }

  if(followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED || followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED)
  {
    let ban_count= 0;
    let ban_type_string = '';
    
    if(followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED)
    {
      ban_count = -1;
      ban_type_string = '취소';
    }
    else if(followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED)
    {
      ban_count = 1;
      ban_type_string = '추가';
    }

    const ban_history = await applyBan(chat_info.user_id, ban_count); //처리
    const expiration_date = new Date(ban_history.ban_expiration_timestamp).toLocaleString();
    const result_message = `제재 ${ban_type_string}\nCHAT_ID:${chat_id}\nUSER_ID: ${ban_history.user_id}\nBAN_COUNT: ${ban_history.ban_count}\n밴 만료일자: ${expiration_date}\n`;

    interaction.reply({content: `\`\`\`${result_message}\`\`\``, ephemeral: true});
  }
  else if(followup_processed_type === FOLLOWUP_PROCESSED_RESULT_TYPE.GUILD_BANNED)
  {
    const guild_id = chat_info.guild_id;
    const guild = await bot_client.guilds.fetch(guild_id).catch(() => { return null; });
    if(!guild)
    {
      const err_message = `cannot fetch guild ${guild_id}`;
      logger.error(err_message);
      
      interaction.reply({content: `\`\`\`${err_message}\`\`\``, ephemeral: true});
      return;
    }

    let result_message = '';
    const is_banned = applyGuildBan(guild_id);
    if(is_banned)
    {
      result_message = `Guild ${guild.name}/${guild.id} has been banned from multiplayer quiz.`;
    }
    else
    {
      result_message = `Guild ${guild.name}/${guild.id} is already banned.`;
    }
    logger.info(result_message);
    interaction.reply({content: `\`\`\`${result_message}\`\`\``, ephemeral: true});
  }

};

/** 제재 후 후속 조치 */
const applyGuildBan = async (guild_id) =>
{
  // 밴 리스트 파일이 없으면 새로 생성
  if (!fs.existsSync(SYSTEM_CONFIG.BANNED_USER_PATH)) 
  {
    fs.writeFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, '');
  }

  // 파일 읽기
  const banned_list = fs.readFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, {
    encoding: 'utf8',
    flag: 'r',
  });

  const banned_list_array = banned_list.split('\n').map(line => line.trim()).filter(Boolean);
  // 이미 밴된 경우 처리
  if(banned_list_array.includes(guild_id)) 
  {
    logger.info(`Guild ${guild_id} is already banned`);
    return false; // 이미 등록된 경우
  }
  // 새로 추가
  fs.appendFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, `${guild_id}\n`, {
    encoding: 'utf8',
  });

  logger.info(`Guild ${guild_id} is banned`);

  return true;
};


/** 자동 신고처리용 */
const profanity_checker = createProfanityChecker(null, { return_matches: true });
const autoProcessReportLog = async () =>
{
  logger.info(`Auto Process Reported Chat Start`);
  let reported_chat_info_list = undefined;
  try
  {
    reported_chat_info_list = await db_manager.selectReportChatInfo(100); //자동 처리는 LIMIT을 굳이 제한할 필요는 없다
  }
  catch(err)
  {
    logger.error(`select reported chat info list error. err: ${err.stack}`);
    return;
  }

  if(reported_chat_info_list === undefined)
  {
    logger.error(`reported_chat_info_list is undefined error`);
    return;
  }

  if(reported_chat_info_list.rowCount === 0) //처리할게 없음
  {
    return;
  }

  const admin_user = await bot_client.users.fetch(PRIVATE_CONFIG.ADMIN_ID);
  if(!admin_user)
  {
    logger.error(`cannot fetch admin user ${PRIVATE_CONFIG.ADMIN_ID}`);
    return;
  }

  const total_report_log = reported_chat_info_list.rowCount;
  let processing = 0;
  let processed = 0;
  for(const reported_chat_info of reported_chat_info_list.rows)
  {
    ++processing;
    const content = reported_chat_info.content;
    logger.info(`Auto Checking Reported Chat ${reported_chat_info.chat_id} Content: ${content} Progress: ${processing}/${total_report_log}`);

    //욕설 정규표현식 체크
    const res = profanity_checker.check(content);
    if(res.found) //욕설 감지됨
    {
      logger.info(`Auto Process Reported Chat ${reported_chat_info.chat_id} Content: ${content} Matches: ${res.matches}`);
      ++processed;

      const [processed_ban_history, processed_report_log_list] = await processReportCore(reported_chat_info.chat_id, REPORT_PROCESSED_RESULT_TYPE.BANNED);

      sendProcessedBanResult(admin_user, processed_ban_history, reported_chat_info.chat_id, content);

      notifyProcessedReportLog(processed_report_log_list);
    }
  }

  if(processed > 0)
  {
    logger.info(`Auto Process Reported Chat Completed. Total: ${total_report_log} Processed: ${processed}`);
    admin_user.send(`\`\`\`자동 신고 처리 완료. 총 ${total_report_log}건 중 ${processed}건 처리됨.\`\`\``);
  }
  
};

module.exports = { initialize, checkReportEvent };
