# 퀴즈 만들기 웹 UI 제공 — 구현 계획

> `docs/plans/WEB_INTEGRATION_PLAN.md`(퀴즈 *선택* 웹 연동)와 대칭되는 문서. 그쪽은 "이미 있는 퀴즈를
> 고르는" 흐름을 웹으로 옮겼고, 이 문서는 "퀴즈를 새로 만들고 편집하는" 흐름(`/퀴즈만들기` →
> `createQuizToolUIHolder` → `UserQuizListUI` → `UserQuizInfoUI` → `UserQuestionInfoUI`)을 웹으로
> 옮기는 작업을 다룬다. 인수인계 배경은 `docs/plans/WEB_QUIZ_CREATION_HANDOFF.md` 참고.

## Context

기존 "퀴즈 선택" 웹 연동(`docs/plans/WEB_INTEGRATION_PLAN.md`, Phase 1~4, 완료·운영 중)은 "이미 있는 퀴즈를
고르는" 흐름만 웹으로 옮겼다. 이번 요청은 "퀴즈를 새로 만들고 편집하는" 흐름을 웹으로 옮기는 것 —
`docs/plans/WEB_QUIZ_CREATION_HANDOFF.md`(설계 착수 전 인수인계 문서)의 후속 세션 산출물이다. 설계 세션에서
핵심 설계 결정을 사용자와 확정했고, 아래는 그 결정들을 반영한 구체적 구현 계획이다.

## 조사에서 확정된 핵심 사실 (설계 전제)

1. **`/퀴즈만들기`는 DM 전용이다** (`quizbot/bot.js`의 `create_quiz_handler`가 길드에서 호출되면 즉시
   DM으로 유도 후 리턴). 퀴즈 제작 UIHolder는 항상 `UI_HOLDER_TYPE.PRIVATE`(`holder_id = user_id`) —
   길드 개념 자체가 없다. Discord DM은 봇-유저 1:1이라 기존 선택 플로우의 하이재킹 방어
   (`force_take`/`already_locked`)는 이번 기능엔 애초에 불필요 — **선택 플로우보다 설계가 단순해지는
   지점**.
2. DB/매니저 계층(`db_quiz.ts`, `user_quiz_info_manager.ts`)은 이미 `interaction`과 완전히 무관해서
   마스터가 직접 호출 가능. 유일하게 discord.js Client가 필요한 지점은 `creator_name`/
   `creator_icon_url` 캡처(`interaction.user.displayName`/`avatarURL()`) — **세션 생성 시점에 클러스터가
   1회 캡처해 세션 객체에 실어두고, 이후 REST 요청은 캐시값 사용**(세션 도중 닉네임/아바타 변경은
   반영 안 됨 — 확인된 트레이드오프).
3. 마스터 DB 풀은 `multiplayer_manager.initialize(manager)`(`index.js:39`) 내부의
   `db_manager.initialize()` 호출로 이미 초기화돼 있음(암묵적 의존 — 향후 그 호출이 제거/이동되면
   조용히 깨짐, 문서화 필요).
4. 제작자 본인의 퀴즈 "목록"은 이미 문제없이 공개/비공개 전부 가져올 수 있다 —
   `selectQuizInfo(creator_id)`(`db_quiz.ts:13`, `is_private` 필터 없음, `creator_id`로만 제한)가
   `loadUserQuizListFromDB(creator_id)`를 거쳐 디스코드 `UserQuizListUI`가 이미 이 방식으로 본인 퀴즈
   전체를 보여주고 있음 — **여기엔 문제 없음, 그대로 재사용**. 문제는 그거와 다른 함수인
   `selectQuizInfoById(quiz_id)`(단건, `db_quiz.ts:41`, 선택 플로우 Phase 2에서 "공개 퀴즈 고르기" 용으로
   신설돼 `is_private = false`가 박혀있음) 쪽이다 — 웹 편집기가 브라우저에서 `/quiz/:quizId`로 직접
   새로고침/딥링크할 때는 목록이 메모리에 없어 quiz_id 단건 조회가 필요한데, 이 함수는 비공개 퀴즈를
   걸러버려서 편집 중인 비공개 퀴즈가 안 보인다. 그래서 소유권 기반의 새 단건 조회 함수
   (`selectOwnedQuizInfoById(quiz_id, creator_id)`, Phase 3에서 추가)가 필요하다.
