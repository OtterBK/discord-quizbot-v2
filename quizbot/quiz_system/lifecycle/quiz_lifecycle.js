'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//모든 lifecycle 클래스(Initialize, Explain, Prepare, Question 등)의 공통 베이스.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { CYCLE_TYPE } = require('../constants.js');
const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE } = require('../../../config/system_setting.js');
const option_system = require('../../quiz_option/quiz_option.js');
const OPTION_TYPE = option_system.OPTION_TYPE;
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const utility = require('../../../utility/utility.js');
const logger = require('../../../utility/logger.js')('QuizSystem');
const feedback_manager = require('../../managers/feedback_manager.js');

//#region 퀴즈 cycle 용 lifecycle의 base
class QuizLifeCycle
{
  static cycle_type = CYCLE_TYPE.UNDEFINED;

  constructor(quiz_session)
  {
    // this.quiz_session = weak(quiz_session); //strong ref cycle 떄문에 weak 타입으로
    this.quiz_session = quiz_session; //weak이 얼마나 성능에 영향을 미칠 지 모르겠다. 어차피 free()는 어지간해서 타니깐 이대로하자
    this.force_stop = false;
    this.next_cycle = CYCLE_TYPE.UNDEFINED;
    this.ignore_block = false;
  }

  free()
  {
    // this.quiz_session = null;
  }

  do()
  {
    this._enter();
  }

  async asyncCallCycle(cycle_type) //비동기로 특정 cycle을 호출, PREPARE 같은거
  {
    // logger.debug(`Async call cyle from quiz session, guild_id: ${this.guild_id}, target cycle Type: ${cycle_type}`);
    if(this.quiz_session?.force_stop == true) return;

    const cycle = this.quiz_session.getCycle(cycle_type);
    if(cycle != undefined)
    {
      cycle.do();
    }
  }

  async _enter() //처음 Cycle 들어왔을 때
  {
    let goNext = true;
    if(this.enter != undefined) 
    {
      try
      {
        goNext = (await this.enter()) ?? true;    
      }
      catch(err)
      {
        if(this.force_stop == false)
          logger.error(`Failed enter step of quiz session cycle, guild_id: ${this.quiz_session?.guild_id}, current cycle Type: ${this.quiz_session?.current_cycle_type}, current cycle: ${this.constructor.name}, err: ${err.stack}`);
      }
    }

    if(this.force_stop == true || this.quiz_session?.force_stop == true)
    {
      goNext = false;
    }

    if(goNext == false && this.ignore_block == false) return;
    this._act();
  }

  async _act() //Cycle 의 act
  {
    let goNext = true;
    if(this.act != undefined) 
    {
      try
      {
        goNext = (await this.act()) ?? true;    
      }
      catch(err)
      {
        if(this.force_stop == false)
          logger.error(`Failed act step of quiz session cycle, guild_id: ${this.quiz_session?.guild_id}, current cycle Type: ${this.quiz_session?.current_cycle_type}, current cycle: ${this.constructor.name}, err: ${err.stack}`);
      }
    }

    if(this.force_stop == true || this.quiz_session?.force_stop == true)
    {
      goNext = false;
    }

    if(goNext == false && this.ignore_block == false) return;
    this._exit();
  }

  async _exit() //Cycle 끝낼 때
  {
    let goNext = true;
    if(this.exit != undefined) 
    {
      try
      {
        goNext = (await this.exit()) ?? true;    
      }
      catch(err)
      {
        if(this.force_stop == false)
          logger.error(`Failed exit step of quiz session cycle, guild_id: ${this.quiz_session?.guild_id}, current cycle Type: ${this.quiz_session?.current_cycle_type}, current cycle: ${this.constructor.name}, err: ${err.stack}`);
      }
    }

    if(this.force_stop == true || this.quiz_session?.force_stop == true)
    {
      goNext = false;
    }

    if(goNext == false && this.ignore_block == false) return;

    if(this.next_cycle == CYCLE_TYPE.UNDEFINED) //다음 Lifecycle로
    {
      return;
    }        
    this.quiz_session.goToCycle(this.next_cycle);
  }

