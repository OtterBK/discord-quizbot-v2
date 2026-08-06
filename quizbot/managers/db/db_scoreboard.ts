'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//글로벌 스코어보드 관련 쿼리 (원본 //#region 스코어보드 관련).
//로직/주석은 원본과 동일 (동작 변경 없음).

const db_core = require('./db_core');

//#region 스코어보드 관련

exports.selectGlobalScoreboard = async (guild_id: string): Promise<any> =>
{
  const query_string =
  `SELECT *
    FROM tb_global_scoreboard
    WHERE guild_id = $1`;

  return db_core.sendQuery(query_string, [guild_id]);
};

exports.updateGlobalScoreboard = async (guild_id: string, win_add: number, lose_add: number, play_add: number, mmr_add: number, guild_name: string): Promise<any> =>
{
  const query_string =
  `
  INSERT INTO tb_global_scoreboard (guild_id, win, lose, play, mmr, guild_name)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (guild_id)
  DO UPDATE SET
      win = tb_global_scoreboard.win + EXCLUDED.win,
      lose = tb_global_scoreboard.lose + EXCLUDED.lose,
      play = tb_global_scoreboard.play + EXCLUDED.play,
      mmr = GREATEST(tb_global_scoreboard.mmr + EXCLUDED.mmr, 0),
      guild_name = CASE WHEN EXCLUDED.guild_name <> '' THEN EXCLUDED.guild_name ELSE tb_global_scoreboard.guild_name END;

  `;

  return db_core.sendQuery(query_string, [guild_id, win_add, lose_add, play_add, mmr_add, guild_name]);
};

exports.selectTop10Scoreboard = async (): Promise<any> =>
{
  const query_string =
  `
    SELECT *
    FROM tb_global_scoreboard
    WHERE mmr != 0
    ORDER BY mmr DESC
    LIMIT 10;
  `;

  return db_core.sendQuery(query_string);

};
//#endregion
