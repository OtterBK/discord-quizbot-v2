'use strict';

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 1의 web_express_app API 통합 테스트.
//실제 express 서버를 임의 포트로 띄우고 fetch(Node 18+ 내장)로 왕복 검증한다. dev 퀴즈 트리는
//resources/quizdata를 실제로 읽는다(util_split.test.js와 동일한 관례 - 별도 mock 없이 실제 파일시스템 사용).
//web_session_manager는 싱글턴이라 broadcast를 mock한 cluster_manager로 initialize해서 세션을 직접 만든다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');

//다른 테스트/실제 개발 서버와 포트 충돌을 피하기 위해 테스트 전용 포트로 임시 교체
SYSTEM_CONFIG.WEB_SERVER_PORT = 47654;

const web_express_app = require('../../../quizbot/managers/web/web_express_app');
const web_session_manager = require('../../../quizbot/managers/web/web_session_manager');
const db_manager = require('../../../quizbot/managers/db_manager.js');

const BASE_URL = `http://localhost:${SYSTEM_CONFIG.WEB_SERVER_PORT}`;

let broadcasted = [];

test.before(() =>
{
  web_express_app.start();
});

test.after(() =>
{
  web_express_app.stop();
  web_session_manager.shutdown();
});

test.beforeEach(() =>
{
  broadcasted = [];
  web_session_manager.shutdown(); //이전 테스트의 세션/타이머를 완전히 비우고 시작(싱글턴이라 초기화만으로는 안 지워짐)
  web_session_manager.initialize({ broadcast: (msg) => broadcasted.push(msg) });
});

const createDevSession = () =>
{
  return web_session_manager.createSession('guild_test', 'owner_test', 'dev');
};

test('인증 없이 API를 호출하면 401을 반환한다', async () =>
{
  const res = await fetch(`${BASE_URL}/api/session`);
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error, 'missing_token');
});

test('잘못된 토큰이면 401 invalid_or_expired_token을 반환한다', async () =>
{
  const res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: 'Bearer invalid_token_xyz' } });
  assert.equal(res.status, 401);

  const body = await res.json();
  assert.equal(body.error, 'invalid_or_expired_token');
});

test('GET /api/session: 유효한 토큰이면 세션 정보를 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.guild_id, 'guild_test');
  assert.equal(body.mode, 'dev');
  assert.equal(body.scope, 'guild');
  assert.equal(body.scope_id, 'guild_test');
});

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 1 - owner-scoped 세션 응답 확인.
test('GET /api/session: owner 세션이면 guild_id 없이 scope/scope_id/owner_name을 반환한다', async () =>
{
  const session = web_session_manager.createOwnerScopedSession('owner_test', 'quiz_edit', '닉네임');

  const res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.guild_id, undefined);
  assert.equal(body.scope, 'owner');
  assert.equal(body.scope_id, 'owner_test');
  assert.equal(body.owner_name, '닉네임');
  assert.equal(body.mode, 'quiz_edit');
});

test('GET /api/dev-quizzes: 실제 resources/quizdata 트리를 leaf/children 구조로 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/dev-quizzes`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(Array.isArray(body.tree));
  assert.ok(body.tree.length > 0);

  //트리 어딘가에 leaf(quiz_size가 있는 실제 퀴즈)가 하나는 있어야 한다
  const findLeaf = (nodes) =>
  {
    for(const node of nodes)
    {
      if(node.leaf === true)
      {
        return node;
      }
      if(node.children !== undefined)
      {
        const found = findLeaf(node.children);
        if(found !== undefined)
        {
          return found;
        }
      }
    }
    return undefined;
  };

  const leaf = findLeaf(body.tree);
  assert.notEqual(leaf, undefined);
  assert.equal(typeof leaf.content_path, 'string');
  assert.equal(typeof leaf.quiz_size, 'number');
});

test('POST /api/session/select: updated 신호를 브로드캐스트한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/session/select`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: { title: '게임1' } }),
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);

  const updated_signal = broadcasted.find((msg) => msg.signal.event === 'updated');
  assert.equal(updated_signal.signal.payload.title, '게임1');
});

