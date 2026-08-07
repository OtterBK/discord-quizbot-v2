'use strict';

//quiz_system.js에서 분리 (REFACTOR_PLAN.md Phase 2)
//QuizSession은 createCycle()에서 모든 lifecycle 클래스를 생성하는 허브라
//lifecycle/ 쪽 분리를 먼저 끝낸 뒤에야 안전하게 뗄 수 있었다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { joinVoiceChannel, createAudioPlayer, NoSubscriberBehavior, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');

const { CYCLE_TYPE, QUIZ_SESSION_TYPE } = require('../constants');
const session_registry = require('../session_registry');
const { SYSTEM_CONFIG, QUIZ_TYPE, QUIZ_MAKER_TYPE } = require('../../../config/system_setting.js');
const utility = require('../../../utility/utility.js');
const logger = require('../../../utility/logger.js')('QuizSystem');

const { InitializeDevQuiz, InitializeCustomQuiz, InitializeOmakaseQuiz, InitializeUnknownQuiz } = require('../lifecycle/initialize');
const Explain = require('../lifecycle/explain');
const Prepare = require('../lifecycle/prepare.js');
const QuestionSong = require('../lifecycle/question/question_song');
const QuestionImage = require('../lifecycle/question/question_image');
const QuestionIntro = require('../lifecycle/question/question_intro');
const QuestionText = require('../lifecycle/question/question_text');
const QuestionOX = require('../lifecycle/question/question_ox');
const QuestionCustom = require('../lifecycle/question/question_custom');
const QuestionOmakase = require('../lifecycle/question/question_omakase');
const QuestionUnknown = require('../lifecycle/question/question_unknown');
const CorrectAnswer = require('../lifecycle/correct_answer');
const TimeOver = require('../lifecycle/time_over');
const Clearing = require('../lifecycle/clearing');
const Ending = require('../lifecycle/ending');
const Finish = require('../lifecycle/finish');
const HOLD = require('../lifecycle/hold');

class QuizSession
{
  constructor(guild, owner, channel, quiz_info, quiz_session_type)
  {
    logger.info(`Creating ${quiz_session_type} Quiz Session, guild_id: ${guild.id}`);

    this.guild = guild;
    this.owner = owner;
    this.channel = channel;
    this.quiz_info = quiz_info;
    this.voice_channel = owner.voice.channel;

    this.guild_id = guild.id;
    this.quiz_ui = undefined; //직접 새로 UI만들자

    this.voice_connection = undefined;
    this.audio_player = undefined;

    this.lifecycle_map = {};
    this.current_cycle_type = CYCLE_TYPE.UNDEFINED;

    this.quiz_data = undefined; //얘는 처음 initialize 후 바뀌지 않는다.
    this.game_data = undefined; //얘는 자주 바뀐다.
    this.option_data = undefined; //옵션

    this.scoreboard = new Map(); //scoreboard 

    this.force_stop = false; //강제종료 여부

    this.ipv4 = undefined; 
    this.ipv6 = undefined; 

    this.already_liked = true; //이미 like 버튼 눌렀는지 여부. 기본 true 깔고 initializeCustom에서만 false 또는 true 다시 정함

    this.quiz_session_type = quiz_session_type;

    this.is_multiplayer_session = false;

    this.preparing = false;

    this.audio_playlist = []; //audio play 리스트(audio resource list라고 보면 되지)
    this.audio_play_term = 0; //각 audio 재생 간격
    this.audio_play_max_time = 0; //최대 audio 재생 시간
    this.audio_play_force_stop_timer = null;
    this.is_playing_audio_list = false;
  }

