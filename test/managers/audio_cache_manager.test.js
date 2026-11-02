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

test('getExpectedErrorType: 연령 제한/네트워크 불가/쿠키 무효를 각각 분류한다', () =>
{
  assert.equal(audio_cache_manager.getExpectedErrorType(`ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.`), 13 /* AGE_RESTRICTED */);
  assert.equal(audio_cache_manager.getExpectedErrorType(`ERROR: [youtube] abc: Unable to download API page: [Errno 101] Network is unreachable`), 12 /* NETWORK_ERROR */);
  assert.equal(audio_cache_manager.getExpectedErrorType(`ERROR: [youtube] abc: [Errno 99] Cannot assign requested address`), 12 /* NETWORK_ERROR */);
  //쿠키 무효는 WARNING으로 찍히고 이후 비로그인으로 진행하다 봇 차단으로 실패 -> 진짜 원인은 쿠키
  assert.equal(audio_cache_manager.getExpectedErrorType(
    `WARNING: [youtube] The provided YouTube account cookies are no longer valid.\nERROR: [youtube] abc: Sign in to confirm you’re not a bot.`), 11 /* COOKIE_INVALID */);
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

//executeDownloadAudioCache 시나리오 테스트용 가짜 yt-dlp - decide(option)이 'success'면 성공, 아니면 그 문자열을 stderr로 내고 실패
function mockYtdlp(t, decide)
{
  const calls = [];
  t.mock.method(youtubedl, 'exec', (url, option) =>
  {
    calls.push({ ...option, cookie_copy_existed: option.cookies != undefined && require('node:fs').existsSync(option.cookies) });
    const { subprocess, resolve_subprocess, reject_subprocess } = createFakeSubprocess();
    setImmediate(() =>
    {
      const decision = decide(option);
      if(decision === 'success')
      {
        subprocess.stdout.emit('data', Buffer.from('[download] Destination: zz_cookie_test.webm\n'));
        resolve_subprocess();
        return;
      }
      subprocess.stderr.emit('data', Buffer.from(decision));
      reject_subprocess(new Error('yt-dlp exited with code 1'));
    });
    return subprocess;
  });
  return calls;
}

const BOT_DETECTED_STDERR = 'ERROR: [youtube] zz_cookie_test: Sign in to confirm you’re not a bot.\n';
const IP_INFO = { ipv4: '10.0.0.4', ipv6: '2600::1' };
const download = () => audio_cache_manager.executeDownloadAudioCache('https://youtu.be/zz_cookie_test', 'zz_cookie_test', IP_INFO);
const describeCall = (call) => `${call.cookies != undefined ? 'cookie' : 'nocookie'}:${call.sourceAddress}`;

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
  audio_cache_manager.resetScenarioHealth(); //시나리오 차단 상태는 모듈 전역이라 테스트마다 초기화

  t.mock.method(fs, 'appendFile', () => {}); //logFailedUrl이 실제 failed_url.txt에 테스트 URL을 남기지 않게

  t.after(() =>
  {
    SYSTEM_CONFIG.YTDL_COOKIE_PATH = original_cookie_path;
    audio_cache_manager.resetScenarioHealth();
    fs.rmSync(tmp_dir, { recursive: true, force: true });
    //reWriteCacheInfo가 캐시 경로에 남긴 info 파일 정리
    const info_path = path.join(audio_cache_manager.getHashedPath('zz_cookie_test'), 'zz_cookie_test.info.json');
    fs.rmSync(info_path, { force: true });
  });

  return cookie_path;
}

test('executeDownloadAudioCache: 쿠키 파일이 있으면 IPv6+쿠키 -> IPv4+쿠키 -> IPv6 -> IPv4 순서로 시도한다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: true });
  const calls = mockYtdlp(t, () => BOT_DETECTED_STDERR);

  const result = await download();

  assert.equal(result.success, false);
  assert.equal(result.need_retry, true);
  assert.match(result.causation_message, /봇/);
  assert.deepEqual(calls.map(describeCall), ['cookie:2600::1', 'cookie:10.0.0.4', 'nocookie:2600::1', 'nocookie:10.0.0.4']);
  assert.equal(calls[0].jsRuntimes, 'node');
  assert.equal(calls[2].jsRuntimes, undefined);
});

test('executeDownloadAudioCache: 시나리오 옵션이 yt-dlp가 모르는 인자(--no-no-warnings 등)로 변환되지 않는다 (2026-11-01 회귀 테스트)', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: true });
  const calls = mockYtdlp(t, () => BOT_DETECTED_STDERR);

  await download();

  //실제 youtube-dl-exec의 옵션->인자 변환(dargs)을 그대로 거쳐서 확인
  for(const call of calls)
  {
    const { cookie_copy_existed, ...option } = call;
    const cli_args = youtubedl.args(option);
    assert.equal(cli_args.some((arg) => arg.startsWith('--no-no-')), false, cli_args.join(' '));
  }
  assert.equal(youtubedl.args(calls[0]).includes('--no-warnings'), false); //쿠키 시나리오는 쿠키 무효 경고를 잡으려고 경고 출력
  assert.equal(youtubedl.args(calls[2]).includes('--no-warnings'), true);
});

