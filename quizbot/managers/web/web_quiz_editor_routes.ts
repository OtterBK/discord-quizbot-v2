//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - 퀴즈 메타데이터 REST CRUD.
//Phase 4 - 문제(question) CRUD REST 4개 추가(POST/PUT/DELETE/duplicate).
//web_express_app.ts에 app.use('/api/my-quizzes', requireWebSession, requireOwnerScopedSession, router)
//로 마운트된다(requireWebSession은 web_express_app.ts 쪽에 이미 있어 그대로 재사용, 이 파일은
//requireOwnerScopedSession/requireQuizOwnership만 추가로 제공).
//
//전부 마스터가 직접 DB를 조회/저장한다(퀴즈 선택 웹 연동과 달리 discord.js Client가 필요한 지점이
//없음 - creator_name/creator_icon_url도 세션 생성 시점에 캡처해둔 캐시값을 그대로 씀,
//WEB_QUIZ_CREATION_PLAN.md "확정된 핵심 사실" 2번 참고).

const express = require('express');
const cloneDeep = require('lodash/cloneDeep.js');
const logger = require('../../../utility/logger.js')('WebQuizEditorRoutes');
const { QUIZ_TAG, SYSTEM_CONFIG, ANSWER_TYPE } = require('../../../config/system_setting.js');
const utility = require('../../../utility/utility.js');
const {
  loadUserQuizListFromDB,
  loadOwnedUserQuizInfoById,
  UserQuizInfo,
  UserQuestionInfo,
} = require('../user_quiz_info_manager');
const {
  canGoPublic,
  isValidAudioUrl,
  isValidImageUrl,
  isDiscordCdnLink,
  parseAudioRangePoints,
  redefineRepeatCount,
} = require('../quiz_editor_validation');

//custom_quiz_components.ts의 modal_quiz_info 필드 길이 제한(setMinLength/setMaxLength)과 정확히 동일 -
//디스코드는 모달이 클라이언트에서 강제하지만 웹은 실제 <input>이라 서버에서도 검증해야 한다.
const QUIZ_TITLE_MIN_LENGTH = 4;
const QUIZ_TITLE_MAX_LENGTH = 40;
const QUIZ_SIMPLE_DESCRIPTION_MAX_LENGTH = 60;
const QUIZ_DESCRIPTION_MAX_LENGTH = 500;
const QUIZ_THUMBNAIL_MAX_LENGTH = 500;

//필드가 존재하는데 문자열이 아니면 'invalid_type'(웹 API 보안 점검, docs/
//QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md 작업 2-C 구멍 2 - 기존엔 typeof==='string'일 때만 길이를
//검사해서 객체/배열/숫자 등 비문자열 입력이 검증을 통째로 건너뛰고 그대로 저장 시도됐음, 필드에 따라
//다운스트림에서 .trim() 등을 호출하며 TypeError로 요청이 죽을 수도 있었음), 문자열인데 길이 초과면
//'too_long', 아니면(생략됐거나 정상) undefined.
const checkOptionalStringField = (value: any, max_length: number): 'invalid_type' | 'too_long' | undefined =>
{
  if(value === undefined)
  {
    return undefined;
  }
  if(typeof value !== 'string')
  {
    return 'invalid_type';
  }
  if(value.length > max_length)
  {
    return 'too_long';
  }
  return undefined;
};

