# quizbot/quiz_system/

퀴즈 진행 엔진 전체 — State 패턴. 원본은 5,959줄짜리 `quiz_system.js` 하나였고, 클래스 경계를 그대로 파일 경계로 승격시켜 분리됨(`docs/plans/REFACTOR_PLAN.md` Phase 2). 모든 분리 파일 헤더에 "로직/주석은 원본과 동일(동작 변경 없음)"이라고 적혀있음 — 즉 **여기서 발견되는 이상한 동작은 대부분 분리 전부터 있던 원본 버그**지 분리 중 생긴 게 아님.

## 전체 흐름

1. **생성**: `quiz_system.js`의 `startQuiz(guild, owner, channel, quiz_info, quiz_session_type)`가 `session_registry.replaceSession(guild_id, ...)`으로 세션 등록(기존 세션 있으면 자동으로 `free()`).
2. **사이클 그래프 구성**: `QuizSession.createCycle()`(`session/quiz_session.js`)이 `quiz_maker_type`으로 `Initialize*`, `quiz_type`으로 `Question*`를 골라 `lifecycle_map`(`CYCLE_TYPE` → 인스턴스)을 만듦. 새 퀴즈 타입 추가 시 **이 switch문을 반드시 갱신**해야 함.
3. **구동**: `cycleLoop()` → `goToCycle(INITIALIZING)`. 각 lifecycle 클래스는 `QuizLifeCycle`(`lifecycle/quiz_lifecycle.js`)이 정의한 고정 파이프라인 `_enter()→_act()→_exit()`를 거침. `_exit()`가 `this.next_cycle`을 읽어 `goToCycle`로 다음 상태 이동.
4. **싱글플레이 표준 경로**: `INITIALIZING → EXPLAIN → PREPARE(비동기 선반입, 안 막음) → QUESTIONING → (CORRECTANSWER|TIMEOVER) → CLEARING → (다음 문제로 루프, 또는 ENDING) → ENDING → FINISH`.
5. **멀티플레이 분기**: `Explain.exit()`/`Clearing.exit()`가 `next_cycle = HOLD`로 바꾸고 `waitForSyncDone()` 호출 — 중앙 서버(IPC)의 `SYNC_DONE` 신호를 기다렸다가 `onReceivedSyncDone`(`session/multiplayer_session.js`)이 명시적으로 `goToCycle(QUESTIONING)` 호출해 재개. 문제 리스트 생성은 **호스트만** 하고(`isHostSession()`) IPC로 나머지 길드에 방송함.
6. **종료**: force-stop이든 정상 종료든 결국 `FINISH`로 감. `Finish`는 `ignore_block = true`("FINISH Cycle은 막을 수가 없다") — 항상 전체 teardown 실행. `Finish.exit()`가 `quiz_session.free()` 호출(오디오 스트림/음성 연결 해제, `session_registry.quiz_session_map`에서 제거).

## 멀티플레이 ↔ 싱글플레이 관계 (중요)

상속이 아니라 **Mixin**: `MultiplayerSessionMixin(Base)`을 서로 다른 두 베이스에 적용함 — 로비 단계는 `MultiplayerSessionMixin(DummyQuizSession)` = `MultiplayerLobbySession`, 실제 게임 단계는 `MultiplayerSessionMixin(QuizSession)` = `MultiplayerQuizSession`. 둘은 부모-자식이 아니라 형제 관계고, 로비가 `session_registry.replaceSession`으로 직접 게임 세션으로 교체함(`transitToActiveQuizSession`). **이름 충돌 주의**: `quizbot/managers/multiplayer_session.js`(cross-서버 대결의 `MultiplayerSession` 클래스)와는 완전히 다른 코드.

## 파일별 핵심 요약 + 위험 포인트

