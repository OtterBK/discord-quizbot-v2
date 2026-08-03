'use strict';

//multiplayer_manager.js에서 분리 (REFACTOR_PLAN.md Phase 3)
//멀티플레이 로비/게임 진행 상태 전체를 갖는 세션 클래스. IPC 신호 처리(handle*)
//쪽은 multiplayer_signal_handlers.js로, 공유 registry는 multiplayer_session_registry.js로,
//MMR 계산 공식은 multiplayer_mmr.js로 각각 분리됐다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const logger = require('../../utility/logger.js')('MultiplayerManager');
const { SERVER_SIGNAL } = require('./multiplayer_signal.js');
const db_manager = require('./db_manager.js');
const utility = require('../../utility/utility.js');

const session_registry = require('./multiplayer_session_registry.js');
const multiplayer_mmr = require('./multiplayer_mmr.js');
const MultiplayerGuildInfo = require('./multiplayer_guild_info.js');

const SESSION_STATE = 
{
  PREPARE: 0,
  LOBBY: 1,
  INGAME: 2,
};

class MultiplayerSession
{
  constructor(guild_id, guild_name, quiz_info)
  {
    // this.uuid = utility.generateUUID(); //ID. 중복검사는 하지 않겠다. 설마 겹치겠어? -> 필요 없을 듯

    const owner_guild_info  = new MultiplayerGuildInfo(guild_id, guild_name);
    owner_guild_info.setReady(true);

    this.session_owner_guild_id = guild_id;
    this.owner_guild_info = owner_guild_info; //방장 길드
    this.quiz_info = quiz_info;
    this.participant_guilds = [ owner_guild_info ]; //참여 중인 길드들

    this.banned_guilds = []; //해당 세션에서 추방된 길드들

    this.state = SESSION_STATE.PREPARE;

    this.question_list = [];
    this.quiz_size = 0;
    this.prepared_question = undefined;

    this.first_sync_received_time = undefined;
    this.max_sync_wait = 40000; //최대 40초 간격까지 sync 대기
    this.sync_done_sequence_num = 0;

    this.current_answerer_info = undefined;

    this.scoreboard = new Map(); //scoreboard 
    this.mvp_scoreboard = new Map(); //vip 맴버 scoreboard 용
    this.top_score = 0; //최종 점수 계산 시, top score의 점수

    this.sync_failed_list = []; //sync 실패한 목록들

    setTimeout(() => // return true;대충 1초 정도는 기다리도록(별 의미는 없고 ui띄워지는 시간도 있으니)
    {
      this.state = SESSION_STATE.LOBBY;
    }, 1000);
  }

  free()
  {
    this.session_owner_guild_id = null;
    this.owner_guild_info = null;
    this.quiz_info = null;
    this.participant_guilds = null;

    this.banned_guilds = null;

    this.state = null;

    this.question_list = null;
    this.quiz_size = null;
    this.prepared_question = null;

    this.first_sync_received_time = null;
    this.max_sync_wait = null;
    this.sync_done_sequence_num = null;

    this.current_answerer_info = null;

    this.scoreboard = null;
    this.mvp_scoreboard = null;

    this.sync_failed_list = null;

    this.top_score = null;
  }

  getState()
  {
    return this.state;
  }

  getQuizInfo()
  {
    return this.quiz_info;
  }

  getLobbyInfo()
  {
    const guilds_info_list = [];
    this.participant_guilds.forEach(g => 
    {
      guilds_info_list.push(g.toJsonObject());
    });

    return {
      quiz_info: this.quiz_info,
      participant_guilds_info: guilds_info_list,
    };
  }

  getParticipantCount()
  {
    return this.participant_guilds.length;
  }

  getSessionId()
  {
    return this.owner_guild_info.guild_id; //세션 id는 주인장이다.
  }

  getSessionHostId()
  {
    return this.session_owner_guild_id;
  }

  getSessionName()
  {
    return this.quiz_info.title;
  }

  getHostGuildName()
  {
    return this.owner_guild_info?.guild_name;
  }

