'use strict';

//#region 필요한 외부 모듈
const { MessageFlags } = require('discord.js');
const cloneDeep = require('lodash/cloneDeep.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const notice_manager = require('../managers/notice_manager');
const {
  only_back_comp,
  admin_notice_manage_comp,
  admin_notice_delete_confirm_comp,
  modal_notice_edit,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");
//#endregion

/** 관리자 전용: 공지 상세/수정/삭제 UI (AdminNoticeListUI에서 진입) */
class AdminNoticeDetailUI extends QuizbotUI
{
  constructor(notice_info: any)
  {
    super();

    this.notice_info = notice_info;

    this.initializeEmbed();
    this.initializeComponents();
  }

  initializeEmbed()
  {
    const { content, mtime } = notice_manager.readNoticeFile(this.notice_info['note_path']);

    this.embed = {
      color: 0xFED049,
      title: `📢 ${this.notice_info['name']}`,
      description: content,
      timestamp: new Date(mtime).toISOString(),
    };
  }

  initializeComponents()
  {
    this.components = [ admin_notice_manage_comp, only_back_comp ];
  }

  refreshDetail()
  {
    this.initializeEmbed();
    this.update();
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isButton() && interaction.customId === 'admin_notice_edit_request')
    {
      return this.requestEditModal(interaction);
    }

    if(interaction.isModalSubmit() && interaction.customId === 'modal_notice_edit')
    {
      return this.handleEditNotice(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_notice_delete_request')
    {
      return this.requestDelete(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_notice_delete_confirmed')
    {
      return this.confirmDelete(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_notice_delete_cancel')
    {
      return this.cancelDelete(interaction);
    }
  }

  requestEditModal(interaction: any)
  {
    const { content } = notice_manager.readNoticeFile(this.notice_info['note_path']);

    const modal_current_notice_edit = cloneDeep(modal_notice_edit);
    modal_current_notice_edit.components[0].components[0].setValue(this.notice_info['name']);
    modal_current_notice_edit.components[1].components[0].setValue(content);

    interaction.explicit_replied = true;
    interaction.showModal(modal_current_notice_edit);
  }

  handleEditNotice(interaction: any)
  {
    const title = interaction.fields.getTextInputValue('txt_input_notice_title');
    const content = interaction.fields.getTextInputValue('txt_input_notice_content');

    this.notice_info = notice_manager.updateNoticeFile(SYSTEM_CONFIG.NOTICES_PATH, this.notice_info['file_name'], title, content, `${interaction.user.tag}(${interaction.user.id})`);
    this.refreshDetail();

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`📢 공지를 수정했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  requestDelete(interaction: any) //바로 삭제하지 않고 확인 절차부터 거침(AdminBanListUI의 밴 해제와 동일 패턴, 오클릭 방지)
  {
    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`📢 정말 [ ${this.notice_info['name']} ] 공지를 삭제하시겠습니까?\`\`\``,
      components: [admin_notice_delete_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmDelete(interaction: any)
  {
    notice_manager.deleteNoticeFile(this.notice_info['note_path'], `${interaction.user.tag}(${interaction.user.id})`);

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`📢 공지를 삭제했습니다.\`\`\``, flags: MessageFlags.Ephemeral });

    this.goToBack(); //목록 화면(AdminNoticeListUI)이 onAwaked()에서 목록을 다시 불러옴
  }

  cancelDelete(interaction: any)
  {
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`📢 삭제를 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { AdminNoticeDetailUI };
