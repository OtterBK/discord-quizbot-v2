'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - /퀴즈 명령어 직후 가장 먼저 보여주는 화면.
//디스코드 UI(기존 방식, MainUI)와 웹 UI(WebHandoffUI로 곧장 진입, 원격 컨트롤) 두 트랙을 여기서 분기한다.
//웹 트랙은 아직 공식(dev) 퀴즈 모드만 실제 동작(Phase 2/3에서 유저/랜덤 붙을 예정).
//실시간 공지(resources/current_notice.txt)는 예전엔 bot.js의 start_quiz_handler가 이 화면과 별개로
//채널에 새 메시지를 또 보냈었는데(2026-08-13 변경) - 이 화면의 embed 필드로 옮김. 이 화면은 트랙을
//고르기 전에만 보이고 고른 뒤(MainUI/WebHandoffUI)에는 다시 안 뜨므로, 자연스럽게 웹 트랙 이후
//화면에는 공지가 안 보이게 된다(사용자 요청사항 - 웹 UI에서는 실시간 공지 불필요).
//"권한 가져오기"(force_take, bot.js의 handle_ui_force_take)로 다른 유저에게서 화면을 넘겨받은
//경우에도 이 화면이 다시 뜬다(ui-system-core.ts의 createMainUIHolder) - 예전엔 여기서 웹 세션
//토큰을 미리 발급받아 들고 있다가 웹 UI를 고르면 재사용하는 방식이었지만, 어차피 이 화면에 들어올
//때 옛 홀더는 이미 free()돼(웹 세션이 있었다면 그때 같이 반납됨) 특별히 재사용할 이유가 없어
//단순화함(2026-08-13) - 웹 UI를 고르면 그냥 새 세션을 'create'로 발급받는다(일반 진입과 완전히 동일).

//#region 필요한 외부 모듈
const fs = require('fs');

//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG,} = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const { sync_objects } = require('../managers/ipc_manager');
const {
  select_ui_mode_btn_component,
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

const { MainUI } = require("./main-ui");
const { WebHandoffUI } = require("./web-handoff-ui");

//#endregion

/** 디스코드 UI/웹 UI 진행 방식 선택 화면 (/퀴즈 명령어 최초 진입 화면) */
class SelectUIModeUI extends QuizbotUI
{

  constructor()
  {
    super();

    this.initializeEmbed();
    this.initializeComponents();

  }

  initializeEmbed()
  {

    this.embed = {
      color: 0x87CEEB,
      title: text_contents.select_ui_mode.title,
      description: text_contents.select_ui_mode.description,
      fields: [...this.buildServerCountFields(), ...this.buildNoticeFields()],
    };
  }

  //투트랙 분리 전 MainUI 화면에 있던 서버 수 필드(2026-08-15, 전수 테스트 중 사용자 피드백 -
  //투트랙 화면으로 넘어오며 이 정보가 안 보이게 됐던 것을 복원).
  buildServerCountFields()
  {
    return [
      {
        name: '​',
        value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      },
      {
        name: text_contents.main_menu.total_server,
        value: `${text_contents.icon.ICON_GUILD} ${sync_objects.get('guild_count')}`,
        inline: true,
      },
      {
        name: text_contents.main_menu.playing_server,
        value: `${text_contents.icon.ICON_LOCALPLAY} ${sync_objects.get('local_play_count')}`,
        inline: true,
      },
      {
        name: text_contents.main_menu.competitive_server,
        value: `${text_contents.icon.ICON_MULTIPLAY} ${sync_objects.get('multi_play_count')}`,
        inline: true,
      },
    ];
  }

  //실시간 공지(resources/current_notice.txt)가 있으면 embed 필드로 얹는다 - 파일이 없거나 비어있으면
  //필드 자체를 생략(빈 배열). Discord embed field.value 제한(1024자)을 넘지 않도록 클램프.
  //구분선(2026-08-13, 사용자 피드백 - 공지가 위 설명과 붙어 있어 UI에 잘 안 녹았음) - 빈 이름(`​`)
  //필드에 가로줄 문자를 넣어 설명과 공지 사이를 시각적으로 분리한다.
  buildNoticeFields()
  {
    if(fs.existsSync(SYSTEM_CONFIG.CURRENT_NOTICE_PATH) === false)
    {
      return [];
    }

    const current_notice = fs.readFileSync(SYSTEM_CONFIG.CURRENT_NOTICE_PATH, { encoding: 'utf8', flag: 'r' }).trim();
    if(current_notice.length === 0)
    {
      return [];
    }

    const clamped_notice = current_notice.length > 1000 ? `${current_notice.slice(0, 1000)}...` : current_notice;

    return [
      {
        name: '​',
        value: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      },
      {
        name: '📢 실시간 공지',
        value: clamped_notice,
      },
    ];
  }

  initializeComponents()
  {

    this.components = [select_ui_mode_btn_component]; //최상위 화면이라 뒤로가기 없음(MainUI와 동일)
  }

  onInteractionCreate(interaction: any)
  {
    if(!interaction.isButton())
    {
      return;
    }

    if(interaction.customId === '1') //디스코드 UI 눌렀을 때 - 기존 방식 그대로
    {
      return new MainUI();
    }

    if(interaction.customId === '2') //웹 UI 눌렀을 때 - WebHandoffUI로 곧장 진입(원격 컨트롤)
    {
      return new WebHandoffUI('dev', interaction);
    }
  }

}

module.exports = { SelectUIModeUI };
