'use strict';

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/note-select-ui.ts/note-ui.ts에서
//추출된 순수 함수 테스트. 파일시스템은 t.mock.method로 경계에서 mock 처리(ban_manager.test.js와 동일 관례).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { loadNoticeList, readNoticeFile } = require('../../quizbot/managers/notice_manager');

test('loadNoticeList: 파일명 한글로케일 역순으로 정렬된 목록을 반환한다', async (t) =>
{
  const mtime = new Date('2026-01-01T00:00:00.000Z');
  t.mock.method(fs, 'readdirSync', () => ['가.txt', '나.txt']);
  t.mock.method(fs, 'statSync', () => ({ mtime }));

  const result = await loadNoticeList('/notices');

  assert.deepEqual(result, [
    { name: '나', mtime, note_path: '/notices/나.txt' },
    { name: '가', mtime, note_path: '/notices/가.txt' },
  ]);
});

test('loadNoticeList: 빈 폴더면 빈 배열을 반환한다', async (t) =>
{
  t.mock.method(fs, 'readdirSync', () => []);

  const result = await loadNoticeList('/notices');

  assert.deepEqual(result, []);
});

test('readNoticeFile: 파일 내용/제목/수정시각을 반환한다', (t) =>
{
  const mtime = new Date('2026-02-03T00:00:00.000Z');
  t.mock.method(fs, 'readFileSync', () => '공지 본문');
  t.mock.method(fs, 'statSync', () => ({ mtime }));

  const result = readNoticeFile('/notices/공지.txt');

  assert.deepEqual(result, { title: '공지', content: '공지 본문', mtime });
});
