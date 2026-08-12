'use strict';

//utility.js에서 도메인별로 분리된 utility/util/*.js(REFACTOR_PLAN.md Phase 5)에 대한
//회귀 방지 테스트. quiz_content_loader.js는 세 함수가 서로 this.xxx(...)로 호출하는
//패턴(module 최상위 this === module.exports)을 그대로 유지했는데, 분리 과정에서 이 자기
//참조가 깨지지 않았는지가 가장 중요한 검증 포인트다.

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const utility = require('../../utility/utility.js');
const quiz_content_loader = require('../../utility/util/quiz_content_loader');
const audio_utility = require('../../utility/util/audio_utility');
const network_utility = require('../../utility/util/network_utility');
const misc_utility = require('../../utility/util/misc_utility');
const web_token_utility = require('../../utility/util/web_token_utility');

test('utility.js: 5개 도메인 파일의 export를 빠짐없이 재수출한다 (총 26개)', () =>
{
  const expected_names = [
    ...Object.keys(quiz_content_loader),
    ...Object.keys(audio_utility),
    ...Object.keys(network_utility),
    ...Object.keys(misc_utility),
    ...Object.keys(web_token_utility),
  ].sort();

  const actual_names = Object.keys(utility).sort();

  assert.equal(actual_names.length, 26);
  assert.deepEqual(actual_names, expected_names);
});

test('utility.js: 도메인 파일 사이에 이름이 겹치지 않는다', () =>
{
  const all_names = [
    ...Object.keys(quiz_content_loader),
    ...Object.keys(audio_utility),
    ...Object.keys(network_utility),
    ...Object.keys(misc_utility),
    ...Object.keys(web_token_utility),
  ];

  assert.equal(new Set(all_names).size, all_names.length);
});

test('loadLocalDirectoryQuiz: this.parseContentInfoFromDirName/this.getQuizTypeFromIcon 자기 참조가 분리 후에도 깨지지 않는다', () =>
{
  const quizdata_path = path.join(__dirname, '..', '..', 'resources', 'quizdata');

  const contents = quiz_content_loader.loadLocalDirectoryQuiz(quizdata_path);

  assert.ok(Array.isArray(contents));
  assert.ok(contents.length > 0);

  for(const content of contents)
  {
    // this.parseContentInfoFromDirName(...) 결과 필드가 채워져 있어야 함
    assert.ok('name' in content);
    assert.ok('icon' in content);
    assert.ok('is_quiz' in content);
  }
});

test('getQuizTypeFromIcon: 알 수 없는 아이콘이면 기본 타입(SONG)을 반환한다', () =>
{
  const { QUIZ_TYPE } = require('../../config/system_setting.js');

  assert.equal(quiz_content_loader.getQuizTypeFromIcon('알수없는아이콘'), QUIZ_TYPE.SONG);
});

test('misc_utility: getRandom은 min~max 범위(양 끝 포함) 안의 정수를 반환한다', () =>
{
  for(let i = 0; i < 50; ++i)
  {
    const value = misc_utility.getRandom(1, 5);
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 1 && value <= 5);
  }
});

test('misc_utility: isValidURL은 http(s) 프로토콜이 아니거나 webp로 끝나면 false다', () =>
{
  assert.equal(misc_utility.isValidURL('https://example.com/image.png'), true);
  assert.equal(misc_utility.isValidURL('ftp://example.com'), false);
  assert.equal(misc_utility.isValidURL('https://example.com/image.webp'), false);
  assert.equal(misc_utility.isValidURL(undefined), false);
});

test('network_utility: getIPv4Address/getIPv6Address는 배열을 반환한다', () =>
{
  assert.ok(Array.isArray(network_utility.getIPv4Address()));
  assert.ok(Array.isArray(network_utility.getIPv6Address()));
});

test('misc_utility: convertTagsValueToString은 태그 사이에만 ", "를 넣고 마지막에 trailing comma를 남기지 않는다', () =>
{
  const FAKE_TAG_INFO = { NONE: 0, A: 1, B: 2, C: 4 };

  assert.equal(misc_utility.convertTagsValueToString(1 | 2, FAKE_TAG_INFO), 'A, B');
  assert.equal(misc_utility.convertTagsValueToString(1, FAKE_TAG_INFO), 'A');
  assert.equal(misc_utility.convertTagsValueToString(0, FAKE_TAG_INFO), '');
});

test('audio_utility: playBGM(COUNTDOWN_LONG)은 misc_utility.getRandom으로 롱타이머 목록에서 하나를 고른다 (원본의 exports.getRandom(...) 호출이 분리 후 misc_utility.getRandom(...)으로 재배선됨)', async (t) =>
{
  const { BGM_TYPE } = require('../../config/system_setting.js');

  audio_utility.initializeBGM(); //실제 resources/bgm/longTimer 디렉터리를 읽어 bgm_long_timers를 채움

  let called_with = undefined;
  t.mock.method(misc_utility, 'getRandom', (min, max) => { called_with = [min, max]; return 0; });

  const fake_audio_player = { play: () => {} };
  const bgm_resource = await audio_utility.playBGM(fake_audio_player, BGM_TYPE.COUNTDOWN_LONG);

  assert.ok(called_with !== undefined, 'misc_utility.getRandom이 호출되어야 한다');
  assert.equal(called_with[0], 0);
  assert.ok(called_with[1] > 0);
  assert.ok(bgm_resource !== undefined);
});

test('audio_utility: playBGM은 audio_player가 없으면 아무것도 하지 않고 undefined를 반환한다', async () =>
{
  const result = await audio_utility.playBGM(undefined, 'countdown_long');
  assert.equal(result, undefined);
});