  async forceStop(do_exit = true)
  {
    logger.info(`Call force stop quiz session on cycle, guild_id: ${this.quiz_session.guild_id}, current cycle type: ${this.quiz_session.current_cycle_type}, current cycle: ${this.constructor.name}`);
    this.quiz_session.force_stop = true;
    this.force_stop = true;
    this.next_cycle == CYCLE_TYPE.UNDEFINED;

    if(this.exit != undefined && do_exit)
    {
      this.exit(); //바로 현재 cycle의 exit호출
    }
    this.quiz_session.goToCycle(CYCLE_TYPE.FINISH); //바로 FINISH로
  }

  //이벤트 처리(비동기로 해도 무방)
  async on(event_name, event_object)
  {
    switch(event_name) 
    {
    case CUSTOM_EVENT_TYPE.interactionCreate:
      if(event_object.isButton() && event_object.customId === 'force_stop')  //강제 종료는 여기서 핸들링
      {
        let interaction = event_object;
        if(interaction.member != this.quiz_session.owner)
        {
          const reject_message = '```' + `${text_contents.quiz_play_ui.only_owner_can_use_stop}` +'```';
          interaction.channel.send({content: reject_message});
          return;
        }
        this.quiz_session.forceStop();
        let force_stop_message = text_contents.quiz_play_ui.force_stop;
        force_stop_message = force_stop_message.replace("${who_stopped}", utility.sanitizeName(interaction.member.user.username));
        interaction.channel.send({content: force_stop_message});
        return;
      }

      if(event_object.isButton() && this.quiz_session.already_liked == false && event_object.customId == 'like') //추천하기 버튼 눌렀을 때
      {
        const interaction = event_object;
        const quiz_info = this.quiz_session.quiz_info;

        feedback_manager.addQuizLikeAuto(interaction, quiz_info.quiz_id, quiz_info.title);
        // this.quiz_session.already_liked = true; //유저별 추천 가능이라 무조건 계속 띄우게 변경

        return;
      }

      return this.onInteractionCreate(event_object);

    case CUSTOM_EVENT_TYPE.messageCreate:
      return this.onMessageCreate(event_object);

    case CUSTOM_EVENT_TYPE.receivedMultiplayerSignal:
      return this.onReceivedMultiplayerSignal(event_object);
            
    }
  }

  /** 커스텀 이벤트 핸들러 **/
  onInteractionCreate(interaction)
  {

  }

  onMessageCreate(message)
  {

  }

  onReceivedMultiplayerSignal(multiplayer_signal)
  {

  }
}

class QuizLifeCycleWithUtility extends QuizLifeCycle //여러 기능을 포함한 class, 
{
  //오디오 재생
  /** Deprecated */
  /**
  async startAudio(audio_player, resource, use_fade_in = true)
  {
    const fade_in_duration = SYSTEM_CONFIG.FADE_IN_DURATION;
    if(SYSTEM_CONFIG.USE_INLINE_VOLUME) 
    {
      if(use_fade_in)
      {
        utility.fade_audio_play(audio_player, resource, 0.1, 1.0, fade_in_duration);
        return Date.now() + fade_in_duration;  //
      }

      if(resource.volume != undefined)
        resource.volume.setVolume(1.0);
    }
        
    audio_player.play(resource); 
    return undefined;
  }
  */

  startAudioList(resources, term = 0, fixed_play_time = null)
  {
    const audio_player = this.quiz_session.audio_player;
    if(!audio_player)
    {
      return;
    }

    this.quiz_session.audio_playlist = resources ?? [];
    this.quiz_session.audio_play_term = term;
    this.quiz_session.audio_play_max_time = fixed_play_time;

    this.quiz_session.playNextAudio();
  }

  stopAudioList(force=false)
  {
    const audio_player = this.quiz_session.audio_player;
    if(!audio_player)
    {
      return;
    }

    this.quiz_session.is_playing_audio_list = false;

    this.quiz_session.audio_playlist = [];
    this.quiz_session.audio_play_term = 0;
    this.quiz_session.audio_play_max_time = 0;

    return audio_player.stop(force);
  }

