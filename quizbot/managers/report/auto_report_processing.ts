//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//욕설 정규표현식 자동 감지 후 자동으로 밴 처리하는 주기 작업.
//로직/주석은 원본과 동일 (동작 변경 없음).

const PRIVATE_CONFIG = require('../../../config/private_config.json');
const logger = require('../../../utility/logger.js')('ReportManager');
const db_manager = require('../db_manager.js');
const { createProfanityChecker } = require('../../../utility/profanity_checker.js');

const report_state = require('./report_state');
const report_chat_info = require('./report_chat_info');
const report_processing_core = require('./report_processing_core');

/** 자동 신고처리용 */
const profanity_checker = createProfanityChecker(null, { return_matches: true });
const autoProcessReportLog = async (): Promise<void> =>
{
  logger.debug(`Auto Process Reported Chat Start`);
  let reported_chat_info_list = undefined;
  try
  {
    reported_chat_info_list = await db_manager.selectReportChatInfo(100); //자동 처리는 LIMIT을 굳이 제한할 필요는 없다
  }
  catch(err: any)
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

  const admin_user = await report_state.getClient().users.fetch(PRIVATE_CONFIG.ADMIN_ID);
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

      const [processed_ban_history, processed_report_log_list] = await report_processing_core.processReportCore(reported_chat_info.chat_id, report_chat_info.REPORT_PROCESSED_RESULT_TYPE.BANNED);

      report_processing_core.sendProcessedBanResult(admin_user, processed_ban_history, reported_chat_info.chat_id, content);

      report_processing_core.notifyProcessedReportLog(processed_report_log_list);
    }
  }

  if(processed > 0)
  {
    logger.info(`Auto Process Reported Chat Completed. Total: ${total_report_log} Processed: ${processed}`);
    admin_user.send(`\`\`\`자동 신고 처리 완료. 총 ${total_report_log}건 중 ${processed}건 처리됨.\`\`\``);
  }

};

module.exports = { autoProcessReportLog };
