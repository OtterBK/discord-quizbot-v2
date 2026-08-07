'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycle } = require('./quiz_lifecycle');
const { CYCLE_TYPE } = require('../constants');
const session_registry = require('../session_registry');

//#region Finish Cycle
/** Quiz session 종료 **/
class Finish extends QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.FINISH;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.UNDEFINED;
    this.ignore_block = true; //FINISH Cycle은 막을 수가 없다.
  }

  async act()
  {
    if(this.quiz_session.audio_player)
    {
      this.quiz_session.audio_playlist = [];
      this.quiz_session.audio_player.stop(true);
    }
    const voice_connection = this.quiz_session.voice_connection;
    if(voice_connection!= undefined)
    {
      try
      {
        voice_connection.destroy();
      }
      catch(error)
      {
        return;
      }
    }

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isHostSession() && this.quiz_session.isIngame() && this.quiz_session.force_stop === false)
    {
      this.quiz_session.sendFinished(); //호스트는 서버에 게임 끝났다고 알림
    }
  }

  async exit()
  {
    const guild_id = this.quiz_session.guild_id;
        
    this.quiz_session.free();

    delete session_registry.quiz_session_map[guild_id];
  }
}
//#endregion

module.exports = Finish;
