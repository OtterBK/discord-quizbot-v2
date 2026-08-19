'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const db_manager = require('../managers/db_manager.js');
const scoreboard_season_manager = require('../managers/scoreboard_season_manager');
const {
  only_back_comp,
  admin_season_end_btn_comp,
  admin_season_end_confirm_comp,
  modal_new_season_name,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");
//#endregion

/** 관리자 전용: 스코어보드 시즌 관리 UI (AdminPanelUI에서 진입, 2026-08-15 신설,
 * docs/plans/SCOREBOARD_SEASON_PLAN.md). "시즌 종료"는 현재 tb_global_scoreboard를 스냅샷으로 아카이브한
 * 뒤 초기화하는 되돌리기 어려운 동작이라, 확인 절차 → 새 시즌 이름 입력 모달 순으로 신중하게 구성. */
class AdminSeasonUI extends QuizbotUI
{
  constructor()
  {
    super();

    this.initializeEmbed();
    this.components = [ admin_season_end_btn_comp, only_back_comp ];

    this.loadSeasonInfo();
  }

  initializeEmbed()
  {
    this.embed = {
      color: 0xFED049,
      title: `🏆 시즌 관리`,
      description: `불러오는 중...`,
    };
  }

  async loadSeasonInfo()
  {
    const current_season_name = scoreboard_season_manager.getCurrentSeasonName(SYSTEM_CONFIG.CURRENT_SEASON_NAME_PATH);

    const season_list_result = await db_manager.selectSeasonList();
    const ended_season_count = season_list_result?.rows?.length ?? 0;

    this.embed.description =
      `현재 시즌: **${current_season_name}**\n`
      + `지금까지 종료된 시즌: ${ended_season_count}개\n\n`
      + `"시즌 종료"를 누르면 현재 스코어보드가 지난 시즌으로 보관되고, 새 시즌 이름을 입력받아 바로\n`
      + `초기화됩니다 — 되돌릴 수 없는 작업이니 신중하게 진행하세요.`;

    this.update();
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isButton() && interaction.customId === 'admin_season_end_request')
    {
      return this.requestEndSeason(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_season_end_confirmed')
    {
      return this.confirmEndSeason(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_season_end_cancel')
    {
      return this.cancelEndSeason(interaction);
    }

    if(interaction.isModalSubmit() && interaction.customId === 'modal_new_season_name')
    {
      this.handleNewSeasonName(interaction); //fire-and-forget - async라 반환하면 Promise가 new_ui로 취급돼 appendNewUI가 깨짐
      return;
    }
  }

  requestEndSeason(interaction: any) //바로 끝내지 않고 확인 절차부터 거침(오클릭 방지 - 파급력이 큰 기능)
  {
    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🏆 정말 현재 시즌을 종료하시겠습니까? 현재 스코어보드는 초기화되고 지난 시즌으로 보관됩니다.\`\`\``,
      components: [admin_season_end_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmEndSeason(interaction: any) //확인 즉시 새 시즌 이름을 입력받는 모달을 띄움(이 버튼 인터랙션 자체가 모달 응답이 됨)
  {
    interaction.explicit_replied = true;
    interaction.showModal(modal_new_season_name);
  }

  async handleNewSeasonName(interaction: any)
  {
    const new_season_name = interaction.fields.getTextInputValue('txt_input_new_season_name');

    const result = await scoreboard_season_manager.endSeasonAndStartNew(SYSTEM_CONFIG.CURRENT_SEASON_NAME_PATH, new_season_name, `${interaction.user.tag}(${interaction.user.id})`);

    interaction.explicit_replied = true;

    if(result === undefined)
    {
      interaction.reply({ content: `\`\`\`🏆 시즌 종료에 실패했습니다. DB 연결 상태를 확인해주세요(로그 참고).\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }

    this.loadSeasonInfo();
    interaction.reply({ content: `\`\`\`🏆 시즌을 종료하고 "${new_season_name}"을(를) 시작했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  cancelEndSeason(interaction: any)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🏆 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { AdminSeasonUI };
