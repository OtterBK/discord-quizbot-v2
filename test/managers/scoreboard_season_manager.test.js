'use strict';

//스코어보드 시즌 관리(quizmgr, 2026-08-15) - scoreboard_season_manager.ts 테스트.
//파일시스템은 t.mock.method로 경계에서 mock 처리(maintenance_mode_manager.test.js와 동일 관례),
//DB는 db_manager.endCurrentSeason을 mock 처리(notice_manager.test.js와 달리 DB 경계가 있는 함수라서).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const db_manager = require('../../quizbot/managers/db_manager');
const {
  getCurrentSeasonName,
  setCurrentSeasonName,
  endSeasonAndStartNew,
} = require('../../quizbot/managers/scoreboard_season_manager');

test('getCurrentSeasonName: 파일이 없으면 빈 문자열을 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => false);

  assert.equal(getCurrentSeasonName('/resources/current_season_name.txt'), '');
});

test('getCurrentSeasonName: 파일 내용을 앞뒤 공백 제거해서 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '  3시즌  \n');

  assert.equal(getCurrentSeasonName('/resources/current_season_name.txt'), '3시즌');
});

test('setCurrentSeasonName: 파일에 이름을 쓴다', (t) =>
{
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));

  setCurrentSeasonName('/resources/current_season_name.txt', '4시즌');

  assert.deepEqual(writes, [{ path: '/resources/current_season_name.txt', content: '4시즌' }]);
});

test('endSeasonAndStartNew: 현재 시즌 이름으로 아카이브하고 성공하면 새 이름을 파일에 저장한다', async (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '3시즌');
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));

  const calls = [];
  t.mock.method(db_manager, 'endCurrentSeason', async (season_name) =>
  {
    calls.push(season_name);
    return { season_id: 3, season_name: '3시즌' };
  });

  const result = await endSeasonAndStartNew('/resources/current_season_name.txt', '4시즌');

  assert.deepEqual(calls, ['3시즌']);
  assert.deepEqual(result, { season_id: 3, season_name: '3시즌' });
  assert.deepEqual(writes, [{ path: '/resources/current_season_name.txt', content: '4시즌' }]);
});

test('endSeasonAndStartNew: 아카이브가 실패하면 undefined를 반환하고 파일은 건드리지 않는다', async (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '3시즌');
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));

  t.mock.method(db_manager, 'endCurrentSeason', async () => undefined);

  const result = await endSeasonAndStartNew('/resources/current_season_name.txt', '4시즌');

  assert.equal(result, undefined);
  assert.deepEqual(writes, []);
});
