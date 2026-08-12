'use strict';

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) - DM을 "웹에서 편집 중" 잠금 화면으로 바꾸는
//중계 화면. web-handoff-ui.ts와 같은 IPC(WEB_SESSION_REQUEST/SIGNAL)로 마스터의 web_session_manager와
//통신하지만, owner_id(유저) 단위 세션이라 web-handoff-ui.ts보다 훨씬 단순하다:
//  - DM은 봇-유저 1:1이라 하이재킹(force_take/already_locked) 개념 자체가 없다 - 항상 무조건 교체.
//  - Phase 1은 아직 실제 편집 화면이 없어 'applied'/'updated' 신호를 처리할 다음 화면이 없다 -
//    'expired'만 처리하고, 편집 CRUD가 붙는 Phase 3~4에서 나머지를 추가한다.
//  - 진행 중 선택 요약을 보여줄 필요가 없다(디스코드 쪽엔 "지금 뭘 편집 중인지" 실시간 표시를
//    MVP에서 의도적으로 제외 - WEB_QUIZ_CREATION_PLAN.md 참고).

//#region 필요한 외부 모듈
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('QuizUI');
const ipc_manager = require('../managers/ipc_manager');

const { QuizbotUI } = require('./common-ui');
//#endregion

/** 퀴즈 만들기 웹 세팅 잠금 화면 (DM 전용, owner_id 단위 세션) */
class QuizEditWebHandoffUI extends QuizbotUI
{
  constructor(interaction: any, existing_session: any = undefined)
  {
    super();

    this.owner_id = interaction.user.id ?? interaction.member?.id;
    this.owner_name = interaction.user.displayName;
    this.owner_icon_url = interaction.user.avatarURL();

    this.token = existing_session?.token;
    this.expires_at = existing_session?.expires_at;

    this.components = [];

    if(existing_session !== undefined)
    {
      this.refreshLockedEmbed();
    }
    else
    {
      this.initializeLoadingEmbed();
    }
  }

  onReady() //ui 등록 됐을 때
  {
    if(this.token === undefined)
    {
      this.requestSession();
    }
  }

  initializeLoadingEmbed()
  {
    this.embed = {
      color: 0x87CEEB,
      title: '🔒 퀴즈 웹 편집기 준비 중...',
      description: '```잠시만 기다려주세요...```',
    };
  }

  async requestSession()
  {
    const reply = await ipc_manager.sendWebSessionRequest({
      action: 'create_owner_session',
      owner_id: this.owner_id,
      mode: 'quiz_edit',
      owner_name: this.owner_name,
      owner_icon_url: this.owner_icon_url,
    });

    if(this.holder === undefined) //그 사이 화면이 이미 다른 곳으로 넘어갔으면(뒤로가기 등) 무시
    {
      return;
    }

    if(reply?.success !== true)
    {
      logger.error(`Failed to create quiz edit web session. owner_id:${this.owner_id}, reason:${reply?.reason}`);
      this.embed = {
        color: 0xC43B3B,
        title: '🔸 웹 세션을 열 수 없습니다',
        description: '```다시 [/퀴즈만들기] 명령어를 입력해주세요.```',
      };
      this.update();
      return;
    }

    this.token = reply.token;
    this.expires_at = reply.expires_at;
    this.refreshLockedEmbed();
    this.update();
  }

  refreshLockedEmbed()
  {
    const web_url = `${SYSTEM_CONFIG.WEB_BASE_URL}/editor?token=${this.token}`;
    this.web_url = web_url;

    const description = `\`\`\`🔒 웹에서 퀴즈를 편집할 수 있어요.\`\`\`\n아래 버튼으로 이동해서 퀴즈를 만들거나 편집해보세요.`;

    this.embed = {
      color: 0x87CEEB,
      title: '🛠 퀴즈 웹 편집기',
      url: web_url,
      description,
    };

    //Link 버튼은 discord.js/디스코드 클라이언트가 인터랙션 없이 바로 브라우저로 열어주므로 소유자
    //검증과 무관하게 항상 안전하다(web-handoff-ui.ts와 동일한 근거) - 어차피 DM이라 다른 유저는
    //이 화면 자체를 볼 수 없다.
    this.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 웹에서 편집하기')
          .setURL(web_url)
          .setStyle(ButtonStyle.Link)
      ),
    ];
  }

  onReceivedWebSessionSignal(signal: any): any
  {
    if(signal.event === 'expired')
    {
      this.token = undefined;
      this.goToBack();
      return undefined;
    }

    return undefined;
  }
}

module.exports = { QuizEditWebHandoffUI };
