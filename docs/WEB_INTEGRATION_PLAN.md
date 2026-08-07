# 퀴즈 선택 웹 연동 (Temporary Token Remote Control) 계획서

> 2026-08-08 설계 세션 결과물. **설계 + UI 목업까지 완료, 실제 코드 구현은 다음 세션부터 시작.**
> `docs/ACTIVE_PLAN.md`에 이 문서를 가리키는 항목이 있음.

## 배경

디스코드 임베드/버튼만으로는 퀴즈 검색·선택 UX에 한계가 있어(`user-quiz-select-ui.ts`의 검색/정렬/태그
필터가 전부 버튼·모달로만 동작), 별도 웹 프론트엔드에서 퀴즈를 찾고 선택하면 그 결과가 디스코드 채널의
잠긴 UI에 실시간 반영되는 기능을 새로 만든다. 사용자가 제시한 원 설계서(단일 프로세스 + 인메모리 Map +
임시 토큰)는 방향은 맞지만, **이 프로젝트가 이미 `discord-hybrid-sharding` 기반 멀티 클러스터**라는
전제를 놓치고 있었다 — 이 문서는 기존 멀티플레이 IPC 브로드캐스트+로컬 필터링 패턴을 재사용하도록 설계를
보정한 버전이다.

## 확정 범위 (이번 라운드)

1. 개발자(→**공식**) 퀴즈 선택 UI 웹화
2. 유저 퀴즈 선택 UI 웹화
3. 오마카세(→**랜덤 퀴즈**, 아래 TODO 참고) 퀴즈의 두 서브모드(장르로 뽑기 / 직접 담기) 웹화
4. 최종 선택 시 문제 수 설정도 웹에서 처리
5. **멀티플레이 로비의 바구니 모드는 이번 범위에서 제외**(추후 별도 논의)
6. 배포는 로컬 임의 포트로 먼저 개발/테스트(`http://localhost:PORT`), Cloudflare 연동(추천: Tunnel —
   포트포워딩·인증서 이슈 없이 origin 구간까지 암호화됨)은 나중 단계
7. 프론트엔드는 다크모드 지원 필수, 완성도 있는 비주얼

## ⚠️ TODO — 착수 전에 처리할 네이밍 변경 2건 (2026-08-08 사용자 지시)

- **"장바구니" → "퀴즈함"**: 목업에선 이미 반영했지만, **기존 디스코드 봇 코드(`omakase-quiz-room-ui.ts`,
  `quiz-info-ui.ts`, `omakase_components.ts` 등)의 실제 버튼 라벨/변수/주석에는 여전히 "장바구니"라는
  표현이 남아있음**(`handleRequestUseBasketMode`, `basket_items`, `BASKET_CACHE`, "장바구니 모드"
  버튼 텍스트 등). 웹 UI뿐 아니라 디스코드 쪽 사용자 노출 문구도 같이 바꿀지, 아니면 웹 UI 표현만
  "퀴즈함"으로 하고 내부 코드/디스코드 버튼 텍스트는 유지할지 **사용자와 범위를 먼저 확정**할 것.
- **"오마카세 퀴즈" → "랜덤 퀴즈"**: 마찬가지로 웹 UI 목업(탭 이름 등)과 디스코드 쪽 실제 표현
  (`OmakaseQuizRoomUI`, `select-quiz-type-ui.ts`의 버튼 라벨 "오마카세 퀴즈", `quiz_info.title = "오마카세
  퀴즈"`, `icon: '🍴'` 등) 둘 다 있음 — 클래스/변수명까지 리네임할지(큰 diff), 사용자 노출 문구만 바꿀지
  범위를 먼저 정할 것.

두 건 다 **이번 웹 연동 작업과 별개로 언제든 처리 가능**하지만, 웹 UI 텍스트를 확정 지을 Phase 1~3
착수 시점에 같이 처리하는 게 자연스러움.

## 핵심 아키텍처 결정

### 1. 세션 상태는 마스터 프로세스(`index.js`)에 둔다

