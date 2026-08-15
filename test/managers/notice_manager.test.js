'use strict';

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/note-select-ui.ts/note-ui.ts에서
//추출된 순수 함수 테스트. 파일시스템은 t.mock.method로 경계에서 mock 처리(ban_manager.test.js와 동일 관례).
//
//quizmgr 공지 관리(2026-08-15) - 정렬 기준이 파일명 한글로케일 역순에서 파일명 타임스탬프 접두사
//(YYYYMMDDHHmmss_) 기반 최신순으로 바뀌었고, write/update/delete 순수 함수가 추가됨.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { loadNoticeList, readNoticeFile, writeNoticeFile, updateNoticeFile, deleteNoticeFile } = require('../../quizbot/managers/notice_manager');

test('loadNoticeList: 파일명 타임스탬프 접두사 기준 최신순으로 정렬된 목록을 반환한다', async (t) =>
{
  const mtime = new Date('2026-01-01T00:00:00.000Z');
  t.mock.method(fs, 'readdirSync', () => ['20260101000000_가.txt', '20260815143000_나.txt']);
  t.mock.method(fs, 'statSync', () => ({ mtime }));

  const result = await loadNoticeList('/notices');

  assert.deepEqual(result, [
    { name: '나', file_name: '20260815143000_나.txt', mtime, note_path: '/notices/20260815143000_나.txt' },
    { name: '가', file_name: '20260101000000_가.txt', mtime, note_path: '/notices/20260101000000_가.txt' },
  ]);
});

test('loadNoticeList: 접두사가 없는 레거시 파일은 mtime 기준으로 폴백 정렬된다', async (t) =>
{
  const older_mtime = new Date('2023-01-01T00:00:00.000Z');
  const newer_mtime = new Date('2026-08-15T00:00:00.000Z');
  t.mock.method(fs, 'readdirSync', () => ['옛날공지.txt', '최근공지.txt']);
  t.mock.method(fs, 'statSync', (path) => ({ mtime: path.includes('최근공지') ? newer_mtime : older_mtime }));

  const result = await loadNoticeList('/notices');

  assert.deepEqual(result.map((n) => n.name), ['최근공지', '옛날공지']);
});

test('loadNoticeList: 빈 폴더면 빈 배열을 반환한다', async (t) =>
{
  t.mock.method(fs, 'readdirSync', () => []);

  const result = await loadNoticeList('/notices');

  assert.deepEqual(result, []);
});

test('readNoticeFile: 파일 내용/제목(접두사 제거)/수정시각을 반환한다', (t) =>
{
  const mtime = new Date('2026-02-03T00:00:00.000Z');
  t.mock.method(fs, 'readFileSync', () => '공지 본문');
  t.mock.method(fs, 'statSync', () => ({ mtime }));

  const result = readNoticeFile('/notices/20260203000000_공지.txt');

  assert.deepEqual(result, { title: '공지', content: '공지 본문', mtime });
});

test('writeNoticeFile: 타임스탬프 접두사가 붙은 파일명으로 새 공지를 쓴다', (t) =>
{
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));

  const result = writeNoticeFile('/notices', '새 공지', '본문 내용');

  assert.match(result.file_name, /^\d{14}_새 공지\.txt$/);
  assert.equal(result.name, '새 공지');
  assert.equal(result.note_path, `/notices/${result.file_name}`);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].content, '본문 내용');
});

test('writeNoticeFile: 파일시스템 금지 문자를 제거하고 길이를 제한한다', (t) =>
{
  t.mock.method(fs, 'writeFileSync', () => {});

  const result = writeNoticeFile('/notices', 'a/b:c*d?e"f<g>h|i', '본문');

  assert.equal(result.name, 'abcdefghi');
});

test('writeNoticeFile: 제목이 금지 문자로만 이뤄지면 폴백 제목을 쓴다', (t) =>
{
  t.mock.method(fs, 'writeFileSync', () => {});

  const result = writeNoticeFile('/notices', '///', '본문');

  assert.equal(result.name, '제목없음');
});

test('updateNoticeFile: 기존 접두사(작성 순서)를 유지한 채 내용/제목을 수정한다', (t) =>
{
  const writes = [];
  const renames = [];
  t.mock.method(fs, 'writeFileSync', (path, content) => writes.push({ path, content }));
  t.mock.method(fs, 'renameSync', (from, to) => renames.push({ from, to }));

  const result = updateNoticeFile('/notices', '20260101000000_옛제목.txt', '새제목', '새 본문');

  assert.equal(result.file_name, '20260101000000_새제목.txt');
  assert.equal(writes[0].path, '/notices/20260101000000_옛제목.txt');
  assert.equal(writes[0].content, '새 본문');
  assert.deepEqual(renames[0], { from: '/notices/20260101000000_옛제목.txt', to: '/notices/20260101000000_새제목.txt' });
});

test('updateNoticeFile: 접두사가 없는 레거시 파일을 수정하면 새 접두사가 부여된다', (t) =>
{
  t.mock.method(fs, 'writeFileSync', () => {});
  const renames = [];
  t.mock.method(fs, 'renameSync', (from, to) => renames.push({ from, to }));

  const result = updateNoticeFile('/notices', '레거시공지.txt', '레거시공지', '수정된 본문');

  assert.match(result.file_name, /^\d{14}_레거시공지\.txt$/);
  assert.equal(renames.length, 1);
});

test('updateNoticeFile: 제목이 그대로면 파일명을 바꾸지 않는다(rename 호출 안 함)', (t) =>
{
  t.mock.method(fs, 'writeFileSync', () => {});
  let rename_called = false;
  t.mock.method(fs, 'renameSync', () => { rename_called = true; });

  updateNoticeFile('/notices', '20260101000000_제목.txt', '제목', '본문');

  assert.equal(rename_called, false);
});

test('deleteNoticeFile: 지정한 경로의 파일을 삭제한다', (t) =>
{
  const unlinked = [];
  t.mock.method(fs, 'unlinkSync', (path) => unlinked.push(path));

  deleteNoticeFile('/notices/20260101000000_공지.txt');

  assert.deepEqual(unlinked, ['/notices/20260101000000_공지.txt']);
});
