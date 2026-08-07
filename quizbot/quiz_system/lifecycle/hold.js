'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycle } = require('./quiz_lifecycle');
const { CYCLE_TYPE } = require('../constants');

//#region HOLD Cycle
/** Quiz session 종료 **/
class HOLD extends QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.HOLD;
  constructor(quiz_session)
  {
    super(quiz_session);
  }

  async act()
  {
    //그냥 아무것도 안하는 CYCLE. 멀티에서 필요해서 만듦
  }

}
//#endregion

module.exports = HOLD;