  getAverageMMR()
  {
    let mmr_avg = 0;

    for(const guild_info of this.participant_guilds)
    {
      mmr_avg += guild_info.stat.mmr;
    }

    return Math.round(mmr_avg / this.getParticipantCount());
  }

  isIngame()
  {
    return this.state === SESSION_STATE.INGAME;
  }

  getParticipant(target_guild_id)
  {
    for(const guild_info of this.participant_guilds)   
    {
      if(guild_info.guild_id === target_guild_id)
      {
        return guild_info;
      }
    }

    return undefined;
  }

  getOwnerGuildInfo()
  {
    return this.owner_guild_info;
  }

  checkBanned(guild_id)
  {
    if(this.banned_guilds.includes(guild_id))
    {
      return true;
    }

    return false;
  }

  checkAllReady()
  {
    let all_ready = true;    
    const guilds_info_list = [];
    this.participant_guilds.forEach(g => 
    {
      if(g.isReady() === false)
      {
        all_ready = false;
      }

      guilds_info_list.push(g.toJsonObject());
    });

    if(all_ready === true)
    {
      return all_ready;
    }

    let ready_state_notice = '🌐 게임을 시작할 수 없습니다. 아직 준비되지 않은 서버가 존재합니다.\n\n📑 [준비 현황]\n';
    for(const guild_info of guilds_info_list)
    {
      ready_state_notice += `${guild_info.ready ? '⭕' : '❌'} ${guild_info.guild_name}: ${guild_info.ready ? '준비 완료' : '준비되지 않음'}\n`;
    }

    const signal = {
      signal_type: SERVER_SIGNAL.NOTICE_MESSAGE,
      notice: `\`\`\`${ready_state_notice}\`\`\``
    };
    this.sendSignal(signal);

    return all_ready;
  }

  removeParticipant(target_guild_id)
  {
    let target_guild_info = undefined;
    //target guild id 빼고 다시 array 생성
    this.participant_guilds = this.participant_guilds.filter((guild_info) => 
    {
      if(guild_info.guild_id === target_guild_id)
      {
        target_guild_info = guild_info;
        return false;
      }

      return true;
    });

    return target_guild_info;
  }

  delete()
  {
    delete session_registry.multiplayer_sessions[this.getSessionId()];

    session_registry.sendMultiplayerLobbyCount();

    this.free();
  }

  changeHost(guild_info)
  {
    const previous_session_id = this.getSessionId();
    this.session_owner_guild_id = guild_info.guild_id;
    this.owner_guild_info = guild_info; 

    const signal = {
      signal_type: SERVER_SIGNAL.HOST_CHANGED,
      new_host_guild_info: guild_info.toJsonObject(),
    };
    this.sendSignal(signal);

    delete session_registry.multiplayer_sessions[previous_session_id];
    session_registry.multiplayer_sessions[this.getSessionId()] = this;

    logger.info(`The host changed to ${previous_session_id} -> ${this.getSessionId()}`);
  }

  checkSyncDone()
  {
    for(const guild_info of this.participant_guilds)
    {
      if(guild_info.isSyncing() === false)
      {
        return false;
      }
    }

    return true;
  }

  resetSyncState()
  {
    this.first_sync_received_time = undefined;

    for(const guild_info of this.participant_guilds)
    {
      guild_info.setSyncState(false);
    }
  }

  resetRequestState()
  {
    this.current_answerer_info = undefined;

    for(const guild_info of this.participant_guilds)
    {
      guild_info.resetRequestState(false);
    }
  }

  firstSyncReceived()
  {
    this.first_sync_received_time = new Date();
    const current_sync_done_sequence_num = this.sync_done_sequence_num;

    setTimeout(() => 
    {
      if(current_sync_done_sequence_num != this.sync_done_sequence_num)
      {
        return;
      }

      this.sendSyncFailed(); //일정시간 지나면 sync failed 보내주고
      this.sendSyncDone(); //어쩔 수 없이 강제 싱크

    }, this.max_sync_wait);
  }