5. 문제 순서 재정렬 기능은 DB 어디에도 없음(`order by question_id asc`가 유일 정렬 기준). 디스코드의
   "복제 시 바로 다음 위치에 삽입"은 그 UI 인스턴스의 메모리상 배열에서만 유효한 연출(재조회 시 맨 뒤로
   이동) — 이번 범위에 진짜 재정렬 기능은 포함하지 않음(사용자 확정).
6. 선택 플로우는 "채널 임베드가 웹 조작에 실시간 반영"이 핵심이었지만(다른 길드원도 보므로), 퀴즈
   만들기는 DM이라 보는 사람이 본인 1명뿐 — `select`/`apply`류의 잦은 브로드캐스트가 불필요하다. DM
   잠금 화면은 "웹에서 편집 중 + 링크" 정적 화면으로 충분하고, 실질적으로 필요한 신호는 세션 생성(링크
   발급)과 GC 만료(링크 무효화 안내)뿐 — Phase 1 범위가 선택 플로우보다 크게 줄어든다.

## 사용자가 확정한 설계 결정

1. **범위**: B-1(문제 일괄 등록 Export/Import, `docs/plans/B1_BULK_IMPORT_EXPORT_TODO.md`)은 완전히 별도 —
   이번 계획에 포함 안 함.
2. **락 UX**: 기존 토큰/락/하트비트/GC 패턴 재사용(단, 길드가 아니라 유저 단위로 스코프 일반화).
3. **진입점**: `/퀴즈만들기`에도 `SelectUIModeUI`와 동일한 "디스코드 UI/웹 UI" 2트랙 분기 추가.
4. **리팩터**: `user-question-info-ui.ts`(파일 자체가 "건드릴 엄두 안 난다"고 경고하는 파일)의
   인터랙션-비의존 검증/비즈니스 로직을 공유 모듈로 추출하며 실제로 정리 — 얇은 wrapper만 씌우지 않음.
5. **이미지/오디오 입력**: URL 입력만 지원(기존 디스코드와 동일, 파일 업로드 없음).
6. **이미지 표시**: 웹은 브라우저가 `<img src>`를 바로 재로드하므로, 디스코드의 `sendDelayedUI` 강제
   재전송 워크어라운드가 불필요 — 그대로 렌더만 하면 됨.
7. **오디오 미리듣기**: 웹은 `generatePreviewClipStream`(ffmpeg 클립) 백엔드를 쓰지 않고, 실제 유튜브
   영상을 `?t=<audio_start>` 타임스탬프로 링크/임베드해서 미리듣기를 대체 — 새 스트리밍 엔드포인트
   불필요. (`audio_start`/`audio_end`/`audio_play_time`은 실제 퀴즈 진행 시 쓰이므로 데이터 필드로는
   계속 저장.)
8. **`scope_id` 리네임**: 이미 실사용 검증된 Phase 1~4 코드(`web_session_manager.ts`,
   `ui-system-core.ts`, `bot.js`)의 브로드캐스트 시그널 필드명 `guild_id`를 `scope_id`로 일반화해서
   길드/유저 스코프를 동일 경로로 처리(별도 필드 추가 대신 리네임 — 코드가 더 깔끔해지는 대신 회귀
   테스트 필수).
9. **관리자 "삭제+영구밴"**: 이번 웹 MVP에서 제외(디스코드 `/quizmgr` 관리자 패널에는 계속 존재).
10. **프론트엔드 구조**: `web-frontend`에 `react-router-dom` 신규 도입 + 별도 Vite 멀티페이지 진입점
    (`editor.html`)으로 목록→상세→문제편집 계층형 라우팅 구현.

### 그 외 채택한 실행 세부사항

- REST 네임스페이스는 기존 `/api/user-quizzes`(선택 플로우 전용) 재사용 대신 `/api/my-quizzes` 신설.
- 디스코드의 3-모달 분리는 UI 제약 때문이지 비즈니스 규칙이 아니므로, 웹 REST는 문제 하나당 단일
  PUT/POST 엔드포인트로 통합.
- `use_answer_timer`는 디스코드에서 문자열 매칭이 필요했지만 웹은 boolean을 직접 받음(문자열 매칭
  함수는 디스코드 전용으로 유지).
- 공개 전환은 `POST /:quiz_id/toggle-public`(토글형).
- 공유 검증 모듈 이름: `quizbot/managers/quiz_editor_validation.ts`.
- `MAX_QUESTIONS_PER_QUIZ=50`을 `config/system_setting.js`(`SYSTEM_CONFIG`)로 승격.
- "현재 편집 중: OO퀴즈" 같은 디스코드 임베드 실시간 표시는 MVP에서 제외(Phase 5에 선택 항목으로만
  남김).

