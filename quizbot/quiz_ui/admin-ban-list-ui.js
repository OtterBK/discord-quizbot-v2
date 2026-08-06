'use strict';

//#region 필요한 외부 모듈
const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const ban_manager = require('../managers/ban_manager');
const {
  only_back_comp,
  admin_ban_unban_confirm_comp,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

//#endregion

const BAN_LIST_SELECT_CUSTOM_ID = 'admin_ban_list_select';

//Discord StringSelectMenu는 옵션을 최대 25개까지만 지원함 - 밴이 25개를 넘으면
//이 화면에서 전부 보이지 않음(페이지네이션은 이번 범위 밖).
const MAX_SELECT_OPTIONS = 25;

/** 관리자 전용: 밴 목록 조회/해제 UI */
class AdminBanListUI extends QuizbotUI
{
  constructor()
  {
    super();

    this.initializeEmbed();
    this.initializeComponents();
  }

  initializeEmbed()
  {
    const banned_id_list = ban_manager.getBannedIdList();

    //Discord select는 25개까지만 보여줄 수 있어서, 실제 전체 개수와 화면에 보이는 개수가
    //다를 수 있다는 걸 안내에 명시함(이전엔 전체 개수만 보여줘서 혼란 가능)
    const count_notice = banned_id_list.length > MAX_SELECT_OPTIONS
      ? `현재 ${banned_id_list.length}개의 ID가 밴되어 있습니다. (목록에는 최대 ${MAX_SELECT_OPTIONS}개까지만 표시됩니다)`
      : `현재 ${banned_id_list.length}개의 ID가 밴되어 있습니다.`;

    this.embed = {
      color: 0x8B0000,
      title: `🚫 밴 목록 관리`,
      description: `${count_notice}\n해제할 ID를 선택하세요.`,
    };
  }

  initializeComponents()
  {
    const banned_id_list = ban_manager.getBannedIdList();

    const ban_list_select_menu = new StringSelectMenuBuilder()
      .setCustomId(BAN_LIST_SELECT_CUSTOM_ID)
      .setPlaceholder('해제할 ID 선택하기');

    if(banned_id_list.length === 0)
    {
      ban_list_select_menu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('밴 목록이 비어있습니다.')
          .setValue('admin_ban_list_empty'),
      );
      ban_list_select_menu.setDisabled(true);
    }
    else
    {
      for(const banned_id of banned_id_list.slice(0, MAX_SELECT_OPTIONS))
      {
        ban_list_select_menu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(banned_id)
            .setValue(banned_id),
        );
      }
    }

    const ban_list_select_row = new ActionRowBuilder()
      .addComponents(ban_list_select_menu);

    this.components = [ ban_list_select_row, only_back_comp ];
  }

  refreshList()
  {
    this.initializeEmbed();
    this.initializeComponents();
    this.update();
  }

  onInteractionCreate(interaction)
  {
    if(interaction.isStringSelectMenu() && interaction.customId === BAN_LIST_SELECT_CUSTOM_ID)
    {
      return this.requestUnban(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_ban_unban_confirmed')
    {
      return this.confirmUnban(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_ban_unban_cancel')
    {
      return this.cancelUnban(interaction);
    }
  }

  requestUnban(interaction) //선택 즉시 해제하지 않고 확인 절차부터 거침(오클릭 방지)
  {
    const selected_id = interaction.values[0];
    if(selected_id === 'admin_ban_list_empty')
    {
      return;
    }

    this.pending_unban_id = selected_id; //확인/취소 버튼 클릭 시 참조

    interaction.explicit_replied = true;
    interaction.reply({
      content: `\`\`\`🚫 정말 [ ${selected_id} ] 밴을 해제하시겠습니까?\`\`\``,
      components: [admin_ban_unban_confirm_comp],
      flags: MessageFlags.Ephemeral,
    });
  }

  confirmUnban(interaction)
  {
    const selected_id = this.pending_unban_id;
    if(selected_id === undefined)
    {
      interaction.explicit_replied = true;
      interaction.reply({ content: `\`\`\`🚫 이미 처리됐거나 만료된 요청입니다.\`\`\``, flags: MessageFlags.Ephemeral });
      return;
    }
    this.pending_unban_id = undefined;

    ban_manager.unbanId(selected_id);
    this.refreshList();

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🚫 [ ${selected_id} ] 밴을 해제했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }

  cancelUnban(interaction)
  {
    this.pending_unban_id = undefined;
    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`🚫 해제를 취소했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { AdminBanListUI };