  sendSyncFailed()
  {
    const failed_guild_list = [];

    for(const guild_info of this.participant_guilds)
    {
      if(guild_info.isSyncing()) //동기화 중이면 대상 아님
      {
        continue; 
      }

      //범인들임
      failed_guild_list.push(guild_info);
    }

    logger.warn(`Sync failed detected from server side. session_id: ${this.getSessionId()}), failed_guild_size: ${failed_guild_list.length} / ${this.getParticipantCount()}`);
    for(const guild_info of failed_guild_list)
    {
      this.syncFailedDetected(guild_info.guild_id);  
    }
  }

  syncFailedDetected(guild_id)
  {
    logger.warn(`Sync failed detected. guild_id: ${guild_id}).`);

    this.sync_failed_list.push(guild_id);

    const failed_guild_info = this.getParticipant(guild_id);
    if(failed_guild_info === undefined)
    {
      logger.warn(`but ${guild_id} is not participant of ${this.getSessionId()}`);
      return true;
    }

    const signal = {
      signal_type: SERVER_SIGNAL.SYNC_FAILED_DETECTED,
      failed_guild_info: failed_guild_info,
    };
    this.sendSignal(signal); 
    
    this.processLeaveGame(guild_id); //동기 실패 신호 보내주고 퇴장 처리
  }

  sendSyncDone()
  {
    this.resetSyncState();
    this.resetRequestState();

    this.sync_done_sequence_num += 1;

    const guilds_info_list = [];
    this.participant_guilds.forEach(g => 
    {
      guilds_info_list.push(g.toJsonObject());
    });
    
    const signal = {
      signal_type: SERVER_SIGNAL.SYNC_DONE,
      sequence_num: this.sync_done_sequence_num,
      participant_guilds_info: guilds_info_list,
      question_num: this.question_num
      
    };
    this.sendSignal(signal);


    logger.debug(`${this.getSessionId()} session sync done`);
  }

  getRequestConfirmCriteria()
  {
    return Math.floor(this.participant_guilds.length / 2) + 1;
  }

  processLeaveGame(guild_id)
  {
    const leaved_guild_info = this.getParticipant(guild_id);
    if(leaved_guild_info === undefined)
    {
      logger.warn(`but ${guild_id} is not participant of ${this.getSessionId()}`);
      return true;
    }

    this.removeParticipant(guild_id);

    const signal = {
      signal_type: SERVER_SIGNAL.LEAVED_GAME,
      lobby_info: this.getLobbyInfo(),
      leaved_guild_info: leaved_guild_info.toJsonObject(),
    };
    this.sendSignal(signal);

    const guild_answerer_info = this.scoreboard.get(guild_id);
    if(guild_answerer_info !== undefined)
    {
      guild_answerer_info.score = 0;
    }

    //어라? 나간게... 호스트?
    //호스트도 변경!
    let new_host_guild_info = undefined;
    if(this.session_owner_guild_id === guild_id && this.getParticipantCount() > 0)
    {
      new_host_guild_info = this.participant_guilds[0];
      this.changeHost(new_host_guild_info);
    }
    
    if(this.getParticipantCount() <= 1) //1명 이하 남앗다면
    {
      const signal = { //세션 펑
        signal_type: SERVER_SIGNAL.EXPIRED_SESSION,
      };

      this.sendSignal(signal);
      logger.info(`${guild_id} has been leaved from ingame. and only one guilds left. expiring this session`);

      const trigger_guild_id = new_host_guild_info ? new_host_guild_info.guild_id : this.session_owner_guild_id;
      this.finishUp(trigger_guild_id);
      this.finish(trigger_guild_id);
    }
  }

  processWinner(guild_id)
  {
    let win_add = 1;
    let lose_add = 0;
    let play_add = 1;
    let mmr_add = 0;

    const guild_info = this.getParticipant(guild_id);
    mmr_add = this.calcWinnerMMR(guild_info);

    logger.info(`Processing winner ${guild_id}. win_add: ${win_add}, lose_add: ${lose_add}, play_add: ${play_add}, mmr_add: ${mmr_add}`);

    db_manager.updateGlobalScoreboard(guild_id, win_add, lose_add, play_add, mmr_add, (guild_info ? guild_info.guild_name : ''));
  }