## Phase 0 — UI 목업 ✅ 완료 (2026-08-11)

`docs/mockups/WEB_QUIZ_CREATION_UI_MOCKUP.html` — 퀴즈 목록/퀴즈 상세/문제 편집 3화면 + "실제 디스코드에선
이렇게 보여요" 미리보기(문제 출제 중/힌트/정답 공개 3상태)를 정적 HTML로 구현, 사용자 승인 완료.
코드/DB/세션 인프라는 전혀 안 건드림.

## Phase 1 — 세션 스코프 일반화 + 진입점 스켈레톤 + 구조 문서화 ✅ 완료 (이 세션)

목표: user-scoped(owner_id 기준) 웹 세션 인프라 + DM 투트랙 진입 화면 + 잠금 화면. 퀴즈 CRUD는 아직
없음(잠금 화면은 "편집 링크"만 제공, 클릭 시 플레이스홀더).

- `web_session_manager.ts`: `scope`/`scope_id`/`owner_name`/`owner_icon_url` 필드, `owner_token_map`,
  `createOwnerScopedSession`/`releaseOwnerScopedSession`, `broadcast(scope_id,...)` 리네임,
  `runGC()`의 scope별 분기, `handleRequest`에 `create_owner_session`/`release_owner_session` 액션.
- `web_express_app.ts`: `GET /api/session` 응답에 `scope`/`scope_id`/`owner_name` 추가(기존 `guild_id`
  필드 유지, 하위 호환).
- `ui-system-core.ts`: `UIHolder.free()`가 PRIVATE 홀더면 `release_owner_session` 추가 전송,
  `relayWebSessionSignal`이 `.scope_id`로 라우팅, 신규 `createQuizEditWebHandoffUIHolder`,
  `createQuizToolUIHolder`의 최초 화면을 `QuizEditSelectUIModeUI`로 교체.
- 신규 `quiz-edit-select-ui-mode-ui.ts`(`QuizEditSelectUIModeUI`)/`quiz-edit-web-handoff-ui.ts`
  (`QuizEditWebHandoffUI`) — DM 전용이라 하이재킹 방어 없음.
- `config/system_setting.js`에 `MAX_QUESTIONS_PER_QUIZ: 50` 추가(상수만, 교체는 Phase 2).
- 프론트엔드: `web-frontend/editor.html` + `editor-main.jsx`(Vite 멀티페이지), `QuizEditorApp.jsx`(세션
  부트스트랩 플레이스홀더), `react-router-dom` 의존성 추가(실사용은 Phase 3부터).

상세 실행 로그는 `docs/COMPLETED_WORK_LOG.md`, 착수 전 확정된 실행 계획 원본은
`C:\Users\wjswo\.claude\plans\gleaming-foraging-planet.md`/`staged-seeking-twilight.md` 참고.

## Phase 2 — 공유 검증 모듈 추출 + 디스코드 쪽 리팩터 ✅ 완료 (2026-08-11)

목표: `user-question-info-ui.ts`/`user-quiz-info.ui.ts`의 인터랙션-비의존 로직을 공용 모듈로 추출하고
디스코드 UI가 그 모듈을 호출하도록 리팩터.

- 신규 `quizbot/managers/quiz_editor_validation.ts` — 순수 함수 7개: `parseAudioRangePoints`,
  `redefineRepeatCount`, `parseUseAnswerTimer`, `isValidAudioUrl`/`isValidImageUrl`,
  `isDiscordCdnLink`, `canGoPublic`.
- `user-question-info-ui.ts`(호출부 8곳 교체: 오디오 구간 파싱 2곳, 반복횟수 1곳, 타이머 문자열 매칭
  1곳, 오디오/이미지 URL 검증 5곳, cdn 링크 검증 3곳, 매직넘버 50→`SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ`
  3곳)/`user-quiz-info.ui.ts`(`quiz_toggle_public` 1곳)를 위 함수들로 호출부 전면 교체(동작 변경 없는
  순수 이관 — 원본 메서드 `parseAudioRangePoints`/`redefineRepeatCount`는 클래스에서 삭제).
  `sendDelayedUI`/`sendAudioPreview`/`duplicateQuestion`의 디스코드 전용 우회는 100% 유지.
- 신규 `test/managers/quiz_editor_validation.test.js`(21건 - 경계값 전부). 검증:
  `npx tsc --noEmit`/`npm run lint`(0 error)/`npm test`(295 pass)/`npm run build` 전부 통과.

## Phase 3 — 퀴즈 메타데이터 REST CRUD ✅ 완료 (2026-08-11)

