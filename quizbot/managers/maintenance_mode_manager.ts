'use strict';

//점검 모드(resources/maintenance_notice.txt) - 이 파일이 존재하면 관리자 외 전 유저의 인터랙션이
//막힌다(quizbot/bot.js 전역 interactionCreate 핸들러 최상단, 슬래시커맨드/버튼/모달 등 전부 차단).
//기존엔 서버 파일을 SSH로 직접 만들고 지우는 방식뿐이었음 - quizmgr 관리자 패널(admin-maintenance-ui.ts)에서
//켜고 끌 수 있도록 순수 함수로 추출(2026-08-15 신설).

const fs = require('fs');

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

exports.enableMaintenanceMode = (maintenance_notice_path: string, content: string): void =>
{
  fs.writeFileSync(maintenance_notice_path, content, { encoding: 'utf8' });
};

exports.disableMaintenanceMode = (maintenance_notice_path: string): void =>
{
  fs.unlinkSync(maintenance_notice_path);
};
