/**
 * Sharding을 위해 bot의 소스코드는 bot.js로 옮겼다
 * 내가 이해한게 맞다면
 * cluster는 각각의 병렬 프로세스이고
 * master cluster에서 cluster를 생성하면 이 cluster는 각각의 내부 shard를 생성한다.
 * 각각의 shard는 봇 서버라고 생각하면 되고 일정 길드 수 별로 각각의 shard와 통신한다.
 * 기본으로 제공되는 shard manager 방식은 하나의 cluster에 여러 shard를 생성하는 방식인데,
 * 이 경우 사실 상 1개의 프로세스에서 동작하기 때문에 14000개 이상의 길드에서는 동작이 느리다
 * 반면 이 discord-hybrid-sharding 라이브러리는 master 프로세스에서 여러 개의 병렬 프로세스를 생성하고
 * 생성된 프로세스는 각각의 내부 shard를 갖기 때문에 메모리 및 성능 부분에서 더 좋다
 */

//외부 모듈
const { ClusterManager, HeartbeatManager } = require('discord-hybrid-sharding');

//로컬 모듈
const PRIVATE_CONFIG = require('./config/private_config.json');
const logger = require('./utility/logger.js')('ShardManager');
const { SYSTEM_CONFIG } = require('./config/system_setting.js');
const { IPC_MESSAGE_TYPE } = require('./quizbot/managers/ipc_manager.js');
// const web_manager = require('./web/web_manager.js'); //고정 html 표시로 바꿔서 웹서버 열 필요 없음
const multiplayer_manager = require('./quizbot/managers/multiplayer_manager.js');

const manager = new ClusterManager(`${__dirname}/quizbot/bot.js`, {
  totalShards: 'auto', // or 'auto'
  shardsPerClusters: 2,
  totalClusters: 'auto',
  token: PRIVATE_CONFIG.BOT.TOKEN,
  restarts: { //최대 자동 재시작 횟수
    max: 5, // Maximum amount of restarts per cluster
    interval: 60000 * 60, // Interval to reset restarts
  },
  // mode: 'process'
});

multiplayer_manager.initialize(manager);

manager.extend( 
  //신호가 최대 miss에 달하면 알아서 재시작함
  new HeartbeatManager({
    interval: 10000, // Interval to send a heartbeat
    maxMissedHeartbeats: 10, // Maximum amount of missed Heartbeats until Cluster will get respawn
  })
);

manager.on('clusterCreate', cluster =>
{
  cluster.on('message', message => 
  {
    if(message.ipc_message_type === IPC_MESSAGE_TYPE.SYNC_ADMIN) //그대로 뿌려줌
    {
      logger.info("Broadcasting SYNC ADMIN message");
      manager.broadcast(message);
      return;
    }

    if(message.ipc_message_type === IPC_MESSAGE_TYPE.MULTIPLAYER_SIGNAL) //클러스터로부터 멀티플레이 관련 메시지 수싲
    {
      const reply_signal = multiplayer_manager.onSignalReceived(message.signal); //그대로 중앙 매니저한테 전달

      if(reply_signal !== undefined)
      {
        message.reply(reply_signal);
      }
    }
  });

  logger.info(`Launched Cluster ${cluster.id}`);
});

/**
 * Sync
 */
setInterval(async () => 
{ //플레이 현황 체크용

  const message = { 
    ipc_message_type: IPC_MESSAGE_TYPE.CHECK_STATUS, 
  };

  let results = [];
  for (const cluster of Array.from(manager.clusters.values())) 
  {
    try
    {
      const reply = await cluster.request(message);
      if(reply != undefined)
        results.push(reply);
    }
    catch(err)
    {
      return;
    }

  }

  let status = {
    guild_count: 0,
    local_play_count: 0,
    multi_play_count: 0,
  };

  results.forEach(result => 
  {
    status.guild_count += result.guild_count;
    status.local_play_count += result.local_play_count;
    status.multi_play_count += result.multi_play_count;
  });

  manager.broadcast( {
    ipc_message_type: IPC_MESSAGE_TYPE.SYNC_STATUS,
    status: status,
  });


}, SYSTEM_CONFIG.GUILDS_COUNT_MANAGER_INTERVAL * 1000);

// //웹 서버 시작
// web_manager.strat_web();

//전역 에러 처리
process.on('uncaughtException', (err) => 
{
  logger.error(`Uncaught exception error!!! err: ${err.stack}`);
});

manager.spawn({ timeout: -1 });
