'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const Question = require('./question');
const { CYCLE_TYPE } = require('../../constants');
const { BGM_TYPE } = require('../../../../config/system_setting.js');
const logger = require('../../../../utility/logger.js')('QuizSystem');

//Intro Type Question
class QuestionIntro extends Question
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session: any)
  {
    super(quiz_session);
  }

  async act()
  {
    const quiz_data = this.quiz_session.quiz_data;
    const game_data = this.quiz_session.game_data;
    const option_data = this.quiz_session.option_data;

    const current_question = this.current_question;
    if(current_question == undefined || this.next_cycle == CYCLE_TYPE.ENDING) //제출할 퀴즈가 없으면 패스
    {
      return;
    }

    game_data['processing_question'] = this.current_question; //현재 제출 중인 퀴즈

    this.answers = current_question['answers'];
    const question = current_question['question'];

    logger.info(`Questioning Intro, guild_id:${this.quiz_session.guild_id}, question_num: ${game_data['question_num']+1}/${quiz_data['quiz_size']}, question: ${question}`);

    //오디오 재생 부분
    const resource = current_question['audio_resource'];
    const audio_play_time = (current_question['audio_length'] ?? option_data.quiz.audio_play_time) + 1000; //인트로 퀴즈는 1초 더 준다.

    this.startAudioList(resource); //인트로 퀴즈는 fadeIn, fadeout 안 쓴다.

    const wait_for_answer_time = 10000; //인트로 퀴즈는 문제 내고 10초 더 준다.
    //이건 단순히 progress_bar 띄우고 10초 브금 재생하는 역할이다.
    const wait_for_answer_timer = this.createWaitForAnswerTimer(audio_play_time, wait_for_answer_time, BGM_TYPE.COUNTDOWN_10);

    const timeover_time = audio_play_time + wait_for_answer_time;
    this.checkAutoHint(timeover_time); //자동 힌트 체크

    const timeover_promise = this.createTimeoverTimer(timeover_time); //노래 재생 + 10초 대기 시간 후에 실행되는 타임오버 타이머 만들어서
    await Promise.race([timeover_promise]); //race로 돌려서 타임오버 타이머가 끝나는걸 기다림

    //어쨋든 타임오버 타이머가 끝났다.
    if(this.quiz_session.force_stop == true) //그런데 강제종료다
    {
      return; //바로 return
    }

    if(this.is_timeover == false) //그런데 타임오버로 끝난게 아니다.
    {
      if(wait_for_answer_timer != undefined) //근데 카운트 다운이었다?
      {
        current_question['play_bgm_on_question_finish'] = true; //브금을 틀거다.
      }
      if(this.hasAnswerer()) //정답자가 있다?
      {
        this.next_cycle = CYCLE_TYPE.CORRECTANSWER; //그럼 정답으로~
      }
      else if(this.isSkipped()) //스킵이다?
      {
        this.next_cycle = CYCLE_TYPE.TIMEOVER; //그럼 타임오버로~
      }
    }
    else //타임오버거나 정답자 없다면
    {
      current_question['play_bgm_on_question_finish'] = true; //탄식을 보내주자~
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //타임오버로
    }
  }
}

module.exports = QuestionIntro;