`multiplayer_session_registry.js`의 `multiplayer_sessions` Map과 동일한 패턴: 클러스터(`quizbot/bot.js`)는
상태를 갖지 않고 신호만 주고받으며, 실제 토큰↔길드 매핑은 마스터 메모리에만 존재한다. 이유: `UIHolder`
(`quizbot/quiz_ui/ui-system-core.ts`의 `ui_holder_map`)는 모듈 스코프 변수라 **그 길드를 담당하는 클러스터
프로세스 안에서만 존재**하고, 마스터는 "어느 클러스터가 이 길드를 담당하는지"를 알 방법이 없다(코드베이스
전체에 guild→cluster 매핑 로직이 없음). 그래서 길드를 대상으로 한 통신은 "마스터가 전체 클러스터에
브로드캐스트 → 각 클러스터가 자기 `ui_holder_map`에 그 guild_id가 있는지 로컬 판단"하는 패턴
(`relayMultiplayerSignal`, `ui-system-core.ts:120-142`)을 그대로 재사용한다.

### 2. IPC 메시지 타입 2개 추가 (기존 `MULTIPLAYER_SIGNAL` 골격 재사용)

`quizbot/managers/ipc_manager.ts`의 `IPC_MESSAGE_TYPE`에 추가:
- **`WEB_SESSION_REQUEST`** (클러스터→마스터, `cluster.request()`/`message.reply()` 요청-응답,
  `ipc_manager.ts:79-85`의 `sendMultiplayerSignal`과 동일 골격): `action: 'create'|'force_take'|'close'|'heartbeat'`.
- **`WEB_SESSION_SIGNAL`** (마스터→전체 클러스터 `manager.broadcast()`, `index.js:110-113` 패턴 + 클러스터
  쪽에서 `relayMultiplayerSignal`처럼 로컬 `ui_holder_map[guild_id]` 존재 여부로 필터링):
  `{ guild_id, event: 'locked'|'updated'|'unlocked'|'expired', payload }`.

`index.js`의 `cluster.on('message', ...)` 분기(`index.js:46-69`)와 `ipc_manager.ts`의
`bot_client.cluster.on('message', ...)` 분기(`ipc_manager.ts:47-76`)에 `MULTIPLAYER_SIGNAL` 케이스 옆에
대칭으로 추가.

### 3. DB 조회는 마스터가 직접 한다 (릴레이하지 않음)

