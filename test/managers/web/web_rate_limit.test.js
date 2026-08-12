'use strict';

//웹 API 보안 점검(docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md 작업 2-D)의 rate limiting 유닛
//테스트. web_express_app.test.js/web_quiz_editor_routes.test.js처럼 실제 서버 전체를 띄우지 않고,
//apiRateLimiter만 붙인 최소 express 앱으로 격리해서 빠르게 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const express = require('express');
const { apiRateLimiter, __resetForTest } = require('../../../quizbot/managers/web/web_rate_limit');

let server;
let BASE_URL;

test.before(() =>
{
  const app = express();
  app.use(apiRateLimiter);
  app.get('/probe', (req, res) => res.json({ ok: true }));
  app.post('/probe', (req, res) => res.json({ ok: true }));

  return new Promise((resolve) =>
  {
    server = app.listen(0, () =>
    {
      BASE_URL = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

test.after(() =>
{
  return new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() =>
{
  __resetForTest();
});

const withToken = (token) => ({ Authorization: `Bearer ${token}` });

test('조회(GET)는 같은 토큰으로 초당 10회까지는 통과하고 11번째부터 429를 반환한다', async () =>
{
  const headers = withToken('token_read_burst');

  for(let i = 0; i < 10; ++i)
  {
    const res = await fetch(`${BASE_URL}/probe`, { headers });
    assert.equal(res.status, 200, `${i + 1}번째 요청은 통과해야 함`);
  }

  const eleventh = await fetch(`${BASE_URL}/probe`, { headers });
  assert.equal(eleventh.status, 429);

  const body = await eleventh.json();
  assert.equal(body.error, 'rate_limited');
});

test('쓰기(POST)는 같은 토큰으로 초당 8회까지는 통과하고 9번째부터 429를 반환한다(조회보다 더 빡빡함)', async () =>
{
  const headers = withToken('token_write_burst');

  for(let i = 0; i < 8; ++i)
  {
    const res = await fetch(`${BASE_URL}/probe`, { method: 'POST', headers });
    assert.equal(res.status, 200, `${i + 1}번째 요청은 통과해야 함`);
  }

  const ninth = await fetch(`${BASE_URL}/probe`, { method: 'POST', headers });
  assert.equal(ninth.status, 429);
});

test('토큰이 다르면 서로의 리밋에 영향을 주지 않는다(같은 길드/네트워크를 공유하는 다른 유저를 막지 않기 위함)', async () =>
{
  const headers_a = withToken('token_isolated_a');
  const headers_b = withToken('token_isolated_b');

  for(let i = 0; i < 8; ++i)
  {
    await fetch(`${BASE_URL}/probe`, { method: 'POST', headers: headers_a });
  }
  const a_limited = await fetch(`${BASE_URL}/probe`, { method: 'POST', headers: headers_a });
  assert.equal(a_limited.status, 429); //A는 이미 소진됨

  const b_first = await fetch(`${BASE_URL}/probe`, { method: 'POST', headers: headers_b });
  assert.equal(b_first.status, 200); //B는 아직 영향받지 않아야 함
});

test('토큰 없는 요청은 IP 기준으로 리밋되고, 유효하지 않은 토큰도 그 토큰 자체를 키로 사용해 무차별 대입을 제한한다', async () =>
{
  //토큰이 아예 없는 요청 - IP 폴백
  for(let i = 0; i < 10; ++i)
  {
    const res = await fetch(`${BASE_URL}/probe`);
    assert.equal(res.status, 200, `${i + 1}번째 무토큰 요청은 통과해야 함`);
  }
  const eleventh = await fetch(`${BASE_URL}/probe`);
  assert.equal(eleventh.status, 429);

  //세션 검증(requireWebSession)과 무관하게 rate limiter는 헤더의 토큰 문자열 자체를 키로 쓴다 -
  //무효한 토큰이어도 그 토큰 이름으로 독립된 버킷이 생겨 무차별 대입 시도를 제한할 수 있어야 한다.
  const headers = withToken('this_token_does_not_exist_in_any_session');
  for(let i = 0; i < 10; ++i)
  {
    const res = await fetch(`${BASE_URL}/probe`, { headers });
    assert.equal(res.status, 200, `${i + 1}번째 무효 토큰 요청은 리밋 레벨에서는 통과해야 함`);
  }
  const invalid_token_eleventh = await fetch(`${BASE_URL}/probe`, { headers });
  assert.equal(invalid_token_eleventh.status, 429);
});
