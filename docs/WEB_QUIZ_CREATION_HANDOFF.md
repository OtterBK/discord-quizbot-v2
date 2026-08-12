# 퀴즈 만들기 웹 UI 제공 — 인수인계 문서 (2026-08-10 작성)

> **✅ 설계 완료 + Phase 0(UI 목업) 완료 (2026-08-11).** 이 문서가 정리해둔 질문들은 후속 세션에서
> 전부 확정됐고, Phase 0~5 상세 계획과 승인된 UI 목업까지 나왔다. 상세는
> `docs/ACTIVE_PLAN.md` B-5, 목업은 `docs/WEB_QUIZ_CREATION_UI_MOCKUP.html`, 전체 설계 원본은
> `C:\Users\wjswo\.claude\plans\gleaming-foraging-planet.md`. **다음 세션은 Phase 1(코드 착수)부터** —
> 이 문서는 그 이전 단계(질문 정리)의 기록으로 아래 남겨둠.
>
> **이 문서는 상세 설계 문서가 아니다.** 사용자가 "다음은 퀴즈만들기를 웹 UI에서 제공할 것 —
> 상세 계획은 새로운 세션에서 하겠다"고 밝혀서, 그 세션이 설계를 시작할 때 필요한 컨텍스트(기존
> 인프라 중 뭘 재사용할 수 있는지, 뭐가 근본적으로 다른지, 착수 전 결정해야 할 질문들)만 정리해둔
> 것. **코드/설계 미착수.**

## 요청 배경

지금까지 완료된 `docs/WEB_INTEGRATION_PLAN.md`(Phase 1~4)는 전부 **"퀴즈 선택"**(이미 존재하는
퀴즈를 고르는 것)의 웹 연동이었다. 이번에 요청받은 건 **"퀴즈 만들기"**(문제를 새로 작성/편집하는
것)를 웹에서 제공하는 것 — 디스코드로 치면 `/퀴즈만들기`(`createQuizToolUIHolder`) 이하의 흐름
전체(`UserQuizListUI` → `UserQuizInfoUI` → `UserQuestionInfoUI`)에 해당한다.

## 기존 인프라 중 그대로/거의 그대로 재사용 가능한 것

퀴즈 선택 웹 연동에서 검증된 패턴들 — 새로 설계할 필요 없이 가져다 쓰면 됨:

- **토큰 기반 락 + 하트비트 + GC**: `web_session_manager.ts`(토큰↔길드 매핑, 15분 만료 +
  60초 하트비트 갱신, `runGC`). `mode` 필드로 여러 흐름을 구분하는 방식도 그대로 확장 가능
  (`'dev'|'user'|'omakase'|'multiplayer'` 옆에 `'quiz_edit'` 같은 새 mode 추가하는 식).
- **하이재킹 방어 패턴**: 다른 유저가 명령어를 다시 입력하면 "권한 가져오기" 버튼 안내 →
  `force_take` IPC → 홀더 재생성(`createWebHandoffUIHolder`/`bot.js`의 관련 핸들러).
- **인프로세스 vs 브로드캐스트 판단 기준**: Phase 4에서 확립됨 — DB/파일시스템만 필요한 조회는
  마스터가 직접 처리(`/api/dev-quizzes`, `/api/multiplayer-lobbies`), Discord 클라이언트 상태
  (음성채널 등)가 필요하면 반드시 그 길드를 담당하는 클러스터로 신호를 보내야 함. 퀴즈 만들기는
  거의 전부 **DB 조회/쓰기**라서 대부분 마스터가 직접 처리 가능할 가능성이 높음(음성채널 체크
  같은 게 없음) — 실제로 얼마나 그런지는 `db_quiz.ts`/`user_quiz_info_manager.js`를 다시 읽고
  확인 필요.
- **"payload 직접 대입 + adapter 객체" 패턴**: 실제 `interaction` 없이 화면을 만들어야 할 때
  `{guild, member: {id}, ...}` 같은 최소 어댑터로 기존 정적 헬퍼(`createDefault*QuizInfo`류)를
  호출하고, 모달 필드를 읽는 부분(`applyQuizSettings` 등)만 별도 payload-적용 헬퍼로 우회하는
  방식(Phase 3/4에서 검증). 퀴즈 만들기는 모달 필드 읽기 의존도가 Phase 1~4보다 훨씬 크므로
  이 패턴을 전면적으로 써야 할 것.
- **웹→클러스터 결과 보고 폴링 채널**: Phase 4에서 신설한 `report_*_result` / `GET
  /api/*-result` 1회성 폴링 패턴(`web_session_manager.ts`의 `reportMultiplayerResult`/
  `consumeMultiplayerResult` 참고) — confirm 응답이 비동기 처리라 즉시 성공/실패를 알 수 없는
  경우 재사용 가능.

