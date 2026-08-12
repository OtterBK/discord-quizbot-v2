//외부 modules


//로컬 modules
const db_manager = require('./db_manager.js');
const logger = require('../../utility/logger.js')('UserQuizInfoManager');

//만약 fields 추가 및 수정되면 여기에 그냥 넣으면 된다
const QuizInfoColumn =
[
  "creator_id",
  "creator_name",
  "creator_icon_url",
  "quiz_title",
  "thumbnail",
  "simple_description",
  "description",
  "winner_nickname",
  "birthtime",
  "modified_time",
  "played_count",
  "is_private",
  "played_count_of_week",
  "tags_value",
  "certified",
  "like_count",
];

let quiz_info_key_fields = '';
QuizInfoColumn.forEach((field) =>
{
  if(quiz_info_key_fields != '')
  {
    quiz_info_key_fields += ', ';
  }
  quiz_info_key_fields += `${field}`;
});

//만약 fields 추가 및 수정되면 여기에 그냥 넣으면 된다
const QuestionInfoColumn =
[
  "quiz_id",
  "question_audio_url",
  "answers",
  "hint",
  "audio_start",
  "audio_end",
  "audio_play_time",
  "question_image_url",
  "question_text",
  "answer_audio_url",
  "answer_image_url",
  "answer_text",
  "use_answer_timer",
  "audio_range_row",
  "answer_audio_start",
  "answer_audio_end",
  "answer_audio_play_time",
  "answer_audio_range_row",
  "hint_image_url",
  "answer_type",
  "question_audio_repeat",
];

let question_info_key_fields = '';
QuestionInfoColumn.forEach((field) =>
{
  if(question_info_key_fields != '')
  {
    question_info_key_fields += ', ';
  }
  question_info_key_fields += `${field}`;
});


//만약 fields 추가 및 수정되면 여기에 그냥 넣으면 된다
class UserQuizInfo //유저 제작 퀴즈 정보
{
  //UI 쪽에서 목록 표시용으로 quiz_info.name = ... 처럼 임의 프로퍼티를 얹는 관행이 있어
  //(user-quiz-list-ui.js/user-quiz-select-ui.js) common-ui.ts의 QuizbotUI와 같은 패턴으로 인덱스 시그니처를 둔다.
  [key: string]: any;

  data: Record<string, any>;
  quiz_id: any;
  question_list: UserQuestionInfo[];

  constructor()
  {
    this.data = {};

    for(const column of QuizInfoColumn)
    {
      this.data[column] = undefined;
    }

    this.quiz_id = undefined;

    //DB 추가 로드해야지만 알 수 있는 정보
    this.question_list = []; //UserQuestionInfo 타입
  }

  async saveDataToDB(): Promise<any>
  {
    const quiz_info_value_fields = Object.values(this.data);

    let result = undefined;
    //quiz info DB에 저장
    if(this.quiz_id == undefined)
    {
      result = await db_manager.insertQuizInfo(quiz_info_key_fields, quiz_info_value_fields);
    }
    else
    {
      result = await db_manager.updateQuizInfo(quiz_info_key_fields, quiz_info_value_fields, this.quiz_id);
    }

    if(result != undefined && result.rows.length != 0)
    {
      this.quiz_id = result.rows[0].quiz_id;
      return this.quiz_id;
    }

    return undefined;
  }

  async delete(): Promise<void> //퀴즈 삭제는 정말 삭제하기 보다는 is_use를 false로
  {
    db_manager.disableQuizInfo(this.quiz_id);
  }

  async loadQuestionListFromDB(): Promise<void> //quiz 객체에서 question 목록 로드 가능
  {
    const question_list: UserQuestionInfo[] = [];

    const result = await db_manager.selectQuestionInfo([this.quiz_id]);

    for(const result_row of result.rows)
    {
      const user_question_info = new UserQuestionInfo();

      user_question_info.question_id = result_row.question_id;

      if(user_question_info.question_id == undefined) // quiz id는 없을 수 없다.
      {
        logger.error(`User Question Info ID is undefined... pass this`);
        continue;
      }

      for(const column of QuestionInfoColumn)
      {
        user_question_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
      }

      question_list.push(user_question_info);
    }

    this.question_list = question_list;
  }

