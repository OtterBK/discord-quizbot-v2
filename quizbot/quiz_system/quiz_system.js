'use strict';

//voice 용으로 libsodium-wrapper 를 쓸 것! sodium 으로 하면 cpu 사용량 장난아님;

//#region 외부 모듈 로드
const fs = require('fs');
const { joinVoiceChannel, createAudioPlayer, NoSubscriberBehavior, VoiceConnectionStatus, entersState, AudioPlayerStatus } = require('@discordjs/voice');
const { PermissionsBitField, TeamMemberMembershipState, MessageFlags } = require('discord.js');
const pathToFfmpeg = require('ffmpeg-static');
process.env.FFMPEG_PATH = pathToFfmpeg;
const cloneDeep = require("lodash/cloneDeep.js");
//#endregion

//#region 로컬 모듈 로드
const ipc_manager = require('../managers/ipc_manager.js');
const { CLIENT_SIGNAL, SERVER_SIGNAL } = require('../managers/multiplayer_signal.js');

const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE, QUIZ_TYPE, BGM_TYPE, QUIZ_MAKER_TYPE, ANSWER_TYPE } = require('../../config/system_setting.js');
const option_system = require("../quiz_option/quiz_option.js");
const OPTION_TYPE = option_system.OPTION_TYPE;
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE]; 
const utility = require('../../utility/utility.js');
const logger = require('../../utility/logger.js')('QuizSystem');
const feedback_manager = require('../managers/feedback_manager.js');
const {
  multiplayer_participant_select_menu,
  multiplayer_participant_select_row,
  multiplayer_chat_comp,
} = require("../quiz_ui/components.js");
const e = require('express');

//#endregion

//#region 상수 타입 정의
const { CYCLE_TYPE, QUIZ_SESSION_TYPE } = require('./constants.js');

exports.QUIZ_SESSION_TYPE = QUIZ_SESSION_TYPE;

//#endregion

//#region global 변수 정의
/** global 변수 **/
const session_registry = require('./session_registry.js');

//#endregion

//#region exports 정의
/** exports **/

exports.initialize = (client) =>
{
  if(client == undefined)
  {
    logger.error(`Failed to Initialize Quiz system. ${'Client is undefined'}`);
    return false;
  }
  session_registry.bot_client = client;

  return true;
};

exports.checkReadyForStartQuiz = (guild, owner) => 
{
  let result = false;
  let reason = '';
  if(!owner.voice.channel) //음성 채널 참가 중인 사람만 시작 가능
  {
    reason = text_contents.reason.no_in_voice_channel;
    return { 'result': result, 'reason': reason };
  }

  if(this.getQuizSession(guild.id) != undefined)
  {
    reason = text_contents.reason.already_ingame;
    return { 'result': result, 'reason': reason };
  }

  result = true;
  reason = text_contents.reason.can_play;
  return { 'result': result, 'reason': reason };
};

exports.getQuizSession = (guild_id) => 
{

  if(session_registry.quiz_session_map.hasOwnProperty(guild_id) == false)
  {
    return undefined;
  }

  return session_registry.quiz_session_map[guild_id];
};

exports.startQuiz = (guild, owner, channel, quiz_info, quiz_session_type=QUIZ_SESSION_TYPE.NORMAL) =>
{
  const guild_id = guild.id;

  let quiz_session = undefined;
  if(quiz_session_type === QUIZ_SESSION_TYPE.DUMMY)
  {
    quiz_session = new DummyQuizSession(guild, owner, channel, quiz_info);
  }
  else if(quiz_session_type === QUIZ_SESSION_TYPE.MULTIPLAYER_LOBBY)
  {
    quiz_session = new MultiplayerLobbySession(guild, owner, channel, quiz_info);
  }
  else if(quiz_session_type === QUIZ_SESSION_TYPE.MULTIPLAYER)
  {
    quiz_session = new MultiplayerQuizSession(guild, owner, channel, quiz_info);
  }
  else if(quiz_session_type === QUIZ_SESSION_TYPE.NORMAL)
  {
    quiz_session = new NormalQuizSession(guild, owner, channel, quiz_info);
  }

  session_registry.replaceSession(guild_id, quiz_session);

  return quiz_session;
};

exports.getLocalQuizSessionCount = () => 
{
  return Object.keys(session_registry.quiz_session_map).length;
};

exports.getMultiplayerQuizSessionCount = () => 
{
  let multiplayer_session_count = 0;
  for(const quiz_session of Object.values(session_registry.quiz_session_map))
  {
    if(quiz_session.isMultiplayerSession())
    {
      ++multiplayer_session_count;
    }
  }

  return multiplayer_session_count; 
};

exports.startFFmpegAgingManager = () => 
{
  return ffmpegAgingManager();
};

exports.relayMultiplayerSignal = (multiplayer_signal) => //관련 세션에 멀티플레이 신호 전달
{
  let handled = false; //한 곳이라도 handle 했으면 한거임
  const guild_ids = multiplayer_signal.guild_ids;
  for(const guild_id of guild_ids)
  {
    const quiz_session = session_registry.quiz_session_map[guild_id];
    if(quiz_session != undefined)
    {
      try
      {
        handled = quiz_session.on(CUSTOM_EVENT_TYPE.receivedMultiplayerSignal, multiplayer_signal);
      }
      catch(err)
      {
        logger.error(`Quiz system Relaying multiplayer Signal error occurred! ${err.stack}`);
      }
    }
  }

  return handled;
};

exports.forceStopSession = (guild) => 
{
  logger.info(`${guild.id} called force stop session`);

  const guild_id = guild.id;
  const quiz_session = session_registry.quiz_session_map[guild_id];

  delete session_registry.quiz_session_map[guild_id];

  if(quiz_session != undefined)
  {
    quiz_session.forceStop();
    logger.debug(`destroy quiz_session by force stop ${guild.id}`);
  }

  const voice_state = guild.members.me.voice;
  if(voice_state && voice_state.channel)
  {
    voice_state.disconnect();
    logger.debug(`disconnected voice state by force stop ${guild.id}`);
  }
};

let ffmpeg_aging_map = new Map();
//FFmpeg Aging Manager
function ffmpegAgingManager() //TODO ps-node 모듈을 이용한 방식으로 수정해야함
{
  const ffmpeg_aging_for_oldkey_value = SYSTEM_CONFIG.FFMPEG_AGING_MANAGER_CRITERIA * 1000; //last updated time이 일정 값 이전인 ffmpeg는 종료할거임
  const ffmpeg_aging_manager = setInterval(()=>
  {
      
    const criteria_value = Date.now() - ffmpeg_aging_for_oldkey_value; //이거보다 이전에 update 된 것은 삭제
    logger.info(`Aginging FFmpeg... targets: ${ffmpeg_aging_map.size} ,criteria: ${criteria_value}`);

    let kill_count = 0;

    const iter = ffmpeg_aging_map.entries();
    const target_keys = [];
    for(let i = 0; i < ffmpeg_aging_map.size; ++i)
    {
      const [ffmpeg_handler, created_date] = iter.next().value;
      if(created_date < criteria_value)
      {
        ffmpeg_handler.kill();
        ++kill_count;
        target_keys.push(ffmpeg_handler);
      }
    }

    target_keys.forEach(key => 
    {
      ffmpeg_aging_map.delete(key);
    });

    logger.info(`Done FFmpeg aging manager... kill count: ${kill_count}`);
  }, SYSTEM_CONFIG.FFMPEG_AGING_MANAGER_INTERVAL * 1000); //체크 주기

  return ffmpeg_aging_manager;
}

//#region 퀴즈 플레이에 사용될 UI
//quiz_play_ui.js로 분리 (REFACTOR_PLAN.md Phase 2)
const QuizPlayUI = require('./quiz_play_ui.js');
//#endregion


//#region 퀴즈 게임용 세션
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

const MULTIPLAYER_STATE =
{
  LOBBY: 'LOBBY',
  INITIALIZING: 'initializing',
  WAITING_FOR_QUESTION_LIST: 'waiting_for_question_list',
  QUESTION_LIST_READY: 'question_list_ready',
  WAITING_FOR_NEXT_QUESTION: 'waiting_for_next_question',
  NEXT_QUESTION_READY: 'next_question_ready',
  WAITING_FOR_SYNC_DONE: 'waiting_for_sync_done',
  QUESTIONING: 'questioning',
  FINISH_UP: 'finish_up',
};


//MULTIPLAYER_COMMON_OPTION은 constants.js로 이동 (REFACTOR_PLAN.md Phase 2, Initialize에서도 필요해서 공용화)