**공유 상태/facade**
- **`quiz_system.js`** — 얇은 facade. `startQuiz`/`getQuizSession`/`forceStopSession`/`relayMultiplayerSignal` 등만 노출. `ffmpegAgingManager()`가 여기 있는데 `ffmpeg_aging_map`을 채우는 코드가 이 파일에 없음(`docs/archive/PERFORMANCE_NOTES.md`에 죽은 코드로 기록됨, 게다가 `bot.js`에서 시작 호출 자체가 주석처리돼 있어 실행도 안 됨).
- **`constants.js`** — `CYCLE_TYPE`/`QUIZ_SESSION_TYPE`/`MULTIPLAYER_COMMON_OPTION`. `CYCLE_TYPE.FORCEFINISH`는 정의만 되고 어디서도 안 쓰이는 죽은 값으로 보임.
- **`session_registry.js`** — `quiz_session_map`(guild_id → 세션, 일반 객체) + `bot_client`. 순환참조 방지를 위해 일부러 분리됨 — lifecycle 클래스들이 `quiz_system.js` facade를 거치지 않고 여길 직접 참조하는 경우 있음(`quiz_play_ui.js` 등).
- **`quiz_play_ui.js`** — 현재 진행 중인 문제의 embed+버튼 메시지 래퍼(`QuizPlayUI`). 로컬 dev 퀴즈 이미지는 `attachment://`로 첨부, 나머지는 URL 직접. `update()`가 파일 첨부 있으면 `send(true)`로 재라우팅(Discord edit API가 새 파일첨부를 못 함).

