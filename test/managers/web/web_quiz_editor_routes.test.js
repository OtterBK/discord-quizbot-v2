'use strict';

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3의 web_quiz_editor_routes API 통합 테스트.
//web_express_app.test.js와 동일한 관례 - 실제 express 서버를 임의 포트로 띄우고 fetch로 왕복 검증,
//db_manager 경계에서 mock 처리(DB 연결 없음). 세션은 owner-scope(createOwnerScopedSession)로 만든다.

const test = require('node:test');
const assert = require('node:assert/strict');

const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');

//다른 테스트/실제 개발 서버와 포트 충돌을 피하기 위해 테스트 전용 포트로 임시 교체
SYSTEM_CONFIG.WEB_SERVER_PORT = 47657;

const web_express_app = require('../../../quizbot/managers/web/web_express_app');
const web_session_manager = require('../../../quizbot/managers/web/web_session_manager');
const db_manager = require('../../../quizbot/managers/db_manager.js');

const BASE_URL = `http://localhost:${SYSTEM_CONFIG.WEB_SERVER_PORT}`;

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
  web_session_manager.shutdown(); //이전 테스트의 세션/타이머를 완전히 비우고 시작(싱글턴이라 초기화만으로는 안 지워짐)
  web_session_manager.initialize({ broadcast: () => {} });
});

const createOwnerSession = () =>
{
  return web_session_manager.createOwnerScopedSession('owner_test', 'quiz_edit', '테스터', 'https://example.com/icon.png');
};

const authHeader = (session) => ({ Authorization: `Bearer ${session.token}` });

test('requireOwnerScopedSession: guild 세션으로 접근하면 403을 반환한다', async () =>
{
  const session = web_session_manager.createSession('guild_test', 'owner_test', 'dev');

  const res = await fetch(`${BASE_URL}/api/my-quizzes`, { headers: authHeader(session) });

  assert.equal(res.status, 403);
});

test('GET /api/my-quizzes: 소유자의 퀴즈 목록과 태그 목록을 반환한다(비공개 포함)', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectQuizInfo', async (creator_id) =>
  {
    assert.equal(creator_id, 'owner_test');
    return {
      rows: [
        { quiz_id: 1, quiz_title: '내 퀴즈 1', is_private: true, tags_value: 0 },
        { quiz_id: 2, quiz_title: '내 퀴즈 2', is_private: false, tags_value: 9 },
      ],
    };
  });

  const res = await fetch(`${BASE_URL}/api/my-quizzes`, { headers: authHeader(session) });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.quizzes.length, 2);
  assert.equal(body.quizzes[0].is_private, true); //비공개 퀴즈도 목록에 노출돼야 함(본인 퀴즈니까)
  assert.ok(Array.isArray(body.tags));
  assert.ok(body.tags.every((tag) => tag.value !== 0));
});

test('POST /api/my-quizzes: 제목이 4자 미만이면 400을 반환한다', async () =>
{
  const session = createOwnerSession();

  const res = await fetch(`${BASE_URL}/api/my-quizzes`, {
    method: 'POST',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz_title: '짧음' }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_quiz_title');
});

test('POST /api/my-quizzes: 유효한 메타데이터면 세션 캐시값을 creator 정보로 채워 생성한다(is_private=true로 시작)', async (t) =>
{
  const session = createOwnerSession();

  let inserted_fields = undefined;
  t.mock.method(db_manager, 'insertQuizInfo', async (key_fields, value_fields) =>
  {
    inserted_fields = Object.fromEntries(key_fields.split(', ').map((k, i) => [k, value_fields[i]]));
    return { rows: [{ quiz_id: 5 }] };
  });

  const res = await fetch(`${BASE_URL}/api/my-quizzes`, {
    method: 'POST',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz_title: '새로운 퀴즈 제목', simple_description: '한줄 소개' }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.quiz_id, 5);
  assert.equal(body.is_private, true);

  assert.equal(inserted_fields.creator_id, 'owner_test');
  assert.equal(inserted_fields.creator_name, '테스터');
  assert.equal(inserted_fields.creator_icon_url, 'https://example.com/icon.png');
  assert.equal(inserted_fields.quiz_title, '새로운 퀴즈 제목');
  assert.equal(inserted_fields.is_private, true);
});

test('GET /api/my-quizzes/:quiz_id: 다른 사람의 퀴즈이거나 존재하지 않으면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/999`, { headers: authHeader(session) });
  assert.equal(res.status, 404);
});

