'use strict';

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) - /퀴즈만들기 명령어 직후 가장 먼저 보여주는 화면.
//select-ui-mode-ui.ts와 동일 패턴이되 항상 DM(PRIVATE)에서만 쓰인다 - 길드 개념이 없어 하이재킹 방어가
//불필요하다는 점이 select-ui-mode-ui.ts/web-handoff-ui.ts와의 가장 큰 차이.

//#region 로컬 modules
const { SYSTEM_CONFIG,} = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const {
  select_ui_mode_btn_component, //select-ui-mode-ui.ts와 동일한 2버튼(customId '1'/'2') 구조라 그대로 재사용
} = require("./components");

const {
  QuizbotUI,
} = require("./common-ui");

const { UserQuizListUI } = require("./user-quiz-list-ui");
const { QuizEditWebHandoffUI } = require("./quiz-edit-web-handoff-ui");

//#endregion

/** 퀴즈 제작 디스코드 UI/웹 UI 진행 방식 선택 화면 (/퀴즈만들기 명령어 최초 진입 화면) */
class QuizEditSelectUIModeUI extends QuizbotUI
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
      title: text_contents.quiz_edit_select_ui_mode.title,
      description: text_contents.quiz_edit_select_ui_mode.description,
    };
  }

  initializeComponents()
  {
    this.components = [select_ui_mode_btn_component]; //최상위 화면이라 뒤로가기 없음
  }

  onInteractionCreate(interaction: any)
  {
    if(!interaction.isButton())
    {
      return;
    }

    if(interaction.customId === '1') //디스코드 UI - 기존 방식 그대로
    {
      return new UserQuizListUI(interaction.user);
    }

    if(interaction.customId === '2') //웹 UI - QuizEditWebHandoffUI로 곧장 진입(원격 편집)
    {
      return new QuizEditWebHandoffUI(interaction);
    }
  }

}

module.exports = { QuizEditSelectUIModeUI };
