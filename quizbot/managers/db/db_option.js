'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//옵션 관련 쿼리.
//로직/주석은 원본과 동일 (동작 변경 없음).

const db_core = require('./db_core.js');

/** 옵션 */
//옵션쪽은 어차피 고정값이니깐 placeholder 사용하지 말자, 건드리기 두렵다
exports.selectOption = async (guild_id, option_fields) => 
{

  const query_string = 
  `select ${option_fields} from tb_option 
    where guild_id = ${guild_id};`;

  return db_core.sendQuery(query_string);

};

exports.updateOption = async (guild_id, option_fields, option_values) => 
{

  const query_string =
  `insert into tb_option (guild_id,${option_fields}) values (${guild_id},${option_values}) 
    on conflict (guild_id)
    DO UPDATE set (${option_fields}) = (${option_values}) 
    where tb_option.guild_id = ${guild_id};`;

  return db_core.sendQuery(query_string); 

};
