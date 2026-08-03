'use strict';

//multiplayer_manager.js에서 분리 (REFACTOR_PLAN.md Phase 3)
//서버(길드) 하나의 멀티플레이 참가 상태를 나타내는 클래스.
//로직/주석은 원본과 동일 (동작 변경 없음).

const logger = require('../../utility/logger.js')('MultiplayerManager');
const db_manager = require('./db_manager.js');

class MultiplayerGuildInfo
{
  constructor(guild_id, guild_name)
  {
    this.guild_id = guild_id;
    this.guild_name = guild_name;

    this.ready = false;

    this.syncing = false;

    this.hint = false;
    this.skip = false;

    this.stat = {
      win: 0,
      lose: 0,
      play: 0,
      mmr: 0,
    };

    this.member_count = 0;
  }

  toJsonObject()
  {
    return {
      guild_id: this.guild_id,
      guild_name: this.guild_name,
      member_count: this.member_count,
      stat: this.stat,
      ready: this.ready,
    };
  }

  isSyncing()
  {
    return this.syncing;
  }

  setSyncState(value)
  {
    this.syncing = value;
  }

  isHintRequested()
  {
    return this.hint;
  }

  requestHint()
  {
    if(this.hint === true)
    {
      return false;
    }

    this.hint = true;
    return true;
  }

  isSkipRequested()
  {
    return this.skip;
  }

  requestSkip()
  {
    if(this.skip === true)
    {
      return false;
    }

    this.skip = true;
    return true;
  }

  resetRequestState()
  {
    this.hint = false;
    this.skip = false;
  }

  setGuildState(guild_state)
  {
    if(guild_state === undefined)
    {
      return;
    }

    this.member_count = guild_state.member_count ?? 0;
  }

  getMemberCount()
  {
    return this.member_count;
  }

  async loadStat()
  {
    try
    {
      const scoreboard_info_result = await db_manager.selectGlobalScoreboard(this.guild_id);
      
      if(scoreboard_info_result === undefined || scoreboard_info_result.rowCount === 0)
      {
        return this;
      }

      const scoreboard_info = scoreboard_info_result.rows[0];

      this.stat = {
        win: scoreboard_info.win,
        lose: scoreboard_info.lose,
        play: scoreboard_info.play,
        mmr: scoreboard_info.mmr,
      };

      logger.info(`Load Stat. guild_id: ${this.guild_id}. win: ${this.stat.win} / lose: ${this.stat.lose} / mmr: ${this.stat.mmr}`);
    }
    catch(err)
    {
      logger.info(`Failed to load Stat. guild_id: ${this.guild_id}. err: ${err}`);
      return undefined;
    }

    return this;
    
  }

  setReady(value)
  {
    return this.ready = value;
  }

  isReady()
  {
    return this.ready;
  }
}

module.exports = MultiplayerGuildInfo;
