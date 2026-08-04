'use strict';

//multiplayer-quiz-select-ui.js의 checkMultiplayerBan(개발자 TODO: "나중에 시간마다
//조회하는 방식으로 변경할 것")과 report/report_manual_processing.js의 applyGuildBan,
//bot.js의 create_quiz_handler가 각각 독립적으로 BANNED_USER_PATH를 동기 읽기하던 것을,
//메모리 캐싱 + 주기 재조회로 바꾼 ban_manager.js에 대한 테스트. 실제 파일시스템은
//mock 처리해 resources/banned_user.txt를 건드리지 않는다
//(REFACTOR_PLAN.md 2.4 원칙과 동일하게 적용).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const ban_manager = require('../../quizbot/managers/ban_manager.js');

test('initialize: 파일이 없으면 빈 파일을 만들고, 있으면 줄 단위로 파싱해 캐싱한다', (t) =>
{
  let written_path = undefined;
  t.mock.method(fs, 'existsSync', () => false);
  t.mock.method(fs, 'writeFileSync', (path) => { written_path = path; });
  t.mock.method(fs, 'readFileSync', () => 'guild_1\nguild_2\n\nguild_3');

  ban_manager.initialize();

  assert.ok(written_path !== undefined); //없으면 새로 만듦
  assert.equal(ban_manager.isBanned(['guild_1']), true);
  assert.equal(ban_manager.isBanned(['guild_3']), true);
  assert.equal(ban_manager.isBanned(['guild_없음']), false);
});

test('isBanned: id 목록 중 하나라도 밴 목록에 있으면 true (길드/유저 id 구분 없이 검사)', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'banned_guild\nbanned_user\n');

  ban_manager.initialize();

  assert.equal(ban_manager.isBanned(['normal_guild', 'banned_user']), true);
  assert.equal(ban_manager.isBanned(['normal_guild', 'normal_user']), false);
});

test('banId: 새 id를 밴하면 파일에 append하고 캐시에도 즉시 반영해 재조회 주기를 기다리지 않는다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '');

  ban_manager.initialize(); //빈 목록으로 초기화

  let appended_content = undefined;
  t.mock.method(fs, 'appendFileSync', (path, content) => { appended_content = content; });

  const result = ban_manager.banId('new_guild');

  assert.equal(result, true);
  assert.match(appended_content, /^new_guild\n$/);
  assert.equal(ban_manager.isBanned(['new_guild']), true); //파일 재조회 없이 즉시 반영됨
});

test('banId: 이미 밴된 id면 파일에 다시 쓰지 않고 false를 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'already_banned\n');

  ban_manager.initialize();

  let append_called = false;
  t.mock.method(fs, 'appendFileSync', () => { append_called = true; });

  const result = ban_manager.banId('already_banned');

  assert.equal(result, false);
  assert.equal(append_called, false);
});

test('getBannedIdList: 현재 캐시된 밴 목록을 배열로 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'guild_1\nuser_2\n');

  ban_manager.initialize();

  assert.deepEqual(ban_manager.getBannedIdList().sort(), ['guild_1', 'user_2']);
});

test('unbanId: 밴된 id를 해제하면 캐시에서 즉시 제거되고 파일 전체를 다시 쓴다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'guild_1\nguild_2\nguild_3\n');

  ban_manager.initialize();

  let written_content = undefined;
  t.mock.method(fs, 'writeFileSync', (path, content) => { written_content = content; });

  const result = ban_manager.unbanId('guild_2');

  assert.equal(result, true);
  assert.equal(ban_manager.isBanned(['guild_2']), false); //캐시에서 즉시 반영
  assert.equal(ban_manager.isBanned(['guild_1']), true); //나머지는 그대로
  assert.doesNotMatch(written_content, /guild_2/); //재작성된 파일 내용에도 없어야 함
});

test('unbanId: 밴돼있지 않은 id면 아무것도 쓰지 않고 false를 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'guild_1\n');

  ban_manager.initialize();

  let write_called = false;
  t.mock.method(fs, 'writeFileSync', () => { write_called = true; });

  const result = ban_manager.unbanId('never_banned');

  assert.equal(result, false);
  assert.equal(write_called, false);
});
