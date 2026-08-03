'use strict';

//voice 용으로 libsodium-wrapper 를 쓸 것! sodium 으로 하면 cpu 사용량 장난아님;

//#region 외부 모듈 로드
const pathToFfmpeg = require('ffmpeg-static');
process.env.FFMPEG_PATH = pathToFfmpeg;
//#endregion

//#region 로컬 모듈 로드
const { SYSTEM_CONFIG, CUSTOM_EVENT_TYPE } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const logger = require('../../utility/logger.js')('QuizSystem');

//session/quiz_session.js, session/multiplayer_session.js로 분리 (REFACTOR_PLAN.md Phase 2)
//quiz_system.js는 이제 세션 생성/조회용 facade 함수만 갖고, 실제 세션 클래스 구현은
//전부 session/, lifecycle/ 하위로 옮겨졌다.
const { NormalQuizSession, DummyQuizSession } = require('./session/quiz_session.js');
const { MultiplayerLobbySession, MultiplayerQuizSession } = require('./session/multiplayer_session.js');

//#endregion

//#region 상수 타입 정의
const { QUIZ_SESSION_TYPE } = require('./constants.js');

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

//#endregion
