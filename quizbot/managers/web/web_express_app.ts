//퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) Express 앱.
//web-frontend/(React+Vite, 독립 프로젝트)는 SYSTEM_CONFIG.WEB_FRONTEND_DIST_PATH의 빌드 산출물을
//정적 서빙한다 - express.static은 없는 디렉터리를 넘겨도 에러 없이 404만 내려주므로 존재 여부를
//미리 체크하지 않는다.
//
//Phase 1(공식 퀴즈)/Phase 2(유저 퀴즈)/Phase 3(랜덤 퀴즈) 완료.
//
//인증: 프론트엔드는 URL 쿼리로 받은 토큰을 history.replaceState로 즉시 마스킹한 뒤, 이후 모든 API
//호출은 Authorization: Bearer <token> 헤더로 보낸다(WEB_INTEGRATION_PLAN.md 4번 결정).
//
//DB 조회 없이 파일시스템만 쓰는 dev 퀴즈 트리는 여기서 직접 loadLocalDirectoryQuiz로 1회 로드해서
//캐싱한다(WEB_INTEGRATION_PLAN.md 3번 결정 - 마스터가 직접 조회, 클러스터로 릴레이하지 않음). 유저 퀴즈는
//DB 조회가 필요해 매 요청마다 조회한다(디스코드 쪽 UserQuizSelectUI.onReady()와 동일한 관행 -
//loadUserQuizListFromDB(undefined)로 전체 조회 후 클라이언트 사이드에서 필터/정렬).
//
//2026-08-08 Phase 2: /api/session/confirm이 세션 생성 시 고정된 session.mode 대신 요청 본문의
//mode 필드로 dev/user를 분기하도록 일반화됨(WEB_INTEGRATION_PLAN.md "8. 투트랙 진입점 분리" 참고 -
//진입점이 SelectUIModeUI로 옮겨가면서 세션 하나로 여러 모드를 오갈 수 있어야 함).

const express = require('express');
const path = require('path');
const logger = require('../../../utility/logger.js')('WebExpressApp');
const { SYSTEM_CONFIG, QUIZ_TAG, DEV_QUIZ_TAG } = require('../../../config/system_setting.js');
const text_contents = require('../../../config/text_contents.json')[SYSTEM_CONFIG.LANGUAGE];
const { loadLocalDirectoryQuiz } = require('../../../utility/util/quiz_content_loader');
const { loadUserQuizListFromDB, loadUserQuizInfoById } = require('../user_quiz_info_manager');
const web_session_manager = require('./web_session_manager');
const multiplayer_manager = require('../multiplayer_manager.js');
const ban_manager = require('../ban_manager');
const db_manager = require('../db_manager.js');
const option_system = require('../../quiz_option/quiz_option.js');
const { loadNoticeList, readNoticeFile } = require('../notice_manager');
const { CLIENT_SIGNAL } = require('../multiplayer_signal.js');
const { router: quiz_editor_router, requireOwnerScopedSession } = require('./web_quiz_editor_routes');
const { apiRateLimiter } = require('./web_rate_limit');

let server: any = undefined;
let dev_quiz_tree_cache: any[] | undefined = undefined; //원본(loadLocalDirectoryQuiz) 형식 그대로 캐싱 - content_path로 재조회할 때 씀

//랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md) - 유저당 최대 10개(사용자 확정 사항), 이름
//길이는 다른 웹 편집기 텍스트 필드(web_quiz_editor_routes.ts의 QUIZ_TITLE_MAX_LENGTH류)와 같은 관행으로
//서버에서도 재검증. 항목 수 상한은 OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo의 quiz_size(100)와
//동일하게 상식적인 값만 둠(퀴즈함 자체엔 원래 상한이 없음).
const RANDOM_QUIZ_PRESET_MAX_COUNT = 10;
const RANDOM_QUIZ_PRESET_NAME_MAX_LENGTH = 30;
const RANDOM_QUIZ_PRESET_ITEM_MAX_COUNT = 100;

