'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 0의 web_session_manager 테스트.
//실제 setInterval GC는 기다리지 않고, exports.runGC()를 직접 호출해 검증한다(Date.now mock 조합).
//cluster_manager는 broadcast(signal)만 호출되는 mock 객체로 대체한다.
//
//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1, 2026-08-11: guild_id -> scope_id
//리네임으로 브로드캐스트 시그널 필드명이 바뀌어(signal.guild_id -> signal.scope_id) 기존 케이스의
//assert도 함께 갱신됨. owner-scope(퀴즈 만들기) 세션 케이스는 파일 하단에 추가.

const test = require('node:test');
const assert = require('node:assert/strict');

const web_session_manager = require('../../../quizbot/managers/web/web_session_manager');
const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');

const setUp = () =>
{
  const broadcasted = [];
  web_session_manager.initialize({ broadcast: (msg) => broadcasted.push(msg) });
  return broadcasted;
};

test.afterEach(() =>
{
  web_session_manager.shutdown();
});

test('createSession: 새 길드면 토큰을 발급하고 locked 신호를 브로드캐스트한다', () =>
{
  const broadcasted = setUp();

  const result = web_session_manager.createSession('guild_1', 'user_1', 'dev');

  assert.equal(result.success, true);
  assert.equal(typeof result.token, 'string');
  assert.equal(result.token.length, 64); //crypto.randomBytes(32).toString('hex')

  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].signal.scope_id, 'guild_1');
  assert.equal(broadcasted[0].signal.event, 'locked');
  assert.equal(broadcasted[0].signal.payload.mode, 'dev');
});

test('createSession: 이미 잠긴 길드면 already_locked를 반환하고 추가 브로드캐스트가 없다', () =>
{
  const broadcasted = setUp();

  web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const second = web_session_manager.createSession('guild_1', 'user_2', 'dev');

  assert.equal(second.success, false);
  assert.equal(second.reason, 'already_locked');
  assert.equal(broadcasted.length, 1); //두 번째 시도는 브로드캐스트 안 함
});

test('forceTakeSession: 기존 토큰을 파기하고 새 토큰을 발급한다', () =>
{
  setUp();

  const first = web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const second = web_session_manager.forceTakeSession('guild_1', 'user_2', 'dev');

  assert.equal(second.success, true);
  assert.notEqual(second.token, first.token);
  assert.equal(web_session_manager.getSession(first.token), undefined); //예전 토큰은 무효
  assert.notEqual(web_session_manager.getSession(second.token), undefined);
});

test('applySelection: 유효한 토큰이면 applied 신호를 브로드캐스트하지만 토큰은 유지한다 (2026-08-08 재선택 지원)', () =>
{
  const broadcasted = setUp();

  const created = web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const applied = web_session_manager.applySelection(created.token, { selected_question_count: 30 });

  assert.equal(applied.success, true);
  assert.equal(broadcasted[1].signal.event, 'applied');
  assert.equal(broadcasted[1].signal.payload.selected_question_count, 30);

  //확정해도 토큰은 살아있어야 함 - 같은 세션으로 재선택 가능
  assert.notEqual(web_session_manager.getSession(created.token), undefined);

  //그래서 같은 길드를 또 열려고 하면 여전히 already_locked (토큰이 안 죽었으니까)
  const reopened = web_session_manager.createSession('guild_1', 'user_2', 'dev');
  assert.equal(reopened.success, false);
  assert.equal(reopened.reason, 'already_locked');
});

test('applySelection: 존재하지 않는 토큰이면 not_found를 반환한다', () =>
{
  setUp();

  const result = web_session_manager.applySelection('없는_토큰');

  assert.equal(result.success, false);
  assert.equal(result.reason, 'not_found');
});

test('releaseSession: 활성 세션이 있으면 브로드캐스트 없이 조용히 파기하고, 같은 길드를 다시 열 수 있다', () =>
{
  const broadcasted = setUp();

  const created = web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const before_release_count = broadcasted.length;

  const result = web_session_manager.releaseSession('guild_1');

  assert.equal(result.success, true);
  assert.equal(broadcasted.length, before_release_count); //추가 브로드캐스트 없음(조용히 정리)
  assert.equal(web_session_manager.getSession(created.token), undefined);

  const reopened = web_session_manager.createSession('guild_1', 'user_2', 'dev');
  assert.equal(reopened.success, true);
});

test('releaseSession: 활성 세션이 없는 길드에 대해서도 안전한 no-op이다', () =>
{
  setUp();

  const result = web_session_manager.releaseSession('세션_없는_길드');

  assert.equal(result.success, true);
});