  async saveQuestionToDB(): Promise<void>
  {
    //quiz question 전체 db에 저장
    for(const question of this.question_list)
    {
      question.saveDataToDB();
    }
  }

  async addPlayedCount(): Promise<void>
  {
    db_manager.addQuizInfoPlayedCount(this.quiz_id);
  }

  async updateModifiedTime(): Promise<void>
  {
    db_manager.updateQuizInfoModifiedTime(this.quiz_id);
  }
}

class UserQuestionInfo //유저 제작 문제 정보
{
  data: Record<string, any>;
  question_id: any;

  constructor()
  {
    this.data = {};

    for(const column of QuestionInfoColumn)
    {
      this.data[column] = undefined;
    }

    this.question_id == undefined;

  }

  async saveDataToDB(): Promise<any>
  {
    const question_info_value_fields = Object.values(this.data);

    let result = undefined;
    //quiz info DB에 저장
    if(this.question_id == undefined)
    {
      result = await db_manager.insertQuestionInfo(question_info_key_fields, question_info_value_fields);
    }
    else
    {
      result = await db_manager.updateQuestionInfo(question_info_key_fields, question_info_value_fields, this.question_id);
    }

    if(result != undefined && result.rows.length != 0)
    {
      this.question_id = result.rows[0].question_id;
      return this.question_id;
    }

    return undefined;
  }

  async delete(): Promise<void>
  {
    db_manager.deleteQuestionInfo(this.question_id);
  }
}

const loadUserQuizListFromDB = async (creator_id?: string): Promise<UserQuizInfo[]> =>
{ //creator_id 기준으로 quiz 목록 로드, creator_id가 undefined면 전체 조회

  const user_quiz_list: UserQuizInfo[] = [];

  let result;

  if(creator_id == undefined)
  {
    result = await db_manager.selectAllQuizInfo();
  }
  else
  {
    result = await db_manager.selectQuizInfo(creator_id);
  }

  if(result == undefined)
  {
    return [];
  }

  for(const result_row of result.rows)
  {
    const user_quiz_info = new UserQuizInfo();

    user_quiz_info.quiz_id = result_row.quiz_id;

    if(user_quiz_info.quiz_id == undefined) // quiz id는 없을 수 없다.
    {
      logger.error(`User Quiz Info ID is undefined... pass this`);
      continue;
    }

    for(const column of QuizInfoColumn)
    {
      user_quiz_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
    }

    user_quiz_list.push(user_quiz_info);
  }

  return user_quiz_list;
};

//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Phase 2 - quiz_id 단건 조회. 웹에서 선택한 quiz_id로
//UserQuizInfo를 재조립할 때 씀(question_list는 아직 안 채움 - 기존 관행대로 UserQuizInfoUI.onReady()에서
//loadQuestionListFromDB()로 나중에 채움).
const loadUserQuizInfoById = async (quiz_id: any): Promise<UserQuizInfo | undefined> =>
{
  const result = await db_manager.selectQuizInfoById(quiz_id);

  if(result == undefined || result.rows.length === 0)
  {
    return undefined;
  }

  const result_row = result.rows[0];
  const user_quiz_info = new UserQuizInfo();

  user_quiz_info.quiz_id = result_row.quiz_id;

  for(const column of QuizInfoColumn)
  {
    user_quiz_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
  }

  return user_quiz_info;
};

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - loadUserQuizInfoById와 동일 패턴이되
//소유권 검증이 DB 레벨에서 강제된 selectOwnedQuizInfoById를 쓴다(is_private 필터 없음 - 본인 비공개
//퀴즈도 편집할 수 있어야 함). question_list는 기존 관행대로 비워둠(호출부가 필요할 때 별도로 채움).
const loadOwnedUserQuizInfoById = async (quiz_id: any, creator_id: string): Promise<UserQuizInfo | undefined> =>
{
  const result = await db_manager.selectOwnedQuizInfoById(quiz_id, creator_id);

  if(result == undefined || result.rows.length === 0)
  {
    return undefined;
  }

  const result_row = result.rows[0];
  const user_quiz_info = new UserQuizInfo();

  user_quiz_info.quiz_id = result_row.quiz_id;

  for(const column of QuizInfoColumn)
  {
    user_quiz_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
  }

  return user_quiz_info;
};

