'use strict';

//quizmgr 점검 모드 관리 기능(2026-08-15) - maintenance_mode_manager.ts 순수 함수 테스트.
//파일시스템은 t.mock.method로 경계에서 mock 처리(notice_manager.test.js와 동일 관례).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const {
  isMaintenanceModeOn,
  getMaintenanceNotice,
  enableMaintenanceMode,
  disableMaintenanceMode,
} = require('../../quizbot/managers/maintenance_mode_manager');

test('isMaintenanceModeOn: 파일이 있으면 true를 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);

  assert.equal(isMaintenanceModeOn('/resources/maintenance_notice.txt'), true);
});

test('isMaintenanceModeOn: 파일이 없으면 false를 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => false);

  assert.equal(isMaintenanceModeOn('/resources/maintenance_notice.txt'), false);
});

test('getMaintenanceNotice: 파일이 없으면 빈 문자열을 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => false);

  assert.equal(getMaintenanceNotice('/resources/maintenance_notice.txt'), '');
});

test('getMaintenanceNotice: 파일 내용을 앞뒤 공백 제거해서 반환한다', (t) =>
{
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '  점검 중입니다  \n');

  assert.equal(getMaintenanceNotice('/resources/maintenance_notice.txt'), '점검 중입니다');
});

test('enableMaintenanceMode: 안내 문구를 파일에 쓴다', (t) =>
{
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));

  enableMaintenanceMode('/resources/maintenance_notice.txt', '점검 중입니다');

  assert.deepEqual(writes, [{ path: '/resources/maintenance_notice.txt', content: '점검 중입니다' }]);
});

test('disableMaintenanceMode: 파일을 삭제한다', (t) =>
{
  const unlinked = [];
  t.mock.method(fs, 'unlinkSync', (path) => unlinked.push(path));

  disableMaintenanceMode('/resources/maintenance_notice.txt');

  assert.deepEqual(unlinked, ['/resources/maintenance_notice.txt']);
});
