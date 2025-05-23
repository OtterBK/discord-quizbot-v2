'use strict';

//외부 모듈
const { messageType } = require('discord-hybrid-sharding');

//로컬 모듈
const logger = require('../../utility/logger.js')('IPCManager');
const quiz_system = require('../quiz_system/quiz_system.js');

/** 
 * 샤딩으로인한 공유 객체 및 이벤트 관리
 */
let bot_client = undefined;

//공유 오브젝트
let sync_objects = new Map();

let guild_count;
let local_play_count;
let multi_play_count;

const IPC_MESSAGE_TYPE = {
  CHECK_STATUS: 0,
  SYNC_STATUS: 1,
  SYNC_ADMIN: 2,
  MULTIPLAYER_SIGNAL: 3,
};

let relayMultiplayerSignalHandler = (signal) => 
{
  logger.error("relay handler doest not initialized!");
};

exports.IPC_MESSAGE_TYPE = IPC_MESSAGE_TYPE;

exports.sync_objects = sync_objects;

exports.initialize = (client) =>
{
  if(client == undefined)
  {
    logger.error(`Failed to Initialize Quiz system. ${'Client is undefined'}`);
    return false;
  }

  bot_client = client;
  bot_client.cluster.on('message', message => 
  {

    if(message.ipc_message_type == exports.IPC_MESSAGE_TYPE.CHECK_STATUS)
    {
      message.reply({ 
        guild_count: bot_client.guilds.cache.size,  
        local_play_count: quiz_system.getLocalQuizSessionCount(),
        multi_play_count: quiz_system.getMultiplayerQuizSessionCount(),
      });
    }
    else if(message.ipc_message_type == exports.IPC_MESSAGE_TYPE.SYNC_STATUS)
    {
      const status = message.status;
      sync_objects.set('guild_count', status.guild_count);
      sync_objects.set('local_play_count', status.local_play_count);
      sync_objects.set('multi_play_count', status.multi_play_count);
    }
    else if(message.ipc_message_type == exports.IPC_MESSAGE_TYPE.SYNC_ADMIN)
    {
      const admin_instance = message.admin_instance;
      sync_objects.set("admin_instance", admin_instance);
      logger.info("synced admin instance!");
    }
    else if(message.ipc_message_type == exports.IPC_MESSAGE_TYPE.MULTIPLAYER_SIGNAL) //클러스터가 중앙에서부터 Multiplayer 메시지를 받았을 떄
    {
      relayMultiplayerSignalHandler(message.signal);
    }

  });
};

exports.sendMultiplayerSignal = (signal) =>
{
  return bot_client.cluster.request({
    ipc_message_type: exports.IPC_MESSAGE_TYPE.MULTIPLAYER_SIGNAL,
    signal: signal
  });
};

exports.adaptRelayHandler = (handler) =>
{
  relayMultiplayerSignalHandler = handler;
};