  free() //자원 해제
  {
    const guild_id = this.guild_id;

    this.audio_playlist = []; //audio play 리스트(그냥 audio resource list라고 보면 되지)
    if(this.audio_player)
    {
      this.audio_player.stop(true); //stop 걸어주고
    }

    let free_stream_count = 0;
    if(SYSTEM_CONFIG.explicit_close_audio_stream) //오디오 STREAM 명시적으로 닫음
    {
      const audio_stream_for_close = this.game_data['audio_stream_for_close'];
      if(audio_stream_for_close != undefined && audio_stream_for_close.length != 0)
      {
        audio_stream_for_close.forEach((audio_stream_array) => 
        {
          audio_stream_array.forEach((audio_stream) => 
          {
            if(audio_stream == undefined) return;

            if(audio_stream.closed == false)
              audio_stream.close();
            if(audio_stream.destroyed == false)
              audio_stream.destroy();

            ++free_stream_count;
          });
        });
        audio_stream_for_close.splice(0, audio_stream_for_close.length);
      }
    }
    logger.debug(`free stream count, ${free_stream_count}`);

    for(const cycle of Object.values(this.lifecycle_map))
    {
      // cycle.free();
    }

    delete session_registry.quiz_session_map[this.guild_id];

    this.guild = null;
    this.owner = null;
    this.channel = null;
    this.quiz_info = null;
    this.voice_channel = null;

    this.quiz_ui = null; //직접 새로 UI만들자

    this.voice_connection = null;
    this.audio_player = null;

    this.lifecycle_map = null;

    this.quiz_data = null; //얘는 처음 initialize 후 바뀌지 않는다.
    this.game_data = null; //얘는 자주 바뀐다.
    this.option_data = null; //옵션

    this.scoreboard = null; //scoreboard 

    this.ipv4 = null;
    this.ipv6 = null;

    this.already_liked = null;

    this.quiz_session_type = null;

    logger.info(`Free Quiz Session, guild_id: ${this.guild_id}`);
  }

