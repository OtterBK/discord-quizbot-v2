//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) 하이재킹 방어용 컴포넌트.
//WebHandoffUI가 잠긴 동안 다른 유저가 /퀴즈를 눌렀을 때 보여주는 ephemeral 안내 전용 - 소유자가
//아닌 유저의 인터랙션이라 ui_holder_map을 거치지 않고 bot.js에서 직접 처리한다(web-handoff-ui.ts 참고).
//WebHandoffUI 자체의 컴포넌트(잠금 화면)는 Link 버튼 하나뿐이라 여기 둘 필요 없이 web-handoff-ui.ts에서
//직접 만든다 - Link 버튼은 인터랙션을 발생시키지 않아(디스코드 클라이언트가 바로 브라우저를 여는 방식)
//소유자 전용 체크와 무관하게 항상 안전하다.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const web_handoff_force_take_comp = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('web_handoff_force_take')
      .setLabel('🔓 권한 가져오기')
      .setStyle(ButtonStyle.Danger),
  );

module.exports = { web_handoff_force_take_comp };
