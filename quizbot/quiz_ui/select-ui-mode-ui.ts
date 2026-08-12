'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) - /퀴즈 명령어 직후 가장 먼저 보여주는 화면.
//디스코드 UI(기존 방식, MainUI)와 웹 UI(WebHandoffUI로 곧장 진입, 원격 컨트롤) 두 트랙을 여기서 분기한다.
//웹 트랙은 아직 공식(dev) 퀴즈 모드만 실제 동작(Phase 2/3에서 유저/랜덤 붙을 예정).

//#region 필요한 외부 모듈

//#endregion

//#region 로컬 modules
const { SYSTEM_CONFIG,} = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
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
    };
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