test('POST /api/session/confirm: mode가 없거나 지원하지 않으면 400 unsupported_mode를 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: { content_path: '아무거나' }, selected_question_count: 10 }),
  });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.reason, 'unsupported_mode');
});

test('POST /api/session/confirm: 존재하지 않는 content_path면 400을 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'dev', selection: { content_path: '없는/경로' }, selected_question_count: 10 }),
  });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.reason, 'content_not_found');
});

test('POST /api/session/confirm: 유효한 content_path면 문제 수를 quiz_size로 클램프하고 applied를 브로드캐스트한다 (2026-08-08부터 토큰은 유지 - 재선택 지원)', async () =>
{
  const session = createDevSession();

  //먼저 실제 트리에서 leaf 하나를 가져온다
  const tree_res = await fetch(`${BASE_URL}/api/dev-quizzes`, { headers: { Authorization: `Bearer ${session.token}` } });
  const { tree } = await tree_res.json();
  const findLeaf = (nodes) =>
  {
    for(const node of nodes)
    {
      if(node.leaf === true) return node;
      if(node.children !== undefined)
      {
        const found = findLeaf(node.children);
        if(found !== undefined) return found;
      }
    }
    return undefined;
  };
  const leaf = findLeaf(tree);

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'dev', selection: { content_path: leaf.content_path }, selected_question_count: leaf.quiz_size + 9999 }), //일부러 최대치 초과 입력
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);

  const applied_signal = broadcasted.find((msg) => msg.signal.event === 'applied');
  assert.equal(applied_signal.signal.payload.content_path, leaf.content_path);
  assert.equal(applied_signal.signal.payload.selected_question_count, leaf.quiz_size); //클램프됨

  //확정해도 토큰은 살아있어야 함(같은 세션으로 재선택/문제 수 재조정 가능해야 함)
  const check_res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(check_res.status, 200);
});

test('POST /api/session/confirm을 두 번 연속 호출해도(재선택) 둘 다 성공하고 각각 applied를 브로드캐스트한다', async () =>
{
  const session = createDevSession();

  const tree_res = await fetch(`${BASE_URL}/api/dev-quizzes`, { headers: { Authorization: `Bearer ${session.token}` } });
  const { tree } = await tree_res.json();
  const collectLeaves = (nodes, acc = []) =>
  {
    for(const node of nodes)
    {
      if(node.leaf === true) acc.push(node);
      else if(node.children !== undefined) collectLeaves(node.children, acc);
    }
    return acc;
  };
  const leaves = collectLeaves(tree);
  assert.ok(leaves.length >= 2, '테스트하려면 공식 퀴즈가 최소 2개 있어야 함');

  const confirmLeaf = (leaf) => fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'dev', selection: { content_path: leaf.content_path }, selected_question_count: 5 }),
  });

  const first_res = await confirmLeaf(leaves[0]);
  assert.equal(first_res.status, 200);

  const second_res = await confirmLeaf(leaves[1]);
  assert.equal(second_res.status, 200);

  const applied_signals = broadcasted.filter((msg) => msg.signal.event === 'applied');
  assert.equal(applied_signals.length, 2);
  assert.equal(applied_signals[0].signal.payload.content_path, leaves[0].content_path);
  assert.equal(applied_signals[1].signal.payload.content_path, leaves[1].content_path);
});

//퀴즈 선택 웹 연동 Phase 2(유저 퀴즈) - db_manager 경계에서 mock 처리(db_manager.test.js와 동일 관례).
//user_quiz_info_manager.ts가 db_manager.selectAllQuizInfo/selectQuizInfoById/selectQuestionInfo를 호출한다.

