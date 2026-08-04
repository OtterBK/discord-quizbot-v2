/**
 * 모든 컴포넌트를 따로 모아뒀다.
 */

//components/*.js로 분리 (REFACTOR_PLAN.md Phase 4)
//20개 파일이 이 모듈을 구조분해(destructuring)로 사용하고 있어서,
//components.js는 각 도메인별 파일을 재수출(re-export)하는 얇은 facade로 남긴다.
const base_components = require('./components/base_components.js');
const custom_quiz_components = require('./components/custom_quiz_components.js');
const omakase_components = require('./components/omakase_components.js');
const multiplayer_components = require('./components/multiplayer_components.js');
const report_components = require('./components/report_components.js');

module.exports = {
  ...base_components,
  ...custom_quiz_components,
  ...omakase_components,
  ...multiplayer_components,
  ...report_components,
};