test('releaseSession: expected_token이 현재 세션과 다르면(force_take로 이미 교체됨) 파기하지 않는다 (2026-08-12 레이스 수정)', () =>
{
  setUp();

  const first = web_session_manager.createSession('guild_1', 'user_1', 'dev'); //A가 세션 생성
  const second = web_session_manager.forceTakeSession('guild_1', 'user_2', 'dev'); //B가 권한 가져오기 - 새 토큰 발급, A 토큰은 이미 파기됨

  //A의 예전 UIHolder.free()가 자기가 알던(구) 토큰을 expected_token으로 넘기며 release를 호출하는 상황을 재현
  const result = web_session_manager.releaseSession('guild_1', first.token);

  assert.equal(result.success, true); //no-op이어도 success:true (기존 관례)
  assert.notEqual(web_session_manager.getSession(second.token), undefined); //B의 새 세션은 살아있어야 함
});

test('releaseSession: expected_token이 현재 세션과 같으면 정상적으로 파기한다', () =>
{
  setUp();

  const created = web_session_manager.createSession('guild_1', 'user_1', 'dev');

  const result = web_session_manager.releaseSession('guild_1', created.token);

  assert.equal(result.success, true);
  assert.equal(web_session_manager.getSession(created.token), undefined);
});

test('updateSelection: 유효한 토큰이면 updated 신호를 그대로 릴레이한다', () =>
{
  const broadcasted = setUp();

  const created = web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const result = web_session_manager.updateSelection(created.token, { content_path: '/a/b', title: '어떤 퀴즈' });

  assert.equal(result.success, true);
  assert.equal(broadcasted[1].signal.event, 'updated');
  assert.equal(broadcasted[1].signal.payload.title, '어떤 퀴즈');
});

test('updateSelection: 존재하지 않는 토큰이면 not_found를 반환한다', () =>
{
  setUp();

  const result = web_session_manager.updateSelection('없는_토큰', {});

  assert.equal(result.success, false);
  assert.equal(result.reason, 'not_found');
});

test('heartbeat: 유효한 토큰이면 만료 시각을 갱신한다', (t) =>
{
  let mocked_now = 0;
  t.mock.method(Date, 'now', () => mocked_now);
  setUp();

  const created = web_session_manager.createSession('guild_1', 'user_1', 'dev');

  mocked_now = 5000;
  const result = web_session_manager.heartbeat(created.token);

  assert.equal(result.success, true);
  assert.equal(result.expires_at, mocked_now + SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000);
});

test('heartbeat: 존재하지 않는 토큰이면 not_found를 반환한다', () =>
{
  setUp();

  const result = web_session_manager.heartbeat('없는_토큰');

  assert.equal(result.success, false);
  assert.equal(result.reason, 'not_found');
});

test('handleRequest: action별로 올바른 함수로 위임한다', () =>
{
  setUp();

  const created = web_session_manager.handleRequest({ action: 'create', guild_id: 'guild_1', owner_id: 'user_1', mode: 'dev' });
  assert.equal(created.success, true);

  const selected = web_session_manager.handleRequest({ action: 'select', token: created.token, payload: { title: '어떤 퀴즈' } });
  assert.equal(selected.success, true);

  const applied = web_session_manager.handleRequest({ action: 'apply', token: created.token, payload: { title: '어떤 퀴즈' } });
  assert.equal(applied.success, true);
  assert.notEqual(web_session_manager.getSession(created.token), undefined); //apply는 토큰을 안 지움

  const released = web_session_manager.handleRequest({ action: 'release', guild_id: 'guild_1' });
  assert.equal(released.success, true);
  assert.equal(web_session_manager.getSession(created.token), undefined); //release는 토큰을 지움
});

test('handleRequest: 알 수 없는 action이면 unknown_action을 반환한다', () =>
{
  setUp();

  const result = web_session_manager.handleRequest({ action: '없는_액션' });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'unknown_action');
});

test('runGC: 만료된 세션만 정리하고 expired 신호를 브로드캐스트한다', (t) =>
{
  let mocked_now = 0;
  t.mock.method(Date, 'now', () => mocked_now);
  const broadcasted = setUp();

  const expiring = web_session_manager.createSession('guild_expiring', 'user_1');

  mocked_now = 500 * 1000; //500초 후 guild_fresh 생성 - 만료 시각이 guild_expiring보다 뒤로 밀림
  web_session_manager.createSession('guild_fresh', 'user_2');

  mocked_now = (SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000) + 1000; //guild_expiring만 만료, guild_fresh는 아직 유효

  const expired_count = web_session_manager.runGC();

  assert.equal(expired_count, 1);
  assert.equal(web_session_manager.getSession(expiring.token), undefined);

  const expired_signal = broadcasted.find((msg) => msg.signal.event === 'expired');
  assert.equal(expired_signal.signal.scope_id, 'guild_expiring');

  //만료 안 된 길드는 여전히 잠겨있어야 함
  const reopen_attempt = web_session_manager.createSession('guild_fresh', 'user_3');
  assert.equal(reopen_attempt.success, false);
});

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1 - owner_id(유저) 단위 세션.