test('GET /api/my-quizzes/:quiz_id: 본인 퀴즈면 메타데이터+문제 목록(검증 플래그 포함)+태그를 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true, tags_value: 0 }],
  }));
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({
    rows: [{ question_id: 10, question_audio_url: '', question_image_url: 'not a url' }],
  }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1`, { headers: authHeader(session) });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.quiz_id, 1);
  assert.equal(body.questions.length, 1);
  assert.equal(body.questions[0].question_id, 10);
  assert.equal(body.questions[0].validation.is_valid_question_audio_url, true); //빈 값은 유효 취급
  assert.equal(body.questions[0].validation.is_valid_question_image_url, false); //URL 형식이 아님
  assert.ok(Array.isArray(body.tags));
});

test('PUT /api/my-quizzes/:quiz_id: 다른 사람 퀴즈면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1`, {
    method: 'PUT',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz_title: '수정된 제목입니다' }),
  });

  assert.equal(res.status, 404);
});

test('PUT /api/my-quizzes/:quiz_id: 본인 퀴즈면 메타데이터를 수정하고 simple_description은 마크다운 특수문자를 제거한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '원래 제목', is_private: true }],
  }));

  let updated_fields = undefined;
  t.mock.method(db_manager, 'updateQuizInfo', async (key_fields, value_fields) =>
  {
    updated_fields = Object.fromEntries(key_fields.split(', ').map((k, i) => [k, value_fields[i]]));
    return { rows: [{ quiz_id: 1 }] };
  });

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1`, {
    method: 'PUT',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ quiz_title: '수정된 제목입니다', simple_description: '**굵게**' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.title, '수정된 제목입니다');

  assert.equal(updated_fields.quiz_title, '수정된 제목입니다');
  assert.equal(updated_fields.creator_name, '테스터'); //editQuizInfo와 동일 - 수정 시 제작자 정보도 세션 캐시값으로 갱신
  assert.ok(!updated_fields.simple_description.includes('*')); //removeMarkdownSpecialChars 적용됨
});

test('PUT /api/my-quizzes/:quiz_id/tags: 알려진 비트로 마스킹해서 저장한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true, tags_value: 0 }],
  }));

  let saved_tags_value = undefined;
  t.mock.method(db_manager, 'updateQuizInfo', async (key_fields, value_fields) =>
  {
    const idx = key_fields.split(', ').indexOf('tags_value');
    saved_tags_value = value_fields[idx];
    return { rows: [{ quiz_id: 1 }] };
  });

  //1(음악 퀴즈, 알려진 비트) + 2^30(알려지지 않은 비트) 혼합 입력
  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/tags`, {
    method: 'PUT',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags_value: 1 | (1 << 30) }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.tags_value, 1); //알려지지 않은 비트는 마스킹되어 제거됨
  assert.equal(saved_tags_value, 1);
});

test('POST /api/my-quizzes/:quiz_id/toggle-public: 비공개->공개 전환인데 태그가 없으면 400을 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true, tags_value: 0 }],
  }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/toggle-public`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'tags_required');
});

test('POST /api/my-quizzes/:quiz_id/toggle-public: 태그가 있으면 공개로 전환된다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true, tags_value: 1 }],
  }));
  t.mock.method(db_manager, 'updateQuizInfo', async () => ({ rows: [{ quiz_id: 1 }] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/toggle-public`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.is_private, false);
});

test('POST /api/my-quizzes/:quiz_id/toggle-public: 공개->비공개 전환은 태그 체크 없이 항상 허용된다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: false, tags_value: 0 }],
  }));
  t.mock.method(db_manager, 'updateQuizInfo', async () => ({ rows: [{ quiz_id: 1 }] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/toggle-public`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.is_private, true);
});

test('DELETE /api/my-quizzes/:quiz_id: 본인 퀴즈면 소프트 삭제(disableQuizInfo) 후 success를 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true }],
  }));

  let disabled_quiz_id = undefined;
  t.mock.method(db_manager, 'disableQuizInfo', async (quiz_id) => { disabled_quiz_id = quiz_id; });

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(disabled_quiz_id, 1);
});

test('DELETE /api/my-quizzes/:quiz_id: 다른 사람 퀴즈면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();

  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/999`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(res.status, 404);
});

//====================================================================================
// 문제(Question) CRUD - Phase 4
//====================================================================================

const mockOwnedQuiz = (t, overrides = {}) =>
{
  t.mock.method(db_manager, 'selectOwnedQuizInfoById', async () => ({
    rows: [{ quiz_id: 1, quiz_title: '내 퀴즈', is_private: true, tags_value: 0, ...overrides }],
  }));
};

test('POST /api/my-quizzes/:quiz_id/questions: 최대 개수(50개)에 도달하면 400을 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);

  const existing_rows = Array.from({ length: 50 }, (_, i) => ({ question_id: i + 1 }));
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: existing_rows }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions`, {
    method: 'POST',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: '정답' }),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'max_questions_reached');
});

test('POST /api/my-quizzes/:quiz_id/questions: answers가 없으면 400을 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions`, {
    method: 'POST',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'invalid_answers');
});