**session/**
- **`quiz_session.js`** — `QuizSession`(베이스, 상태머신 구동: `createCycle`/`goToCycle`/`cycleLoop`), `NormalQuizSession`(생성자에서 바로 시작), `DummyQuizSession`(HOLD+FINISH만 있는 최소 사이클, 로비용). `sendMultiplayerSignal()`이 순환참조 방지 위해 함수 본문 안에서 `require('.../ipc_manager.js')` — 이 지연 require를 모듈 상단으로 옮기면 로드 순서 깨질 수 있음.
- **`multiplayer_session.js`** — Mixin + `MULTIPLAYER_STATE` enum + `MultiplayerLobbySession`/`MultiplayerQuizSession`. **가장 위험도 높은 파일**: `waitForSyncDone()`이 10ms 간격 폴링(주석: "공정한 게임을 위해 제일 중요한 구간임") — 성능상 늘리고 싶어도 함부로 건드리지 말 것. `onReceivedApplyNextQuestion`에서 `cloneDeep(signal.prepared_question)`을 안 하면 "Resource is already being played" 프로덕션 버그가 남(주석에 `!!!`로 강조돼 있음). `goToCycle`과 `asyncCallCycle`을 혼용하면 `current_cycle_type`이 안 바뀌는 버그가 남 — 둘은 절대 바꿔 쓰면 안 됨.

**lifecycle/**
- **`quiz_lifecycle.js`** — 상태머신 엔진 자체. `forceStop(do_exit=true)`에 `this.next_cycle == CYCLE_TYPE.UNDEFINED`(대입이 아니라 비교, 사실상 no-op으로 보이는 잠재 버그 — 원본부터 있던 것, 실제 영향은 이후 무조건 `goToCycle(FINISH)`를 호출해서 제한적). 힘/좋아요 버튼 처리가 베이스 클래스 `on()`에 하드코딩돼 있어 모든 사이클에서 동일하게 동작함.
- **`initialize.js`** — `Initialize`(공통 setup) + 4개 하위 클래스(`DevQuiz`/`CustomQuiz`/`OmakaseQuiz`/`UnknownQuiz`). `generateHint`의 `base_answer.indexOf(rd_index) === ' '` 줄은 `rd_index`가 숫자라 사실상 항상 false로 보이는 의심스러운 로직(주석에 "그냥 해도 될 것 같다"고 저자 스스로 적어둠) — 손대기 전 `docs/archive/BUGS_FOUND.md`에 기록할지 검토. dev 퀴즈는 **파일명 자체가 데이터**(`&^`로 저자 구분, `&#`로 복수 정답 구분) — 이 인코딩 바꾸면 기존 dev 퀴즈 파일 다 깨짐. **`OmakaseQuizInitialize`의 장바구니 모드(2026-08-12, 웹 API 보안 점검 심화 조사)**: `quiz_info['basket_items']`의 각 항목 `quiz_id`를 실제 SQL에 쓰기 직전 `parseInt`+`Number.isInteger`로 필터링(`basket_quiz_ids`) — 예전엔 이 값을 그대로 문자열로 이어붙여 `db_quiz.ts`의 `selectRandomQuestionListByBasket`이 `WHERE quiz_id IN ${...}`에 직접 삽입하는 **실제 SQL 인젝션 지점**이었음. 디스코드 전용이던 시절엔 `basket_items`가 항상 DB에서 읽은 실제 정수로만 채워져 무해했지만, 퀴즈 선택 웹 연동(`POST /api/session/confirm`, mode:omakase/multiplayer)이 `basket_items`를 서버 검증 없이 그대로 받게 되면서(`web_express_app.ts`) UI를 거치지 않고 직접 API를 호출하면 임의 문자열이 여기까지 도달할 수 있는 경로가 새로 생겼던 것 — `selectRandomQuestionListByBasket` 자체도 `= ANY($1::int[])` 파라미터화로 교체해 호출부 실수에 대한 방어까지 이중으로 해둠. **`shuffleArray`(2026-08-12, 랜덤 추첨 쏠림 조사 중 발견)**: `InitializeDevQuiz`/`InitializeCustomQuiz`/`OmakaseQuizInitialize` 3곳 모두 원래 `question_list.sort(() => Math.random() - 0.5)`로 최종 문제 순서를 섞었는데, 이건 균등분포가 안 나오는 것으로 잘 알려진 깨진 셔플 패턴(정렬 알고리즘 구현에 따라 원래 순서에 편향됨) — 같은 코드베이스의 `tagged_dev_quiz_manager.ts`(`getQuestionListByTags`)가 이미 쓰던 Fisher-Yates와 동일한 패턴의 로컬 헬퍼 `shuffleArray`로 3곳 다 교체. "특정 퀴즈/문제 쏠림" 사용자 피드백 조사 중 발견된 별개 버그(쏠림의 근본 원인은 `db_quiz.ts`의 `ORDER BY RANDOM()`이 퀴즈 단위가 아니라 문제 단위로 균등한 것으로 추정 — 이건 아직 미해결, `docs/ACTIVE_PLAN.md` B-2 참고).
- **`prepare.js`** — 가장 복잡한 파일. YouTube/커스텀 오디오 파이프라인이 여기서 `audio_cache_manager`를 호출함(모킹 경계). `Prepare.fillAudioResource` 등 정적 메서드는 멀티플레이 non-host가 IPC로 받은 메타데이터로 로컬 오디오 리소스를 재구성할 때 씀 — `multiplayer_session.js`가 이 정적 메서드에 의존. non-webm 파일은 seek(byte offset)이 "이거 안 먹는다"는 주석과 함께 사실상 안 됨; webm은 `utility/SeekStream/SeekStream.js` 사용.
- **`explain.js`/`time_over.js`/`correct_answer.js`/`clearing.js`/`ending.js`/`finish.js`/`hold.js`** — 상대적으로 단순한 말단 사이클들. `clearing.js`에 `question_list`가 비었는데 더 낼 문제가 있다고 판단되는 경우를 막는 방어 코드가 있음(퀴즈 강제 종료). `ending.js`는 멀티플레이 MVP 정보가 `CONFIRM_MVP` 신호로 안 오면 조용히 스킵. `finish.js`는 `ignore_block = true`(막을 수 없는 유일한 사이클).

**lifecycle/question/**
- **`question.js`** — 베이스 `Question`(937줄). 힌트/스킵 투표, 타임오버 타이머, 채점(`calculateScore`, 시간 기반 최대 10배 보너스), `/답` 슬래시커맨드+채팅+버튼 입력 전부 여기서 처리. **입력 캡처는 베이스, 채점 확정은 서브클래스**라는 분리가 비직관적(예: `question_ox.js`가 `selected_choice_map`을 직접 순회해서 채점). 새 문제 타입 만들 때 이 패턴을 놓치기 쉬움.
- **`question_song.js`/`question_image.js`/`question_intro.js`/`question_text.js`/`question_ox.js`** — 각 문제 타입의 `act()`만 오버라이드. `question_image.js`는 `await quiz_ui.update()`를 안 하면 이미지가 두 번 올라가는 버그가 있어 await 필수(주석 있음).
- **`question_custom.js`/`question_omakase.js`** — 유저/오마카세 퀴즈 재생, 서로 85% 코드 중복. `question_custom.js` 헤더에 "리팩터링 안할거면 걍 유지보수 포기하자"는 저자 comment 있음(가장 손대기 꺼려하는 파일로 스스로 표시). 오디오 에러 시 동작이 다름 — Custom은 FAILOVER BGM으로 대체, Omakase는 그 문제를 통째로 스킵(`question_num` 되돌림) — 이 차이는 의도된 설계라 통합 리팩터링 시 반드시 보존해야 함.
- **`question_unknown.js`** — 에러 폴백(알 수 없는 quiz_type).