목표: 퀴즈 생성/목록/상세/수정/태그/공개토글/삭제. 문제(question) CRUD는 Phase 4.

- `db_quiz.ts`에 `selectOwnedQuizInfoById(quiz_id, creator_id)`(`is_private` 필터 없이 `creator_id`로
  소유권을 DB 레벨에서 강제), `user_quiz_info_manager.ts`에 `loadOwnedUserQuizInfoById` — 둘 다 기존
  `selectQuizInfoById`/`loadUserQuizInfoById`와 동일 패턴.
- 신규 `quizbot/managers/web/web_quiz_editor_routes.ts`(Express Router, `/api/my-quizzes`) —
  `web_express_app.ts`에 `app.use('/api/my-quizzes', requireWebSession, requireOwnerScopedSession,
  router)`로 마운트. `requireOwnerScopedSession`(scope!=='owner'면 403)/`requireQuizOwnership`
  (`loadOwnedUserQuizInfoById`로 조회, 없으면 404, 있으면 `req.owned_quiz`에 담아 재조회 방지) 미들웨어.
  `GET /`(목록+태그), `POST /`(생성, `UserQuizListUI.addQuiz`와 동일 기본값), `GET /:quiz_id`(메타데이터+
  문제 목록+`quiz_editor_validation`으로 계산한 문제별 검증 플래그), `PUT /:quiz_id`(`editQuizInfo`와
  동일 로직, 글자수 서버 검증), `PUT /:quiz_id/tags`(알려진 비트로 마스킹), `POST /:quiz_id/toggle-public`
  (`canGoPublic` 체크), `DELETE /:quiz_id`(소프트 삭제, 관리자 삭제+밴은 제외).
- 프론트엔드: `web-frontend/src/editor/EditorApi.js`(신규 클라이언트, 토큰은 `api.js` 싱글턴 재사용),
  `QuizListPage.jsx`(목록+생성 폼), `QuizDetailPage.jsx`(메타데이터 수정+태그+공개토글+삭제, 삭제 전
  2클릭 확인으로 디스코드 UX와 동등하게). `QuizEditorApp.jsx`에 `react-router-dom`
  `BrowserRouter basename="/editor"` 배선(`/` → 목록, `/quiz/:quizId` → 상세). 문제 목록은 이 phase에선
  검증 플래그(⚠️)만 보여주는 읽기 전용 placeholder.
- 검증: 신규 `test/managers/web/web_quiz_editor_routes.test.js`(14건 - CRUD 왕복, 소유권 403/404, 글자수
  400, 태그 마스킹, toggle-public 태그 검증), `db_manager.test.js`/`user_quiz_info_manager.test.js`에
  `selectOwnedQuizInfoById`/`loadOwnedUserQuizInfoById` 검증 추가. `npx tsc --noEmit`/`npm run lint`
  (0 error)/`npm test`(312 pass)/양쪽 `npm run build` 전부 통과. **미검증** — 실제 Discord+브라우저
  테스트 전무.

**Phase 3 UI 피드백 3건 반영 (2026-08-11, 같은 세션)**: (1) 퀴즈 상세 화면에 썸네일 미리보기가 없던
문제 - 우측에 "다른 사람들에게 이렇게 보여요" 카드(`QuizDetailCard.jsx`, 퀴즈 선택 웹 연동의
`UserQuizTab.jsx`/`OmakaseTab.jsx`가 이미 쓰던 컴포넌트를 그대로 재사용) 추가, 저장된 값이 아니라
지금 입력 중인 `form` 상태를 실시간으로 먹여서 타이핑 즉시 반영됨(Phase 0 목업 단계에서 "퀴즈 상세엔
디스코드 raw embed 대신 선택 플로우와 동일한 상세 카드"로 이미 방향이 정해져 있었음 - 그 결정을 실제
구현에 반영). (2) 탐색기 스타일 breadcrumb("내 퀴즈" 텍스트 클릭)만 있어 발견성이 낮던 문제 -
breadcrumb 우측에 명시적 `←` 아이콘 버튼(`.icon-btn`) 추가. (3) 퀴즈 만들기 웹 UI에 테마 토글 자체가
없어 다크모드가 강제되던 문제 - 기존 `App.jsx`에 인라인으로 있던 `ThemeToggle`을 `ThemeToggle.jsx`로
분리해 `App.jsx`/`QuizEditorApp.jsx` 둘 다 공유(기본값은 라이트, 2026-08-09 결정 그대로 유지). 검증:
양쪽 `npm run build` 통과, 백엔드 변경 없음(프론트엔드 전용 수정이라 `npm test`/`tsc`/`lint` 재실행
불필요).

