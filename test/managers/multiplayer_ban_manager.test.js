'use strict';

//multiplayer-quiz-select-ui.js의 checkMultiplayerBan(개발자 TODO: "나중에 시간마다
//조회하는 방식으로 변경할 것")과 report/report_manual_processing.js의 applyGuildBan이
//각각 독립적으로 BANNED_USER_PATH를 동기 읽기하던 것을, 메모리 캐싱 + 주기 재조회로
//바꾼 multiplayer_ban_manager.js에 대한 테스트. 실제 파일시스템은 mock 처리해
//resources/banned_user.txt를 건드리지 않는다 (REFACTOR_PLAN.md 2.4 원칙과 동일하게 적용).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const multiplayer_ban_manager = require('../../quizbot/managers/multiplayer_ban_manager.js');

test('initialize: 파일이 없으면 빈 파일을 만들고, 있으면 줄 단위로 파싱해 캐싱한다', (t) =>
{
  let written_path = undefined;
  t.mock.method(fs, 'existsSync', () => false);
  t.mock.method(fs, 'writeFileSync', (path) => { written_path = path; });
  t.mock.method(fs, 'readFileSync', () => 'guild_1\nguild_2\n\nguild_3');

  multiplayer_ban_manager.initialize();

  assert.ok(written_path !== undefined); //없으면 새로 만듦
  assert.equal(multiplayer_ban_manager.isBanned(['guild_1']), true);
  assert.equal(multiplayer_ban_manager.isBanned(['guild_3']), true);
  assert.equal(multiplayer_ban_manager.isBanned(['guild_없음']), false);
});

test('isBanned: id 목록 중 하나라도 밴 목록에 있으면 true (길드/유저 id 구분 없이 검사)', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'banned_guild\nbanned_user\n');

  multiplayer_ban_manager.initialize();

  assert.equal(multiplayer_ban_manager.isBanned(['normal_guild', 'banned_user']), true);
  assert.equal(multiplayer_ban_manager.isBanned(['normal_guild', 'normal_user']), false);
});

test('banGuild: 새 길드를 밴하면 파일에 append하고 캐시에도 즉시 반영해 재조회 주기를 기다리지 않는다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '');

  multiplayer_ban_manager.initialize(); //빈 목록으로 초기화

  let appended_content = undefined;
  t.mock.method(fs, 'appendFileSync', (path, content) => { appended_content = content; });

  const result = multiplayer_ban_manager.banGuild('new_guild');

  assert.equal(result, true);
  assert.match(appended_content, /^new_guild\n$/);
  assert.equal(multiplayer_ban_manager.isBanned(['new_guild']), true); //파일 재조회 없이 즉시 반영됨
});

test('banGuild: 이미 밴된 길드면 파일에 다시 쓰지 않고 false를 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'already_banned\n');

  multiplayer_ban_manager.initialize();

  let append_called = false;
  t.mock.method(fs, 'appendFileSync', () => { append_called = true; });

  const result = multiplayer_ban_manager.banGuild('already_banned');

  assert.equal(result, false);
  assert.equal(append_called, false);
});
