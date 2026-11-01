'use strict';

//ytdlp_health_check.ts(봇 시작 시 yt-dlp 점검 -> 어드민 DM)의 순수 로직 테스트.
//실제 yt-dlp 실행/DM 전송은 서버 환경 의존이라 쿠키 파일 검사와 리포트 메시지 생성만 검증한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const ytdlp_health_check = require('../../quizbot/managers/ytdlp_health_check');

const DAY_SEC = 24 * 60 * 60;
const NOW_MS = Date.UTC(2026, 10, 1); //2026-11-01

const cookieLine = (domain, name, expire_sec) => `${domain}\tTRUE\t/\tTRUE\t${expire_sec}\t${name}\tVALUE`;
const loginCookieFile = (expire_sec) => [
  '# Netscape HTTP Cookie File',
  cookieLine('.youtube.com', 'LOGIN_INFO', expire_sec),
  cookieLine('.youtube.com', 'SAPISID', expire_sec + DAY_SEC),
  cookieLine('.youtube.com', '__Secure-3PSID', expire_sec + 2 * DAY_SEC),
].join('\n');

test('inspectCookieContent: 로그인 쿠키가 다 있으면 문제 없음 + 가장 이른 만료 시각을 돌려준다', () =>
{
  const expire_sec = NOW_MS / 1000 + 100 * DAY_SEC;
  const { problems, expires_at } = ytdlp_health_check.inspectCookieContent(loginCookieFile(expire_sec));

  assert.deepEqual(problems, []);
  assert.equal(expires_at, expire_sec * 1000);
});

test('inspectCookieContent: 비로그인 쿠키만 있거나 형식/줄바꿈이 틀리면 문제로 보고한다', () =>
{
  const content = ['# Netscape HTTP Cookie File', cookieLine('.youtube.com', 'VISITOR_INFO1_LIVE', 0)].join('\r\n');
  const { problems } = ytdlp_health_check.inspectCookieContent(content);

  assert.ok(problems.includes('CRLF 줄바꿈 포함'));
  assert.ok(problems.some((problem) => problem.startsWith('LOGIN_INFO 없음')));

  assert.ok(ytdlp_health_check.inspectCookieContent('garbage').problems.includes('Netscape 형식 아님'));
});

const ok = (format_id = '249') => ({ success: true, result_type: 0, format_id });
const fail = (result_type) => ({ success: false, result_type, format_id: '' });
const report = (overrides) => ytdlp_health_check.buildReportMessage({
  version: '2026.10.26',
  cookie_path: '/x/yt-cookies.txt',
  cookie_problems: [],
  cookie_expires_at: NOW_MS + 100 * DAY_SEC * 1000,
  scenario_results: [
    { label: 'IPv6+쿠키', use_cookie: true, result: ok() },
    { label: 'IPv4+쿠키', use_cookie: true, result: ok() },
    { label: 'IPv6', use_cookie: false, result: ok() },
    { label: 'IPv4', use_cookie: false, result: fail(9 /* BOT_DETECTED */) },
  ],
  now: NOW_MS,
  ...overrides,
});

test('buildReportMessage: 정상이면 경고 없이 버전/쿠키 만료일/시나리오별 결과를 보여준다', () =>
{
  const message = report({});

  assert.match(message, /yt-dlp 2026\.10\.26/);
  assert.match(message, /쿠키: ✅ 만료 2027-02-09 \(D-100\)/);
  assert.match(message, /IPv6\+쿠키: ✅ \(format 249\)/);
  assert.match(message, /IPv4: ❌ 봇 차단/);
  assert.doesNotMatch(message, /⚠️|🚨/);
});

test('buildReportMessage: 쿠키 만료가 14일 이내면 만료 임박 경고를 붙인다', () =>
{
  const message = report({ cookie_expires_at: NOW_MS + 10 * DAY_SEC * 1000 });

  assert.match(message, /⚠️ 쿠키 만료 임박 \(D-10\)/);
});

test('buildReportMessage: 쿠키 시나리오가 전부 실패하면 재발급 경고, 전부 실패면 다운로드 불가 경고를 붙인다', () =>
{
  const cookie_fail = report({
    scenario_results: [
      { label: 'IPv6+쿠키', use_cookie: true, result: fail(11 /* COOKIE_INVALID */) },
      { label: 'IPv6', use_cookie: false, result: ok() },
    ],
  });
  assert.match(cookie_fail, /⚠️ 쿠키 시나리오 전부 실패/);
  assert.doesNotMatch(cookie_fail, /🚨/);

  const all_fail = report({
    scenario_results: [
      { label: 'IPv6+쿠키', use_cookie: true, result: fail(11) },
      { label: 'IPv6', use_cookie: false, result: fail(9) },
    ],
  });
  assert.match(all_fail, /🚨 모든 시나리오 실패/);
});

test('buildReportMessage: 기타 오류는 원인 파악용으로 yt-dlp 에러 문구를 같이 보여준다', () =>
{
  const message = report({
    scenario_results: [
      { label: 'IPv6+쿠키', use_cookie: true, result: { ...fail(1 /* ERROR */), detail: 'yt-dlp: error: no such option: --no-no-warnings' } },
    ],
  });

  assert.match(message, /IPv6\+쿠키: ❌ 기타 오류 - yt-dlp: error: no such option: --no-no-warnings/);
});

test('buildReportMessage: 쿠키 파일이 없으면 미설정으로 표시하고 쿠키 경고는 붙이지 않는다', () =>
{
  const message = report({
    cookie_path: undefined,
    scenario_results: [{ label: 'IPv6', use_cookie: false, result: ok() }],
  });

  assert.match(message, /쿠키: 미설정/);
  assert.doesNotMatch(message, /⚠️/);
});