const clamp = (value: number, min: number, max: number): number =>
{
  if(isNaN(value))
  {
    return min;
  }

  return Math.max(min, Math.min(max, value));
};

//API 응답용으로 필드명을 다듬는다(is_quiz -> leaf, sub_contents -> children) - content_path는
//confirm 요청에서 그대로 다시 받아 findDevQuizContentByPath로 원본을 재조회하는 식별자로 쓴다.
const transformDevTreeForApi = (raw_contents: any[]): any[] =>
{
  return raw_contents.map((content: any) =>
  {
    if(content.is_quiz === true)
    {
      return {
        name: content.name,
        icon: content.icon,
        leaf: true,
        content_path: content.content_path,
        quiz_size: content.quiz_size,
        type_name: content.type_name,
        description: content.description,
      };
    }

    return {
      name: content.name,
      icon: content.icon,
      leaf: false,
      children: transformDevTreeForApi(content.sub_contents ?? []),
    };
  });
};

//목록 카드용 - quiz_size는 selectAllQuizInfo 결과에 없으므로(문제 수는 별도 조회 필요) 카드에 노출 안 함
//(WEB_INTEGRATION_PLAN.md 4번 항목 참고 - 정확한 문제 수는 상세 API에서만 알 수 있음)
const transformUserQuizForApi = (user_quiz_info: any): any => ({
  quiz_id: user_quiz_info.quiz_id,
  title: user_quiz_info.data.quiz_title,
  simple_description: user_quiz_info.data.simple_description,
  creator_name: user_quiz_info.data.creator_name,
  creator_icon_url: user_quiz_info.data.creator_icon_url,
  thumbnail: user_quiz_info.data.thumbnail,
  tags_value: user_quiz_info.data.tags_value,
  certified: user_quiz_info.data.certified,
  like_count: user_quiz_info.data.like_count,
  played_count: user_quiz_info.data.played_count,
  played_count_of_week: user_quiz_info.data.played_count_of_week,
  birthtime: user_quiz_info.data.birthtime,
  modified_time: user_quiz_info.data.modified_time,
});

//디스코드 태그 select 메뉴(quiz_search_tags_select_menu)와 동일한 QUIZ_TAG 비트플래그를 프론트엔드
//태그 필터 칩에 그대로 노출한다 - "선택 안함"(0)은 필터에 의미가 없어 제외.
const user_quiz_tags = Object.entries(QUIZ_TAG)
  .filter(([, value]: [string, any]) => value !== 0)
  .map(([name, value]: [string, any]) => ({ name, value }));

//오마카세(랜덤 퀴즈) 웹 연동(Phase 3) - omakase_components.ts의 omakase_dev_quiz_tags_select_menu/
//omakase_custom_quiz_type_tags_select_menu/omakase_custom_quiz_tags_select_menu와 정확히 동일한
//분류 규칙(값 <= 4는 "유형", 나머지는 "장르")을 그대로 재사용해 프론트엔드 칩 구성용으로 노출한다.
const omakase_dev_tags = Object.entries(DEV_QUIZ_TAG)
  .filter(([, value]: [string, any]) => value !== 0)
  .map(([name, value]: [string, any]) => ({ name, value }));
const omakase_type_tags = Object.entries(QUIZ_TAG)
  .filter(([, value]: [string, any]) => value !== 0 && value <= 4)
  .map(([name, value]: [string, any]) => ({ name, value }));
const omakase_genre_tags = Object.entries(QUIZ_TAG)
  .filter(([, value]: [string, any]) => value !== 0 && value > 4)
  .map(([name, value]: [string, any]) => ({ name, value }));

const findDevQuizContentByPath = (content_path: string, contents: any[] | undefined = dev_quiz_tree_cache): any =>
{
  for(const content of contents ?? [])
  {
    if(content.content_path === content_path)
    {
      return content;
    }

    if(content.sub_contents !== undefined)
    {
      const found = findDevQuizContentByPath(content_path, content.sub_contents);
      if(found !== undefined)
      {
        return found;
      }
    }
  }

  return undefined;
};

