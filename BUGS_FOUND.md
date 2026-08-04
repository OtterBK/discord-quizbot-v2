# 발견된 버그 로그

> 구조 개편(REFACTOR_PLAN.md) 진행 중 발견한 버그를 기록한다.
> 사소하고 국소적인 버그는 발견한 Phase 내에서 바로 수정(별도 `fix:` 커밋)하고, 파급 범위가 크거나 불확실한 버그는 상태를 `보류`로 두고 우선순위를 논의한다.
> 규칙: REFACTOR_PLAN.md 2.3절.

## 기록 양식

```
### [Phase 번호] 짧은 제목

- 파일/위치: `path/to/file.js:123`
- 발견일: YYYY-MM-DD
- 재현 조건: ...
- 실제 동작: ...
- 기대 동작: ...
- 상태: 미수정 | 수정 완료 (커밋 <hash>) | 보류 (사유)
- 비고: (선택)
```

---

## 목록

### [Phase 1] `getQuestionListByTags`의 반환 타입 불일치 (limit <= 0)

- 파일/위치: `quizbot/managers/tagged_dev_quiz_manager.js:65-97` (수정 전 기준)
- 발견일: 2026-08-03
- 재현 조건: `getQuestionListByTags(tags_value, limit)`을 `limit <= 0`("무제한"을 뜻하는 값, 파라미터 기본값도 0)으로 호출.
- 실제 동작: 다른 모든 경로(`tags_value == 0`일 때, `limit > 0`일 때)는 `[total_question_count, question_list]` 형태의 2-tuple을 반환하는데, `limit <= 0`일 때만 `question_list` 배열 하나만 반환함. 호출부(`quiz_system.js:2882, 2893`)는 항상 `[count, list] = getQuestionListByTags(...)` 형태로 구조분해하므로, 만약 `limit`이 0으로 넘어오면 `count`에 질문 객체 0번째가, `list`에 질문 객체 1번째가 잘못 할당됨.
- 기대 동작: `limit` 값과 무관하게 항상 `[total_question_count, question_list]` 형태로 반환.
- 상태: 수정 완료 (커밋 `6acf6d6`) — 항상 `[total_question_count, list]` 튜플을 반환하도록 통일.
- 비고: 실제 호출부에서는 `limit = selected_question_count * 2`로 항상 양수 값을 넘기고 있어 지금까지 실제로 트리거된 적은 없는 잠재 버그(latent bug)였음.

### [Phase 1] `feedback_manager.do_event` → `addQuizLikeAuto` 인자 불일치 (죽은 코드)

- 파일/위치: `quizbot/managers/feedback_manager.js:41-46, 127-150`
- 발견일: 2026-08-03
- 재현 조건: `@Deprecated` 표시된 `createDynamicQuizFeedbackComponent`/`do_event` 경로가 실제로 호출되는 경우 (grep 결과 코드베이스 어디서도 호출되지 않음 — 죽은 코드).
- 실제 동작: `do_event`가 `exports.addQuizLikeAuto(guild_id, interaction.member, target_quiz.quiz_id, target_quiz.quiz_title)`로 호출하는데, `addQuizLikeAuto`의 시그니처는 `(interaction, quiz_id, quiz_title)`. 즉 첫 인자로 `interaction` 객체가 아닌 `guild_id`(문자열)가 들어가 함수 내부 `interaction.guild.id` 접근에서 `TypeError`가 발생함.
- 기대 동작: 호출 시그니처가 일치해야 함.
- 상태: 보류 — 두 함수 모두 `@Deprecated` 표시된 죽은 코드(어디서도 호출 안 됨)라 런타임 영향 없음. 삭제할지, 시그니처만 맞춰둘지는 별도 논의 필요.

### [Phase 1] `UserQuizInfo.addLike`에서 `user_id` 인자 누락 (죽은 코드)

- 파일/위치: `quizbot/managers/user_quiz_info_manager.js:172-176`
- 발견일: 2026-08-03
- 재현 조건: `@Deprecated` 표시된 `UserQuizInfo.addLike(guild_id, user_id)`가 실제로 호출되는 경우 (grep 결과 어디서도 호출되지 않음 — 죽은 코드).
- 실제 동작: `feedback_manager.addQuizLike(this.quiz_id, guild_id)`로 2개 인자만 전달하지만 `addQuizLike`의 시그니처는 `(quiz_id, guild_id, user_id)`. `user_id`가 `undefined`로 들어가 `addQuizLike` 내부 가드(`user_id == undefined`)에 걸려 항상 `false`를 반환하게 됨.
- 기대 동작: `user_id`까지 전달되어야 함.
- 상태: 보류 — `@Deprecated` 표시된 죽은 코드라 런타임 영향 없음. 삭제할지, 시그니처만 맞춰둘지는 별도 논의 필요.

