//외부 modules


//로컬 modules
const db_manager = require('./db_manager.js');
const logger = require('../../utility/logger.js')('UserQuizInfoManager');
const feedback_manager = require('./feedback_manager.js');

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

  async saveDataToDB()
  {
    let quiz_info_value_fields = Object.values(this.data);

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

  async delete() //퀴즈 삭제는 정말 삭제하기 보다는 is_use를 false로
  {
    db_manager.disableQuizInfo(this.quiz_id);
  }

  async loadQuestionListFromDB() //quiz 객체에서 question 목록 로드 가능
  {
    const question_list = [];

    const result = await db_manager.selectQuestionInfo([this.quiz_id]);

    for(const result_row of result.rows)
    {
      let user_question_info = new UserQuestionInfo();

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

  async saveQuestionToDB()
  {
    //quiz question 전체 db에 저장
    for(const question of this.question_list)
    {
      question.saveDataToDB();
    }
  }

  async addPlayedCount()
  {
    db_manager.addQuizInfoPlayedCount(this.quiz_id);
  }

  async updateModifiedTime()
  {
    db_manager.updateQuizInfoModifiedTime(this.quiz_id);
  }

  //@Deprecated
  async addLike(guild_id, user_id)
  {
    return await feedback_manager.addQuizLike(this.quiz_id, guild_id);
  }
}

class UserQuestionInfo //유저 제작 문제 정보
{
  constructor()
  {
    this.data = {};

    for(const column of QuestionInfoColumn)
    {
      this.data[column] = undefined;
    }

    this.question_id == undefined;

  }

  async saveDataToDB()
  {
    let question_info_value_fields = Object.values(this.data);

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

  async delete()
  {
    db_manager.deleteQuestionInfo(this.question_id);
  }
}

const loadUserQuizListFromDB = async (creator_id) => 
{ //creator_id 기준으로 quiz 목록 로드, creator_id가 undefined면 전체 조회

  let user_quiz_list = [];

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
    let user_quiz_info = new UserQuizInfo();

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

const loadQuestionListFromDBByTags = async (quiz_type_tags_value, tag_value, limit, certified_filter=true) => 
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
  const question_list = [];

  const result = await db_manager.selectRandomQuestionListByTags(quiz_type_tags_value, tag_value, limit, certified_filter);

  for(const result_row of result.rows)
  {
    let user_question_info = new UserQuestionInfo();

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

const loadQuestionListByBasket = async (basket_condition_query, limit) => 
{ //quiz_id 로 랜덤 문제 불러오기

  if(basket_condition_query == '') //선택된 퀴즈 basket이 없다면
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
  const question_list = [];

  const result = await db_manager.selectRandomQuestionListByBasket(basket_condition_query, limit);

  for(const result_row of result.rows)
  {
    let user_question_info = new UserQuestionInfo();

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

const addPlayedCountByQuiz = (quiz_id) =>
{
  db_manager.addQuizInfoPlayedCount(quiz_id);
}

module.exports = { UserQuizInfo, UserQuestionInfo, loadUserQuizListFromDB, QuizInfoColumn, loadQuestionListFromDBByTags, loadQuestionListByBasket, addPlayedCountByQuiz };
