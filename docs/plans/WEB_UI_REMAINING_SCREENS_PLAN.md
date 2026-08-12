# 나머지 디스코드 전용 화면 웹 포팅 + 서버 설정 권한 검증 (계획서)

> **✅ 2026-08-12 완료(같은 날 조사 직후 이어서 착수).** 아래 "착수 전 결정 필요 사항" 5개는 플랜모드
> 세션에서 전부 확정됨(요약: 권한 체크는 추가 안 함/패치노트는 스코프 아웃/DB는 웹 전용 파라미터화
> 함수 신설/진입점은 기존 퀴즈 선택 웹 헤더 메뉴). 코드 구현 상세는 `docs/COMPLETED_WORK_LOG.md`
> 2026-08-12 항목 참고 — 이 문서는 그 착수 전 조사 결과를 그대로 보존한 기록.

## 배경

"퀴즈 만들기 웹 UI"(`docs/plans/WEB_QUIZ_CREATION_PLAN.md`)와 "퀴즈 선택 웹 연동"(`docs/plans/
WEB_INTEGRATION_PLAN.md`)이 전부 끝난 뒤, 사용자가 이어서 요청한 3가지 중 남은 1가지 — "기존
디스코드 UI에서 지원하는 나머지 기능들도 웹 UI로 포팅" (퀴즈만들기 안내 페이지 / 서버 설정 / 공지사항).
나머지 2가지(투트랙 선택 버튼 라벨 개선, "권한 가져오기" 신규 토큰 발급 레이스 버그)는 같은 세션에서
바로 처리 완료 — 상세는 `docs/plans/WEB_QUIZ_CREATION_PLAN.md` Phase 5 하단, `docs/COMPLETED_WORK_LOG.md`
2026-08-12 항목 참고.

이 문서가 다루는 대상 3화면은 기존 두 웹 연동 계획서 어디에도 속하지 않는 새 주제라서 별도 문서로
분리했다(`docs/ACTIVE_PLAN.md`의 "같은 주제로 새 라운드를 만들지 말 것" 원칙엔 안 걸림 — 완전히 다른
화면들이라 기존 두 문서에 억지로 끼워넣는 게 더 부자연스러움).

## 조사로 확인된 사실 (2026-08-12, Explore 에이전트 조사 + 직접 코드 확인)

### 1. 퀴즈만들기 안내 페이지 (`quizbot/quiz_ui/quiz-tool-guide-ui.ts`)

완전히 정적인 화면. `initializeEmbed()`가 `text_contents.json`의 `quiz_tool_guide_ui` 키(title/
description/fields)를 그대로 embed에 넣고, `initializeComponents()`는 `only_back_comp`(뒤로가기)
하나만 붙인다. `onInteractionCreate` 오버라이드 자체가 없음 — 인터랙션 로직이 전혀 없다.

**포팅 난이도: 가장 낮음.** 백엔드 API 불필요, 정적 텍스트 컴포넌트 하나면 끝. 디스코드 전용 로직도
없어서 그대로 텍스트만 옮기면 된다.

### 2. 서버 설정 (`quizbot/quiz_ui/server-setting-ui.ts`, `quizbot/quiz_option/quiz_option.js`,
`quizbot/managers/db/db_option.ts`)

편집 가능한 화면. 옵션 9종(`audio_play_time`/`hint_type`/`skip_type`/`use_similar_answer`/
`score_type`/`improved_audio_cut`/`use_message_intent`/`score_show_max`/`max_chance`)을 select
메뉴 2단(옵션 선택 → 값 선택, `handleOptionSelected`/`handleOptionValueSelected`) + 저장 버튼
(`handleSaveOption`)으로 편집한다. `OptionStorage`(길드별 in-memory 캐시)를 `cloneDeep`해서
`option_data`로 편집하다가 저장 버튼을 눌러야 `option_storage.saveOptionToDB()`가 실제 DB에
커밋된다(안 누르면 변경사항 소멸 — 의도된 동작, `text_contents.json`에 경고문 있음).

- **REST 노출 전무** — `web_quiz_editor_routes.ts`에 옵션 관련 엔드포인트 없음. 신규 API(`GET`/
  `PUT` 서버 옵션) 필요.
- **⚠️ 권한 검증이 전혀 없음(2026-08-12 신규 발견, 사용자도 "처음 알았다")** — `main-ui.ts`/
  `quiz-info-ui.ts` 양쪽 진입점 다 버튼 클릭만으로 `new ServerSettingUI(guild_id)`를 생성, `ManageGuild`
  권한이나 다른 관리자 체크가 quiz_ui 전체에 존재하지 않는다(grep 무매치). **즉 지금 디스코드에서도
  서버의 아무나 퀴즈 옵션을 바꿀 수 있다** — 이건 웹 포팅과 별개로 이미 존재하는 기존 버그/설계
  공백이다.
