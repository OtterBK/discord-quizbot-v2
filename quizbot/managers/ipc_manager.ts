'use strict';

//외부 모듈
const { messageType } = require('discord-hybrid-sharding');

//로컬 모듈
const logger = require('../../utility/logger.js')('IPCManager');
const quiz_system = require('../quiz_system/quiz_system');

/**
 * 샤딩으로인한 공유 객체 및 이벤트 관리
 */
let bot_client: any = undefined;

//공유 오브젝트
let sync_objects = new Map<string, any>();

let guild_count: number;
let local_play_count: number;
let multi_play_count: number;

const IPC_MESSAGE_TYPE = {
  CHECK_STATUS: 0,
  SYNC_STATUS: 1,
  SYNC_ADMIN: 2,
  MULTIPLAYER_SIGNAL: 3,
  WEB_SESSION_REQUEST: 4, //클러스터->마스터 요청-응답 (WEB_INTEGRATION_PLAN.md 참고)
  WEB_SESSION_SIGNAL: 5, //마스터->전체 클러스터 브로드캐스트
};

let relayMultiplayerSignalHandler = (signal: any): void =>
{
  logger.error("relay handler doest not initialized!");
};

let relayWebSessionSignalHandler = (signal: any): void =>
{
  logger.error("web session relay handler doest not initialized!");
};

exports.IPC_MESSAGE_TYPE = IPC_MESSAGE_TYPE;

exports.sync_objects = sync_objects;

exports.initialize = (client: any): boolean | undefined =>
{
  if(client == undefined)
  {
    logger.error(`Failed to Initialize Quiz system. ${'Client is undefined'}`);
    return false;
  }

  bot_client = client;
  bot_client.cluster.on('message', (message: any) =>
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
    else if(message.ipc_message_type == exports.IPC_MESSAGE_TYPE.WEB_SESSION_SIGNAL) //클러스터가 중앙에서부터 웹 세션 메시지를 받았을 때
    {
      relayWebSessionSignalHandler(message.signal);
    }

  });
};

exports.sendMultiplayerSignal = (signal: any): Promise<any> =>
{
  return bot_client.cluster.request({
    ipc_message_type: exports.IPC_MESSAGE_TYPE.MULTIPLAYER_SIGNAL,
    signal: signal
  });
};

exports.adaptRelayHandler = (handler: (signal: any) => void): void =>
{
  relayMultiplayerSignalHandler = handler;
};

exports.sendWebSessionRequest = (request: any): Promise<any> =>
{
  return bot_client.cluster.request({
    ipc_message_type: exports.IPC_MESSAGE_TYPE.WEB_SESSION_REQUEST,
    request: request
  });
};

exports.adaptWebSessionRelayHandler = (handler: (signal: any) => void): void =>
{
  relayWebSessionSignalHandler = handler;
};