### [Phase 3] `MultiplayerSession.changeHost`가 세션을 새 host_id로 재등록하지 않음 (진행 중인 게임에 영향)

- 파일/위치: `quizbot/managers/multiplayer_manager.js:1039-1055` (수정 전 기준)
- 발견일: 2026-08-04
- 재현 조건: 진행 중인 멀티플레이 게임에서 방장(host) 서버가 중도 퇴장하고 다른 참가자가 1명 이상 남아있는 경우. `processLeaveGame()`(1183-1229)이 `this.session_owner_guild_id === guild_id`(나간 사람이 방장)이고 남은 참가자가 있으면 `changeHost(new_host_guild_info)`를 호출함.
- 실제 동작: `changeHost()`가 `delete multiplayer_sessions[previous_session_id]`로 예전 host_id 키는 지우지만, 새 host_id로 다시 등록하는 코드가 `multiplayer_sessions[this.getSessionId()];`처럼 값만 읽고 버리는 표현식으로 끝나 있어(대입 없음) 세션이 레지스트리 어디에도 남지 않게 됨. 이후 해당 세션에 대한 모든 `CLIENT_SIGNAL`(힌트/스킵/정답 제출/동기화/채팅 등)이 `multiplayer_sessions[session_id]`로 조회하다 실패해 게임이 조용히 먹통이 됨.
- 기대 동작: `multiplayer_sessions[this.getSessionId()] = this;`로 새 host_id 아래 다시 등록되어야 함.
- 상태: 수정 완료 — `= this;` 대입 추가.
- 비고: 리팩토링과 무관하게 기존 코드에 있던 버그. 라이브 서버 영향 범위가 궁금하면, 서버 로그에서 "The host changed to" 이후 해당 세션 관련 신호 처리가 끊기는 패턴이 있었는지 확인해볼 만함.

### [Phase 3] `syncFailedDetected`가 `MultiplayerGuildInfo`를 `.toJsonObject()` 없이 그대로 전송

- 파일/위치: `quizbot/managers/multiplayer_manager.js:1130-1150`
- 발견일: 2026-08-04
- 재현 조건: 멀티플레이 동기화 실패가 감지되는 경우 (`syncFailedDetected` 호출).
- 실제 동작: 다른 모든 서버 신호(`LEAVED_GAME`, `JOINED_LOBBY`, `KICKED_PARTICIPANT` 등)는 `guild_info.toJsonObject()`로 필요한 필드만 뽑아 보내는데, `SYNC_FAILED_DETECTED`만 `MultiplayerGuildInfo` 인스턴스를 그대로 payload에 넣음(114-117번째 줄 주석에 "통신은 무조건 json으로 하도록 하자"는 원칙이 명시돼 있는데 이 지점만 예외). 실제 수신 측(`quiz_system/session/multiplayer_session.js`의 `onReceivedSyncFailedDetected`)은 `.guild_name`/`.guild_id`만 읽어서 지금 당장 오류로 이어지진 않지만, `syncing`/`hint`/`skip` 같은 불필요한 내부 필드까지 IPC로 새어나가고 있음.
- 기대 동작: 다른 신호들과 통일해서 `failed_guild_info.toJsonObject()`를 보내야 함.
- 상태: 보류 — 지금 당장 기능 문제는 없어 보이지만(수신측이 plain 필드만 사용), payload 필드를 줄이는 변경이라 혹시 다른 소비자가 생기기 전에 논의 후 처리.

### [Phase 3] `onSignalReceived`의 `isClientSignal` 검증이 항상 통과함 (죽은 방어 로직)