- **DB 쿼리 방식** — `db_option.ts`의 `selectOption`/`updateOption`은 파라미터화 쿼리(`$1`)가 아니라
  문자열 직접 삽입(원본 주석: "옵션쪽은 어차피 고정값이니깐 placeholder 사용하지 말자, 건드리기
  두렵다" — `quizbot/managers/db/CLAUDE.md`에 기존부터 알려진 이슈로 기록돼 있음). 지금은 `guild_id`가
  Discord snowflake(항상 숫자)이고 `option_fields`/`option_values`가 고정된 whitelist 값이라 실질
  위험은 낮지만, 웹 API를 신설하면서 이 함수들을 그대로 재사용할지 새로 파라미터화해서 짤지 결정
  필요(신설 API는 처음부터 파라미터화 쿼리로 짜는 게 자연스럽다 — 기존 디스코드 경로까지 같이 고칠지는
  별개 결정).
- **인터랙션 의존도** — 토스트(`interaction.reply`, ephemeral)와 select 컴포넌트 disabled 상태
  (`option_control_btn_component.components[0].setDisabled`)가 디스코드 API에 결합돼 있음. 웹에서는
  폼 상태 + 저장 버튼 활성화 로직으로 재작성 필요(로직 자체는 단순 - "값이 바뀌면 저장 버튼 활성화").

**포팅 난이도: 가장 높음.** REST API 신설 + 권한 체크 신규 도입(아래) + (선택) DB 쿼리 파라미터화가
전부 필요.

### 3. 공지사항 (`quizbot/quiz_ui/note-select-ui.ts`, `note-ui.ts`)

순수 열람용, 편집 기능 없음. 데이터는 DB가 아니라 `SYSTEM_CONFIG.NOTICES_PATH`(`resources/notices/`)
안의 `.txt` 파일들. `loadNoteContents()`가 `fs.readdirSync`로 파일명 역순 정렬 목록을 만들고, 목록에서
번호를 선택하면 `NoteUI`가 그 파일을 `fs.readFileSync`로 즉시 읽어 embed description에 넣는다.

- **⚠️ 패치노트 탭이 미완성 상태(2026-08-12 확인)** — `this.patch_note_contents`가 생성자에서
  `undefined`로만 초기화되고(`note-select-ui.ts:46`) 그 어디서도 실제로 채워지지 않는다(`notice_contents`만
  `loadNoteContents(SYSTEM_CONFIG.NOTICES_PATH)`로 로드됨, `config/system_setting.js`엔
  `PATCH_NOTES_PATH` 같은 별도 상수 자체가 없음). `handlePatchNoteSelect()`가 `cur_contents =
  this.patch_note_contents`(=`undefined`)로 설정하고 `pageMove(0)`를 부르면 `undefined.length`
  접근으로 죽을 가능성이 높음 — **디스코드 쪽에서 "패치노트" 버튼을 눌러보면 바로 재현될 것으로
  추정**(이번 조사에서 실제로 버튼을 눌러보진 않음, 코드 정적 분석 결과). 웹 포팅 전에 디스코드
  쪽에서 먼저 고칠지, 웹에 맞춰 새로 설계할지 결정 필요.
- REST 노출 전무 — 파일 목록/본문 API 신설 필요(단순 정적 파일 서빙으로도 충분해 보임).
- 인터랙션 의존은 페이지네이션과 번호 선택뿐, 디스코드 전용 로직은 적음.

**포팅 난이도: 낮음** (패치노트 미완성 이슈만 별도로 결정하면).

## 착수 전 결정 필요 사항

1. **서버 설정 권한 정책** — 어떤 권한 레벨을 요구할지(`ManageGuild`가 Discord 표준이지만 다른
   기준도 가능), 디스코드 쪽 기존 동작도 지금 같이 고칠지 vs 웹에서만 새로 체크 추가(사용자가
   2026-08-12에 "정확히 어떤 문제가 있고 어떻게 고칠 수 있을지 다시 생각해보자"로 보류함 — 착수 시
   이 질문부터 다시 확인할 것).
2. **패치노트 미완성 코드 처리** — 웹 포팅과 무관하게 디스코드 쪽 버그로 먼저 고칠지, 아니면 웹
   포팅 설계에 패치노트 소스를 아예 새로 정의(예: `PATCH_NOTES_PATH` 추가)하면서 같이 고칠지.
3. **DB 쿼리 파라미터화** — 서버 설정 웹 API 신설 시 `db_option.ts`를 파라미터화 쿼리로 새로 짤지,
   기존 함수를 그대로 재사용할지(기존 디스코드 경로에는 영향 없이 웹 전용 함수를 새로 만드는 것도
   선택 가능).
4. **우선순위/순서** — 난이도 낮은 것부터(안내 페이지 → 공지사항 → 서버 설정) 갈지, 아니면 사용자가
   실제로 자주 쓰는 화면부터 갈지.
5. **진입점** — 기존 투트랙 패턴(`SelectUIModeUI`/`QuizEditSelectUIModeUI`)처럼 웹에서도 별도 탭/
   페이지로 노출할지, 아니면 다른 방식(예: 퀴즈 선택 웹 UI에 링크만 추가)으로 노출할지.

## Critical Files (착수 시 참고)

- `quizbot/quiz_ui/quiz-tool-guide-ui.ts` — 안내 페이지, 정적.
- `quizbot/quiz_ui/server-setting-ui.ts`, `quizbot/quiz_option/quiz_option.js`,
  `quizbot/managers/db/db_option.ts` — 서버 설정 전체.
- `quizbot/quiz_ui/note-select-ui.ts`, `quizbot/quiz_ui/note-ui.ts` — 공지사항, `resources/notices/`
  파일 기반.
- `quizbot/managers/web/web_quiz_editor_routes.ts` — 기존 REST 라우터 패턴(신규 API를 어디 붙일지
  참고 — 새 파일로 분리할지 이 파일에 얹을지는 착수 시 결정).
- `quizbot/managers/web/web_express_app.ts` — 미들웨어(`requireWebSession` 등) 재사용 지점.