test('POST /api/my-quizzes/:quiz_id/questions: 유효한 body면 오디오 구간을 파싱하고 answer_type 기본값(주관식)을 채워 생성한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [] }));

  let inserted_fields = undefined;
  t.mock.method(db_manager, 'insertQuestionInfo', async (key_fields, value_fields) =>
  {
    inserted_fields = Object.fromEntries(key_fields.split(', ').map((k, i) => [k, value_fields[i]]));
    return { rows: [{ question_id: 10 }] };
  });
  t.mock.method(db_manager, 'updateQuizInfoModifiedTime', async () => {});

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions`, {
    method: 'POST',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: '카트라이더', audio_range_row: '40~80' }),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.question_id, 10);

  assert.equal(inserted_fields.quiz_id, 1);
  assert.equal(inserted_fields.answers, '카트라이더');
  assert.equal(inserted_fields.audio_start, 40);
  assert.equal(inserted_fields.audio_end, 80);
  assert.equal(inserted_fields.audio_play_time, 40);
  assert.equal(inserted_fields.answer_type, 1); //ANSWER_TYPE.SHORT_ANSWER 기본값
});

test('PUT /api/my-quizzes/:quiz_id/questions/:question_id: 다른 퀴즈 소속(혹은 존재하지 않는) question_id면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [{ question_id: 5 }] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/999`, {
    method: 'PUT',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ hint: '새 힌트' }),
  });

  assert.equal(res.status, 404);
});

test('PUT /api/my-quizzes/:quiz_id/questions/:question_id: body에 실린 필드만 갱신하고 나머지는 기존 값을 유지한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({
    rows: [{ question_id: 5, answers: '원래정답', hint: '원래힌트', question_audio_repeat: 3 }],
  }));

  let updated_fields = undefined;
  t.mock.method(db_manager, 'updateQuestionInfo', async (key_fields, value_fields) =>
  {
    updated_fields = Object.fromEntries(key_fields.split(', ').map((k, i) => [k, value_fields[i]]));
    return { rows: [{ question_id: 5 }] };
  });
  t.mock.method(db_manager, 'updateQuizInfoModifiedTime', async () => {});

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/5`, {
    method: 'PUT',
    headers: { ...authHeader(session), 'Content-Type': 'application/json' },
    body: JSON.stringify({ hint: '새 힌트' }), //answers/question_audio_repeat는 안 보냄
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.hint, '새 힌트');
  assert.equal(body.data.answers, '원래정답'); //안 보낸 필드는 유지됨
  assert.equal(body.data.question_audio_repeat, 3);

  assert.equal(updated_fields.hint, '새 힌트');
  assert.equal(updated_fields.answers, '원래정답');
});

test('DELETE /api/my-quizzes/:quiz_id/questions/:question_id: 본인 문제면 삭제하고 success를 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [{ question_id: 5 }] }));

  let deleted_question_id = undefined;
  t.mock.method(db_manager, 'deleteQuestionInfo', async (question_id) => { deleted_question_id = question_id; });
  t.mock.method(db_manager, 'updateQuizInfoModifiedTime', async () => {});

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/5`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.equal(deleted_question_id, 5);
});

test('DELETE /api/my-quizzes/:quiz_id/questions/:question_id: 다른 퀴즈 소속이면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/999`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(res.status, 404);
});

test('POST /api/my-quizzes/:quiz_id/questions/:question_id/duplicate: 최대 개수(50개)에 도달하면 400을 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);

  const existing_rows = Array.from({ length: 50 }, (_, i) => ({ question_id: i + 1 }));
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: existing_rows }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/1/duplicate`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'max_questions_reached');
});

test('POST /api/my-quizzes/:quiz_id/questions/:question_id/duplicate: 존재하지 않는 question_id면 404를 반환한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({ rows: [] }));

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/999/duplicate`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 404);
});

test('POST /api/my-quizzes/:quiz_id/questions/:question_id/duplicate: 소스 문제를 복제해 question_id를 제외한 데이터를 그대로 저장한다', async (t) =>
{
  const session = createOwnerSession();
  mockOwnedQuiz(t);
  t.mock.method(db_manager, 'selectQuestionInfo', async () => ({
    rows: [{ question_id: 5, answers: '카트라이더', question_text: '이 게임은?' }],
  }));

  let inserted_fields = undefined;
  t.mock.method(db_manager, 'insertQuestionInfo', async (key_fields, value_fields) =>
  {
    inserted_fields = Object.fromEntries(key_fields.split(', ').map((k, i) => [k, value_fields[i]]));
    return { rows: [{ question_id: 11 }] };
  });
  t.mock.method(db_manager, 'updateQuizInfoModifiedTime', async () => {});

  const res = await fetch(`${BASE_URL}/api/my-quizzes/1/questions/5/duplicate`, {
    method: 'POST',
    headers: authHeader(session),
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.question_id, 11); //원본(5)이 아니라 새로 저장된 id

  assert.equal(inserted_fields.answers, '카트라이더');
  assert.equal(inserted_fields.question_text, '이 게임은?');
});
