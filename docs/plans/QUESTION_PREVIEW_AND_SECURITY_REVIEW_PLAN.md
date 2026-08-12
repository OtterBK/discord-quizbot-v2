# 문제 미리보기 마크다운 지원 + 웹 API 보안 점검 (계획서/인수인계)

> **✅ 2026-08-12 별도 세션에서 작업 1/2 전부 완료.** 아래 원본 조사 내용은 그대로 남겨두되(왜 이렇게
> 했는지 근거로 유지), 완료 요약은 `docs/COMPLETED_WORK_LOG.md` 2026-08-12 "B-7" 항목과
> `docs/ACTIVE_PLAN.md` B-7 참고. 실사용(Discord+브라우저) 검증 항목은 `docs/TEST_CHECKLIST.md` Y
> 섹션(신설, 전부 미확인)에 있음 — 여유 있으면 다음 세션에 짧게 훑을 것.
>
> **✅ 2026-08-12 같은 날, 사용자가 "정말 다 안전한거 맞지?"라고 재확인 요청 → 추가 심화 조사 진행,
> 이 문서의 원래 스코프(`/api/my-quizzes`) 밖에서 실제 SQL 인젝션 1건을 새로 발견해 수정함.** 아래
> 원본 조사는 `/api/my-quizzes`(퀴즈 편집 API)만 대상으로 했었는데, 추가 조사는 그 결론을 그대로 믿지
> 않고 웹에서 도달 가능한 모든 라우트(`web_express_app.ts` 전체)와 그 브로드캐스트가 최종적으로
> 소비되는 지점까지 따라가봤음 — 발견한 것:
> 1. **[심각] SQL 인젝션, `POST /api/session/confirm`(mode:omakase/multiplayer)의 `basket_items`** —
>    `db_quiz.ts`의 `selectRandomQuestionListByBasket`이 `quiz_id`를 문자열로 이어붙여
>    `WHERE quiz_id IN ${...}`에 그대로 삽입하고 있었음. 디스코드 전용이던 시절엔 이 값이 항상 DB에서
>    읽은 실제 정수로만 채워져 무해했지만, 웹 API가 `basket_items`를 서버 검증 없이 그대로 받게 되면서
>    UI 없이 직접 API를 호출하면 임의 SQL을 흘려보낼 수 있는 실제 취약점이 됐음 - 파라미터화
>    (`= ANY($1::int[])`) + 호출부(`initialize.ts`) 정수 필터링으로 수정.
> 2. **[경미] 미검증 텍스트가 공유 Discord embed에 반영, `POST /api/session/select`의 `title`** —
>    길이 제한 없이 그대로 `WebHandoffUI`의 잠금 화면(길드 채널에 공개)에 꽂히고 있었음(embed 길이
>    제한 초과 시 화면이 깨질 수 있고, 길드원에게 임의 텍스트를 노출시킬 수 있었음) - 표시 직전 60자로
>    자르도록 수정.
>
> 상세는 `quizbot/managers/db/CLAUDE.md`(db_quiz.ts)/`quizbot/quiz_system/CLAUDE.md`(initialize.ts)/
> `quizbot/quiz_ui/CLAUDE.md`(web-handoff-ui.ts) 각 항목, 요약은 `docs/COMPLETED_WORK_LOG.md`
> 2026-08-12 B-7 추가 항목. **이 두 건은 원래 체크리스트(아래 "다음 세션 착수 체크리스트")에 없던
> 항목이었다** — 즉 처음 조사 스코프를 벗어난 곳에 실제 문제가 있었다는 뜻이므로, 앞으로 비슷한 보안
> 점검을 할 때는 특정 API 파일 하나만 보지 않고 "그 API가 만든 데이터가 최종적으로 어디서 쓰이는지"
> 까지 따라가는 걸 기본으로 할 것.
>
> **다음 세션은 이 문서부터 읽을 것.** 2026-08-12 세션에서 사용자가 요청한 작업 2건 — (1) 문제 편집
> 미리보기 마크다운 지원, (2) 웹 API 보안 점검 — 을 위해 **코드는 건드리지 않고 조사만** 미리
> 끝내둔 인수인계 문서. 조사 결과는 아래에 전부 기록돼 있으니 다음 세션은 재조사 없이 바로 착수
> 가능. 작업 1은 설계가 거의 끝나 있고, 작업 2는 사용자가 명시적으로 "체크리스트부터 만들고 하나씩
> 진행"을 요청했으므로 아래 체크리스트를 그대로 쓰거나 다듬어서 진행할 것.

## 배경