//Mix in 패턴. Base 클래스 달라도 공통 함수 정의하기 위해 사용
const MultiplayerSessionMixin = Base => class extends Base 
{
  constructor(...args)
  {
    super(...args);

    this.is_multiplayer_session = true;

    this.session_id = undefined;
    this.ignore_chat = false; 

    this.participant_guilds_info = undefined;

    this.sync_ready = false;
    this.sync_failed = false;
    this.leaved = false;

    this.session_expired = false;

    this.multiplayer_state = undefined;
  }

  setSessionId(session_id)
  {
    this.session_id = session_id;
  }

  setIgnoreChat(value, who=undefined)
  {
    this.ignore_chat = value;

    if(who === undefined)
    {
      return;
    }

    if(this.isIgnoreChat())
    {
      this.sendMessage(`\`\`\`🔸 ${utility.sanitizeName(who)} 님이 전체 채팅을 껐습니다.\n'/채팅전환' 명령어로 켜거나 끌 수 있습니다.\`\`\``);
    }
    else
    {
      this.sendMessage(`\`\`\`🔸 ${utility.sanitizeName(who)} 님이 전체 채팅을 켰습니다.\`\`\``);
    }
  }

  toggleIgnoreChat(who=undefined)
  {
    this.setIgnoreChat(!this.ignore_chat, who);

    return this.isIgnoreChat();
  }

  isIgnoreChat()
  {
    return this.ignore_chat;
  }

  isMultiplayerSessionExpired()
  {
    return this.session_expired;
  }

  isHostSession()
  {
    return this.session_id === this.guild_id;
  }

  isIngame()
  {
    return this.multiplayer_state !== MULTIPLAYER_STATE.LOBBY;
  }

  isLeavedGame()
  {
    return this.leaved;
  }

  getParticipant(guild_id)
  {
    for(const guild_info of this.participant_guilds_info)
    {
      if(guild_info.guild_id === guild_id)
      {
        return guild_info;
      }
    }

    return undefined;
  }

  sendSignal(signal, handle_failed=true)
  {
    if(this.isMultiplayerSessionExpired())
    {
      return;
    }

    if(this.sync_failed || this.leaved)
    {
      return;
    }

    signal.guild_id = this.guild_id;
    signal.session_id = this.session_id;

    ipc_manager.sendMultiplayerSignal(
      signal
    )
      .then(result =>
      {
        if(handle_failed === false)
        {
          return;
        }

        if(result.state === false)
        {
          this.sendMessage(`\`\`\`🔸 요청 전송에 실패했습니다. 멀티플레이 퀴즈를 종료합니다.\n원인: ${result.reason}\`\`\``);
          this.syncFailed();
        }
      });
  }

  syncFailed()
  {
    this.sendMessage({content:`\`\`\`🌐 멀티플레이 동기화에 실패하였습니다. (timeout/ sync_ready: ${this.sync_ready} / sequence_num: ${this.sync_done_sequence_num})\n퇴장으로 처리되지만, 패배 처리는 되지 않습니다.\`\`\``});
    logger.error(`Multiplayer quiz session sync client timeout. 
      guild_id: ${this.guild_id},  /
      sequence_info: (timeout/ sync_ready: ${this.sync_ready}, sequence_num: ${this.sync_done_sequence_num}) /
      prepared question queue length: ${this.game_data.prepared_question_queue.length} /   
      remaining question list length: ${this.quiz_data.question_list.length} /   
    `);

    this.sync_failed = true;
    
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.SYNC_FAILED,
      }
    );

    this.forceStop();
  }

  sendLeave()
  {
    if(this.multiplayer_state === MULTIPLAYER_STATE.LOBBY)
    {
      this.sendLeaveLobby();
    }
    else
    {
      this.sendLeaveGame();
    }
  }

  sendLeaveLobby()
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.LEAVE_LOBBY,
      },
      false
    ); 

    this.leaved = true;

    logger.info(`Send Leave Lobby Signal. guild_id: ${this.guild_id}`); 
  }

  sendLeaveGame()
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.LEAVE_GAME,
      }
    );

    this.leaved = true;

    logger.info(`Send Leave Game Signal. guild_id: ${this.guild_id}`); 
  }

  sendRequestChat(user_id, chat_message)
  {
    logger.debug(`Send request chat signal. guild_id: ${this.guild_id} / user_id: ${user_id}`);

    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_CHAT,
        user_id: user_id,
        chat_message: chat_message
      },
      false
    );
  }

  on(event_name, event_object)
  {
    if(event_name === CUSTOM_EVENT_TYPE.interactionCreate)
    {
      if(event_object.isButton() && event_object.customId === 'chat_ignore')
      {
        this.setIgnoreChat(true, event_object.user.displayName);
        return;
      }
    }

    const signal_type = event_object.signal_type;

    if(signal_type === SERVER_SIGNAL.CONFIRM_CHAT)
    {
      return this.onReceivedConfirmChat(event_object);
    }
    else if(signal_type === SERVER_SIGNAL.NOTICE_MESSAGE)
    {
      return this.onReceivedNoticeMessage(event_object);
    }

    super.on(event_name, event_object);
  }

  onReceivedConfirmChat(signal)
  {
    if(this.ignore_chat === true)
    {
      return;
    }

    const custom_chat_component = cloneDeep(multiplayer_chat_comp);
    const message_id = signal.guild_id + '-' + signal.user_id + '-' + signal.timestamp;
    custom_chat_component.components[0].setCustomId(`chat_report_${message_id}`);
    //신고 버튼에 ID 설정해줘야함

    this.sendMessage({ content: signal.chat_message, components: [custom_chat_component]});

    if(this.isIngame() === false)
    {
      utility.playBGM(this.audio_player, BGM_TYPE.CHAT);
    }
  }

  onReceivedNoticeMessage(signal)
  {
    this.sendMessage({ content: `${signal.notice}` });
    logger.debug(`Sending notice message to ${this.guild_id}, message: ${signal.notice}`);
  }

};

class MultiplayerLobbySession extends MultiplayerSessionMixin(DummyQuizSession) //멀티플레이 로비임
{
  constructor(guild, owner, channel, quiz_info)
  {
    super(guild, owner, channel, quiz_info, QUIZ_SESSION_TYPE.MULTIPLAYER_LOBBY);

    this.createVoiceConnection(); //음성 채널 참가까지는 진행한다.

    this.multiplayer_state = MULTIPLAYER_STATE.LOBBY;
  }

  on(event_name, signal)
  {
    if(event_name !== CUSTOM_EVENT_TYPE.receivedMultiplayerSignal)
    {
      super.on(event_name, signal);
      return false;
    }

    const signal_type = signal.signal_type;

    if(signal_type === SERVER_SIGNAL.STARTED_LOBBY)
    {
      //로비 시작만 핸들
      return this.onReceivedStatedLobby(signal);
    }
    else if(signal_type === SERVER_SIGNAL.EXPIRED_SESSION)
    {
      return this.onReceivedExpiredSession(signal);
    }
    else if(signal_type === SERVER_SIGNAL.JOINED_LOBBY)
    {
      return this.onReceivedJoinedLobby(signal);
    }
    else if(signal_type === SERVER_SIGNAL.LEAVED_LOBBY)
    {
      return this.onReceivedLeavedLobby(signal);
    }
    else if(signal_type === SERVER_SIGNAL.KICKED_PARTICIPANT)
    {
      return this.onReceivedKickedParticipant(signal);
    }

    return super.on(event_name, signal); //핸들 안된건 위쪽으로
  }    

  onReceivedStatedLobby(signal)
  {
    const session_id = signal.session_id;
    const lobby_info = signal.lobby_info;
    if(lobby_info.quiz_info === undefined)
    {
      logger.error(`Cannot transit to active quiz session from multiplayer session. finalized quiz info is undefined. guild_id: ${this.guild_id}`);
      return;
    }

    const transited_session = this.transitToActiveQuizSession(lobby_info.quiz_info);

    if(!(transited_session instanceof MultiplayerQuizSession))
    {
      logger.error(`Transited Quiz Session is not Multiplayer Quiz Session type!!!. session_id: ${session_id} guild_id: ${this.guild_id}`);
      return;
    }

    transited_session.setSessionId(session_id);
    transited_session.setIgnoreChat(this.ignore_chat);
    transited_session.startMultiplayer();
  }

  onReceivedExpiredSession(signal)
  {
    this.session_expired = true;

    logger.debug(`Received Expired Session signal on MultiplayerLobbySession. but do not call forcestop`);
    // this.forceStop(); //로비에서 받았으면 어차피 goToBack 하면서 해제될듯
  }

  onReceivedJoinedLobby(signal)
  {
    utility.playBGM(this.audio_player, BGM_TYPE.DOOR_BELL);
  }

  onReceivedLeavedLobby(signal)
  {
    utility.playBGM(this.audio_player, BGM_TYPE.MATCH_FIND);
  }

  onReceivedKickedParticipant(signal)
  {
    utility.playBGM(this.audio_player, BGM_TYPE.MATCH_FIND);
  }

  transitToActiveQuizSession(finalized_quiz_info) //Lobby에서 게임 진행할 진짜 QuizSession 으로 전환
  {
    logger.debug(`transit to active quiz session from multiplayer session. guild_id: ${this.guild_id}`);
    //같은 파일의 형제 클래스(MultiplayerQuizSession)를 직접 생성 -> 나중에 이 클래스들을
    //파일로 쪼갤 때 상위 facade(quiz_system.js의 startQuiz)를 거치지 않아도 되게 함
    const quiz_session = new MultiplayerQuizSession(this.guild, this.owner, this.channel, finalized_quiz_info);
    return session_registry.replaceSession(this.guild_id, quiz_session); //해당 함수에서 어차피 Lobby는 free됨
  }
}

