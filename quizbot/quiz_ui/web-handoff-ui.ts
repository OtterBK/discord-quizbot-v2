'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - 디스코드 채널을 잠그고 웹에서 퀴즈를 선택하게
//하는 중계 화면. 실제 세션 상태(토큰↔길드 매핑)는 마스터 프로세스(index.js)의 web_session_manager가
//갖고 있고, 이 클래스는 IPC(WEB_SESSION_REQUEST/SIGNAL)로만 통신한다.
//
//Phase 1(공식 dev 퀴즈)/Phase 2(유저 퀴즈)/Phase 3(랜덤 omakase 퀴즈) 완료.
//
//2026-08-08 Phase 2: handleApplied가 this.mode(세션 생성 시 1회 고정) 대신 payload.mode로 분기하도록
//바뀜 - 진입점이 SelectUIModeUI로 옮겨가면서(WEB_INTEGRATION_PLAN.md "8. 투트랙 진입점 분리") 프론트엔드가
//select/confirm 요청마다 어느 탭에서 보낸 건지 payload에 mode를 실어보내는 방식으로 일반화했기 때문.
//
//2026-08-08: "선택 완료(applied)"는 토큰을 파기하지 않는다 - 화면은 DevQuizInfoUI/UserQuizInfoUI로
//넘어가지만, 그 뒤 재선택/문제 수 재조정은 각 정보 화면이 직접 onReceivedWebSessionSignal을 구현해서
//처리한다(dev-quiz-info-ui.ts/user-quiz-info.ui.ts 참고). 토큰 파기는 퀴즈 실제 시작 또는 UIHolder
//소멸 시점으로 옮겨감(web_session_manager.ts의 releaseSession 참고).

//#region 필요한 외부 모듈
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('QuizUI');
const ipc_manager = require('../managers/ipc_manager');

const { QuizbotUI } = require('./common-ui');
const { DevQuizSelectUI } = require('./dev-quiz-select-ui');
const { DevQuizInfoUI } = require('./dev-quiz-info-ui');
const { OmakaseQuizRoomUI } = require('./omakase-quiz-room-ui');
const { QuizInfoUI } = require('./quiz-info-ui');
const ban_manager = require('../managers/ban_manager');
const quiz_system = require('../quiz_system/quiz_system');
//#endregion

