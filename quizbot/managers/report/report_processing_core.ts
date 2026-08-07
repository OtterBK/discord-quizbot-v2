//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//신고 처리 핵심 로직. report_manual_processing.js(수동 처리)와 auto_report_processing.js
//(자동 처리) 양쪽에서 공통으로 쓰인다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const db_manager = require('../db_manager.js');
const logger = require('../../../utility/logger.js')('ReportManager');
const report_state = require('./report_state');
const report_chat_info = require('./report_chat_info');

/** 신고 처리 핵심 */
const processReportCore = async (chat_id: string, process_type: number): Promise<[any, any] | undefined> =>
{
  const chat_info = report_chat_info.extractChatInfo(chat_id);
  if(chat_info === undefined)
  {
    logger.error(`cannot extract chat_info from ${chat_id}`);
    return;
  }

  await db_manager.updateChatInfoResult(chat_id, process_type); //처리 결과 업데이트.

  let processed_ban_history = null;
  let processed_report_log_list = null;
  processed_report_log_list = await db_manager.deleteReportedLog(chat_id); //처리된 신고 사항은 삭제

  if(process_type === report_chat_info.REPORT_PROCESSED_RESULT_TYPE.DENY)
  {
    return [processed_ban_history, processed_report_log_list];
  }

  // 밴 처리
  processed_ban_history = await applyBan(chat_info.user_id, 1); //유저 밴 처리

  return [processed_ban_history, processed_report_log_list];
};

const applyBan = async (user_id: string, count = 1): Promise<any> =>
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

const sendProcessedBanResult = async (executor_user: any, ban_history: any, chat_id: string, chat_content: string): Promise<void> =>
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

/** 밴 당사자에게 처리 결과(정지/추가처벌/취소)를 알림 (B-4) */
const notifyBannedUser = async (user_id: string, chat_content: string, ban_history: any, action_label: string): Promise<void> =>
{
  const user = await report_state.getClient().users.fetch(user_id).catch(() =>
  {
    return null;
  });

  if(!user)
  {
    logger.error(`cannot fetch user ${user_id} to notify ban result`);
    return;
  }

  if(chat_content)
  {
    chat_content = chat_content.replace(/`/g, "");
  }

  let detail = '';
  if(action_label === '취소')
  {
    detail = `정지가 취소되었습니다.`;
  }
  else
  {
    const expiration_date = new Date(ban_history.ban_expiration_timestamp).toLocaleString();
    detail = `현재 총 정지 횟수: ${ban_history.ban_count}회\n정지 만료일자: ${expiration_date}`;
  }

  const result_message = `채팅 정지 안내 (${action_label})\n\n정지 사유(원문):\n${chat_content ?? '(내용 없음)'}\n\n${detail}`;

  user.send({content: `\`\`\`${result_message}\`\`\``}).catch((err: any) =>
  {
    logger.error(`failed to send ban notification to user ${user_id}. err: ${err.stack}`);
  });
};

const notifyProcessedReportLog = async (report_log_list: any): Promise<void> =>
{
  if(report_log_list === undefined || report_log_list.rowCount === 0)
  {
    return;
  }

  const notified: string[] = [];
  for(const report_log of report_log_list.rows) //신고 처리 결과들 제보자들한테 알림
  {
    if(notified.includes(report_log.reporter_id))
    {
      continue;
    }

    const reporter_id = report_log.reporter_id;
    const user = await report_state.getClient().users.fetch(reporter_id);

    if(user)
    {
      user.send(`\`\`\`🔹 감사합니다. 신고하신 유저에 대한 제재가 완료됐습니다.\n\n🔸 신고하신 내용:\n${report_log.report_detail}\`\`\``);
    }

    notified.push(reporter_id);
  }
}

module.exports = { processReportCore, applyBan, sendProcessedBanResult, notifyProcessedReportLog, notifyBannedUser };
