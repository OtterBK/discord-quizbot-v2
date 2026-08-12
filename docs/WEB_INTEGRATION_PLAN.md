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

## ✅ 네이밍 변경 2건 — 처리 완료 (2026-08-08)

사용자 결정: **둘 다 디스코드 쪽 사용자 노출 문구까지 변경, 내부 변수/함수/클래스명은 유지.**

- **"장바구니" → "퀴즈함"**: `user-quiz-select-ui.ts`, `quiz-info-ui.ts`, `omakase-quiz-room-ui.ts`,
  `multiplayer-quiz-lobby-ui.js`, `components/omakase_components.ts`,
  `components/multiplayer_components.js`의 버튼 라벨/select placeholder/embed 텍스트/interaction.reply
  문구를 전부 "퀴즈함"으로 교체. `basket_items`/`BASKET_CACHE`/`handleRequestUseBasketMode` 등 내부
  식별자와 개발자 주석은 그대로 유지(코드 스타일 규칙상 주석은 삭제 금지 대상이기도 함).
- **"오마카세 퀴즈" → "랜덤 퀴즈"**: `omakase-quiz-room-ui.ts`(`quiz_info.title`),
  `components/omakase_components.ts`(모달 제목), `config/text_contents.json`(select_quiz_type 안내
  문구), `config/system_setting.js`(`QUIZ_TYPE.OMAKASE`/`QUIZ_MAKER_TYPE.OMAKASE` 값 문자열),
  `lifecycle/ending.ts`/`lifecycle/question/question_custom.ts`(추천 유도 문구)를 "랜덤 퀴즈"로 교체.
  `OmakaseQuizRoomUI` 클래스명, `QUIZ_TYPE.OMAKASE`/`QUIZ_MAKER_TYPE.OMAKASE` 키, `omakase_*` 변수/파일명은
  그대로 유지.

이제 Phase 0(인프라 스켈레톤)부터 착수.

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
  `ipc_manager.ts:79-85`의 `sendMultiplayerSignal`과 동일 골격): `action:
  'create'|'force_take'|'select'|'apply'|'release'|'heartbeat'` (2026-08-08 1차 실사용 테스트 후
  `close` 하나였던 것을 `apply`/`release`로 분리 — 아래 "토큰 생명주기" 참고).
- **`WEB_SESSION_SIGNAL`** (마스터→전체 클러스터 `manager.broadcast()`, `index.js:110-113` 패턴 + 클러스터
  쪽에서 `relayMultiplayerSignal`처럼 로컬 `ui_holder_map[guild_id]` 존재 여부로 필터링):
  `{ guild_id, event: 'locked'|'updated'|'applied'|'expired', payload }` (`release`는 브로드캐스트가
  없다 — 아래 참고).

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

- 상태 1(잠금, 선택 없음): "🔒 @닉네임 님이 웹에서 세팅 중입니다" 텍스트만, 버튼 없음(정확히는 Link
  버튼 하나 — 인터랙션을 발생시키지 않아 소유자 체크와 무관하게 항상 안전).
- `WEB_SESSION_SIGNAL{event:'updated'}` 수신 시 `this.on()`에서 현재 선택 내용을 embed에 반영하고 `update()`.
- 확정(웹의 "선택 완료" 액션) 시: `WEB_SESSION_REQUEST{action:'apply'}`로 화면 전환 요청(**토큰은 파기
  안 됨**, 아래 "토큰 생명주기" 참고) → 기존 흐름으로 복귀:
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

### 5-1. 토큰 생명주기 (2026-08-08 1차 실사용 테스트 후 재설계)

원래 설계는 "선택 완료" 시 토큰을 즉시 파기했는데, 실사용해보니 확정 후 같은 세션에서 문제 수를
다시 조정하거나 다른 퀴즈로 바꾸는 게 아예 불가능했다(웹 화면이 살아있는 것처럼 보여도 뭘 눌러도
`invalid_or_expired_token`). 그래서 토큰 파기 시점을 "선택 완료"에서 떼어내 다음 두 지점으로 옮겼다:

- **퀴즈가 실제로 시작될 때** (`quiz-info-ui.ts`의 `handleStartQuiz`) — `WEB_SESSION_REQUEST{action:'release', guild_id}`를 fire-and-forget으로 보냄.
- **그 길드의 UIHolder가 (이유 불문) 사라질 때** (`ui-system-core.ts`의 `UIHolder.free()`) — 같은
  `release` 요청. 이게 없으면, 확정 후 다른 유저가 정상적으로 `/퀴즈`를 다시 눌러 화면이 완전히
  바뀌어도 예전 웹 세션 토큰이 `guild_token_map`을 계속 점유해서, 그 뒤 새로 웹 세션을 열려는 시도가
  `already_locked`로 막히는 "고아 토큰" 문제가 생긴다(GC는 하트비트가 계속 오는 한 이 상태를 못
  잡아낸다 — 브라우저 탭이 안 닫힌 채 방치되면 하트비트가 계속 `expires_at`을 미래로 밀기 때문).

`release`는 클러스터가 이미 그 이유로 화면을 바꾸는 중이라 브로드캐스트가 필요 없다(조용히 마스터
상태만 정리). 반대로 GC 타임아웃(`runGC`)은 클러스터가 스스로 모르는 유일한 경우라 여전히 `expired`를
브로드캐스트한다.

이 변경 덕분에 `DevQuizInfoUI`(`dev-quiz-info-ui.ts`)도 `onReceivedWebSessionSignal`을 구현해서
`'applied'` 신호를 받으면 `DevQuizSelectUI.buildDevQuizInfoFromWebPayload(payload)`(웹 payload →
quiz_info 조립, `WebHandoffUI`와 공유하는 헬퍼)로 자기 자신의 `quiz_info`/`embed`를 갱신하고
`refreshUI()`+`update()`만 호출한다(새 UI 인스턴스를 반환하지 않음 — 그러면 매번 `prev_ui_stack`에
쌓여서 "뒤로가기"가 이전 웹 재선택 내역을 하나씩 되짚는 부작용이 생김). 즉 확정 후에도 웹에서 계속
다른 퀴즈를 고르거나 문제 수를 바꿔서 디스코드 화면에 실시간 반영할 수 있다.

### 5-2. `force_take` 레이스 버그 수정 (2026-08-12, `docs/WEB_QUIZ_CREATION_PLAN.md` Phase 5 검증 중 발견)

"권한 가져오기"는 기존에도 토큰을 뺏는 게 아니라 완전히 새 토큰을 발급하고 있었다(`forceTakeSession`이
예전 토큰을 지우고 `createSession`으로 새 토큰 생성 — 원래 설계 그대로, 테스트로도 고정돼 있었음).
그런데 그 직후 예전 소유자의 `UIHolder`가 `free()`되면서 5-1의 `release` 요청을 보내는데, 이게
`guild_id`만으로 "지금 매핑된 토큰"을 지우는 방식이라(어떤 토큰인지 확인 안 함) **force_take가 새로
발급한 토큰을 곧바로 지워버리는 레이스가 있었다** — 새 소유자가 링크를 받은 직후 아무 조작도 못 하고
`invalid_or_expired_token`을 만났을 가능성. `releaseSession(guild_id, expected_token?)`으로 토큰 일치
검사를 추가해 수정 — `UIHolder.free()`가 자기가 알던 토큰(`this.ui?.token`)을 같이 넘기고, 이미 다른
토큰으로 교체됐으면 조용히 무시한다. `token`을 안 넘기는 기존 호출부(`handleStartQuiz` 등)는 여전히
무조건 파기(하위호환). 회귀 테스트 2건 추가(`test/managers/web/web_session_manager.test.js`).

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

## 8. 투트랙 진입점 분리 (2026-08-08, Phase 2 착수 전 반영)

원래 Phase 1 구현은 `select-quiz-type-ui.ts`의 "공식 퀴즈" 버튼 하나만 `WebHandoffUI`로 가로채는
방식이었다 — 즉 웹 연동이 "기존 디스코드 UI를 완전히 대체"하는 모양이었다. 실제로 원하는 건 **투트랙**:
디스코드 UI(기존 방식)와 웹 UI(디스코드 화면을 원격 컨트롤) 중 사용자가 매번 고르는 것.

**변경**: `/퀴즈` 명령어 직후(`ui-system-core.ts`의 `createMainUIHolder`) 곧장 `MainUI`를 띄우던 것을,
새 화면 `SelectUIModeUI`(`quiz_ui/select-ui-mode-ui.ts`)가 먼저 뜨도록 바꿨다 — "디스코드 UI"/"웹 UI"
2버튼(2026-08-12부터 버튼 라벨 자체가 이 텍스트 — 원래는 라벨이 숫자 `'1'`/`'2'`뿐이라 임베드
description을 먼저 읽어야 의미가 파악됐음, `base_components.ts`의 `select_ui_mode_btn_component`
수정, `customId`는 그대로 `'1'`/`'2'` 유지):
- **디스코드 UI** → `new MainUI()`. 이후 흐름은 웹 연동 이전과 100% 동일 — `select-quiz-type-ui.ts`의
  '공식 퀴즈' 분기도 `DevQuizSelectUI`로 원복(Phase 1이 `WebHandoffUI`로 가로챘던 걸 되돌림). 디스코드
  트랙에서는 웹 연동 코드가 전혀 관여하지 않는다.