## 근본적으로 다른 점 (재사용만으로 안 되는 부분)

Phase 1~4는 전부 "읽기 전용 탐색 + 최종 확정 버튼 1번"에 가까웠다(멀티플레이 로비 "방 제목"
텍스트 입력 1개가 지금까지 유일한 자유 텍스트 입력). 퀴즈 만들기는 성격이 다르다:

- **자유 텍스트/이미지 URL/오디오 타임스탬프 등 대량의 폼 입력**이 필요 — 디스코드 쪽은 전부
  모달(`interaction.showModal()`)로 처리하는데, 이건 그대로 웹으로 못 옮긴다(당연히 REST API +
  실제 `<form>` 입력으로 다시 만들어야 함).
- **문제 CRUD**(추가/삭제/순서 변경/복제) — 지금 웹 쪽엔 이런 API가 전혀 없음(전부 조회 전용).
  `db_quiz.ts`(DB 쿼리)와 `user_question_info_manager` 계열에 뭐가 이미 있는지부터 확인 필요.
- **오디오 문제**: `audio_cache_manager.js`의 yt-dlp 다운로드/캐싱, `generatePreviewClipStream`
  (미리듣기 스트림) — 이런 스트리밍 응답을 웹 API로 어떻게 노출할지(오디오 파일을 HTTP로 스트림?)
  전혀 검토 안 됨.
- **`user-question-info-ui.ts` 자체 경고**: 파일 상단 주석에 "건드릴 엄두가 안난다... 우선
  돌아가면 장땡"이라고 적혀있을 만큼 복잡하고 예민한 파일(`quizbot/quiz_ui/CLAUDE.md` 참고) —
  이 로직을 웹 API로 옮길 때 특히 조심스럽게 다룰 것.

## 다음 세션 착수 전 결정해야 할 질문들 (답 없음, 논의만 정리)

1. **진입점**: `/퀴즈만들기`(`createQuizToolUIHolder`)에도 `/퀴즈`의 `SelectUIModeUI`처럼
   "디스코드 UI / 웹 UI" 투트랙 분기를 추가할지, 아니면 다른 방식으로 진입시킬지.
2. **락 UX가 적합한지**: 퀴즈 선택은 몇 분 안에 끝나는 짧은 작업이라 "채널 잠금 + 웹에서 조작"이
   자연스러웠는데, 퀴즈 만들기(특히 문제 여러 개 편집)는 훨씬 오래 걸릴 수 있음 — 같은 lock 패턴을
   그대로 쓸지, 아니면 채널을 안 잠그고 "내 퀴즈 관리" 같은 독립된 웹 페이지로 갈지 재검토 필요.
3. **문제 CRUD API 설계**: 추가/삭제/순서변경/복제 각각 어떤 엔드포인트로 나눌지, 문제 최대
   개수(현재 50개) 등 기존 제약을 API 레벨에서 어떻게 재검증할지.
4. **이미지/오디오 입력 방식**: URL만 받을지, 실제 파일 업로드도 지원할지, 미리듣기를 웹에서 어떻게
   재생시킬지.
5. **B-1(문제 일괄 등록 Export/Import)과의 관계**: `docs/B1_BULK_IMPORT_EXPORT_TODO.md`에 이미
   미결정 상태로 대기 중인, 성격이 겹치는 기능(파일 첨부로 문제 일괄 등록). 같이 설계할지, 완전히
   별도로 갈지 먼저 정해야 함 — 착수 전 그 문서도 같이 열어볼 것.
6. **`user-question-info-ui.ts` 리팩터 여부**: 웹 API로 로직을 옮기는 김에 이 파일을 정리할지,
   아니면 최대한 안 건드리고 얇은 wrapper만 씌울지.

## 참고 문서

- `docs/WEB_INTEGRATION_PLAN.md` — 퀴즈 선택 웹 연동 전체(Phase 1~4), 재사용 가능한 아키텍처
  패턴 전부 여기 기록돼 있음.
- `docs/B1_BULK_IMPORT_EXPORT_TODO.md` — 성격이 겹치는 미결정 기능.
- `quizbot/quiz_ui/CLAUDE.md` — `user-quiz-list-ui.js`/`user-quiz-info.ui.js`/
  `user-question-info-ui.js` 각 파일 요약.
- `quizbot/managers/CLAUDE.md` — "퀴즈 선택 웹 연동" 섹션(마스터 vs 클러스터 책임 분리 기준).
