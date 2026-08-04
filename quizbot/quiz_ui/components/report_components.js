'use strict';

//components.js에서 분리 (REFACTOR_PLAN.md Phase 4)
//채팅 신고 관련 컴포넌트.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

//#region 신고 관련

const modal_chat_report = new ModalBuilder()
  .setCustomId('modal_chat_report_')
  .setTitle('신고ID')
  .addComponents(
    new ActionRowBuilder()
      .addComponents(
        new TextInputBuilder()
          .setCustomId('txt_input_report_detail')
          .setLabel('신고 사유를 입력해주세요.')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(100)
          .setRequired(true)
          .setPlaceholder('')
      ),
  );

//#endregion

module.exports = {
  modal_chat_report,
};