  createCycle()
  {
    const quiz_info = this.quiz_info;
    this.cycle_info = '';

    const quiz_maker_type = quiz_info['quiz_maker_type'];
    //Initialize 단계 선택
    if(quiz_maker_type == QUIZ_MAKER_TYPE.BY_DEVELOPER)
    {
      this.inputLifeCycle(CYCLE_TYPE.INITIALIZING, new InitializeDevQuiz(this));
    }
    else if(quiz_maker_type == QUIZ_MAKER_TYPE.CUSTOM)
    {
      this.inputLifeCycle(CYCLE_TYPE.INITIALIZING, new InitializeCustomQuiz(this));
    }
    else if(quiz_maker_type == QUIZ_MAKER_TYPE.OMAKASE)
    {
      this.inputLifeCycle(CYCLE_TYPE.INITIALIZING, new InitializeOmakaseQuiz(this));
    }
    else
    {
      this.inputLifeCycle(CYCLE_TYPE.INITIALIZING, new InitializeUnknownQuiz(this));
    }

    this.inputLifeCycle(CYCLE_TYPE.EXPLAIN, new Explain(this));

    this.inputLifeCycle(CYCLE_TYPE.PREPARE, new Prepare(this));

    //Questioning 단계 선택

    const quiz_type = quiz_info['quiz_type'];
    switch(quiz_type)
    {
    case QUIZ_TYPE.SONG: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionSong(this)); break;
    case QUIZ_TYPE.IMAGE: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionImage(this)); break;
    case QUIZ_TYPE.INTRO: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionIntro(this)); break;
    case QUIZ_TYPE.SCRIPT: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionIntro(this)); break;
    case QUIZ_TYPE.IMAGE_LONG: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionImage(this)); break;
    case QUIZ_TYPE.TEXT: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionText(this)); break;
    case QUIZ_TYPE.TEXT_LONG: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionText(this)); break;
    case QUIZ_TYPE.OX: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionOX(this)); break;
    case QUIZ_TYPE.OX_LONG: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionOX(this)); break;

    case QUIZ_TYPE.CUSTOM: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionCustom(this)); break;
    case QUIZ_TYPE.OMAKASE: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionOmakase(this)); break;

    default: this.inputLifeCycle(CYCLE_TYPE.QUESTIONING, new QuestionUnknown(this));            
    }

    this.inputLifeCycle(CYCLE_TYPE.CORRECTANSWER, new CorrectAnswer(this));
    this.inputLifeCycle(CYCLE_TYPE.TIMEOVER, new TimeOver(this));
    this.inputLifeCycle(CYCLE_TYPE.CLEARING, new Clearing(this));

    //이 아래는 공통
    this.inputLifeCycle(CYCLE_TYPE.ENDING, new Ending(this));
    this.inputLifeCycle(CYCLE_TYPE.FINISH, new Finish(this));

    this.inputLifeCycle(CYCLE_TYPE.HOLD, new HOLD(this));

    logger.info(`Created Cycle of Quiz Session, guild_id: ${this.guild_id}, Cycle: ${this.cycle_info}`);
  }

  inputLifeCycle(cycle_type, cycle)
  {
    this.cycle_info += `${cycle.constructor.name} -> `;
    this.lifecycle_map[cycle_type] = cycle;
  }

  cycleLoop() //비동기로 처리해주자
  {
    this.goToCycle(CYCLE_TYPE.INITIALIZING);
  }

  getCycle(cycle_type)
  {
    if(this.lifecycle_map?.hasOwnProperty(cycle_type) == false)
    {
      return undefined;
    }
    return this.lifecycle_map[cycle_type];
  }

  getCurrentCycle()
  {
    const cycle = this.lifecycle_map[this.current_cycle_type];
    if(cycle === undefined)
    {
      logger.error(`get current cycle is undefined!. cycle_type: ${this.current_cycle_type}}`);
    }

    return cycle;
  }

  goToCycle(cycle_type)
  {
    const target_cycle = this.getCycle(cycle_type);
    if(target_cycle == undefined)
    {
      logger.error(`Failed to go to cycle, guild_id:${this.guild_id}, cycle_type: ${cycle_type}, cycle_info: ${this.cycle_info}`);
      return;
    }
    this.current_cycle_type = cycle_type;
    target_cycle.do();
  }

  async forceStop() //세션에서 강제 종료 시,
  {
    this.force_stop = true;
    const current_cycle_type = this.current_cycle_type;
    logger.info(`Call force stop quiz session, guild_id: ${this.guild_id}, current cycle type: ${current_cycle_type}`);

    if(this.isMultiplayerSession())
    {
      this.sendLeave();
    }

    const cycle = this.getCycle(current_cycle_type);
    cycle?.forceStop();
  }

  /** 세션 이벤트 핸들링 **/
  on(event_name, event_object)
  {
    const current_cycle = this.getCurrentCycle();
    if(current_cycle == undefined)
    {
      return;
    }
    current_cycle.on(event_name, event_object);
  }

  sendMessage(message)
  {
    this.channel.send(message);
  }

  sendMultiplayerSignal(signal)
  {
    //ipc_manager.js가 다시 quiz_system.js를 require하는 순환참조가 있어서
    //(REFACTOR_PLAN.md Phase 2에서 quiz_session.js를 분리하며 새로 생긴 경로),
    //모듈 최상단이 아니라 실제 호출 시점에 지연 require해서 로드 순서 문제를 피한다.
    const ipc_manager = require('../../managers/ipc_manager');
    signal.guild_id = this.guild_id;
    return ipc_manager.sendMultiplayerSignal(signal);
  }

  createVoiceConnection()
  {
    const guild = this.guild;
    const voice_channel = this.voice_channel;

    //보이스 커넥션
    const voice_connection = joinVoiceChannel({
      channelId: voice_channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
    });
    logger.info(`Joined Voice channel, guild_id:${this.guild_id}, voice_channel_id:${voice_channel.id}`);

    //보이스 끊겼을 때 핸들링
    voice_connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => 
    {

      if(this.force_stop == true || this.current_cycle_type == CYCLE_TYPE.FINISH) //강종이나 게임 종료로 끊긴거면
      {
        return;
      }

      try 
      {
        //우선 끊어졌으면 재연결 시도를 해본다.
        logger.info(`Try voice reconnecting..., guild_id:${this.guild_id}`);
        await Promise.race([
          entersState(voice_connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(voice_connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      }
      catch (error) 
      {
        //근데 정말 연결 안되면 강제 종료한다.
        logger.info(`Failed to voice reconnecting, force stop this quiz session, guild_id:${this.guild_id}`);
        try
        {
          voice_connection.destroy();
        }
        catch(error) 
        {
          return;
        }
                
        await this.forceStop();
      }
    });
		
    //보이스 커넥션 생성 실패 문제 해결 방안 https://github.com/discordjs/discord.js/issues/9185, https://github.com/umutxyp/MusicBot/issues/97
    const networkStateChangeHandler = (oldNetworkState, newNetworkState) => 
    {
      const newUdp = Reflect.get(newNetworkState, 'udp');
      clearInterval(newUdp?.keepAliveInterval);
    };

    voice_connection.on('stateChange', (oldState, newState) => 
    {
      const oldNetworking = Reflect.get(oldState, 'networking');
      const newNetworking = Reflect.get(newState, 'networking');

      oldNetworking?.off('stateChange', networkStateChangeHandler);
      newNetworking?.on('stateChange', networkStateChangeHandler);
    });

    const audio_player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Stop,
      },
    });
    voice_connection.subscribe(audio_player);

    this.voice_connection = voice_connection;
    this.audio_player = audio_player;

    this.audio_player.on(AudioPlayerStatus.Idle, () =>
    {
      this.playNextAudio();
    });
  }

  async playNextAudio()
  {
    if(this.audio_play_force_stop_timer) //강제 중지 타이머 취소
    {
      clearTimeout(this.audio_play_force_stop_timer);
    }
    
    if(!this.audio_playlist || this.audio_playlist.length === 0) //재생할게 없음
    {
      this.is_playing_audio_list = false;
      return; 
    }

    const audio_resource = this.audio_playlist.pop(); //하나 꺼내고
    if(this.audio_play_term > 0) //텀 있으면 지키고
    {
      await utility.sleep(this.audio_play_term);
    }
    
    this.is_playing_audio_list = true;
    this.audio_player.play(audio_resource);

    if(this.audio_play_max_time > 0) //최대 재생 길이있으면 강제 타이머 만들어주고
    {
      this.audio_play_force_stop_timer = setTimeout(() =>
      {
        if(this.is_playing_audio_list === false) //이미 플레이리스트 재생 중지라면
        {
          return;
        }

        this.audio_player.stop();
      }, this.audio_play_max_time);
    }
  }

  isMultiplayerSession()
  {
    return this.is_multiplayer_session;
  }

  hasMoreQuestion()
  {
    return this.game_data['question_num'] < this.quiz_data['quiz_size'];
  }
}