  processLoser(guild_id, score)
  {
    let win_add = 0;
    let lose_add = 1;
    let play_add = 1;
    let mmr_add = 0;

    const guild_info = this.getParticipant(guild_id);
    mmr_add = this.calcLoserMMR(guild_info, score);

    logger.info(`Processing loser ${guild_id}. win_add: ${win_add}, lose_add: ${lose_add}, play_add: ${play_add}, mmr_add: ${mmr_add}`);

    db_manager.updateGlobalScoreboard(guild_id, win_add, lose_add, play_add, mmr_add, (guild_info ? guild_info.guild_name : ''));
  }

  //multiplayer_mmr.js로 분리 (REFACTOR_PLAN.md Phase 3) - 공식은 원본과 동일,
  //this.question_num/this.scoreboard.size/this.top_score를 인자로 넘겨주는 얇은 래퍼.
  calcWinnerMMR(guild_info)
  {
    return multiplayer_mmr.calcWinnerMMR(guild_info, this.question_num, this.scoreboard.size);
  }

  calcLoserMMR(guild_info, score = 0)
  {
    return multiplayer_mmr.calcLoserMMR(guild_info, score, this.question_num, this.top_score);
  }
  
  
  finishUp(guild_id)
  {
    logger.info(`${this.getSessionId()} finished up game. by ${guild_id}`);

    //mvp 부터 구해보자
    const sorted_mvp_scoreboard = utility.sortMapByProperty(this.mvp_scoreboard, 'score');
    if(sorted_mvp_scoreboard.size !== 0)
    {
      const [user_id, mvp_info] = sorted_mvp_scoreboard.entries().next().value;

      const signal = {
        signal_type: SERVER_SIGNAL.CONFIRM_MVP,
        mvp_info: mvp_info,
      };
      this.sendSignal(signal); 

      logger.debug(`${this.getSessionId()}'s mvp is ${mvp_info.name}/${mvp_info.score}`);
    }

    if(this.quiz_size < 20) //문제 수가 20개 미만이면 전적 반영하지 않는다.
    {
      logger.info(`Question length is less than 20 ${this.getSessionId()}. do not apply scoreboard.`);
      return;
    }

    //이제 승리자 구해보자. 이긴 사람만이 점수를 받는거다.
    const sorted_scoreboard = utility.sortMapByProperty(this.scoreboard, 'score');
    const iter = sorted_scoreboard.entries();
    for(let i = 0; i < sorted_scoreboard.size; ++i)
    {
      const [guild_id, answerer_info] = iter.next().value;

      if(i === 0)
      {
        this.processWinner(guild_id);
        logger.debug(`${this.getSessionId()}'s winner is ${guild_id}/${answerer_info.score}`);
      }
      else
      {
        if(this.sync_failed_list.includes(guild_id))
        {
          logger.debug(`${this.getSessionId()}'s loser is ${guild_id}. but this guild is sync failed`);
          continue;
        }

        this.processLoser(guild_id, answerer_info.score);
      }
      
    }
  }

  finish(guild_id)
  {
    logger.info(`${this.getSessionId()} finished game. by ${guild_id}`);

    this.delete();
  }

  initScoreboard()
  {
    for(const guild_info of this.participant_guilds)
    {
      const guild_answerer_info = {
        name: guild_info.guild_name,
        score: 0
      };
  
      this.scoreboard.set(guild_info.guild_id, guild_answerer_info);
    }
  }

  convertToTimeString(time)
  {
    if(time ===- undefined)
    {
      return '';
    }

    const hours = String(time.getHours()).padStart(2, '0');
    const minutes = String(time.getMinutes()).padStart(2, '0');
    const seconds = String(time.getSeconds()).padStart(2, '0');

    return ` ${hours}:${minutes}:${seconds}`;
  }

