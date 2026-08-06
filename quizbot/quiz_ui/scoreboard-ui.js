'use strict';

//#region 필요한 외부 모듈

//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const db_manager = require('../managers/db_manager.js');

const {
  only_back_comp,
} = require("./components");

const { 
  QuizbotUI,
} = require("./common-ui.js");

//#endregion

/** 단순 순위표 표시 UI */
class ScoreboardUI extends QuizbotUI
{
  constructor(guild)
  {
    super();

    this.guild = guild;

    this.initializeEmbed();

    this.loadScoreboard();
  }

  initializeEmbed() 
  {
    this.embed = {
      color: 0xFED049,
      title: `🎖 순위표 [베타 시즌]`,
      description: `데이터를 불러오는 중 잠시만 기다려주세요...`,
      footer: { //내 이름 표시
        text: `${this.guild.name ?? this.guild.id}`,
        icon_url: `${this.guild.iconURL() ?? ''}`,
      },
      timestamp: new Date().toISOString(),
    };

    this.components = [only_back_comp]; //여기서는 component를 바꿔서 해주자
  }

  async loadScoreboard()
  {
    let my_scoreboard = 
    {
      guild_id: this.guild.id,
      win: 0,
      lose: 0,
      play: 0,
      mmr: 0,
      guild_name: this.guild.name,
    };

    const my_scoreboard_result = await db_manager.selectGlobalScoreboard(this.guild.id);
    if(my_scoreboard_result !== undefined && my_scoreboard_result.rowCount !== 0)
    {
      my_scoreboard = my_scoreboard_result.rows[0];
    }

    let description = `⭐ ${this.guild.name ?? this.guild.id} 서버의 현 시즌 전적\n`
      + `🔸) ${my_scoreboard.win}승 ${my_scoreboard.lose}패. MMR: ${my_scoreboard.mmr}\n\n\n`;

    const top_scoreboard_result = await db_manager.selectTop10Scoreboard();
    if(top_scoreboard_result === undefined || top_scoreboard_result.rowCount === 0)
    {
      description = `순위 데이터를 불러오지 못했습니다.`;

      this.embed.description = description;
      this.update(); //이 분기에서 update()를 안 불러서 "불러오는 중..." 화면에 멈춰있던 버그 수정
      return;
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

    this.embed.description = description;

    this.update();
  }
}

module.exports = { ScoreboardUI };