'use strict';

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/note-select-ui.ts/note-ui.ts에
//있던 공지사항 파일 읽기 로직을 순수 함수로 추출한 모듈. quiz_editor_validation.ts와 동일한 관례
//("부수효과 없는(파일 읽기 정도는 허용) 로직은 managers/에 바로 둔다"). 디스코드 UI가 계속 이
//함수들을 호출하고(동작 변경 없는 순수 이관), 신규 REST 라우트(web_express_app.ts)도 같은 함수를
//재사용한다.

const fs = require('fs');

//note-select-ui.ts의 loadNoteContents와 동일 로직(순수 이관) - 파일명 한글로케일 역순 정렬.
exports.loadNoticeList = async (notices_folder_path: string): Promise<any[]> =>
{
  return fs.readdirSync(notices_folder_path)
    .sort((a: string, b: string) =>
    {
      return b.localeCompare(a, 'ko');
    })
    .map(function(v: string)
    {
      return { name: v.replace('.txt', ''),
        mtime: fs.statSync(`${notices_folder_path}/${v}`).mtime,
        note_path: `${notices_folder_path}/${v}`
      };
    });
};

//note-ui.ts의 initializeEmbed 안에 있던 파일 읽기 로직과 동일(순수 이관).
exports.readNoticeFile = (note_path: string): { title: string, content: string, mtime: Date } =>
{
  const content = fs.readFileSync(note_path, { encoding: 'utf8', flag: 'r' });

  return {
    title: note_path.split('/').pop().replace('.txt', ''),
    content,
    mtime: fs.statSync(note_path).mtime,
  };
};
