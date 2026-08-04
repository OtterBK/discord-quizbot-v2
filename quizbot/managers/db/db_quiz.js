'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//유저 퀴즈/문제/좋아요/인증/랜덤 출제 관련 쿼리.
//원본 파일에서 quiz info와 question info 관련 함수가 서로 섞여 있던 순서를 그대로 유지했다
//(원본 주석 "User Quiz info"/"User QuestioN Info"도 그 위치 그대로 보존).
//로직/주석은 원본과 동일 (동작 변경 없음).

const db_core = require('./db_core.js');

/** User Quiz info */
//option이랑 쿼리 날리는 방식이 다르다...쏘리
exports.selectQuizInfo = async (creator_id) => 
{

  let query_string = 
  `select * 
    from tb_quiz_info
    where is_use = true and creator_id = $1
    order by quiz_id desc`;

  return db_core.sendQuery(query_string, [creator_id]);

};

exports.selectAllQuizInfo = async () => 
{

  let query_string = 
  `select * 
    from tb_quiz_info
    where is_use = true and is_private = false
    order by modified_time desc`;

  return db_core.sendQuery(query_string);

};

exports.insertQuizInfo = async (key_fields, value_fields) => 
{

  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i) 
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }
  const query_string = 
  `insert into tb_quiz_info (${key_fields}) values (${placeholders}) 
  returning quiz_id`;

  return db_core.sendQuery(query_string, value_fields);

};

exports.updateQuizInfo = async (key_fields, value_fields, quiz_id) => 
{
  
  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i) 
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }

  const query_string = 
  `UPDATE tb_quiz_info set (${key_fields}) = (${placeholders}) 
    where quiz_id = ${quiz_id}
    returning quiz_id`;

  return db_core.sendQuery(query_string, value_fields);

};

exports.disableQuizInfo = async (quiz_id) => 
{
  
  const query_string = 
  `UPDATE tb_quiz_info set is_use = false 
    where quiz_id = $1;`;

  return db_core.sendQuery(query_string, [quiz_id]);
};

exports.addQuizInfoPlayedCount = async (quiz_id) => 
{

  const query_string = 
  `UPDATE tb_quiz_info set played_count = played_count + 1, played_count_of_week = played_count_of_week + 1
    where quiz_id = $1;`;

  return db_core.sendQuery(query_string, [quiz_id]);

};


/** User QuestioN Info */ 
exports.selectQuestionInfo = async (value_fields) => 
{

  const query_string =
  `select *
    from tb_question_info
    where quiz_id = $1
    order by question_id asc`;
    
  return db_core.sendQuery(query_string, value_fields);

};
exports.insertQuestionInfo = async (key_fields, value_fields) => 
{

  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i) 
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }
  const query_string = 
  `insert into tb_question_info (${key_fields}) values (${placeholders}) 
  returning question_id`;

  return db_core.sendQuery(query_string, value_fields);

};

exports.updateQuestionInfo = async (key_fields, value_fields, question_id) => 
{
  
  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i) 
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }

  const query_string = 
  `UPDATE tb_question_info set (${key_fields}) = (${placeholders}) 
    where question_id = ${question_id}
    returning question_id`;

  return db_core.sendQuery(query_string, value_fields);
};

/** User QuestioN Info */ 
exports.updateQuizInfoModifiedTime = async (quiz_id) => 
{

  const query_string = 
  `UPDATE tb_quiz_info set modified_time = now()
    where quiz_id = $1;`;

  return db_core.sendQuery(query_string, [quiz_id]);
};

exports.deleteQuestionInfo = async (question_id) => 
{
  
  const query_string = 
  `delete from tb_question_info
    where question_id = $1`;

  return db_core.sendQuery(query_string, [question_id]);

};

exports.insertLikeInfo = async (key_fields, value_fields) => 
{

  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i) 
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }
  const query_string = 
  `insert into tb_like_info (${key_fields}) values (${placeholders})`;

  return db_core.sendQuery(query_string, value_fields);
};

exports.selectLikeInfo = async (value_fields) => 
{

  const query_string = 
  `select user_id from tb_like_info 
  where quiz_id = $1 and user_id = $2`;

  return db_core.sendQuery(query_string, value_fields);

};

exports.updateQuizLikeCount = async (quiz_id) => 
{

  const query_string = 
  `UPDATE tb_quiz_info set like_count = (select count(user_id) from tb_like_info where tb_like_info.quiz_id = $1)
    where quiz_id = $1
    returning like_count;`;

  return db_core.sendQuery(query_string, [quiz_id]);

};

exports.certifyQuiz = async (quiz_id, played_count_criteria) => 
{

  const query_string = 
  `UPDATE tb_quiz_info set certified = true
    where quiz_id = $1 and (certified = false or certified is null) and played_count >= $2;`;

  return db_core.sendQuery(query_string, [quiz_id, played_count_criteria]);

};

exports.selectRandomQuestionListByTags = async (quiz_type_tags_value, tags_value, limit, certified_filter) => 
{

  const query_string =
  `
  WITH matching_quizzes AS (
    SELECT quiz_id, quiz_title, creator_name, creator_icon_url, simple_description, tags_value
    FROM tb_quiz_info
    WHERE (tags_value & $1) > 0
    and ($2 = 0 or (tags_value & $2) > 0)
    and is_private = false
    and is_use = true
    ${certified_filter ? 'and certified = true' : ''}
  )
  SELECT qu.*, mq.quiz_id, mq.quiz_title, mq.creator_name, mq.creator_icon_url, mq.simple_description, mq.tags_value,
    COUNT(*) OVER() AS total_count
  FROM tb_question_info qu
  JOIN matching_quizzes mq ON qu.quiz_id = mq.quiz_id
  WHERE qu.answer_type = 1 OR qu.answer_type IS NULL
  ORDER BY RANDOM()
  LIMIT $3;`;
  
  return db_core.sendQuery(query_string, [quiz_type_tags_value, tags_value, limit]);
};

exports.selectRandomQuestionListByBasket = async (basket_condition_query, limit) => 
{
  const query_string =
  `
  WITH matching_quizzes AS (
    SELECT quiz_id, quiz_title, creator_name, creator_icon_url, simple_description, tags_value
    FROM tb_quiz_info
    WHERE quiz_id IN ${basket_condition_query}
  )
  SELECT qu.*, mq.quiz_id, mq.quiz_title, mq.creator_name, mq.creator_icon_url, mq.simple_description, mq.tags_value,
    COUNT(*) OVER() AS total_count
  FROM tb_question_info qu
  JOIN matching_quizzes mq ON qu.quiz_id = mq.quiz_id
  WHERE qu.answer_type = 1 OR qu.answer_type IS NULL
  ORDER BY RANDOM()
  LIMIT $1;`;
  
  return db_core.sendQuery(query_string, [limit]);
};