test('GET /api/user-quizzes: 유저 퀴즈 목록과 태그 목록을 반환한다 (quiz_size는 카드에 노출하지 않음)', async (t) =>
{
  const session = createDevSession();

  t.mock.method(db_manager, 'selectAllQuizInfo', async () => ({
    rows: [{
      quiz_id: 1,
      quiz_title: '유저 퀴즈 1',
      simple_description: '한줄 소개',
      thumbnail: 'https://example.com/thumb.png',
      tags_value: 9,
      is_private: false,
    }],
  }));

  const res = await fetch(`${BASE_URL}/api/user-quizzes`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.quizzes.length, 1);
  assert.equal(body.quizzes[0].quiz_id, 1);
  assert.equal(body.quizzes[0].title, '유저 퀴즈 1');
  assert.equal(body.quizzes[0].simple_description, '한줄 소개'); //목록 카드에 섬네일과 함께 노출되는 값
  assert.equal(body.quizzes[0].thumbnail, 'https://example.com/thumb.png');
  assert.equal(body.quizzes[0].quiz_size, undefined);
  assert.ok(Array.isArray(body.tags));
  assert.ok(body.tags.length > 0);
  assert.ok(body.tags.every((tag) => tag.value !== 0)); //"선택 안함"(0)은 필터에서 제외
});

test('GET /api/user-quizzes/:quiz_id: 존재하지 않으면 404를 반환한다', async (t) =>
{
  const session = createDevSession();

  t.mock.method(db_manager, 'selectQuizInfoById', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/user-quizzes/999`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 404);
});

test('GET /api/user-quizzes/:quiz_id: 실제 문제 수(question_count)와 상세 정보(썸네일/설명/통계) 전체를 반환한다', async (t) =>
{
  const session = createDevSession();

  t.mock.method(db_manager, 'selectQuizInfoById', async () => ({
    rows: [{
      quiz_id: 1,
      quiz_title: '유저 퀴즈 1',
      description: '긴 설명입니다',
      simple_description: '한줄 소개',
      thumbnail: 'https://example.com/thumb.png',
      tags_value: 9,
      is_private: false,
      like_count: 5,
      played_count: 10,
      birthtime: new Date('2026-01-01'),
      modified_time: new Date('2026-02-01'),
    }],
  }));
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({
    rows: [{ question_id: 1 }, { question_id: 2 }, { question_id: 3 }],
  }));

  const res = await fetch(`${BASE_URL}/api/user-quizzes/1`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.quiz_id, 1);
  assert.equal(body.title, '유저 퀴즈 1');
  assert.equal(body.description, '긴 설명입니다');
  assert.equal(body.simple_description, '한줄 소개');
  assert.equal(body.thumbnail, 'https://example.com/thumb.png');
  assert.equal(body.like_count, 5);
  assert.equal(body.played_count, 10);
  assert.notEqual(body.birthtime, undefined);
  assert.notEqual(body.modified_time, undefined);
  assert.equal(body.question_count, 3);
});

test('POST /api/session/confirm(mode:user): 존재하지 않는 quiz_id면 400을 반환한다', async (t) =>
{
  const session = createDevSession();

  t.mock.method(db_manager, 'selectQuizInfoById', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'user', selection: { quiz_id: 999 }, selected_question_count: 10 }),
  });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.reason, 'content_not_found');
});

test('POST /api/session/confirm(mode:user): 문제 수를 실제 문제 수로 클램프하고 applied를 브로드캐스트한다(토큰 유지)', async (t) =>
{
  const session = createDevSession();

  t.mock.method(db_manager, 'selectQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '유저 퀴즈 1', tags_value: 9, is_private: false }],
  }));
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({
    rows: [{ question_id: 1 }, { question_id: 2 }],
  }));

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'user', selection: { quiz_id: 1 }, selected_question_count: 9999 }), //일부러 최대치 초과 입력
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);

  const applied_signal = broadcasted.find((msg) => msg.signal.event === 'applied');
  assert.equal(applied_signal.signal.payload.mode, 'user');
  assert.equal(applied_signal.signal.payload.quiz_id, 1);
  assert.equal(applied_signal.signal.payload.selected_question_count, 2); //클램프됨

  //확정해도 토큰은 살아있어야 함(dev 모드와 동일한 토큰 생명주기)
  const check_res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(check_res.status, 200);
});

//퀴즈 선택 웹 연동 Phase 3(랜덤 퀴즈) - DB 조회가 필요 없는 정적 태그/설정 데이터라 mock 없이 검증 가능.

test('GET /api/omakase-tags: DEV_QUIZ_TAG/QUIZ_TAG를 유형/장르로 분류해 반환한다 ("선택 안함"(0)은 전부 제외)', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/omakase-tags`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(Array.isArray(body.dev_tags) && body.dev_tags.length > 0);
  assert.ok(Array.isArray(body.type_tags) && body.type_tags.length > 0);
  assert.ok(Array.isArray(body.genre_tags) && body.genre_tags.length > 0);
  assert.ok(body.dev_tags.every((tag) => tag.value !== 0));
  assert.ok(body.type_tags.every((tag) => tag.value !== 0 && tag.value <= 4));
  assert.ok(body.genre_tags.every((tag) => tag.value > 4));
});

test('POST /api/session/confirm(mode:omakase): 문제 수를 100으로 클램프하고 태그/퀴즈함 설정을 그대로 applied로 브로드캐스트한다(토큰 유지)', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'omakase',
      selection: {
        dev_quiz_tags: 16,
        basket_mode: false,
        custom_quiz_type_tags: 1,
        custom_quiz_tags: 8,
        certified_filter: false,
        basket_items: {},
      },
      selected_question_count: 9999, //일부러 최대치(100) 초과 입력
    }),
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);

  const applied_signal = broadcasted.find((msg) => msg.signal.event === 'applied');
  assert.equal(applied_signal.signal.payload.mode, 'omakase');
  assert.equal(applied_signal.signal.payload.dev_quiz_tags, 16);
  assert.equal(applied_signal.signal.payload.basket_mode, false);
  assert.equal(applied_signal.signal.payload.custom_quiz_type_tags, 1);
  assert.equal(applied_signal.signal.payload.custom_quiz_tags, 8);
  assert.equal(applied_signal.signal.payload.certified_filter, false);
  assert.equal(applied_signal.signal.payload.selected_question_count, 100); //클램프됨

  //확정해도 토큰은 살아있어야 함(dev/user 모드와 동일한 토큰 생명주기)
  const check_res = await fetch(`${BASE_URL}/api/session`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(check_res.status, 200);
});

