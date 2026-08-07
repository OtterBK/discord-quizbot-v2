'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const { QuizLifeCycleWithUtility } = require('./quiz_lifecycle');
const { CYCLE_TYPE } = require('../constants');
const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');
const logger = require('../../../utility/logger.js')('QuizSystem');

//#region Clearing Cycle
/** 자원 정리용 **/
class Clearing extends QuizLifeCycleWithUtility
{
  static cycle_type = CYCLE_TYPE.CLEARING;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.QUESTIONING;
    this.custom_wait = undefined;
  }

  async enter()
  {
        
  }

  async act()
  {

  }

  async exit()
  {
    const quiz_data = this.quiz_session.quiz_data;
    const game_data = this.quiz_session.game_data;

    if(SYSTEM_CONFIG.explicit_close_audio_stream) //오디오 STREAM 명시적으로 닫음
    {
      const audio_stream_for_close = game_data['audio_stream_for_close'];
      if(audio_stream_for_close != undefined && audio_stream_for_close.length != 0)
      {
        const used_stream = audio_stream_for_close.shift();
        used_stream.forEach((audio_stream) => 
        {
          if(audio_stream == undefined) return;

          if(audio_stream.closed == false)
            audio_stream.close();
          if(audio_stream.destroyed == false)
            audio_stream.destroy();
        });
      }
    }

    let quiz_ui = this.quiz_session.quiz_ui;
    quiz_ui.delete();

    //이전 퀴즈 resource 해제
    const previous_question = game_data['processing_question'];
    if(previous_question != undefined)
    {
      const fade_out_timer = previous_question['fade_out_timer']; //이전에 호출한 fadeout이 아직 안끝났을 수도 있다.
      if(fade_out_timer != undefined)
      {
        clearTimeout(fade_out_timer);
      }
    }

    delete game_data['processing_question'];

    let has_more_question = this.quiz_session.hasMoreQuestion();
    if(has_more_question && this.quiz_session.has_current_question === false && this.quiz_session.quiz_data.question_list.length === 0) //has more question 인데 현재 퀴즈도 없고 question_list가 empty다.
    {
      logger.warn(`has more question. but question list is empty. stop quiz`);
      has_more_question = false;

      this.quiz_session.sendMessage(`\`\`\`🔸 더 이상 제출할 문제가 없어 퀴즈가 마무리 됩니다.\`\`\``);
    }

    if(has_more_question === false) //모든 퀴즈 제출됐음
    {
      this.next_cycle = CYCLE_TYPE.ENDING;
      logger.info(`All Question Submitted on Clearing, guild_id:${this.quiz_session.guild_id}`);

      if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isHostSession())
      {
        this.quiz_session.sendFinishUp(); //호스트는 서버에 게임 마무리한다고 알림
      }
      
      return; //더 이상 진행할 게 없다.
    }

    if(this.quiz_session.isMultiplayerSession())
    {
      if(this.quiz_session.isMultiplayerSessionExpired())
      {
        this.next_cycle = CYCLE_TYPE.ENDING; //서버 expired 된 상태면 ending으로
        return;
      }

      this.next_cycle = CYCLE_TYPE.HOLD;
      this.quiz_session.waitForSyncDone();
    }
    
  }
}

//#endregion

module.exports = Clearing;