test('executeDownloadAudioCache: 모든 시나리오가 원본 오디오 트랙 우선 정렬(--format-sort lang,+size)로 실행된다 (자동 더빙 트랙 방지, 2026-11-02 회귀 테스트)', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: true });
  const calls = mockYtdlp(t, () => BOT_DETECTED_STDERR);

  await download();

  assert.equal(calls.length, 4);
  for(const call of calls)
  {
    const cli_args = youtubedl.args(call);
    const sort_index = cli_args.indexOf('--format-sort');
    assert.notEqual(sort_index, -1);
    assert.equal(cli_args[sort_index + 1], 'lang,+size'); //+size가 lang보다 앞서면 원본보다 작은 더빙 트랙이 선택됨
  }
});

test('executeDownloadAudioCache: 쿠키 시나리오는 원본이 아닌 임시 복사본을 넘기고, 끝나면 복사본을 지운다', async (t) =>
{
  const cookie_path = setupCookieTest(t, { cookie_file_exists: true });
  const calls = mockYtdlp(t, () => 'success');

  const result = await download();
  await new Promise((resolve) => setTimeout(resolve, 50)); //복사본 삭제(비동기) 대기

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].cookies, cookie_path);
  assert.equal(calls[0].cookie_copy_existed, true);
  assert.equal(require('node:fs').existsSync(calls[0].cookies), false);
});

test('executeDownloadAudioCache: 쿠키 파일이 없으면 IPv6 -> IPv4만 시도한다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: false });
  const calls = mockYtdlp(t, () => BOT_DETECTED_STDERR);

  await download();

  assert.deepEqual(calls.map(describeCall), ['nocookie:2600::1', 'nocookie:10.0.0.4']);
});

test('executeDownloadAudioCache: 시나리오가 3번 연속 실패하면 1시간 건너뛰고, 1시간 뒤 1번 시험해서 또 실패하면 바로 재차단한다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: true });
  //IPv6+쿠키만 항상 봇 차단, IPv4+쿠키는 성공
  const calls = mockYtdlp(t, (option) => (option.cookies != undefined && option.sourceAddress === '10.0.0.4') ? 'success' : BOT_DETECTED_STDERR);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);

  for(let i = 0; i < 3; ++i)
  {
    calls.length = 0;
    await download();
    assert.deepEqual(calls.map(describeCall), ['cookie:2600::1', 'cookie:10.0.0.4']);
  }

  calls.length = 0;
  await download(); //IPv6+쿠키 차단됨
  assert.deepEqual(calls.map(describeCall), ['cookie:10.0.0.4']);

  now += 3600 * 1000; //1시간 경과 -> 1번 시험
  calls.length = 0;
  await download();
  assert.deepEqual(calls.map(describeCall), ['cookie:2600::1', 'cookie:10.0.0.4']);

  calls.length = 0;
  await download(); //시험 실패 -> 3번 안 기다리고 바로 재차단
  assert.deepEqual(calls.map(describeCall), ['cookie:10.0.0.4']);
});

test('executeDownloadAudioCache: 성공하면 연속 실패 카운트가 초기화된다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: false });
  let fail = true;
  const calls = mockYtdlp(t, () => fail ? BOT_DETECTED_STDERR : 'success');

  await download(); await download(); //IPv6 2회 실패
  fail = false;
  await download(); //IPv6 성공 -> 초기화
  fail = true;
  await download(); await download(); //다시 2회 실패 (누적이었으면 여기서 차단됐을 것)

  calls.length = 0;
  await download();
  assert.equal(describeCall(calls[0]), 'nocookie:2600::1');
});

test('executeDownloadAudioCache: 전부 차단 상태면 차단을 무시하고 모든 시나리오를 시도한다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: false });
  const calls = mockYtdlp(t, () => BOT_DETECTED_STDERR);

  for(let i = 0; i < 3; ++i)
  {
    await download();
  }

  calls.length = 0;
  await download();
  assert.deepEqual(calls.map(describeCall), ['nocookie:2600::1', 'nocookie:10.0.0.4']);
});

test('executeDownloadAudioCache: 영상 탓 실패(비공개 등)는 실패로 세지 않고 다음 시나리오로 넘어가지도 않는다', async (t) =>
{
  setupCookieTest(t, { cookie_file_exists: false });
  const calls = mockYtdlp(t, () => 'ERROR: [youtube] zz_cookie_test: Private video\n');

  for(let i = 0; i < 4; ++i)
  {
    calls.length = 0;
    const result = await download();
    assert.equal(result.need_retry, false);
    assert.deepEqual(calls.map(describeCall), ['nocookie:2600::1']); //차단되지 않음
  }
});