퀴즈 목록/검색/태그 조회(`loadUserQuizListFromDB`, `quizbot/managers/user_quiz_info_manager.ts` →
`quizbot/managers/db/db_quiz.ts`)는 discord.js 객체에 의존하지 않는 순수 DB 쿼리다. 마스터가 클러스터에
릴레이하지 않고 **자체적으로 `db_manager`를 초기화**해서 직접 쿼리한다(릴레이는 "어느 클러스터가
살아있는지" 선택/재시도 로직이 추가로 필요해 더 복잡함). Postgres pool을 하나 더 여는 비용은 작다 —
pool 크기를 작게(예: 3~5) 잡는다.

개발자(공식) 퀴즈 트리는 파일시스템 기반(`utility/util/quiz_content_loader.ts`의 `loadLocalDirectoryQuiz`,
`fs.readdirSync`)이라 마스터에서 그냥 직접 `require`해서 호출하면 된다.

### 4. 토큰 생성 및 전달

기존 `utility/util/misc_utility.ts`의 `generateUUID()`는 `Math.random()` 기반이라 **암호학적으로
안전하지 않음** — 세션 토큰 용도로 재사용하지 않는다. Node 내장 `crypto.randomBytes(32).toString('hex')`로
새로 만든다(`utility/util/web_token_utility.ts` 신규, `utility.js` facade에서 재수출).

프론트엔드는 URL에서 받은 토큰을 즉시 `history.replaceState`로 마스킹한 뒤, 이후 API 호출은 URL 쿼리가
아니라 `Authorization` 헤더로 보낸다.

### 5. 디스코드 쪽 UI: 기존 상태 패턴에 새 화면 하나 추가

새 UI 클래스 **`WebHandoffUI`**(`quizbot/quiz_ui/web-handoff-ui.ts`, `QuizbotUI` 상속)를 추가한다. 기존
프레임워크(`onInteractionCreate`가 새 UI 반환 시 자동 화면전환, `CUSTOM_EVENT_TYPE`으로 외부 이벤트를
UI에 꽂는 방식 — `multiplayer-quiz-lobby-ui.js`가 `CUSTOM_EVENT_TYPE.receivedMultiplayerSignal`을 쓰는
것과 동일한 방식)를 따른다.

- 상태 1(잠금, 선택 없음): "🔒 @닉네임 님이 웹에서 세팅 중입니다" 텍스트만, 버튼 없음.
- `WEB_SESSION_SIGNAL{event:'updated'}` 수신 시 `this.on()`에서 현재 선택 내용을 embed에 반영하고 `update()`.
- 확정(웹의 "선택 완료" 액션) 시: `WEB_SESSION_REQUEST{action:'close'}`로 토큰 파기 요청 → 기존 흐름으로 복귀:
  - 단일 선택 모드(공식/유저): 선택된 `quiz_info`에 `selected_question_count`를 채워서
    `new DevQuizInfoUI(...)`/`new UserQuizInfoUI(quiz_info)` 반환.
  - 랜덤(오마카세) 퀴즈: `QuizInfoUI.BASKET_CACHE[guild_id]`(기존 정적 캐시)를 갱신하고
    `dev_quiz_tags`/`custom_quiz_type_tags`/`custom_quiz_tags`/`certified_filter`도 채운 뒤
    `new OmakaseQuizRoomUI(...)`로 복귀.
- `WEB_SESSION_SIGNAL{event:'expired'}` 수신 시 잠금 해제하고 이전 화면(`prev_ui_stack`)으로 복귀.

**하이재킹 방어**: 다른 유저가 `/퀴즈`를 눌렀을 때, 클러스터가 이미 로컬 `ui_holder_map[guild_id]`로
"지금 이 길드가 `WebHandoffUI` 상태인지" 즉시 알 수 있으므로, `bot.js`의 명령어 진입부
(`start_quiz_handler`, `bot.js:282` 부근)에서 이를 감지해 신규 UIHolder 생성 없이 ephemeral "강제로 권한
가져오기" 응답만 보낸다. 버튼 클릭 시 `WEB_SESSION_REQUEST{action:'force_take'}`.

### 6. 문제 수 설정

기존 `QuizInfoUI`(`quiz-info-ui.ts:242-358`)에 이미 "몇 개의 문제를 제출할까요?" 모달
(`txt_input_selected_question_count`)이 있고, `quiz_info['selected_question_count']`에 저장되며
`min_quiz_size`~`quiz_size` 범위로 클램프된다(`quiz-info-ui.ts:336-353`). 이 필드/클램프 로직을 웹에도
그대로 반영 — 웹 API가 퀴즈 메타(quiz_size/min_quiz_size)를 응답에 포함하고, 확정 요청(`close`)에
`selected_question_count`를 실어보내면 `web_session_manager`가 동일한 클램프 규칙으로 검증 후 채운다.
Discord 쪽 기존 모달은 fallback으로 계속 동작.

### 7. 권한 (추가 구현 불필요)

`bot.js:502`에서 이미 `interaction.user.id != uiHolder.getOwnerId() && uiHolder.isPublicUI()`인 경우
인터랙션을 막는 전역 체크가 있다 — PUBLIC UIHolder(채널 단위)는 명령어를 입력한 본인만 버튼을 조작할 수
있다. `WebHandoffUI`도 이 프레임워크 위에서 동작하므로 이 체크를 그대로 상속받는다 — 별도 권한 로직 불필요.

## 랜덤(오마카세) 퀴즈 실제 구조 (중요 — 착수 전 반드시 숙지)

원 설계서/1차 목업은 "유저 퀴즈를 하나씩 담는 퀴즈함"만 반영했으나, 실제 코드
(`omakase-quiz-room-ui.ts`, `quiz-info-ui.ts`, `omakase_components.ts`)를 조사한 결과 훨씬 복잡하다:

**A. 공식 퀴즈 파트 (모드와 무관하게 항상 켜져 있음)**
- `dev_quiz_tags_select_menu`: 공식 퀴즈 장르 다중선택 — 애니/게임/드라마/영화/팝송/K팝/고전가요/인디뮤직
  (`DEV_QUIZ_TAG` 비트플래그, `config/system_setting.js:193-214`)

**B. 유저 퀴즈 파트 — 서로 배타적인 두 모드 중 하나 (버튼으로 전환, 기본값은 바구니 모드)**
1. **장르 선택 모드** (`basket_mode: false`): "퀴즈 유형"(음악/그림/텍스트, `custom_quiz_type_tags`) +
   "퀴즈 장르"(가요/애니/게임/방송/드라마/영화/스포츠/팝송/K팝/J팝/보컬로이드/기타,
   `custom_quiz_tags`, `QUIZ_TAG` 비트플래그, `system_setting.js:169-191`) 두 태그를 고르면 봇이 조건에
   맞는 유저 퀴즈 중 무작위로 뽑음. `certified_filter`(기본 true)가 여기 적용됨.
2. **바구니(→퀴즈함) 모드** (`basket_mode: true`, 기본값): `UserQuizSelectUI`로 특정 퀴즈를 직접 골라 담음
   (`basket_items`). 길드별 캐시(`QuizInfoUI.BASKET_CACHE`)로 재시작 전까지 재사용 가능("최근 장바구니로
   덮어쓰기"). 인증 필터는 여기선 의미 없음(이미 직접 골랐으니까).

**공통 설정** (모달, `omakase_components.ts`의 `modal_omakase_quiz_setting`): 문제 수(1~100, 기본 30),
인증 필터 on/off.

**시작 조건** (`checkTagSelected()`, `quiz-info-ui.ts:461-464`): 셋 중 하나라도 있으면 됨 — 공식 장르
선택 OR 유저 유형태그(`custom_quiz_type_tags`) 선택 OR 바구니에 1개 이상.

## UI 목업 (승인 완료)

**`docs/WEB_UI_MOCKUP.html`** — 이 저장소에 커밋된 자체완결 HTML 파일. 브라우저로 직접 열면 더미
데이터로 3개 탭(공식/유저/랜덤 퀴즈) 전체 흐름을 확인할 수 있음(다크모드 토글 포함). **다음 세션이 실제
`web-frontend/` 프로젝트를 만들 때 이 파일의 디자인 토큰(색상/타이포/레이아웃)과 인터랙션 구조를 그대로
가져가면 됨** — 사용자가 최종 승인한 디자인.

핵심 인터랙션 요약(목업에 구현돼 있음):
- 유저 퀴즈: 검색 + AND 조건 다중 태그 필터 + 인증 필터 토글 + 정렬, 썸네일 카드형(장르별 그라디언트
  placeholder — 실제 구현 시 진짜 썸네일 URL로 교체).
- 랜덤(오마카세) 퀴즈: 공식 장르 칩(항상 노출) + 유저 퀴즈 모드 세그먼트 스위치(장르로 뽑기/직접 담기) +
  우측 "설정 요약" 카드(현재 조합 + 문제 수 + 시작 버튼, 조건 미충족 시 비활성화).
- 퀴즈함(직접 담기 모드): 카드 클릭=상세보기, 우클릭=담기/빼기, 우측 하단 FAB→세로 드로어로 목록 확인.
  디스코드 목록 UI(25개 제한)보다 자유롭다는 안내 포함.
- 문제 수는 +/- 버튼과 직접 입력(숫자 인풋) 둘 다 지원.
- 공식 퀴즈 폴더 트리: 리프 노드에 타입별 컬러 아이콘 타일, "2023년부터 업데이트 안 됨" 안내 배너.

## 신규/변경 파일 (백엔드는 반드시 `quizbot/` 하위 — 이유는 아래)

`tsconfig.json`의 `include`와 `scripts/copy-js-assets.js`의 `SOURCE_DIRS`가 `quizbot`/`utility`/`config`로
하드코딩돼 있어서, 루트에 새 디렉터리를 만들면 빌드 파이프라인에서 완전히 빠진다(실제로 지금 죽어있는
`web/web_manager.js`가 정확히 그 상태).

- `quizbot/managers/web/web_session_manager.ts` (신규) — 마스터 전용 싱글턴. `initialize(cluster_manager)`
  (index.js에서만 호출), 토큰 Map, GC, `db_manager`/`loadLocalDirectoryQuiz` 호출, 문제 수 클램프 검증.
- `quizbot/managers/web/web_express_app.ts` (신규) — Express 앱/라우팅. 로컬 개발은
  `SYSTEM_CONFIG.WEB_SERVER_PORT`로 열고 `WEB_BASE_URL`은 `http://localhost:PORT` 기본값.
- `quizbot/managers/ipc_manager.ts` (수정) — `IPC_MESSAGE_TYPE`에 `WEB_SESSION_REQUEST`/`WEB_SESSION_SIGNAL` 추가.
- `index.js` (수정) — `web_session_manager.initialize(manager)` 호출 추가, `WEB_SESSION_REQUEST` 분기 추가.
- `quizbot/bot.js` (수정) — `WEB_SESSION_SIGNAL` relay 등록, `start_quiz_handler` 진입부에 하이재킹 감지 분기.
- `quizbot/quiz_ui/web-handoff-ui.ts` (신규)
- `quizbot/quiz_ui/select-quiz-type-ui.ts` (수정) — dev/user 분기에서 `WebHandoffUI` 반환하도록 교체.
- `quizbot/quiz_ui/omakase-quiz-room-ui.ts` (수정) — 장르/바구니 두 서브모드 다 웹으로 연결.
- `utility/util/web_token_utility.ts` (신규) — `crypto.randomBytes` 기반 토큰 생성.
- `config/system_setting.js` (수정) — `WEB_SERVER_PORT`, `WEB_BASE_URL`, `WEB_SESSION_EXPIRE_SEC`,
  `WEB_SESSION_GC_INTERVAL_SEC` 추가.
- `config/private_config.json` (수정, 로컬 파일 — 커밋 안 됨) — 필요 시 `WEB_SESSION_SECRET` 등.
- `web-frontend/` (신규, 루트) — React+Vite+Tailwind, 독립 프로젝트. `docs/WEB_UI_MOCKUP.html`의 디자인을
  이식. 빌드 산출물은 `web_express_app.ts`가 `express.static`으로 서빙.
- `test/managers/web/web_session_manager.test.js` (신규) — 토큰 발급/만료/force_take/문제 수 클램프를
  순수 로직 단위로 테스트.

## 단계별 구현 순서

0. ~~**Phase -1 — UI 목업**~~ **완료** (`docs/WEB_UI_MOCKUP.html`, 2026-08-08 사용자 승인).
1. **Phase 0 — 인프라 스켈레톤**: IPC 메시지 타입 2개, 마스터 `web_session_manager`(토큰 발급/파기/GC),
   Express 최소 골격(로컬 포트, 정적 파일 서빙만), 설정값 추가. UI 변경 없이 로그/임시 스크립트로 왕복 검증.
2. **Phase 1 — 공식 퀴즈 웹 선택**: `select-quiz-type-ui.ts`의 `'1'` 분기를 `WebHandoffUI`(dev 모드)로
   교체 + `WEB_UI_MOCKUP.html` 화면을 실제 API에 연결.
3. **Phase 2 — 유저 퀴즈 웹 선택**: 같은 `WebHandoffUI`를 user 모드로 확장.
4. **Phase 3 — 랜덤(오마카세) 퀴즈**: `omakase-quiz-room-ui.ts`의 두 서브모드(장르로 뽑기/직접 담기)
   모두 웹으로 연결, `dev_quiz_tags`/`custom_quiz_type_tags`/`custom_quiz_tags`/`certified_filter`/
   `basket_items` 필드 전부 웹에서 채워서 넘겨야 함.
5. **(범위 외, 추후 논의) 멀티플레이 로비 바구니 모드, Cloudflare Tunnel 배포**.

## 검증 방법

- `npm run lint`(0 error 유지), `npm test`(신규 `web_session_manager` 테스트 포함).
- IPC 왕복은 로컬에서 클러스터를 2개 이상 강제로 띄워서 확인(`totalClusters`를 임시로 2 이상 지정) —
  클러스터 1개 환경에서는 "다른 클러스터가 담당하는 길드" 브로드캐스트+로컬필터링 버그를 못 잡는다.
- `npm run build` 후 `dist/`에 새 파일들이 반영됐는지 확인(루트 CLAUDE.md 경고: 재빌드 안 하면 운영
  봇에 변경 반영 안 됨).
- Discord + 로컬 웹(`http://localhost:PORT`) 실사용 테스트: `/퀴즈` → 링크 수신 → 브라우저에서 검색/선택
  + 문제 수 입력 → 채널 임베드 실시간 갱신 확인 → 다른 계정으로 `/퀴즈` 눌러 하이재킹 프롬프트 확인 →
  `WEB_SESSION_EXPIRE_SEC` 임시로 짧게 설정해 GC로 잠금 해제되는지 확인 → 다크모드 토글 확인.