const validateQuizMetadata = (body: any): { valid: boolean; error?: string } =>
{
  const quiz_title = body?.quiz_title;
  if(typeof quiz_title !== 'string' || quiz_title.length < QUIZ_TITLE_MIN_LENGTH || quiz_title.length > QUIZ_TITLE_MAX_LENGTH)
  {
    return { valid: false, error: 'invalid_quiz_title' };
  }

  const simple_description_check = checkOptionalStringField(body?.simple_description, QUIZ_SIMPLE_DESCRIPTION_MAX_LENGTH);
  if(simple_description_check === 'invalid_type')
  {
    return { valid: false, error: 'invalid_simple_description' };
  }
  if(simple_description_check === 'too_long')
  {
    return { valid: false, error: 'simple_description_too_long' };
  }

  const description_check = checkOptionalStringField(body?.description, QUIZ_DESCRIPTION_MAX_LENGTH);
  if(description_check === 'invalid_type')
  {
    return { valid: false, error: 'invalid_description' };
  }
  if(description_check === 'too_long')
  {
    return { valid: false, error: 'description_too_long' };
  }

  const thumbnail_check = checkOptionalStringField(body?.thumbnail, QUIZ_THUMBNAIL_MAX_LENGTH);
  if(thumbnail_check === 'invalid_type')
  {
    return { valid: false, error: 'invalid_thumbnail' };
  }
  if(thumbnail_check === 'too_long')
  {
    return { valid: false, error: 'thumbnail_too_long' };
  }

  return { valid: true };
};

//QUIZ_TAG에 정의된 비트만 허용 - 디스코드 select menu는 UI상 정의된 옵션만 고를 수 있어 자연히
//막히지만, 웹 REST는 클라이언트가 임의 정수를 보낼 수 있어 서버에서 알려진 비트로 마스킹한다.
const VALID_TAG_MASK: number = (Object.values(QUIZ_TAG) as number[]).reduce((mask: number, value: number) => mask | value, 0);

//web_express_app.ts의 user_quiz_tags(GET /api/user-quizzes)와 동일한 계산 - 이 라우터는 별도 파일이라
//중복 정의(2줄)로 두는 게 파일 간 숨은 의존을 만드는 것보다 낫다고 판단. 목록 응답에 실어서 프론트엔드가
//태그 선택 UI를 그릴 때 추가 API 호출 없이 바로 쓸 수 있게 한다.
const my_quiz_tags = Object.entries(QUIZ_TAG)
  .filter(([, value]: [string, any]) => value !== 0)
  .map(([name, value]: [string, any]) => ({ name, value }));

const transformOwnedQuizSummary = (user_quiz_info: any): any => ({
  quiz_id: user_quiz_info.quiz_id,
  title: user_quiz_info.data.quiz_title,
  thumbnail: user_quiz_info.data.thumbnail,
  simple_description: user_quiz_info.data.simple_description,
  tags_value: user_quiz_info.data.tags_value,
  is_private: user_quiz_info.data.is_private,
  certified: user_quiz_info.data.certified,
  like_count: user_quiz_info.data.like_count,
  played_count: user_quiz_info.data.played_count,
  played_count_of_week: user_quiz_info.data.played_count_of_week,
  birthtime: user_quiz_info.data.birthtime,
  modified_time: user_quiz_info.data.modified_time,
  creator_name: user_quiz_info.data.creator_name,
  creator_icon_url: user_quiz_info.data.creator_icon_url,
});

const transformOwnedQuizDetail = (user_quiz_info: any): any => ({
  ...transformOwnedQuizSummary(user_quiz_info),
  description: user_quiz_info.data.description,
});

//각 문제의 원본 데이터 + quiz_editor_validation으로 계산한 검증 플래그를 동봉 - Phase 4의 문제 편집
//폼이 URL 유효성/디스코드 CDN 경고를 디스코드 UI(user-question-info-ui.ts의 displayQuestionInfo)와
//동일한 기준으로 표시할 수 있게 한다.
const transformQuestionForApi = (question_info: any): any => ({
  question_id: question_info.question_id,
  data: question_info.data,
  validation: {
    is_valid_question_audio_url: isValidAudioUrl(question_info.data.question_audio_url),
    is_valid_question_image_url: isValidImageUrl(question_info.data.question_image_url),
    is_valid_hint_image_url: isValidImageUrl(question_info.data.hint_image_url),
    is_valid_answer_audio_url: isValidAudioUrl(question_info.data.answer_audio_url),
    is_valid_answer_image_url: isValidImageUrl(question_info.data.answer_image_url),
    is_question_image_discord_cdn: isDiscordCdnLink(question_info.data.question_image_url),
    is_hint_image_discord_cdn: isDiscordCdnLink(question_info.data.hint_image_url),
    is_answer_image_discord_cdn: isDiscordCdnLink(question_info.data.answer_image_url),
  },
});

