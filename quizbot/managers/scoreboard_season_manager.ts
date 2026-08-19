'use strict';

//스코어보드 시즌 관리(quizmgr 관리자 패널, 2026-08-15 신설, docs/plans/SCOREBOARD_SEASON_PLAN.md).
//"현재 시즌 이름"은 파일(resources/current_season_name.txt, current_notice.txt/maintenance_notice.txt와
//동일 패턴)로 관리해 재배포 없이 quizmgr에서 바로 바꿀 수 있게 하고, "시즌 종료"(현재 스코어보드를
//tb_global_scoreboard_archive로 스냅샷 후 초기화)는 db_manager.endCurrentSeason에 위임한다.

const fs = require('fs');
const db_manager = require('./db_manager');
const logger = require('../../utility/logger.js')('ScoreboardSeasonManager');

exports.getCurrentSeasonName = (current_season_name_path: string): string =>
{
  if(fs.existsSync(current_season_name_path) === false)
  {
    return '';
  }

  return fs.readFileSync(current_season_name_path, { encoding: 'utf8', flag: 'r' }).trim();
};

exports.setCurrentSeasonName = (current_season_name_path: string, season_name: string): void =>
{
  fs.writeFileSync(current_season_name_path, season_name, { encoding: 'utf8' });
};

//시즌 종료 + 새 시즌 시작을 한 동작으로 묶는다("시즌 종료" 버튼 한 번으로 완결) - 현재 파일에 적힌
//이름으로 아카이브하고, 성공하면 새 이름을 그 자리에 이어서 저장한다. 되돌릴 수 없는 DB 작업이라
//성공/실패 둘 다 로깅(2026-08-19 로깅 감사로 추가) - actor는 호출부(admin-season-ui.ts)가
//interaction.user 기준으로 넘겨주는 선택값.
exports.endSeasonAndStartNew = async (current_season_name_path: string, new_season_name: string, actor?: string): Promise<any> =>
{
  const ended_season_name = exports.getCurrentSeasonName(current_season_name_path);

  const result = await db_manager.endCurrentSeason(ended_season_name);
  if(result == undefined)
  {
    logger.warn(`시즌 종료 실패: "${ended_season_name}" → "${new_season_name}"${actor ? ` by ${actor}` : ''}`);
    return undefined;
  }

  exports.setCurrentSeasonName(current_season_name_path, new_season_name);
  logger.info(`시즌 종료: "${ended_season_name}" → "${new_season_name}"${actor ? ` by ${actor}` : ''}`);
  return result;
};
