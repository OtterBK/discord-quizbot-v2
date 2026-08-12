'use strict';

//2026-08-12(UI 개선 2라운드 B-4 [P2], "기본값으로 초기화" 신설)로 quiz_option.js에 추가된
//getDefaultQuizOption()에 대한 회귀 테스트. 서버 설정 화면(server-setting-ui.ts)의 초기화 버튼이
//이 값을 그대로 신뢰하고 쓰므로, OptionStorage 생성자의 초기값과 항상 같은 shape을 유지해야 한다.

const test = require('node:test');
const assert = require('node:assert/strict');

const quiz_option = require('../../quizbot/quiz_option/quiz_option.js');

test('getDefaultQuizOption: OptionStorage 생성자의 초기값과 동일한 기본 옵션을 반환한다', () =>
{
  const default_option = quiz_option.getDefaultQuizOption();

  assert.deepEqual(default_option, {
    audio_play_time: 30000,
    hint_type: quiz_option.OPTION_TYPE.HINT_TYPE.VOTE,
    skip_type: quiz_option.OPTION_TYPE.SKIP_TYPE.VOTE,
    use_similar_answer: quiz_option.OPTION_TYPE.ENABLED,
    score_type: quiz_option.OPTION_TYPE.SCORE_TYPE.POINT,
    improved_audio_cut: quiz_option.OPTION_TYPE.ENABLED,
    use_message_intent: quiz_option.OPTION_TYPE.ENABLED,
    score_show_max: quiz_option.OPTION_TYPE.UNLIMITED,
    max_chance: quiz_option.OPTION_TYPE.UNLIMITED,
  });
});

test('getDefaultQuizOption: 반환값을 수정해도 다음 호출 결과에 영향을 주지 않는다(매번 새 객체)', () =>
{
  const first = quiz_option.getDefaultQuizOption();
  first.audio_play_time = 999;

  const second = quiz_option.getDefaultQuizOption();

  assert.equal(second.audio_play_time, 30000);
});