  sendSignal(signal)
  {
    let guild_ids = [];
    for(const guild_info of this.participant_guilds)
    {
      guild_ids.push(guild_info.guild_id);
    }

    signal.guild_ids = guild_ids;
    signal.session_id = this.getSessionId();

    session_registry.broadcast(signal);
  }


  acceptJoinRequest(guild_id, guild_name)
  {
    const new_guild_info = new MultiplayerGuildInfo(guild_id, guild_name);

    new_guild_info.loadStat()
      .then((updated_guild_info) => 
      {
        if(updated_guild_info)
        {
          this.sendStatLoaded(updated_guild_info);
        }
      });

    this.participant_guilds.push(new_guild_info);

    const signal = {
      signal_type: SERVER_SIGNAL.JOINED_LOBBY,
      lobby_info: this.getLobbyInfo(),
      joined_guild_info: new_guild_info.toJsonObject(),
    };
    this.sendSignal(signal); //정작 join 요청한 길드는 해당 signal 핸들링을 못한다.(아직 퀴즈 세션 생성이 안돼서)

    logger.info(`${guild_id} has been joined to ${this.getSessionId()}(${this.getSessionName()})`);

    return true;
  }

  acceptLeaveLobby(guild_id)
  {
    logger.info(`${guild_id} has been leaved lobby from ${this.getSessionId()}(${this.getSessionName()})`);

    if(this.getState !== SESSION_STATE.PREPARE && this.getState() !== SESSION_STATE.LOBBY)
    {
      logger.warn(`but ${this.getSessionId()} is not lobby`);
      return true;
    }
  
    const leaved_guild_info = this.removeParticipant(guild_id);
    if(leaved_guild_info === undefined)
    {
      if(this.checkBanned(guild_id) === false)
      {
        logger.warn(`but ${guild_id} is not participant of ${this.getSessionId()}`);
      }

      return true;
    }

    const signal = {
      signal_type: SERVER_SIGNAL.LEAVED_LOBBY,
      lobby_info: this.getLobbyInfo(),
      leaved_guild_info: leaved_guild_info.toJsonObject(),
    };
    this.sendSignal(signal);

    if(this.session_owner_guild_id === guild_id) //어라? 나간게... 호스트?
    {
      const signal = { //세션 펑
        signal_type: SERVER_SIGNAL.EXPIRED_SESSION,
      };
      this.sendSignal(signal);
      
      logger.info(`The host of ${this.getSessionId()} has been leaved from lobby. expiring this session`);

      this.finish(guild_id);
    }

    return true;
  }

  acceptEditRequest(guild_id, quiz_info)
  {
    this.quiz_info = quiz_info;

    const signal = {
      signal_type: SERVER_SIGNAL.EDITED_LOBBY,
      lobby_info: this.getLobbyInfo(),
    };
    this.sendSignal(signal);

    logger.debug(`session ${this.getSessionId()}'s quiz info edited by ${guild_id}`);

    for(const guild_info of this.participant_guilds) //로비 변경됐으면 준비 완료 해제.
    {
      guild_info.setReady(false);
    }

    this.owner_guild_info.setReady(true); //방장은 자동 레디

    return true;
  }

  acceptKickRequest(guild_id, target_guild_id)
  {
    let target_guild_info = this.getParticipant(target_guild_id);

    const kicked_signal = {
      signal_type: SERVER_SIGNAL.KICKED_PARTICIPANT,
      kicked_guild_info: target_guild_info.toJsonObject(),
    };
    this.sendSignal(kicked_signal);

    this.removeParticipant(target_guild_id);
    this.banned_guilds.push(target_guild_id);

    const edited_signal = {
      signal_type: SERVER_SIGNAL.EDITED_LOBBY,
      lobby_info: this.getLobbyInfo(),
    };
    this.sendSignal(edited_signal);

    logger.info(`${guild_id} kicked ${target_guild_id} from multiplayer lobby session`);

    return true;
  }

