//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//신고 접수(버튼 클릭 -> 모달 표시 -> 모달 제출) 관련.
//로직/주석은 원본과 동일 (동작 변경 없음).

const cloneDeep = require("lodash/cloneDeep.js");
const { MessageFlags } = require('discord.js');

const PRIVATE_CONFIG = require('../../../config/private_config.json');
const logger = require('../../../utility/logger.js')('ReportManager');
const db_manager = require('../db_manager.js');
const {
  modal_chat_report,
} = require("../../quiz_ui/components.js");

const report_state = require('./report_state');
const chat_cache = require('./chat_cache');
const report_chat_info = require('./report_chat_info');

/** 신고 접수 관련 */

const requestReportChatModal = (interaction: any): void =>
{
  interaction.explicit_replied = true;

  const chat_id = report_chat_info.getChatId(interaction.customId);
  if(chat_id === undefined)
  {
    return;
  }

  chat_cache.insertChatCache(chat_id, interaction.message.content);

  const report_chat_modal = cloneDeep(modal_chat_report);
  report_chat_modal.setCustomId(`modal_chat_report_${chat_id}`); //chat_id가 아닌 customId 그대로

  interaction.showModal(report_chat_modal);
};

const submitReportChatModal = (interaction: any): void =>
{
  interaction.explicit_replied = true;

  const chat_id = report_chat_info.getChatId(interaction.customId);
  const content = chat_cache.getChatCacheContent(chat_id);
  const chat_info = report_chat_info.extractChatInfo(chat_id);
  if(chat_info === undefined || content === undefined)
  {
    //채팅 캐시는 5분 뒤 만료됨(chat_cache.js) - 그 사이 신고 버튼을 누르지 않고 방치하면 여기로 옴
    interaction.reply({content: `\`\`\`🔸 신고에 실패했습니다. (신고 가능 시간이 지났어요)\n신고할 메시지에 다시 신고 버튼을 눌러 시도해주세요.\`\`\``, flags: MessageFlags.Ephemeral});
    return;
  }

  const sender_id = chat_info.user_id;
  const reporter_id = interaction.user.id;
  const report_detail = interaction.fields.getTextInputValue('txt_input_report_detail');
  const result = 0;
  const report_type = report_chat_info.REPORT_PROCESSED_RESULT_TYPE.IN_PROGRESS;

  interaction.reply({content: `\`\`\`🔸 신고가 접수되었습니다. 감사합니다.\n🔸 관리자가 검토 후 처리하며, 처리 결과는 개별로 안내드리지 않는 점 양해 부탁드려요.\`\`\``, flags: MessageFlags.Ephemeral});

  db_manager.insertChatInfo(report_chat_info.chat_info_key_fields, [chat_id, content, sender_id, result]);
  db_manager.insertReportInfo(report_chat_info.report_info_key_fields, [chat_id, reporter_id, report_detail, report_type]);

  logger.info(`${sender_id} Reported Message ${content}`);

  if(PRIVATE_CONFIG.ADMIN_ID)
  {
    report_state.getClient().users.fetch(PRIVATE_CONFIG.ADMIN_ID).then((instance: any) =>
    {
      if (instance)
      {
        instance.send(`\`\`\`새로운 신고가 접수되었습니다.\`\`\``);
      }
    });
  }
};

module.exports = { requestReportChatModal, submitReportChatModal };
