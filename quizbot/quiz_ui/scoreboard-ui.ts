'use strict';

//#region 필요한 외부 모듈
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
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

//TOP50을 한 화면에 다 욱여넣기엔 embed description이 부담스러워(사용자 요청, 2026-08-15) 페이지당 10개씩
//prev/next 버튼으로 넘겨봄 - QuizBotControlComponentUI(번호 select 버튼 포함, 선택 가능한 목록 전용)는
//이 화면(클릭 불가한 순수 표시용 랭킹)엔 안 맞아서 가져다 쓰지 않고 최소한의 자체 페이지네이션만 둠.
const TOP_SCOREBOARD_PAGE_SIZE = 10;

/** 순위표 표시 UI - 현재 시즌(tb_global_scoreboard) + 지난 시즌(tb_global_scoreboard_archive, 2026-08-15
 * 신설) 전환 지원. 지난 시즌이 하나도 없으면 select 메뉴 자체를 안 보여줌(단순함 유지). */
class ScoreboardUI extends QuizbotUI
{
  guild: any;
  season_list: any[];
  selected_season_id: number | null; //null = 현재 시즌
  top_scoreboard_rows: any[]; //최대 50개, 페이지네이션은 클라이언트(이 UI) 사이드에서 슬라이스
  top_scoreboard_failed: boolean;
  top_page: number; //0-indexed
  my_scoreboard_description: string;

  constructor(guild: any)
  {
    super();

    this.guild = guild;
    this.season_list = [];
    this.selected_season_id = null;
    this.top_scoreboard_rows = [];
    this.top_scoreboard_failed = false;
    this.top_page = 0;
    this.my_scoreboard_description = '';

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
    const rows = [];

    if(this.season_list.length > 0) //지난 시즌이 없으면 select 자체를 안 보여줌
    {
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

      rows.push(new ActionRowBuilder().addComponents(season_select_menu));
    }

    if(this.top_scoreboard_rows.length > TOP_SCOREBOARD_PAGE_SIZE) //한 페이지에 다 들어가면 버튼 자체를 안 보여줌
    {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('scoreboard_top_prev')
            .setLabel('◀ 이전 순위')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(this.top_page <= 0),
          new ButtonBuilder()
            .setCustomId('scoreboard_top_next')
            .setLabel('다음 순위 ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled((this.top_page + 1) * TOP_SCOREBOARD_PAGE_SIZE >= this.top_scoreboard_rows.length),
        ),
      );
    }

    rows.push(only_back_comp);
    this.components = rows;
  }

  onInteractionCreate(interaction: any)
  {
    if(interaction.isStringSelectMenu() && interaction.customId === 'scoreboard_season_select')
    {
      const selected_value = interaction.values[0];
      this.selected_season_id = selected_value === 'current' ? null : parseInt(selected_value);
      this.top_page = 0; //시즌을 바꾸면 순위 페이지도 처음으로

      this.embed.description = `데이터를 불러오는 중 잠시만 기다려주세요...`;
      this.rebuildComponents();
      this.loadScoreboard(); //fire-and-forget, 완료되면 내부에서 update() 재호출(생성자와 동일 패턴)

      return this;
    }

    if(interaction.isButton() && interaction.customId === 'scoreboard_top_prev')
    {
      if(this.top_page <= 0)
      {
        return undefined;
      }

      this.top_page -= 1;
      this.renderTopScoreboard();
      this.rebuildComponents();
      return this;
    }

    if(interaction.isButton() && interaction.customId === 'scoreboard_top_next')
    {
      if((this.top_page + 1) * TOP_SCOREBOARD_PAGE_SIZE >= this.top_scoreboard_rows.length)
      {
        return undefined;
      }

      this.top_page += 1;
      this.renderTopScoreboard();
      this.rebuildComponents();
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

    this.my_scoreboard_description = `⭐ ${this.guild.name ?? this.guild.id} 서버의 현 시즌 전적\n`
      + `🔸) ${my_scoreboard.win}승 ${my_scoreboard.lose}패. MMR: ${my_scoreboard.mmr}\n\n\n`;

    const top_scoreboard_result = await db_manager.selectTop50Scoreboard();
    this.applyTopScoreboardResult(top_scoreboard_result);
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

    this.my_scoreboard_description = `⭐ ${this.guild.name ?? this.guild.id} 서버의 그 시즌 전적\n`
      + `🔸) ${my_scoreboard.win}승 ${my_scoreboard.lose}패. MMR: ${my_scoreboard.mmr}\n\n\n`;

    const top_scoreboard_result = await db_manager.selectArchivedTop50Scoreboard(season_id);
    this.applyTopScoreboardResult(top_scoreboard_result);
  }

  applyTopScoreboardResult(top_scoreboard_result: any): void
  {
    this.top_scoreboard_failed = top_scoreboard_result === undefined || top_scoreboard_result.rowCount === 0;
    this.top_scoreboard_rows = this.top_scoreboard_failed ? [] : top_scoreboard_result.rows;
    this.top_page = 0;

    this.renderTopScoreboard();
    this.rebuildComponents();
    this.update();
  }

  //note: top_scoreboard_result가 비어있으면(불러오기 실패 포함) "위 전적 안내" 부분까지 통째로
  //"순위 데이터를 불러오지 못했습니다."로 대체됨 - 리팩터 이전 원본 동작 그대로 유지(2026-08-15 이전에도
  //이 화면에 있던 동작, 이번 시즌/TOP50 기능 추가로 새로 생긴 동작 아님).
  renderTopScoreboard(): void
  {
    if(this.top_scoreboard_failed)
    {
      this.embed.description = `순위 데이터를 불러오지 못했습니다.`;
      return;
    }

    const start = this.top_page * TOP_SCOREBOARD_PAGE_SIZE;
    const page_rows = this.top_scoreboard_rows.slice(start, start + TOP_SCOREBOARD_PAGE_SIZE);

    let description = this.my_scoreboard_description;
    for(let i = 0; i < page_rows.length; ++i)
    {
      const rank = start + i + 1;
      const scoreboard = page_rows[i];

      if(rank === 1)
      {
        description += `🥇) `;
      }
      else if(rank === 2)
      {
        description += `🥈) `;
      }
      else if(rank === 3)
      {
        description += `🥉) `;
      }
      else
      {
        description += `${rank}) `;
      }

      description += `${scoreboard.guild_name}\n🔸) ${scoreboard.win}승 ${scoreboard.lose}패. MMR: ${scoreboard.mmr}\n\n`;
    }

    this.embed.description = description;
  }
}

module.exports = { ScoreboardUI };
