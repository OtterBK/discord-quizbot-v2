'use strict';

//#region 필요한 외부 모듈
const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, MessageFlags } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const notice_manager = require('../managers/notice_manager');
const {
  only_back_comp,
  admin_notice_create_btn_comp,
  modal_notice_create,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

const { AdminNoticeDetailUI } = require("./admin-notice-detail-ui");
//#endregion

const NOTICE_LIST_SELECT_CUSTOM_ID = 'admin_notice_list_select';

//Discord StringSelectMenu는 옵션을 최대 25개까지만 지원함(AdminBanListUI와 동일 제약) -
//공지 개수가 25개를 넘으면 이 화면에서 전부 보이지 않음(페이지네이션은 이번 범위 밖, 실사용상 그 정도로
//공지가 쌓일 가능성은 낮다고 판단).
const MAX_SELECT_OPTIONS = 25;

/** 관리자 전용: 공지 작성/목록 UI (AdminPanelUI에서 진입) */
class AdminNoticeListUI extends QuizbotUI
{
  constructor()
  {
    super();

    this.notice_list = [];

    this.initializeEmbed();
    this.initializeComponents();
    this.loadList();
  }

  initializeEmbed()
  {
    this.embed = {
      color: 0x87CEEB,
      title: `📢 공지사항 관리`,
      description: `불러오는 중...`,
    };
  }

  initializeComponents()
  {
    this.components = [ only_back_comp ];
  }

  loadList()
  {
    notice_manager.loadNoticeList(SYSTEM_CONFIG.NOTICES_PATH)
      .then((list: any[]) =>
      {
        this.notice_list = list;
        this.refreshList();
      });
  }

  onAwaked() //공지 상세 화면에서 뒤로가기(작성/수정/삭제 후 포함)로 돌아왔을 때 목록 재조회
  {
    this.loadList();
  }

  refreshList()
  {
    const count_notice = this.notice_list.length > MAX_SELECT_OPTIONS
      ? `현재 ${this.notice_list.length}개의 공지가 있습니다. (목록에는 최대 ${MAX_SELECT_OPTIONS}개까지만 표시됩니다)`
      : `현재 ${this.notice_list.length}개의 공지가 있습니다.`;

    this.embed.description = this.notice_list.length === 0
      ? `등록된 공지가 없습니다.`
      : `${count_notice}\n관리할 공지를 선택하세요.`;

    const notice_list_select_menu = new StringSelectMenuBuilder()
      .setCustomId(NOTICE_LIST_SELECT_CUSTOM_ID)
      .setPlaceholder('관리할 공지 선택하기');

    if(this.notice_list.length === 0)
    {
      notice_list_select_menu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('등록된 공지가 없습니다.')
          .setValue('admin_notice_list_empty'),
      );
      notice_list_select_menu.setDisabled(true);
    }
    else
    {
      for(const notice of this.notice_list.slice(0, MAX_SELECT_OPTIONS))
      {
        notice_list_select_menu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(notice['name'].slice(0, 100))
            .setValue(notice['file_name']),
        );
      }
    }

    const notice_list_select_row = new ActionRowBuilder()
      .addComponents(notice_list_select_menu);

    this.components = [ notice_list_select_row, admin_notice_create_btn_comp, only_back_comp ];
    this.update();
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isStringSelectMenu() && interaction.customId === NOTICE_LIST_SELECT_CUSTOM_ID)
    {
      return this.handleSelectNotice(interaction);
    }

    if(interaction.isButton() && interaction.customId === 'admin_notice_create_request')
    {
      interaction.explicit_replied = true;
      interaction.showModal(modal_notice_create);
      return undefined;
    }

    if(interaction.isModalSubmit() && interaction.customId === 'modal_notice_create')
    {
      return this.handleCreateNotice(interaction);
    }
  }

  handleSelectNotice(interaction: any)
  {
    const selected_file_name = interaction.values[0];
    if(selected_file_name === 'admin_notice_list_empty')
    {
      return undefined;
    }

    const notice_info = this.notice_list.find((n: any) => n['file_name'] === selected_file_name);
    if(notice_info === undefined) //선택 사이에 다른 곳에서 삭제됐을 수 있음(드문 경합)
    {
      return undefined;
    }

    return new AdminNoticeDetailUI(notice_info);
  }

  handleCreateNotice(interaction: any)
  {
    const title = interaction.fields.getTextInputValue('txt_input_notice_title');
    const content = interaction.fields.getTextInputValue('txt_input_notice_content');

    notice_manager.writeNoticeFile(SYSTEM_CONFIG.NOTICES_PATH, title, content);
    this.loadList();

    interaction.explicit_replied = true;
    interaction.reply({ content: `\`\`\`📢 공지를 작성했습니다.\`\`\``, flags: MessageFlags.Ephemeral });
  }
}

module.exports = { AdminNoticeListUI };