class MultiplayerQuizSession extends MultiplayerSessionMixin(QuizSession)
{
  constructor(guild, owner, channel, quiz_info)
  {
    super(guild, owner, channel, quiz_info, QUIZ_SESSION_TYPE.MULTIPLAYER);

    this.multiplayer_state = MULTIPLAYER_STATE.INITIALIZING;
    
    this.sync_done_sequence_num = 0;

    this.participant_select_menu = undefined;
    this.participant_select_row = cloneDeep(multiplayer_participant_select_row);

    this.mvp_info = undefined;
  }

  startMultiplayer()
  {
    //그냥 사이클만 만들어주면 끗
    this.createCycle();
    this.cycleLoop();
  }

  getGuildState()
  {
    const permissions = this.voice_channel?.permissionsFor(session_registry.bot_client.user);

    if(!permissions)
    {
      return;
    }

    let member_count = 0;
    if(permissions.has(PermissionsBitField.Flags.ViewChannel))
    {
      member_count = this.voice_channel.members.size - 1; //1명은 봇임
    }

    return {
      member_count: member_count
    };
  }
    
  setupParticipantSelectMenu()
  {
    let participant_select_menu = cloneDeep(multiplayer_participant_select_menu);
  
    for (let i = 0; i < this.participant_guilds_info.length; ++i) 
    {
      const guild_info = this.participant_guilds_info[i];
      const option = { label: `${guild_info.guild_name}`, description: `${guild_info.member_count}명 게임 중`, value: `${i}` };
      participant_select_menu.addOptions(option);
    }
  
    if (this.participant_guilds_info.length !== 0) 
    {
      this.participant_select_row.components[0] = participant_select_menu;
    }
  }

  appendParticipantInfoMenu(quiz_play_ui)
  {
    quiz_play_ui.components.push(this.participant_select_row);
  }

  waitForQuestionList()
  {
    logger.debug(`Waiting for question list. guild_id: ${this.guild_id}`);
    this.multiplayer_state = MULTIPLAYER_STATE.WAITING_FOR_QUESTION_LIST;

    this.sendMessage({content:`\`\`\`🌐 문제 목록을 동기화 하는 중\`\`\``});
  }

  waitForNextQuestionData()
  {
    logger.debug(`Waiting for next question data. guild_id: ${this.guild_id}`);
    this.multiplayer_state = MULTIPLAYER_STATE.WAITING_FOR_NEXT_QUESTION;
  }

