//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//원본에서 모듈 최상위 변수였던 bot_client를 여러 파일이 공유해야 해서 별도 파일로 뺐다.
//initialize(client)가 setClient로 채워두면, 다른 report/*.js 파일들은 getClient()로 읽는다.

let bot_client: any = undefined;

exports.setClient = (client: any): void =>
{
  bot_client = client;
};

exports.getClient = (): any =>
{
  return bot_client;
};