test('createOwnerScopedSession: 토큰을 발급하고 scope_id가 owner_id인 locked 신호를 브로드캐스트한다', () =>
{
  const broadcasted = setUp();

  const result = web_session_manager.createOwnerScopedSession('user_1', 'quiz_edit', '닉네임', 'https://example.com/icon.png');

  assert.equal(result.success, true);
  assert.equal(typeof result.token, 'string');

  assert.equal(broadcasted.length, 1);
  assert.equal(broadcasted[0].signal.scope_id, 'user_1');
  assert.equal(broadcasted[0].signal.event, 'locked');
  assert.equal(broadcasted[0].signal.payload.mode, 'quiz_edit');

  const session = web_session_manager.getSession(result.token);
  assert.equal(session.scope, 'owner');
  assert.equal(session.owner_name, '닉네임');
});

test('createOwnerScopedSession: 이미 세션이 있는 유저라도 already_locked 없이 무조건 새 토큰으로 교체한다 (DM은 1:1이라 하이재킹 개념 없음)', () =>
{
  setUp();

  const first = web_session_manager.createOwnerScopedSession('user_1', 'quiz_edit');
  const second = web_session_manager.createOwnerScopedSession('user_1', 'quiz_edit');

  assert.equal(second.success, true);
  assert.notEqual(second.token, first.token);
  assert.equal(web_session_manager.getSession(first.token), undefined); //예전 토큰은 무효
  assert.notEqual(web_session_manager.getSession(second.token), undefined);
});

test('releaseOwnerScopedSession: 활성 세션이 있으면 브로드캐스트 없이 조용히 파기한다', () =>
{
  const broadcasted = setUp();

  const created = web_session_manager.createOwnerScopedSession('user_1', 'quiz_edit');
  const before_release_count = broadcasted.length;

  const result = web_session_manager.releaseOwnerScopedSession('user_1');

  assert.equal(result.success, true);
  assert.equal(broadcasted.length, before_release_count);
  assert.equal(web_session_manager.getSession(created.token), undefined);
});

test('releaseOwnerScopedSession: 활성 세션이 없는 유저에 대해서도 안전한 no-op이다', () =>
{
  setUp();

  const result = web_session_manager.releaseOwnerScopedSession('세션_없는_유저');

  assert.equal(result.success, true);
});

test('handleRequest: create_owner_session/release_owner_session action으로 위임한다', () =>
{
  setUp();

  const created = web_session_manager.handleRequest({ action: 'create_owner_session', owner_id: 'user_1', mode: 'quiz_edit', owner_name: '닉네임' });
  assert.equal(created.success, true);

  const released = web_session_manager.handleRequest({ action: 'release_owner_session', owner_id: 'user_1' });
  assert.equal(released.success, true);
  assert.equal(web_session_manager.getSession(created.token), undefined);
});

test('runGC: guild 세션과 owner 세션을 각각 올바른 토큰맵에서 정리한다', (t) =>
{
  let mocked_now = 0;
  t.mock.method(Date, 'now', () => mocked_now);
  const broadcasted = setUp();

  const guild_session = web_session_manager.createSession('guild_1', 'user_1', 'dev');
  const owner_session = web_session_manager.createOwnerScopedSession('user_2', 'quiz_edit');

  mocked_now = (SYSTEM_CONFIG.WEB_SESSION_EXPIRE_SEC * 1000) + 1000;

  const expired_count = web_session_manager.runGC();

  assert.equal(expired_count, 2);
  assert.equal(web_session_manager.getSession(guild_session.token), undefined);
  assert.equal(web_session_manager.getSession(owner_session.token), undefined);

  const expired_scope_ids = broadcasted
    .filter((msg) => msg.signal.event === 'expired')
    .map((msg) => msg.signal.scope_id);
  assert.deepEqual(expired_scope_ids.sort(), ['guild_1', 'user_2']);

  //토큰맵이 각각 정리됐으니 같은 키로 다시 세션을 열 수 있어야 함
  assert.equal(web_session_manager.createSession('guild_1', 'user_3', 'dev').success, true);
  assert.equal(web_session_manager.createOwnerScopedSession('user_2', 'quiz_edit').success, true);
});
