'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');
const cloneDeep = require('lodash/cloneDeep.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const maintenance_mode_manager = require('../managers/maintenance_mode_manager');
const {
  only_back_comp,
  admin_maintenance_enable_btn_comp,
  admin_maintenance_manage_comp,
  admin_maintenance_disable_confirm_comp,
  modal_maintenance_notice,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");
//#endregion

/** 관리자 전용: 점검 모드 켜기/끄기/문구 수정 UI (AdminPanelUI에서 진입)
 * 점검 모드가 켜지면 관리자 외 전 유저의 인터랙션이 막히므로(bot.js 전역 핸들러), 신중하게 다뤄야 함 -
 * 켜기/끄기 둘 다 문구 입력 또는 확인 절차를 거치도록 구성(오클릭 방지). */
class AdminMaintenanceUI extends QuizbotUI
{
  constructor()
  {
    super();

    this.initializeEmbed();
    this.initializeComponents();
  }

  initializeEmbed()
  {
    const is_on = maintenance_mode_manager.isMaintenanceModeOn(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH);

    if(is_on)
    {
      const notice = maintenance_mode_manager.getMaintenanceNotice(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH);
      this.embed = {
        color: 0xC43B3B,
        title: `🔴 점검 모드 - 켜짐`,
        description: `현재 점검 모드가 켜져 있습니다. 관리자 외 모든 유저는 명령어/버튼을 사용할 수 없고, 아래 문구만 보게 됩니다.\n\n**안내 문구**\n${notice}`,
      };
      return;
    }

    this.embed = {
      color: 0x2F8F4E,
      title: `🟢 점검 모드 - 꺼짐`,
      description: `현재 점검 모드가 꺼져 있습니다. 모든 유저가 정상적으로 봇을 사용할 수 있습니다.`,
    };
  }

  initializeComponents()
  {
    const is_on = maintenance_mode_manager.isMaintenanceModeOn(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH);

    this.components = is_on
      ? [ admin_maintenance_manage_comp, only_back_comp ]
      : [ admin_maintenance_enable_btn_comp, only_back_comp ];
  }

  refreshStatus()
  {
    this.initializeEmbed();
    this.initializeComponents();
    this.update();
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isButton() && interaction.customId === 'admin_maintenance_enable_request')
    {
      return this.requestEnableModal(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_maintenance_edit_request')
    {
      return this.requestEditModal(interaction);
    }

    if(interaction.isModalSubmit() && interaction.customId === 'modal_maintenance_notice')
    {
      return this.handleModalSubmit(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_maintenance_disable_request')
    {
      return this.requestDisable(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_maintenance_disable_confirmed')
    {
      return this.confirmDisable(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_maintenance_disable_cancel')
    {
      return this.cancelDisable(interaction);
    }
  }

  requestEnableModal(interaction: any)
  {
    interaction.explicit_replied = true;
    interaction.showModal(modal_maintenance_notice);
  }

  requestEditModal(interaction: any) //켜진 상태에서 문구만 다시 수정 (기존 문구 프리필)
  {
    const current_notice = maintenance_mode_manager.getMaintenanceNotice(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH);

    const modal_current = cloneDeep(modal_maintenance_notice);
    modal_current.components[0].components[0].setValue(current_notice);

    interaction.explicit_replied = true;
    interaction.showModal(modal_current);
  }

  handleModalSubmit(interaction: any) //켜기/문구 수정 공용 - 둘 다 파일에 그대로 덮어쓰면 됨
  {
    const content = interaction.fields.getTextInputValue('txt_input_maintenance_notice');

    maintenance_mode_manager.enableMaintenanceMode(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH, content, `${interaction.user.tag}(${interaction.user.id})`);
    this.refreshStatus();

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🔧 점검 모드 문구를 저장했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  requestDisable(interaction: any) //바로 끄지 않고 확인 절차부터 거침(오클릭 방지 - 파급력이 큰 기능)
  {
    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🔧 정말 점검 모드를 끄시겠습니까?\`\`\``,
      components: [admin_maintenance_disable_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmDisable(interaction: any)
  {
    maintenance_mode_manager.disableMaintenanceMode(SYSTEM_CONFIG.MAINTENANCE_NOTICE_PATH, `${interaction.user.tag}(${interaction.user.id})`);
    this.refreshStatus();

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🔧 점검 모드를 껐습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  cancelDisable(interaction: any)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🔧 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { AdminMaintenanceUI };
