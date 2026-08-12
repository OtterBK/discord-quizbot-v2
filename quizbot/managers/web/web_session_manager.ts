//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) 마스터 전용 싱글턴.
//멀티플레이의 multiplayer_session_registry.js와 같은 이유로 마스터 프로세스에 상태를 둔다 -
//UIHolder(quizbot/quiz_ui/ui-system-core.ts의 ui_holder_map)는 그 길드를 담당하는 클러스터
//프로세스 안에서만 존재해서, 마스터는 "어느 클러스터가 이 길드를 담당하는지" 알 방법이 없다.
//그래서 길드 대상 통신은 "마스터가 전체 클러스터에 브로드캐스트 -> 각 클러스터가 자기
//ui_holder_map에 그 guild_id가 있는지 로컬 판단"하는 기존 멀티플레이 IPC 패턴을 그대로 재사용한다.
//
//Phase 1부터 mode('dev'|'user'|'omakase')와 진행 중 선택 상태 브로드캐스트(select action)가 추가됨 -
//세션 자체엔 선택 내용을 저장하지 않는다(스테이트리스): 'select'/'apply' 둘 다 그때그때 받은 payload를
//그대로 릴레이만 하고, 실제 quiz_info 조립(DB/파일시스템 조회)은 이 payload를 받는 클러스터 쪽
//WebHandoffUI/DevQuizInfoUI가 담당한다(WEB_INTEGRATION_PLAN.md 참고).
//
//2026-08-08 1차 실사용 테스트 후 토큰 생명주기 변경: "선택 완료(apply)"는 더 이상 토큰을 파기하지
//않는다(원래는 즉시 파기했는데, 그러면 확정 후 같은 세션에서 문제 수 재조정/다른 퀴즈 재선택이
//불가능해지는 문제가 있었음). 대신 토큰은 (1) 퀴즈가 실제로 시작되거나(quiz-info-ui.ts의
//handleStartQuiz) (2) 그 길드의 UIHolder가 다른 이유로 사라질 때(ui-system-core.ts의 UIHolder.free() -
//고아 토큰 방지, 안 하면 다른 유저가 이미 그 길드에서 새 화면을 띄웠는데도 예전 웹 세션이 guild_token_map을
//계속 점유해서 새 웹 세션 발급이 already_locked로 막힘) 파기된다. 이 두 경우는 클러스터가 이미 그 이유로
//화면을 바꾸는 중이라 클러스터에 알릴 필요가 없어서 브로드캐스트 없이 조용히 정리(releaseSession).
//GC 타임아웃만 클러스터가 스스로 모르는 경우라 'expired' 브로드캐스트가 필요.
//
//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1, 2026-08-11: 세션 스코프를
//guild(길드 단위, 기존)/owner(유저 단위, 신규)로 일반화. 세션 객체에 scope/scope_id 필드를 추가하고
//(scope_id는 guild 세션이면 guild_id, owner 세션이면 owner_id와 동일값 - 조회/브로드캐스트 키로 통일),
//브로드캐스트도 broadcast(scope_id, ...)로 리네임했다. 기존 guild_id 필드는 그대로 남겨둔다
//(web_express_app.ts의 GET /api/session이 하위 호환으로 계속 읽음). 기존 함수(createSession 등)는
//시그니처 불변 - 내부에서 scope:'guild', scope_id=guild_id로 세션을 만들 뿐이다. owner 세션은
//하이재킹 개념이 없어(DM은 1:1) createOwnerScopedSession이 항상 무조건 교체한다.

const logger = require('../../../utility/logger.js')('WebSessionManager');
const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');
const { generateWebSessionToken } = require('../../../utility/util/web_token_utility');
const ipc_manager = require('../ipc_manager');

let cluster_manager: any = undefined;
let gc_interval: any = undefined;

//token -> { token, scope, scope_id, guild_id, owner_id, owner_name?, owner_icon_url?, mode, created_at, expires_at }
const web_sessions: Map<string, any> = new Map();
//guild_id -> token (길드당 활성 세션은 하나만 허용)
const guild_token_map: Map<string, string> = new Map();
//owner_id -> token (유저당 활성 세션은 하나만 허용 - 퀴즈 만들기 웹 연동, Phase 1)
const owner_token_map: Map<string, string> = new Map();

exports.initialize = (manager: any): void =>
{
  cluster_manager = manager;

  if(gc_interval !== undefined)
  {
    clearInterval(gc_interval);
  }
  gc_interval = startGC();

  logger.info('Web Session Manager initialized');
};

const broadcast = (scope_id: string, event: string, payload: any = {}): void =>
{
  if(cluster_manager === undefined)
  {
    logger.error('Cluster Manager has not been assigned!');
    return;
  }

  cluster_manager.broadcast({
    ipc_message_type: ipc_manager.IPC_MESSAGE_TYPE.WEB_SESSION_SIGNAL,
    signal: { scope_id, event, payload },
  });
};