//web_express_app.ts의 requireWebSession 다음에 마운트 - req.web_session.scope가 'owner'가 아니면
//(guild 세션으로 이 네임스페이스를 호출하는 경우) 403.
const requireOwnerScopedSession = (req: any, res: any, next: any): void =>
{
  if(req.web_session.scope !== 'owner')
  {
    res.status(403).json({ error: 'not_owner_scope' });
    return;
  }

  next();
};

//:quiz_id 경유 라우트 전용 - loadOwnedUserQuizInfoById가 DB 레벨에서 creator_id를 강제하므로
//(db_quiz.ts의 selectOwnedQuizInfoById) 여기서 다시 소유자 비교를 할 필요가 없다: 결과가 있으면
//곧 이 세션의 owner_id 소유라는 뜻이고, 없으면(다른 사람 퀴즈거나 quiz_id 자체가 없음) 404.
const requireQuizOwnership = async (req: any, res: any, next: any): Promise<void> =>
{
  const quiz_id = parseInt(req.params.quiz_id);
  if(isNaN(quiz_id))
  {
    res.status(400).json({ error: 'invalid_quiz_id' });
    return;
  }

  const owned_quiz = await loadOwnedUserQuizInfoById(quiz_id, req.web_session.owner_id);
  if(owned_quiz === undefined)
  {
    res.status(404).json({ error: 'quiz_not_found' });
    return;
  }

  req.owned_quiz = owned_quiz;
  next();
};

const router = express.Router();

router.get('/', async (req: any, res: any) =>
{
  const quiz_list = await loadUserQuizListFromDB(req.web_session.owner_id);
  res.json({ quizzes: quiz_list.map(transformOwnedQuizSummary), tags: my_quiz_tags });
});

//새 퀴즈 생성 - 기본값은 UserQuizListUI.addQuiz(user-quiz-list-ui.ts)와 동일 로직(winner_nickname
//고정값, is_private=true로 시작 등). creator_id/creator_name/creator_icon_url은 세션 생성 시점에
//캡처된 캐시값(req.web_session)을 쓴다 - 실제 interaction 없이도 조립 가능한 이유.
router.post('/', async (req: any, res: any) =>
{
  const validation = validateQuizMetadata(req.body);
  if(validation.valid === false)
  {
    res.status(400).json({ error: validation.error });
    return;
  }

  const user_quiz_info = new UserQuizInfo();

  user_quiz_info.data.creator_id = req.web_session.owner_id;
  user_quiz_info.data.creator_name = req.web_session.owner_name;
  user_quiz_info.data.creator_icon_url = req.web_session.owner_icon_url;
  user_quiz_info.data.quiz_title = req.body.quiz_title;
  user_quiz_info.data.thumbnail = req.body.thumbnail ?? '';
  user_quiz_info.data.simple_description = req.body.simple_description ?? '';
  user_quiz_info.data.description = req.body.description ?? '';
  user_quiz_info.data.winner_nickname = '플레이어';
  user_quiz_info.data.birthtime = new Date();
  user_quiz_info.data.modified_time = new Date();
  user_quiz_info.data.played_count = 0;
  user_quiz_info.data.played_count_of_week = 0;
  user_quiz_info.data.is_private = true;

  const quiz_id = await user_quiz_info.saveDataToDB();
  if(quiz_id === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  logger.info(`[Web] Created New Quiz... quiz_id: ${quiz_id}, owner_id: ${req.web_session.owner_id}`);
  res.status(201).json(transformOwnedQuizSummary(user_quiz_info));
});

//상세 - 메타데이터 전체 + 문제 목록(Phase 3에서는 프론트가 읽기 전용으로만 씀, 실제 편집은 Phase 4).
router.get('/:quiz_id', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.loadQuestionListFromDB();

  res.json({
    ...transformOwnedQuizDetail(owned_quiz),
    questions: owned_quiz.question_list.map(transformQuestionForApi),
    tags: my_quiz_tags, //태그 편집 UI가 상세 화면 자체에서 완결되도록 목록 API와 동일하게 동봉
  });
});