## Phase 4 — 문제(Question) CRUD REST + 프론트 문제 편집기 ✅ 완료 (2026-08-11)

- `web_quiz_editor_routes.ts`에 문제 CRUD 4개(전부 `requireQuizOwnership` 경유): `POST
  /:quiz_id/questions`(최대 `MAX_QUESTIONS_PER_QUIZ` 체크→`validateQuestionFields`→
  `applyQuestionFields`(is_partial=false)→저장), `PUT /:quiz_id/questions/:question_id`(partial update,
  `is_partial=true`, `question_id`가 `loadQuestionListFromDB()` 결과에 있는지 재확인, 없으면 404),
  `DELETE /:quiz_id/questions/:question_id`(hard delete), `POST
  /:quiz_id/questions/:question_id/duplicate`(`cloneDeep(source.data)`, 최대 개수 체크). 신규 헬퍼
  `applyQuestionFields`/`validateQuestionFields`가 `UserQuestionInfoUI`의 3개 모달 핸들러를 단일 함수로
  합침 — `quiz_editor_validation.ts`(Phase 2)의 `parseAudioRangePoints`/`redefineRepeatCount` 그대로
  재사용. DB에 문제 단건 조회 함수가 없어 개수 체크/소속 확인 모두 `loadQuestionListFromDB()`로 매번
  전체를 로드(GET `/:quiz_id`와 동일 패턴).
- 디스코드 쪽은 Phase 2에서 이미 `quiz_editor_validation.ts`를 쓰도록 리팩터 완료된 상태라 이번 phase에서
  전혀 안 건드림(코드 재확인만 함).
- 프론트엔드: 신규 `QuestionEditPage.jsx`(디스코드 3모달을 탭 3개로 합친 단일 폼, 승인된
  `WEB_QUIZ_CREATION_UI_MOCKUP.html` 레이아웃 구현 — 정답 유형 세그먼트+OX/객관식 선택 버튼, 오디오
  구간은 숫자 입력 2개→제출 시 `"40~80"` 문자열로 합쳐 `parseAudioRangePoints`가 그대로 파싱). 이미지는
  `<img src>` 직접 표시, 오디오는 유튜브 `?t=<초>` 링크로 미리듣기 대체. `isDiscordCdnLink`는 백엔드 CJS
  전용이라 프론트에 한 줄 로직을 복제해 실시간 체크, `is_valid_*`는 수정 모드의 서버 스냅샷만 배지로
  표시. `QuizDetailPage.jsx`의 문제 목록 placeholder를 실제 추가/수정/복제/삭제 패널로 교체(50개 도달
  시 비활성화, 삭제 2클릭 확인, 복제 후 전체 재조회 — 정렬 특성상 항상 맨 뒤에 생기므로 낙관적 삽입
  안 함). `QuizEditorApp.jsx`에 `/quiz/:quizId/questions/new`, `/quiz/:quizId/questions/:questionId`
  라우트 추가. 기존 CSS 클래스(`tabrail`/`mode-switch`/`tag-chip`/`tree-row`/`icon-btn`/`switch-field`)만
  재사용, 신규 CSS 없음.
- 검증: `web_quiz_editor_routes.test.js`에 10건 추가(최대 개수 초과, 필수값 누락, 오디오 구간 파싱+
  기본 answer_type, partial update 필드 유지, 소유권 위반 404, 삭제/복제 데이터 검증).
  `npx tsc --noEmit`/`npm run lint`(0 error)/`npm test`(322 pass)/양쪽 `npm run build`/컴파일된 라우터
  require 스모크 전부 통과. **미검증** — 실제 Discord+브라우저 테스트 전무, Phase 5에서 최우선.

