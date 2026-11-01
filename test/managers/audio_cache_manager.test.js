'use strict';

//audio_cache_manager.js는 yt-dlp/ffmpeg/파일시스템에 강하게 결합된 파이프라인이라
//(원본에 명확한 //#region 구분이 없고 함수들이 서로를 빈번히 호출) REFACTOR_PLAN.md의
//"기존 설계 존중" 원칙에 따라 구조 분리는 하지 않았다(REFACTOR_PLAN.md Phase 5).
//대신 순수 로직인 getHashedPath/getDownloadResultType/getExpectedErrorType 3개를
//monitoring_manager.js의 calculateAverageCpuUsage와 동일한 패턴으로 테스트용 export를
//추가해(REFACTOR_PLAN.md 2.4) 유닛테스트를 붙인다.
//executeDownloadProcess도 같은 패턴으로 export해, youtube-dl-exec(youtubedl.exec)를
//mock 처리하고 실제 Node EventEmitter로 stdout/stderr를 흉내내 stdout/stderr 수집
//버그(BUGS_FOUND.md) 회귀 테스트를 붙인다.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const audio_cache_manager = require('../../quizbot/managers/audio_cache_manager');
const youtubedl = require('youtube-dl-exec');

//youtube-dl-exec의 실제 subprocess처럼 stdout/stderr(EventEmitter)를 갖고,
//await 가능한(Promise인) 가짜 subprocess를 만든다. resolve/reject를 외부에서 호출해
//테스트 코드가 원하는 시점에 다운로드 완료/실패를 흉내낼 수 있게 한다.
function createFakeSubprocess()
{
  let resolve_subprocess, reject_subprocess;
  const subprocess = new Promise((resolve, reject) =>
  {
    resolve_subprocess = resolve;
    reject_subprocess = reject;
  });
  subprocess.stdout = new EventEmitter();
  subprocess.stderr = new EventEmitter();

  return { subprocess, resolve_subprocess, reject_subprocess };
}

test('getHashedPath: target의 첫 글자를 대문자로 캐시 루트 아래 하위 경로로 만든다', () =>
{
  const result = audio_cache_manager.getHashedPath('abc123');

  assert.match(result, /A$/); //마지막 경로 조각은 첫 글자를 대문자화한 'A'
});

test('getHashedPath: target이 없거나 빈 문자열이면 undefined를 반환한다', () =>
{
  assert.equal(audio_cache_manager.getHashedPath(undefined), undefined);
  assert.equal(audio_cache_manager.getHashedPath(''), undefined);
});

test('getDownloadResultType: "has already been downloaded" 줄이 있으면 ALREADY_EXIST다', () =>
{
  const stdout = `[download] Destination: video.webm\n[download] video.webm has already been downloaded`;

  assert.equal(audio_cache_manager.getDownloadResultType(stdout), 4 /* ALREADY_EXIST */);
});

test('getDownloadResultType: "does not pass filter"에 duration이 포함되면 OVER_DURATION, 아니면 NO_MATCH_FILTER다', () =>
{
  assert.equal(
    audio_cache_manager.getDownloadResultType(`[download] does not pass filter (duration <= 600), skipping`),
    2 /* OVER_DURATION */
  );
  assert.equal(
    audio_cache_manager.getDownloadResultType(`[download] does not pass filter (some other rule), skipping`),
    5 /* NO_MATCH_FILTER */
  );
});

test('getDownloadResultType: "Destination:" 줄이 있으면 SUCCESS다', () =>
{
  assert.equal(
    audio_cache_manager.getDownloadResultType(`[download] Destination: video.webm`),
    0 /* SUCCESS */
  );
});

test('getDownloadResultType: [download]로 시작하는 줄이 하나도 없으면 UNKNOWN이다', () =>
{
  assert.equal(audio_cache_manager.getDownloadResultType(`아무 상관없는 로그`), 10 /* UNKNOWN */);
});

test('getExpectedErrorType: error_message가 문자열이 아니면 ERROR다', () =>
{
  assert.equal(audio_cache_manager.getExpectedErrorType(undefined), 1 /* ERROR */);
  assert.equal(audio_cache_manager.getExpectedErrorType(12345), 1 /* ERROR */);
});

test('getExpectedErrorType: ERROR: 줄에서 Video unavailable/Private video/Music Premium을 각각 분류한다', () =>
{
  assert.equal(
    audio_cache_manager.getExpectedErrorType(`ERROR: [youtube] abc123: Video unavailable`),
    6 /* VIDEO_UNAVAILABLE */
  );
  assert.equal(
    audio_cache_manager.getExpectedErrorType(`ERROR: [youtube] abc123: Private video`),
    7 /* PRIVATE_VIDEO */
  );
  assert.equal(
    audio_cache_manager.getExpectedErrorType(`ERROR: This video is only available to Music Premium members`),
    8 /* PREMIUM */
  );
});

test('getExpectedErrorType: "Sign in to confirm you\'re not a bot"은 BOT_DETECTED다', () =>
{
  const stderr = `ERROR: [youtube] p0pjdQOIOLg: Sign in to confirm you’re not a bot. This helps protect our community. Use --cookies-from-browser or --cookies for the authentication.`;

  assert.equal(audio_cache_manager.getExpectedErrorType(stderr), 9 /* BOT_DETECTED */);
});

test('getExpectedErrorType: ERROR: 줄이 있어도 알려진 패턴이 아니면 ERROR다', () =>
{
  assert.equal(audio_cache_manager.getExpectedErrorType(`ERROR: something totally unexpected`), 1 /* ERROR */);
});

