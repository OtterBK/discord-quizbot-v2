//report_manager.js에서 분리 (REFACTOR_PLAN.md Phase 5)
//신고 접수 시 채팅 원문을 잠깐 들고 있는 캐시. report_submission.js가 insertChatCache/
//getChatCacheContent를, report_manager.js facade가 cleanUpChatCache를 주기적으로 호출한다.
//로직/주석은 원본과 동일 (동작 변경 없음).

const logger = require('../../../utility/logger.js')('ReportManager');

/** 초기화 */

interface ChatCacheEntry
{
  content: string;
  cached_time: number;
}

const chat_content_cache: Record<string, ChatCacheEntry> = {}; //chat_id, chat_content

/** 채팅 캐시 쪽 */

const cleanUpChatCache = (): void =>
{
  const aging_criteria = Date.now() - 300000; //5분
  const aging_target: string[] = [];

  const keys = Object.keys(chat_content_cache);

  for(const chat_id of keys)
  {
    const cache_info = chat_content_cache[chat_id];
    if(cache_info.cached_time < aging_criteria)
    {
      aging_target.push(chat_id);
    }
  }

  if(aging_target.length === 0)
  {
    return;
  }

  logger.info(`Aging Chat Content Cache size: ${aging_target.length}/${keys.length}`);

  for(const chat_id of aging_target)
  {
    delete chat_content_cache[chat_id];
  }
};

const insertChatCache = (chat_id: string, content: string): void =>
{
  if(chat_id === undefined)
  {
    return;
  }

  const prev_cache = chat_content_cache[chat_id];
  if(prev_cache !== undefined)
  {
    prev_cache.cached_time = Date.now();
    return;
  }

  chat_content_cache[chat_id] = {
    content: content,
    cached_time: Date.now(),
  };
};

const getChatCacheContent = (chat_id: string): string | undefined =>
{
  if(chat_id === undefined)
  {
    return undefined;
  }

  const cache_content = chat_content_cache[chat_id];
  if(cache_content === undefined)
  {
    return undefined;
  }

  return cache_content.content;
};

module.exports = { cleanUpChatCache, insertChatCache, getChatCacheContent };