- 파일/위치: `quizbot/managers/multiplayer_manager.js:51-86`
- 발견일: 2026-08-04
- 재현 조건: 항상 (모든 `onSignalReceived` 호출).
- 실제 동작: `isClientSignal(signal)`을 호출할 때 `signal.signal_type`이 아니라 `signal` 객체 전체를 넘김. `isClientSignal`은 내부에서 `signal & 0x80`을 계산하는데, 객체에 비트 연산을 하면 `NaN`으로 강제 변환되고 `NaN & 0x80`은 `0`이 되어 `(0) === 0`이 항상 `true`. 즉 "서버 시그널이 잘못 들어왔는지" 검증하는 가드(53번째 줄)가 절대 `false`가 될 수 없어 사실상 죽은 방어 코드임. 짝을 이루는 `isServerSignal`(78-81)도 코드베이스 어디서도 호출되지 않는 죽은 함수.
- 기대 동작: `isClientSignal(signal.signal_type)`처럼 실제 숫자 값을 넘겨야 비트 검증이 의미가 있음.
- 상태: 보류 — 실제로 이 경로에 `SERVER_SIGNAL` 값이 잘못 들어온 사례가 없어 보여 지금까지 관측 가능한 장애는 없었던 것으로 보임. 다만 IPC 신호 검증이라는, REFACTOR_PLAN.md가 특히 조심하라고 명시한 영역이라 동작을 바꾸는 수정은 검증 없이 하지 않고 기록만 남김 (지금 고치면 "지금까지 통과되던 무언가"가 갑자기 거부될 수 있어 실제 운영 신호 트래픽으로 먼저 확인 필요).

### [Phase 5] `insertChatCache`가 이미 캐시된 chat_id에 대해 `cached_time`을 갱신하지 못함

- 파일/위치: `quizbot/managers/report_manager.js:66-84` (분리 전 기준, 현재는 `quizbot/managers/report/chat_cache.js`)
- 발견일: 2026-08-04
- 재현 조건: 같은 채팅 메시지에 대해 신고 버튼(`chat_report_...`)을 5분 캐시 만료 전에 다시 누르는 경우. `requestReportChatModal`이 `insertChatCache(chat_id, content)`를 다시 호출함.
- 실제 동작: `insertChatCache`가 재호출되면 `getChatCacheContent(chat_id)`의 반환값(캐시 객체가 아니라 `.content` 문자열)을 `prev_cache`로 받아 `prev_cache.cached_time = Date.now();`를 실행한다. `prev_cache`가 문자열이라 이 대입은 아무 효과가 없다(비-strict 모드라 조용히 무시됨 — 원본 파일에 `'use strict'`가 없어서 지금까지 에러 없이 조용히 실패해왔음). 결과적으로 재신고 시 캐시의 `cached_time`이 실제로는 갱신되지 않아, `cleanUpChatCache`가 5분마다 예전 `cached_time` 기준으로 캐시를 지워버릴 수 있다 — 사용자가 방금 다시 신고 버튼을 눌렀는데도 곧이어 만료되어 모달 제출 시 "No Cache Content" 실패로 이어질 수 있음.
- 기대 동작: 같은 chat_id로 재호출 시 `chat_content_cache[chat_id]`(캐시 객체)의 `cached_time`이 갱신되어야 함.
- 상태: 수정 완료 — `chat_cache.js`에서 `getChatCacheContent(chat_id)` 대신 `chat_content_cache[chat_id]`(캐시 객체 자체)를 참조하도록 수정.
- 비고: Phase 5에서 `quizbot/managers/report/*.js`를 분리하며 새 파일에 `'use strict'`를 붙였다가, 이 버그가 조용한 무시(sloppy mode) 대신 `TypeError`로 바뀌어 표면화되는 것을 테스트로 발견했다. 분리 파일에서는 원본과 동일하게 `'use strict'`를 다시 제거해 "구조 이동만" 원칙을 지켰고(별도 `refactor:` 커밋), 이 버그 자체는 국소적이고 명확해 이번 Phase 내에서 바로 수정했다.

### [Phase 5] `executeDownloadProcess`가 yt-dlp stdout/stderr를 수집할 때 스트림 객체로 초기화를 덮어씀