**Phase 4 UI 피드백 4건 반영 (2026-08-12, 같은 세션)**: 최초 구현이 승인된 Phase 0 목업의 설계 상당수를
놓쳤던 걸 사용자가 지적함(문제 목록 행 시인성, 명시적 수정 버튼, 유형/정답값/내용 태그로 문제 구별,
그리고 무엇보다 "실제 디스코드에선 이렇게 보여요" 실시간 미리보기 패널 자체가 통째로 빠졌던 것 — Phase
4 계획 수립 당시 이 미리보기를 "Phase 0 데모 전용"으로 잘못 스코프 아웃한 게 원인). 목업 JS
(`renderQuestionEmbed`/`renderHintEmbed`/`renderAnswerEmbed`/`computeContentTags` 등)를 다시 정독하고
실제 코드(`question.ts`의 `createQuestionUI`/`startProgressBar`, `correct_answer.ts`,
`config/text_contents.json`의 `quiz_play_ui`/`correct_answer_ui`/`icon.ICON_PROGRESS_*`,
`user-quiz-info.ui.ts`의 `ICON_CUSTOM_QUIZ` 대입)까지 대조해 이식했다.
- 신규 `web-frontend/src/editor/questionDisplay.jsx` — `QuizDetailPage.jsx`/`QuestionEditPage.jsx`가
  공유하는 표시 로직. `ANSWER_TYPE_LABEL`/`computeContentTags`/`ContentTagChips`(문제 목록 행과 편집
  화면 상단 양쪽에서 재사용) + `DiscordQuestionPreview`/`DiscordHintPreview`/`DiscordAnswerPreview`(탭에
  따라 전환되는 3가지 상태의 디스코드 임베드 시뮬레이션, `approximateAutoHint`로 실제 자동 힌트 마스킹
  로직까지 재현).
- `QuizDetailPage.jsx`: 문제 행을 `.question-row`(테두리 있는 카드)로 교체, 제목은 `question_text`(없으면
  "(문제 텍스트 없음)"), 유형 칩 + **"정답: {answers}" 칩**(사용자 피드백 — 주관식/OX/객관식 전부
  필수 입력값인 `answers` 필드를 그대로 보여줌) + 문제/힌트/정답 각 구역의 내용 칩. 클릭 시 편집 이동은
  유지하되 ✏️ 수정/⧉ 복제/🗑 삭제 버튼을 명시적으로 추가.
- `QuestionEditPage.jsx`: 우측에 `.detail-col` 미리보기 패널 추가 — 활성 탭(기본정보/힌트설정/
  정답공개)에 따라 `DiscordQuestionPreview`/`DiscordHintPreview`/`DiscordAnswerPreview`가 실시간
  전환. 편집 폼 상단에도 `ContentTagChips`로 지금까지 입력된 내용 요약을 추가.
- 신규 CSS(`styles.css`): `.question-row`/`.chip`(`type`/`answer`/`ctag`) + `.discord-frame`/`.df-*`
  계열(디스코드 다크 테마 색상 하드코딩 — 앱 자체 라이트/다크 토글과 무관하게 항상 같은 모습이어야
  실제 게임 화면과 비교하기 쉬움, 목업의 의도적 설계를 그대로 유지).
- 검증: 양쪽 `npm run build` 통과(백엔드 무변경이라 `npm test`/`tsc`/`lint` 재실행 불필요, 프론트엔드
  전용 수정). **미검증** — 실제 브라우저로 미리보기 정확도(힌트 자동생성 등) 확인 안 함.

