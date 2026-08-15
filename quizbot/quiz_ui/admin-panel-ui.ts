'use strict';

//#region 로컬 modules
const {
  admin_panel_comp,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

const report_manual_processing = require('../managers/report/report_manual_processing');
const { UserQuizListUI } = require("./user-quiz-list-ui");
const { AdminBanListUI } = require("./admin-ban-list-ui");
const { AdminNoticeListUI } = require("./admin-notice-list-ui");

//#endregion

/** 관리자 전용 메인 패널 (진입은 bot.js의 quiz_manager_panel_handler에서 어드민 여부를 확인한 뒤에만 됨) */
class AdminPanelUI extends QuizbotUI
{
  constructor()
  {
    super();

    this.initializeEmbed();
    this.initializeComponents();
  }

  initializeEmbed()
  {
    this.embed = {
      color: 0x2C2F33,
      title: `🛠 관리자 패널`,
      description: `원하는 작업을 선택하세요.`,
    };
  }

  initializeComponents()
  {
    this.components = [ admin_panel_comp ];
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isButton() === false)
    {
      return;
    }

    if(interaction.customId === 'admin_panel_ban_list')
    {
      return new AdminBanListUI();
    }

    if(interaction.customId === 'admin_panel_report')
    {
      report_manual_processing.sendReportLog(interaction); //자체적으로 응답까지 처리함
      return;
    }

    if(interaction.customId === 'admin_panel_quiz_manage')
    {
      return new UserQuizListUI(interaction.user, true); //전체 유저 퀴즈 조회 모드
    }

    if(interaction.customId === 'admin_panel_notice_manage')
    {
      return new AdminNoticeListUI();
    }
  }
}

module.exports = { AdminPanelUI };