test('POST /api/session/confirm(mode:omakase): basket_items를 그대로 전달한다(퀴즈함 모드)', async () =>
{
  const session = createDevSession();
  const basket_items = { 1: { quiz_id: 1, title: '유저 퀴즈 1' }, 2: { quiz_id: 2, title: '유저 퀴즈 2' } };

  const res = await fetch(`${BASE_URL}/api/session/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'omakase',
      selection: { basket_mode: true, basket_items },
      selected_question_count: 30,
    }),
  });
  assert.equal(res.status, 200);

  const applied_signal = broadcasted.find((msg) => msg.signal.event === 'applied');
  assert.deepEqual(applied_signal.signal.payload.basket_items, basket_items);
  assert.equal(applied_signal.signal.payload.selected_question_count, 30);
});

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 안내 페이지/공지사항/서버 설정.

test('GET /api/quiz-tool-guide: 안내 페이지 정적 콘텐츠를 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/quiz-tool-guide`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(typeof body.title, 'string');
  assert.equal(typeof body.description, 'string');
  assert.equal(body.fields.length, 2);
});

test('GET /api/notices: 실제 resources/notices 폴더의 공지 목록을 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/notices`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.ok(Array.isArray(body.notices));
  assert.ok(body.notices.length > 0);
  assert.equal(typeof body.notices[0].name, 'string');
  assert.notEqual(body.notices[0].mtime, undefined);
  assert.equal(body.notices[0].note_path, undefined); //내부 파일 경로는 노출하지 않음
});

test('GET /api/notices/:name: 존재하는 공지의 본문을 반환한다', async () =>
{
  const session = createDevSession();

  const list_res = await fetch(`${BASE_URL}/api/notices`, { headers: { Authorization: `Bearer ${session.token}` } });
  const { notices } = await list_res.json();

  const res = await fetch(`${BASE_URL}/api/notices/${encodeURIComponent(notices[0].name)}`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.title, notices[0].name);
  assert.equal(typeof body.content, 'string');
  assert.ok(body.content.length > 0);
});

