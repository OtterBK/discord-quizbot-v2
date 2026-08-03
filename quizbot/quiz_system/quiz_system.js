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

const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE, QUIZ_TYPE, BGM_TYPE, QUIZ_MAKER_TYPE } = require('../../config/system_setting.js');
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
//lifecycle/question/*.js로 분리 (REFACTOR_PLAN.md Phase 2)
const Question = require('./lifecycle/question/question.js');
const QuestionSong = require('./lifecycle/question/question_song.js');
const QuestionImage = require('./lifecycle/question/question_image.js');
const QuestionIntro = require('./lifecycle/question/question_intro.js');
const QuestionText = require('./lifecycle/question/question_text.js');
const QuestionOX = require('./lifecycle/question/question_ox.js');
const QuestionCustom = require('./lifecycle/question/question_custom.js');
const QuestionOmakase = require('./lifecycle/question/question_omakase.js');
const QuestionUnknown = require('./lifecycle/question/question_unknown.js');
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