const requireWebSession = (req: any, res: any, next: any): void =>
{
  const auth_header = req.headers['authorization'] ?? '';
  const token = auth_header.startsWith('Bearer ') ? auth_header.slice('Bearer '.length) : undefined;

  if(token === undefined)
  {
    res.status(401).json({ error: 'missing_token' });
    return;
  }

  const session = web_session_manager.getSession(token);
  if(session === undefined)
  {
    res.status(401).json({ error: 'invalid_or_expired_token' });
    return;
  }

  req.web_session = session;
  req.web_token = token;
  next();
};

//나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 서버 설정처럼 guild_id가 필요한 API용.
//web_quiz_editor_routes.ts의 requireOwnerScopedSession과 대칭(owner 세션에서 guild_id는 항상 undefined).
const requireGuildScopedSession = (req: any, res: any, next: any): void =>
{
  if(req.web_session.scope !== 'guild')
  {
    res.status(403).json({ error: 'guild_scope_required' });
    return;
  }

  next();
};

exports.start = (): any =>
{
  if(server !== undefined)
  {
    logger.error('Web server is already running!');
    return server;
  }

  dev_quiz_tree_cache = loadLocalDirectoryQuiz(SYSTEM_CONFIG.DEV_QUIZ_PATH);

  const app = express();
  app.use(express.json());

  //웹 API 보안 점검(docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md 작업 2-D) - rate limiting.
  //정적 자산(/editor, 빌드 산출물)은 브라우저가 여러 파일을 동시에 요청하는 게 정상이라 대상에서 뺀다.
  app.use('/health', apiRateLimiter);
  app.use('/api', apiRateLimiter);

  app.get('/health', (req: any, res: any) =>
  {
    res.json({ status: 'ok' });
  });

  app.get('/api/session', requireWebSession, (req: any, res: any) =>
  {
    const session = req.web_session;
    //scope/scope_id/owner_name은 퀴즈 만들기 웹 연동(Phase 1) 신규 필드 - owner 세션은 guild_id가
    //undefined이므로 프론트엔드가 이 필드로 자신이 owner 세션인지 구분한다. guild_id는 하위 호환으로 유지.
    res.json({
      guild_id: session.guild_id,
      scope: session.scope,
      scope_id: session.scope_id,
      owner_name: session.owner_name,
      mode: session.mode,
      expires_at: session.expires_at,
    });
  });

  app.post('/api/session/heartbeat', requireWebSession, (req: any, res: any) =>
  {
    res.json(web_session_manager.heartbeat(req.web_token));
  });

  app.get('/api/dev-quizzes', requireWebSession, (req: any, res: any) =>
  {
    res.json({ tree: transformDevTreeForApi(dev_quiz_tree_cache ?? []) });
  });

  //오마카세(랜덤 퀴즈) 웹 연동(Phase 3) - DB 조회 없이 config의 태그 enum만 노출하는 정적 데이터.
  app.get('/api/omakase-tags', requireWebSession, (req: any, res: any) =>
  {
    res.json({ dev_tags: omakase_dev_tags, type_tags: omakase_type_tags, genre_tags: omakase_genre_tags });
  });

  //랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md, 2026-08-13 신설) - 웹 UI 한정, "직접 담기"
  //모드의 퀴즈함(quiz_id 목록)만 유저(owner_id) 단위로 저장한다(옵션은 저장하지 않고 항상 불러오는
  //시점의 현재 설정을 따름). guild 세션(omakase)/owner 세션 둘 다 owner_id를 갖고 있어 스코프 제한
  //없이 requireWebSession만으로 충분하다. 목록 응답의 quiz_id_list는 비공개 전환/삭제된 항목까지
  //그대로 내려주고, 필터링은 프론트엔드가 이미 불러온 공개 퀴즈 목록(/api/user-quizzes)과 대조해서
  //한다(계획 문서의 "앱 코드 레벨" 항목 참고 - DB/API 레벨에서 다시 조회하지 않아 구현이 단순해짐).
  app.get('/api/random-quiz-presets', requireWebSession, async (req: any, res: any) =>
  {
    const preset_list = await db_manager.selectRandomQuizPresetsByUser(req.web_session.owner_id);

    res.json({
      presets: (preset_list?.rows ?? []).map((row: any) => ({
        preset_id: row.preset_id,
        preset_name: row.preset_name,
        quiz_id_list: row.quiz_id_list,
        created_time: row.created_time,
      })),
    });
  });

  //이름 중복은 DB의 UNIQUE(user_id, preset_name) 제약이 최종 방어선이지만, db_core.sendQuery가 모든
  //에러를 동일하게 undefined로 삼켜서(에러 코드 구분 불가) 사전에 SELECT로 직접 확인한다.
  app.post('/api/random-quiz-presets', requireWebSession, async (req: any, res: any) =>
  {
    const preset_name = typeof req.body?.preset_name === 'string' ? req.body.preset_name.trim() : '';
    if(preset_name.length === 0 || preset_name.length > RANDOM_QUIZ_PRESET_NAME_MAX_LENGTH)
    {
      res.status(400).json({ error: 'invalid_preset_name' });
      return;
    }

    const raw_quiz_id_list: any[] = Array.isArray(req.body?.quiz_id_list) ? req.body.quiz_id_list : [];
    const quiz_id_list: number[] = Array.from(new Set<number>(
      raw_quiz_id_list.map((v: any) => parseInt(v)).filter((v: number) => !isNaN(v)),
    ));
    if(quiz_id_list.length === 0 || quiz_id_list.length > RANDOM_QUIZ_PRESET_ITEM_MAX_COUNT)
    {
      res.status(400).json({ error: 'invalid_quiz_id_list' });
      return;
    }

    const owner_id = req.web_session.owner_id;

    const existing = await db_manager.selectRandomQuizPresetByName(owner_id, preset_name);
    if((existing?.rows?.length ?? 0) > 0)
    {
      res.status(400).json({ error: 'duplicate_name' });
      return;
    }

    const count_result = await db_manager.countRandomQuizPresetsByUser(owner_id);
    const preset_count = parseInt(count_result?.rows?.[0]?.count ?? '0');
    if(preset_count >= RANDOM_QUIZ_PRESET_MAX_COUNT)
    {
      res.status(400).json({ error: 'max_presets_reached' });
      return;
    }

    const preset_id = await db_manager.insertRandomQuizPreset(owner_id, preset_name, quiz_id_list, RANDOM_QUIZ_PRESET_MAX_COUNT);
    if(preset_id === undefined)
    {
      res.status(500).json({ error: 'save_failed' });
      return;
    }

    logger.info(`[Web] Created Random Quiz Preset... preset_id: ${preset_id}, owner_id: ${owner_id}`);
    res.status(201).json({ preset_id, preset_name, quiz_id_list, created_time: new Date() });
  });

  app.delete('/api/random-quiz-presets/:preset_id', requireWebSession, async (req: any, res: any) =>
  {
    const preset_id = parseInt(req.params.preset_id);
    if(isNaN(preset_id))
    {
      res.status(400).json({ error: 'invalid_preset_id' });
      return;
    }

    const result = await db_manager.deleteRandomQuizPreset(preset_id, req.web_session.owner_id);
    if((result?.rows?.length ?? 0) === 0)
    {
      res.status(404).json({ error: 'preset_not_found' });
      return;
    }

    logger.info(`[Web] Deleted Random Quiz Preset... preset_id: ${preset_id}, owner_id: ${req.web_session.owner_id}`);
    res.json({ success: true });
  });

  //멀티플레이 웹 연동(Phase 4) - multiplayer_session_registry.multiplayer_sessions는 이미 마스터 프로세스
  //메모리에 있고(index.js가 MULTIPLAYER_SIGNAL을 multiplayer_manager.onSignalReceived로 인프로세스 처리),
  //REQUEST_LOBBY_LIST 핸들러도 이미 마스터에서 실행되므로 클러스터로 릴레이할 필요 없이 그대로 재사용한다.
  app.get('/api/multiplayer-lobbies', requireWebSession, (req: any, res: any) =>
  {
    const lobby_list = multiplayer_manager.onSignalReceived({
      signal_type: CLIENT_SIGNAL.REQUEST_LOBBY_LIST,
      guild_id: req.web_session.guild_id, //핸들러 자체는 안 쓰지만 onSignalReceived의 guild_id 필수 가드를 통과시키기 위함
    });

    res.json({ lobbies: lobby_list ?? [] });
  });

  //멀티플레이 웹 연동(Phase 4) - 로비 생성/참가 확정은 클러스터가 비동기로 처리해서 confirm 응답만으로는
  //성공/실패를 알 수 없다(음성채널 체크가 실제 GuildMember가 필요해서). 프론트엔드가 confirm 직후
  //이 엔드포인트를 잠깐 폴링해서 실제 결과를 읽어간다 - 1회성(읽으면 즉시 비워짐).
  app.get('/api/multiplayer-result', requireWebSession, (req: any, res: any) =>
  {
    res.json({ result: web_session_manager.consumeMultiplayerResult(req.web_token) ?? null });
  });

  //유저 퀴즈는 DB 조회가 필요해 매 요청마다 조회 - 디스코드 쪽 UserQuizSelectUI.onReady()와 동일한
  //관행(전체 조회 후 클라이언트 사이드 필터/정렬). tags는 프론트엔드 태그 필터 칩 구성용.
  app.get('/api/user-quizzes', requireWebSession, async (req: any, res: any) =>
  {
    const user_quiz_list = await loadUserQuizListFromDB(undefined);
    res.json({ quizzes: user_quiz_list.map(transformUserQuizForApi), tags: user_quiz_tags });
  });

  //상세 - selectQuestionInfo로 실제 문제 수를 계산(스테퍼 max를 정확히 알 수 있는 유일한 지점,
  //목록 API의 tb_quiz_info에는 문제 수 컬럼이 없음).
  app.get('/api/user-quizzes/:quiz_id', requireWebSession, async (req: any, res: any) =>
  {
    const quiz_id = parseInt(req.params.quiz_id);
    const user_quiz_info = await loadUserQuizInfoById(quiz_id);
    if(user_quiz_info === undefined)
    {
      res.status(404).json({ error: 'quiz_not_found' });
      return;
    }

    await user_quiz_info.loadQuestionListFromDB();

    res.json({
      quiz_id: user_quiz_info.quiz_id,
      title: user_quiz_info.data.quiz_title,
      description: user_quiz_info.data.description,
      simple_description: user_quiz_info.data.simple_description,
      creator_name: user_quiz_info.data.creator_name,
      creator_icon_url: user_quiz_info.data.creator_icon_url,
      thumbnail: user_quiz_info.data.thumbnail,
      tags_value: user_quiz_info.data.tags_value,
      certified: user_quiz_info.data.certified,
      like_count: user_quiz_info.data.like_count,
      played_count: user_quiz_info.data.played_count,
      birthtime: user_quiz_info.data.birthtime,
      modified_time: user_quiz_info.data.modified_time,
      question_count: user_quiz_info.question_list.length,
    });
  });

  app.post('/api/session/select', requireWebSession, (req: any, res: any) =>
  {
    res.json(web_session_manager.updateSelection(req.web_token, req.body?.selection ?? {}));
  });

  //2026-08-08 Phase 2: session.mode(세션 생성 시 1회 고정) 대신 요청 본문의 mode로 분기하도록 일반화 -
  //진입점이 SelectUIModeUI로 옮겨가면서 세션 하나로 여러 모드를 시도할 수 있어야 하기 때문
  //(WEB_INTEGRATION_PLAN.md "8. 투트랙 진입점 분리" 참고). web_session_manager는 원래부터 스테이트리스라
  //(payload를 그대로 릴레이만 함) 이 변경에 영향받지 않는다.
  app.post('/api/session/confirm', requireWebSession, async (req: any, res: any) =>
  {
    const mode = req.body?.mode;

    if(mode === 'dev')
    {
      const content_path = req.body?.selection?.content_path;
      const content = findDevQuizContentByPath(content_path);
      if(content === undefined)
      {
        res.status(400).json({ success: false, reason: 'content_not_found' });
        return;
      }

      const selected_question_count = clamp(parseInt(req.body?.selected_question_count), 1, content.quiz_size);

      //2026-08-08: 확정해도 토큰은 유지 - 같은 세션에서 문제 수 재조정/다른 퀴즈 재선택이 가능해야 함
      //(1차 실사용 테스트 피드백). 토큰은 퀴즈가 실제 시작되거나 홀더가 사라질 때 파기됨(web_session_manager.ts 참고).
      const result = web_session_manager.applySelection(req.web_token, {
        mode: 'dev',
        content_path,
        selected_question_count,
      });

      res.json(result);
      return;
    }

    if(mode === 'user')
    {
      const quiz_id = parseInt(req.body?.selection?.quiz_id);
      const user_quiz_info = await loadUserQuizInfoById(quiz_id);
      if(user_quiz_info === undefined)
      {
        res.status(400).json({ success: false, reason: 'content_not_found' });
        return;
      }

      await user_quiz_info.loadQuestionListFromDB(); //실시간 문제 수로 재검증(프론트엔드 캐시값을 신뢰하지 않음)

      const selected_question_count = clamp(parseInt(req.body?.selected_question_count), 1, user_quiz_info.question_list.length);

      const result = web_session_manager.applySelection(req.web_token, {
        mode: 'user',
        quiz_id,
        title: user_quiz_info.data.quiz_title,
        selected_question_count,
      });

      res.json(result);
      return;
    }

    if(mode === 'omakase')
    {
      //omakase는 DB 조회가 필요 없는 작은 데이터(태그 비트마스크/인증필터/퀴즈함/문제 수)라 dev처럼
      //고정 상한(quiz_size=100, OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo와 동일)으로 클램프한다.
      const selection = req.body?.selection ?? {};
      const selected_question_count = clamp(parseInt(req.body?.selected_question_count), 1, 100);

      const result = web_session_manager.applySelection(req.web_token, {
        mode: 'omakase',
        dev_quiz_tags: parseInt(selection.dev_quiz_tags) || 0,
        basket_mode: selection.basket_mode ?? true,
        custom_quiz_type_tags: parseInt(selection.custom_quiz_type_tags) || 0,
        custom_quiz_tags: parseInt(selection.custom_quiz_tags) || 0,
        certified_filter: selection.certified_filter ?? true,
        basket_items: selection.basket_items ?? {},
        selected_question_count,
      });

      res.json(result);
      return;
    }

    if(mode === 'multiplayer')
    {
      //실제 음성채널 체크/로비 생성·참가는 owner의 실제 GuildMember가 필요해 그 길드를 담당하는 클러스터
      //(WebHandoffUI.buildMultiplayerUI)에서 처리한다 - 여기선 밴 체크(파일 기반, 마스터에서도 독립적으로
      //가능)만 먼저 걸러 불필요한 브로드캐스트를 줄이고, 나머지는 그대로 릴레이만 한다.
      const guild_id = req.web_session.guild_id;
      const owner_id = req.web_session.owner_id;

      if(ban_manager.isBanned([guild_id, owner_id]))
      {
        res.status(400).json({ success: false, reason: 'banned' });
        return;
      }

      const action = req.body?.action;

      if(action === 'join')
      {
        const session_id = req.body?.selection?.session_id;
        if(session_id === undefined)
        {
          res.status(400).json({ success: false, reason: 'session_not_found' });
          return;
        }

        const result = web_session_manager.applySelection(req.web_token, { mode: 'multiplayer', action: 'join', session_id });
        res.json(result);
        return;
      }

      if(action === 'create')
      {
        const selection = req.body?.selection ?? {};
        const title = typeof selection.title === 'string' ? selection.title.trim().slice(0, 20) : undefined;
        const selected_question_count = clamp(parseInt(req.body?.selected_question_count), 20, 60); //MultiplayerQuizLobbyUI.createDefaultMultiplayerQuizInfo와 동일 범위(quiz_size=60, min_quiz_size=20) - 하한은 MultiplayerQuizLobbyUI.applyWebPayloadToQuizInfo에서도 다시 한번 강제됨(이중 방어)

        const result = web_session_manager.applySelection(req.web_token, {
          mode: 'multiplayer',
          action: 'create',
          title,
          dev_quiz_tags: parseInt(selection.dev_quiz_tags) || 0,
          basket_mode: selection.basket_mode ?? true,
          custom_quiz_type_tags: parseInt(selection.custom_quiz_type_tags) || 0,
          custom_quiz_tags: parseInt(selection.custom_quiz_tags) || 0,
          certified_filter: selection.certified_filter ?? true,
          basket_items: selection.basket_items ?? {},
          selected_question_count,
        });

        res.json(result);
        return;
      }

      res.status(400).json({ success: false, reason: 'unsupported_action' });
      return;
    }

    res.status(400).json({ success: false, reason: 'unsupported_mode' });
  });

  //나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 퀴즈만들기 안내 페이지(정적, DB 없음).
  app.get('/api/quiz-tool-guide', requireWebSession, (req: any, res: any) =>
  {
    const guide = text_contents.quiz_tool_guide_ui;
    res.json({ title: guide.title, description: guide.description, fields: [guide.fields1] });
  });

  //봇 지원센터 링크 - 디스코드 쪽(select_ui_mode_btn_component/main_ui_component)과 동일하게
  //SYSTEM_CONFIG.SUPPORT_SERVER_URL을 그대로 내려준다(정적, DB 없음, 2026-08-15 신설).
  app.get('/api/support-link', requireWebSession, (req: any, res: any) =>
  {
    res.json({ url: SYSTEM_CONFIG.SUPPORT_SERVER_URL });
  });

  //공지사항 목록/상세 - quiz_ui/note-select-ui.ts, note-ui.ts와 동일한 notice_manager.ts 함수 재사용.
  app.get('/api/notices', requireWebSession, async (req: any, res: any) =>
  {
    const notices = await loadNoticeList(SYSTEM_CONFIG.NOTICES_PATH);
    res.json({ notices: notices.map((notice: any) => ({ name: notice.name, mtime: notice.mtime })) });
  });

  app.get('/api/notices/:name', requireWebSession, async (req: any, res: any) =>
  {
    const notices = await loadNoticeList(SYSTEM_CONFIG.NOTICES_PATH);
    const notice = notices.find((n: any) => n.name === req.params.name);
    if(notice === undefined)
    {
      res.status(404).json({ error: 'notice_not_found' });
      return;
    }

    res.json(readNoticeFile(notice.note_path));
  });

  //서버 설정 - quiz_option.js의 OptionStorage 캐시를 디스코드 UI(server-setting-ui.ts)와 그대로 공유한다
  //(웹에서 바꾸면 디스코드 쪽도 즉시 같은 값을 보게 됨). 권한 체크는 의도적으로 없음(기존 디스코드
  //동작과 동일 - 사용자 확인, docs/WEB_UI_REMAINING_SCREENS_PLAN.md 참고). 저장은 db_option.ts의
  //selectOption/updateOption(문자열 직접 삽입, 디스코드 전용)을 타지 않고 새 파라미터화 함수만 쓴다.
  app.get('/api/server-option', requireWebSession, requireGuildScopedSession, (req: any, res: any) =>
  {
    const option_storage = option_system.getOptionStorage(req.web_session.guild_id);
    res.json({
      values: option_storage.getOptionData().quiz,
      select_menu: text_contents.server_setting_ui.select_menu,
    });
  });

  app.put('/api/server-option', requireWebSession, requireGuildScopedSession, async (req: any, res: any) =>
  {
    const select_menu = text_contents.server_setting_ui.select_menu;
    const known_fields = new Set(select_menu.options.map((option: any) => option.value));
    const fields = req.body?.fields ?? {};

    for(const field of Object.keys(fields))
    {
      if(known_fields.has(field) === false)
      {
        res.status(400).json({ error: 'unknown_field', field });
        return;
      }

      const allowed_values = select_menu.option_values[field].map((entry: any) => entry.value);
      if(allowed_values.includes(`${fields[field]}`) === false)
      {
        res.status(400).json({ error: 'invalid_value', field });
        return;
      }
    }

    const option_storage = option_system.getOptionStorage(req.web_session.guild_id);
    Object.keys(fields).forEach((field) =>
    {
      option_storage.option.quiz[field] = fields[field];
    });

    //db_core.sendQuery는 연결 실패/쿼리 에러 모두 던지지 않고 조용히 undefined를 반환한다(db_core.ts) -
    //디스코드 쪽 server-setting-ui.ts의 handleSaveOption과 동일하게 결과값으로 성공/실패를 판단해야
    //한다(그냥 await만 하고 항상 success:true를 내려주면 DB 저장이 실제로 실패해도 저장된 것처럼 보임).
    const save_result = await db_manager.updateOptionParameterized(req.web_session.guild_id, option_storage.option.quiz);

    res.json({ success: save_result !== undefined, values: option_storage.getOptionData().quiz });
  });

  //퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - 퀴즈 메타데이터 REST CRUD 전체를
  //별도 라우터로 분리(web_quiz_editor_routes.ts). requireWebSession(이 파일)은 그대로 재사용하고,
  //requireOwnerScopedSession(그 파일)으로 owner 세션인지 한 번 더 확인한 뒤 라우터에 위임한다.
  app.use('/api/my-quizzes', requireWebSession, requireOwnerScopedSession, quiz_editor_router);

  //퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) - 디스코드 임베드 링크가 촌스러운 ".html"
  //확장자 없이 /editor로 뜨도록(quiz-edit-web-handoff-ui.ts 참고). express.static은 확장자 없는
  //경로를 못 찾으면 그냥 next()로 넘길 뿐이라 순서와 무관하게 안전하다. /editor/* 와일드카드도 같이
  //잡아두는 이유는 Phase 3~4에서 react-router-dom(BrowserRouter)이 /editor/quiz/:quizId 같은 하위
  //경로를 클라이언트 라우팅으로 쓰게 되면, 새로고침/딥링크 시에도 항상 editor.html을 내려줘야 React가
  //그 경로를 해석할 수 있기 때문 - 지금 당장은 /editor 하나만 쓰이지만 미리 대비해둠.
  app.get(['/editor', '/editor/*'], (req: any, res: any) =>
  {
    res.sendFile(path.join(SYSTEM_CONFIG.WEB_FRONTEND_DIST_PATH, 'editor.html'));
  });

  app.use(express.static(SYSTEM_CONFIG.WEB_FRONTEND_DIST_PATH));

  server = app.listen(SYSTEM_CONFIG.WEB_SERVER_PORT, () =>
  {
    logger.info(`Web server listening on port ${SYSTEM_CONFIG.WEB_SERVER_PORT}`);
  });

  return server;
};

exports.stop = (): void =>
{
  if(server === undefined)
  {
    return;
  }

  server.close();
  server = undefined;
  dev_quiz_tree_cache = undefined;
};