//메타데이터 수정 - user-quiz-info.ui.ts의 editQuizInfo와 동일 로직(simple_description에
//removeMarkdownSpecialChars 적용, creator_name/icon 갱신 포함).
router.put('/:quiz_id', requireQuizOwnership, async (req: any, res: any) =>
{
  const validation = validateQuizMetadata(req.body);
  if(validation.valid === false)
  {
    res.status(400).json({ error: validation.error });
    return;
  }

  const owned_quiz = req.owned_quiz;

  owned_quiz.data.quiz_title = req.body.quiz_title;
  owned_quiz.data.thumbnail = req.body.thumbnail ?? '';
  owned_quiz.data.simple_description = utility.removeMarkdownSpecialChars(req.body.simple_description ?? '');
  owned_quiz.data.description = req.body.description ?? '';
  owned_quiz.data.modified_time = new Date();
  owned_quiz.data.creator_name = req.web_session.owner_name;
  owned_quiz.data.creator_icon_url = req.web_session.owner_icon_url;

  const saved = await owned_quiz.saveDataToDB();
  if(saved === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  logger.info(`[Web] Edited Quiz info... quiz_id: ${owned_quiz.quiz_id}`);
  res.json(transformOwnedQuizSummary(owned_quiz));
});

//태그 수정 - user-quiz-info.ui.ts의 editTagsInfo와 동일하게 modified_time은 건드리지 않는다.
//알려진 비트로 마스킹하는 것만 디스코드보다 엄격한 서버 측 추가 검증(위 VALID_TAG_MASK 참고).
router.put('/:quiz_id/tags', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;

  const raw_tags_value = Number(req.body?.tags_value);
  const tags_value = (isNaN(raw_tags_value) ? 0 : raw_tags_value) & VALID_TAG_MASK;

  owned_quiz.data.tags_value = tags_value;

  const saved = await owned_quiz.saveDataToDB();
  if(saved === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  logger.info(`[Web] Edited Quiz Tag... quiz_id: ${owned_quiz.quiz_id}`);
  res.json({ tags_value });
});

//공개/비공개 토글 - user-quiz-info.ui.ts의 quiz_toggle_public과 동일: 비공개->공개 전환 시에만
//canGoPublic(태그 1개 이상) 체크. 토글형이라 클라이언트가 현재 상태를 안 보내도 되고 경쟁 상태에 안전.
router.post('/:quiz_id/toggle-public', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;

  if(owned_quiz.data.is_private === true && canGoPublic(owned_quiz.data.tags_value) === false)
  {
    res.status(400).json({ error: 'tags_required' });
    return;
  }

  owned_quiz.data.is_private = !owned_quiz.data.is_private;

  const saved = await owned_quiz.saveDataToDB();
  if(saved === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  logger.info(`[Web] Edited Quiz Public/Private...value:${owned_quiz.data.is_private} quiz_id: ${owned_quiz.quiz_id}`);
  res.json({ is_private: owned_quiz.data.is_private });
});

//삭제 - disableQuizInfo(soft delete)만. 관리자 삭제+영구밴은 이번 웹 MVP에서 제외(확정 사항,
//디스코드 /quizmgr 관리자 패널에는 계속 존재).
router.delete('/:quiz_id', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.delete();

  logger.info(`[Web] Deleted Quiz... quiz_id: ${owned_quiz.quiz_id}, owner_id: ${req.web_session.owner_id}`);
  res.json({ success: true });
});

//======================================================================================
// 문제(Question) CRUD - Phase 4. custom_quiz_components.ts의 각 모달 setMaxLength값과 동일한
// 길이 제한(위 QUIZ_TITLE_MAX_LENGTH류와 같은 관행).
//======================================================================================