퀴즈 만들기 웹 UI(`docs/plans/WEB_QUIZ_CREATION_PLAN.md`)와 나머지 화면 웹 포팅(`docs/plans/
WEB_UI_REMAINING_SCREENS_PLAN.md`)까지 끝난 뒤, 사용자가 이어서 요청한 두 가지 작업. 둘 다 "새
세션에서 진행"하기로 하고, 이번 세션엔 인수인계 준비(조사)만 완료했다.

---

## 작업 1. 문제 생성/편집 미리보기에 마크다운 지원

### 현재 상태

"실제 디스코드에선 이렇게 보여요" 미리보기(`web-frontend/src/editor/questionDisplay.jsx`)의
`DiscordQuestionPreview`/`DiscordHintPreview`/`DiscordAnswerPreview` 3개 컴포넌트가 문제 텍스트/힌트/
정답 공개 텍스트를 전부 **plain text**로 렌더링한다(`{promptText}`, `hintLine`, `answering_text`를
JSX에 그대로 꽂음). 반면 퀴즈 상세 설명(`QuizDetailCard.jsx`)은 이미 `react-markdown`(`Markdown` 컴포넌트,
`.markdown-desc` CSS 클래스)으로 렌더링하고 있음 — 이 패턴을 문제 미리보기에도 적용하면 된다.

**실제 디스코드 임베드는 마크다운을 그대로 렌더링**하므로(문제 텍스트/힌트/정답에 `**굵게**` 등을 써도
디스코드에선 서식이 적용됨), 지금 미리보기가 plain text인 건 실제 화면과 다르게 보이는 정확도 문제다.

### 적용 지점 (`questionDisplay.jsx`)

- `DiscordQuestionPreview`의 `<span className="q-prompt">{promptText}</span>` — 문제 텍스트
- `DiscordHintPreview`의 `hintLine`(`💡 힌트 공개: ${effectiveText}` 형태 — **주의**: 자동 생성 힌트
  (`approximateAutoHint`, ◼로 가린 텍스트)는 마크다운 렌더링 대상이 아님, 유저가 직접 쓴 `hint`
  텍스트일 때만 마크다운 적용해야 함. `isAuto` 플래그로 이미 구분돼 있음)
- `DiscordAnswerPreview`의 `answering_text`(`answer_text` 필드, `df-desc` 안에 `\n\n${answering_text}`로
  섞여 있음 — 다른 고정 텍스트(정답자/점수판 예시)와 분리해서 그 부분만 마크다운 적용 필요)

### 확인된 기술적 함정 (다음 세션이 바로 마주칠 것들)

1. **`react-markdown@10.1.0`만 설치돼 있고 `remark-breaks`/`remark-gfm`은 없음** (`web-frontend/
   package.json` 확인). 즉 기본 CommonMark 규칙대로 **단일 줄바꿈(`\n`)은 그냥 공백으로 합쳐짐** —
   두 줄바꿈(빈 줄)이 있어야 문단이 나뉨. 디스코드 메시지/임베드는 단일 `\n`도 그대로 줄바꿈으로
   보여주므로, 지금처럼 `react-markdown`만 추가하면 오히려 기존 `white-space: pre-wrap`(현재 `.df-desc`
   CSS)보다 부정확해질 수 있음. `remark-breaks` 플러그인 설치해서 단일 개행도 `<br>`로 바꾸는 걸
   권장(`QuizDetailCard.jsx`의 기존 상세설명 렌더링도 같은 문제를 안고 있을 가능성이 있음 — 김에 같이
   고칠지는 사용자와 확인).
2. **색상 충돌**: `.markdown-desc`는 라이트/다크 테마 CSS 변수(`var(--ink)` 등)를 쓰지만, 미리보기가
   들어있는 `.discord-frame`/`.df-embed`/`.df-desc`는 실제 디스코드 다크 테마 색을 **하드코딩**(`#dbdee1`
   등, `styles.css` 주석: "실제 디스코드 다크 테마 색상을 그대로 하드코딩... 의도적으로 CSS 변수
   미사용"). `.markdown-desc`를 그대로 갖다 쓰면 앱 테마에 따라 색이 바뀌어서 튐 — `color: inherit`
   기반의 별도 클래스(예: `.df-markdown`, `.markdown-desc`의 여백 규칙만 재사용하고 색은 상속)를
   `styles.css`에 새로 만들어야 함.
3. **XSS**: `react-markdown`은 raw HTML을 안 꽂으므로(`QuizDetailCard.jsx` 주석 참고) 그대로 재사용하면
   안전함 — `dangerouslySetInnerHTML` 쓰지 말 것.

### 참고할 기존 패턴

- `web-frontend/src/QuizDetailCard.jsx:1,50-52` — `import Markdown from 'react-markdown'` +
  `<div className="detail-desc markdown-desc"><Markdown>{detail.description}</Markdown></div>`
- `web-frontend/src/GuidePanel.jsx`/`NoticesPanel.jsx`(2026-08-12 신설, 나머지 화면 웹 포팅) — 같은
  패턴을 정적 텍스트(안내 페이지/공지사항)에 적용한 가장 최신 사례

---

## 작업 2. 웹 API 보안 점검

사용자 우선순위(원문): **"서버 과부하 방지"**, **"인증되지 않은 권한 탈취 방지(유저 A가 유저 B의
퀴즈를 조회/수정/삭제)"** 가 가장 중요. UI를 거치지 않고 직접 API를 호출하는 악의적 사용자를 가정할 것.

