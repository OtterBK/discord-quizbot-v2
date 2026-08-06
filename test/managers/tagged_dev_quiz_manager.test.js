'use strict';

//fs(파일시스템)를 경계에서 mock 처리해 실제 디스크에 의존하지 않고
//initialize()의 파싱/집계 로직과 getQuestionListByTags/getQuestionAmountByTags의
//비트마스크 태그 매칭 로직을 검증한다 (REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { DEV_QUIZ_TAG } = require('../../config/system_setting.js');
const tagged_dev_quiz_manager = require('../../quizbot/managers/tagged_dev_quiz_manager');

const ANIME_TAG = DEV_QUIZ_TAG['애니']; // 16
const GAME_TAG = DEV_QUIZ_TAG['게임']; // 32

//tagged_quiz_info(JSON)의 각 콘텐츠 디렉터리 안에 문제 디렉터리 2개씩 있다고 가정하고
//fs 관련 함수들을 mock 처리한다.
function mockFsForTaggedQuizInfo(t, tagged_quiz_info)
{
  t.mock.method(fs, 'readFileSync', () => JSON.stringify(tagged_quiz_info));
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'lstatSync', () => ({ isDirectory: () => true }));
  t.mock.method(fs, 'readdirSync', () => [
    { name: 'question_1', isDirectory: () => true },
    { name: 'question_2', isDirectory: () => true },
  ]);
}

test('initialize + getQuestionListByTags: 요청한 태그의 문제만 모두 반환한다 (limit 미지정)', (t) =>
{
  mockFsForTaggedQuizInfo(t, {
    '애니': ['anime_dir_1', 'anime_dir_2'], //콘텐츠 2개 * 문제 2개 = 4개
    '게임': ['game_dir_1'],
  });

  tagged_dev_quiz_manager.initialize('fake_path.json');

  const [total_count, question_list] = tagged_dev_quiz_manager.getQuestionListByTags(ANIME_TAG);

  assert.equal(total_count, 4);
  assert.equal(question_list.length, 4);
  assert.ok(question_list.every(question => question.tag === '애니'));
});

test('getQuestionListByTags: tags_value가 0이면 빈 목록을 반환한다', (t) =>
{
  mockFsForTaggedQuizInfo(t, { '애니': ['anime_dir_1'] });
  tagged_dev_quiz_manager.initialize('fake_path.json');

  const result = tagged_dev_quiz_manager.getQuestionListByTags(0);

  assert.deepEqual(result, [0, []]);
});

test('getQuestionListByTags: limit을 지정하면 목록은 잘리지만 전체 개수는 그대로 알려준다', (t) =>
{
  mockFsForTaggedQuizInfo(t, { '애니': ['anime_dir_1', 'anime_dir_2'] }); //문제 4개

  tagged_dev_quiz_manager.initialize('fake_path.json');

  const [total_count, question_list] = tagged_dev_quiz_manager.getQuestionListByTags(ANIME_TAG, 2);

  assert.equal(total_count, 4);
  assert.equal(question_list.length, 2);
});

test('getQuestionListByTags: limit이 기본값(0)이어도 항상 [count, list] 튜플을 반환한다 (회귀 방지, BUGS_FOUND.md 참고)', (t) =>
{
  mockFsForTaggedQuizInfo(t, { '애니': ['anime_dir_1'] }); //문제 2개

  tagged_dev_quiz_manager.initialize('fake_path.json');

  const result = tagged_dev_quiz_manager.getQuestionListByTags(ANIME_TAG); //limit 기본값 0

  assert.ok(Array.isArray(result));
  assert.equal(result.length, 2);
  assert.equal(result[0], 2); //total_question_count
  assert.ok(Array.isArray(result[1])); //question_list
});

test('getQuestionAmountByTags: 요청한 태그(들)에 해당하는 문제 개수만 합산한다', (t) =>
{
  mockFsForTaggedQuizInfo(t, {
    '애니': ['anime_dir_1'], //문제 2개
    '게임': ['game_dir_1', 'game_dir_2'], //문제 4개
  });

  tagged_dev_quiz_manager.initialize('fake_path.json');

  assert.equal(tagged_dev_quiz_manager.getQuestionAmountByTags(ANIME_TAG), 2);
  assert.equal(tagged_dev_quiz_manager.getQuestionAmountByTags(GAME_TAG), 4);
  assert.equal(tagged_dev_quiz_manager.getQuestionAmountByTags(ANIME_TAG | GAME_TAG), 6);
});