**Phase 4 UI 피드백 2차 9건 반영 (2026-08-12, 같은 세션)**: 위 1차 반영 직후 사용자가 실제로 화면을
보며 준 후속 피드백. (1) 오디오 미리듣기가 새 탭 링크였던 걸 지정한 시작 지점부터 바로 재생 가능한
유튜브 인라인 임베드 플레이어(`questionDisplay.jsx`의 신규 `YoutubeEmbed`, `extractYoutubeVideoId` +
`youtube.com/embed/<id>?start=<초>`)로 교체 — 목업이 예고했던 "Phase 4 실제 웹에서는 이 자리에
플레이어가 바로 삽입돼요"를 실제로 구현. (2)+(3) 문제 목록 행에 있던 "정답: 칩"을 없애고 그 대신
답/이미지/오디오를 한 줄로 요약(`q-summary` — 정답 텍스트 truncate + 이미지·유튜브 썸네일 미니
아이콘)해서 표시, 검증 실패(URL 형식 오류) *또는* "기본 정보"(문제 텍스트/이미지/오디오) 전부가
비어 문제 자체를 구별할 단서가 없는 경우(힌트/정답공개 내용 유무와 무관) 둘 다 행 배경을 연붉은색
(`.question-row.has-error`)으로 표시. (4) `QuizListPage.jsx` 그리드 카드에 유저 퀴즈 선택 UI와 동일한
`✓ 인증` 뱃지(`thumb-badge verified`) 추가. (5) `QuizDetailCard.jsx`(선택 플로우
`UserQuizTab.jsx`/`OmakaseTab.jsx`/`MultiplayerTab.jsx`와 편집 플로우 `QuizDetailPage.jsx`가 전부 공유하는
컴포넌트)의 인증 표시를 제작자 텍스트 줄에 섞여있던 "· 인증된 퀴즈" 문구 대신 썸네일 위 뱃지로 승격
— 공유 컴포넌트라 이 수정 하나로 선택/편집 양쪽 다 동시에 일관되게 맞춰짐. (6) 정답 유형을
주관식→OX→주관식으로 오가면 이전에 입력해둔 주관식 정답이 사라지던 버그 — 유형별 draft를
`answerDrafts` state로 따로 보관해 유형을 되돌아오면 마지막 입력값이 복구되도록 수정. (7) 저장하면
퀴즈 상세로 튕겨나가던 것을 화면에 그대로 머물도록 변경("✓ 저장됨" 플래시로 피드백) — 새 문제는
저장 성공 시 URL만 `/questions/:questionId`로 조용히 교체(`navigate(..., {replace:true})`)해 이후
저장부터는 PUT으로 전환, 저장 응답의 `data`로 폼을 재동기화(서버가 클램프/정규화한 값 반영).
(8) breadcrumb에 `N/전체`(수정) 또는 `N번째로 추가`(생성) 위치 표시 칩 추가. (9) 저장 버튼 옆에
이전/다음 문제 버튼 추가(양 끝에서 자동 비활성화, 같은 퀴즈의 `question_id` 목록 순서 기준) — 저장
버튼만 파란 `toolbar-cta`, 나머지(취소/이전/다음)는 중립색 신규 `.btn-secondary`로 시각적으로 구분
(`.cta-primary`는 `width:100%` 고정이라 가로 버튼 로우에 넣으면 레이아웃이 깨지는 기존에 알려진
함정이라 안 씀). 검증: 양쪽 `npm run build` 통과(프론트엔드 전용, 백엔드 무변경). **미검증** — 실제
브라우저 테스트 전무.

**Phase 4 UI 피드백 3차 1건 반영 (2026-08-12, 같은 세션)**: 2차 피드백에서 문제 목록 행의 "문제:
텍스트,이미지" 칩(`ContentTagChips`의 `basic` 카테고리)을 q-summary 요약과 중복이라 판단해
`hideBasic`으로 숨겼었는데, 힌트/정답 칩은 그대로 있으면서 문제 칩만 없는 게 오히려 일관성이 깨진다는
피드백으로 원복 — `ContentTagChips`에서 `hideBasic` prop 자체를 제거(더 이상 쓰는 곳이 없어짐),
`QuizDetailPage.jsx` 행에서 세 카테고리(문제/힌트/정답) 칩이 다시 전부 표시됨. 검증: `npm run build`
통과.

**다음 세션 인수인계**: Phase 4는 REST/프론트 구현 + UI 피드백 3라운드까지 전부 완료됐지만 **실제
Discord+브라우저 통합 테스트가 아직 한 번도 없었다** — 다음 세션 최우선 과제. 상세 인수인계는
`docs/ACTIVE_PLAN.md`의 B-5 섹션 하단 참고.

**✅ 2026-08-12 Phase 3/4 실사용 검증 완료 (별도 세션)**: `docs/TEST_CHECKLIST.md` U/V 섹션(총 40여
항목)을 처음부터 끝까지 실제 Discord 봇 + 브라우저로 직접 확인 — 목록/생성/메타데이터/태그/공개토글/
삭제/문제 CRUD/동기화/UI 피드백 1·2차 전부 정상 동작. 검증 중 실제 버그 1건 발견 → 같은 세션에서 수정:
OX/객관식 정답 유형에서 값을 선택하지 않고 저장하면 주관식과 달리 `<input required>`가 없어 서버까지
요청이 가고, 서버가 반환한 `invalid_answers`가 그대로 화면에 raw 문자열로 노출되던 문제 —
`QuestionEditPage.jsx`의 `handleSave`에 제출 전 `form.answers === ''` 체크를 추가해 "정답을 선택하거나
입력해주세요."라는 한글 안내로 대체(프론트엔드 전용, 백엔드 무변경). 재검증까지 완료. `npm run build`
(프론트엔드) 통과.

## Phase 5 — 폴리시 + 통합 검증 ✅ 완료 (2026-08-12)

- ~~(선택) "웹에서 편집 완료" 버튼 → `close_owner_session` 액션~~ — 사용자 결정으로 이번엔 스킵(선택
  항목, 필요해지면 별도 착수).