### 이미 조사 완료 (2026-08-12, 코드만 읽음 — 다음 세션은 아래 결과를 신뢰하고 재조사하지 않아도 됨)

대상: `quizbot/managers/web/web_express_app.ts`(퀴즈 선택 웹 API, guild-scope 세션) +
`quizbot/managers/web/web_quiz_editor_routes.ts`(퀴즈 만들기 웹 API, owner-scope 세션, `/api/my-quizzes`).

**A. IDOR(다른 유저/길드 데이터 접근) — 판정: 코드상 안전함**
- `GET /api/user-quizzes/:quiz_id`: `db_quiz.ts`의 `selectQuizInfoById`가
  `where is_use=true and is_private=false and quiz_id=$1`로 **비공개 퀴즈를 SQL 단에서 이미 걸러냄**
  (다른 유저 비공개 퀴즈 quiz_id를 넣어도 404).
- `/api/my-quizzes/:quiz_id` 전체(PUT/DELETE/태그/공개토글) + 문제 CRUD(`POST`/`PUT`/`DELETE
  .../questions[/:question_id]`, `POST .../duplicate`): `requireQuizOwnership` 미들웨어가
  `selectOwnedQuizInfoById(quiz_id, $2=owner_id)`로 **소유권을 SQL 단에서 강제**, 예외 라우트 없음(전체
  라우트 표는 `web_quiz_editor_routes.ts` 참고 — 전부 `requireOwnerScopedSession`+`requireQuizOwnership`
  통과 필요).
- `requireGuildScopedSession`/`requireOwnerScopedSession`은 세션 **타입**만 확인하고(어떤 길드/유저인지는
  안 봄), 실제 `guild_id`/`owner_id`는 요청 파라미터가 아니라 **세션 객체에서만** 읽어옴(클라이언트가
  위조 불가) — 그래서 타입 검사만으로도 결과적으로 안전.
- 세션 토큰은 `crypto.randomBytes(32).toString('hex')`(256비트) — 추측 불가.
- **남은 일**: 코드 리뷰로는 안전하지만, 사용자가 원한 "UI 없이 직접 API 호출" 실제 검증은 아직 안 함 —
  다음 세션에서 curl/Postman으로 (1) 세션 A 토큰으로 세션 B 소유 퀴즈 quiz_id를 직접 PUT/DELETE 시도,
  (2) 비공개 퀴즈 quiz_id로 GET 시도, 두 가지는 실제로 재현해서 눈으로 확인 권장. 회귀 테스트로 고정도
  검토(현재 `web_quiz_editor_routes.test.js`에 이미 유사 케이스가 있는지 먼저 확인 후 빠진 것만 추가).

**B. SQL 인젝션 — 판정: 안전함**
- `db_quiz.ts`의 모든 insert/update/delete가 값은 100% `$n` 플레이스홀더. 컬럼명(`key_fields`)은
  사용자 입력이 아니라 하드코딩된 상수 배열에서만 옴.
- **유일한 비-파라미터화 지점**: `updateQuizInfo`/`updateQuestionInfo`가 `quiz_id`/`question_id`를
  쿼리 문자열에 직접 보간(`where quiz_id = ${quiz_id}`). 호출 경로상 항상 `parseInt`+검증을 거친 정수만
  들어와 **현재는 익스플로잇 불가**하지만, 방어적인 코드는 아님 — 여유 있으면 `$n`으로 정리하는 걸
  권장(우선순위 낮음, 하드닝 성격).

**C. 백엔드 검증 — 판정: 부분적으로 안전함, 구멍 2개 발견**
- 글자 수 제한(제목/설명/문제텍스트 등), 문제 개수 상한(50개), 태그 비트마스크(`VALID_TAG_MASK`)는
  **서버에서도 확실히 강제됨** — API 직접 호출로 우회 불가.
