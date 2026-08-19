'use strict';

//utility.js에서 재수출되는 도메인 파일(다른 util/*.ts와 동일 관행). 퀴즈 진행에 필요한 최소 Discord
//권한 체크(2026-08-19 신설) - 텍스트 채널(/퀴즈 명령어 진입 시, bot.js의 checkPermission)과 음성
//채널(실제 퀴즈 시작 시, quiz_system.ts의 checkReadyForStartQuiz) 둘 다 이 파일의
//getMissingPermissionLabels를 공유해서 쓴다. 기존엔 SendMessages/ViewChannel을 하나씩 순서대로 체크해서
//"부족한 권한 중 딱 하나만" 알려줬는데, 한 번에 전부 검사해서 부족한 권한을 다 나열해주기 위해 도입.

const { PermissionsBitField } = require('discord.js');

//"채널 보기"가 없으면 애초에 channel.permissionsFor()가 의미 있는 값을 못 주지만(권한 정보 자체를
//못 가져오는 경우가 있음), 그래도 사용자에게 "뭐가 없는지" 보여줘야 하니 목록엔 그대로 둔다.
exports.QUIZ_TEXT_CHANNEL_PERMISSIONS = [
  { flag: PermissionsBitField.Flags.ViewChannel, label: '채널 보기' },
  { flag: PermissionsBitField.Flags.SendMessages, label: '메시지 보내기' },
  { flag: PermissionsBitField.Flags.EmbedLinks, label: '임베드 링크' },
  { flag: PermissionsBitField.Flags.AttachFiles, label: '파일 첨부' },
];

exports.QUIZ_VOICE_CHANNEL_PERMISSIONS = [
  { flag: PermissionsBitField.Flags.Connect, label: '음성 채널 연결' },
  { flag: PermissionsBitField.Flags.Speak, label: '음성 채널에서 말하기' },
];

//permissions: channel.permissionsFor(...)/member.permissionsIn(...) 결과(PermissionsBitField) -
//채널 자체를 못 보거나 조회 실패로 undefined/null이 넘어오면 required 전체를 "부족함"으로 취급한다
//(실제로 뭐가 없는지 정확히는 몰라도, 최소한 사용자에게 빈 목록을 보여주는 것보단 나음).
exports.getMissingPermissionLabels = (permissions: any, required: { flag: bigint, label: string }[]): string[] =>
{
  if(!permissions)
  {
    return required.map((p) => p.label);
  }

  return required.filter((p) => permissions.has(p.flag) === false).map((p) => p.label);
};