  acceptStartRequest(guild_id)
  {
    const signal = {
      signal_type: SERVER_SIGNAL.STARTED_LOBBY,
      lobby_info: this.getLobbyInfo(),
      owner_name: this.getOwnerGuildInfo().guild_name,
    };
    this.sendSignal(signal);

    this.state = SESSION_STATE.INGAME;

    logger.info(`Multiplayer session ${this.getSessionId()}/${this.getSessionName()} started by ${guild_id}`);

    session_registry.sendMultiplayerLobbyCount();

    this.initScoreboard();

    return true;
  }

  shareQuestionList(question_list, quiz_size)
  {
    if(this.question_list.length !== 0)
    {
      logger.warn(`Receive generated question list. but question list is already assigned`);
      return;
    }

    this.question_list = question_list;
    this.quiz_size = quiz_size;

    const signal = {
      signal_type: SERVER_SIGNAL.APPLY_QUESTION_LIST,
      question_list: this.question_list,
      quiz_size: this.quiz_size,
    };
    this.sendSignal(signal);

    logger.info(`${this.getSessionId()} is Sharing question list. size: ${this.quiz_size}/${this.question_list.length}`);

    return true;
  }

  sharePreparedQuestion(prepared_question, question_num)
  {
    this.prepared_question = prepared_question;
    this.question_num = question_num;

    const signal = {
      signal_type: SERVER_SIGNAL.APPLY_NEXT_QUESTION,
      prepared_question: this.prepared_question,
      question_num: this.question_num,
    };
    this.sendSignal(signal);

    logger.debug(`${this.getSessionId()} is Sharing prepared question ${this.question_num}`);

    return true;
  }

  acceptSyncRequest(guild_id, guild_state)
  {
    const guild_info = this.getParticipant(guild_id);

    guild_info.setSyncState(true);

    if(guild_state !== undefined)
    {
      guild_info.setGuildState(guild_state);
    }

    if(this.first_sync_received_time === undefined)
    {
      this.firstSyncReceived();
    }

    logger.debug(`Accept Sync Request from ${guild_id} first: ${this.convertToTimeString(this.first_sync_received_time)} current: ${this.convertToTimeString(new Date())}`);

    if(this.checkSyncDone())
    {
      this.sendSyncDone();
    }
  }

  acceptHintRequest(guild_id)
  {
    const guild_info = this.getParticipant(guild_id);

    if(guild_info.isHintRequested())
    {
      return true;
    }

    guild_info.requestHint();

    let hint_requested_count = 0;
    for(const guild_info of this.participant_guilds)
    {
      if(guild_info.isHintRequested() === false)
      {
        continue;
      }

      ++hint_requested_count;
    }

    const confirm_criteria = this.getRequestConfirmCriteria();

    const signal = {
      signal_type: SERVER_SIGNAL.NOTICE_MESSAGE,
      notice: `\`\`\`🗳 ${guild_info.guild_name} 서버가 힌트 요청에 투표했습니다. ( ${hint_requested_count} / ${confirm_criteria} )\`\`\``
    };
    this.sendSignal(signal);

    if(hint_requested_count >= confirm_criteria)
    {
      const signal = {
        signal_type: SERVER_SIGNAL.CONFIRM_HINT,
      };
      this.sendSignal(signal);
    }

    logger.debug(`Accept Hint Request from ${guild_id} ${hint_requested_count}/${confirm_criteria}`);
  }

  acceptSkipRequest(guild_id)
  {
    const guild_info = this.getParticipant(guild_id);

    if(guild_info.isSkipRequested())
    {
      return true;
    }

    guild_info.requestSkip();

    let skip_requested_count = 0;
    for(const guild_info of this.participant_guilds)
    {
      if(guild_info.isSkipRequested() === false)
      {
        continue;
      }

      ++skip_requested_count;
    }

    const confirm_criteria = this.getRequestConfirmCriteria();

    const signal = {
      signal_type: SERVER_SIGNAL.NOTICE_MESSAGE,
      notice: `\`\`\`🗳 ${guild_info.guild_name} 서버가 스킵 요청에 투표했습니다. ( ${skip_requested_count} / ${confirm_criteria} )\`\`\``
    };
    this.sendSignal(signal);

    if(skip_requested_count >= confirm_criteria)
    {
      const signal = {
        signal_type: SERVER_SIGNAL.CONFIRM_SKIP,
      };
      this.sendSignal(signal);
    }

    logger.debug(`Accept Skip Request from ${guild_id} ${skip_requested_count}/${confirm_criteria}`);
  }

