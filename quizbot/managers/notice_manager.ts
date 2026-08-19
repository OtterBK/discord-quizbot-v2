'use strict';

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/note-select-ui.ts/note-ui.ts에
//있던 공지사항 파일 읽기 로직을 순수 함수로 추출한 모듈. quiz_editor_validation.ts와 동일 관례
//("부수효과 없는(파일 읽기 정도는 허용) 로직은 managers/에 바로 둔다"). 디스코드 UI가 계속 이
//함수들을 호출하고(동작 변경 없는 순수 이관), 신규 REST 라우트(web_express_app.ts)도 같은 함수를
//재사용한다.
//
//quizmgr 공지 관리 기능(2026-08-15) 신설 - 파일명 앞에 14자리 타임스탬프(YYYYMMDDHHmmss_)를 붙여
//작성 순서를 파일명만으로 안정적으로 보장한다(기존엔 파일명 한글로케일 역순이라 제목에 따라 순서가
//뒤바뀔 수 있었음, mtime은 서버 배포 시 git reset --hard로 깨질 수 있어 채택 안 함). 접두사가 없는
//레거시 파일은 mtime으로 폴백 정렬되고, 수정(updateNoticeFile)을 거치면 접두사가 부여된다.

const fs = require('fs');
const logger = require('../../utility/logger.js')('NoticeManager');