- **웹 UI** → `MainUI`/`SelectQuizTypeUI`를 모두 건너뛰고 곧장 `new WebHandoffUI('dev', interaction)`.
  Phase 1에서 만든 잠금 화면/토큰 발급/하이재킹 방어/토큰 생명주기(5-1)는 전부 그대로 재사용 — 진입
  지점만 위로 옮긴 것.

**mode는 여전히 'dev' 고정** (사용자 확인, 2026-08-08): 유저/랜덤 퀴즈 백엔드가 아직 없어서(Phase
2/3), 웹 트랙에 들어가도 프론트엔드는 지금처럼 공식 퀴즈 탭만 활성화되고 나머지 둘은 "다음 체크포인트"
비활성 상태 그대로다. `web_session_manager.ts`/IPC 페이로드/`App.jsx`의 탭 잠금 로직(세션 생성 시
`mode` 1회 고정) 등은 **이번엔 손대지 않음** — 세션을 dev/user/omakase 자유 전환 가능하게 만드는
재설계는 Phase 2/3에서 실제 유저/랜덤 백엔드가 붙을 때 같이 하는 게 낫다고 판단(아직 못 쓰는 기능을
위한 선행 작업 방지). 즉 Phase 2/3 착수 시 `WebHandoffUI`를 tri-tab으로 확장하는 작업은 `select-ui-mode-ui.ts`
쪽 `WebHandoffUI` 생성 지점을 건드리는 정도로 끝나고, `select-quiz-type-ui.ts`는 다시 안 건드려도 된다.

**영향받은 파일**: `select-ui-mode-ui.ts`(신규), `ui-system-core.ts`(`createMainUIHolder`가
`SelectUIModeUI`를 최초 화면으로 사용), `select-quiz-type-ui.ts`(공식 퀴즈 분기 원복),
`components/base_components.ts`(`select_ui_mode_btn_component` 신규, 2버튼),
`config/text_contents.json`(`select_ui_mode` 신규 문구). `web-handoff-ui.ts`/`web_session_manager.ts`/
Express API/프론트엔드는 변경 없음(진입 지점만 이동).

**뒤로가기/GC만료 복귀 화면 변경**: `WebHandoffUI`의 `prev_ui_stack` 최상단이 이제 `SelectQuizTypeUI`가
아니라 `SelectUIModeUI`다 — `docs/TEST_CHECKLIST.md` O 섹션의 관련 항목을 갱신함(재검증 필요, 우선순위
낮음 — `WebHandoffUI` 내부 로직 자체는 안 바뀌었으므로).

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
`web/web_manager.js`가 정확히 그 상태). `web-frontend/`는 예외 — 독립 React 프로젝트라 tsc/copy-js-assets
대상이 아니고, `web_express_app.ts`가 빌드 산출물(`web-frontend/dist/`)을 직접 정적 서빙한다.

Phase 0~1에서 실제로 만들어진 파일(2026-08-08 토큰 생명주기 재설계 반영한 최종 상태):

- `quizbot/managers/web/web_session_manager.ts` — 마스터 전용 싱글턴. `initialize(cluster_manager)`,
  토큰 Map(`web_sessions`)/길드당 1세션 매핑(`guild_token_map`), GC(`runGC`, 테스트를 위해 별도 export).
  **스테이트리스 설계**: 세션 자체엔 선택 내용을 저장하지 않는다 — `select`/`apply` 요청에 실린 payload를
  그대로 브로드캐스트만 하고, 실제 quiz_info 조립(DB/파일시스템 조회)은 그 payload를 받는 **클러스터 쪽
  `WebHandoffUI`/`DevQuizInfoUI`가** 담당한다. `applySelection(token, payload)`은 브로드캐스트만 하고
  토큰은 유지, `releaseSession(guild_id)`은 브로드캐스트 없이 토큰만 조용히 파기(5-1 "토큰 생명주기"
  참고). `handleRequest({action, guild_id, owner_id, mode, token, payload})`가 `index.js`의
  `WEB_SESSION_REQUEST` 분기에서 호출되는 단일 진입점.