- ~~`QuizEditorApp.jsx` 다크모드 지원~~ — Phase 3 UI 피드백 라운드에서 `ThemeToggle.jsx` 공유로 이미 완료.
- **전체 회귀**: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 58 warning 기존 수준)/`npm test`
  (324 pass)/`npm run build`(백엔드+프론트엔드) 전부 통과.
- **2클러스터 이상 강제 실행 환경 수동 시나리오**: `index.js`의 `ClusterManager` 설정을 임시로
  `shardsPerClusters:1, totalShards:2`로 바꿔 2클러스터를 강제 기동 → 디버그 로그 3곳(마스터
  브로드캐스트/각 클러스터 IPC 수신/`relayWebSessionSignal`의 로컬 UIHolder 존재 여부)을 임시로 추가해
  실측 — 같은 `scope_id` 신호에 대해 소유 클러스터는 `REACT`, 비소유 클러스터는 `DROP`으로 정확히
  갈리는 것을 로그로 확인. 검증 후 디버그 로그 제거 + `index.js` 원복 + 재시작.
- **GC 세션 만료 시나리오**: 웹 세션을 열고 브라우저 탭을 닫아 heartbeat를 끊은 뒤 15분(`WEB_SESSION_
  EXPIRE_SEC=900`) 이상 대기 → 디스코드 DM 잠금 화면이 자동으로 해제되는 것을 실사용자가 확인.
- **검증 중 발견한 사용자 피드백 2건, 같은 세션에서 즉시 수정**:
  1. 투트랙 선택 버튼(`select-ui-mode-ui.ts`/`quiz-edit-select-ui-mode-ui.ts` 공통, `base_components.ts`의
     `select_ui_mode_btn_component`)의 라벨이 숫자 `'1'`/`'2'`뿐이라 임베드 description의 안내문을
     먼저 읽어야 의미가 파악되던 문제 — 라벨을 `'디스코드 UI'`/`'웹 UI'`로 변경(공유 컴포넌트라 두
     화면 다 자동 반영), description의 중복 "1️⃣)/2️⃣)" 안내도 간소화. `customId`는 그대로 유지해
     `onInteractionCreate` 분기 로직은 무변경.
  2. "권한 가져오기"(force_take, `docs/plans/WEB_INTEGRATION_PLAN.md` 하이재킹 방어) 조사 중 발견한 레이스
     버그 — force_take가 새 토큰을 발급한 직후, 예전 소유자의 `UIHolder.free()`가 보내는 `{action:
     'release', guild_id}`가 토큰을 구분하지 않고 "그 길드에 지금 매핑된 토큰"을 지워서, 막 발급된
     새 소유자의 토큰을 즉시 무효화할 수 있었음. `web_session_manager.ts`의
     `releaseSession(guild_id, expected_token?)`에 토큰 일치 검사를 추가(불일치 시 조용히 no-op) —
     `UIHolder.free()`가 `this.ui?.token`을 `expected_token`으로 같이 넘기도록 수정, 기존
     `handleStartQuiz` 등 토큰을 모르는 호출부는 그대로 무조건 파기(하위호환). 레이스를 재현하는
     회귀 테스트 2건 추가(`test/managers/web/web_session_manager.test.js`).
- **"퀴즈 만들기 웹 UI"(Phase 0~5) 전체 완료.** 이후 추가 요청 3건(투트랙 버튼 라벨/force_take 레이스는
  위에서 이미 처리, 잔여 — 서버 설정 권한 검증 + 나머지 화면 웹 포팅)은 `docs/plans/
  WEB_UI_REMAINING_SCREENS_PLAN.md`(신규)로 분리.

## Critical Files 요약

- `quizbot/managers/web/web_session_manager.ts` — 세션 스코프 일반화(guild/owner) 핵심.
- `quizbot/quiz_ui/ui-system-core.ts` — `UIHolder.free()`/`relayWebSessionSignal`/신규 진입점 팩토리.
- `quizbot/managers/quiz_editor_validation.ts`(Phase 2, 신규) — 공유 검증 로직, Discord/REST 양쪽이 참조.
- `quizbot/managers/web/web_quiz_editor_routes.ts`(Phase 3, 신규) — 퀴즈/문제 CRUD REST 본체.
- `quizbot/quiz_ui/user-question-info-ui.ts` — 리팩터 대상(가장 예민한 파일).
- `quizbot/managers/db/db_quiz.ts` / `quizbot/managers/user_quiz_info_manager.ts` — 소유권 기반 신규
  조회 함수.
- `docs/mockups/WEB_QUIZ_CREATION_UI_MOCKUP.html` — 착수 전 UI/인게임 미리보기 목업.
