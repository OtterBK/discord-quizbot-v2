//util/*.js로 분리 (REFACTOR_PLAN.md Phase 5)
//22개 파일이 이 모듈을 whole-object(const utility = require(...))로 사용하고 있어서,
//utility.js는 각 도메인별 파일을 재수출(re-export)하는 얇은 facade로 남긴다.
//아래 5개 require는 원본에서도 실제로 쓰이던 곳이 없던 죽은 import였다(npm run lint 기준
//기존에도 no-unused-vars 경고 대상). 어느 도메인 파일에도 속하지 않아 facade에 그대로 남겨
//기존 경고 개수(165개)가 그대로 유지되도록 했다.
const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const PRIVATE_CONFIG = require('../config/private_config.json');
const { CUSTOM_EVENT_TYPE } = require('../config/system_setting.js');
const { orderBy } = require('lodash');

const quiz_content_loader = require('./util/quiz_content_loader');
const audio_utility = require('./util/audio_utility');
const network_utility = require('./util/network_utility');
const misc_utility = require('./util/misc_utility');
const web_token_utility = require('./util/web_token_utility');
const discord_permission_utility = require('./util/discord_permission_utility');

module.exports = {
  ...quiz_content_loader,
  ...audio_utility,
  ...network_utility,
  ...misc_utility,
  ...web_token_utility,
  ...discord_permission_utility,
};