  async waitForSyncDone()
  {
    if(this.sync_ready === false)
    {
      logger.debug(`Waiting for sync ready. guild_id: ${this.guild_id}`);
    }

    let wait_sync_ready_time_sec = 0;
    while(this.sync_ready === false) //sync ready를 기다림. 즉, 문제 준비 완료 기다리기
    {
      await utility.sleep(100);
      ++wait_sync_ready_time_sec;

      if(this.game_data.prepared_question_queue?.length !== 0)
      {
        logger.warn(`Syncing ready. but prepared question queue length is ${this.game_data.prepared_question_queue.length}. skip sync ready. ${this.guild_id}`);
        break;
      }

      if(wait_sync_ready_time_sec === 50) //5초
      {
        this.sendMessage({content:`\`\`\`🌐 제출할 문제 데이터를 동기화 하는 중\`\`\``});
      }

      if(wait_sync_ready_time_sec === 200) //20초
      {
        this.sendMessage({content:`\`\`\`🌐 문제 데이터 동기화가 지연되고 있습니다. 잠시만 기다려주세요.\`\`\``});
        logger.warn(`Multiplayer quiz session sync ready delayed. guild_id: ${this.guild_id}`);
      }

      if(wait_sync_ready_time_sec >= 450) //45초
      {
        this.syncFailed();
        return;
      }
    }
    
    this.multiplayer_state = MULTIPLAYER_STATE.WAITING_FOR_SYNC_DONE;
    logger.debug(`Waiting for sync done. guild_id: ${this.guild_id}`);
  
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.SYNC_WAIT,
        guild_state: this.getGuildState()
      }
    );

    let wait_sync_done_time_count = 0;
    const current_sequence = this.sync_done_sequence_num;
    while(current_sequence === this.sync_done_sequence_num)
    {
      await utility.sleep(10); //공정한 게임을 위해 제일 중요한 구간임
      ++wait_sync_done_time_count;

      if(wait_sync_done_time_count === 500) //5초
      {
        this.sendMessage({content:`\`\`\`🌐 다른 서버의 동기화 완료를 기다리는 중\`\`\``});
      }

      if(wait_sync_done_time_count === 2000) //20초
      {
        this.sendMessage({content:`\`\`\`🌐 동기화가 지연되고 있습니다. 잠시만 기다려주세요...\`\`\``});
        logger.warn(`Multiplayer quiz session sync done delayed. guild_id: ${this.guild_id}`);
      }

      if(wait_sync_done_time_count >= 4500) //45초. 이정도면 그냥 뭔가 문제가 있음
      {
        this.syncFailed();
        return;
      }
    }

    this.sync_ready = false;
  }

  sendQuestionListInfo()
  {
    //꼼수다... 가아끔 basicInitialized 끝나기도 전에 question list가 오는 경우가 잇다
    setTimeout(() => 
    {
      this.sendSignal(
        {
          signal_type: CLIENT_SIGNAL.QUESTION_LIST_GENERATED,
          question_list: this.quiz_data.question_list,
          quiz_size: this.quiz_data.quiz_size,
        }
      );
  
      logger.debug(`Send question list generated signal. quiz_size: ${this.quiz_data.quiz_size}/${this.quiz_data.question_list.length}, guild_id: ${this.guild_id}`);
    }, 3000);
  }

  sendPreparedQuestion(question)
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.NEXT_QUESTION_GENERATED,
        question: question,
        question_num: this.game_data.question_num,
      }
    );

    logger.debug(`Send current question generated signal. guild_id: ${this.guild_id}`);
  }

  sendRequestHint(requester_id)
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_HINT,
        requester_id: requester_id,
      }
    );

    logger.debug(`Send request hint signal. guild_id: ${this.guild_id}`);
  }

  sendRequestSkip(requester_id)
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_SKIP,
        requester_id: requester_id,
      }
    );

    logger.debug(`Send request hint signal. guild_id: ${this.guild_id}`);
  }

  sendRequestAnswerHit(answerer_id, answerer_name, score)
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.REQUEST_ANSWER_HIT,
        answerer_info: 
        {
          answerer_id: answerer_id,
          answerer_name: answerer_name,
          score: score,
        }
      }
    );

    logger.debug(`Send request answer hit signal. guild_id: ${this.guild_id}, answerer_id: ${answerer_id}, answerer_name: ${answerer_name}, score: ${score}`);
  }

  sendFinishUp()
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.FINISH_UP,
      },
      false
    );

    logger.info(`Send Finish Up Signal. guild_id: ${this.guild_id}`); 
  }

  sendFinished()
  {
    this.sendSignal(
      {
        signal_type: CLIENT_SIGNAL.FINISHED,
      },
      false
    );

    logger.info(`Send Finished Signal. guild_id: ${this.guild_id}`); 
  }

  on(event_name, signal)
  {
    if(event_name !== CUSTOM_EVENT_TYPE.receivedMultiplayerSignal) //multiplayer signal 아니면 전부 quiz session한테 넘겨준다
    {
      super.on(event_name, signal);
      return;
    }

    const signal_type = signal.signal_type;

    if(signal_type === SERVER_SIGNAL.HOST_CHANGED)
    {
      return this.onReceivedHostChanged(signal);
    }
    else if(signal_type === SERVER_SIGNAL.APPLY_QUESTION_LIST)
    {
      return this.onReceivedApplyQuestionList(signal);
    }
    else if(signal_type === SERVER_SIGNAL.APPLY_NEXT_QUESTION)
    {
      return this.onReceivedApplyNextQuestion(signal);
    }
    else if(signal_type === SERVER_SIGNAL.SYNC_DONE)
    {
      return this.onReceivedSyncDone(signal);
    }
    else if(signal_type === SERVER_SIGNAL.CONFIRM_HINT)
    {
      return this.onReceivedConfirmHint(signal);
    }
    else if(signal_type === SERVER_SIGNAL.CONFIRM_SKIP)
    {
      return this.onReceivedConfirmSkip(signal);
    }
    else if(signal_type === SERVER_SIGNAL.CONFIRM_ANSWER_HIT)
    {
      return this.onReceivedConfirmAnswerHit(signal);
    }
    else if(signal_type === SERVER_SIGNAL.LEAVED_GAME)
    {
      return this.onReceivedLeavedGame(signal);
    }
    else if(signal_type === SERVER_SIGNAL.SYNC_FAILED_DETECTED)
    {
      return this.onReceivedSyncFailedDetected(signal);
    }
    else if(signal_type === SERVER_SIGNAL.CONFIRM_MVP)
    {
      return this.onReceivedConfirmMVP(signal);
    }
    else if(signal_type === SERVER_SIGNAL.EXPIRED_SESSION)
    {
      return this.onReceivedExpiredSession(signal);
    }

    return super.on(event_name, signal); //핸들 안된건 위쪽으로
  }

  onReceivedHostChanged(signal)
  {
    const new_session_id = signal.session_id;
    
    logger.debug(`Applying new host session id ${this.session_id} -> ${new_session_id}`);

    this.session_id = new_session_id;

    this.sendMessage({ content: `\`\`\`🌐 호스트 서버가 나갔습니다. 이 세션의 호스트가 ${signal.new_host_guild_info?.guild_name} 서버로 변경됐습니다.\`\`\`` });
  }

  onReceivedApplyQuestionList(signal)
  {
    if(this.multiplayer_state !== MULTIPLAYER_STATE.INITIALIZING &&
       this.multiplayer_state !== MULTIPLAYER_STATE.WAITING_FOR_QUESTION_LIST)
    {
      logger.error(`Received Apply Question List signal. but current state is ${this.multiplayer_state}.`);
      return;
    }

    this.quiz_data.question_list = cloneDeep(signal.question_list);
    this.quiz_data.quiz_size = cloneDeep(signal.quiz_size);

    logger.debug(`Applying question list signal. call Prepare Cycle quiz_size: ${signal.quiz_size}/${signal.question_list.length}, guild_id: ${this.guild_id}`);
    
    if(this.quiz_data.question_list.length === 0)
    {
      logger.error(`Received Apply Question List signal. but question list is empty.`);
      this.sendMessage({content:`\`\`\`🌐 문제 목록 동기화에 실패했습니다. 원인: 생성된 문제가 없습니다.\`\`\``});
      this.forceStop();

      return;
    }

    if(this.quiz_data.quiz_size < 20)
    {
      this.sendMessage({content: `\`\`\`🌐 이 멀티플레이에서 생성된 문제 수가 20개 미만입니다.\n해당 게임의 결과는 전적에 반영되지 않습니다.\`\`\``, flags: MessageFlags.Ephemeral});
    }

    this.multiplayer_state = MULTIPLAYER_STATE.QUESTION_LIST_READY;

    this.getCurrentCycle()?.asyncCallCycle(CYCLE_TYPE.PREPARE);
  }

  onReceivedApplyNextQuestion(signal)
  {
    // if(this.multiplayer_state !== MULTIPLAYER_STATE.WAITING_FOR_NEXT_QUESTION)
    // {
    //   logger.error(`Received Apply Next Question signal. but current state is ${this.multiplayer_state}.`);
    //   return;
    // }

    // const question_num = cloneDeep(signal.question_num);
    // this.game_data['question_num'] = question_num; //이 타이밍에 하면 안된다. Apply가 먼저오고 Prepare 들어가면 실질적으로 question_num이 +2가 돼서 꼬인다.

    const prepared_question = cloneDeep(signal.prepared_question); 
    //!!! cloneDeep을 꼭 해줘야한다. signal 객체는 기본적으로 모든 클라이언트에 대해 공유라서 prepared_question['audio_resource'] 로 덮어씌우면 이게 공유돼서
    //Resource is already being played by another audio player. 에러 뜬다.

    Prepare.fillAudioResource(prepared_question);
    
    this.sync_ready = true;

    this.game_data.prepared_question_queue.push(prepared_question);

    this.multiplayer_state = MULTIPLAYER_STATE.NEXT_QUESTION_READY;

    logger.debug(`Applying next question signal. set sync ready. guild_id: ${this.guild_id}`);
  }

  onReceivedSyncDone(signal)
  {
    this.sync_done_sequence_num = cloneDeep(signal.sequence_num);
    
    this.participant_guilds_info = signal.participant_guilds_info;
    this.game_data['question_num'] = signal.question_num;

    logger.debug(`Received Sync Done signal ${this.sync_done_sequence_num}. calling Questioning Cycle.`);

    this.setupParticipantSelectMenu();

    this.multiplayer_state = MULTIPLAYER_STATE.QUESTIONING;
    this.goToCycle(CYCLE_TYPE.QUESTIONING); //sync해서 갈때는 goToCycle로 안그러면 current_cycle_type이 안바뀜
  }

  onReceivedConfirmHint(signal)
  {
    if(this.current_cycle_type != CYCLE_TYPE.QUESTIONING)
    {
      logger.error(`Received Confirm hint signal ${this.guild_id}. but this current cycle type is not QUESTIONING.`);
      return;
    }
    
    const question_cycle = this.getCurrentCycle();
    if(question_cycle === undefined || !(question_cycle instanceof Question))
    {
      logger.error(`Received Confirm hint signal ${this.guild_id}. but this getCurrentCycle object is not instanceof QUESTION.`);
      return;
    }
        
        
    logger.debug(`Received Confirm hint signal ${this.guild_id}. calling showHint.`);
    question_cycle.showHint(question_cycle.current_question);
  }

  onReceivedConfirmSkip(signal)
  {
    if(this.current_cycle_type != CYCLE_TYPE.QUESTIONING)
    {
      logger.error(`Received Confirm skip signal ${this.guild_id}. but this current cycle type is not QUESTIONING.`);
      return;
    }
    
    const question_cycle = this.getCurrentCycle();
    if(question_cycle === undefined || !(question_cycle instanceof Question))
    {
      logger.error(`Received Confirm skip signal ${this.guild_id}. but this getCurrentCycle object is not instanceof QUESTION.`);
      return;
    }
        
        
    logger.debug(`Received Confirm skip signal ${this.guild_id}. calling skip.`);
    question_cycle.skip(question_cycle.current_question);
  }

  onReceivedConfirmAnswerHit(signal)
  {
    if(this.current_cycle_type != CYCLE_TYPE.QUESTIONING)
    {
      logger.error(`Received Confirm answer hit signal ${this.guild_id}. but this current cycle type is not QUESTIONING.`);
      return;
    }
    
    const question_cycle = this.getCurrentCycle();
    if(question_cycle === undefined || !(question_cycle instanceof Question))
    {
      logger.error(`Received Confirm answer hit signal ${this.guild_id}. but this getCurrentCycle object is not instanceof QUESTION.`);
      return;
    }
        
    const answerer_info = cloneDeep(signal.answerer_info);
    if(answerer_info === undefined)
    {
      logger.error(`Received Confirm answer hit signal ${this.guild_id}. but answerer info is undefined`);
      return;
    }

    logger.debug(`Received Confirm answer hit signal ${this.guild_id}. calling apply correct answer.`);
    question_cycle.applyCorrectAnswer(answerer_info.answerer_id, answerer_info.answerer_name, answerer_info.score);
    question_cycle.stopTimeoverTimer();
  }

  onReceivedLeavedGame(signal)
  {
    const leaved_guild_info = signal.leaved_guild_info;
    this.sendMessage({content: `\`\`\`🌐 ${leaved_guild_info.guild_name} 서버가 게임에서 퇴장하였습니다.\`\`\``});

    this.scoreboard.delete(leaved_guild_info.guild_id);
    logger.debug(`Received Leaved game signal ${this.guild_id}. erasing ${leaved_guild_info.guild_id} from scoreboard`);
  }

  onReceivedSyncFailedDetected(signal)
  {
    if(this.sync_failed) //이건 echo일거임
    {
      return;
    }

    const failed_guild_info = signal.failed_guild_info;
    this.sendMessage({content: `\`\`\`🌐 ${failed_guild_info.guild_name} 서버가 동기화에 실패했습니다.\n해당 서버는 퇴장으로 처리됩니다.\`\`\``});

    logger.debug(`Received sync failed signal ${this.guild_id}. erasing ${failed_guild_info.guild_id} from scoreboard`);
  }

  onReceivedConfirmMVP(signal)
  {
    this.multiplayer_state = MULTIPLAYER_STATE.FINISH_UP; //mvp 정해졌다는 신호 받은거면 finish up인거임
    this.mvp_info = cloneDeep(signal.mvp_info);

    logger.debug(`Received MVP Info signal ${this.guild_id}. name: ${this.mvp_info.name}, score: ${this.mvp_info.score}`);
  }

  onReceivedExpiredSession(signal)
  {
    this.multiplayer_state = MULTIPLAYER_STATE.FINISH_UP; //mvp 정해졌다는 신호 받은거면 finish up인거임
    this.session_expired = true;

    logger.debug(`Received Expired Session signal ${this.guild_id} from ${signal.session_id}.`);

    this.sendMessage({ content: `\`\`\`🌐 이 서버를 제외한 모든 참여자가 퇴장하였습니다.\n현재 문제가 끝난 뒤 퀴즈가 종료되며 승리로 간주됩니다.\`\`\`` });
  }
}

//#endregion


//#region 퀴즈 cycle 용 lifecycle의 base
//lifecycle/quiz_lifecycle.js로 분리 (REFACTOR_PLAN.md Phase 2)
const { QuizLifeCycle, QuizLifeCycleWithUtility } = require('./lifecycle/quiz_lifecycle.js');
//#endregion


//#region Initialize Cycle
//lifecycle/initialize.js로 분리 (REFACTOR_PLAN.md Phase 2)
const { Initialize, InitializeDevQuiz, InitializeCustomQuiz, InitializeOmakaseQuiz, InitializeUnknownQuiz } = require('./lifecycle/initialize.js');
//#endregion


