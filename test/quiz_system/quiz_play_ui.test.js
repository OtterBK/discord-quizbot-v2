'use strict';

//quiz_system.js에서 분리된 QuizPlayUI(REFACTOR_PLAN.md Phase 2 세 번째 슬라이스)에 대한
//최소 회귀 테스트. 실제 discord.js 채널/메시지 전송은 만들지 않고 필요한 메서드만
//흉내 낸 가짜 채널로 대체한다 (REFACTOR_PLAN.md 2.4).

const test = require('node:test');
const assert = require('node:assert/strict');

const QuizPlayUI = require('../../quizbot/quiz_system/quiz_play_ui.js');

test('생성 시 기본 embed와 버튼 컴포넌트를 준비한다', () =>
{
  const fake_channel = { id: 'channel_1' };
  const ui = new QuizPlayUI(fake_channel);

  assert.equal(ui.channel, fake_channel);
  assert.equal(ui.embed.title, '초기화 중입니다.');
  assert.equal(ui.quiz_play_comp.components.length, 3); // 힌트/스킵/그만하기
  assert.equal(ui.ox_quiz_comp.components.length, 2); // O/X
  assert.equal(ui.multiple_quiz_comp.components.length, 5); // 1~5번
});

test('setImage: 유효한 URL이면 그대로, 아니면 빈 문자열로 embed 이미지를 설정한다', () =>
{
  const ui = new QuizPlayUI({ id: 'channel_1' });

  ui.setImage('https://example.com/image.png');
  assert.equal(ui.embed.image.url, 'https://example.com/image.png');

  ui.setImage('이거는-url이-아님');
  assert.equal(ui.embed.image.url, '');

  ui.setImage(undefined);
  assert.equal(ui.embed.image.url, '');
});

test('setTitle/setButtonStatus: embed 제목과 버튼 활성/비활성 상태를 바꾼다', () =>
{
  const ui = new QuizPlayUI({ id: 'channel_1' });

  ui.setTitle('테스트 제목');
  assert.equal(ui.embed.title, '테스트 제목');

  ui.setButtonStatus(0, false); // 힌트 버튼 비활성화
  assert.equal(ui.quiz_play_comp.components[0].data.disabled, true);

  ui.setButtonStatus(0, true); // 다시 활성화
  assert.equal(ui.quiz_play_comp.components[0].data.disabled, false);
});

test('send: 채널 전송 성공 시 ui_instance를 기억한다', async () =>
{
  const ui = new QuizPlayUI({
    id: 'channel_1',
    send: async () => ({ id: 'message_1' }),
  });

  await ui.send(false);

  assert.equal(ui.ui_instance.id, 'message_1');
});

test('delete: ui_instance가 없으면 아무 것도 하지 않는다', async () =>
{
  const ui = new QuizPlayUI({ id: 'channel_1' });

  await assert.doesNotReject(ui.delete());
});