- `quizbot/managers/web/web_express_app.ts` — Express 앱. `requireWebSession` 미들웨어(Authorization:
  Bearer 헤더 검증), `GET /api/session`, `POST /api/session/heartbeat`, `GET /api/dev-quizzes`(트리를
  API 형태로 변환해 캐싱, `loadLocalDirectoryQuiz`를 마스터가 직접 호출 — 결정 #3), `POST
  /api/session/select`(진행 중 선택 브로드캐스트), `POST /api/session/confirm`(문제 수 클램프 후
  `applySelection` — 토큰 파기 안 함, 여러 번 호출 가능). `express.static(SYSTEM_CONFIG.WEB_FRONTEND_DIST_PATH)`로
  프론트엔드 서빙.
- `quizbot/managers/ipc_manager.ts` — `IPC_MESSAGE_TYPE.WEB_SESSION_REQUEST`/`WEB_SESSION_SIGNAL`,
  `sendWebSessionRequest`/`adaptWebSessionRelayHandler` (기존 `MULTIPLAYER_SIGNAL` 골격과 대칭).
- `index.js` — `web_session_manager.initialize(manager)` + `web_express_app.start()` 호출,
  `WEB_SESSION_REQUEST` 분기에서 `web_session_manager.handleRequest(message.request)` 위임.
- `quizbot/bot.js` — `relayWebSessionSignal`이 `quizbot_ui.relayWebSessionSignal(signal)`로 실제 라우팅.
  `handle_web_handoff_force_take`(신규) — 하이재킹 방어 ephemeral 버튼(`web_handoff_force_take`)의
  전용 핸들러, uiHolder 소유자 체크(bot.js:502 부근)를 거치기 **전에** 가로챔(다른 유저의 클릭이라
  정상 라우팅으론 막히기 때문). `deferUpdate()` 후 `force_take` IPC 요청 → 성공 시
  `quizbot_ui.createWebHandoffUIHolder(interaction, mode, session, true)`로 홀더 자체를 새 소유자
  것으로 교체(마지막 `true`는 `public_message_mode` — 이미 `deferUpdate()`로 소비된 interaction에
  다시 `.reply()`할 수 없어서 `channel.send()` 경로로 전환하는 스위치, `sendDelayedUI`가 쓰는 것과
  동일한 메커니즘).
- `quizbot/quiz_ui/web-handoff-ui.ts` (신규) — `WebHandoffUI`. 생성자가 `(mode, interaction,
  existing_session?)`을 받음 — `existing_session`이 있으면(=force_take로 이미 토큰 발급됨) 내부에서
  또 `create` 요청을 보내지 않고 바로 잠금 화면을 그림. `onReceivedWebSessionSignal`에서
  `'updated'`(선택 요약 갱신)/`'applied'`(mode별로 다음 UI 생성, `handleApplied`)/`'expired'`(`goToBack()`)를
  처리. dev 모드는 `DevQuizSelectUI.buildDevQuizInfoFromWebPayload(payload)`(아래) 호출 한 줄로 처리.
  **중요 제약**: `UIHolder.on()`이 동기 호출이라(`const new_ui = this.ui.on(...)`, await 없음) 시그널
  핸들러는 async 반환값을 그대로 쓸 수 없다 — user 모드(Phase 2)처럼 DB 조회가 필요한 전환은 핸들러
  안에서 async 함수를 fire-and-forget으로 돌리고, 완료되면 `this.holder.appendNewUI(next_ui);
  this.holder.updateUI();`를 **직접** 호출해야 한다(`onUIReceived`가 하는 일을 수동으로 재현).
  dev 모드는 트리가 이미 메모리에 있어 동기로 처리 가능해서 이 우회가 필요 없었음.
- `quizbot/quiz_ui/dev-quiz-select-ui.ts` (수정) — `generateDevQuizInfo`를 인스턴스 메서드에서
  `static`으로 승격(`this` 미사용 확인 후) + `static findContentByPath(content_path)` 신규 — 클러스터가
  이미 로드해둔 `quiz_contents_sorted_by_name` 트리에서 웹이 넘겨준 `content_path`로 원본 재조회.
  **`static buildDevQuizInfoFromWebPayload(payload)`(2026-08-08 신규)** — `findContentByPath` +
  `generateDevQuizInfo` + 문제 수 클램프를 묶은 공용 헬퍼. `WebHandoffUI`(최초 적용)와 `DevQuizInfoUI`
  (확정 후 재적용)가 이 하나를 공유해서 quiz_info 조립 로직이 중복되지 않는다.
- `quizbot/quiz_ui/dev-quiz-info-ui.ts` (수정, 2026-08-08) — `onReceivedWebSessionSignal` 신규 구현.
  `'applied'` 신호를 받으면 `buildDevQuizInfoFromWebPayload`로 `this.quiz_info`/`this.embed`를 갱신하고
  `refreshUI()`+`update()`만 호출, **새 UI 인스턴스를 반환하지 않고 `this`를 반환**한다 — 새 인스턴스를
  반환하면 매번 `prev_ui_stack`에 쌓여서 "뒤로가기"가 이전 웹 재선택 내역을 하나씩 되짚는 부작용이
  생기기 때문(원래 의도는 "뒤로가기"가 바로 `SelectQuizTypeUI`로 돌아가는 것).
  **순환 require 버그(2026-08-08 실사용 테스트에서 발견, 수정 완료)**: `dev-quiz-select-ui.ts`가 이미
  `dev-quiz-info-ui.ts`를 require하고 있어서(`handleContentSelected`에서 `DevQuizInfoUI` 생성), 여기서
  `DevQuizSelectUI`를 파일 상단에서 top-level로 require하면 순환이 생겨 나중에 로드되는 쪽이 텅 빈
  `module.exports`를 캡처해버림 — `DevQuizSelectUI`가 `undefined`로 잡혀서 확정 후 재선택 시
  `Cannot read properties of undefined (reading 'buildDevQuizInfoFromWebPayload')`로 죽었음. 해결:
  `require('./dev-quiz-select-ui')`를 `onReceivedWebSessionSignal` 함수 안으로 미뤄서(이벤트 발생
  시점엔 모든 모듈 로드가 끝난 뒤라 안전) 순환 자체는 남아있지만 문제없이 동작하게 함.
  `test/quiz_ui/dev_quiz_web_reapply.test.js`(신규)가 이 회귀를 자동으로 잡음 — `dev-quiz-select-ui.ts`를
  먼저 require하는 순서로 재현, fix 되돌려서 실제로 같은 에러가 재현되는 것도 확인함.
- `quizbot/quiz_ui/quiz-info-ui.ts` (수정, 2026-08-08) — `handleStartQuiz`(Dev/User/Omakase 공통) 끝에
  `ipc_manager.sendWebSessionRequest({action:'release', guild_id})` fire-and-forget 추가. 퀴즈가 실제
  시작되면 그 길드의 웹 세션(있다면)을 파기한다.
- `quizbot/quiz_ui/select-quiz-type-ui.ts` (수정) — `'1'`(공식 퀴즈) 분기가 `DevQuizSelectUI` 대신
  `new WebHandoffUI('dev', interaction)` 반환. `'2'`(유저)/`'3'`(오마카세)는 Phase 2/3에서 교체 예정,
  아직 기존 흐름 그대로.
- `quizbot/quiz_ui/ui-system-core.ts` (수정) — `WebHandoffUI` import, `UIHolder.isDisplayingWebHandoff()`
  (`instanceof` 체크, `isDisplayingMultiplayerLobby()`와 동일 패턴), `createMainUIHolder`에 하이재킹
  감지 분기(ephemeral 안내 + `web_handoff_force_take_comp`), `createWebHandoffUIHolder(interaction,
  mode, existing_session?, use_public_message_mode?)`(force_take 전용 진입점),
  `relayWebSessionSignal(signal)`(`relayMultiplayerSignal`과 동일 패턴, guild_id 1개만 대상이라 배열
  순회 불필요). **`UIHolder.free()`(수정, 2026-08-08)** — 홀더가 사라지는 모든 경로(새 명령어 진입,
  `/퀴즈정리`, 관리자 패널, aging manager 등)에서 공통으로 `release` fire-and-forget 요청(고아 토큰
  방지, 5-1 참고).
- `quizbot/quiz_ui/common-ui.ts` (수정) — `CUSTOM_EVENT_TYPE.receivedWebSessionSignal` 케이스 +
  `onReceivedWebSessionSignal` 더미 콜백(패턴은 `receivedMultiplayerSignal`과 동일).
- `quizbot/quiz_ui/components/web_handoff_components.ts` (신규) — `web_handoff_force_take_comp`(하이재킹
  방어 ephemeral 버튼) 하나만. `WebHandoffUI` 자체의 잠금 화면 컴포넌트(Link 버튼)는 여기 안 두고
  `web-handoff-ui.ts`에서 직접 생성(재사용 필요가 없어서) — Link 스타일 버튼은 디스코드 클라이언트가
  인터랙션 없이 바로 브라우저를 열어주므로 소유자 전용 체크와 무관하게 항상 안전함.
- `utility/util/web_token_utility.ts` (신규) — `crypto.randomBytes(32).toString('hex')` 기반 토큰 생성.
- `config/system_setting.js` (수정) — `WEB_SERVER_PORT`/`WEB_BASE_URL`/`WEB_SESSION_EXPIRE_SEC`/
  `WEB_SESSION_GC_INTERVAL_SEC`/`WEB_FRONTEND_DIST_PATH`(PROJECT_ROOT 기준, dist/ 빌드 후에도 안전) +
  `CUSTOM_EVENT_TYPE.receivedWebSessionSignal` 추가.
- `web-frontend/` (신규, 루트) — **React+Vite, Tailwind 없이 승인된 CSS(`docs/WEB_UI_MOCKUP.html`의
  `<style>` 전체)를 `src/styles.css`로 그대로 이식**(원래 계획은 Tailwind였으나, 승인된 목업이 처음부터
  순수 CSS라 Tailwind로 재작성하면 시각적 드리프트 위험만 있고 얻는 게 없어 2026-08-08 착수 시점에
  변경 — 체크포인트 1 진행 전 사용자 승인받음). `src/api.js`(토큰 추출+마스킹+fetch 래퍼),
  `src/App.jsx`(헤더/테마토글/탭레일, 세션 부트스트랩, 60초 heartbeat), `src/DevQuizTab.jsx`(트리
  브라우저+상세+문제수 스테퍼+확정). user/omakase 탭은 자기 모드가 아니면 버튼 자체가 `disabled`(Phase
  2/3에서 활성화). eslint.config.js의 `ignores`에 `web-frontend/**` 추가(독립 ESM/JSX 프로젝트라 루트
  CommonJS 전용 설정 대상이 아님 - 자체 린트는 `vite build`의 esbuild 진단으로 충분).
- `test/managers/web/web_session_manager.test.js` — 토큰 발급/force_take/select/apply(토큰 유지
  확인)/release(조용한 파기 확인)/heartbeat/GC 14건.
- `test/managers/web/web_express_app.test.js` (신규) — 실제 Express 서버를 임시 포트로 띄우고
  `fetch`로 API 왕복 검증(인증 미들웨어, dev-quizzes 트리 shape, select 브로드캐스트, confirm
  클램프+토큰 유지, confirm 연속 2회 재선택) 8건. `resources/quizdata`를 실제로 읽음(`util_split.test.js`와
  동일 관례).

Phase 2(유저 퀴즈)에서 실제로 만들어진/바뀐 파일(2026-08-08):

- `quizbot/quiz_ui/select-ui-mode-ui.ts` (신규, 투트랙 진입점 분리 작업의 일부지만 Phase 2 착수 직전
  같은 날 완료) — `/퀴즈` 최초 진입 화면. 상세는 위 "8. 투트랙 진입점 분리" 참고.
- `quizbot/managers/db/db_quiz.ts` (수정) — `selectQuizInfoById(quiz_id)` 신규. 기존엔 전체
  (`selectAllQuizInfo`)/creator별(`selectQuizInfo`) 조회만 있었고 quiz_id 단건 조회가 없었음.
- `quizbot/managers/user_quiz_info_manager.ts` (수정) — `loadUserQuizInfoById(quiz_id)` 신규,
  `selectQuizInfoById` 결과를 `UserQuizInfo`로 조립(question_list는 기존 관행대로 비워둠 -
  `UserQuizInfoUI.onReady()`가 나중에 `loadQuestionListFromDB()`로 채움).
- `quizbot/managers/web/web_express_app.ts` (수정) — `GET /api/user-quizzes`(전체 목록 +
  `QUIZ_TAG` 기반 태그 목록, `loadUserQuizListFromDB(undefined)`를 디스코드 쪽 `UserQuizSelectUI`와
  동일하게 매 요청마다 조회 후 프론트엔드에서 필터/정렬), `GET /api/user-quizzes/:quiz_id`(상세 +
  `selectQuestionInfo`로 계산한 실제 문제 수). **`POST /api/session/confirm` 일반화**: `session.mode`
  (세션 생성 시 1회 고정) 대신 요청 본문의 `mode` 필드로 dev/user를 분기 — `mode:'user'`는
  `loadUserQuizInfoById` + `loadQuestionListFromDB()`로 실시간 문제 수를 재조회해 클램프한다(프론트엔드
  캐시값을 신뢰하지 않음, dev 모드가 `dev_quiz_tree_cache`로 quiz_size를 재검증하는 것과 동일한 원칙).
- `quizbot/quiz_ui/web-handoff-ui.ts` (수정) — `handleApplied`가 `this.mode` 대신 `payload.mode`로
  분기하도록 변경(세션이 더 이상 단일 모드에 고정되지 않으므로). `buildUserQuizInfoUI(payload)`(신규,
  비동기) — `loadUserQuizInfoById`로 조회 후 `new UserQuizInfoUI(user_quiz_info, true)` 생성,
  `next_ui.quiz_info['selected_question_count']`를 `onReady()` 호출(question_list 로드) **전에**
  미리 채워둬서 `fillInfoAsDevQuizInfo()`가 기본값(전체 문제 수)으로 덮어쓰지 않게 한 뒤
  `this.holder.appendNewUI(next_ui); this.holder.updateUI();`를 직접 호출(dev 모드와 달리 DB 조회가
  필요해 `UIHolder.on()`의 동기 계약을 만족할 수 없음 - "중요 제약" 패턴).
- `quizbot/quiz_ui/user-quiz-info.ui.ts` (수정) — `onReceivedWebSessionSignal`/`reapplyFromWebPayload`
  신규(`dev-quiz-info-ui.ts`와 동일 패턴, 단 DB 조회가 필요해 비동기). `'applied'` 신호를 받으면
  새 quiz_id로 `UserQuizInfo`를 다시 로드하고 `this.user_quiz_info`/`this.quiz_info`를 갱신 후
  `this`를 유지(새 인스턴스를 만들지 않아 뒤로가기 스택이 안 쌓임 - dev와 동일한 이유).
- `web-frontend/src/api.js` (수정) — `getUserQuizzes`/`getUserQuizDetail` 신규,
  `confirmSelection(mode, selection, selected_question_count)`로 시그니처 변경(mode 파라미터 추가).
- `web-frontend/src/DevQuizTab.jsx` (수정) — `selectQuiz`/`confirmSelection` 호출에 `mode: 'dev'` 추가.
- `web-frontend/src/UserQuizTab.jsx` (신규) — 검색(제목/한줄소개/제작자)+태그 AND 필터(칩, `QUIZ_TAG`
  비트마스크)+인증 필터 토글+정렬(업데이트순/추천순/인기순/이름순, 전부 클라이언트 사이드 - dev 탭의
  "한 번에 불러와서 브라우저에서 필터"와 동일 관행)+카드 그리드+상세 패널(문제 수 스테퍼+확정),
  `docs/WEB_UI_MOCKUP.html`의 유저 퀴즈 탭 마크업/인터랙션을 그대로 이식.
- `web-frontend/src/App.jsx` (수정) — 탭 활성화 판단을 `session.mode`(세션 고정값) 비교에서
  `AVAILABLE_MODES = {dev:true, user:true, omakase:false}` 상수 조회로 변경. `UserQuizTab` 렌더 분기 추가.
- `test/managers/db_manager.test.js` (수정) — `selectQuizInfoById` 쿼리 검증 테스트 추가, 재수출
  개수 33→34.
- `test/managers/user_quiz_info_manager.test.js` (신규) — `loadUserQuizInfoById` 조립/미조회 케이스.
- `test/managers/web/web_express_app.test.js` (수정) — 기존 dev confirm 테스트에 `mode:'dev'` 추가
  (일반화로 인한 계약 변경 반영), `mode` 누락/미지원 시 400 테스트, `GET /api/user-quizzes`(목록+태그)/
  `GET /api/user-quizzes/:quiz_id`(404/question_count)/`POST /api/session/confirm(mode:'user')`
  신규 테스트 — `db_manager` 경계에서 mock(`db_manager.test.js`와 동일 관례).
- `test/quiz_ui/user_quiz_web_apply.test.js` (신규) — `WebHandoffUI.buildUserQuizInfoUI`/
  `UserQuizInfoUI.onReceivedWebSessionSignal` 재선택 회귀(`dev_quiz_web_reapply.test.js`와 동일 취지,
  `user_quiz_info_manager`/`db_manager` mock으로 DB 경계 차단).

Phase 3(랜덤/오마카세 퀴즈)에서 실제로 만들어진/바뀐 파일(2026-08-08):

- `quizbot/quiz_ui/omakase-quiz-room-ui.ts` (수정) — `static applyWebPayloadToQuizInfo(quiz_info,
  payload)`(웹 payload를 quiz_info에 덮어씌움 - dev_quiz_tags/basket_mode/custom_quiz_type_tags/
  custom_quiz_tags/certified_filter/basket_items/selected_question_count, 문제 수는 quiz_size(100)로
  클램프) + `static buildOmakaseQuizInfoFromWebPayload(payload, adapter_interaction)`(기본
  omakase_quiz_info를 만들고 그 위에 payload를 덮어씀 - dev-quiz-select-ui.ts의
  `buildDevQuizInfoFromWebPayload`와 동일 취지, WebHandoffUI/자기 자신이 공유). `onReceivedWebSessionSignal`
  (신규) — dev-quiz-info-ui.ts와 동일 패턴(재선택 시 같은 인스턴스 갱신), omakase는 DB 조회가 필요 없어
  동기 처리. `QuizInfoUI.BASKET_CACHE[guild_id]`도 여기서 갱신.
- `quizbot/quiz_ui/web-handoff-ui.ts` (수정) — `handleApplied`에 `'omakase'` 분기 + `buildOmakaseQuizInfoUI(payload)`
  (동기 - `{guild: this.guild, member: {id: this.owner_id}}` 최소 어댑터로 `createDefaultOmakaseQuizInfo`
  재사용, `QuizInfoUI.BASKET_CACHE` 갱신 포함).
- `quizbot/managers/web/web_express_app.ts` (수정) — `GET /api/omakase-tags`(DB 조회 없이 `DEV_QUIZ_TAG`
  전체를 `dev_tags`로, `QUIZ_TAG`를 `omakase_components.ts`와 동일한 규칙(값≤4="유형", 값>4="장르")으로
  `type_tags`/`genre_tags`로 분류해 반환). `/api/session/confirm`에 `mode:'omakase'` 분기(문제 수는
  고정 상한 100으로 클램프, 나머지 필드는 프론트엔드가 보낸 값을 그대로 전달 - DB 재검증이 필요 없는
  정적 설정이므로 dev/user와 달리 존재 여부 확인 자체가 불필요).
- `web-frontend/src/quizCardUtils.js` (신규) — `UserQuizTab.jsx`/`OmakaseTab.jsx`가 공유하는 카드 표시
  헬퍼(`fallbackThumbFor`/`isValidThumbnailUrl`/`formatDate`)를 분리 - 기존엔 `UserQuizTab.jsx`에만
  있던 걸 Phase 3에서 재사용하며 공용 모듈로 뺌.
- `web-frontend/src/OmakaseTab.jsx` (신규) — 공식 퀴즈 장르 칩(다중선택) + 유저 퀴즈 모드 전환
  버튼(장르로 뽑기/직접 담기) + 장르로 뽑기 모드(유형 칩/장르 칩/인증 필터 토글) + 직접 담기
  모드(검색+정렬+태그 필터로 유저 퀴즈 브라우징, `/api/user-quizzes` 재사용, 카드 클릭으로 퀴즈함
  담기/빼기 토글) + 🍱 FAB+드로워(담긴 퀴즈 목록 확인/제거, 디스코드 25개 제한과 달리 자유롭게 담을 수
  있음을 안내) + 우측 "설정 요약" 카드(현재 조합 실시간 표시 + 문제 수 스테퍼(최대 100) + 확정 버튼,
  아무것도 선택 안 하면 비활성화). 설정이 바뀔 때마다(칩 토글/모드 전환/퀴즈함 추가삭제) `selectQuiz`를
  호출해 디스코드 임베드를 실시간 갱신(요약 문구를 `title`로 실어보냄, `WebHandoffUI.refreshLockedEmbed`가
  그대로 표시).
- `web-frontend/src/api.js` (수정) — `getOmakaseTags` 신규.
- `web-frontend/src/App.jsx` (수정) — `AVAILABLE_MODES.omakase`를 `true`로 변경, `OmakaseTab` 렌더 분기
  추가. 세 탭 모두 실제로 동작하는 시점이라 세션 mode 관련 주석도 "Phase 1/2/3 완료" 기준으로 갱신.
- `test/managers/web/web_express_app.test.js` (수정) — `GET /api/omakase-tags`(유형/장르 분류 검증)와
  `POST /api/session/confirm(mode:'omakase')`(문제 수 100 클램프, basket_items 그대로 전달) 신규 테스트.
  DB 조회가 없어 mock 불필요.
- `test/quiz_ui/omakase_web_apply.test.js` (신규) — `WebHandoffUI.buildOmakaseQuizInfoUI`/
  `OmakaseQuizRoomUI.onReceivedWebSessionSignal` 재선택 회귀 - DB 조회가 없어 dev 모드처럼 mock 없이
  동기로 직접 검증 가능(`dev_quiz_web_reapply.test.js`와 유사하지만 더 단순함).

Phase 3 직후 사용자 UX 피드백 6건 반영(2026-08-09, 프론트엔드만, 백엔드 무변경):

- `web-frontend/src/QuizDetailCard.jsx` (신규) — `UserQuizTab.jsx`/`OmakaseTab.jsx`가 공유하는 유저
  퀴즈 상세 정보 표시. 제작자/한줄 소개/태그/상세 설명을 각각 `field-label`로 분리(기존엔 전부
  `detail-desc` 하나로 뭉쳐 있어서 구분이 안 갔음). children으로 각 탭 전용 액션(문제 수 스테퍼+확정
  버튼 / 퀴즈함 담기·빼기 버튼)을 받는다.
- `web-frontend/src/OmakaseTab.jsx` (수정) — 퀴즈함 브라우징 카드 클릭이 곧장 담기/빼기로 동작하던
  걸 "클릭=상세 정보 미리보기"로 변경(`selectedQuiz`/`omaDetail` 상태 추가, `QuizDetailCard` 재사용),
  담기/빼기는 상세 패널 전용 버튼(`cta-primary`/`variant-danger` 토글)으로 분리. 드로워(`qd-row`)
  항목 클릭 시에도 동일하게 상세 미리보기 연결(`userQuizzes` 전체 목록에서 quiz_id로 재조회).
  공식 퀴즈 장르 섹션을 강조 카드(`section-block accent`)로 감싸고 선택 개수 배지(`selection-badge`)
  + 안내 문구 추가, 설정 요약 카드에 넛지 버튼(`nudge`, devTags가 0일 때만 노출 - 클릭 시
  `scrollIntoView`로 장르 섹션까지 스크롤).
- `web-frontend/src/UserQuizTab.jsx` (수정) — 상세 패널을 `QuizDetailCard`로 교체(중복 제거).
- `web-frontend/src/App.jsx` (수정) — `ThemeToggle`의 기본 상태를 `'system'`에서 `'light'`로 변경 -
  OS가 다크 모드인 사용자도 첫 진입은 라이트로 보이게(토글에서 수동 전환은 그대로 가능).
- `web-frontend/src/styles.css` (수정) — `.detail-col`에 `position: sticky; top: 16px; align-self:
  start;` 적용(880px 이하 모바일 레이아웃에서는 `position: static`으로 비활성) - 목록을 한참 스크롤해도
  상세/확정 패널이 뷰포트에 계속 보이도록. `.section-block.accent`/`.selection-badge`/`.nudge` 신규
  클래스(공식 퀴즈 장르 가시성 개선용).

## 단계별 구현 순서

0. ~~**Phase -1 — UI 목업**~~ **완료** (`docs/WEB_UI_MOCKUP.html`, 2026-08-08 사용자 승인).
1. ~~**Phase 0 — 인프라 스켈레톤**~~ **완료** (2026-08-08): IPC 메시지 타입 2개, 마스터
   `web_session_manager.ts`(토큰 발급/force_take/close/heartbeat/GC), `web_express_app.ts`(Express
   최소 골격, `/health` + 정적 파일 서빙), `web_token_utility.ts`, 설정값 추가. UI 변경 없음.
2. ~~**Phase 1 — 공식 퀴즈 웹 선택**~~ **완료** (2026-08-08, 2차 수정까지 반영): 위 "신규/변경 파일"
   목록 전체. `WebHandoffUI`(dev 모드) + Express API(`/api/session`, `/api/dev-quizzes`,
   `/api/session/select`, `/api/session/confirm`) + React 프론트엔드(공식 퀴즈 탭 완전 동작) +
   하이재킹 방어(force_take)까지 엔드투엔드로 연결됨.
   - **1차 실사용 버그 수정**: 원래 confirm이 토큰을 즉시 파기해서 확정 후 문제 수 재변경/다른 퀴즈
     선택이 전부 `invalid_or_expired_token`으로 조용히 실패했음 — 우선 `DevQuizTab.jsx`를 "확정 후
     종료 화면"으로 막는 방식으로 응급 수정.
   - **2차 재설계(최종)**: 응급 수정 대신 근본 원인을 고침 — 토큰 파기 시점을 confirm에서
     "퀴즈 실제 시작"/"UIHolder 소멸"로 옮기고(5-1 "토큰 생명주기" 참고), `DevQuizInfoUI`가 직접
     웹 신호에 반응하도록 만들어서 **확정 후에도 웹에서 계속 재선택/문제 수 재조정이 가능**해짐.
     `DevQuizTab.jsx`의 "종료 화면"은 되돌리고, 확정 시 1.5초짜리 "✓ 디스코드에 적용됨" 토스트만
     보여주는 걸로 교체(원래 승인된 목업의 `flashConfirm` 동작과 동일).
   - 검증: `npx tsc --noEmit`(0 error) / `npm run lint`(0 error, 58 warning 기존 수준 유지) /
     `npm test`(244 pass) / `npm run build`(dist/ 정상) / `web-frontend` `npm run build`(정상) /
     Express가 빌드된 프론트엔드를 실제로 서빙하고 `/api/dev-quizzes`가 실제 `resources/quizdata`
     트리를 반환하는 것까지 fetch로 실측 확인. **미검증**: 이번 2차 재설계는 아직 실제 Discord
     클라이언트로 안 돌려봄 — 특히 "확정 후 재선택"과 "고아 토큰 방지(홀더 소멸 시 release)"는
     다음 세션에서 반드시 실사용 검증 필요(`docs/TEST_CHECKLIST.md` O 섹션 참고, `npm run build` 후
     재시작 잊지 말 것).
3. ~~**투트랙 진입점 분리**~~ **완료** (2026-08-08, Phase 2 착수 직전): `/퀴즈` 직후 `SelectUIModeUI`
   (디스코드 UI/웹 UI 선택)를 먼저 띄우도록 변경 — 상세는 위 "8. 투트랙 진입점 분리" 참고. mode는 여전히
   'dev' 고정(사용자 확인 완료), Phase 2/3에서 유저/랜덤 백엔드가 붙을 때 이 화면의 `WebHandoffUI`
   생성부를 mode-switchable하게 확장할 예정.
4. ~~**Phase 2 — 유저 퀴즈 웹 선택**~~ **완료** (2026-08-08): "웹 UI" 진입점이 이제 `select-quiz-type-ui.ts`가
   아니라 `select-ui-mode-ui.ts`라 **`select-quiz-type-ui.ts`는 이번에도 건드리지 않음**(디스코드 트랙
   전용으로 계속 분리 유지). 세션의 `mode`는 여전히 생성 시 'dev'로 고정하되(App.jsx 탭 전환은 순전히
   프론트엔드 상태로 만듦), `WebHandoffUI.handleApplied`/`web_express_app.ts`의 `/api/session/confirm`을
   `this.mode`/`session.mode`(세션 1회 고정값) 대신 **요청/payload에 실린 `mode` 필드**로 분기하도록
   일반화 — 이렇게 하면 세션 하나로 dev/user 탭을 자유롭게 오갈 수 있으면서도 `web_session_manager.ts`는
   원래부터 스테이트리스(payload를 그대로 릴레이만 함)라 전혀 손댈 필요가 없었음. `WebHandoffUI`에
   `buildUserQuizInfoUI(payload)`(비동기, DB 조회 필요 — "중요 제약" 패턴대로 fire-and-forget 후
   `appendNewUI`+`updateUI()` 수동 호출) 추가, `UserQuizInfoUI`에도 `dev-quiz-info-ui.ts`와 같은 패턴으로
   `onReceivedWebSessionSignal`/`reapplyFromWebPayload`를 구현해 확정 후 재선택 지원. 신규 DB 헬퍼:
   `db_quiz.ts`의 `selectQuizInfoById`(quiz_id 단건 조회 — 기존엔 전체/creator별 조회만 있었음) +
   `user_quiz_info_manager.ts`의 `loadUserQuizInfoById`. Express: `GET /api/user-quizzes`(전체 목록 +
   `QUIZ_TAG` 태그 목록, `quiz_size`는 목록에 없으니 카드에 노출 안 함) + `GET /api/user-quizzes/:quiz_id`
   (상세, `selectQuestionInfo`로 실제 문제 수 계산 — confirm 시에도 이 값으로 재검증해 프론트엔드
   캐시값을 신뢰하지 않음). 프론트엔드 `UserQuizTab.jsx` 신설(검색+태그 AND 필터+인증 토글+정렬+
   카드 그리드+상세/스테퍼/확정, `docs/WEB_UI_MOCKUP.html`의 유저 퀴즈 탭 디자인을 그대로 이식),
   `App.jsx`는 세션 `mode` 락을 제거하고 `AVAILABLE_MODES`(dev/user는 true, omakase는 아직 false)로
   탭 활성화 여부만 판단하도록 변경.
   - 검증: `npx tsc --noEmit`(0 error) / `npm run lint`(0 error, 58 warning 기존 수준 유지) /
     `npm test`(260 pass, db_manager/user_quiz_info_manager/web_express_app/web-handoff-ui·
     user-quiz-info.ui 재선택 신규 테스트 포함) / `npm run build`(dist/ 정상) / `web-frontend`
     `npm run build`(정상). **미검증**: 아직 실제 Discord 클라이언트 + 브라우저로 안 돌려봄 —
     특히 "유저 퀴즈 탭에서 검색/태그 필터/확정 → `UserQuizInfoUI` 전환 → 재선택" 전체 흐름은 다음
     세션에서 실사용 검증 필요(`docs/TEST_CHECKLIST.md` P 섹션 참고, `npm run build` 후 재시작 잊지 말 것).
5. ~~**Phase 3 — 랜덤(오마카세) 퀴즈**~~ **완료** (2026-08-08): `WebHandoffUI.handleApplied`에
   `'omakase'` 분기 추가 — omakase payload(`dev_quiz_tags`/`custom_quiz_type_tags`/`custom_quiz_tags`/
   `certified_filter`/`basket_items`/`selected_question_count`)는 DB 조회가 필요 없는 작은 데이터라
   dev 모드처럼 동기로 처리(`buildOmakaseQuizInfoUI`). `OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo`가
   `interaction.guild`/`interaction.member.id`만 쓰므로 `{guild: this.guild, member: {id:
   this.owner_id}}` 형태의 최소 어댑터 객체로 재사용(WebHandoffUI 생성자에서 이미 캡처해둔 값).
   `OmakaseQuizRoomUI`에 `static applyWebPayloadToQuizInfo`/`static
   buildOmakaseQuizInfoFromWebPayload`(dev-quiz-select-ui.ts의 `buildDevQuizInfoFromWebPayload`와
   동일 취지 - 최초 적용/재적용이 공유하는 헬퍼) + `onReceivedWebSessionSignal`(재선택 시 같은 인스턴스
   갱신, dev/user와 동일 이유로 새 인스턴스 반환 안 함) 추가. `QuizInfoUI.BASKET_CACHE[guild_id]` 갱신도
   최초 적용/재적용 양쪽에서 함. Express: `GET /api/omakase-tags`(DB 조회 없이 `DEV_QUIZ_TAG`/`QUIZ_TAG`
   config만 노출 - `omakase_components.ts`의 태그 select 메뉴와 동일한 유형(값≤4)/장르(값>4) 분류
   규칙 재사용), `/api/session/confirm`에 `mode:'omakase'` 분기(문제 수를 고정 상한 100으로 클램프,
   나머지 필드는 그대로 전달). 프론트엔드 `OmakaseTab.jsx` 신설(공식 장르 칩 + 유저 퀴즈 모드
   전환(장르로 뽑기/직접 담기) + 유형·장르 칩 + 인증 필터 + 퀴즈함 브라우징(검색/정렬/태그 필터,
   `/api/user-quizzes` 재사용) + FAB+드로워로 퀴즈함 확인/제거 + 우측 "설정 요약" 카드, 목업 디자인
   그대로 이식). `UserQuizTab.jsx`/`OmakaseTab.jsx`가 공유하는 카드 표시 헬퍼(`fallbackThumbFor`/
   `isValidThumbnailUrl`/`formatDate`)는 `quizCardUtils.js`로 분리. `App.jsx`의
   `AVAILABLE_MODES.omakase`를 true로 변경 — 세션 mode 개념은 Phase 2에서 이미 일반화해둬서 추가 변경
   불필요했음.
   - 검증: `npx tsc --noEmit`(0 error) / `npm run lint`(0 error, 58 warning 기존 수준 유지) /
     `npm test`(267 pass, omakase 관련 신규 테스트 21건 포함) / `npm run build`(백엔드+프론트엔드)
     전부 통과. **미검증**: 아직 실제 Discord+브라우저로 안 돌려봄 — 특히 "확정 후 웹에서 설정을
     바꿔 재선택"과 "퀴즈함 25개 초과 시 웹에서만 자유롭게 담기는지"는 다음 세션 실사용 검증 필요.
6. ~~**Phase 4 — 멀티플레이 퀴즈 웹 연동**~~ **코드 구현 완료** (2026-08-10, 같은 세션에 설계+구현 진행).
   상세는 아래 "Phase 4" 섹션. **미검증**: 아직 실제 Discord+브라우저로 안 돌려봄(단일 클러스터 환경에서
   `tsc`/`lint`/`test`/`build`만 확인). **(범위 외, 추후 논의) Cloudflare Tunnel 배포**.

## Phase 4 — 멀티플레이 퀴즈 웹 연동 (설계+구현 완료, 2026-08-10)

> 이 섹션은 2026-08-10 설계 세션 결과물. 같은 세션에서 "착수 전 확인 체크리스트" 4개 항목을 확인한 뒤
> 곧장 코드 구현까지 진행함(사용자 확인 후 착수). 실사용 검증(Discord+브라우저, 2클러스터 이상 IPC
> 왕복)은 아직 안 됨 — 다음 세션 최우선.

### 착수 전 확인 체크리스트 결과 (2026-08-10)

1. **`ban_manager.initialize()` 위치**: 기존엔 `bot.js`(클러스터)에서만 호출. 파일 기반 싱글턴이라
   마스터에도 안전하게 추가 가능 — `index.js`에 require+`initialize()` 추가함(완료).
2. **대기실 목록 마스터 직접 조회**: 예상보다 좋은 상황이었음 — `index.js`가 `MULTIPLAYER_SIGNAL`을
   `multiplayer_manager.onSignalReceived`로 **이미 인프로세스(마스터) 처리**하고 있어서,
   `REQUEST_LOBBY_LIST` 핸들러(`multiplayer_signal_handlers.js`의 `handleRequestLobbyList`)도 이미
   마스터에서 실행 중이었음. `GET /api/multiplayer-lobbies`는 IPC 왕복 없이 `onSignalReceived(...)`를
   그대로 호출(완료).
3. **`createLobby`/`tryJoinLobby`/`applyQuizSettings`의 interaction 의존**: 예상보다 깊었음 -
   `applyQuizSettings`(모달 필드 읽기)뿐 아니라 `requestToCreateLobby`/`requestToJoinLobby`의
   `interaction.reply()`(성공/실패 피드백)까지 의존. 사용자에게 대응 방식을 확인받아(페이로드 직접
   대입 + 신규 static 헬퍼, `MultiplayerQuizLobbyUI.applyWebPayloadToQuizInfo`/
   `buildMultiplayerQuizInfoFromWebPayload` + `is_web_origin` 분기) 그대로 구현함.
4. **설계 재확인**: 위 1~3 조사 결과를 사용자에게 요약 보고 후 대응 방식(3번) 확정 → 곧장 구현 착수.

### 배경 / 진입점

`/멀티퀴즈`(`MultiplayerQuizSelectUI`, `multiplayer-quiz-select-ui.js`)는 **디스코드 전용으로 그대로
유지**한다 — 건드리지 않는다. 웹 연동은 오직 기존 `/퀴즈` → `SelectUIModeUI` → "웹 UI" 트렁크에
**4번째 탭 "멀티플레이 퀴즈"** 를 추가하는 방식(사용자 결정, 2026-08-10). 즉 디스코드 유저는 `/멀티퀴즈`로,
웹 유저는 `/퀴즈`→웹UI→멀티플레이 탭으로 각각 들어간다.

퀴즈 진행 자체(참가자 목록/준비/추방/시작/`/챗` 전체채팅)는 **100% 디스코드에 남는다** — 웹은 "로비를
찾아서 참가하거나 만드는 것 + 참가 전 설정"까지만 담당한다. 채팅 기능은 웹에 만들지 않는다(사용자 확인).

### 웹 탭의 2단계 화면

1. **대기실 목록** (`MultiplayerQuizSelectUI`의 디스코드 목록과 동일한 데이터) — [참가]/[새 로비 만들기].
2. **[새 로비 만들기]를 누른 경우만** — 방 제목(1~20자)+문제 수(최대 60) 입력 후, 이어서 **`OmakaseTab.jsx`와
   동일한 셰이프의 설정 화면**(공식 장르 칩+유저 퀴즈 장르모드/바구니모드, 공식 퀴즈 단일 선택·유저 퀴즈
   단일 선택 탭은 없음 — 랜덤 퀴즈 셰이프만). `MultiplayerQuizLobbyUI.createDefaultMultiplayerQuizInfo`의
   quiz_info 필드가 오마카세와 사실상 동일하므로 `OmakaseQuizRoomUI.applyWebPayloadToQuizInfo`/
   `buildOmakaseQuizInfoFromWebPayload` 같은 static 헬퍼를 그대로(또는 아주 약간만 손봐서) 재사용한다.

### 핵심 설계 결정

1. **대기실 목록은 마스터가 직접 서빙한다(릴레이 불필요)** — `index.js`가 이미 `multiplayer_manager.
   initialize(manager)`를 호출하고(`index.js:22,38`) `CLIENT_SIGNAL` IPC를 `multiplayer_manager.
   onSignalReceived(message.signal)`로 직접 처리한다(`index.js:64`) — 즉 `multiplayer_session_registry.js`의
   `multiplayer_sessions`는 **이미 마스터 프로세스 메모리에 있다**(2026-08-10 코드로 확인 완료, 결정 #1의
   전제와 일치). 신규 `GET /api/multiplayer-lobbies`는 클러스터에 릴레이하지 않고 마스터가 레지스트리를
   직접 읽어서 응답 — `/api/dev-quizzes`(결정 #3)와 동일한 이유.

2. **참가/생성 확정은 2홉 구조가 된다** — `quiz_system.checkReadyForStartQuiz(guild, owner)`
   (`quiz_system.ts:51`)가 `owner.voice.channel`(실제 discord.js `GuildMember`의 음성 상태)을 읽어야 해서
   **마스터에서 실행 불가**, 반드시 그 길드를 담당하는 클러스터에서 처리해야 한다. 그래서 확정 흐름은:
   웹 → 마스터(`WEB_SESSION_SIGNAL{event:'applied', payload:{action:'join'|'create', ...}}` 브로드캐스트)
   → 해당 길드가 속한 클러스터가 로컬 `ui_holder_map[guild_id]`로 필터링해 받은 뒤, 기존
   `multiplayer-quiz-select-ui.js`의 `tryJoinLobby`/`createLobby`와 **동일한 로직**(음성채널 체크 →
   `MultiplayerQuizLobbyUI` 생성 → 생성자 내부에서 기존 `CLIENT_SIGNAL.JOIN_LOBBY`/`CREATE_LOBBY` IPC를
   그대로 호출)을 수행한다. Phase 2(유저 퀴즈)에서 쓴 "중요 제약" 패턴(비동기 fire-and-forget 후
   `this.holder.appendNewUI(...)`/`updateUI()` 수동 호출)을 그대로 재사용.
   - `tryJoinLobby`/`createLobby`는 지금 `interaction` 객체(길드/멤버/모달 필드)에 강하게 의존한다 —
     웹 경유일 땐 실제 인터랙션이 없으므로, Phase 3에서 썼던 `{guild, member:{id: owner_id}, ...}` 최소
     어댑터 패턴으로 대체 가능한지 착수 시 `createLobby`/`applyQuizSettings`/`tryJoinLobby`를 다시 읽고
     확인할 것(모달 필드 읽기(`interaction.fields.getTextInputValue`) 부분은 어댑터로 못 흉내내므로 웹
     payload 값을 quiz_info에 직접 채워 넣는 별도 헬퍼가 필요할 가능성이 높음).
   - **음성채널 제약은 웹에서도 그대로 적용된다** — 사용자가 브라우저에서 [참가]/[생성]을 누르는
     시점에 이미 디스코드 음성채널에 들어가 있어야 성공한다. 프론트엔드에 이 제약을 안내 문구로 명시할 것
     (안 그러면 "웹에서 눌렀는데 왜 안 되지" 혼란 발생 가능).

3. **Ban 체크(`ban_manager.ts`)는 마스터에서도 독립적으로 쓸 수 있다** — `resources/banned_user.txt`를
   읽는 파일 기반 싱글턴이라 Discord client 의존이 없음(2026-08-10 코드로 확인 완료) — 결정 #3의
   `db_manager`와 동일한 이유로 마스터가 자체적으로 `ban_manager.initialize()`를 호출해서 쓰면 된다.
   **확인 필요**: 지금 `ban_manager.initialize()`가 `bot.js`(클러스터)에서만 호출되는지, `index.js`에도
   추가해야 하는지 — 착수 시 제일 먼저 확인할 것.

4. **`MultiplayerQuizLobbyUI`(호스트, `readonly=false`)에 `onReceivedWebSessionSignal` 신규 필요** —
   `OmakaseQuizRoomUI`와 동일한 패턴으로 **`'applied'` 이벤트에만 반응**한다(재선택/확정 버튼을 실제로
   클릭했을 때만 — `'updated'`는 확정 전 미리보기용이라 반응 안 함, 기존 Dev/User/Omakase 전부 동일
   규칙). payload를 quiz_info에 적용한 뒤 **기존 `this.sendEditLobbySignal()`을 그대로 호출** — 이게
   전체 참가 길드에 브로드캐스트 + 다른 서버 준비완료 상태를 해제하는데, 이건 새로운 부작용이 아니라
   지금 디스코드에서 태그 select 메뉴를 하나 바꿀 때도 이미 일어나는 기존 동작이다(`handleTagSelected`).
   웹은 오히려 여러 칩을 만지다 확정 버튼 한 번이라 디스코드보다 브로드캐스트 빈도가 더 낮다(2026-08-10
   대화에서 확인, 별도 우려 불필요). `readonly=true`(참가자) 쪽은 애초에 설정 UI가 없으므로
   `onReceivedWebSessionSignal` 불필요 — 참가 확정 후 웹 세션의 역할은 사실상 끝난다("참가 완료,
   디스코드를 확인하세요" 안내로 종료).

### 실제 신규/변경 파일 (2026-08-10 구현 완료)

- `index.js` — `ban_manager` require + `initialize()` 마스터에도 추가.
- `quizbot/managers/web/web_express_app.ts` — `GET /api/multiplayer-lobbies`(마스터가
  `multiplayer_manager.onSignalReceived`를 인프로세스 직접 호출), `/api/session/confirm`에
  `mode:'multiplayer'` + `action:'join'|'create'` 분기 추가(밴 체크만 마스터에서 선제 처리).
- `quizbot/managers/web/web_session_manager.ts` — 최초 구현 땐 변경 없음(예상대로 스테이트리스 설계가
  그대로 재사용됨), 이후 실사용 피드백 수정으로 `reportMultiplayerResult`/`consumeMultiplayerResult`
  추가(아래 "실사용 피드백 6건 수정" 참고).
- `quizbot/quiz_ui/web-handoff-ui.ts` — `handleApplied`에 `'multiplayer'` 분기(`buildMultiplayerUI`,
  비동기) 추가 — `MultiplayerQuizSelectUI.createLobby`/`tryJoinLobby`와 동일한 밴/음성채널 체크를 직접
  재현한 뒤 `{guild, member, channel, web_mode:true}` 어댑터로 `MultiplayerQuizLobbyUI`를 생성.
  `MultiplayerQuizLobbyUI` require는 함수 내부로 미룸(그 파일이 `require("./user-quiz-select-ui.js")`처럼
  dist 전제 확장자를 하드코딩해둔 곳이 있어, top-level require 시 이 파일을 직접 require하는 다른
  mode(omakase/user) 테스트까지 ts-node 모듈 해석에서 깨졌음 — 실제로 `npm test`에서 발견하고 수정).
- `quizbot/quiz_ui/multiplayer-quiz-lobby-ui.js` — `static applyWebPayloadToQuizInfo`/
  `buildMultiplayerQuizInfoFromWebPayload`(신규, `OmakaseQuizRoomUI.applyWebPayloadToQuizInfo` 재사용 +
  방 제목 덮어쓰기), `is_web_origin` 플래그(생성자 3번째 인자가 아니라 `interaction.web_mode === true`로
  판별 — 실제 interaction엔 없는 필드라 기존 호출부는 전혀 안 건드림)로 `connectToMultiplayerSession`/
  `requestToJoinLobby`/`requestToCreateLobby`의 모달 읽기·`interaction.reply()` 의존 경로를 분기,
  `onReceivedWebSessionSignal`(호스트 전용) 신규.
- `quizbot/quiz_ui/multiplayer-quiz-select-ui.js` — **변경 없음**(웹 경유는 이 클래스를 거치지 않고
  `WebHandoffUI`가 곧장 `MultiplayerQuizLobbyUI`를 만들기로 함 - `createLobby`/`tryJoinLobby`를 굳이
  추출하지 않아도 됐음).
- `web-frontend/src/api.js` — `getMultiplayerLobbies`/`confirmMultiplayer` 추가.
- `web-frontend/src/OmakaseTab.jsx` — `ChipRow`/`BasketQuizCard`에 `export` 추가(동작 변경 없음,
  `MultiplayerTab.jsx`가 재사용하기 위함).
- `web-frontend/src/MultiplayerTab.jsx`(신규) — 대기실 목록(`list`) → 참가 또는 "새 로비 만들기"(`create`,
  방 제목+`OmakaseTab.jsx`와 동일 셰이프의 태그/퀴즈함 설정, 문제 수 상한만 60으로 다름) → 완료 안내
  (`done`) 3단계 뷰.
- `web-frontend/src/App.jsx` — `AVAILABLE_MODES.multiplayer` 추가, "멀티플레이 퀴즈" 탭 등록.

### Phase 4 실사용 피드백 6건 수정 (2026-08-10, 같은 세션)

최초 구현 직후 사용자가 실제 브라우저로 테스트해 발견한 문제 6건 — 상세는 `docs/COMPLETED_WORK_LOG.md`
참고, 요약만 여기 남김:

1. **새로고침/방 제목 입력칸 스타일이 unstyled 기본 브라우저 스타일이었음** — `styles.css`에
   `.btn-secondary`/`.text-field` 신설해서 앱 전체 디자인 시스템에 맞춤.
2. (1번과 동일 항목, 방 제목 입력칸)
3. **음성채널 미접속 상태로 로비 생성 시도해도 아무 에러가 안 뜸** — 근본 원인은 6번과 동일(아래).
   웹에도 실제 에러가 뜨도록 `report_multiplayer_result`/`GET /api/multiplayer-result`(1회성 폴링
   채널) 신설.
4. **로비 생성 후에도 계속 퀴즈함/태그 수정이 가능해야 함** — `MultiplayerQuizLobbyUI.
   onReceivedWebSessionSignal`은 이미 이걸 지원하고 있었지만(Omakase와 동일 패턴), 프론트엔드
   (`MultiplayerTab.jsx`)가 생성 성공 시 곧장 종료 화면("done")으로 보내버려서 실제로는 활용이
   안 되고 있었음 — 생성 후에도 같은 설정 화면에 머물며 재확정 가능하게 수정, "대기실 목록으로"는
   숨김(두 번째 로비를 실수로 또 만드는 것 방지).
5. **A(생성)→B(목록)→C(재생성) 시 이전 설정이 남아있는 게 의도인지 질문** — 4번 수정으로 "생성 후
   목록으로" 경로 자체가 사라져서 이 시나리오는 더 이상 발생하지 않음(생성 전 초안 상태에서 목록으로
   나갔다가 다시 "새 로비 만들기"를 여는 경우는 여전히 초안이 남는데, 이건 의도적으로 그대로 둠 - 사용자
   확인 필요시 리셋 옵션 추가 가능).
6. **음성채널에 들어간 상태로 재시도해도 로비가 생성되지 않음** — 진짜 원인. `WebHandoffUI.
   buildMultiplayerUI`가 밴/음성채널 체크 실패 시 `this.goToBack()`을 불렀는데, 이게 `WebHandoffUI`
   자신을 `prev_ui_stack`의 이전 화면(`SelectUIModeUI`)으로 교체해버려서, 최초 실패(3번, 음성채널
   미접속) 직후 `WebHandoffUI`가 이미 사라진 상태였음 — 그 뒤 웹에서 아무리 재시도해도(음성채널에
   들어간 뒤라도) 신호를 받을 화면 자체가 없어서 완전히 먹통이었던 것. `goToBack()`을 제거하고, 실패
   시 `this.last_error`를 채워 잠금 화면에 실패 사유만 얹어 보여주면서 `WebHandoffUI`를 그대로
   유지하도록 수정 — 재시도가 정상 동작함.

**여전히 남은 한계**:
- 밴/음성채널 체크(사전 검증) 결과만 웹에 정확히 보고되고, 그 이후 `MultiplayerQuizLobbyUI` 내부의 딥
  IPC(실제 로비 생성/참가 등록) 실패는 낙관적으로 성공 취급한다(드문 케이스 - 그 시점엔 이미
  `MultiplayerQuizLobbyUI`가 `prev_ui_stack`에 `WebHandoffUI`를 쌓아둔 채라 실패해도 자체 `goToBack()`
  으로 안전하게 복귀되긴 함, 웹에만 안 알려짐).
- **웹에서 설정 중 실시간 미리보기 없음**: dev/user/omakase 탭과 달리, "새 로비 만들기" 폼은 입력 중
  `/api/session/select`를 호출하지 않는다(디스코드 잠금 화면에 "현재 선택: ..."이 실시간으로 안 뜸) -
  확정(로비 생성) 버튼을 눌러야만 디스코드 쪽에 반영됨. 필요해지면 OmakaseTab처럼 각 설정 변경마다
  `selectQuiz({mode:'multiplayer', ...})`를 추가하면 된다.
- **실사용 검증 계속 진행 중**: 이번 6건은 사용자가 실제 브라우저로 테스트해 발견/수정했지만, 여전히
  2클러스터 이상 IPC 왕복/재확정 브로드캐스트/실제 게임 시작까지는 검증 안 됨 — 다음 세션 계속.

## 검증 방법

- `npx tsc --noEmit`(0 error), `npm run lint`(0 error 유지), `npm test`(백엔드 전체 — Phase 4까지
  267 pass), `npm run build`(dist/ 반영 확인, 루트 CLAUDE.md 경고: 재빌드 안 하면 운영 봇에 변경
  반영 안 됨), `web-frontend`에서 `npm run build`.
- IPC 왕복은 로컬에서 클러스터를 2개 이상 강제로 띄워서 확인(`totalClusters`를 임시로 2 이상 지정) —
  클러스터 1개 환경에서는 "다른 클러스터가 담당하는 길드" 브로드캐스트+로컬필터링 버그를 못 잡는다.
  **아직 이 테스트를 안 해봄** — 단일 클러스터 환경(자동화 테스트/수동 스모크테스트)에서만 검증됨.
- Discord + 로컬 웹(`http://localhost:4321`) 실사용 테스트 — Phase 1 핵심 흐름(잠금→선택→확정→
  `DevQuizInfoUI` 전환→확정 후 재선택)은 2026-08-08 사용자 검증 완료(`docs/TEST_CHECKLIST.md` O 섹션).
  **투트랙 진입점 분리(`SelectUIModeUI`) + Phase 2(유저 퀴즈)는 아직 미검증** — 다음 세션 최우선:
  `/퀴즈` → "디스코드 UI/웹 UI" 선택 화면 표시 확인 → "웹 UI" 클릭 → `MainUI`/`SelectQuizTypeUI`를
  거치지 않고 곧장 잠금 화면이 뜨는지 → 브라우저에서 "유저 퀴즈" 탭 클릭 → 검색/태그 필터(AND)/인증
  토글/정렬 동작 확인 → 카드 선택 → 채널 임베드가 실시간으로 갱신되는지 → 문제 수 스테퍼 최대치가
  그 퀴즈의 실제 문제 수로 제한되는지 → "선택 완료" → 채널이 `UserQuizInfoUI`로 정상 전환되는지 →
  확정한 채로 다른 유저 퀴즈로 재선택 → 채널이 새 퀴즈 정보로 갱신되는지 → "공식 퀴즈" 탭으로 바꿔서
  dev 모드도 같은 세션에서 계속 동작하는지(mode가 요청별로 분기되므로 탭을 오가도 깨지지 않아야 함) →
  `WEB_SESSION_EXPIRE_SEC`을 임시로 짧게 설정해 GC로 잠금 해제(`goToBack()`으로 `SelectUIModeUI`
  복귀, **진입점 변경으로 복귀 대상이 `SelectQuizTypeUI`에서 바뀜**)되는지 확인 → 다크모드 토글 확인.
  **Phase 3(랜덤 퀴즈)도 아직 미검증**: "랜덤 퀴즈" 탭 클릭 → 공식 장르 칩 다중선택 시 채널 임베드
  실시간 갱신 → "장르로 뽑기"/"직접 담기" 모드 전환 → 직접 담기 모드에서 카드 클릭으로 퀴즈함 담기/
  빼기 → 🍱 FAB 클릭 시 드로워에 담긴 목록 표시/제거 동작 → 설정 요약 카드의 문제 수 스테퍼(최대
  100) → "이 설정으로 선택 완료" → 채널이 `OmakaseQuizRoomUI`로 정상 전환되는지 → 확정한 채로 설정을
  바꿔서 재선택 → 채널이 즉시 갱신되는지 → 아무것도 선택 안 한 상태에선 확정 버튼이 비활성화되는지.
