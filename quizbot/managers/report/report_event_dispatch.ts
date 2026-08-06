//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//interaction이 신고 관련 이벤트인지 판별하고 해당 핸들러로 라우팅한다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const report_submission = require('./report_submission');
const report_manual_processing = require('./report_manual_processing');

/** 신고 관련 이벤트 확인용 */

const isReportChatButton = (interaction: any): boolean =>
{
  if(interaction.isButton() && interaction.customId.startsWith('chat_report_'))
  {
    return true;
  }

  return false;
};

const isReportChatModal = (interaction: any): boolean =>
{
  if(interaction.isModalSubmit() && interaction.customId.startsWith('modal_chat_report_'))
  {
    return true;
  }

  return false;
};

const isReportManageCommand = (interaction: any): boolean =>
{
  if(interaction.isCommand() && interaction.commandName === '신고처리')
  {
    return true;
  }

  return false;
};

const isReportProcessButton = (interaction: any): boolean =>
{
  if(interaction.isButton() && interaction.customId.startsWith('ps_rpt_'))
  {
    return true;
  }

  return false;
};

const isFollowUpProcessButton = (interaction: any): boolean =>
{
  if(interaction.isButton() && interaction.customId.startsWith('ps_flwup_'))
  {
    return true;
  }

  return false;
};

const checkReportEvent = (interaction: any): boolean | undefined =>
{
  if(isReportChatButton(interaction))
  {
    report_submission.requestReportChatModal(interaction);
    return true;
  }

  if(isReportChatModal(interaction))
  {
    report_submission.submitReportChatModal(interaction);
    return true;
  }

  if(isReportManageCommand(interaction))
  {
    report_manual_processing.sendReportLog(interaction);
    return true;
  }

  if(isReportProcessButton(interaction))
  {
    report_manual_processing.processReportLog(interaction);
    return true;
  }

  if(isFollowUpProcessButton(interaction))
  {
    report_manual_processing.processFollowUpAction(interaction);
    return true;
  }
};

module.exports = { checkReportEvent };