test('GET /api/notices/:name: 존재하지 않는 공지면 404를 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/notices/${encodeURIComponent('존재하지-않는-공지')}`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 404);
});

test('GET /api/server-option: owner 세션이면 403 guild_scope_required를 반환한다', async () =>
{
  const session = web_session_manager.createOwnerScopedSession('owner_test', 'quiz_edit', '닉네임');

  const res = await fetch(`${BASE_URL}/api/server-option`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 403);

  const body = await res.json();
  assert.equal(body.error, 'guild_scope_required');
});

test('GET /api/server-option: guild 세션이면 현재 옵션 값과 select_menu 메타를 반환한다', async () =>
{
  const session = createDevSession();

  const res = await fetch(`${BASE_URL}/api/server-option`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(typeof body.values.audio_play_time, 'number');
  assert.ok(Array.isArray(body.select_menu.options));
  assert.equal(body.select_menu.options.length, 9);
  assert.ok(Array.isArray(body.select_menu.option_values.hint_type));
});

test('PUT /api/server-option: 알 수 없는 필드면 400 unknown_field를 반환한다', async (t) =>
{
  const session = createDevSession();
  t.mock.method(db_manager, 'updateOptionParameterized', async () => undefined);

  const res = await fetch(`${BASE_URL}/api/server-option`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { not_a_real_field: 'x' } }),
  });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.error, 'unknown_field');
});

test('PUT /api/server-option: 허용되지 않는 값이면 400 invalid_value를 반환한다', async (t) =>
{
  const session = createDevSession();
  t.mock.method(db_manager, 'updateOptionParameterized', async () => undefined);

  const res = await fetch(`${BASE_URL}/api/server-option`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { hint_type: '없는값' } }),
  });
  assert.equal(res.status, 400);

  const body = await res.json();
  assert.equal(body.error, 'invalid_value');
});

test('PUT /api/server-option: 유효한 값이면 메모리 캐시를 갱신하고 파라미터화 쿼리로 저장한다(디스코드 UI와 값 공유)', async (t) =>
{
  const session = createDevSession();

  let saved_guild_id;
  let saved_option_data;
  t.mock.method(db_manager, 'updateOptionParameterized', async (guild_id, option_data) =>
  {
    saved_guild_id = guild_id;
    saved_option_data = { ...option_data };
    return { rowCount: 1 }; //db_core.sendQuery는 성공 시 쿼리 결과 객체를, 실패 시 undefined를 반환한다
  });

  const res = await fetch(`${BASE_URL}/api/server-option`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { hint_type: '자동' } }),
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(body.values.hint_type, '자동');

  assert.equal(saved_guild_id, 'guild_test');
  assert.equal(saved_option_data.hint_type, '자동');

  //디스코드 UI(server-setting-ui.ts)와 같은 OptionStorage 인스턴스를 공유하므로 재조회 시 반영돼 있어야 함
  const check_res = await fetch(`${BASE_URL}/api/server-option`, { headers: { Authorization: `Bearer ${session.token}` } });
  const check_body = await check_res.json();
  assert.equal(check_body.values.hint_type, '자동');
});

test('PUT /api/server-option: DB 저장이 실패(db_core.sendQuery가 undefined 반환)해도 200이지만 success:false를 반환한다', async (t) =>
{
  const session = createDevSession();

  //db_core.sendQuery는 연결 실패/쿼리 에러 모두 던지지 않고 조용히 undefined를 반환한다(db_core.ts) -
  //그 경우를 흉내낸다. 메모리 캐시(OptionStorage)는 디스코드 쪽과 동일하게 DB 성공 여부와 무관하게
  //먼저 갱신되지만, success 필드로는 실제 영속화 실패를 구분할 수 있어야 한다.
  t.mock.method(db_manager, 'updateOptionParameterized', async () => undefined);

  const res = await fetch(`${BASE_URL}/api/server-option`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { skip_type: '주최자' } }),
  });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.values.skip_type, '주최자'); //메모리 캐시는 그대로 반영됨(디스코드 쪽과 동일 동작)
});
