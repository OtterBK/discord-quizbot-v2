'use strict';

//multiplayer_manager.js에서 분리 (REFACTOR_PLAN.md Phase 3)
//multiplayer_sessions(session_id별 활성 멀티플레이 세션 registry)와
//cluster_manager(클러스터 매니저 참조)는 IPC 신호 처리/로비 관리/MMR 계산
//전부가 함께 읽고 쓰는 공유 상태라, 책임별로 파일을 쪼개기 전에 먼저
//한 모듈로 모았다 (quiz_system.js Phase 2의 session_registry.js와 같은 패턴).
//로직/주석은 원본과 동일 (동작 변경 없음).

const logger = require('../../utility/logger.js')('MultiplayerManager');
const { IPC_MESSAGE_TYPE } = require('./ipc_manager.js');

let cluster_manager = undefined;
exports.multiplayer_sessions = {}; //

exports.setClusterManager = (manager) =>
{
  cluster_manager = manager;
};

exports.broadcast = (signal) =>
{
  if(cluster_manager === undefined)
  {
    logger.error(`Cluster Manager has not been assigned!`);
    return;
  }

  cluster_manager.broadcast(
    {
      ipc_message_type: IPC_MESSAGE_TYPE.MULTIPLAYER_SIGNAL,
      signal: signal
    });
};
