'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const Question = require('./question');
const { CYCLE_TYPE } = require('../../constants');
const { SYSTEM_CONFIG } = require('../../../../config/system_setting.js');
const text_contents = require('../../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];

//Unknown Type Question
class QuestionUnknown extends Question
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session: any)
  {
    super(quiz_session);
  }

  async enter()
  {
    const channel = this.quiz_session.channel;
    channel.send({content: text_contents.quiz_play_ui.unknown_quiz_type});
    this.forceStop();
  }
}

module.exports = QuestionUnknown;
