'use strict';

//audio_cache_manager.js는 yt-dlp/ffmpeg/파일시스템에 강하게 결합된 파이프라인이라
//(원본에 명확한 //#region 구분이 없고 함수들이 서로를 빈번히 호출) REFACTOR_PLAN.md의
//"기존 설계 존중" 원칙에 따라 구조 분리는 하지 않았다(REFACTOR_PLAN.md Phase 5).
//대신 순수 로직인 getHashedPath/getDownloadResultType/getExpectedErrorType 3개를
//monitoring_manager.js의 calculateAverageCpuUsage와 동일한 패턴으로 테스트용 export를
//추가해(REFACTOR_PLAN.md 2.4) 유닛테스트를 붙인다.

const test = require('node:test');
const assert = require('node:assert/strict');

const audio_cache_manager = require('../../quizbot/managers/audio_cache_manager.js');

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