const QUESTION_ANSWERS_MAX_LENGTH = 100;
const QUESTION_LONG_TEXT_MAX_LENGTH = 500; //question_text/hint/answer_text 공통
const QUESTION_URL_MAX_LENGTH = 500; //오디오/이미지 URL 6곳 공통
const QUESTION_AUDIO_RANGE_ROW_MAX_LENGTH = 40; //answer_audio_range_row는 디스코드 모달에도 길이 제한이 없어 여기서도 안 둠

const has = (body: any, key: string): boolean => Object.prototype.hasOwnProperty.call(body ?? {}, key);

//OX/MULTIPLE_CHOICE/SHORT_ANSWER 외의 값이 화이트리스트 없이 그대로 저장되던 문제(웹 API 보안 점검,
//docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md 작업 2-C 구멍 1) 방지용.
const VALID_ANSWER_TYPES = [ANSWER_TYPE.SHORT_ANSWER, ANSWER_TYPE.OX, ANSWER_TYPE.MULTIPLE_CHOICE];

//user-question-info-ui.ts의 3개 모달 필드 검증을 하나로 합침 - is_partial=true(PUT)면 body에 실린
//키만 검사한다(생략된 필드는 기존 저장값을 그대로 유지하므로 다시 검사할 필요 없음).
const validateQuestionFields = (body: any, is_partial: boolean): { valid: boolean; error?: string } =>
{
  if(is_partial === false || has(body, 'answers'))
  {
    //비문자열(숫자/배열/객체 등)이면 .trim() 호출 자체가 TypeError를 던져 요청이 그대로 죽을 수 있었음
    //(위 checkOptionalStringField 주석과 동일한 구멍) - 타입부터 먼저 확인한다.
    if(typeof body?.answers !== 'string')
    {
      return { valid: false, error: 'invalid_answers' };
    }

    const answers = body.answers.trim();
    if(answers.length === 0 || answers.length > QUESTION_ANSWERS_MAX_LENGTH)
    {
      return { valid: false, error: 'invalid_answers' };
    }
  }

  const long_text_fields = ['question_text', 'hint', 'answer_text'];
  for(const field of long_text_fields)
  {
    const check = checkOptionalStringField(has(body, field) ? body[field] : undefined, QUESTION_LONG_TEXT_MAX_LENGTH);
    if(check === 'invalid_type')
    {
      return { valid: false, error: `invalid_${field}` };
    }
    if(check === 'too_long')
    {
      return { valid: false, error: `${field}_too_long` };
    }
  }

  const url_fields = ['question_audio_url', 'question_image_url', 'hint_image_url', 'answer_audio_url', 'answer_image_url'];
  for(const field of url_fields)
  {
    const check = checkOptionalStringField(has(body, field) ? body[field] : undefined, QUESTION_URL_MAX_LENGTH);
    if(check === 'invalid_type')
    {
      return { valid: false, error: `invalid_${field}` };
    }
    if(check === 'too_long')
    {
      return { valid: false, error: `${field}_too_long` };
    }
  }

  const audio_range_row_check = checkOptionalStringField(has(body, 'audio_range_row') ? body.audio_range_row : undefined, QUESTION_AUDIO_RANGE_ROW_MAX_LENGTH);
  if(audio_range_row_check === 'invalid_type')
  {
    return { valid: false, error: 'invalid_audio_range_row' };
  }
  if(audio_range_row_check === 'too_long')
  {
    return { valid: false, error: 'audio_range_row_too_long' };
  }

  if(has(body, 'answer_type') && VALID_ANSWER_TYPES.includes(body.answer_type) === false)
  {
    return { valid: false, error: 'invalid_answer_type' };
  }

  return { valid: true };
};

