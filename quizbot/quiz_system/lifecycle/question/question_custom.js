'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//로직/주석은 원본과 동일 (동작 변경 없음).

const Question = require('./question.js');
const { CYCLE_TYPE } = require('../../constants');
const { SYSTEM_CONFIG, BGM_TYPE } = require('../../../../config/system_setting.js');
const logger = require('../../../../utility/logger.js')('QuizSystem');
const feedback_manager = require('../../../managers/feedback_manager');

//Custom Type Question
/** 23.11.16 답이 없다... 리팩터링 안할거면 걍 유지보수 포기하자*/
class QuestionCustom extends Question
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
    logger.info(`Questioning Custom, guild_id:${this.quiz_session.guild_id}, question_num: ${question_num + 1}/${quiz_size}, question_id: ${question_id}`);

    if(this.quiz_session.already_liked == false && question_num == Math.floor(quiz_size / 2)) //절반 정도 했을 때
    {
      const channel = this.quiz_session.channel;
      channel.send({
        embeds: 
                [{ 
                  color: 0x05f1f1, 
                  title: `**${quiz_data['title']}**`,
                  description:  "퀴즈를 재밌게 플레이하고 계신가요? 😀\n진행 중인 퀴즈가 마음에 드신다면 **[추천하기]**를 눌러주세요!\n\n`일정 수 이상의 추천을 받은 퀴즈는 [오마카세/멀티플레이] 퀴즈에서 사용됩니다.`"
                }], 
        components: [ feedback_manager.quiz_feedback_comp ]
      });
    }

    //이미지 표시
    const image_resource = current_question['image_resource'];
    let quiz_ui = this.quiz_session.quiz_ui; 
    quiz_ui.setImage(image_resource);

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
    let total_audio_play_time = (audio_play_time * question_audio_repeat) + (500 * (question_audio_repeat - 1)); //500은 재생 텀. -1 해줘야한다. total_audio_play_time 이 0이여야 자동 타이머가 실행됨...
    
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
        total_audio_play_time = 0; //오디오 재생 시간 0초로 변경 -> 브금 재생
        audio_error_occurred = true;
      }
    }
        
    if(audio_error_occurred == true) //에러 발생 시, 음악만 바꾼다. (오디오 용도가 그냥 브금이었을 수도 있으니깐)
    {
      logger.warn(`Audio error occurred on Custom Quiz! Play failover bgm. guild_id: ${this.quiz_session.guild_id}`);

      this.progress_bar_fixed_text += `\n😭 오디오 추출에 실패하여 임시 BGM을 대신 재생합니다.`;

      this.is_playing_bgm = true;
      total_audio_play_time = 11000; //오디오 재생 시간 11초로 변경
      this.sendBGM(BGM_TYPE.FAILOVER); //failover용 브금(오디오 다운로드할 시간 벌기)
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

    if(this.selected_choice_map != undefined) //혹시나 객관식 선택형 답안 제출자가 있다...?
    {
      const selected_choice_map = this.selected_choice_map;
      const iter = selected_choice_map.entries();
      const score = 1; //객관식은 1점 고정

      for(let i = 0; i < selected_choice_map.size; ++i)
      {
        const [member, selected_value] = iter.next().value;
                
        if(this.answers.includes(selected_value) == false)
        {
          continue;
        }

        this.applyCorrectAnswer(member.id, member.displayName, score);
      }
    }

    if(this.hasAnswerer()) //뭐라도 정답자가 있다?
    {
      this.next_cycle = CYCLE_TYPE.CORRECTANSWER; //그럼 정답으로~
    }
    else if(this.isSkipped()) //정답자도 없고 스킵이다?
    {
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //그럼 타임오버로~
    }
    else //그냥 타임오버다?
    {
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //그래도 타임오버로~
    }

    if(this.is_timeover) //타임오버로 끝났다?
    {
      this.is_playing_bgm = true; //브금 틀어버려
    }

    if(this.is_playing_bgm) //브금 재생 중이었다면
    {
      current_question['play_bgm_on_question_finish'] = true; //탄식이나 박수를 보내주자~
    }
  }
}

module.exports = QuestionCustom;