class NormalQuizSession extends QuizSession
{
  constructor(guild, owner, channel, quiz_info)
  {
    super(guild, owner, channel, quiz_info, QUIZ_SESSION_TYPE.NORMAL);

    //퀴즈 타입에 따라 cycle을 다른걸 넣어주면된다.
    //기본 LifeCycle 동작은 다음과 같다
    //Initialize ->
    //EXPLAIN ->
    //Prepare -> if quiz_finish Ending else -> Question
    //Question ->
    //(CorrectAnswer 또는 Timeover) -> Question

    this.createCycle(); //Normal 은 바로 시작
    this.cycleLoop();
  } 
}

class DummyQuizSession extends QuizSession
{
  constructor(guild, owner, channel, quiz_info, quiz_session_type=QUIZ_SESSION_TYPE.DUMMY)
  {
    super(guild, owner, channel, quiz_info, quiz_session_type); //dummy 세션으로 생성

    //DUMMY도 이 정도는 넣어주자
    this.inputLifeCycle(CYCLE_TYPE.HOLD, new HOLD(this));
    this.inputLifeCycle(CYCLE_TYPE.FINISH, new Finish(this)); 

    this.goToCycle(CYCLE_TYPE.HOLD);
  } 
}

module.exports = { QuizSession, NormalQuizSession, DummyQuizSession };
