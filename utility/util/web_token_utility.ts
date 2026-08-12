//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md)용 세션 토큰 생성.
//misc_utility.generateUUID()는 Math.random() 기반이라 암호학적으로 안전하지 않아
//세션 토큰 용도로는 재사용하지 않는다 - crypto.randomBytes로 별도 분리.

const crypto = require('crypto');

exports.generateWebSessionToken = (): string =>
{
  return crypto.randomBytes(32).toString('hex');
};