test('executeDownloadProcess: stdout를 여러 청크로 나눠 받아도 [object Object] 같은 쓰레기 문자열이 섞이지 않는다 (BUGS_FOUND.md 회귀 테스트)', async (t) =>
{
  const { subprocess, resolve_subprocess } = createFakeSubprocess();
  t.mock.method(youtubedl, 'exec', () => subprocess);

  const result_promise = audio_cache_manager.executeDownloadProcess('https://example.com/watch?v=abc123', {});

  //executeDownloadProcess는 호출 즉시(첫 await 전까지) stdout/stderr에 리스너를 붙이므로
  //바로 이어서 data 이벤트를 여러 청크로 나눠 emit해도 안전하다.
  subprocess.stdout.emit('data', Buffer.from('[download] '));
  subprocess.stdout.emit('data', Buffer.from('Destination: video.webm\n'));
  resolve_subprocess();

  const result = await result_promise;

  assert.equal(result.result_type, 0 /* SUCCESS */);
  assert.equal(result.result_message, '[download] Destination: video.webm\n');
  assert.doesNotMatch(result.result_message, /\[object/);
});

test('executeDownloadProcess: stderr도 여러 청크로 나눠 받아도 쓰레기 문자열 없이 에러 타입을 판별한다', async (t) =>
{
  const { subprocess, reject_subprocess } = createFakeSubprocess();
  t.mock.method(youtubedl, 'exec', () => subprocess);

  const result_promise = audio_cache_manager.executeDownloadProcess('https://example.com/watch?v=abc123', {});

  subprocess.stderr.emit('data', Buffer.from('ERROR: [youtube] abc123: '));
  subprocess.stderr.emit('data', Buffer.from('Private video\n'));
  reject_subprocess(new Error('yt-dlp exited with code 1'));

  const result = await result_promise;

  assert.equal(result.result_type, 7 /* PRIVATE_VIDEO */);
  assert.equal(result.error_message, 'ERROR: [youtube] abc123: Private video\n');
  assert.doesNotMatch(result.error_message, /\[object/);
});

//executeDownloadAudioCache 쿠키 재시도 시나리오용 - 옵션에 cookies가 있으면 성공, 없으면 봇 차단 stderr로 실패하는 가짜 yt-dlp
function mockYtdlpBotDetectedUnlessCookies(t)
{
  const calls = [];
  t.mock.method(youtubedl, 'exec', (url, option) =>
  {
    calls.push(option);
    const { subprocess, resolve_subprocess, reject_subprocess } = createFakeSubprocess();
    setImmediate(() =>
    {
      if(option.cookies != undefined)
      {
        subprocess.stdout.emit('data', Buffer.from('[download] Destination: zz_cookie_test.webm\n'));
        resolve_subprocess();
        return;
      }
      subprocess.stderr.emit('data', Buffer.from('ERROR: [youtube] zz_cookie_test: Sign in to confirm you’re not a bot.\n'));
      reject_subprocess(new Error('yt-dlp exited with code 1'));
    });
    return subprocess;
  });
  return calls;
}

function setupCookieTest(t, { cookie_file_exists })
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { SYSTEM_CONFIG } = require('../../config/system_setting.js');

  const tmp_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytdl-cookie-test-'));
  const cookie_path = path.join(tmp_dir, 'yt-cookies.txt');
  if(cookie_file_exists)
  {
    fs.writeFileSync(cookie_path, '# Netscape HTTP Cookie File\n');
  }

  const original_cookie_path = SYSTEM_CONFIG.YTDL_COOKIE_PATH;
  SYSTEM_CONFIG.YTDL_COOKIE_PATH = cookie_path;

  t.mock.method(fs, 'appendFile', () => {}); //logFailedUrl이 실제 failed_url.txt에 테스트 URL을 남기지 않게

  t.after(() =>
  {
    SYSTEM_CONFIG.YTDL_COOKIE_PATH = original_cookie_path;
    fs.rmSync(tmp_dir, { recursive: true, force: true });
    //reWriteCacheInfo가 캐시 경로에 남긴 info 파일 정리
    const info_path = path.join(audio_cache_manager.getHashedPath('zz_cookie_test'), 'zz_cookie_test.info.json');
    fs.rmSync(info_path, { force: true });
  });

  return cookie_path;
}

test('executeDownloadAudioCache: IP 시나리오가 전부 봇 차단이면 봇 차단된 IP 그대로 쿠키+node 런타임으로 1회 재시도한다', async (t) =>
{
  const cookie_path = setupCookieTest(t, { cookie_file_exists: true });
  const calls = mockYtdlpBotDetectedUnlessCookies(t);

  const result = await audio_cache_manager.executeDownloadAudioCache(
    'https://youtu.be/zz_cookie_test', 'zz_cookie_test', { ipv4: '10.0.0.4', ipv6: '2600::1' });

  assert.equal(result.success, true);
  assert.equal(calls.length, 3); //ipv6 -> ipv4 -> 쿠키
  assert.equal(calls[0].cookies, undefined);
  assert.equal(calls[1].cookies, undefined);
  assert.equal(calls[2].cookies, cookie_path);
  assert.equal(calls[2].jsRuntimes, 'node');
  assert.equal(calls[2].sourceAddress, '10.0.0.4'); //마지막으로 봇 차단된 시나리오의 IP
});

test('executeDownloadAudioCache: 쿠키 파일이 없으면 쿠키 재시도 없이 봇 차단 실패를 반환한다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: false });
  const calls = mockYtdlpBotDetectedUnlessCookies(t);

  const result = await audio_cache_manager.executeDownloadAudioCache(
    'https://youtu.be/zz_cookie_test', 'zz_cookie_test', { ipv4: '10.0.0.4', ipv6: undefined });

  assert.equal(result.success, false);
  assert.equal(result.need_retry, true);
  assert.match(result.causation_message, /봇/);
  assert.equal(calls.length, 1);
});
