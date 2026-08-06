'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//신고 처리 관련 쿼리 (원본 //#region 신고 처리 관련).
//로직/주석은 원본과 동일 (동작 변경 없음).

const db_core = require('./db_core');

//#region 신고 처리 관련

exports.insertChatInfo = async (key_fields: string, value_fields: any[]): Promise<any> =>
{
  const chat_id = 'chat_id';
  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i)
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }
  const query_string =
  `
  INSERT INTO tb_chat_info (${key_fields})
  VALUES (${placeholders})
  ON CONFLICT (${chat_id}) DO NOTHING;
  `;

  return db_core.sendQuery(query_string, value_fields);
};

exports.insertReportInfo = async (key_fields: string, value_fields: any[]): Promise<any> =>
{
  let placeholders = '';
  for(let i = 1; i <= value_fields.length; ++i)
  {
    placeholders += `$${i}` + (i == value_fields.length ? '' : ',');
  }

  const query_string =
  `
  INSERT INTO tb_report_info (${key_fields})
  VALUES (${placeholders})
  `;

  return db_core.sendQuery(query_string, value_fields);
};

exports.selectReportChatInfo = async (limit: number): Promise<any> =>
{

  let query_string =
    `select *
      from tb_chat_info
      where result = 0
      limit $1`;

  return db_core.sendQuery(query_string, [limit]);
};

exports.selectReportLog = async (chat_id: string): Promise<any> =>
{

  let query_string =
      `select *
        from tb_report_info
        where target_id = $1`;

  return db_core.sendQuery(query_string, [chat_id]);
};

exports.selectBanHistory = async (user_id: string): Promise<any> =>
{

  let query_string =
        `select *
          from tb_ban_history
          where user_id = $1`;

  return db_core.sendQuery(query_string, [user_id]);
};

exports.updateBanHistory = async (user_id: string, ban_count: number, ban_expiration_timestamp: number): Promise<any> =>
{
  const query_string =
    `
    INSERT INTO tb_ban_history (user_id, ban_count, ban_expiration_timestamp)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET
        ban_count = EXCLUDED.ban_count,
        ban_expiration_timestamp = EXCLUDED.ban_expiration_timestamp;
    `;

  return db_core.sendQuery(query_string, [user_id, ban_count, ban_expiration_timestamp]);
};

exports.updateChatInfoResult = async (chat_id: string, result: number): Promise<any> =>
{
  const query_string =
  `
  UPDATE tb_chat_info
  SET result = $2
  WHERE chat_id = $1;
  `;

  return db_core.sendQuery(query_string, [chat_id, result]);
};

exports.deleteReportedLog = async (target_id: string): Promise<any> =>
{
  const query_string =
    `
    DELETE FROM tb_report_info
    WHERE target_id = $1
    RETURNING *;
    `;

  return db_core.sendQuery(query_string, [target_id]);
};


//#endregion
