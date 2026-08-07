'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const Question = require('./question.js');
const { CYCLE_TYPE } = require('../../constants');
const { BGM_TYPE } = require('../../../../config/system_setting.js');
const logger = require('../../../../utility/logger.js')('QuizSystem');

//OX Type Question
class QuestionOX extends Question
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session)
  {
    super(quiz_session);
  }

  async act()
  {
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;
    const option_data = this.quiz_session.option_data;

    const current_question = this.current_question;
    if(current_question == undefined || this.next_cycle == CYCLE_TYPE.ENDING) //제출할 퀴즈가 없으면 패스
    {
      return;
    }

    game_data['processing_question'] = this.current_question; //현재 제출 중인 퀴즈

    this.answers = current_question['answers'];
    const question = current_question['question'];

    logger.info(`Questioning OX, guild_id:${this.quiz_session.guild_id}, question_num: ${game_data['question_num']+1}/${quiz_data['quiz_size']}, question: ${question.trim()}`);

    //OX 퀴즈는 카운트다운 BGM만 틀어준다.
    const is_long = current_question['is_long'] ?? false;
    const audio_player = this.quiz_session.audio_player;
    const audio_play_time = is_long ? 20000 : 10000; //10초, 또는 20초 고정이다.

    this.progress_bar_fixed_text = question; //OX 퀴즈는 progress bar 위에 붙여주면 된다.

    //카운트다운 BGM 재생
    const bgm_type = is_long == true ? BGM_TYPE.COUNTDOWN_LONG : BGM_TYPE.COUNTDOWN_10;
    this.sendBGM(bgm_type);

    this.startProgressBar(audio_play_time); //진행 bar 시작

    const timeover_promise = this.createTimeoverTimer(audio_play_time); //audio_play_time 후에 실행되는 타임오버 타이머 만들어서
    await Promise.race([timeover_promise]); //race로 돌려서 타임오버 타이머가 끝나는걸 기다림

    //어쨋든 타임오버 타이머가 끝났다.
    if(this.quiz_session.force_stop == true) //그런데 강제종료다
    {
      return; //바로 return
    }

    current_question['play_bgm_on_question_finish'] = true; //OX 퀴즈는 어찌됐건 다음 스탭에서 bgm 틀어준다

    if(this.is_timeover == false) //그런데 타임오버로 끝난게 아니다.
    {
      this.stopAudioList(); //BGM 바로 멈춰준다.

      this.next_cycle = CYCLE_TYPE.TIMEOVER; //ox퀴즈는 스킵만 타임오버가 일찍 끝난다. 그러니 타임오버로~
    }
    else //타임오버라면
    {
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //우선 타임오버로
            
      const selected_choice_map = this.selected_choice_map;

      if(selected_choice_map === undefined) //아무도 객관식 답을 선택 안했다?
      {
        return; //그럼 그냥 타임오버
      }

      const iter = selected_choice_map.entries();
      const score = 1; //객관식은 1점 고정

      for(let i = 0; i < selected_choice_map.size; ++i)
      {
        const [member, selected_value] = iter.next().value;
                  
        if(this.answers.includes(selected_value) === false) 
        {
          continue;
        }

        this.applyCorrectAnswer(member.id, member.displayName, score);
      }

      if(this.hasAnswerer()) //뭐라도 정답자가 있다?
      {
        this.next_cycle = CYCLE_TYPE.CORRECTANSWER; //그럼 정답으로~
      }
    }
  }
}

module.exports = QuestionOX;
