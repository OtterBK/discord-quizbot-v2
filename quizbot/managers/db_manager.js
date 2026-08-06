'use strict';

//db/*.js로 분리 (REFACTOR_PLAN.md Phase 5)
//여러 파일이 이 모듈을 whole-object(const db_manager = require(...))로 사용하고 있어서,
//db_manager.js는 각 도메인별 파일을 재수출(re-export)하는 얇은 facade로 남긴다.
//db_core.js가 내부적으로 sendQuery를 도메인 파일들에 노출하지만, 원본에는 없던 export이므로
//facade에서는 원본과 동일하게 initialize/executeQuery만 재수출한다.
const db_core = require('./db/db_core');
const db_option = require('./db/db_option');
const db_quiz = require('./db/db_quiz');
const db_report = require('./db/db_report');
const db_scoreboard = require('./db/db_scoreboard');

module.exports = {
  initialize: db_core.initialize,
  executeQuery: db_core.executeQuery,
  ...db_option,
  ...db_quiz,
  ...db_report,
  ...db_scoreboard,
};
