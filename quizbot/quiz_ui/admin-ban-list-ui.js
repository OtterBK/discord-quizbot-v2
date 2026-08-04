'use strict';

//#region 필요한 외부 모듈
const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
//#endregion

//#region 로컬 modules
const ban_manager = require('../managers/ban_manager.js');
const {
  only_back_comp,
} = require("./components.js");

const {
  QuizbotUI,
} = require("./common-ui.js");

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

    this.embed = {
      color: 0x8B0000,
      title: `🚫 밴 목록 관리`,
      description: `현재 ${banned_id_list.length}개의 ID가 밴되어 있습니다.\n해제할 ID를 선택하세요.`,
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
    if(interaction.isStringSelectMenu() === false)
    {
      return;
    }

    if(interaction.customId !== BAN_LIST_SELECT_CUSTOM_ID)
    {
      return;
    }

    const selected_id = interaction.values[0];
    if(selected_id === 'admin_ban_list_empty')
    {
      return;
    }

    ban_manager.unbanId(selected_id);

    this.refreshList();
    return this;
  }
}

module.exports = { AdminBanListUI };
