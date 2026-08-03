'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const Question = require('./question.js');
const { CYCLE_TYPE } = require('../../constants.js');
const { SYSTEM_CONFIG, BGM_TYPE } = require('../../../../config/system_setting.js');
const utility = require('../../../../utility/utility.js');
const logger = require('../../../../utility/logger.js')('QuizSystem');

//Omakase Type Question
class QuestionOmakase extends Question
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session)
  {
    super(quiz_session);

    this.is_playing_bgm = false;
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
    const question_id = current_question['question_id'];

    const question_num = game_data['question_num'];
    const quiz_size = quiz_data['quiz_size'];
    logger.info(`Questioning ${this.quiz_session.isMultiplayerSession() ? 'Multiplayer ' : ''}Omakase, guild_id:${this.quiz_session.guild_id}, question_num: ${question_num + 1}/${quiz_size}, question_id: ${question_id ?? current_question['question']}`);

    //이미지 표시
    const image_resource = current_question['image_resource'];
    let quiz_ui = this.quiz_session.quiz_ui; 
    quiz_ui.setImage(image_resource);

    //오마카세 퀴즈 전용
    quiz_ui.setTitle(`[ ${quiz_data['icon']} ${current_question['question_title']} ]`);
    
    if(question_id !== undefined) //question_id가 있다면 커스텀 퀴즈다
    {
      // quiz_ui.components.push(feedback_manager.quiz_feedback_comp); //추천 버튼 추가
    }

    if(image_resource != undefined)
    {
      await quiz_ui.update(); //await로 대기 해줘야한다. 안그러면 타이밍 이슈 땜에 이미지가 2번 올라간다.
    }

    //텍스트 표시
    const question_text = current_question['question_text'];
    this.progress_bar_fixed_text = question_text; //텍스트 퀴즈는 progress bar 위에 붙여주면 된다.

    //오디오 재생
    const audio_player = this.quiz_session.audio_player;
    const resource = current_question['audio_resource'];
    const audio_play_time = current_question['audio_length'] ?? 0;
    const question_audio_repeat = current_question['question_audio_repeat'] ?? 1;
    let total_audio_play_time = (audio_play_time * question_audio_repeat) + (500 * (question_audio_repeat - 1)); //500은 재생 텀

    total_audio_play_time = Math.min(total_audio_play_time, SYSTEM_CONFIG.MAX_QUESTION_TOTAL_AUDIO_PLAY_TIME * 1000);

    let audio_error_occurred = false;
    if(this.progress_bar_fixed_text?.includes('AUDIO_ERROR'))
    {
      audio_error_occurred = true;
    }

    if(audio_error_occurred == false && total_audio_play_time != 0) //오디오 재생해야하면
    {
      this.is_playing_bgm = false;

      try
      {
        this.startAudioList(resource, 500, audio_play_time);
      }
      catch(err)
      {
        audio_error_occurred = true;
      }
    } 

    if(audio_error_occurred == true) //오마카세 퀴즈에서는 에러 발생 시, 다음 문제로 다시 ㄱㄱ
    {
      logger.warn(`Audio error occurred on Omakase Quiz! Skip to next question. guild_id: ${this.quiz_session.guild_id}`);
      this.next_cycle = CYCLE_TYPE.CLEARING;
      game_data['question_num'] -= 1;
      this.sendBGM(BGM_TYPE.FAILOVER); //failover용 브금(오디오 다운로드할 시간 벌기)
      
      const error_message = `\`\`\`❗ 문제 제출 중 오디오 에러가 발생하여 다른 문제로 다시 제출합니다. 잠시만 기다려주세요.\n에러 메시지: ${this.progress_bar_fixed_text?.trim()}\`\`\``;

      this.quiz_session.sendMessage({content: error_message});

      await utility.sleep(11000); //Failover 브금 11초임 
            
      return;
    }

    if(total_audio_play_time == 0) //오디오 없으면 10초 타이머로 대체
    {
      this.is_playing_bgm = true;
      total_audio_play_time = 10000; //오디오 재생 시간 10초로 변경
      this.sendBGM(BGM_TYPE.COUNTDOWN_10); //10초 카운트다운 브금
    }

    this.startProgressBar(total_audio_play_time); //진행 bar 시작

    let timeover_time = total_audio_play_time;
    if(this.current_question['use_answer_timer'] == true) //타임 오버 돼도 10초의 여유를 준다면(인트로 퀴즈등)
    {
      const wait_for_answer_time = 10000; //인트로 퀴즈는 문제 내고 10초 더 준다.
      timeover_time += wait_for_answer_time; //타임오버 되기까지 10초 더 줌
      const wait_for_answer_timer = this.createWaitForAnswerTimer(total_audio_play_time, wait_for_answer_time, BGM_TYPE.COUNTDOWN_10); 
      //total_audio_play_time 이후에 wait_for_answer_time 만큼 추가 대기임
      this.checkAutoHint(total_audio_play_time*2); //자동 힌트 체크, 이 경우에는 음악 끝나면 바로 자동 힌트라는 뜻
    }
    else
    {
      this.checkAutoHint(timeover_time); //자동 힌트 체크
    }

    const timeover_promise = this.createTimeoverTimer(timeover_time); //total_audio_play_time 후에 실행되는 타임오버 타이머 만들어서
    await Promise.race([timeover_promise]); //race로 돌려서 타임오버 타이머가 끝나는걸 기다림

    //어쨋든 타임오버 타이머가 끝났다.
    if(this.quiz_session.force_stop == true) //그런데 강제종료다
    {
      return; //바로 return
    }

    if(this.is_timeover == false) //그런데 타임오버로 끝난게 아니다.
    {
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
      this.is_playing_bgm = true;
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //타임오버로
    }

    if(this.is_playing_bgm) //브금 재생 중이었다면
    {
      current_question['play_bgm_on_question_finish'] = true; //탄식이나 박수를 보내주자~
    }
  }
}

module.exports = QuestionOmakase;