exports.createSession = (guild_id: string, owner_id: string, mode: string): any =>
{
  const existing_token = guild_token_map.get(guild_id);
  if(existing_token !== undefined && web_sessions.has(existing_token))
  {
    return { success: false, reason: 'already_locked' };
  }

  const token = generateWebSessionToken();
  const now = Date.now();
  const session = {
    token,
    scope: 'guild',
    scope_id: guild_id,
    guild_id,
    owner_id,
    mode,
    created_at: now,
    expires_at: now + SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000,
  };

  web_sessions.set(token, session);
  guild_token_map.set(guild_id, token);

  broadcast(guild_id, 'locked', { owner_id, mode });

  return { success: true, token, expires_at: session.expires_at };
};

exports.forceTakeSession = (guild_id: string, owner_id: string, mode: string): any =>
{
  const existing_token = guild_token_map.get(guild_id);
  if(existing_token !== undefined)
  {
    web_sessions.delete(existing_token);
  }

  return exports.createSession(guild_id, owner_id, mode);
};

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1 - owner_id(유저) 단위 세션.
//DM은 봇-유저 1:1이라 하이재킹 개념이 없음 - 기존 세션이 있어도 무조건 교체(force_take와 동일 패턴,
//already_locked 거절 로직 자체가 불필요).
exports.createOwnerScopedSession = (owner_id: string, mode: string, owner_name?: string, owner_icon_url?: string): any =>
{
  const existing_token = owner_token_map.get(owner_id);
  if(existing_token !== undefined)
  {
    web_sessions.delete(existing_token);
  }

  const token = generateWebSessionToken();
  const now = Date.now();
  const session = {
    token,
    scope: 'owner',
    scope_id: owner_id,
    owner_id,
    owner_name,
    owner_icon_url,
    mode,
    created_at: now,
    expires_at: now + SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000,
  };

  web_sessions.set(token, session);
  owner_token_map.set(owner_id, token);

  broadcast(owner_id, 'locked', { owner_id, mode });

  return { success: true, token, expires_at: session.expires_at };
};

//퀴즈 실제 시작(handleStartQuiz)/UIHolder 소멸(UIHolder.free()) 시 호출되는 releaseSession과 동일
//패턴 - 조용한 정리(브로드캐스트 없음). 이 유저에 활성 세션이 없어도 안전한 no-op.
exports.releaseOwnerScopedSession = (owner_id: string): any =>
{
  const token = owner_token_map.get(owner_id);
  if(token === undefined)
  {
    return { success: true };
  }

  web_sessions.delete(token);
  owner_token_map.delete(owner_id);

  return { success: true };
};

//진행 중인 선택 내용을 그대로 릴레이(세션에 저장하지 않음) - Discord embed 실시간 갱신용
exports.updateSelection = (token: string, payload: any = {}): any =>
{
  const session = web_sessions.get(token);
  if(session === undefined)
  {
    return { success: false, reason: 'not_found' };
  }

  broadcast(session.scope_id, 'updated', payload);

  return { success: true };
};

//"선택 완료" - 화면 전환만 브로드캐스트하고 토큰은 유지한다(같은 세션에서 재적용 가능하게).
exports.applySelection = (token: string, payload: any = {}): any =>
{
  const session = web_sessions.get(token);
  if(session === undefined)
  {
    return { success: false, reason: 'not_found' };
  }

  broadcast(session.scope_id, 'applied', payload);

  return { success: true };
};

//퀴즈 실제 시작(handleStartQuiz) 또는 UIHolder 소멸(UIHolder.free()) 시 호출되는 조용한 정리 -
//클러스터가 이미 그 이유로 화면을 바꾸는 중이라 브로드캐스트하지 않는다. 이 길드에 활성 세션이
//없어도(애초에 없었거나 이미 파기됐어도) 안전한 no-op.
//expected_token(선택) - UIHolder.free()가 이 홀더가 알고 있던 토큰을 넘겨줄 때만 검사한다. force_take로
//권한을 뺏긴 직후 예전 홀더가 free()되면서 이 함수를 부르는데, 그 시점엔 guild_token_map이 이미 새
//소유자의 토큰으로 교체돼 있음 - 토큰 비교 없이 guild_id만으로 지우면 방금 발급된 새 토큰을 즉시
//파기해버리는 레이스가 있었다(2026-08-12 발견). expected_token을 안 넘기는 호출부(handleStartQuiz 등,
//원래 자기 토큰을 따로 들고 있지 않음)는 기존처럼 무조건 파기.
exports.releaseSession = (guild_id: string, expected_token?: string): any =>
{
  const token = guild_token_map.get(guild_id);
  if(token === undefined)
  {
    return { success: true };
  }

  if(expected_token !== undefined && token !== expected_token) //이미 다른(더 새로운) 세션으로 교체됨 - 조용히 무시
  {
    return { success: true };
  }

  web_sessions.delete(token);
  guild_token_map.delete(guild_id);

  return { success: true };
};