const NOTICE_TIMESTAMP_PREFIX_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/;
const NOTICE_FILENAME_FORBIDDEN_CHARS_RE = /[\\/:*?"<>|]/g;
const NOTICE_TITLE_MAX_LENGTH = 60;

function pad2(n: number): string
{
  return String(n).padStart(2, '0');
}

//YYYYMMDDHHmmss 형태의 접두사 문자열 생성(로컬 타임 기준 - 파싱도 로컬 타임으로 하므로 왕복 일관성만 있으면 됨)
function formatNoticeTimestampPrefix(date: Date): string
{
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

//파일명 접두사를 실제 epoch ms로 변환(단순 문자열/숫자 비교는 접두사와 mtime의 자릿수가 달라
//폴백 대상(레거시 파일)과 크기 비교가 안 맞을 수 있어 반드시 Date로 변환해서 비교해야 함)
function parseNoticeTimestampPrefix(filename: string): number | null
{
  const match = filename.match(NOTICE_TIMESTAMP_PREFIX_RE);
  if(match === null)
  {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
}

function extractNoticeTitle(filename: string): string
{
  return filename.replace(/\.txt$/, '').replace(NOTICE_TIMESTAMP_PREFIX_RE, '');
}

function getNoticeSortKey(filename: string, mtime: Date): number
{
  const prefix_time = parseNoticeTimestampPrefix(filename);
  return prefix_time !== null ? prefix_time : mtime.getTime();
}

//파일시스템에 쓸 수 없는 문자 제거 + 길이 제한. 결과가 빈 문자열이면(특수문자로만 이뤄진 제목 등) 폴백.
function sanitizeNoticeTitle(title: string): string
{
  const cleaned = title.replace(NOTICE_FILENAME_FORBIDDEN_CHARS_RE, '').trim().slice(0, NOTICE_TITLE_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : '제목없음';
}

//note-select-ui.ts의 loadNoteContents와 동일 로직에서 출발 - 이제 파일명 타임스탬프 접두사(최신순) 기준 정렬.
exports.loadNoticeList = async (notices_folder_path: string): Promise<any[]> =>
{
  return fs.readdirSync(notices_folder_path)
    .map(function(v: string)
    {
      return {
        name: extractNoticeTitle(v),
        file_name: v,
        mtime: fs.statSync(`${notices_folder_path}/${v}`).mtime,
        note_path: `${notices_folder_path}/${v}`,
      };
    })
    .sort((a: any, b: any) => getNoticeSortKey(b.file_name, b.mtime) - getNoticeSortKey(a.file_name, a.mtime));
};

//note-ui.ts의 initializeEmbed 안에 있던 파일 읽기 로직과 동일(순수 이관).
exports.readNoticeFile = (note_path: string): { title: string, content: string, mtime: Date } =>
{
  const content = fs.readFileSync(note_path, { encoding: 'utf8', flag: 'r' });

  return {
    title: extractNoticeTitle(note_path.split('/').pop()),
    content,
    mtime: fs.statSync(note_path).mtime,
  };
};

//quizmgr 공지 작성(2026-08-15 신설) - 파일명에 현재 시각 접두사를 붙여 새로 만든다.
//actor(2026-08-19 로깅 감사로 추가, 선택값) - 호출부(admin-notice-list-ui.ts 등)가 interaction.user
//기준으로 넘겨주는 "누가 했는지" 표시 문자열. 관리자 전용 기능이지만 운영 중 무슨 변경이 있었는지
//로그로 추적 가능해야 한다는 피드백 - 이 파일의 다른 쓰기 함수들도 동일 관례.
exports.writeNoticeFile = (notices_folder_path: string, title: string, content: string, actor?: string): { name: string, file_name: string, note_path: string } =>
{
  const safe_title = sanitizeNoticeTitle(title);
  const file_name = `${formatNoticeTimestampPrefix(new Date())}_${safe_title}.txt`;
  const note_path = `${notices_folder_path}/${file_name}`;

  fs.writeFileSync(note_path, content, { encoding: 'utf8' });
  logger.info(`공지 작성: "${safe_title}" (${file_name})${actor ? ` by ${actor}` : ''}`);

  return { name: safe_title, file_name, note_path };
};

//quizmgr 공지 수정(2026-08-15 신설) - 내용을 덮어쓰고, 제목이 바뀌면 기존 접두사(작성 순서)는
//유지한 채 파일명만 새로 짓는다. 접두사가 없던 레거시 파일을 수정하면 이번에 접두사가 새로 부여됨.
exports.updateNoticeFile = (notices_folder_path: string, old_file_name: string, title: string, content: string, actor?: string): { name: string, file_name: string, note_path: string } =>
{
  const safe_title = sanitizeNoticeTitle(title);
  const existing_prefix_match = old_file_name.match(NOTICE_TIMESTAMP_PREFIX_RE);
  const prefix = existing_prefix_match !== null ? existing_prefix_match[0] : `${formatNoticeTimestampPrefix(new Date())}_`;

  const new_file_name = `${prefix}${safe_title}.txt`;
  const old_path = `${notices_folder_path}/${old_file_name}`;
  const new_path = `${notices_folder_path}/${new_file_name}`;

  fs.writeFileSync(old_path, content, { encoding: 'utf8' });
  if(new_path !== old_path)
  {
    fs.renameSync(old_path, new_path);
  }

  logger.info(`공지 수정: "${safe_title}" (${old_file_name} → ${new_file_name})${actor ? ` by ${actor}` : ''}`);

  return { name: safe_title, file_name: new_file_name, note_path: new_path };
};

//quizmgr 공지 삭제(2026-08-15 신설)
exports.deleteNoticeFile = (note_path: string, actor?: string): void =>
{
  fs.unlinkSync(note_path);
  logger.info(`공지 삭제: ${note_path}${actor ? ` by ${actor}` : ''}`);
};

//실시간 공지(resources/current_notice.txt, /퀴즈 최초 진입 화면(select-ui-mode-ui.ts)에서만 노출) -
//위 공지 게시판(notices/)과는 완전히 별개인 단일 파일. 기존엔 서버 파일을 직접 편집하는 방식뿐이었음 -
//quizmgr 관리자 패널(admin-panel-ui.ts)에서 읽기/쓰기 가능하도록 순수 함수로 추출(2026-08-15 신설).
exports.readCurrentNotice = (current_notice_path: string): string =>
{
  if(fs.existsSync(current_notice_path) === false)
  {
    return '';
  }

  return fs.readFileSync(current_notice_path, { encoding: 'utf8', flag: 'r' }).trim();
};

exports.writeCurrentNotice = (current_notice_path: string, content: string, actor?: string): void =>
{
  fs.writeFileSync(current_notice_path, content, { encoding: 'utf8' });
  logger.info(`실시간 공지 수정${actor ? ` by ${actor}` : ''}`);
};
