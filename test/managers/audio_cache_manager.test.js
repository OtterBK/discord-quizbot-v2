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

const audio_cache_manager = require('../../quizbot/managers/audio_cache_manager.js');
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