//UserQuestionInfoUI의 applyQuestionInfo/applyQuestionAdditionalInfo/applyQuestionAnsweringInfo(3개
//모달 핸들러)를 단일 함수로 합친 버전 - is_partial=false(POST)면 항상 전체 필드를 반영(생략된 필드는
//빈 값으로), is_partial=true(PUT)면 body에 실린 필드만 반영(생략된 필드는 기존 값 유지).
const applyQuestionFields = (question_info: any, body: any, is_partial: boolean): void =>
{
  if(is_partial === false || has(body, 'answers'))
  {
    question_info.data.answers = body.answers ?? '';
  }

  if(is_partial === false || has(body, 'question_audio_url'))
  {
    question_info.data.question_audio_url = body.question_audio_url ?? '';
  }

  if(is_partial === false || has(body, 'audio_range_row'))
  {
    const audio_range_row = body.audio_range_row ?? '';
    question_info.data.audio_range_row = audio_range_row;

    const [audio_start, audio_end, audio_play_time] = parseAudioRangePoints(audio_range_row);
    question_info.data.audio_start = audio_start;
    question_info.data.audio_end = audio_end;
    question_info.data.audio_play_time = audio_play_time;
  }

  if(is_partial === false || has(body, 'question_image_url'))
  {
    question_info.data.question_image_url = body.question_image_url ?? '';
  }

  if(is_partial === false || has(body, 'question_text'))
  {
    question_info.data.question_text = body.question_text ?? '';
  }

  if(is_partial === false || has(body, 'hint'))
  {
    question_info.data.hint = body.hint ?? '';
  }

  if(is_partial === false || has(body, 'hint_image_url'))
  {
    question_info.data.hint_image_url = body.hint_image_url ?? '';
  }

  if(is_partial === false || has(body, 'question_audio_repeat'))
  {
    question_info.data.question_audio_repeat = redefineRepeatCount(body.question_audio_repeat);
  }

  //웹은 실제 체크박스가 있어 boolean을 직접 받음(디스코드 전용 문자열 매칭 parseUseAnswerTimer는 안 씀)
  if(is_partial === false || has(body, 'use_answer_timer'))
  {
    question_info.data.use_answer_timer = body.use_answer_timer === true;
  }

  if(is_partial === false || has(body, 'answer_audio_url'))
  {
    question_info.data.answer_audio_url = body.answer_audio_url ?? '';
  }

  if(is_partial === false || has(body, 'answer_audio_range_row'))
  {
    const answer_audio_range_row = body.answer_audio_range_row ?? '';
    question_info.data.answer_audio_range_row = answer_audio_range_row;

    const [answer_audio_start, answer_audio_end, answer_audio_play_time] = parseAudioRangePoints(answer_audio_range_row);
    question_info.data.answer_audio_start = answer_audio_start;
    question_info.data.answer_audio_end = answer_audio_end;
    question_info.data.answer_audio_play_time = answer_audio_play_time;
  }

  if(is_partial === false || has(body, 'answer_image_url'))
  {
    question_info.data.answer_image_url = body.answer_image_url ?? '';
  }

  if(is_partial === false || has(body, 'answer_text'))
  {
    question_info.data.answer_text = body.answer_text ?? '';
  }

  if(is_partial === false || has(body, 'answer_type'))
  {
    question_info.data.answer_type = body.answer_type ?? ANSWER_TYPE.SHORT_ANSWER;
  }
};

//문제 추가 - DB에 quiz_id 단건으로 문제를 조회하는 함수가 없어(selectQuestionInfo는 quiz_id 전체 조회만
//가능), 개수 체크를 위해 매번 loadQuestionListFromDB()로 전체를 로드한다(GET /:quiz_id와 동일 패턴).
router.post('/:quiz_id/questions', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.loadQuestionListFromDB();

  if(owned_quiz.question_list.length >= SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ)
  {
    res.status(400).json({ error: 'max_questions_reached' });
    return;
  }

  const validation = validateQuestionFields(req.body, false);
  if(validation.valid === false)
  {
    res.status(400).json({ error: validation.error });
    return;
  }

  const user_question_info = new UserQuestionInfo();
  user_question_info.data.quiz_id = owned_quiz.quiz_id;
  applyQuestionFields(user_question_info, req.body, false);

  const question_id = await user_question_info.saveDataToDB();
  if(question_id === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  await owned_quiz.updateModifiedTime();

  logger.info(`[Web] Created New Question... question_id: ${question_id}, quiz_id: ${owned_quiz.quiz_id}, owner_id: ${req.web_session.owner_id}`);
  res.status(201).json(transformQuestionForApi(user_question_info));
});

