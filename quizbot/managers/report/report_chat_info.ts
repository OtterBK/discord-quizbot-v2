//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//chat_id 파싱, 신고 관련 DB 컬럼/키필드 상수, 처리 결과 타입 enum.
//로직/주석은 원본과 동일 (동작 변경 없음).

/** Chat 쪽 DB 관련 */

interface ChatInfo
{
  guild_id: string;
  user_id: string;
  timestamp: string;
}

const getChatId = (custom_id: string): string | undefined =>
{
  let chat_id = custom_id.replace('modal_chat_report_', '');
  if(chat_id === custom_id)
  {
    chat_id = custom_id.replace('chat_report_', '');
  }

  if(chat_id === custom_id) //안바뀌었으면 없는거임
  {
    return undefined;
  }

  return chat_id;
};

/** Chat ID 에서 정보 추출 */
const extractChatInfo = (chat_id: string): ChatInfo | undefined =>
{
  const info = chat_id.split('-');
  if(info.length != 3)
  {
    return undefined;
  }

  return {
    guild_id: info[0],
    user_id: info[1],
    timestamp: info[2],
  };
};

const CHAT_INFO_COLUMN =
[
  "chat_id",
  "content",
  "sender_id",
  "result",
];

const REPORT_INFO_COLUMN =
[
  "target_id",
  "reporter_id",
  "report_detail",
  "report_type",
];

let chat_info_key_fields = '';
CHAT_INFO_COLUMN.forEach((field) =>
{
  if(chat_info_key_fields != '')
  {
    chat_info_key_fields += ', ';
  }
  chat_info_key_fields += `${field}`;
});

let report_info_key_fields = '';
REPORT_INFO_COLUMN.forEach((field) =>
{
  if(report_info_key_fields != '')
  {
    report_info_key_fields += ', ';
  }
  report_info_key_fields += `${field}`;
});

const REPORT_PROCESSED_RESULT_TYPE =
{
  IN_PROGRESS: 0,
  BANNED: 1,
  DENY: 2,
};

const FOLLOWUP_PROCESSED_RESULT_TYPE =
{
  IN_PROGRESS: 0,
  UNBANNED: 1,
  BANNED: 2,
  GUILD_BANNED: 3,
};

module.exports = {
  getChatId,
  extractChatInfo,
  CHAT_INFO_COLUMN,
  REPORT_INFO_COLUMN,
  chat_info_key_fields,
  report_info_key_fields,
  REPORT_PROCESSED_RESULT_TYPE,
  FOLLOWUP_PROCESSED_RESULT_TYPE,
};
