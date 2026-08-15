'use strict';

//#region 필요한 외부 모듈
const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const db_manager = require('../managers/db_manager.js');
const scoreboard_season_manager = require('../managers/scoreboard_season_manager');

const {
  only_back_comp,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

//#endregion

//Discord StringSelectMenu는 옵션을 최대 25개까지만 지원함(AdminBanListUI와 동일 제약) - "현재 시즌"
//옵션 1개를 고정으로 쓰므로 과거 시즌은 최대 24개까지만 목록에 보임.
const MAX_SEASON_OPTIONS = 24;

/** 순위표 표시 UI - 현재 시즌(tb_global_scoreboard) + 지난 시즌(tb_global_scoreboard_archive, 2026-08-15
 * 신설) 전환 지원. 지난 시즌이 하나도 없으면 select 메뉴 자체를 안 보여줌(단순함 유지). */
class ScoreboardUI extends QuizbotUI
{
  guild: any;
  season_list: any[];
  selected_season_id: number | null; //null = 현재 시즌

  constructor(guild: any)
  {
    super();

    this.guild = guild;
    this.season_list = [];
    this.selected_season_id = null;

    this.initializeEmbed();
    this.components = [only_back_comp];

    this.loadSeasonListAndScoreboard();
  }

  initializeEmbed()
  {
    this.embed = {
      color: 0xFED049,
      title: `🎖 순위표`,
      description: `데이터를 불러오는 중 잠시만 기다려주세요...`,
      footer: { //내 이름 표시
        text: `${this.guild.name ?? this.guild.id}`,
        icon_url: `${this.guild.iconURL() ?? ''}`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  async loadSeasonListAndScoreboard()
  {
    const season_list_result = await db_manager.selectSeasonList();
    this.season_list = season_list_result?.rows ?? [];

    this.rebuildComponents();
    await this.loadScoreboard();
  }

  rebuildComponents()
  {
    if(this.season_list.length === 0) //지난 시즌이 없으면 select 자체를 안 보여줌
    {
      this.components = [only_back_comp];
      return;
    }

    const season_select_menu = new StringSelectMenuBuilder()
      .setCustomId('scoreboard_season_select')
      .setPlaceholder('시즌 선택');

    season_select_menu.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('현재 시즌')
        .setValue('current')
        .setDefault(this.selected_season_id === null),
    );

    for(const season of this.season_list.slice(0, MAX_SEASON_OPTIONS))
    {
      season_select_menu.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel(season.season_name)
          .setValue(`${season.season_id}`)
          .setDefault(this.selected_season_id === season.season_id),
      );
    }

    const season_select_row = new ActionRowBuilder().addComponents(season_select_menu);
    this.components = [season_select_row, only_back_comp];
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isStringSelectMenu() && interaction.customId === 'scoreboard_season_select')
    {
      const selected_value = interaction.values[0];
      this.selected_season_id = selected_value === 'current' ? null : parseInt(selected_value);

      this.embed.description = `데이터를 불러오는 중 잠시만 기다려주세요...`;
      this.rebuildComponents();
      this.loadScoreboard(); //fire-and-forget, 완료되면 내부에서 update() 재호출(생성자와 동일 패턴)

      return this;
    }
  }

  async loadScoreboard()
  {
    if(this.selected_season_id === null)
    {
      return this.loadCurrentScoreboard();
    }

    return this.loadArchivedScoreboard(this.selected_season_id);
  }

  async loadCurrentScoreboard()
  {
    const season_name = scoreboard_season_manager.getCurrentSeasonName(SYSTEM_CONFIG.CURRENT_SEASON_NAME_PATH);
    this.embed.title = `🎖 순위표 [${season_name}]`;

    let my_scoreboard = { win: 0, lose: 0, mmr: 0 };
    const my_scoreboard_result = await db_manager.selectGlobalScoreboard(this.guild.id);
    if(my_scoreboard_result !== undefined && my_scoreboard_result.rowCount !== 0)
    {
      my_scoreboard = my_scoreboard_result.rows[0];
    }

    const description = `⭐ ${this.guild.name ?? this.guild.id} 서버의 현 시즌 전적\n`
      + `🔸) ${my_scoreboard.win}승 ${my_scoreboard.lose}패. MMR: ${my_scoreboard.mmr}\n\n\n`;

    const top_scoreboard_result = await db_manager.selectTop10Scoreboard();
    this.embed.description = this.buildTopListDescription(description, top_scoreboard_result);

    this.update();
  }

  async loadArchivedScoreboard(season_id: number)
  {
    const season = this.season_list.find((s: any) => s.season_id === season_id);
    this.embed.title = `🎖 순위표 [${season?.season_name ?? '지난 시즌'}]`;

    let my_scoreboard = { win: 0, lose: 0, mmr: 0 };
    const my_scoreboard_result = await db_manager.selectArchivedGuildScoreboard(season_id, this.guild.id);
    if(my_scoreboard_result !== undefined && my_scoreboard_result.rowCount !== 0)
    {
      my_scoreboard = my_scoreboard_result.rows[0];
    }

    const description = `⭐ ${this.guild.name ?? this.guild.id} 서버의 그 시즌 전적\n`
      + `🔸) ${my_scoreboard.win}승 ${my_scoreboard.lose}패. MMR: ${my_scoreboard.mmr}\n\n\n`;

    const top_scoreboard_result = await db_manager.selectArchivedTop50Scoreboard(season_id);
    this.embed.description = this.buildTopListDescription(description, top_scoreboard_result);

    this.update();
  }

  //note: top_scoreboard_result가 비어있으면(불러오기 실패 포함) "위 전적 안내" 부분까지 통째로
  //"순위 데이터를 불러오지 못했습니다."로 대체됨 - 리팩터 이전 원본 동작 그대로 유지(2026-08-15 이전에도
  //이 화면에 있던 동작, 이번 시즌 기능 추가로 새로 생긴 동작 아님).
  buildTopListDescription(description: string, top_scoreboard_result: any): string
  {
    if(top_scoreboard_result === undefined || top_scoreboard_result.rowCount === 0)
    {
      return `순위 데이터를 불러오지 못했습니다.`;
    }

    for(let i = 0; i < top_scoreboard_result.rowCount; ++i)
    {
      const scoreboard = top_scoreboard_result.rows[i];

      if(i === 0)
      {
        description += `🥇) `;
      }
      else if(i === 1)
      {
        description += `🥈) `;
      }
      else if(i === 2)
      {
        description += `🥉) `;
      }
      else
      {
        description += `${text_contents.icon["ICON_NUM_"+(i+1)]}) `;
      }

      description += `${scoreboard.guild_name}\n🔸) ${scoreboard.win}승 ${scoreboard.lose}패. MMR: ${scoreboard.mmr}\n\n`;
    }

    return description;
  }
}

module.exports = { ScoreboardUI };