- 파일/위치: `quizbot/managers/audio_cache_manager.js:341-355`
- 발견일: 2026-08-04
- 재현 조건: 항상 (모든 `downloadAudioCache` 호출 시 내부적으로 실행됨).
- 실제 동작: `stdout = subprocess.stdout.on('data', (data) => { stdout += data.toString(); })`처럼 작성돼 있는데, `EventEmitter.on(...)`은 리스너 등록 후 스트림 자기 자신(`this`)을 반환한다. 즉 `stdout`(문자열로 초기화됐던 변수)이 이 대입문 실행 즉시 `subprocess.stdout` 스트림 **객체**로 덮어써진다. 이후 첫 `'data'` 이벤트가 발생해 콜백이 `stdout += data.toString()`을 실행하면, `+=`가 스트림 객체를 문자열로 강제 변환(`[object Object]` 등)한 뒤 첫 데이터 청크와 이어붙인 값을 다시 `stdout`에 대입한다 — 이때부터는 `stdout`이 진짜 문자열이 되어 이후 청크들은 정상적으로 누적되지만, 최종 결과 문자열 맨 앞(혹은 첫 청크가 걸린 위치)에 `[object Object]` 같은 쓰레기 문자열이 섞여 들어간다. `stderr`도 동일한 패턴.
- 기대 동작: `stdout`/`stderr`는 순수 문자열 누적이어야 하며, `.on('data', ...)`의 반환값을 변수에 대입하면 안 됨 (예: `subprocess.stdout.on('data', (data) => { stdout += data.toString(); });`처럼 반환값을 버려야 함).
- 상태: 보류 — `getDownloadResultType`/`getExpectedErrorType`가 줄 단위(`split('\n')`)로 `[download]`/`ERROR:` 접두 문자열을 검사하는데, 쓰레기 문자열이 첫 청크의 시작 부분에 섞여 들어가면 마침 그 청크에 판정 대상 줄(예: 성공 판정용 `Destination:` 줄)이 걸려 있을 경우 `line.startsWith('[download]')` 매칭이 실패해 성공/실패 오판정으로 이어질 수 있다. 실제 청크 경계는 네트워크/버퍼링에 따라 달라 재현이 불안정하고, 오디오 다운로드라는 핵심 경로라 실제 yt-dlp 실행 검증 없이 고치는 위험을 피하기 위해 기록만 남김.

### [Phase 5] `convertToWebm`의 원본 파일 삭제 실패 로그가 `ENOENT`일 때만 남음 (조건 반대로 보임)

- 파일/위치: `quizbot/managers/audio_cache_manager.js:526-532`
- 발견일: 2026-08-04
- 재현 조건: 변환 후 원본(webm이 아닌) 캐시 파일을 `fs.unlink`로 지우는 과정에서 `ENOENT`가 아닌 다른 에러(권한 문제, 파일 잠김 등)가 발생하는 경우.
- 실제 동작: `fs.unlink(cache_file_path, err => { if(err != null && err.code == 'ENOENT') { console.log(\`Failed to unlink...\`); } })` — `err.code == 'ENOENT'`(파일이 이미 없음, 사실상 가장 무해한 케이스)일 때만 로그를 남기고, 그 외의 실제로 문제가 될 수 있는 에러(권한 오류 등)는 조용히 무시된다.
- 기대 동작: 조건이 반대로 보임 — `if(err != null)`처럼 `ENOENT`를 포함해 모든 에러를 로그하거나, 반대로 `ENOENT`만 무시하고 나머지는 로그하는(`if(err != null && err.code != 'ENOENT')`) 형태가 자연스러워 보임.
- 상태: 보류 — 캐시 정리 실패는 디스크 공간이 서서히 낭비되는 정도의 낮은 파급력이라 우선순위가 낮고, 의도를 단정하기 어려워(원래 의도가 정말 "ENOENT일 때만 알림"이었을 가능성도 배제 못함) 기록만 남김.

### [Phase 5] `reWriteCacheInfo`의 `fs.writeFileSync` 4번째 인자(콜백)가 항상 무시됨 (죽은 코드)

- 파일/위치: `quizbot/managers/audio_cache_manager.js:143-149`
- 발견일: 2026-08-04
- 재현 조건: 항상 (모든 `reWriteCacheInfo` 호출).
- 실제 동작: `fs.writeFileSync(info_file_path, JSON.stringify(cache_info), 'utf-8', (err) => {...})`처럼 4번째 인자로 에러 콜백을 넘기고 있는데, `fs.writeFileSync`는 동기 함수라 콜백을 받지 않는다(3번째 인자까지만 유효: `path, data, options`). 4번째 인자는 조용히 무시되며, 쓰기 중 에러가 나면 이 콜백이 아니라 예외가 그 자리에서 던져진다.
- 기대 동작: 콜백은 어차피 호출되지 않으므로 삭제하거나, 진짜 비동기 에러 핸들링이 필요하면 `fs.writeFile`로 바꿔야 함.
- 상태: 보류 — 이미 `reWriteCacheInfo` 전체가 `try/catch`로 감싸져 있어 `writeFileSync`가 던지는 예외는 정상적으로 `catch(err) { logger.error(...) }`로 처리되고 있음. 즉 에러 핸들링 자체는 (다른 경로로) 이미 되고 있어 기능적 영향은 없고, 죽은 콜백 인자만 정리하면 되는 사소한 코드 정리 건이라 이번 Phase 범위(구조 분리) 밖으로 보고 기록만 남김.