- **구멍 1**: `answer_type` 필드가 화이트리스트 검증 없이 그대로 저장됨(`ANSWER_TYPE.{SHORT_ANSWER,
  OX,MULTIPLE_CHOICE}`=1/2/3 외의 임의 값도 저장 가능). 게임 로직 영향은 제한적이나 데이터 정합성 문제.
- **구멍 2**: `validateQuestionFields`/`validateQuizMetadata`의 글자 수 체크가 `typeof field ===
  'string'`일 때만 동작 — 문자열이 아닌 값(객체/배열/숫자)을 보내면 길이 체크가 통째로 스킵되고 그
  값이 그대로 저장 시도됨(SQL 인젝션은 파라미터화라 안전하지만 타입 오염 가능).
- 정확한 파일/줄 위치는 조사 당시 서브에이전트 보고에 있음(`web_quiz_editor_routes.ts`의
  `validateQuizMetadata`/`validateQuestionFields` 함수) — 다음 세션 시작 시 그 함수부터 다시 열어서
  줄 번호 확인.

**D. Rate limiting — 판정: 취약함(전혀 없음)**
- 루트 `package.json`에 `express-rate-limit` 등 미설치, 두 라우트 파일 어디에도 요청 빈도 제한 없음.
- 유효한 세션 토큰만 있으면 `/api/my-quizzes/*`(퀴즈/문제 생성·수정·삭제 포함)를 무제한 반복 호출
  가능 — 서버 과부하/DB 부하 우려(사용자가 가장 중요하게 여기는 항목).

### 다음 세션 착수 체크리스트 (우선순위순 — 사용자와 순서/스코프 확정 후 진행)

1. **[최우선] Rate limiting 도입** — `express-rate-limit` 등 설치, 최소 "토큰당 1초"(사용자 제안) 검토.
   - 열린 질문: 전체 `/api/*`에 걸지, 쓰기 계열(`/api/my-quizzes` POST/PUT/DELETE)만 더 빡빡하게 걸지.
     세션이 없는 상태(`requireWebSession` 이전, 예: `/health`)는 어떻게 할지.
   - 키 기준은 IP보다 **토큰**(Bearer) 권장 — 여러 유저가 같은 길드/네트워크를 공유할 수 있어 IP 기준은
     오탐 위험. 토큰 없는 요청(401 전)은 IP 기준 별도 리밋 검토.
2. **[권한 탈취 재확인] IDOR 라이브 검증 + 회귀 테스트 보강** — 위 A 항목의 "남은 일" 실제 재현 +
   테스트 코드화(`test/managers/web/web_quiz_editor_routes.test.js`, `web_express_app.test.js`에
   이미 있는 커버리지 확인 후 빈틈만 추가).
3. **[검증 보강] `answer_type` 화이트리스트 체크 추가** — `validateQuestionFields`에 한 줄 추가 수준.
4. **[검증 보강] 비문자열 타입 입력 방어** — 길이 체크 전에 `typeof !== 'string'`이면 400 리턴하도록.
5. **[하드닝, 우선순위 낮음] `updateQuizInfo`/`updateQuestionInfo`의 quiz_id/question_id 직접 보간을
   `$n`으로 교체** — 지금 당장 위험은 아니지만 코드 패턴 정리 차원.

작업 순서: 위 우선순위대로 하나씩 (조사 → 수정 → 테스트 → 검증) 사이클로 진행 권장 — 한 번에 다 고치고
막판에 몰아서 검증하지 말 것(이전 phase들의 관례와 동일).

## Critical Files

- `web-frontend/src/editor/questionDisplay.jsx` — 미리보기 마크다운 적용 지점(작업 1)
- `web-frontend/src/QuizDetailCard.jsx`, `GuidePanel.jsx`, `NoticesPanel.jsx` — 기존 `react-markdown`
  적용 패턴 참고
- `web-frontend/src/styles.css` — `.markdown-desc`(기존), 신규 `.df-markdown` 필요
- `quizbot/managers/web/web_quiz_editor_routes.ts` — `requireQuizOwnership`, `validateQuizMetadata`,
  `validateQuestionFields`, 라우트 전체
- `quizbot/managers/web/web_express_app.ts` — `requireGuildScopedSession`, `/api/user-quizzes/:quiz_id`
- `quizbot/managers/db/db_quiz.ts` — `selectQuizInfoById`, `selectOwnedQuizInfoById`,
  `updateQuizInfo`/`updateQuestionInfo`(비-파라미터화 지점)
- `utility/util/web_token_utility.ts` — 토큰 생성(참고용, 이미 안전 확인됨)
- 루트 `package.json` — rate limit 패키지 설치 위치