//멀티플레이 웹 연동(Phase 4) - 로비 생성/참가의 밴/음성채널 체크는 그 길드를 담당하는 클러스터
//(web-handoff-ui.ts의 buildMultiplayerUI)가 비동기로 처리해서, /api/session/confirm 응답만으로는
//성공/실패를 알 수 없다(2026-08-10 실사용 피드백 - 음성채널 미접속 시 웹에 아무 에러도 안 뜨던 문제).
//클러스터가 처리 결과를 이 매니저에 다시 보고하면(report_multiplayer_result), 프론트엔드가
///api/multiplayer-result를 잠깐 폴링해서 읽어간다(1회성 - 읽으면 즉시 비움).
exports.reportMultiplayerResult = (guild_id: string, result: any): any =>
{
  const token = guild_token_map.get(guild_id);
  if(token === undefined)
  {
    return { success: true }; //그 사이 세션이 이미 파기됐어도(예: 홀더 소멸) 안전한 no-op
  }

  const session = web_sessions.get(token);
  if(session === undefined)
  {
    return { success: true };
  }

  session.multiplayer_result = result;
  return { success: true };
};

exports.consumeMultiplayerResult = (token: string): any =>
{
  const session = web_sessions.get(token);
  if(session === undefined)
  {
    return undefined;
  }

  const result = session.multiplayer_result;
  session.multiplayer_result = undefined; //1회성 - 다음 시도의 결과와 섞이지 않도록 읽자마자 비움
  return result;
};

exports.heartbeat = (token: string): any =>
{
  const session = web_sessions.get(token);
  if(session === undefined)
  {
    return { success: false, reason: 'not_found' };
  }

  session.expires_at = Date.now() + SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000;

  return { success: true, expires_at: session.expires_at };
};

exports.getSession = (token: string): any =>
{
  return web_sessions.get(token);
};

//index.js의 WEB_SESSION_REQUEST 분기에서 호출 -
//action: 'create'|'force_take'|'select'|'apply'|'release'|'heartbeat'|'report_multiplayer_result'|
//'create_owner_session'|'release_owner_session'(퀴즈 만들기 웹 연동 Phase 1)
exports.handleRequest = (request: any): any =>
{
  const { action, guild_id, owner_id, owner_name, owner_icon_url, mode, token, payload } = request ?? {};

  switch(action)
  {
    case 'create': return exports.createSession(guild_id, owner_id, mode);
    case 'force_take': return exports.forceTakeSession(guild_id, owner_id, mode);
    case 'select': return exports.updateSelection(token, payload);
    case 'apply': return exports.applySelection(token, payload);
    case 'release': return exports.releaseSession(guild_id, token);
    case 'heartbeat': return exports.heartbeat(token);
    case 'report_multiplayer_result': return exports.reportMultiplayerResult(guild_id, payload);
    case 'create_owner_session': return exports.createOwnerScopedSession(owner_id, mode, owner_name, owner_icon_url);
    case 'release_owner_session': return exports.releaseOwnerScopedSession(owner_id);
    default:
      logger.error(`Unknown web session request action: ${action}`);
      return { success: false, reason: 'unknown_action' };
  }
};

//만료된 세션을 정리 - setInterval에서 호출하지만, 실제 타이머 없이 테스트하기 위해 별도로 export
exports.runGC = (): number =>
{
  const now = Date.now();
  let expired_count = 0;

  for(const [token, session] of web_sessions.entries())
  {
    if(session.expires_at >= now)
    {
      continue;
    }

    web_sessions.delete(token);
    if(session.scope === 'owner')
    {
      owner_token_map.delete(session.scope_id);
    }
    else
    {
      guild_token_map.delete(session.scope_id);
    }
    broadcast(session.scope_id, 'expired', {});
    ++expired_count;
  }

  if(expired_count > 0)
  {
    logger.info(`Web Session GC: expired ${expired_count} session(s)`);
  }

  return expired_count;
};

const startGC = (): any =>
{
  const interval = setInterval(() =>
  {
    exports.runGC();
  }, SYSTEM_CONFIG.WEB_SESSION_GC_INTERVAL_SEC * 1000);

  interval.unref?.();

  return interval;
};

//테스트 전용 - GC 타이머가 프로세스를 물고 있지 않게 정리
exports.shutdown = (): void =>
{
  if(gc_interval !== undefined)
  {
    clearInterval(gc_interval);
    gc_interval = undefined;
  }
  web_sessions.clear();
  guild_token_map.clear();
  owner_token_map.clear();
  cluster_manager = undefined;
};