/** 웹 세팅 잠금 화면. mode: 'dev' | 'user' | 'omakase' */
class WebHandoffUI extends QuizbotUI
{
  constructor(mode: string, interaction: any, existing_session: any = undefined)
  {
    super();

    this.mode = mode;
    this.guild = interaction.guild;
    this.owner_id = interaction.member?.id ?? interaction.user.id;
    this.owner_name = interaction.member?.displayName ?? interaction.user.username;

    this.token = existing_session?.token;
    this.expires_at = existing_session?.expires_at;
    this.current_selection = undefined;

    this.components = [];

    if(existing_session !== undefined) //force_take로 이미 토큰을 발급받은 채로 생성된 경우
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
      this.requestSession(false);
    }
  }

  initializeLoadingEmbed()
  {
    this.embed = {
      color: 0x87CEEB,
      title: '🔒 퀴즈 웹 세팅 준비 중...',
      description: '```잠시만 기다려주세요...```',
    };
  }

  async requestSession(force_take: boolean)
  {
    const reply = await ipc_manager.sendWebSessionRequest({
      action: force_take ? 'force_take' : 'create',
      guild_id: this.guild.id,
      owner_id: this.owner_id,
      mode: this.mode,
    });

    if(this.holder === undefined) //그 사이 화면이 이미 다른 곳으로 넘어갔으면(뒤로가기 등) 무시
    {
      return;
    }

    if(reply?.success !== true)
    {
      logger.error(`Failed to create web session. guild_id:${this.guild.id}, reason:${reply?.reason}`);
      this.embed = {
        color: 0xC43B3B,
        title: '🔸 웹 세션을 열 수 없습니다',
        description: '```다시 [/퀴즈] 명령어를 입력해주세요.```',
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
    const web_url = `${SYSTEM_CONFIG.WEB_BASE_URL}/?token=${this.token}`;
    this.web_url = web_url;

    let description = `\`\`\`🔒 ${this.owner_name} 님이 웹에서 세팅 중입니다.\`\`\`\n`;
    //POST /api/session/select("선택 중" 실시간 미리보기)는 진행 중 편의 신호라 서버에서 title 길이를
    //검증하지 않는다(웹 API 보안 점검, docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md) - UI를
    //거치지 않고 직접 호출하면 임의 길이의 문자열이 그대로 이 길드의 공유 embed에 꽂힐 수 있어서
    //(embed 길이 제한 초과로 인한 update 실패, 또는 다른 길드원에게 보이는 화면 스팸), 실제로 표시되기
    //직전에 여기서 길이를 제한한다.
    const selection_title = typeof this.current_selection?.title === 'string' ? this.current_selection.title.slice(0, 60) : undefined;
    description += selection_title
      ? `현재 선택: **${selection_title}**\n`
      : `아직 아무것도 선택하지 않았어요.\n`;
    description += `\n웹에서 바꾸면 이 화면이 실시간으로 갱신돼요. \`[/퀴즈] 명령어를 입력한 본인만\` 아래 버튼으로 이동할 수 있어요.`;

    //멀티플레이 웹 연동(Phase 4) - 밴/음성채널 체크 실패는 화면을 그대로 유지한 채(goToBack 안 함,
    //아래 buildMultiplayerUI 참고) 이 잠금 화면에 실패 사유만 얹어서 보여준다.
    if(this.last_error !== undefined)
    {
      description += `\n\n🔸 방금 요청이 실패했어요: ${this.last_error}\n웹 페이지에서 다시 시도해주세요.`;
    }

    this.embed = {
      color: 0x87CEEB,
      title: '🔒 퀴즈 웹 세팅',
      url: web_url,
      description,
    };

    //Link 버튼은 discord.js/디스코드 클라이언트가 인터랙션 없이 바로 브라우저로 열어주기 때문에
    //소유자 전용 체크(bot.js의 uiHolder 소유자 검증)와 무관하게 항상 안전하다 - 다른 유저가 눌러도
    //그냥 웹페이지만 열릴 뿐, 토큰이 없으니 세션을 조작할 수는 없다.
    this.components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel('🔗 웹에서 설정하기')
          .setURL(web_url)
          .setStyle(ButtonStyle.Link)
      ),
    ];
  }

  onReceivedWebSessionSignal(signal: any): any
  {
    if(signal.event === 'updated')
    {
      this.current_selection = signal.payload;
      this.last_error = undefined; //설정을 다시 만지기 시작했으면 이전 실패 안내는 지운다
      this.refreshLockedEmbed();
      return this;
    }

    if(signal.event === 'applied') //웹에서 "선택 완료" - 토큰은 유지되고(WEB_INTEGRATION_PLAN.md 참고) 화면만 전환
    {
      return this.handleApplied(signal.payload);
    }

    if(signal.event === 'expired')
    {
      this.token = undefined;
      this.goToBack();
      return undefined;
    }

    return undefined;
  }

  handleApplied(payload: any): any
  {
    if(payload.mode === 'dev')
    {
      return this.buildDevQuizInfoUI(payload);
    }

    if(payload.mode === 'user')
    {
      this.buildUserQuizInfoUI(payload); //DB 조회가 필요해 비동기 - "중요 제약" 참고, 완료되면 appendNewUI/updateUI를 직접 호출
      return undefined;
    }

    if(payload.mode === 'omakase')
    {
      return this.buildOmakaseQuizInfoUI(payload);
    }

    if(payload.mode === 'multiplayer')
    {
      this.buildMultiplayerUI(payload); //음성채널 체크가 실제 GuildMember를 필요로 해 비동기 - "중요 제약" 참고, 완료되면 appendNewUI/updateUI를 직접 호출
      return undefined;
    }

    logger.error(`WebHandoffUI received applied signal for unsupported mode: ${payload.mode}`);
    this.goToBack();
    return undefined;
  }

  buildDevQuizInfoUI(payload: any): any
  {
    const dev_quiz_info = DevQuizSelectUI.buildDevQuizInfoFromWebPayload(payload);
    if(dev_quiz_info === undefined)
    {
      logger.error(`Web-selected dev quiz content not found. content_path:${payload.content_path}`);
      this.goToBack();
      return undefined;
    }

    return new DevQuizInfoUI(dev_quiz_info);
  }

  //omakase는 DB 조회가 필요 없는 작은 데이터(태그/인증필터/퀴즈함/문제 수)라 dev 모드처럼 동기로 처리
  //가능. createDefaultOmakaseQuizInfo가 interaction.guild/interaction.member.id만 쓰므로 실제
  //interaction 없이 최소 어댑터 객체로 호출한다(생성자에서 이미 캡처해둔 this.guild/this.owner_id 재사용).
  buildOmakaseQuizInfoUI(payload: any): any
  {
    const adapter_interaction = { guild: this.guild, member: { id: this.owner_id } };
    const omakase_quiz_info = OmakaseQuizRoomUI.buildOmakaseQuizInfoFromWebPayload(payload, adapter_interaction);

    QuizInfoUI.BASKET_CACHE[this.guild.id] = omakase_quiz_info['basket_items'];

    return new OmakaseQuizRoomUI(omakase_quiz_info);
  }

  //유저 퀴즈는 DB 조회가 필요해 UIHolder.on()의 동기 계약을 만족할 수 없다(위 파일 상단 주석 참고) -
  //fire-and-forget으로 조회하고, 완료되면 appendNewUI()가 onReady()를 호출해 UserQuizInfoUI 자신이
  //question_list를 다시 로드하는 흐름(user-quiz-info.ui.ts와 동일 - UserQuizSelectUI에서 고를 때도
  //question_list는 아직 없는 UserQuizInfo를 넘기고 onReady()에서 채운다)을 그대로 재사용한다.
  async buildUserQuizInfoUI(payload: any): Promise<void>
  {
    const { loadUserQuizInfoById } = require('../managers/user_quiz_info_manager');
    const user_quiz_info = await loadUserQuizInfoById(payload.quiz_id);

    if(this.holder === undefined) //그 사이 화면이 이미 다른 곳으로 넘어갔으면(뒤로가기 등) 무시
    {
      return;
    }

    if(user_quiz_info === undefined)
    {
      logger.error(`Web-selected user quiz not found. quiz_id:${payload.quiz_id}`);
      this.goToBack();
      return;
    }

    const { UserQuizInfoUI } = require('./user-quiz-info.ui');
    const next_ui = new UserQuizInfoUI(user_quiz_info, true);
    next_ui.quiz_info['selected_question_count'] = payload.selected_question_count; //onReady()의 fillInfoAsDevQuizInfo가 이 값을 덮어쓰지 않도록 미리 채워둠

    this.holder.appendNewUI(next_ui); //내부에서 next_ui.onReady()를 호출 -> question_list 로드(추가 비동기) 후 자체적으로 update()
    this.holder.updateUI();
  }

  //멀티플레이 웹 연동(Phase 4) - MultiplayerQuizSelectUI.createLobby/tryJoinLobby와 동일한 밴/음성채널
  //체크를 여기서 직접 재현한다(그 클래스를 거치지 않고 곧장 MultiplayerQuizLobbyUI를 만들기 때문).
  //음성채널 체크(quiz_system.checkReadyForStartQuiz)는 실제 GuildMember.voice가 있어야 해서
  //{member:{id}} 같은 최소 어댑터로는 흉내낼 수 없다 - guild.members.fetch로 진짜 멤버를 조회한다.
  //
  //2026-08-10 실사용 피드백으로 수정: 원래 이 체크들이 실패하면 this.goToBack()을 불렀는데, 그러면
  //WebHandoffUI 자신이 prev_ui_stack의 이전 화면(SelectUIModeUI)으로 교체돼버려서, 그 뒤 웹에서 아무리
  //다시 시도해도(예: 음성채널에 들어간 뒤 재시도) 신호를 받을 화면이 이미 사라진 상태라 완전히 먹통이
  //됐다(버그 리포트 3/6번). 지금은 실패해도 WebHandoffUI 화면을 유지한 채 실패 사유만 얹어 보여주고,
  //성공/실패 여부를 report_multiplayer_result로 웹에도 알려준다(web_session_manager.ts 참고 - 프론트가
  ///api/multiplayer-result를 폴링해서 읽어감).
  async buildMultiplayerUI(payload: any): Promise<void>
  {
    const guild = this.guild;

    const reportResult = (success: boolean, reason?: string): void =>
    {
      ipc_manager.sendWebSessionRequest({
        action: 'report_multiplayer_result',
        guild_id: guild.id,
        payload: { action: payload.action, success, reason },
      }).catch(() => {});
    };

    const failWithReason = (reason: string): void =>
    {
      reportResult(false, reason);

      if(this.holder === undefined) //그 사이 화면이 이미 다른 곳으로 넘어갔으면(뒤로가기 등) 무시
      {
        return;
      }

      this.last_error = reason;
      this.refreshLockedEmbed();
      this.update();
    };

    const member = await guild.members.fetch(this.owner_id).catch(() => undefined);

    if(this.holder === undefined)
    {
      return;
    }

    if(member === undefined)
    {
      logger.error(`Web-originated multiplayer request but member not found. guild_id:${guild.id}, owner_id:${this.owner_id}`);
      failWithReason('디스코드 멤버 정보를 확인할 수 없어요.');
      return;
    }

    if(ban_manager.isBanned([guild.id, this.owner_id]))
    {
      logger.info(`Web-originated multiplayer request rejected by ban. guild_id:${guild.id}, owner_id:${this.owner_id}`);
      failWithReason('이용 정책 위반으로 멀티플레이를 이용할 수 없어요.');
      return;
    }

    const check_ready = quiz_system.checkReadyForStartQuiz(guild, member);
    if(check_ready.result === false)
    {
      logger.info(`Web-originated multiplayer request not ready. guild_id:${guild.id}, reason:${check_ready.reason}`);
      failWithReason(check_ready.reason);
      return;
    }

    //require를 여기로 미룸 - multiplayer-quiz-lobby-ui.js가 require("./user-quiz-select-ui.js")처럼
    //dist/ 빌드를 전제로 한 .js 확장자를 하드코딩해둔 곳이 있어서(select-quiz-type-ui.ts와 동일한
    //기존 관행), 이 파일을 top-level에서 require하면 web-handoff-ui.ts를 직접 require하는 다른 mode
    //(omakase/user) 테스트까지 ts-node 모듈 해석에서 MODULE_NOT_FOUND로 죽는다(2026-08-08 순환 require
    //수정과 동일한 종류의 문제 - dev-quiz-info-ui.ts 참고). 이 함수가 실제 호출될 때(=multiplayer 모드)만
    //필요하므로 지연 로드로 충분하다.
    const { MultiplayerQuizLobbyUI } = require('./multiplayer-quiz-lobby-ui.js');

    //실제 interaction 없이 MultiplayerQuizLobbyUI를 생성하기 위한 최소 어댑터 - web_mode:true로
    //interaction.reply/모달 필드 읽기에 의존하는 경로를 건너뛰게 한다(multiplayer-quiz-lobby-ui.js 참고).
    const adapter_interaction = { guild, member, channel: this.holder.channel, web_mode: true };

    let next_ui: any;
    if(payload.action === 'create')
    {
      const multiplayer_quiz_info = MultiplayerQuizLobbyUI.buildMultiplayerQuizInfoFromWebPayload(payload, adapter_interaction);
      next_ui = new MultiplayerQuizLobbyUI(multiplayer_quiz_info, adapter_interaction, false);
    }
    else if(payload.action === 'join')
    {
      const fake_quiz_info = { title: '멀티플레이 로비', type_name: '세션 정보를 불러오는 중입니다...', icon: '🌐' }; //MultiplayerQuizSelectUI.tryJoinLobby와 동일 - 실제 정보는 IPC 응답 후 채워짐
      next_ui = new MultiplayerQuizLobbyUI(fake_quiz_info, adapter_interaction, true, payload.session_id);
    }
    else
    {
      logger.error(`WebHandoffUI received applied signal for unsupported multiplayer action: ${payload.action}`);
      failWithReason('알 수 없는 요청이에요.');
      return;
    }

    //여기서부터는 밴/음성채널 체크를 통과했다는 뜻 - 실제 로비 생성/참가(IPC 왕복)가 드물게 더 실패할
    //수 있지만(예: 참가하려던 로비가 그 사이 게임을 시작함) 그건 MultiplayerQuizLobbyUI 자신이
    //goToBack()으로 처리한다(이 시점엔 이미 WebHandoffUI가 prev_ui_stack에 쌓여있어 되돌아갈 화면이
    //남아있다 - 위에서 설명한 버그와 달리 안전함). 웹에는 낙관적으로 성공을 보고한다.
    this.last_error = undefined;
    reportResult(true);

    this.holder.appendNewUI(next_ui);
    this.holder.updateUI();
  }
}

module.exports = { WebHandoffUI };
