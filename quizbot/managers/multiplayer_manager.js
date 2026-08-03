'use strict';

//로컬 모듈
const db_manager = require('./db_manager.js');

//multiplayer_session_registry.js, multiplayer_signal_handlers.js로 분리 (REFACTOR_PLAN.md Phase 3)
//index.js가 이 두 함수만 쓰기 때문에(초기화 + 신호 수신), multiplayer_manager.js는
//얇은 facade로만 남기고 실제 구현은 각 책임별 파일로 옮겼다:
//  - multiplayer_session_registry.js: multiplayer_sessions/cluster_manager/broadcast
//  - multiplayer_mmr.js: MMR 계산 공식
//  - multiplayer_guild_info.js: MultiplayerGuildInfo 클래스
//  - multiplayer_session.js: MultiplayerSession(+SESSION_STATE) 클래스
//  - multiplayer_signal_handlers.js: CLIENT_SIGNAL 처리(handle*, onSignalReceived)
const session_registry = require('./multiplayer_session_registry.js');
const signal_handlers = require('./multiplayer_signal_handlers.js');

/**
 * 멀티플레이 세션 및 메시지 처리용 매니저
 */

exports.initialize = (manager) =>
{
  session_registry.setClusterManager(manager);
  db_manager.initialize();
};

exports.onSignalReceived = (signal) =>
{
  return signal_handlers.onSignalReceived(signal);
};
