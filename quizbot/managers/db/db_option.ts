'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//옵션 관련 쿼리.
//로직/주석은 원본과 동일 (동작 변경 없음).

const db_core = require('./db_core');

/** 옵션 */
//옵션쪽은 어차피 고정값이니깐 placeholder 사용하지 말자, 건드리기 두렵다
exports.selectOption = async (guild_id: string, option_fields: string): Promise<any> =>
{

  const query_string =
  `select ${option_fields} from tb_option
    where guild_id = ${guild_id};`;

  return db_core.sendQuery(query_string);

};

exports.updateOption = async (guild_id: string, option_fields: string, option_values: string): Promise<any> =>
{

  const query_string =
  `insert into tb_option (guild_id,${option_fields}) values (${guild_id},${option_values})
    on conflict (guild_id)
    DO UPDATE set (${option_fields}) = (${option_values})
    where tb_option.guild_id = ${guild_id};`;

  return db_core.sendQuery(query_string);

};

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 서버 설정 웹 API 전용 파라미터화 쿼리.
//위 selectOption/updateOption(문자열 직접 삽입, 디스코드 경로 전용)은 그대로 두고 손대지 않는다.
//호출부(web_express_app.ts)가 option_data의 key를 9종 화이트리스트로 이미 검증한 뒤 넘기므로
//컬럼명 보간은 안전하고, 값은 전부 $n 플레이스홀더로 넘어간다.
exports.updateOptionParameterized = async (guild_id: string, option_data: Record<string, any>): Promise<any> =>
{

  const fields = Object.keys(option_data);
  const set_clause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
  const insert_placeholders = fields.map((_field, index) => `$${index + 2}`).join(', ');
  const values = [guild_id, ...fields.map((field) => `${option_data[field]}`.trim())];

  const query_string =
  `insert into tb_option (guild_id,${fields.join(', ')}) values ($1,${insert_placeholders})
    on conflict (guild_id)
    DO UPDATE set ${set_clause}
    where tb_option.guild_id = $1;`;

  return db_core.sendQuery(query_string, values);

};