//#region Explain Cycle
//lifecycle/explain.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Explain = require('./lifecycle/explain.js');
//#endregion


//#region Prepare Cycle
//lifecycle/prepare.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Prepare = require('./lifecycle/prepare.js');
//#endregion

//#region Question Cycle
/** 퀴즈 내는 단계인 Question, 여기가 제일 처리할게 많다. **/
class Question extends QuizLifeCycleWithUtility
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session)
  {
    super(quiz_session);
    this.next_cycle = CYCLE_TYPE.TIMEOVER;

    this.current_question = undefined; //현재 진행 중인 퀴즈

    this.hint_timer = undefined; //자동 힌트 타이머
    this.timeover_timer = undefined; //타임오버 timer id
    this.timeover_resolve = undefined; //정답 맞췄을 시 강제로 타임오버 대기 취소
    this.fade_out_timer = undefined;
    this.wait_for_answer_timer = undefined; //정답 대기 timer id
    this.already_start_fade_out = false;

    this.skip_prepare_cycle = false; //마지막 문제라면 더 이상 prepare 할 필요없음
    this.progress_bar_timer = undefined; //진행 bar
    this.progress_bar_fixed_text = undefined; //진행 bar 위에 고정할 text, 진행 bar 흐르는 중간에 표시할 수도 있으니 this로 둔다.
    this.answers = undefined; //문제 정답 목록

    this.is_timeover = false;
    this.timeover_wait = undefined; //타임오버 대기 시간
    this.timeover_timer_created = undefined; //타임오버 타이머 시작 시간

    this.answer_type = ANSWER_TYPE.SHORT_ANSWER; //문제 유형
    this.selected_choice_map = undefined; //객관식 퀴즈에서 각자 선택한 답안

    this.hint_voted_user_list = []; //힌트 투표 이미했는지 확인
    this.skip_voted_user_list = []; //스킵 투표 이미했는지 확인
    this.used_chance_map = {}; //정답 제출 몇 번 시도했는지
  }

  async enter()
  {
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;

    if(this.quiz_session.force_stop == true) return false;

    this.current_question = undefined; //현재 진행 중인 퀴즈

    this.hint_timer = undefined; //자동 힌트 타이머
    this.timeover_timer = undefined; //타임오버 timer id
    this.timeover_resolve = undefined; //정답 맞췄을 시 강제로 타임오버 대기 취소
    this.wait_for_answer_timer = undefined; //정답 대기 timer id
    this.fade_out_timer = undefined;
    this.already_start_fade_out = false;

    this.skip_prepare_cycle = false;
    this.progress_bar_timer = undefined; //진행 bar
    this.progress_bar_fixed_text = undefined; //진행 bar 위에 고정할 text
    this.answers = undefined; //문제 정답 목록

    this.is_timeover = false;
    this.timeover_wait = undefined;
    this.timeover_timer_created = undefined;

    this.answer_type = ANSWER_TYPE.SHORT_ANSWER; //문제 유형
    this.selected_choice_map = undefined; //객관식 퀴즈에서 각자 선택한 답안

    this.hint_voted_user_list.length = 0; //힌트 투표 이미했는지 확인
    this.skip_voted_user_list.length = 0; //스킵 투표 이미했는지 확인
    this.used_chance_map = {}; //정답 제출 몇 번 시도했는지

    if(this.quiz_session.hasMoreQuestion() === false) //모든 퀴즈 제출됐음
    {
      this.next_cycle = CYCLE_TYPE.ENDING;
      this.skip_prepare_cycle = true;
      this.current_question = undefined;
      logger.info(`All Question Submitted, guild_id:${this.quiz_session.guild_id}`);
      return; //더 이상 진행할 게 없다.
    }

    this.stopAudioList(); //시작 전엔 audio stop 걸고 가자

    //진행 UI 관련
    this.sendBGM(BGM_TYPE.ROUND_ALARM);
    let quiz_ui = await this.createQuestionUI();
    const essential_term = Date.now() + 2500; //최소 문제 제출까지 2.5초간의 텀은 주자

    //아직 prepared queue에 아무것도 없다면
    let current_check_prepared_queue = 0;
    const max_try = SYSTEM_CONFIG.MAX_CHECK_PREPARED_QUEUE;
    const check_interval = SYSTEM_CONFIG.PREPARED_QUEUE_CHECK_INTERVAL;
    // const max_try = 40; //고정값으로 테스트해보자
    while(game_data.prepared_question_queue.length == 0)
    {
      if(this.quiz_session.force_stop == true) return false;

      if(++current_check_prepared_queue >= max_try) //최대 체크 횟수 초과 시
      {
        this.next_cycle = CYCLE_TYPE.CLEARING; 
        logger.error(`Prepared Queue is Empty, tried ${current_check_prepared_queue} * ${check_interval}..., going to CLEARING cycle, guild_id: ${this.quiz_session.guild_id}`);
        this.quiz_session.sendMessage({content: `\`\`\`🔸 예기치 않은 문제로 오디오 리소스 초기화에 실패했습니다...\n퀴즈가 강제 종료됩니다...\n서버 메모리 부족, 네트워크 연결 등의 문제일 수 있습니다.\`\`\``});

        const memoryUsage = process.memoryUsage();
        logger.error(`Memory Usage:, ${JSON.stringify({
          'Heap Used': `${memoryUsage.heapUsed / 1024 / 1024} MB`,
          'Heap Total': `${memoryUsage.heapTotal / 1024 / 1024} MB`,
          'RSS': `${memoryUsage.rss / 1024 / 1024} MB`,
          'External': `${memoryUsage.external / 1024 / 1024} MB`,
        })}`);

        this.forceStop();

        return false;
      }

      await utility.sleep(check_interval);
      // await utility.sleep(500); //고정값으로 테스트 해보자
    }
        
    this.current_question = game_data.prepared_question_queue.shift(); //하나 꺼내오자

    this.answer_type = this.current_question['answer_type'] ?? ANSWER_TYPE.SHORT_ANSWER;
    this.applyAnswerTypeToUI(); //answer_type 대로 컴포넌트 설정

    if(this.quiz_session.isMultiplayerSession()) //멀티면 참가자 목록 붙여주자
    {
      this.quiz_session.appendParticipantInfoMenu(quiz_ui);
    }

    //이제 문제 준비가 끝났다. 마지막으로 최소 텀 지키고 ㄱㄱ
    const left_term = essential_term - Date.now();
    if(left_term < 0) 
    {
      return;
    }
    await new Promise((resolve, reject) => 
    {
      setTimeout(() => 
      {
        resolve();
      }, left_term);
    });
  }

  async act()
  {
    //Base class라서 아무것도 안한다. Quiz Type 별로 여기에 동작 구현
  }

  exit()
  {
    this.quiz_session.has_current_question = false;
    
    if(this.progress_bar_timer != undefined)
    {
      clearInterval(this.progress_bar_timer);
    }

    if(this.hint_timer != undefined)
    {
      clearTimeout(this.hint_timer);
    }

    if(this.quiz_session.force_stop == true) //강제 종료가 호출됐다.
    {
      this.skip_prepare_cycle = true; //더 이상 prepare는 필요없다.
      this.stopTimeoverTimer(); //타임오버 타이머도 취소한다.
      return false;
    }

    if(this.skip_prepare_cycle == false)
    {
      this.asyncCallCycle(CYCLE_TYPE.PREPARE); //다음 문제 미리 준비
    }
  }

  applyAnswerTypeToUI()
  {
    const answer_type = this.answer_type;
    const quiz_ui = this.quiz_session.quiz_ui;

    if(answer_type == ANSWER_TYPE.OX)
    {
      quiz_ui.components.push(quiz_ui.ox_quiz_comp);
    }
    else if(answer_type == ANSWER_TYPE.MULTIPLE_CHOICE)
    {
      quiz_ui.components.push(quiz_ui.multiple_quiz_comp);
    }
  }

  //UI관련
  async createQuestionUI()
  {
    let quiz_data = this.quiz_session.quiz_data;
    let game_data = this.quiz_session.game_data;
    const option_data = this.quiz_session.option_data;
    const quiz_ui = this.quiz_session.quiz_ui;

    const quiz_type = quiz_data['quiz_type'];

    quiz_ui.embed.color = 0xFED049;

    quiz_ui.embed.title = `[ ${quiz_data['icon']} ${quiz_data['title']} ]`;
        
    let footer_message = text_contents.quiz_play_ui.footer;
    footer_message = footer_message.replace("${quiz_question_num}", `${(game_data['question_num']+1)}`);
    footer_message = footer_message.replace("${quiz_size}", `${quiz_data['quiz_size']}`);
    footer_message = footer_message.replace("${option_hint_type}", `${option_data.quiz.hint_type}`);
    footer_message = footer_message.replace("${option_skip_type}", `${option_data.quiz.skip_type}`);
    footer_message = footer_message.replace("${option_score_type}", `${option_data.quiz.score_type}`);
    quiz_ui.embed.footer = {
      "text": footer_message,
    };
    let description_message = text_contents.quiz_play_ui.description;
    description_message = description_message.replace("${quiz_question_num}", `${(game_data['question_num']+1)}`);

    if(this.quiz_session.isMultiplayerSession())
    {
      description_message += `\n\`\`\`🔖 [Tip]. /챗' 명령어로 전체 대화가 가능합니다.\`\`\``;
    }

    quiz_ui.embed.description = description_message;

    let components = [quiz_ui.quiz_play_comp]; //기본 comp
    quiz_ui.components = components;

    quiz_ui.embed.fields = [];

    quiz_ui.setButtonStatus(0, option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.AUTO ? false : true); //버튼 1,2,3 다 활성화
    quiz_ui.setButtonStatus(1, true); 
    quiz_ui.setButtonStatus(2, true);

    quiz_ui.setImage(undefined); //이미지 초기화

    await quiz_ui.send(false);

    return quiz_ui;
  }

  //힌트 표시
  async showHint(question)
  {
    if(question['hint_used'] == true || (question['hint'] == undefined && question['hint_image_url'] == undefined))
    {
      return;    
    }
    question['hint_used'] = true;

    let quiz_ui = this.quiz_session.quiz_ui;
    quiz_ui.setButtonStatus(0, false); //힌트 버튼 비활성화
    quiz_ui.update();

    const hint = question['hint'];
    const channel = this.quiz_session.channel;
    let hint_message = text_contents.quiz_play_ui.show_hint;
    hint_message = hint_message.replace("${hint}", hint);

    if(question['hint_image_url'] != undefined)
    {
      const hint_image_url = question['hint_image_url'];
      const hint_embed = {
        color: 0x05f1f1,
        title: `${text_contents.quiz_play_ui.hint_title}`,
        description: `${hint_message}`,
        image: {
          url: utility.isValidURL(hint_image_url) ? hint_image_url : '',
        }
      };

      channel.send({embeds: [hint_embed]});
    }
    else
    {
      channel.send({content: hint_message});
    }
  }

  //스킵
  async skip(question)
  {
    if(question['skip_used'] == true)
    {
      return;    
    }
    question['skip_used'] = true;

    let quiz_ui = this.quiz_session.quiz_ui;
    quiz_ui.setButtonStatus(1, false); //스킵 버튼 비활성화
    quiz_ui.update();

    const channel = this.quiz_session.channel;
    let skip_message = text_contents.quiz_play_ui.skip;
    channel.send({content: skip_message});
        
    await this.stopTimeoverTimer(); //그리고 다음으로 진행 가능하게 타임오버 타이머를 중지해줌
  }

  //진행 bar 시작
  async startProgressBar(audio_play_time)
  {
    if(audio_play_time < 10000) //10초 미만은 지원하지 말자
    {
      return;
    }

    //진행 상황 bar, 10%마다 호출하자
    const progress_max_percentage = 10;
    const progress_bar_interval = audio_play_time / progress_max_percentage;
    let progress_percentage = 0; //시작은 0부터
        
    let quiz_ui = this.quiz_session.quiz_ui;

    let progress_bar_string = this.getProgressBarString(progress_percentage, progress_max_percentage);
    quiz_ui.embed.description = this.progress_bar_fixed_text ?? '';
    quiz_ui.embed.description += ` \n \n🕛 **${progress_bar_string}**\n \n \n`;
    quiz_ui.update(); // 우선 한 번은 그냥 시작해주고~

    const progress_bar_timer = setInterval(() => 
    {

      ++progress_percentage;

      let progress_bar_string = this.getProgressBarString(progress_percentage, progress_max_percentage);

      quiz_ui.embed.description = this.progress_bar_fixed_text ?? '';
      quiz_ui.embed.description += ` \n \n⏱ **${progress_bar_string}**\n \n \n`;
      quiz_ui.update();

    }, progress_bar_interval);

    this.progress_bar_timer = progress_bar_timer;
  }

  getProgressBarString(progress_percentage, progress_max_percentage)
  {
    if(progress_percentage == progress_max_percentage)
    {
      clearInterval(this.progress_bar_timer);
    }

    let progress_bar_string = '';
    for(let i = 0; i < progress_max_percentage; i++)
    {
      if(i <= progress_percentage)
      {
        progress_bar_string += text_contents.icon.ICON_PROGRESS_PROGRESSED;
      }
      else
      {
        progress_bar_string += text_contents.icon.ICON_PROGRESS_WATING;
      }
    }
    return progress_bar_string;
  }

  //정답 맞췄을 때
  async submittedCorrectAnswer(requester)
  {
    if(this.current_question['answer_requesters'] !== undefined) //이미 맞춘사람 있다면 패스
    {
      return;
    }
    
    if(this.timeover_timer === undefined)
    {
      return;
    }
    
    const score = this.calculateScore();

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestAnswerHit(requester.id, requester.displayName, score);
      return;
    }

    this.applyCorrectAnswer(requester.id, requester.displayName, score);

    this.stopTimeoverTimer(); //맞췄으니 타임오버 타이머 중지!
  }

  applyCorrectAnswer(answerer_id, answerer_name, score)
  {
    if(this.current_question['answer_members'] === undefined)
    {
      this.current_question['answer_members'] = [];
    }

    this.current_question['answer_members'].push(answerer_id);
    
    let scoreboard = this.quiz_session.scoreboard;
    let answerer_info = scoreboard.get(answerer_id);
    
    if(answerer_info === undefined)
    {
      answerer_info = {
        name: answerer_name,
        score: score
      };

      scoreboard.set(answerer_id, answerer_info);
    }
    else
    {
      answerer_info.name = answerer_name;
      answerer_info.score += score;
    }
  }  

  hasAnswerer()
  {
    return this.current_question['answer_members'] !== undefined;
  }

  calculateScore()
  {
    let score = 1;

    const score_type = this.quiz_session.option_data.quiz.score_type;
    if(score_type == OPTION_TYPE.SCORE_TYPE.TIME) //남은 시간 비례 가산점 방식이면
    {
      const max_multiple = 10;
      let multiple = 1;
      const answer_submitted_time = Date.now();
      const timeover_start = this.timeover_timer_created;
      const timeover_wait = this.timeover_wait;

      const time_gap = answer_submitted_time - timeover_start; //맞추기까지 걸린 시간
      if(time_gap < 0) //음수일리가 없는데...음수면 최대!
      { 
        multiple = max_multiple;
      }
      else
      {
        multiple = max_multiple - parseInt(time_gap * max_multiple / timeover_wait);
        if(multiple <= 0) multiple = 1;
      }
      score *= multiple;
    }

    return score;
  }

  isSkipped()
  {
    return this.current_question['skip_used'] === true;
  }

  //타임오버 타이머 중지
  async stopTimeoverTimer()
  {
    if(this.timeover_timer != undefined)
    {
      clearTimeout(this.timeover_timer); //타임오버 타이머 중지
    }
        
    if(this.fade_out_timer != undefined)
    {
      clearTimeout(this.fade_out_timer); //fadeout timer 중지
    }

    if(this.wait_for_answer_timer != undefined)
    {
      clearTimeout(this.wait_for_answer_timer); //fadeout timer 중지
    }

    if(this.timeover_resolve != undefined)
    {
      this.timeover_resolve('force stop timeover timer'); //타임오버 promise await 취소
    }
  }

  //자동 힌트 체크
  async checkAutoHint(audio_play_time) 
  {
    const option_data = this.quiz_session.option_data;
    if(this.quiz_session.isMultiplayerSession() == false && option_data.quiz.hint_type != OPTION_TYPE.HINT_TYPE.AUTO) //싱글 퀴즈에서 자동 힌트 사용 중이 아니라면
    {
      return;
    }   

    //멀티플레이는 자동 힌트도 무조건 되게함

    const hint_timer_wait = audio_play_time / 2; //절반 지나면 힌트 표시할거임
    const hint_timer = setTimeout(() => 
    {
      this.showHint(this.current_question); //현재 퀴즈 hint 표시
    }, hint_timer_wait);
    this.hint_timer = hint_timer;
  }

  //정답 대기 타이머 생성 및 지연 시작
  async createWaitForAnswerTimer(delay_time, wait_time, bgm_type)
  {
    this.wait_for_answer_timer = setTimeout(async () => 
    {

      if(this.progress_bar_timer != undefined)
      {
        clearTimeout(this.progress_bar_timer);
      }
      const audio_player = this.quiz_session.audio_player;
      this.stopAudioList();
      this.sendBGM(bgm_type);
      this.startProgressBar(wait_time);
      this.is_playing_bgm = true;

    }, delay_time);
    return this.wait_for_answer_timer;
  }

  //타임오버 타이머 생성 및 시작
  async createTimeoverTimer(timeover_wait)
  {
    this.timeover_wait = timeover_wait;
    this.timeover_timer_created = Date.now();
    this.is_timeover = false;
    const audio_player = this.quiz_session.audio_player;
    const timeover_promise = new Promise((resolve, reject) => 
    {

      this.timeover_resolve = resolve; //정답 맞췄을 시, 이 resolve를 호출해서 promise 취소할거임
      this.timeover_timer = setTimeout(async () => 
      {

        this.is_timeover = true; 

        let graceful_timeover_try = 0;
        while(audio_player.state.status == 'playing'
                     && graceful_timeover_try++ < SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY) //오디오 완전 종료 대기
        {
          await utility.sleep(SYSTEM_CONFIG.GRACEFUL_TIMEOVER_INTERVAL);
        }

        if(audio_player.state.status == 'playing' && SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY > 0) //아직도 오디오 플레이 중이고 graceful 옵션 사용 중이면
        {
          logger.warn(`Graceful timeover, guild_id:${this.quiz_session.guild_id}, graceful_count: ${graceful_timeover_try}/${SYSTEM_CONFIG.GRACEFUL_TIMEOVER_MAX_TRY}`);
        }

        resolve('done timeover timer');

      }, timeover_wait);
    });
    return timeover_promise;
  }

  //부드러운 오디오 종료
  /** Deprecated */
  /**
  async gracefulAudioExit(audio_player, resource, fade_in_end_time)
  {
    if(this.already_start_fade_out == true) //이미 fadeout 진입했다면 return
    {
      return;
    }

    if(SYSTEM_CONFIG.USE_INLINE_VOLUME)
    {
      if(resource == undefined || resource.volume == undefined) return;

      let fade_out_duration = SYSTEM_CONFIG.FACE_OUT_DURATION;
      const fade_in_left_time = (Date.now() - (fade_in_end_time ?? 0)) * -1;
      if(fade_in_left_time > 0) //아직 fade_in이 안끝났다면
      {
        fade_out_duration = SYSTEM_CONFIG.CORRECT_ANSWER_CYCLE_WAIT - fade_in_left_time - 1000; //fadeout duration 재계산, 1000ms는 padding
        if(fade_out_duration > 1000) //남은 시간이 너무 짧으면 걍 패스
        {
          this.current_question['fade_out_timer'] = setTimeout(() => 
          {
            this.already_start_fade_out = true;
            utility.fade_audio_play(audio_player, resource, resource.volume.volume, 0, fade_out_duration);
          }, fade_in_left_time); //fade_in 끝나면 호출되도록
        }
      }
      else
      {
        this.already_start_fade_out = true;
        utility.fade_audio_play(audio_player, resource, resource.volume.volume, 0, fade_out_duration);
      }
    }
  }
  */

  /** 이벤트 핸들러 **/
  onInteractionCreate(interaction)
  {
    if(interaction.isChatInputCommand())
    {
      this.handleChatInputCommand(interaction);
    }

    if(interaction.isButton())
    {
      this.handleButtonCommand(interaction);
    }
  }

  checkAnswerHit(message_content)
  {
    const submit_answer = message_content.trim().replace(/ /g, '').toLowerCase();

    return this.answers.includes(submit_answer);
  }

  handleSimpleRequest(member, message_content)
  {
    if(message_content === 'ㅎ')
    {
      this.requestHint(member);
      return true;
    }

    if(message_content === 'ㅅ')
    {
      this.requestSkip(member);
      return true;
    }

    return false;
  }

  processChance(member)
  {
    const option_data = this.quiz_session.option_data;
    const max_chance = option_data.quiz.max_chance;

    if(max_chance == OPTION_TYPE.UNLIMITED)
    {
      return 10000;
    }

    const member_id = member.id;
    let used_chance = this.used_chance_map[member_id] || 0;
    this.used_chance_map[member_id] = (++used_chance);

    return max_chance - used_chance;
  }

  onMessageCreate(message)
  {
    const option_data = this.quiz_session.option_data;

    if(message.author == session_registry.bot_client.user) return;

    if(option_data.quiz.use_message_intent == OPTION_TYPE.DISABLED) return; //Message Intent 안쓴다면 return

    if(message.channel != this.quiz_session.channel) return; //퀴즈 진행 중인 채널 아니면 return

    if(this.timeover_timer_created == undefined) return; //아직 timeover 시작도 안했다면 return

    if(this.answer_type != ANSWER_TYPE.SHORT_ANSWER) return; //단답형 아니면 PASS

    if(message.member === undefined) return; //이건 길드 메시지 아니면 pass

    const message_content = message.content ?? '';
    const requester = message.member;

    if(message_content == '') 
    {
      return;
    }

    const is_request_message = this.handleSimpleRequest(requester, message_content);
    const remain_chance = is_request_message ? 10000 : this.processChance(requester);

    if(remain_chance < 0) //no more chance
    {
      return;
    }

    if(this.checkAnswerHit(message_content) == false) //오답
    {
      if(remain_chance == 0) //라스트 찬스였으면
      {
        message.reply({content: `\`\`\`🔸 땡! 이번 문제의 정답 제출 기회를 모두 사용했어요.\`\`\``, flags: MessageFlags.Ephemeral});
      }

      return;
    }

    this.submittedCorrectAnswer(requester);
  }

  async handleChatInputCommand(interaction)
  {
    if(interaction.commandName === '답') 
    {

      if(this.timeover_timer_created == undefined) return; //아직 timeover 시작도 안했다면 return

      if(this.answer_type != ANSWER_TYPE.SHORT_ANSWER) return; // 단답형 아니면 pass
    
      const message_content = interaction.options.getString('답안') ?? '';

      const requester = this.quiz_session.isMultiplayerSession() ? interaction.user : interaction.member;
    
      if(message_content == '') 
      {
        return;
      }

      const is_request_message = this.handleSimpleRequest(requester, message_content);
      const remain_chance = is_request_message ? 10000 : this.processChance(requester);
    
      if(remain_chance < 0) //no more chance
      {
        const reply_message = `이번 문제의 정답 제출 기회를 모두 사용했어요.`;
        interaction.explicit_replied = true;
        interaction.reply({content: reply_message, flags: MessageFlags.Ephemeral})
          .catch(err => 
          {
            logger.error(`Failed to replay to wrong submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
          });
        return;
      }
    
      if(this.checkAnswerHit(message_content) == false) //오답
      {
        let reply_message = "```";
        reply_message += `🔸 ${utility.sanitizeName(requester.displayName)}: [ ${message_content} ]... 오답입니다!`;

        if(remain_chance == 0) //라스트 찬스였음
        {
          reply_message += `\n이번 문제의 정답 제출 기회를 모두 사용했어요.`;
        }
        else if(remain_chance > 0)
        {
          reply_message += `\n기회가 ${remain_chance}번 남았어요.`;
        }

        reply_message += "```";
                
        interaction.explicit_replied = true;
        interaction.reply({content: reply_message, flags: MessageFlags.Ephemeral})
          .catch(err => 
          {
            logger.error(`Failed to replay to wrong submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
          });
    
        return;
      }
            
      this.submittedCorrectAnswer(requester);

      let message = "```" + `${utility.sanitizeName(requester.displayName)}: [ ${message_content} ]... 정답입니다!` + "```";
      interaction.explicit_replied = true;
      interaction.reply({content: message})
        .catch(err => 
        {
          logger.error(`Failed to replay to correct submit, guild_id:${this.quiz_session.guild_id}, err: ${err.stack}`);
        });
    }
  }

  async handleButtonCommand(interaction)
  {
    if(this.timeover_timer == undefined)
    {
      return; //타임 오버 타이머 시작도 안했는데 누른거면 패스한다.
    }

    if(interaction.customId === 'hint') 
    {
      this.requestHint(interaction.member);
      return;
    }

    if(interaction.customId === 'skip') 
    {
      this.requestSkip(interaction.member);
      return;
    }

    if(interaction.customId.startsWith("choice_")) //버튼형 정답 입력일 경우
    {
      const selected_value = interaction.customId;
      const selected_choice = selected_value.substring(7).toLowerCase(); // "choice_"의 길이는 7

      const member = interaction.member;

      if(this.selected_choice_map == undefined) 
      {
        this.selected_choice_map = new Map();
      }

      this.selected_choice_map.set(member, selected_choice);

      interaction.explicit_replied = true;
      interaction.reply({ content: `\`\`\`🔸 선택한 정답: ${this.choiceAsIcon(selected_choice)}\`\`\``, flags: MessageFlags.Ephemeral });
    }
  }

  choiceAsIcon(choice)
  {
    switch(choice)
    {
    case 'o': return '⭕';
    case 'x': return '❌';
    case '1': return '1️⃣';
    case '2': return '2️⃣';
    case '3': return '3️⃣';
    case '4': return '4️⃣';
    case '5': return '5️⃣';

    default: return choice;
    }
  }

  requestHint(member)
  {
    const option_data = this.quiz_session.option_data;
    const current_question = this.current_question;
    if(current_question == undefined) 
    {
      return;
    }

    //2중 체크의 필요성이 있나?
    // if(current_question['hint_used'] == true 
    //     || (current_question['hint'] == undefined && current_question['hint_image_url'] == undefined)) //2중 체크
    // {
    //     return;
    // }
    const requester_id = this.quiz_session.isMultiplayerSession() ? member.guild.id : member.id;
    if(this.hint_voted_user_list.includes(requester_id))
    {
      return;
    }

    this.hint_voted_user_list.push(requester_id);

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestHint();
      return;
    }

    if(option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.OWNER) //주최자만 hint 사용 가능하면
    {
      if(requester_id == this.quiz_session.owner.id)
      {
        this.showHint(current_question);
        return;
      }
      const reject_message = '```' + `${text_contents.quiz_play_ui.only_owner_can_use_hint}` +'```';
      this.quiz_session.sendMessage({content: reject_message});
    }
    else if(option_data.quiz.hint_type == OPTION_TYPE.HINT_TYPE.VOTE)
    {
      const voice_channel = this.quiz_session.voice_channel;
      const vote_criteria = parseInt((voice_channel.members.size - 2) / 2) + 1; 

      current_question['hint_vote_count'] = current_question['hint_vote_count'] == undefined ? 1 : current_question['hint_vote_count'] + 1;

      let hint_vote_message = text_contents.quiz_play_ui.hint_vote;
      hint_vote_message = hint_vote_message.replace("${who_voted}", utility.sanitizeName(member.displayName));
      hint_vote_message = hint_vote_message.replace("${current_vote_count}", current_question['hint_vote_count'] );
      hint_vote_message = hint_vote_message.replace("${vote_criteria}", vote_criteria);
      this.quiz_session.sendMessage({content: hint_vote_message});
      if(current_question['hint_vote_count']  >= vote_criteria)
      {
        this.showHint(current_question);
      }

    }
  }

  requestSkip(member)
  {
    const option_data = this.quiz_session.option_data;
    const current_question = this.current_question;
    if(current_question == undefined) 
    {
      return;
    }

    const requester_id = this.quiz_session.isMultiplayerSession() ? member.guild.id : member.id;
    if(this.skip_voted_user_list.includes(requester_id))
    {
      return;
    }

    this.skip_voted_user_list.push(requester_id);

    if(this.quiz_session.isMultiplayerSession() && this.quiz_session.isMultiplayerSessionExpired() === false)
    {
      this.quiz_session.sendRequestSkip();
      return;
    }

    if(option_data.quiz.skip_type == OPTION_TYPE.SKIP_TYPE.OWNER) //주최자만 skip 사용 가능하면
    {
      if(requester_id == this.quiz_session.owner.id)
      {
        this.skip(this.current_question);
        return;
      }
      const reject_message = '```' + `${text_contents.quiz_play_ui.only_owner_can_use_skip}` +'```';
      this.quiz_session.sendMessage({content: reject_message});
    }
    else if(option_data.quiz.skip_type == OPTION_TYPE.SKIP_TYPE.VOTE)
    {
      const voice_channel = this.quiz_session.voice_channel;
      const vote_criteria = parseInt((voice_channel.members.size - 2) / 2) + 1; 

      current_question['skip_vote_count'] = current_question['skip_vote_count'] == undefined ? 1 : current_question['skip_vote_count'] + 1;

      let skip_vote_message = text_contents.quiz_play_ui.skip_vote;
      skip_vote_message = skip_vote_message.replace("${who_voted}", utility.sanitizeName(member.displayName));
      skip_vote_message = skip_vote_message.replace("${current_vote_count}", current_question['skip_vote_count']);
      skip_vote_message = skip_vote_message.replace("${vote_criteria}", vote_criteria);
      this.quiz_session.sendMessage({content: skip_vote_message});

      if(current_question['skip_vote_count'] >= vote_criteria)
      {
        this.skip(current_question);
      }
    }
  }
}

//Song Type Question
class QuestionSong extends Question
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

    logger.info(`Questioning Song, guild_id:${this.quiz_session.guild_id}, question_num: ${game_data['question_num']+1}/${quiz_data['quiz_size']}, question: ${question}`);

    //오디오 재생 부
    const resource = current_question['audio_resource'];
    const audio_play_time = current_question['audio_length'] ?? option_data.quiz.audio_play_time;

    this.startAudioList(resource); //오디오 재생 시켜주고

    this.checkAutoHint(audio_play_time); //자동 힌트 체크
    this.startProgressBar(audio_play_time); //진행 bar 시작

    const timeover_promise = this.createTimeoverTimer(audio_play_time); //audio_play_time 후에 실행되는 타임오버 타이머 만들어서
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
      current_question['play_bgm_on_question_finish'] = true; //탄식을 보내주자~
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //타임오버로
    }
  }
}

