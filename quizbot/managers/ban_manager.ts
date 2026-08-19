'use strict';

//BANNED_USER_PATH(resources/banned_user.txt)에 있는 밴 목록을 메모리에 캐싱해,
//요청마다 동기 파일 읽기를 하지 않도록 한다.
//원래 multiplayer-quiz-select-ui.js의 checkMultiplayerBan에 있던 개발자 TODO
//("나중에 시간마다 조회하는 방식으로 변경할 것")를 반영한 매니저.
//길드 ID(멀티플레이 밴)와 유저 ID(퀴즈 생성 영구밴)를 모두 같은 목록으로 관리하므로
//(원래 이름이었던 multiplayer_ban_manager에서 이걸 반영해 ban_manager로 리네임)
//isBanned/banId는 특정 타입에 종속되지 않고 문자열 id를 그대로 받는다.

const fs = require('fs');

const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('BanManager');

const REFRESH_INTERVAL = 600000; //10분마다 파일에서 다시 읽어옴 (외부에서 직접 파일을 수정하는 경우 대비)

let banned_id_set: Set<string> = new Set();

const loadBannedIdListFromDisk = (): void =>
{
  if(!fs.existsSync(SYSTEM_CONFIG.BANNED_USER_PATH))
  {
    fs.writeFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, '');
  }

  const banned_list = fs.readFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, {
    encoding: 'utf8',
    flag: 'r',
  });

  banned_id_set = new Set(banned_list.split('\n').map((line: string) => line.trim()).filter(Boolean));
};

exports.initialize = (): void =>
{
  loadBannedIdListFromDisk();

  const refresh_timer = setInterval(() =>
  {
    loadBannedIdListFromDisk();
  }, REFRESH_INTERVAL);
  refresh_timer.unref(); //이 타이머 하나만으로 프로세스가 종료되지 않는 걸 막지 않도록 함 (테스트에서 initialize()를 여러 번 호출해도 프로세스가 안 걸리게)
};

exports.isBanned = (id_list: string[]): boolean =>
{
  return id_list.some(id => banned_id_set.has(id));
};

//actor(2026-08-19 로깅 감사로 추가, 선택값) - 호출부(admin-ban-list-ui.ts/user-quiz-info.ui.ts/
//report_manual_processing.ts)가 넘겨주는 "누가/왜 했는지" 표시 문자열. 자동 신고 처리 경로 등
//interaction이 없는 곳도 있어 필수값으로는 못 만듦.
exports.banId = (id: string, actor?: string): boolean =>
{
  if(banned_id_set.has(id))
  {
    logger.info(`${id} is already banned`);
    return false; // 이미 등록된 경우
  }

  fs.appendFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, `${id}\n`, {
    encoding: 'utf8',
  });
  banned_id_set.add(id);

  logger.info(`${id} is banned${actor ? ` by ${actor}` : ''}`);
  return true;
};

exports.getBannedIdList = (): string[] =>
{
  return Array.from(banned_id_set);
};

exports.unbanId = (id: string, actor?: string): boolean =>
{
  if(!banned_id_set.has(id))
  {
    return false; // 애초에 밴돼있지 않은 경우
  }

  banned_id_set.delete(id);

  fs.writeFileSync(SYSTEM_CONFIG.BANNED_USER_PATH, Array.from(banned_id_set).join('\n') + (banned_id_set.size > 0 ? '\n' : ''), {
    encoding: 'utf8',
  });

  logger.info(`${id} is unbanned${actor ? ` by ${actor}` : ''}`);
  return true;
};