//문제 수정 - 동일 필드 집합의 partial update. question_id가 실제로 그 quiz_id에 속하는지
//loadQuestionListFromDB() 결과에서 재확인(없으면 404 - 다른 퀴즈 소속이거나 존재하지 않는 문제).
router.put('/:quiz_id/questions/:question_id', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.loadQuestionListFromDB();

  const question_id = parseInt(req.params.question_id);
  const user_question_info = owned_quiz.question_list.find((q: any) => q.question_id === question_id);
  if(user_question_info === undefined)
  {
    res.status(404).json({ error: 'question_not_found' });
    return;
  }

  const validation = validateQuestionFields(req.body, true);
  if(validation.valid === false)
  {
    res.status(400).json({ error: validation.error });
    return;
  }

  applyQuestionFields(user_question_info, req.body, true);

  const saved_question_id = await user_question_info.saveDataToDB();
  if(saved_question_id === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  await owned_quiz.updateModifiedTime();

  logger.info(`[Web] Edited Question... question_id: ${question_id}, quiz_id: ${owned_quiz.quiz_id}`);
  res.json(transformQuestionForApi(user_question_info));
});

//문제 삭제 - deleteQuestionInfo(hard delete). UserQuestionInfoUI의 question_delete 핸들러와 동일.
router.delete('/:quiz_id/questions/:question_id', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.loadQuestionListFromDB();

  const question_id = parseInt(req.params.question_id);
  const user_question_info = owned_quiz.question_list.find((q: any) => q.question_id === question_id);
  if(user_question_info === undefined)
  {
    res.status(404).json({ error: 'question_not_found' });
    return;
  }

  await user_question_info.delete();
  await owned_quiz.updateModifiedTime();

  logger.info(`[Web] Deleted Question... question_id: ${question_id}, quiz_id: ${owned_quiz.quiz_id}, owner_id: ${req.web_session.owner_id}`);
  res.json({ success: true });
});

//문제 복제 - UserQuestionInfoUI의 duplicateQuestion과 동일하게 cloneDeep(source.data)로 복사(question_id
//는 새 인스턴스라 애초에 없음). question_id 오름차순 정렬이 유일한 정렬 기준이라, 복제된 문제는
//재조회 시 항상 목록 맨 뒤에 위치한다(디스코드의 "바로 다음 위치에 삽입" 연출은 그 UI 인스턴스의
//메모리상 배열에서만 유효한 것 - WEB_QUIZ_CREATION_PLAN.md 확정 사항, 웹은 이 연출을 재현하지 않음).
router.post('/:quiz_id/questions/:question_id/duplicate', requireQuizOwnership, async (req: any, res: any) =>
{
  const owned_quiz = req.owned_quiz;
  await owned_quiz.loadQuestionListFromDB();

  if(owned_quiz.question_list.length >= SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ)
  {
    res.status(400).json({ error: 'max_questions_reached' });
    return;
  }

  const question_id = parseInt(req.params.question_id);
  const source_question_info = owned_quiz.question_list.find((q: any) => q.question_id === question_id);
  if(source_question_info === undefined)
  {
    res.status(404).json({ error: 'question_not_found' });
    return;
  }

  const user_question_info = new UserQuestionInfo();
  user_question_info.data = cloneDeep(source_question_info.data);

  const new_question_id = await user_question_info.saveDataToDB();
  if(new_question_id === undefined)
  {
    res.status(500).json({ error: 'save_failed' });
    return;
  }

  await owned_quiz.updateModifiedTime();

  logger.info(`[Web] Duplicated Question... source_question_id: ${question_id}, new_question_id: ${new_question_id}, quiz_id: ${owned_quiz.quiz_id}`);
  res.status(201).json(transformQuestionForApi(user_question_info));
});

module.exports = { router, requireOwnerScopedSession };
