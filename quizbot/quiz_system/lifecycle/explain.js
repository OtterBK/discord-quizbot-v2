'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycle } = require('./quiz_lifecycle.js');
const { CYCLE_TYPE } = require('../constants');
const { SYSTEM_CONFIG, EXPLAIN_TYPE, QUIZ_MAKER_TYPE, BGM_TYPE } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../utility/utility.js');

//#region Explain Cycle
/** 게임 방식 설명하는 단계인 Explain **/
class Explain extends QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.EXPLAIN;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.QUESTIONING;
  }

  async act()
  {
    const quiz_data = this.quiz_session.quiz_data;
    const quiz_type = ['quiz_type'];
    let quiz_ui = this.quiz_session.quiz_ui;

    quiz_ui.embed.color = 0xFED049,

    quiz_ui.embed.title = text_contents.quiz_explain.title;
    quiz_ui.embed.description = ' \n \n';

    quiz_ui.components = [];

    let explain_type = EXPLAIN_TYPE.SHORT_ANSWER_TYPE;
    if(quiz_data.quiz_maker_type == QUIZ_MAKER_TYPE.CUSTOM)
    {
      explain_type = EXPLAIN_TYPE.CUSTOM_ANSWER_TYPE;
    }

    if(this.quiz_session.isMultiplayerSession())
    {
      explain_type = EXPLAIN_TYPE.MULTIPLAYER_ANSWER_TYPE;
    }
        
    const explain_list = text_contents.quiz_explain[explain_type];
    for(let i = 0; i < explain_list.length; ++i)
    {
      if(this.quiz_session?.force_stop === true)
      {
        return;
      }

      const explain = explain_list[i];
      quiz_ui.embed.description += explain;
      utility.playBGM(this.quiz_session.audio_player, BGM_TYPE.PLING);
      quiz_ui.update();

      await utility.sleep(SYSTEM_CONFIG.EXPLAIN_WAIT);
    }
  }

  async exit()
  {
    if(this.quiz_session.isMultiplayerSession())
    {
      this.next_cycle = CYCLE_TYPE.HOLD;
      this.quiz_session.waitForSyncDone();
    }
  }

}

//#endregion

module.exports = Explain;
