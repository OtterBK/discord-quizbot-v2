//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//관리자가 신고 로그를 조회/처리(밴, 반려)하고, 이후 취소/추가처벌/길드밴 등 후속 조치를
//진행하는 수동 신고 처리 흐름. 원본 주석 "제재 후 후속 조치"가 processFollowUpAction과
//applyGuildBan 두 곳에 중복으로 붙어 있던 것도 그대로 유지했다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags} = require('discord.js');

const PRIVATE_CONFIG = require('../../../config/private_config.json');
const logger = require('../../../utility/logger.js')('ReportManager');
const db_manager = require('../db_manager.js');
const ban_manager = require('../ban_manager');

const report_state = require('./report_state');
const report_chat_info = require('./report_chat_info');
const report_processing_core = require('./report_processing_core');

/** 수동 신고 처리 관련 */
const sendReportLog = async (interaction: any): Promise<void> =>
{
  const user = interaction.user;

  if(PRIVATE_CONFIG.ADMIN_ID !== user.id) //어드민 아니면 일부러 응답 안줌
  {
    return;
  }

  if(interaction.guild)
  {
    interaction.reply({content: `\`\`\`개인 메시지 채널에서만 사용 가능합니다.\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  let reported_chat_info_list = undefined;
  try
  {
    reported_chat_info_list = await db_manager.selectReportChatInfo(10); //10개씩 조회하자
  }
  catch(err: any)
  {
    const err_message = `select reported chat info list error. err: ${err.stack}`;

    logger.error(err_message);
    user.send({content: `\`\`\`${err_message}\`\`\``, flags: MessageFlags.Ephemeral});

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

  interaction.reply({content: `\`\`\`${reported_chat_info_list.rowCount}개의 신고 항목 조회함\`\`\``, flags: MessageFlags.Ephemeral});
};

const sendReportProcessingUI = async (user: any, reported_chat_info: any): Promise<void> =>
{
  const target_id = reported_chat_info.chat_id;
  const sender_id = reported_chat_info.sender_id;

  let target_report_log_list = undefined;

  try
  {
    target_report_log_list = await db_manager.selectReportLog(target_id);
  }
  catch(err: any)
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

  const embed: any = {
    color: 0x8B0000,
    title: `${target_id}`,
    description: `${reported_chat_info.content}`,
    footer: {
      text: `${sender_id}`,
    },
  };

  const extracted_chat_info = report_chat_info.extractChatInfo(target_id);
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

const processReportLog = async (interaction: any): Promise<void> =>
{
  const custom_id = interaction.customId;
  let chat_id = null;
  let process_type = report_chat_info.REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  if(custom_id.includes('ps_rpt_user_ban_'))
  {
    process_type = report_chat_info.REPORT_PROCESSED_RESULT_TYPE.BANNED;
    chat_id = custom_id.replace('ps_rpt_user_ban_', '');
  }
  else if(custom_id.includes('ps_rpt_deny_'))
  {
    process_type = report_chat_info.REPORT_PROCESSED_RESULT_TYPE.DENY;
    chat_id = custom_id.replace('ps_rpt_deny_', '');
  }

  if(process_type === report_chat_info.REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS)
  {
    const err_message = `cannot extract chat_id from ${interaction.customId}`;
    logger.error(err_message);

    interaction.reply({content: `\`\`\`${err_message}\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  const [processed_ban_history, processed_report_log_list] = await report_processing_core.processReportCore(chat_id, process_type);

  if(process_type == report_chat_info.REPORT_PROCESSED_RESULT_TYPE.BANNED)
  {
    const chat_content = interaction.message?.embeds?.[0]?.description ?? '(내용 없음)';
    report_processing_core.sendProcessedBanResult(interaction.user, processed_ban_history, chat_id, chat_content);

    report_processing_core.notifyProcessedReportLog(processed_report_log_list);

    report_processing_core.notifyBannedUser(processed_ban_history.user_id, chat_content, processed_ban_history, '정지');
  }

  interaction.message.delete();
};

/** 제재 후 후속 조치 */
const processFollowUpAction = async (interaction: any): Promise<void> =>
{
  interaction.explicit_replied = true;

  let custom_id = interaction.customId;
  let chat_id = null;
  let followup_processed_type = report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  if(custom_id.includes('ps_flwup_user_unban_')) //밴 취소
  {
    chat_id = custom_id.replace('ps_flwup_user_unban_', '');
    followup_processed_type = report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED;
  }
  else if(custom_id.includes('ps_flwup_user_ban_')) //밴 더 추가
  {
    chat_id = custom_id.replace('ps_flwup_user_ban_', '');
    followup_processed_type = report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED;
  }
  else if(custom_id.includes('ps_flwup_guild_ban_')) //길드 통채로 밴
  {
    chat_id = custom_id.replace('ps_flwup_guild_ban_', '');
    followup_processed_type = report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.GUILD_BANNED;
  }

  if(followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.IN_PROGRESS)
  {
    const err_message = `cannot extract chat_id from ${interaction.customId}`;
    logger.error(err_message);

    interaction.reply({content: `\`\`\`${err_message}\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  const chat_info = report_chat_info.extractChatInfo(chat_id);
  if(chat_info === undefined)
  {
    const err_message = `cannot extract chat_info from ${chat_id}`;
    logger.error(err_message);

    interaction.reply({content: `\`\`\`${err_message}\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  if(followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED || followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED)
  {
    let ban_count= 0;
    let ban_type_string = '';

    if(followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.UNBANNED)
    {
      ban_count = -1;
      ban_type_string = '취소';
    }
    else if(followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.BANNED)
    {
      ban_count = 1;
      ban_type_string = '추가';
    }

    const ban_history = await report_processing_core.applyBan(chat_info.user_id, ban_count); //처리
    const expiration_date = new Date(ban_history.ban_expiration_timestamp).toLocaleString();
    const result_message = `제재 ${ban_type_string}\nCHAT_ID:${chat_id}\nUSER_ID: ${ban_history.user_id}\nBAN_COUNT: ${ban_history.ban_count}\n밴 만료일자: ${expiration_date}\n`;

    interaction.reply({content: `\`\`\`${result_message}\`\`\``, flags: MessageFlags.Ephemeral});

    const chat_info_result = await db_manager.selectChatInfoById(chat_id);
    const chat_content = chat_info_result?.rows?.[0]?.content ?? '(내용 없음)';
    const notify_action_label = (ban_type_string === '취소') ? '취소' : '추가처벌';

    report_processing_core.notifyBannedUser(ban_history.user_id, chat_content, ban_history, notify_action_label);
  }
  else if(followup_processed_type === report_chat_info.FOLLOWUP_PROCESSED_RESULT_TYPE.GUILD_BANNED)
  {
    const guild_id = chat_info.guild_id;
    const guild = await report_state.getClient().guilds.fetch(guild_id).catch(() => { return null; });
    if(!guild)
    {
      const err_message = `cannot fetch guild ${guild_id}`;
      logger.error(err_message);

      interaction.reply({content: `\`\`\`${err_message}\`\`\``, flags: MessageFlags.Ephemeral});
      return;
    }

    let result_message = '';
    const is_banned = await applyGuildBan(guild_id);
    if(is_banned)
    {
      result_message = `Guild ${guild.name}/${guild.id} has been banned from multiplayer quiz.`;
    }
    else
    {
      result_message = `Guild ${guild.name}/${guild.id} is already banned.`;
    }
    logger.info(result_message);
    interaction.reply({content: `\`\`\`${result_message}\`\`\``, flags: MessageFlags.Ephemeral});
  }

};

/** 제재 후 후속 조치 */
const applyGuildBan = async (guild_id: string): Promise<boolean> =>
{
  return ban_manager.banId(guild_id);
};

module.exports = { sendReportLog, sendReportProcessingUI, processReportLog, processFollowUpAction, applyGuildBan };