//Image Type Question
class QuestionImage extends Question
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

    logger.info(`Questioning Image, guild_id:${this.quiz_session.guild_id}, question_num: ${game_data['question_num']+1}/${quiz_data['quiz_size']}, question: ${question}`);

    //그림 퀴즈는 카운트다운 BGM만 틀어준다.
    const is_long = current_question['is_long'] ?? false;
    const audio_player = this.quiz_session.audio_player;
    const audio_play_time = is_long ? 20000 : 10000; //10초, 또는 20초 고정이다.

    const image_resource = current_question['image_resource'];

    //이미지 표시
    let quiz_ui = this.quiz_session.quiz_ui; 
    quiz_ui.setImage(image_resource);
    await quiz_ui.update(); //대기 해줘야한다. 안그러면 타이밍 이슈 땜에 이미지가 2번 올라간다.

    //카운트다운 BGM 재생
    const bgm_type = is_long == true ? BGM_TYPE.COUNTDOWN_LONG : BGM_TYPE.COUNTDOWN_10;
    let resource = undefined;
    this.sendBGM(bgm_type);

    this.checkAutoHint(audio_play_time); //자동 힌트 체크
    this.startProgressBar(audio_play_time); //진행 bar 시작

    const timeover_promise = this.createTimeoverTimer(audio_play_time); //audio_play_time 후에 실행되는 타임오버 타이머 만들어서
    await Promise.race([timeover_promise]); //race로 돌려서 타임오버 타이머가 끝나는걸 기다림

    //어쨋든 타임오버 타이머가 끝났다.
    if(this.quiz_session.force_stop == true) //그런데 강제종료다
    {
      return; //바로 return
    }

    current_question['play_bgm_on_question_finish'] = true; //그림 퀴즈는 어찌됐건 다음 스탭에서 bgm 틀어준다

    if(this.is_timeover == false) //그런데 타임오버로 끝난게 아니다.
    {
      this.stopAudioList(); //BGM 바로 멈춰준다.

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
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //타임오버로
    }
  }
}

