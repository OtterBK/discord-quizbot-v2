'use strict';

//db_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//DB connection pool과 공용 쿼리 실행 함수. 다른 db_*.js 파일들이 sendQuery를 공통으로 사용한다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const { ThreadChannel } = require('discord.js');
const { reject } = require('lodash');
const pg = require('pg');

const PRIVATE_CONFIG = require('../../../config/private_config.json');
const { SYSTEM_CONFIG } = require('../../../config/system_setting.js');
const logger = require('../../../utility/logger.js')('DBManager');

const pool = new pg.Pool({
  host: PRIVATE_CONFIG.DB.HOST,
  user: PRIVATE_CONFIG.DB.USER,
  password: PRIVATE_CONFIG.DB.PASSWORD,
  database: PRIVATE_CONFIG.DB.DATABASE,
  port: PRIVATE_CONFIG.DB.PORT,
  max: SYSTEM_CONFIG.PG_MAX_POOL_SIZE,
});

let is_initialized = false;

const sendQuery = (query_string: string, values: any[] = []): Promise<any> =>
{
  if(is_initialized == false)
  {
    return new Promise((resolve, reject) =>
    {
      resolve(undefined);
    });
  }

  return pool.query(query_string, values)
    .then((result: any) =>
    {
      return result;
    })
    .catch((err: any) =>
    {
      logger.error(`query error, query: ${query_string}, values: ${values}\nerr: ${err}`);
      return undefined;
    });
};

exports.sendQuery = sendQuery;

exports.initialize = (): Promise<boolean> =>
{
  return new Promise((resolve, reject) =>
  {
    pool.connect((err: any) =>
    {
      if (err)
      {
        logger.error(`Failed to connect db err: ${err}`);
        is_initialized = false;
      }
      else
      {
        logger.info(`Connected to db!`);
        is_initialized = true;
      }
      resolve(is_initialized);
    });
  });
};

exports.executeQuery = async (query: string, values: any[]): Promise<any> =>
{
  return pool.query(query, values);
};
