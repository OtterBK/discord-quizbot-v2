//report/*.js로 분리 (REFACTOR_PLAN.md Phase 5)
//원본이 module.exports = { initialize, checkReportEvent }만 노출했던 것과 동일하게,
//report_manager.js는 초기화(주기 작업 등록)만 담당하고 checkReportEvent는 그대로 재수출하는
//얇은 facade로 남긴다.
const report_state = require('./report/report_state.js');
const chat_cache = require('./report/chat_cache.js');
const auto_report_processing = require('./report/auto_report_processing.js');
const { checkReportEvent } = require('./report/report_event_dispatch.js');

/** 초기화 */

const initialize = (client) =>
{
  report_state.setClient(client);

  setInterval(() =>
  {
    auto_report_processing.autoProcessReportLog();
  }
  , 180000); //3분마다 자동 처리 시도

  setInterval(() =>
  {
    chat_cache.cleanUpChatCache();
  }, 60000); //1분마다 캐시 정리
};

module.exports = { initialize, checkReportEvent };
