'use strict';

//점검 모드(resources/maintenance_notice.txt) - 이 파일이 존재하면 관리자 외 전 유저의 인터랙션이
//막힌다(quizbot/bot.js 전역 interactionCreate 핸들러 최상단, 슬래시커맨드/버튼/모달 등 전부 차단).
//기존엔 서버 파일을 SSH로 직접 만들고 지우는 방식뿐이었음 - quizmgr 관리자 패널(admin-maintenance-ui.ts)에서
//켜고 끌 수 있도록 순수 함수로 추출(2026-08-15 신설).

const fs = require('fs');
const logger = require('../../utility/logger.js')('MaintenanceModeManager');

exports.isMaintenanceModeOn = (maintenance_notice_path: string): boolean =>
{
  return fs.existsSync(maintenance_notice_path);
};

exports.getMaintenanceNotice = (maintenance_notice_path: string): string =>
{
  if(fs.existsSync(maintenance_notice_path) === false)
  {
    return '';
  }

  return fs.readFileSync(maintenance_notice_path, { encoding: 'utf8', flag: 'r' }).trim();
};

//점검 모드는 관리자 외 전 유저의 인터랙션을 막는 파급력 큰 기능이라(bot.js 전역 핸들러) warn 레벨로
//로깅 - 2026-08-19 로깅 감사로 추가, actor는 호출부(admin-maintenance-ui.ts)가 interaction.user 기준
//으로 넘겨주는 선택값.
exports.enableMaintenanceMode = (maintenance_notice_path: string, content: string, actor?: string): void =>
{
  fs.writeFileSync(maintenance_notice_path, content, { encoding: 'utf8' });
  logger.warn(`점검 모드 켜짐/문구 갱신${actor ? ` by ${actor}` : ''}: ${content}`);
};

exports.disableMaintenanceMode = (maintenance_notice_path: string, actor?: string): void =>
{
  fs.unlinkSync(maintenance_notice_path);
  logger.warn(`점검 모드 꺼짐${actor ? ` by ${actor}` : ''}`);
};
