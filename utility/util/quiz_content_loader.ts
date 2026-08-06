//utility.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//로컬 퀴즈 디렉터리 로딩/파싱 관련. 세 함수가 서로 this.xxx(...)로 호출하고 있어서
//(원본이 exports.xxx = (...) => {...} 화살표 함수를 module 최상위 this === module.exports를
//이용해 서로 호출하는 방식) 분리 없이 한 파일에 그대로 유지했다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const fs = require('fs');

const { SYSTEM_CONFIG, QUIZ_TYPE } = require('../../config/system_setting.js');
const text_contents = require('../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const logger = require('../logger.js')('Utility');

exports.loadLocalDirectoryQuiz = (contents_path: string, orderby: string = 'none'): any[] =>
{
  logger.info(`Loading local directory quiz... ${contents_path}`);

  let content_list = fs.readdirSync(contents_path);

  let quiz_contents: any[] = [];
  content_list.forEach(content_name =>
  {

    const content_path = `${contents_path}/${content_name}`;

    const stat = fs.lstatSync(content_path);
    if (stat.isDirectory() == false) return; //폴더만 load함

    let quiz_content: any = (this as any).parseContentInfoFromDirName(content_name);
    quiz_content['content_path'] = content_path;
    quiz_content['mtime'] = 0;

    // 하위 컨텐츠 있으면 추가 파싱 진행
    const is_quiz = quiz_content['is_quiz'];

    if (is_quiz == false)
    {
      if (!stat.isFile()) //퀴즈가 아닌데 폴더 타입이면 하위 디렉터리 읽어옴
      {
        const sub_contents = (this as any).loadLocalDirectoryQuiz(content_path, orderby);
        quiz_content['sub_contents'] = sub_contents;
        let latest_mtime = 0;
        sub_contents.forEach(sub_content =>
        {
          if ((sub_content.mtime ?? 0) > latest_mtime)
            latest_mtime = sub_content.mtime ?? 0;
        });
      }
    }
    else
    {
      //퀴즈면 info.txt 읽어옴
      const quiz_file_list = fs.readdirSync(content_path);

      let quiz_size = 0;
      let description = '';
      quiz_file_list.forEach(quiz_file_name =>
      {

        if (quiz_file_name.includes("info.txt") == false)
        {
          quiz_size += 1;
          return;
        }

        //info.txt를 찾았다... 이제 이걸 파싱... 난 왜 이런 방식을 사용했던걸까..?
        const info_txt_path = `${content_path}/${quiz_file_name}`;
        const info_data = fs.readFileSync(info_txt_path, 'utf8');

        info_data.split('\n').forEach((line: string) =>
        {
          if (line.startsWith('&topNickname: ')) //1등 별명
          {
            quiz_content['winner_nickname'] = line.replace('&topNickname: ', "").trim();
            return;
          }

          if (line.startsWith('&typeName: '))
          {
            quiz_content['type_name'] = line.replace('&typeName: ', "").trim();
            return;
          }

          if (line.startsWith("&repeatCnt: ")) //반복 횟수, 우선 이전 코드에 있으니 구현은 해놓는데 실제로 쓰는지는 애매함
          {
            quiz_content['repeat_count'] = line.replace("&repeatCnt: ", "").trim();
            return;
          }

          if (line.startsWith("&quizCount: ")) //퀴즈 수, 우선 이전 코드에 있으니 구현은 해놓는데 실제로 쓰는지는 애매함
          {
            quiz_content['quiz_size'] = line.replace("&quizCount: ", "").trim();
            return;
          }

          if (line.startsWith("&createDate: ")) //명시적 퀴즈 생성일
          {
            const date_string = line.replace("&createDate: ", "").trim();
            quiz_content['mtime'] = new Date(date_string).getTime();
            return;
          }

          description += line + "\n"; //그 외에는 다 설명으로
        }); //한 줄씩 일어오자
      });

      // 퀴즈 수
      if (quiz_content['quiz_size'] == undefined)
        quiz_content['quiz_size'] = quiz_size;

      // Description
      quiz_content['description'] = description;

      //아이콘으로 퀴즈 타입 가져오기... icon 방식을 채택한 예전 자신을 원망하자
      const quiz_icon = quiz_content['icon'];

      quiz_content['quiz_type'] = (this as any).getQuizTypeFromIcon(quiz_icon);

    }

    quiz_contents.push(quiz_content);

  });

  //정렬해서 넘겨준다.
  if (orderby === 'mtime')
  {
    //파일 생성일로 정렬
    const ordered_quiz_contents = quiz_contents
      .sort(function (a, b)
      {
        return b.mtime - a.mtime;
      });

    return ordered_quiz_contents;
  }

  return quiz_contents;
};

exports.getQuizTypeFromIcon = (quiz_icon: string): number =>
{
  if (quiz_icon == text_contents.icon.ICON_TYPE_SONG)
    return QUIZ_TYPE.SONG;

  if (quiz_icon == text_contents.icon.ICON_TYPE_IMAGE)
    return QUIZ_TYPE.IMAGE;

  if (quiz_icon == text_contents.icon.ICON_TYPE_IMAGE_LONG)
    return QUIZ_TYPE.IMAGE_LONG;

  if (quiz_icon == text_contents.icon.ICON_TYPE_OX)
    return QUIZ_TYPE.OX;

  if (quiz_icon == text_contents.icon.ICON_TYPE_INTRO)
    return QUIZ_TYPE.INTRO;

  if (quiz_icon == text_contents.icon.ICON_TYPE_TEXT)
    return QUIZ_TYPE.TEXT;

  if (quiz_icon == text_contents.icon.ICON_TYPE_SCRIPT)
    return QUIZ_TYPE.SCRIPT;

  if (quiz_icon == text_contents.icon.ICON_TYPE_SELECT)
    return QUIZ_TYPE.SELECT;

  if (quiz_icon == text_contents.icon.ICON_TYPE_MULTIPLAY)
    return QUIZ_TYPE.MULTIPLAY;

  return QUIZ_TYPE.SONG; //결국 기본타입은 SONG
};

exports.parseContentInfoFromDirName = (dir_name: string): Record<string, any> =>
{
  let content: Record<string, any> = {};

  content['name'] = dir_name.split("&")[0];

  let icon = dir_name.split("icon="); //ICON 만 파싱
  if (icon.length > 1) //icon= 이 있다면
    content['icon'] = icon[1].split("&")[0];
  else
  {
    content['icon'] = text_contents.icon.ICON_QUIZ_DEFAULT;
  }

  const is_quiz = dir_name.includes("&quiz") ? true : false;
  content['is_quiz'] = is_quiz;

  content['sub_contents'] = undefined;

  return content;
};
