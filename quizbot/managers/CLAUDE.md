# quizbot/managers/

비즈니스 로직 서비스 계층. 대부분 상태를 가진 싱글턴 모듈이고, `exports.initialize(...)`가 있으면 `quizbot/bot.js`의 시작 시퀀스에서 호출됨(루트 `CLAUDE.md`의 "매니저 패턴" 참고). 두 하위 디렉터리(`db/`, `report/`)는 각각 자체 `CLAUDE.md`가 있음.

## 오디오/캐시

- **`audio_cache_manager.js`** — 노래 맞추기 퀴즈용 yt-dlp 다운로드 + 캐시 파이프라인. 캐시는 `video_id` 첫 글자로 해싱된 하위 폴더(`getHashedPath`)에 저장, 성공하면 webm으로 변환(`convertToWebm`). 함수들이 서로 강하게 얽혀있는 단일 파이프라인이라 **구조 분리를 의도적으로 하지 않음**(`docs/REFACTOR_PLAN.md` Phase 5 결정). 순수 함수 4개(`getHashedPath`/`getDownloadResultType`/`getExpectedErrorType`/`executeDownloadProcess`)는 유닛테스트를 위해 추가로 export됨. `forceCaching`은 대량 사전 캐싱용 CLI성 함수. **주의**: `docs/BUGS_FOUND.md`에 이 파일 관련 미수정 버그 2건 기록됨 (convertToWebm의 unlink 에러 로그 조건이 반대로 보임, reWriteCacheInfo의 fs.writeFileSync에 죽은 콜백 인자) — 둘 다 저위험 판단으로 보류 중. `generatePreviewClipStream(cache_file_path, audio_start_point, audio_length_sec)`(B-2, 2026-08-07 신설) — 캐시 파일에서 구간을 `-c copy`(재인코딩 없음)로 잘라 `PassThrough` 스트림으로 반환, 문제 미리듣기용(`user-question-info-ui.js`의 `sendAudioPreview`가 호출).

## 밴 관리

- **`ban_manager.js`** — `resources/banned_user.txt`를 메모리 `Set`으로 캐싱(10분 주기 재조회, `unref()`된 타이머). `isBanned(id_list)`, `banId(id)`, `unbanId(id)`, `getBannedIdList()`. **길드ID(멀티플레이 밴)와 유저ID(퀴즈 생성 영구밴)를 같은 목록으로 관리** — 의도된 설계(둘 다 "이 ID는 문제 있음"이라는 같은 의미). `banId`/`unbanId`는 파일에 쓰는 동시에 캐시도 즉시 갱신해 다음 재조회 주기를 기다리지 않음. 원래 이름은 `multiplayer_ban_manager.js`였는데 유저ID 밴도 겸하게 되면서 일반화된 이름으로 리네임됨.

## 명령어/설정

- **`command_manager.js`** — `SlashCommandBuilder` 배열 + `registerCommands`(길드별)/`registerGlobalCommands`. 새 슬래시커맨드 추가 시 여기 등록.

## 신고/피드백

- **`feedback_manager.js`** — 퀴즈 👍 추천. `addQuizLike`/`addQuizLikeAuto`/`checkAlreadyLike`. 추천 수가 `SYSTEM_CONFIG.CERTIFY_LIKE_CRITERIA`를 넘으면 자동으로 `db_manager.certifyQuiz` 호출(인증 마크). 예전에 있던 `@Deprecated` 죽은 코드(`createDynamicQuizFeedbackComponent`/`do_event`)는 삭제됨(`docs/DEPRECATED_CODE_REMOVED.md` 참고).
- **`report_manager.js`** — 신고 처리 전체의 얇은 facade. 상세: `report/CLAUDE.md`.

## 멀티플레이 (서버 간 대결)

여러 길드가 서로 대결하는 "멀티플레이" 기능 전체. **`quizbot/quiz_system/session/multiplayer_session.js`(같은 길드 내부의 State 패턴 퀴즈 세션)와 이름이 겹치지만 완전히 다른 코드**이니 헷갈리지 말 것.

- **`multiplayer_manager.js`** — 얇은 facade. `initialize(manager)` / `onSignalReceived(signal)`만 노출, 아래 파일들에 위임.
- **`multiplayer_session_registry.js`** — `multiplayer_sessions` 레지스트리 객체 + `cluster_manager`(discord-hybrid-sharding 참조) + `broadcast(signal)` + `sendMultiplayerLobbyCount()`.
- **`multiplayer_mmr.js`** — MMR 계산 순수 함수(`calcWinnerMMR`/`calcLoserMMR`), 부수효과 없어 테스트하기 쉬움.
- **`multiplayer_guild_info.js`** — `MultiplayerGuildInfo` 클래스, 대결에 참가한 개별 길드의 상태(참가자, 점수, 동기화 여부 등).
- **`multiplayer_session.js`** — `MultiplayerSession` 클래스(~1000줄) + `SESSION_STATE` enum. 대결 세션의 생명주기 전체(로비 생성 → 시작 → 진행 → 종료/정리). `changeHost()`에 방장 교체 시 레지스트리 재등록 누락 버그가 있었는데 수정됨(`docs/BUGS_FOUND.md` Phase 3).
- **`multiplayer_signal.js`** — `CLIENT_SIGNAL`(0x00~0x12)/`SERVER_SIGNAL`(0x80~0x94, 최상위 비트 set) enum. IPC 메시지 방향 구분용.
- **`multiplayer_signal_handlers.js`** — `onSignalReceived` 디스패치 + `CLIENT_SIGNAL`별 `handle*` 함수 18개. **주의**: `isClientSignal(signal)`이 `signal.signal_type`이 아니라 `signal` 객체 전체를 넘겨받아 비트 검증이 사실상 무력화된 버그가 있음(`docs/BUGS_FOUND.md` Phase 3) — IPC 신호 검증 영역이라 검증 없이 고치지 않고 기록만 해둔 상태.
- **`multiplayer_chat_manager.js`** — 멀티플레이 중 전체 채팅(`/챗`, `/채팅전환`).

## 기타

- **`ipc_manager.js`** — 클러스터 간 상태 동기화. `sync_objects`(Map, `guild_count`/`local_play_count`/`multi_play_count` 등 공유 값), `adaptRelayHandler`.
- **`monitoring_manager.js`** — CPU/메모리 주기 로깅(CSV 파일). `calculateAverageCpuUsage`는 순수 함수로 추출돼 테스트됨.
- **`tagged_dev_quiz_manager.js`** — 공식(개발자 제작) 태그별 퀴즈 데이터를 시작 시 메모리에 로드.
- **`user_quiz_info_manager.js`** — 유저 제작 퀴즈 CRUD. `UserQuizInfo`/`UserQuestionInfo` 클래스, `loadUserQuizListFromDB`/`loadQuestionListFromDBByTags`. `@Deprecated`였던 `UserQuizInfo.addLike`는 삭제됨(`DEPRECATED_CODE_REMOVED.md`).