  sendBGM(bgm_type)
  {
    this.stopAudioList();
    utility.playBGM(this.quiz_session.audio_player, bgm_type);
  }

  //스코어보드 fields 가져오기
  getScoreboardFields()
  {
    const option_data = this.quiz_session.option_data;
    let scoreboard = this.quiz_session.scoreboard;
    let scoreboard_fields = [];

    if(scoreboard.size == 0)
    {
      return scoreboard_fields;
    }
        
    scoreboard = utility.sortMapByProperty(scoreboard, 'score'); //우선 정렬 1번함
    this.quiz_session.scoreboard = scoreboard;

    scoreboard_fields.push(
      {
        name: text_contents.scoreboard.title,
        value: ' \n',
      },
      // {
      //     name: '\u200b',
      //     value: '\u200b',
      //     inline: false,
      // },
    );

    const show_count = option_data.quiz.score_show_max == OPTION_TYPE.UNLIMITED ? scoreboard.size : Math.min(option_data.quiz.score_show_max, scoreboard.size);

    const iter = scoreboard.entries();
    for(let i = 0; i < show_count; ++i)
    {
      const [answerer_id, answerer_info] = iter.next().value;

      let answerer_name = answerer_info.name;

      if(this.quiz_session.isMultiplayerSession())
      {
        const guild_info = this.quiz_session.getParticipant(answerer_id);
        if(guild_info !== undefined)
        {
          answerer_name = guild_info.guild_name;
        }
      }

      scoreboard_fields.push({
        name: answerer_name,
        value: `${answerer_info.score}${text_contents.scoreboard.point_name}`,
        inline: true
      });
    }

    return scoreboard_fields;
  }

  //target_question에서 정답 표시용 노래 꺼내서 재생
  async applyAnswerAudioInfo(target_question)
  {
    let audio_play_time = undefined;

    if(!target_question['answer_audio_resource']) //정답 표시용 음악 없다면 패스
    {
      return audio_play_time;
    }

    const audio_resource = target_question['answer_audio_resource'];
    audio_play_time = target_question['answer_audio_play_time'];

    this.startAudioList(audio_resource); //오디오 재생

    return audio_play_time;
  }

  //target_question에서 정답 표시용 이미지 정보 꺼내서 세팅
  applyAnswerImageInfo(target_question)
  {
    let quiz_ui =  this.quiz_session.quiz_ui;
    if(target_question['answer_image_resource'] == undefined) //정답 표시용 이미지 있다면 표시
    {
      quiz_ui.setImage(undefined);
      return false;
    }
    const image_resource = target_question['answer_image_resource'];
    quiz_ui.setImage(image_resource);
    return true;
  }

  //페이드 아웃 자동 시작
  /** Deprecated */
  /**
  async autoFadeOut(audio_player, resource, audio_play_time)
  {
    if(SYSTEM_CONFIG.USE_INLINE_VOLUME == false)
    {
      return;
    }

    const fade_in_duration = SYSTEM_CONFIG.FADE_IN_DURATION;
    const fade_out_duration = SYSTEM_CONFIG.FACE_OUT_DURATION;
    let fade_out_start_offset = audio_play_time - fade_out_duration - 1000; //해당 지점부터 fade_out 시작, 부드럽게 1초 정도 간격두자
    if(fade_out_start_offset < fade_in_duration)
    {
      fade_out_start_offset = fade_in_duration;
    }

    //일정시간 후에 fadeout 시작
    const fade_out_timer = setTimeout(() => 
    {
      this.already_start_fade_out = true;
      if(resource == undefined || resource.volume == undefined) return;
      utility.fade_audio_play(audio_player, resource, resource.volume.volume, 0, fade_out_duration);
    }, fade_out_start_offset);

    this.fade_out_timer = fade_out_timer;
  }
  */
}
//#endregion

module.exports = { QuizLifeCycle, QuizLifeCycleWithUtility };
