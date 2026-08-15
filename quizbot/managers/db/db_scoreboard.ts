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

//#region 시즌 아카이브 관련 (2026-08-15 신설, docs/plans/SCOREBOARD_SEASON_PLAN.md)
//tb_global_scoreboard(위 3개 함수, "현재 시즌")는 그대로 두고 별도 아카이브 테이블로만 과거 시즌을 다룸 -
//updateGlobalScoreboard가 멀티플레이 매치 종료마다 호출되는 핫패스라 리스크를 최소화하기 위함.

exports.selectSeasonList = async (): Promise<any> =>
{
  const query_string =
  `
    SELECT *
    FROM tb_scoreboard_season
    ORDER BY season_id DESC;
  `;

  return db_core.sendQuery(query_string);
};

exports.selectArchivedTop50Scoreboard = async (season_id: number): Promise<any> =>
{
  const query_string =
  `
    SELECT *
    FROM tb_global_scoreboard_archive
    WHERE season_id = $1 AND mmr != 0
    ORDER BY mmr DESC
    LIMIT 50;
  `;

  return db_core.sendQuery(query_string, [season_id]);
};

exports.selectArchivedGuildScoreboard = async (season_id: number, guild_id: string): Promise<any> =>
{
  const query_string =
  `SELECT *
    FROM tb_global_scoreboard_archive
    WHERE season_id = $1 AND guild_id = $2`;

  return db_core.sendQuery(query_string, [season_id, guild_id]);
};

//시즌 종료 - 현재 tb_global_scoreboard를 새 시즌 행 밑으로 스냅샷 복사한 뒤 라이브 테이블을 비운다.
//db_core에 트랜잭션 헬퍼가 없어(db_random_quiz_preset.ts의 insertRandomQuizPreset과 동일 상황) 보상
//로직으로 원자성을 흉내낸다: 아카이브 복사가 실패하면 방금 만든 시즌 행을 정리해 고아 시즌이 안 남게 함.
exports.endCurrentSeason = async (season_name: string): Promise<any> =>
{
  const insert_season_query = `INSERT INTO tb_scoreboard_season (season_name) VALUES ($1) RETURNING season_id`;
  const season_result = await db_core.sendQuery(insert_season_query, [season_name]);
  if(season_result == undefined || season_result.rows.length === 0)
  {
    return undefined;
  }

  const season_id = season_result.rows[0].season_id;

  const archive_query =
  `
    INSERT INTO tb_global_scoreboard_archive (season_id, guild_id, win, lose, play, mmr, guild_name)
    SELECT $1, guild_id, win, lose, play, mmr, guild_name FROM tb_global_scoreboard;
  `;
  const archive_result = await db_core.sendQuery(archive_query, [season_id]);
  if(archive_result == undefined)
  {
    await db_core.sendQuery(`DELETE FROM tb_scoreboard_season WHERE season_id = $1`, [season_id]); //고아 시즌 행 정리
    return undefined;
  }

  await db_core.sendQuery(`DELETE FROM tb_global_scoreboard`);

  return { season_id, season_name };
};
//#endregion