//Intro Type Question
class QuestionIntro extends Question
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

//Text Type Question
class QuestionText extends Question
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

    logger.info(`Questioning Text, guild_id:${this.quiz_session.guild_id}, question_num: ${game_data['question_num']+1}/${quiz_data['quiz_size']}, question: ${question.trim()}`);

    //텍스트 퀴즈는 카운트다운 BGM만 틀어준다.
    const is_long = current_question['is_long'] ?? false;
    const audio_player = this.quiz_session.audio_player;
    const audio_play_time = is_long ? 20000 : 10000; //10초, 또는 20초 고정이다.

    this.progress_bar_fixed_text = question; //텍스트 퀴즈는 progress bar 위에 붙여주면 된다.

    //카운트다운 BGM 재생 
    const bgm_type = is_long == true ? BGM_TYPE.COUNTDOWN_LONG : BGM_TYPE.COUNTDOWN_10;
    this.sendBGM(bgm_type);

    this.checkAutoHint(audio_play_time); //자동 힌트 체크
    this.startProgressBar(audio_play_time); //진행 bar 시작

    const timeover_promise = this.createTimeoverTimer(audio_play_time); //audio_play_time 후에 실행되는 타임오버 타이머 만들어서
    await Promise.race([timeover_promise]); //race로 돌려서 타임오버 타이머가 끝나는걸 기다림

    //어쨋든 타임오버 타이머가 끝났다.
    if(this.quiz_session.force_stop == true) //그런데 강제종료다
    {
      return; //바로 return
    }

    current_question['play_bgm_on_question_finish'] = true; //텍스트 퀴즈는 어찌됐건 다음 스탭에서 bgm 틀어준다

    if(this.is_timeover == false) //그런데 타임오버로 끝난게 아니다.
    {
      this.stopAudioList(); //BGM 바로 멈춰준다.

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
      this.next_cycle = CYCLE_TYPE.TIMEOVER; //타임오버로
    }
  }
}

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

//Unknown Type Question
class QuestionUnknown extends Question
{
  static cycle_type = CYCLE_TYPE.QUESTIONING;
  constructor(quiz_session)
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

//#endregion


//#region Timeover Cycle
//lifecycle/time_over.js로 분리 (REFACTOR_PLAN.md Phase 2)
const TimeOver = require('./lifecycle/time_over.js');
//#endregion

//#region CorrectAnswer Cycle
//lifecycle/correct_answer.js로 분리 (REFACTOR_PLAN.md Phase 2)
const CorrectAnswer = require('./lifecycle/correct_answer.js');
//#endregion

//#region Clearing Cycle
//lifecycle/clearing.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Clearing = require('./lifecycle/clearing.js');
//#endregion

//#region Ending Cycle
//lifecycle/ending.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Ending = require('./lifecycle/ending.js');
//#endregion

//#region Finish Cycle
//lifecycle/finish.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Finish = require('./lifecycle/finish.js');
//#endregion

//#region HOLD Cycle
//lifecycle/hold.js로 분리 (REFACTOR_PLAN.md Phase 2)
const HOLD = require('./lifecycle/hold.js');
//#endregion