  acceptAnswerHitRequest(guild_id, answerer_info)
  {
    //사실 먼저 온 사람이 임자다 ㅋㅅㅋ
    if(this.current_answerer_info !== undefined)
    {
      return true;
    }

    this.current_answerer_info = answerer_info;

    const answerer_id = this.current_answerer_info.answerer_id;
    const answerer_name = this.current_answerer_info.answerer_name;
    const score = this.current_answerer_info.score;

    const guild_info = this.getParticipant(guild_id);

    const signal = {
      signal_type: SERVER_SIGNAL.CONFIRM_ANSWER_HIT,
      answerer_info: {
        answerer_id: guild_id,
        answerer_name: `${answerer_name} (${guild_info.guild_name})`,
        score: score,
      }
    };
    this.sendSignal(signal); //우선 신호부터 보내준다.

    logger.debug(`Accept Request Answer hit from ${guild_id} by ${answerer_id}/${answerer_name}/${score}`);

    //vip 계산용 scoreboard에 반영
    let member_answerer_info = this.mvp_scoreboard.get(answerer_id);
    if(member_answerer_info === undefined)
    {
      member_answerer_info = {
        name: answerer_name,
        score: score  
      };

      this.mvp_scoreboard.set(answerer_id, member_answerer_info);
    }
    else
    {
      member_answerer_info.name = answerer_name;
      member_answerer_info.score += score;
    }

    //scoreboard 에 반영
    let guild_answerer_info = this.scoreboard.get(guild_id);
    if(guild_answerer_info === undefined)
    {
      guild_answerer_info = {
        name: answerer_name,
        score: score
      };

      this.scoreboard.set(guild_id, guild_answerer_info);
    }
    else
    {
      guild_answerer_info.name = answerer_name;
      guild_answerer_info.score += score;
    }
  }

  acceptLeaveGame(guild_id)
  {
    logger.info(`${guild_id} has been leaved game from ${this.getSessionId()}(${this.getSessionName()})`);

    if(this.getState() !== SESSION_STATE.INGAME) //게임 중 아니면 패스임
    {
      logger.warn(`but ${this.getSessionId()} is not INGAME`);
      return true;
    }

    this.processLeaveGame(guild_id);

    return true;
  }

  acceptChatRequest(guild_id, user_id, chat_message)
  {
    const signal = { //세션 펑
      signal_type: SERVER_SIGNAL.CONFIRM_CHAT,
      guild_id: guild_id,
      user_id: user_id,
      timestamp: Date.now(),
      chat_message: chat_message
    };
    this.sendSignal(signal);
    logger.info(`Broadcasting Chat Message ${guild_id}_${user_id}: ${chat_message}`);
  }

  sendStatLoaded(updated_guild_info)
  {
    const guilds_info_list = [];
    this.participant_guilds.forEach(g => 
    {
      guilds_info_list.push(g.toJsonObject());
    });

    const signal = {
      signal_type: SERVER_SIGNAL.PARTICIPANT_INFO_UPDATE,
      lobby_info: this.getLobbyInfo(),
      updated_guild_info: updated_guild_info.toJsonObject(),
    };
    this.sendSignal(signal);
  }

  acceptReady(guild_id)
  {
    const ready_guild_info = this.getParticipant(guild_id);
    ready_guild_info.setReady(true);

    const signal = {
      signal_type: SERVER_SIGNAL.CONFIRM_READY,
      ready_guild_info: ready_guild_info.toJsonObject(),
    };
    this.sendSignal(signal);

    logger.info(`Ready Accepted guild_id ${guild_id}, session_id: ${this.getSessionId()}`);

    return true;
  }
  
}


module.exports = { MultiplayerSession, SESSION_STATE };