const loadQuestionListFromDBByTags = async (quiz_type_tags_value: number, tag_value: number, limit: number, certified_filter = true): Promise<[number, UserQuestionInfo[]]> =>
{ //tag로 문제 목록 가져오기. 이야 이거 비용 좀 비쌀듯

  if(quiz_type_tags_value == 0) //퀴즈 유형을 선택하지 않았다면
  {
    return [0, []];
  }

  const additionalColumn = [
    'quiz_title',
    'tags_value',
    'creator_name',
    'creator_icon_url',
    'simple_description'
  ];
  const question_list: UserQuestionInfo[] = [];

  const result = await db_manager.selectRandomQuestionListByTags(quiz_type_tags_value, tag_value, limit, certified_filter);

  for(const result_row of result.rows)
  {
    const user_question_info = new UserQuestionInfo();

    user_question_info.question_id = result_row.question_id;

    if(user_question_info.question_id == undefined) // quiz id는 없을 수 없다.
    {
      logger.error(`User Question Info ID is undefined... pass this`);
      continue;
    }

    for(const column of QuestionInfoColumn)
    {
      user_question_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
    }

    for(const column of additionalColumn)
    {
      user_question_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
    }

    question_list.push(user_question_info);
  }

  let total_question_count = 0;
  if(result.rows.length > 0)
  {
    total_question_count = parseInt(result.rows[0]['total_count']); //그냥 맨 윗꺼 가져오자
  }

  return [total_question_count, question_list];
};

const loadQuestionListByBasket = async (quiz_id_list: number[], limit: number): Promise<[number, UserQuestionInfo[]]> =>
{ //quiz_id 로 랜덤 문제 불러오기

  if(quiz_id_list.length === 0) //선택된 퀴즈 basket이 없다면
  {
    return [0, []];
  }

  const additionalColumn = [
    'quiz_title',
    'tags_value',
    'creator_name',
    'creator_icon_url',
    'simple_description'
  ];
  const question_list: UserQuestionInfo[] = [];

  const result = await db_manager.selectRandomQuestionListByBasket(quiz_id_list, limit);

  for(const result_row of result.rows)
  {
    const user_question_info = new UserQuestionInfo();

    user_question_info.question_id = result_row.question_id;

    if(user_question_info.question_id == undefined) // quiz id는 없을 수 없다.
    {
      logger.error(`User Question Info ID is undefined... pass this`);
      continue;
    }

    for(const column of QuestionInfoColumn)
    {
      user_question_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
    }

    for(const column of additionalColumn)
    {
      user_question_info.data[column] = (result_row[column] === '' ? undefined : result_row[column]);
    }

    question_list.push(user_question_info);
  }

  let total_question_count = 0;
  if(result.rows.length > 0)
  {
    total_question_count = parseInt(result.rows[0]['total_count']); //그냥 맨 윗꺼 가져오자
  }

  return [total_question_count, question_list];
};

const addPlayedCountByQuiz = (quiz_id: number): void =>
{
  db_manager.addQuizInfoPlayedCount(quiz_id);
}

module.exports = { UserQuizInfo, UserQuestionInfo, loadUserQuizListFromDB, loadUserQuizInfoById, loadOwnedUserQuizInfoById, QuizInfoColumn, loadQuestionListFromDBByTags, loadQuestionListByBasket, addPlayedCountByQuiz };
