//길드 화면 하이재킹 방어용 컴포넌트. 다른 유저가 이미 이 서버의 화면(디스코드 UI든 웹 UI든)을
//쓰고 있는 상태에서 누군가 /퀴즈를 입력하면 보여주는 ephemeral 안내 전용 - 소유자가 아닌 유저의
//인터랙션이라 ui_holder_map을 거치지 않고 bot.js에서 직접 처리한다(ui-system-core.ts의
//createMainUIHolder/bot.js의 handle_ui_force_take 참고).
//2026-08-13 - 원래 웹 UI 세팅 중(WebHandoffUI)일 때만 쓰이던 컴포넌트였는데, 디스코드 UI 사용
//중에도 동일한 방어가 필요해져서 이름/문구를 일반화함(퀴즈 선택 웹 연동 하이재킹 방어, Phase 1에서
//처음 신설됨).

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const force_take_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('ui_force_take')
      .setLabel('🔓 권한 가져오기')
      .setStyle(ButtonStyle.Danger),
  );

module.exports = { force_take_comp };
