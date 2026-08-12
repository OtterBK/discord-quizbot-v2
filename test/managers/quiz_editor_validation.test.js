'use strict';

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 2 - user-question-info-ui.ts/
//user-quiz-info.ui.ts에서 추출된 순수 검증/파싱 함수 테스트. 디스코드 UI가 동일 함수를 그대로
//호출하도록 순수 이관됐으므로(동작 변경 없음), 여기서 검증하는 경계값은 기존 인라인 동작과 같아야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseAudioRangePoints,
  redefineRepeatCount,
  parseUseAnswerTimer,
  isValidAudioUrl,
  isValidImageUrl,
  isDiscordCdnLink,
  canGoPublic,
} = require('../../quizbot/managers/quiz_editor_validation');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');

test('parseAudioRangePoints: 빈 문자열이면 전부 undefined다', () =>
{
  assert.deepEqual(parseAudioRangePoints(''), [undefined, undefined, undefined]);
});

test('parseAudioRangePoints: "25 ~" 처럼 끝에 물결만 있으면 물결을 제거하고 start만 파싱한다', () =>
{
  assert.deepEqual(parseAudioRangePoints('25 ~'), [25, undefined, undefined]);
});

test('parseAudioRangePoints: 물결만 입력(정제 후 빈 문자열)하면 전부 undefined다', () =>
{
  assert.deepEqual(parseAudioRangePoints('~'), [undefined, undefined, undefined]);
});

test('parseAudioRangePoints: "10 ~ 30"이면 start/end/play_time을 계산한다', () =>
{
  assert.deepEqual(parseAudioRangePoints('10 ~ 30'), [10, 30, 20]);
});

test('parseAudioRangePoints: start > end면 서로 swap한다', () =>
{
  assert.deepEqual(parseAudioRangePoints('30 ~ 10'), [10, 30, 20]);
});

test('parseAudioRangePoints: 소수점은 내림 처리한다', () =>
{
  assert.deepEqual(parseAudioRangePoints('10.9 ~ 30.1'), [10, 30, 20]);
});

test('parseAudioRangePoints: 음수는 undefined로 처리한다', () =>
{
  assert.deepEqual(parseAudioRangePoints('-5 ~ 30'), [undefined, 30, undefined]);
});

test('redefineRepeatCount: 미입력이면 기본 1회다', () =>
{
  assert.equal(redefineRepeatCount(undefined), 1);
  assert.equal(redefineRepeatCount(''), 1);
});

test('redefineRepeatCount: 0 이하면 1회로 보정한다', () =>
{
  assert.equal(redefineRepeatCount('0'), 1);
  assert.equal(redefineRepeatCount('-3'), 1);
});

test('redefineRepeatCount: 상한(MAX_QUESTION_AUDIO_REPEAT)을 넘으면 클램프한다', () =>
{
  const over_limit = SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT + 100;
  assert.equal(redefineRepeatCount(String(over_limit)), SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT);
});

test('redefineRepeatCount: 정상 범위 값은 그대로 반환한다', () =>
{
  assert.equal(redefineRepeatCount('2'), 2);
});

test('parseUseAnswerTimer: 정확히 일치하는 긍정 응답 5개만 true다', () =>
{
  for(const yes of ['사용', '네', '예', 'y', 'Y'])
  {
    assert.equal(parseUseAnswerTimer(yes), true, `"${yes}"는 true여야 함`);
  }
});

test('parseUseAnswerTimer: 앞뒤 공백은 무시하지만 임의 문자열/오타는 false다', () =>
{
  assert.equal(parseUseAnswerTimer('  네  '), true);
  assert.equal(parseUseAnswerTimer('넹'), false);
  assert.equal(parseUseAnswerTimer(' '), false); //스페이스만 입력한 오입력 방지가 원래 이 함수의 도입 이유
  assert.equal(parseUseAnswerTimer(''), false);
  assert.equal(parseUseAnswerTimer(undefined), false);
});

test('isValidAudioUrl/isValidImageUrl: 빈 값은 유효한 것으로 취급한다', () =>
{
  assert.equal(isValidAudioUrl(undefined), true);
  assert.equal(isValidAudioUrl(''), true);
  assert.equal(isValidImageUrl(undefined), true);
  assert.equal(isValidImageUrl(''), true);
});

test('isValidAudioUrl: 유튜브 URL 형식이 아니면 false다', () =>
{
  assert.equal(isValidAudioUrl('not a url'), false);
});

test('isValidImageUrl: http(s) 프로토콜이 아니면 false다', () =>
{
  assert.equal(isValidImageUrl('ftp://example.com/a.png'), false);
});

test('isValidImageUrl: http(s) URL이면 true다', () =>
{
  assert.equal(isValidImageUrl('https://example.com/a.png'), true);
});

test('isDiscordCdnLink: cdn.discordapp.com이 포함되면 true다', () =>
{
  assert.equal(isDiscordCdnLink('https://cdn.discordapp.com/attachments/1/2/a.png'), true);
});

test('isDiscordCdnLink: 다른 도메인/undefined면 false다', () =>
{
  assert.equal(isDiscordCdnLink('https://example.com/a.png'), false);
  assert.equal(isDiscordCdnLink(undefined), false);
});

test('canGoPublic: tags_value가 0이거나 undefined면 false다', () =>
{
  assert.equal(canGoPublic(0), false);
  assert.equal(canGoPublic(undefined), false);
});

test('canGoPublic: tags_value가 양수면 true다', () =>
{
  assert.equal(canGoPublic(1), true);
  assert.equal(canGoPublic(8), true);
});
