'use strict';

//node:test 스캐폴딩 예시 테스트 (REFACTOR_PLAN.md Phase 0)
//순수 로직(디스코드 API/DB/네트워크 의존 없음)부터 커버한다는 원칙(2.4)에 따라
//utility.parseContentInfoFromDirName 을 예시로 선정.

const test = require('node:test');
const assert = require('node:assert/strict');

const utility = require('../../utility/utility.js');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];

test('parseContentInfoFromDirName: & 이전 문자열을 name으로 파싱한다', () =>
{
  const result = utility.parseContentInfoFromDirName('테스트콘텐츠&quiz');

  assert.equal(result.name, '테스트콘텐츠');
});

test('parseContentInfoFromDirName: icon= 파라미터가 없으면 기본 아이콘을 사용한다', () =>
{
  const result = utility.parseContentInfoFromDirName('테스트콘텐츠');

  assert.equal(result.icon, text_contents.icon.ICON_QUIZ_DEFAULT);
  assert.equal(result.is_quiz, false);
});

test('parseContentInfoFromDirName: icon= 파라미터와 &quiz 플래그를 파싱한다', () =>
{
  const result = utility.parseContentInfoFromDirName('콘텐츠&icon=🎵&quiz');

  assert.equal(result.name, '콘텐츠');
  assert.equal(result.icon, '🎵');
  assert.equal(result.is_quiz, true);
});
