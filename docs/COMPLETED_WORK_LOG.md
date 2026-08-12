# 완료 작업 로그 (2026-08-07 최초 작성, 이후 날짜순 추가)

> 여러 계획 문서에 흩어진 "이미 끝난 것"을 날짜순으로 짧게(3~5줄) 요약한 진입점 문서. 상세 내역/코드
> 위치/왜 그렇게 했는지는 각 항목이 가리키는 원본 문서 또는 `git log`에 있음 — 이 문서는 "뭐가 끝났는지
> 빠르게 훑어보는 용도"만. 아직 안 끝난 건 `docs/ACTIVE_PLAN.md` 참고.

---

## 2026-08-03 ~ 08-04 — 전체 구조 리팩터 (Phase 0~6)

5,959줄 `quiz_system.js`를 포함해 여러 대형 파일을 도메인/클래스 경계로 분리(facade 패턴 반복 적용:
`db_manager.js`, `utility.js`, `quiz_ui/components.js`, `report_manager.js`). `node:test` 스캐폴딩,
`eslint.config.js` 도입도 이 기간에 완료. 상세: `docs/REFACTOR_PLAN.md`(전체 계획), `docs/BUGS_FOUND.md`
(발견 버그), `docs/DEPRECATED_CODE_REMOVED.md`/`docs/RELOCATED_COMMENTS.md`(삭제 코드/주석 보존),
`docs/DUPLICATE_UI_PATTERNS.md`(중복 패턴, 통합은 보류 결정).

## 2026-08-04 — 성능 관찰 로그 정리

리팩터 중 발견한 성능/메모리 포인트 기록만 해두고 수정은 보류(사용자 확인). `main-ui.js`의 죽은
`loadVersionInfo()`, `banned_user.txt` 반복 동기 읽기(`multiplayer_ban_manager.js`로 통합)는 이후
수정 완료. 상세: `docs/PERFORMANCE_NOTES.md`.

## 2026-08-05 — UI 개선 1라운드 (`docs/UI_IMPROVEMENT_PROPOSAL.md`)

퀴즈만들기 중심 UX 검토. 오타 3건, 파괴적 동작 안전장치 불균형(문제 삭제 2클릭 확인 추가), 임베드 구조화
(fields 분리), 주간 1위 데이터 오류(`played_count` vs `played_count_of_week` 혼용 버그) 등 0~5번 항목
대부분 완료. 잔여 2건은 `docs/ACTIVE_PLAN.md` B-3 참고.

## 2026-08-06 — UI 개선 2라운드 (`docs/UI_IMPROVEMENT_PLAN_ROUND2.md`)

봇 전역으로 조사 범위 확대. **A번(실제 버그 7건) 전부 수정**(스코어보드 무한 로딩, 새로고침 순서 버그,
좋아요 실패 시 무응답, 전역 `unhandledRejection` 핸들러 부재, 죽은 버튼 3종 등). B번(UX 개선 후보)은
[P1] 다수 + B-2/B-4/B-10 일부 완료, 나머지는 `docs/ACTIVE_PLAN.md` B-4에 잔여 목록.

## 2026-08-07 — TS 전환 A-1~A-5 완료 (`docs/TS_MIGRATION_AND_CONVENIENCE_PLAN.md`)

CommonJS 유지 + TypeScript 점진 도입(`allowJs`로 `.js`/`.ts` 공존). 빌드 파이프라인 구축(자원 경로,
`'use strict'` 자동삽입, `.ts`/`.js` 완전 분리 빌드 등 실제 구현하며 발견한 이슈 다수 해결) 후,
멀티플레이 제외 전체(`utility/`, `db/`, `managers/`, `quiz_ui/`, `quiz_system/`)를 `.ts`로 전환. 남은
건 A-3 6단계(멀티플레이)뿐 — 실전 대결 테스트 후 착수 예정.

## 2026-08-07 — 편의 기능 B-2/B-3'/B-4 구현

- **B-3' 문제(단일) 복제**: `question_edit_comp2`에 버튼 추가, 원본 데이터 복사해 바로 다음 위치에 삽입.
- **B-4 채팅 정지/취소 알림**: `notifyBannedUser()` 신설, 정지 사유/횟수/만료일을 밴 당사자에게 DM.
  후속 조치 시점엔 신고 로그가 이미 삭제돼 있어 `selectChatInfoById()`(신규 DB 쿼리)로 원문 재조회.
- **B-2 문제 미리듣기**: `generatePreviewClipStream()`(ffmpeg `-c copy`, 재인코딩 없음, 스트림 직접
  첨부) 신설. 당초 계획했던 `updatePrivateUI()` 프레임워크 확장은 `interaction.reply({files, flags:
  Ephemeral})` 방식으로 대체하며 불필요해짐(DM 컴포넌트+ephemeral+파일첨부 동작을 임시 테스트 버튼으로
  직접 검증 후 확정). 화면 레이아웃도 재배치(이미지 재로드+미리듣기 2개를 한 행에, 문제유형 선택은 맨
  아래로).

전수 테스트(멀티플레이 포함) 진행, 발견된 피드백 12건은 미착수 상태로 `docs/POST_B_ROUND_TEST_FEEDBACK_TODO.md`에
정리(`docs/ACTIVE_PLAN.md` B-2 참고).

## 2026-08-08 — B-2 전수테스트 피드백 12건 중 실동작 버그 3건 수정 (1/4/5번)

- **5번**: `duplicateQuestion()`에서 `interaction.explicit_replied = true`를 성공 경로에서만 await 이후에
  설정하던 걸 함수 맨 첫 줄로 이동 — 그 사이 틈을 타 `bot.js` 전역 fallback이 먼저 `deferUpdate()`를
  호출해 `Interaction has already been acknowledged` 에러가 나던 문제 해결(1줄 수정, 원인 특정은 이미 돼있었음).
- **4번**: `audio_cache_manager.ts`에 `downloading_promises`(video_id → Promise) 가드 추가. 같은 오디오를
  미리듣기 연타 시 yt-dlp 프로세스를 중복 스폰하지 않고 진행 중인 다운로드의 Promise를 재사용하도록 함.
  미리듣기(`sendAudioPreview`)/실제 게임 재생(`prepare.ts`) 두 호출부 모두 자동 적용.
- **1번**: `interaction.user.send()`에 `flags: Ephemeral`을 줘도 효과가 없는(인터랙션 응답 전용 옵션이라)
  버그를 `user-quiz-info.ui.ts`(태그 미선택 안내, 퀴즈 삭제 확인 다이얼로그 3곳)와 `user-quiz-list-ui.ts`
  (퀴즈 생성 실패 안내)에서 발견돼 `interaction.reply()`/`followUp()`으로 전환(이미 초기 reply를 소비한
  경우는 `followUp()` 사용). 감사 중 `user-quiz-select-ui.ts`의 "장바구니에 담았습니다" 응답이 애초에
  `flags` 자체가 누락돼 길드 채널에 공개로 남던 별개의 버그도 함께 발견해 수정. 전수 조사로 요청됐던
  "퀴즈만들기 전체 화면 ephemeral 통일" 중 발견된 실제 버그 케이스는 이걸로 마무리, 나머지(단순 누락 없는
  화면)는 별도 조치 불필요로 판단.

남은 9건(2/3/6/7/8/9/10/11/12번, UX 개선 후보 + 조사 필요 TODO)은 `docs/POST_B_ROUND_TEST_FEEDBACK_TODO.md`에
계속 남아있음 — 다음 세션에서 우선순위 논의 후 진행.

## 2026-08-08 — B-2 전수테스트 피드백 UX/텍스트 5건 수정 (2/3/6/9/10번)

- **2번**: `custom_quiz_components.ts`의 `question_preview_comp` — "이미지 재로드" 버튼 스타일을 옆 미리듣기
  버튼들과 맞춰 `ButtonStyle.Secondary`로 통일.
- **3번**: `sendAudioPreview()` — 오디오 구간 미지정(`custom_audio_start === undefined`)이라 랜덤 구간이
  재생되는 경우, `convertAudioRangeToString()`의 "[랜덤 구간 재생]" 톤에 맞춘 안내 문구를 미리듣기
  응답에 추가.
- **9번**: 멀티플레이 로비 문제 수 모달 라벨 "최대 50" → 실제 상한(60)에 맞춰 수정
  (`multiplayer_components.js`, 생성/설정 모달 둘 다). `docs/UI_IMPROVEMENT_PLAN_ROUND2.md` B-6의
  [P3] 동일 건도 같이 완료 표시.
- **10번**: 멀티플레이 로비 설명 문구에 "채팅이 밀려 화면이 안 보이면 '/퀴즈'를 다시 입력해 UI를 새로 받을
  수 있다"는 안내 추가(`multiplayer-quiz-lobby-ui.js`). `createMainUIHolder()`가 멀티플레이 로비
  참가 중이면 새 UI 대신 기존 로비 UI를 재전송하는 기존 로직(`ui-system-core.ts`)과 맞아떨어짐을 확인 후 반영.
- **6번**: 유저 퀴즈 목록 정렬 드롭다운(`base_components.ts`의 `sort_by_select_menu`) 위치 특정.
  사용자 피드백(수식어 방식이 항목마다 제각각) 확인 후 "전체 추천순"→"추천순", "최신 퀴즈순"→"최신순",
  "오래된 퀴즈순"→"오래된순"으로 정리(주간/전체 구분이 실제로 필요한 인기순만 수식어 유지).

남은 4건(7/8/11/12번, 전부 조사·논의 필요 TODO)만 `docs/POST_B_ROUND_TEST_FEEDBACK_TODO.md`에 남음.

## 2026-08-08 — B-2 피드백 7번(webm seek 부정확) 원인 규명 + 수정, 8번 원인도 상당 부분 규명

- **발견**: `utility/SeekStream/WebmSeeker.js`의 `seek(content_length)`(71-93번 줄) — webm 파일 내장
  Cues 테이블(실제 timestamp→byte position 매핑)로 정확한 클러스터 offset을 계산하고 클러스터 내부
  로컬 비트레이트로 보간하는, 이미 완성된 정확한 seek 로직이 **코드베이스 어디서도 호출되지 않는 죽은
  코드**였음. 실제 `SeekStream`의 seek 흐름(`SeekStream.js`의 `loop()`)은 이걸 무시하고 전체 파일
  평균 비트레이트 추정(`per_sec_bytes * sec`)만 써서, VBR 인코딩에서 ±3초 오차가 났던 것(7번 재현 조건).
- **검증**: 실제 캐시 파일(`resources/cache/`) 5개를 직접 바이트 단위로 파싱해서 Cues가 정확히 10초
  간격으로 존재함(코드의 가정과 일치)과, `seek()`가 계산한 byte offset 바로 뒤(12바이트 이내)에
  `Cluster` 엘리먼트와 실제 오디오 블록이 정확히 위치함을 확인. `SeekStream`을 실제로 생성해 스트림이
  에러 없이 정상적으로 오디오 데이터를 흘려보내는 것까지 end-to-end로 확인.
- **수정**: `SeekStream.seek()`가 헤더 파싱 후 `WebmSeeker.seek()`를 먼저 시도하고(`this.accurate_start_point`),
  실패/범위초과 시(Cues 없음, 또는 seek 대상이 Cues 범위 밖이라 `0`을 반환하는 엣지케이스) 기존 추정
  방식으로 자동 폴백하도록 연결(`SeekStream.js` 2곳 수정).
- **8번**: 재현 사례(100~140초 요청 시 미리듣기 90~137초, 실제 97~137초)를 재분석 — 끝점(137초)이
  같은 건 두 경로가 같은 `audio_duration_sec` 클램프를 써서 정상이었고(원본 길이가 137초), 진짜 차이는
  시작점뿐. 실제 재생(-3초)은 7번과 같은 원인, 미리듣기(-10초)는 ffmpeg `-c copy`의 클러스터 경계 스냅
  때문으로 — 8번은 별개 버그가 아니라 7번과 같은 "seek 부정확" 문제가 서로 다른 두 메커니즘에서 다르게
  나타난 것으로 결론.
- **주의**: 정적 분석(바이트 검증)과 스트림 에러 유무까지만 확인했고, **실제 Discord 음성 재생으로 들어보는
  검증은 못 함**(도구로 라이브 재생 불가) — `docs/TEST_CHECKLIST.md` I번 섹션에 검증 항목 추가, 문제
  있으면 `this.accurate_start_point` 관련 코드만 되돌리면 기존 동작으로 즉시 롤백 가능.

남은 2건(11/12번, MMR·추첨 알고리즘 — 둘 다 논의부터 필요)만 `docs/POST_B_ROUND_TEST_FEEDBACK_TODO.md`에 남음.

## 2026-08-08 — B-2 피드백 7번 실사용자 검증 완료 + 8번(미리듣기 구간 불일치) 수정 완료

- **7번 실사용자 검증**: 사용자가 실제 봇으로 재생 테스트 → 처음엔 여전히 부정확(80~90초 요청이 70초부터
  재생). 원인은 코드 버그가 아니라 **`dist/`(빌드 산출물)가 재빌드 안 돼서 옛날 코드 그대로 실행되고
  있었던 것**(`dist/utility/SeekStream/SeekStream.js`를 소스와 diff해서 확인). `npm run build`로 재빌드
  후 정상 동작 확인받음. (부수적으로 `Set-ExecutionPolicy` 미설정 환경에서 `npm run build`가 PowerShell
  보안 정책에 막히는 것도 확인 — `npm.cmd run build`로 우회 가능.)
- **8번 원인 규명 + 수정**: `generatePreviewClipStream()`의 `.setStartTime()`(fluent-ffmpeg, `-ss`를
  `-i` 앞에 붙이는 input seek)이 `-c copy`와 만나 요청 시각보다 최대 10초 이른 클러스터 경계로 스냅백하는
  게 원인(`ffmpeg ... -f null -` 드라이런으로 타임스탬프만 실측, 오디오 파일 생성 없이 확인:
  input seek `time=-00:00:09.97` vs output seek `time=00:00:00.00`). fluent-ffmpeg의 output seek
  메서드 `seekOutput()`으로 교체해 해결 — 컨테이너 seek 속도는 그대로, 정확도만 개선.
- **2026-08-08 사용자 실제 검증 완료**: 7번(재생 시작 지점), 8번(미리듣기 구간) 둘 다 사용자가 실제
  봇으로 재생해서 정상 동작 확인함. `docs/TEST_CHECKLIST.md` I번 섹션 체크 완료로 갱신.

이걸로 B-2 피드백 12건 중 10건 완료 + 실제 검증까지 끝남. 남은 건 11/12번(MMR·추첨 알고리즘 개선,
둘 다 논의부터 필요한 TODO)뿐.

## 2026-08-08 — 퀴즈 선택 웹 연동 설계 + UI 목업

사용자가 제시한 원 설계서(단일 프로세스+인메모리 Map+임시 토큰)를 이 프로젝트의 실제 구조(멀티 클러스터
`discord-hybrid-sharding`)에 맞게 보정 — 마스터 프로세스에 세션 상태를 두고 기존 멀티플레이 IPC
브로드캐스트+로컬필터링 패턴을 재사용하는 방향으로 확정. 오마카세 퀴즈의 실제 코드 구조(공식 퀴즈
장르선택 + 유저 퀴즈 장르모드/바구니모드 이원 구조, `DEV_QUIZ_TAG`/`QUIZ_TAG` 비트플래그 태그 체계)를
조사해 반영. 사용자 피드백을 여러 차례 받아가며 UI 목업(`docs/WEB_UI_MOCKUP.html`, 자체완결 HTML, 다크모드
지원)까지 완성해 최종 승인받음. 코드 구현은 착수 전(다음 세션부터) — 상세 설계/파일 목록/단계별 순서는
`docs/WEB_INTEGRATION_PLAN.md`, 미착수 상태 요약은 `docs/ACTIVE_PLAN.md` B-0.

## 2026-08-08 — 퀴즈 선택 웹 연동 네이밍 변경 + Phase 0(인프라 스켈레톤) 착수

- **네이밍 변경**: "장바구니"→"퀴즈함", "오마카세 퀴즈"→"랜덤 퀴즈" 둘 다 디스코드 쪽 사용자 노출
  문구(버튼 라벨/embed/모달/interaction.reply)까지 변경, 내부 변수·함수·클래스명(`basket_items`,
  `OmakaseQuizRoomUI`, `QUIZ_TYPE.OMAKASE` 등)은 유지(사용자 결정). `quiz-info-ui.ts`,
  `omakase-quiz-room-ui.ts`, `multiplayer-quiz-lobby-ui.js`, `user-quiz-select-ui.ts`,
  `components/omakase_components.ts`, `components/multiplayer_components.js`,
  `config/text_contents.json`, `config/system_setting.js`(`QUIZ_TYPE`/`QUIZ_MAKER_TYPE` 값 문자열),
  `lifecycle/ending.ts`/`lifecycle/question/question_custom.ts` 수정.
- **Phase 0**: `ipc_manager.ts`에 `WEB_SESSION_REQUEST`(클러스터→마스터)/`WEB_SESSION_SIGNAL`(마스터→전체
  클러스터)를 `MULTIPLAYER_SIGNAL`과 대칭 구조로 추가. 마스터 전용 `quizbot/managers/web/web_session_manager.ts`
  신설(토큰 발급/force_take/close/heartbeat/GC, `crypto.randomBytes` 기반 `web_token_utility.ts` 사용) +
  `web_express_app.ts`(Express 골격, `/health` + 정적 서빙). `index.js`에 초기화/IPC 분기 추가,
  `bot.js`엔 수신 로그만 남기는 placeholder relay 등록(실제 UI 라우팅은 Phase 1의 `WebHandoffUI`부터).
  단위테스트 10건(`test/managers/web/web_session_manager.test.js`) + `utility.js` export 개수 회귀
  테스트 갱신(25→26개, `web_token_utility` 추가분). UI 변경 없음 — Phase 1(공식 퀴즈 웹 선택)부터 이어감.

## 2026-08-08 — 퀴즈 선택 웹 연동 Phase 1(공식 퀴즈) 완료, 체크포인트 방식으로 전환

Phase 0 스켈레톤 위에 실제 기능을 얹음 - 계획했던 "Phase 1~3 한 번에"는 도중 리스크 발견(시그널
핸들러가 동기 계약이라 async UI 전환에 우회 필요, 하이재킹 버튼이 기존 소유자 라우팅과 충돌, 프론트엔드
Tailwind 재작성이 승인된 CSS 대비 드리프트 위험)으로 사용자와 협의 후 **체크포인트 3개(Phase별)**로
전환하기로 함.

- **백엔드**: `web_session_manager.ts`에 `mode`/`updateSelection`(select 액션) 추가 - 세션은 여전히
  스테이트리스, 실제 quiz_info 조립은 신호를 받는 클러스터 쪽이 담당하는 구조로 확정. `web_express_app.ts`에
  세션 인증 미들웨어 + `/api/session`, `/api/dev-quizzes`, `/api/session/select`, `/api/session/confirm`
  구현(문제 수는 마스터가 dev 트리의 `quiz_size`로 서버 사이드 클램프).
- **디스코드 UI**: `WebHandoffUI`(신규) - 잠금 화면 + `WEB_SESSION_SIGNAL` 3종(`updated`/`unlocked`/
  `expired`) 처리. `dev-quiz-select-ui.ts`의 `generateDevQuizInfo`를 static으로 승격 + `findContentByPath`
  신설(웹이 넘긴 `content_path`로 이미 로드된 트리에서 원본 재조회). `select-quiz-type-ui.ts`의 `'1'`
  분기가 `WebHandoffUI('dev', ...)`로 교체됨.
- **하이재킹 방어**: 다른 유저가 `/퀴즈`를 누르면 ephemeral "권한 가져오기" 버튼 안내 → 버튼 클릭은
  uiHolder 소유자 체크보다 먼저 가로채서 처리(`bot.js`) → `force_take` IPC → 홀더를 새 소유자로 교체
  (`createWebHandoffUIHolder`, `UIHolder`가 소유자 재할당을 지원하지 않아 free 후 재생성 + 이미
  `deferUpdate()`된 interaction 대응으로 `public_message_mode` 스위치 재사용).
- **프론트엔드**: `web-frontend/`(React+Vite) 신설. 원래 계획은 Tailwind였지만 승인된 목업이 순수 CSS라
  `styles.css`로 그대로 이식하기로 사용자와 합의 변경. 공식 퀴즈 탭(폴더 트리+상세+문제수 스테퍼+확정)
  완전 동작, 유저/랜덤 탭은 자기 모드가 아니면 비활성화(Phase 2/3에서 활성화 예정).
- **검증**: 신규 테스트 19건(`web_session_manager` 12건, `web_express_app` 실제 Express 서버+fetch
  통합테스트 7건). `npx tsc --noEmit`/`npm run lint`(0 error)/`npm test`(241 pass)/`npm run build`
  (백엔드+프론트엔드) 전부 통과 + Express가 빌드된 프론트엔드를 실제로 서빙하며 `/api/dev-quizzes`가
  진짜 `resources/quizdata` 트리를 반환하는 것까지 fetch로 실측. **실제 Discord 클라이언트 검증은 아직
  안 함** - 다음 세션에서 봇 재시작 후 우선 확인.

상세: `docs/WEB_INTEGRATION_PLAN.md`(신규/변경 파일 전체 목록, Phase 2/3 착수 시 필요한 아키텍처 메모).

## 2026-08-08 — 웹 연동 Phase 1 1차 실사용 테스트 버그 3건 수정

사용자가 실제 봇으로 기본 흐름(잠금→선택→확정→`DevQuizInfoUI` 전환)까지는 정상 확인, 이어서 "확정 후
문제 수 재변경 안 됨" / "확정 후 다른 퀴즈로 안 바뀜" / "웹에서 `invalid_or_expired_token` 에러" 3건
보고. 원인은 하나 — "선택 완료"가 서버 쪽에서 웹 세션 토큰을 즉시 파기하는 일방향 동작인데(디스코드
화면이 `WebHandoffUI`에서 `DevQuizInfoUI`로 완전히 교체돼 더 이상 웹의 갱신을 받을 곳이 없음) 웹
페이지가 이걸 반영 안 하고 계속 조작 가능한 척 보여줬던 것. `web-frontend/src/DevQuizTab.jsx`(확정 후
명확한 종료 화면, 더 이상 트리/스테퍼 조작 불가)와 `App.jsx`(모든 401을 공통 "세션 만료" 화면으로
통일 + 하트비트가 무효화 감지 시 자동 정지)로 수정. 확정 후 재선택 자체가 불가능한 건 의도된 제약으로
남겨둠(문제 수만 바꾸려면 디스코드의 기존 "퀴즈 설정" 버튼 사용, 다른 퀴즈는 `[/퀴즈]` 재입력) —
`docs/WEB_INTEGRATION_PLAN.md` Phase 1 항목에 상세 기록. `docs/TEST_CHECKLIST.md` O 섹션에 재검증
목록 갱신(기본 흐름은 실사용 확인 완료로 체크됨, 이번 수정분은 미검증 상태로 추가).

## 2026-08-08 — 웹 연동 Phase 1 토큰 생명주기 재설계 (응급 수정 대신 근본 원인 해결)

바로 위 항목("확정 후 재선택 자체가 불가능한 건 의도된 제약으로 남겨둠")을 사용자와 다시 논의한 결과,
근본 원인을 고치기로 결정. 세 가지 질문에서 출발:
1. "GC가 15분 뒤에 정리해주는데 왜 고아 토큰이 문제냐" → 하트비트가 살아있는 한 GC는 절대 못 잡는다는
   게 핵심(고아가 된 뒤에도 브라우저 탭이 계속 하트비트를 보내면 `expires_at`이 매번 갱신되어 무한정
   버팀 — 15분은 "하트비트가 아예 안 오는 경우"에만 적용되는 상한).
2. 하트비트 vs GC가 실제로 어떻게 다른지(하트비트=탭 하나의 만료시각 갱신, GC=전체 순회+정리, 서로
   완전히 독립).
3. "UI는 다 같은 최상위 클래스를 상속하니 신호 응답도 범용 아니냐" → 라우팅(`relayWebSessionSignal`)은
   이미 범용이지만 응답 로직은 화면마다 opt-in 구현이 필요하다는 걸 확인.

최종 설계: `web_session_manager.ts`의 `closeSession`(브로드캐스트+파기 묶음)을 `applySelection`(브로드캐스트만,
토큰 유지)과 `releaseSession`(조용히 파기, 브로드캐스트 없음)으로 분리. 토큰 파기 지점을 "선택 완료"에서
떼어내 (1) `quiz-info-ui.ts`의 `handleStartQuiz`(퀴즈 실제 시작) (2) `ui-system-core.ts`의
`UIHolder.free()`(홀더가 어떤 이유로든 사라질 때 — 하이재킹이 아닌 정상적인 새 명령어 진입까지 포함해
고아 토큰을 원천 차단)로 이동. `dev-quiz-select-ui.ts`에 `buildDevQuizInfoFromWebPayload` 공용 헬퍼를
추출해서 `web-handoff-ui.ts`(최초 적용)와 신규 구현한 `dev-quiz-info-ui.ts`의 `onReceivedWebSessionSignal`
(확정 후 재적용, 새 UI 인스턴스 대신 `this`를 반환해 `prev_ui_stack`이 안 쌓이게 함)이 공유. 이벤트명도
`unlocked`→`applied`로 개명(더 이상 "잠금 해제=세션 종료"를 의미하지 않아서). `web-frontend/src/DevQuizTab.jsx`는
직전 커밋의 "종료 화면"을 되돌리고, 원래 승인된 목업의 `flashConfirm`처럼 확정 시 1.5초짜리 토스트만
보여주는 방식으로 교체 — 확정 후에도 계속 조작 가능.

신규/갱신 테스트: `web_session_manager.test.js`(closeSession 테스트를 applySelection/releaseSession
테스트로 교체 + release no-op 테스트 추가, 14건), `web_express_app.test.js`(confirm 후 토큰 유지 확인 +
confirm 연속 2회 재선택 테스트 추가, 8건) — 백엔드 전체 244 pass, `tsc --noEmit`/`lint` 0 error 유지,
백엔드+프론트엔드 둘 다 빌드 확인. **아직 실제 Discord로 검증 안 함** — 특히 "확정 후 재선택"과
"UIHolder.free() 훅으로 고아 토큰 방지"가 다음 세션 최우선 확인 대상.

## 2026-08-08 — 실사용 테스트 중 발견: 확정 후 재선택 시 순환 require로 크래시

바로 위 재설계를 실제 봇으로 테스트하자마자(퀴즈1 확정 → 퀴즈2로 재선택) 서버 로그에
`Cannot read properties of undefined (reading 'buildDevQuizInfoFromWebPayload')` 발생. 원인:
`dev-quiz-select-ui.ts`가 이미 `dev-quiz-info-ui.ts`를 require하고 있는데(퀴즈 선택 시 `DevQuizInfoUI`
생성용), 재설계하면서 `dev-quiz-info-ui.ts`에도 `dev-quiz-select-ui.ts`를 top-level로 require하는 코드를
추가해 순환 require가 됨 — CommonJS 순환 require에서는 나중에 로드되는 쪽이 상대방의 텅 빈(아직 완성
안 된) `module.exports`를 캡처해버려서 `DevQuizSelectUI`가 `undefined`로 잡혔음. `dev-quiz-info-ui.ts`의
`require('./dev-quiz-select-ui')`를 `onReceivedWebSessionSignal` 함수 안으로 미뤄서(이벤트 발생 시점엔
모든 모듈 로드가 끝난 뒤라 순환이 있어도 안전) 수정. `test/quiz_ui/dev_quiz_web_reapply.test.js`(신규,
3건) 추가 — fix를 일부러 되돌려서 실제로 같은 에러가 재현되는 것까지 확인한 뒤 커밋. 이 테스트 파일은
`ui-system-core.ts`를 거치지 않고 `dev-quiz-select-ui.ts`/`dev-quiz-info-ui.ts` 둘만 직접 require함 —
`select-quiz-type-ui.ts`가 `require("./user-quiz-select-ui.js")`처럼 dist/ 빌드를 전제로 한 `.js`
확장자를 하드코딩해둔 곳이 있어서, `ui-system-core.ts`를 통해 로드하면 ts-node 기반 `node:test`에서
`MODULE_NOT_FOUND`로 죽는다(quiz_ui 트리를 평소 유닛테스트 안 하는 관례의 실제 이유였음 — 이번에 처음
확인). 전체 247 pass, `tsc`/`lint` 0 error 유지.

## 2026-08-08 — 웹 연동 Phase 1 실사용 재검증 완료, 세션 마무리

순환 require 수정 후 사용자가 실제 봇으로 다시 테스트 — 기본 흐름(잠금→웹 선택→확정→`DevQuizInfoUI`
전환) + 확정 후 다른 퀴즈로 재선택까지 정상 동작 확인. `docs/TEST_CHECKLIST.md` O 섹션에 확인된 항목
체크 완료, 남은 미확인 항목(문제 수만 재변경/뒤로가기 스택/퀴즈 시작 후 세션 종료/하이재킹/GC 만료/
고아 토큰 방지/다크모드)은 급하지 않은 걸로 분류해서 다음 세션으로 이월. Phase 1은 핵심 흐름 기준으로
안정화된 것으로 판단, 다음 세션은 Phase 2(유저 퀴즈 웹 선택)부터 — `docs/ACTIVE_PLAN.md` B-0,
`docs/WEB_INTEGRATION_PLAN.md` "단계별 구현 순서" 3번 참고.

## 2026-08-10 — 퀴즈 선택 웹 연동 Phase 4(멀티플레이 퀴즈) 설계+구현 완료, 같은 세션

전 세션에서 설계만 끝내고 미룬 "착수 전 확인 체크리스트" 4개를 먼저 확인: (1) `ban_manager.initialize()`가
`bot.js`(클러스터)에서만 호출되고 있었음 - 파일 기반 싱글턴이라 `index.js`(마스터)에도 안전하게 추가.
(2) 대기실 목록 - `index.js`가 `MULTIPLAYER_SIGNAL`을 `multiplayer_manager.onSignalReceived`로 이미
인프로세스(마스터) 처리하고 있어서, `REQUEST_LOBBY_LIST` 핸들러도 이미 마스터에서 실행 중이었음(IPC
왕복 불필요, 예상보다 좋은 상황). (3) `createLobby`/`tryJoinLobby`/`applyQuizSettings`의 interaction
의존 - 모달 필드 읽기뿐 아니라 `interaction.reply()`(성공/실패 피드백)까지 의존한다는 걸 발견해 사용자에게
대응 방식을 확인받음("페이로드 직접 대입 + 신규 메서드" 선택). (4) 조사 결과를 반영해 설계 재확인 후
곧장 구현 착수.

**구현**: `index.js`(마스터 `ban_manager.initialize()` 추가), `web_express_app.ts`(`GET
/api/multiplayer-lobbies` - 마스터가 `multiplayer_manager.onSignalReceived`를 인프로세스 직접 호출,
`/api/session/confirm`에 `mode:'multiplayer'` 분기 - 밴 체크만 마스터에서 선제 처리하고 나머지는
브로드캐스트), `web-handoff-ui.ts`(`buildMultiplayerUI` 신규 - `MultiplayerQuizSelectUI.createLobby`/
`tryJoinLobby`와 동일한 밴/음성채널 체크를 직접 재현한 뒤 `{guild, member, channel, web_mode:true}`
어댑터로 `MultiplayerQuizLobbyUI`를 곧장 생성, 음성채널 체크는 진짜 `GuildMember`가 필요해
`guild.members.fetch`로 실제 조회), `multiplayer-quiz-lobby-ui.js`(`static applyWebPayloadToQuizInfo`/
`buildMultiplayerQuizInfoFromWebPayload` - quiz_info shape이 랜덤 퀴즈와 같아서
`OmakaseQuizRoomUI.applyWebPayloadToQuizInfo`를 그대로 재사용 + 방 제목만 추가, `is_web_origin`
플래그로 모달 읽기/`interaction.reply()` 의존 경로 분기, `onReceivedWebSessionSignal` 신규),
`web-frontend/src/MultiplayerTab.jsx`(신규 - 대기실 목록→"새 로비 만들기" 폼(`OmakaseTab.jsx`와 동일
셰이프, 문제 수 상한만 60)→완료 안내 3단계, `OmakaseTab.jsx`의 `ChipRow`/`BasketQuizCard`를 export해서
재사용).

**구현 중 발견한 회귀**: `multiplayer-quiz-lobby-ui.js`가 `require("./user-quiz-select-ui.js")`처럼
dist 빌드를 전제로 한 확장자를 하드코딩해둔 기존 코드가 있었는데, `web-handoff-ui.ts`가 이 파일을
top-level에서 require하게 되면서 `web-handoff-ui.ts`를 직접 require하는 기존 테스트
(`omakase_web_apply.test.js`/`user_quiz_web_apply.test.js`, multiplayer와 무관한 mode)까지 ts-node
모듈 해석에서 `MODULE_NOT_FOUND`로 깨짐 - `npm test`로 실제 발견. `MultiplayerQuizLobbyUI` require를
`buildMultiplayerUI` 함수 안으로 미뤄서(2026-08-08 순환 require 수정과 동일한 종류의 우회) 해결,
회귀 없이 267 pass 복구.

**검증**: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 58 warning 기존 수준 유지)/`npm test`
(267 pass)/`npm run build`(백엔드+프론트엔드) 전부 통과. **미검증**: 실제 Discord+브라우저 테스트
전무(참가/생성/음성채널 체크/재확정/2클러스터 이상 IPC 왕복) - 다음 세션 최우선. 알려진 설계상 한계
2가지(확정 응답이 항상 성공으로 보임 - 실제 실패는 디스코드 채널에서만 안내됨, 생성 폼에 실시간
미리보기 없음)는 `docs/WEB_INTEGRATION_PLAN.md` Phase 4 "알려진 한계" 참고.

## 2026-08-10 — 퀴즈 선택 웹 연동 Phase 4 실사용 피드백 6건 수정 (같은 세션)

Phase 4 최초 구현 직후 사용자가 실제 브라우저로 테스트해 발견한 문제 6건 처리.

- **1/2번(스타일)**: "새로고침" 버튼과 방 제목 입력칸이 브라우저 기본 스타일 그대로라 눈에 띄게
  촌스러웠던 문제 — `styles.css`에 `.btn-secondary`(보조 버튼)/`.text-field`(텍스트 입력)/`.error-banner`
  (오류 배너) 3개 클래스 신설, 앱 전체 디자인 시스템(gold/violet 팔레트, 기존 `.cta-primary`/
  `.search-field`와 통일된 radius/padding)에 맞춤.
- **3/6번(진짜 원인)**: 음성채널 미접속 상태로 로비 생성 시도 → 에러 없이 조용히 실패(3번) → 음성채널에
  들어간 뒤 재시도해도 여전히 로비가 안 생김(6번). 원인은 하나 — `WebHandoffUI.buildMultiplayerUI`가
  밴/음성채널 체크 실패 시 `this.goToBack()`을 불렀는데, 이게 `WebHandoffUI` 자신을 `prev_ui_stack`의
  이전 화면(`SelectUIModeUI`)으로 교체해버림. 그래서 최초 실패(음성채널 미접속) 직후 `WebHandoffUI`가
  이미 사라진 상태가 됐고, 그 뒤 웹에서 아무리 재시도해도(음성채널에 들어간 뒤라도) 신호를 받을 화면
  자체가 없어 완전히 먹통이었던 것. `goToBack()`을 제거하고 실패 시 `this.last_error`를 채워
  `refreshLockedEmbed()`로 잠금 화면에 실패 사유만 얹어 보여주면서 `WebHandoffUI`를 유지하도록 수정 —
  재시도가 정상 동작하게 됨. 추가로 웹에도 실제 에러가 뜨도록 `web_session_manager.ts`에
  `reportMultiplayerResult`/`consumeMultiplayerResult`(세션에 1회성 `multiplayer_result` 필드), 마스터
  IPC에 `report_multiplayer_result` 액션, Express에 `GET /api/multiplayer-result` 신설 — 클러스터가
  밴/음성채널 체크 결과를 마스터에 보고하면, 프론트엔드가 confirm 직후 짧게 폴링(`pollMultiplayerResult`,
  최대 8회×400ms)해서 실패 시 오류 배너로 표시.
- **4/5번(생성 후에도 계속 편집)**: `MultiplayerQuizLobbyUI.onReceivedWebSessionSignal`은 이미 로비
  생성 후 재확정을 지원하고 있었지만(Omakase와 동일 패턴, Phase 4 최초 구현에 포함돼 있었음),
  `MultiplayerTab.jsx`가 생성 성공 시 곧장 종료 화면("done")으로 보내버려서 실제로는 활용이 안 되고
  있었던 게 진짜 문제. 생성 후에도 같은 설정 화면에 머물며 계속 태그/퀴즈함/문제 수/방 제목을 바꿔
  재확정할 수 있도록 수정("🌐 변경사항 반영" 버튼으로 라벨 전환), "대기실 목록으로" 버튼은 로비 운영
  중엔 숨김(실수로 두 번째 로비를 만드는 것 방지) — 이 수정으로 5번이 물었던 "생성→목록→재생성 시
  이전 설정이 남는" 시나리오 자체가 더 이상 발생하지 않게 됨(생성 전 초안 상태에서 목록으로 나갔다가
  다시 여는 경우는 여전히 초안이 남는데, 사용자 확인 후 의도적으로 그대로 둠).

검증: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 58 warning 기존 수준 유지)/`npm test`(267
pass)/`npm run build`(백엔드+프론트엔드) 전부 통과. **아직 실제 Discord+브라우저 재검증 전** — 특히
"실패 후 재시도" 케이스가 이번 수정의 핵심이라 다음 세션 최우선 확인 대상(`docs/TEST_CHECKLIST.md` R
섹션 갱신됨).

## 2026-08-10 — Phase 4 추가 피드백 4건 + 웹 세션 만료 점검 + 퀴즈 만들기 웹 UI 인수인계 문서

바로 위 "Phase 4 실사용 피드백 6건 수정" 이후 사용자가 이어서 준 피드백 4건 처리.

- **참가 후 "대기실 목록으로" 제거**: 참가(join) 완료 화면에서 목록으로 돌아가는 버튼을 없앰 —
  참가 이후엔 디스코드 UI로만 조작하는 게 맞다는 사용자 방침(새 로비 만들기는 예외 - 로비를 계속
  운영하며 웹에서 설정을 바꿀 수 있어야 하니 그대로 둠). 이제 `view:'done'`은 join 전용이라 더 이상
  안 쓰는 `doneAction` state도 같이 정리.
- **버튼 스타일 재작업**: 실제 원인은 `.cta-primary`가 `width:100%` 고정이라 `.toolbar`(가로 flex)
  안에 넣으면 레이아웃이 깨지고 있었던 것 — `.toolbar-cta`(내용 너비만 차지하는 골드 버튼)/
  `.icon-btn`(새로고침 같은 아이콘 전용 정사각형 버튼)/`.link-btn`(뒤로가기용 텍스트 링크 스타일)
  3개로 재설계, 기존 `.btn-secondary`는 제거.
- **웹 세션 15분 만료 점검(코드 트레이스로 확인, 실제 장시간 방치 테스트는 아직 안 함)**: 로비를
  만들고 오래 방치해도 웹을 열어둔 채면 토큰이 안 끊기는지 확인 요청 → 두 개의 독립된 자동 갱신
  메커니즘이 이미 있어서 정상 동작할 것으로 결론남. (1) 웹 쪽: `App.jsx`가 60초마다
  `heartbeat()`를 보내 토큰의 `expires_at`을 15분(`WEB_SESSION_EXPIRE_SEC=900`)씩 계속 연장 -
  탭이 바뀌어도 `App` 컴포넌트 자체는 안 없어지므로 계속 동작. (2) 디스코드 쪽: `UIHolder`도
  자체적인 idle 정리 로직(`uiHolderAgingManager`, `UI_HOLDER_AGING_MANAGER_CRITERIA=900`)이 있어서
  `last_update_time`이 15분 넘게 안 갱신되면 홀더 자체가 `free()`되고(웹 세션도 함께 해제됨) -
  `MultiplayerQuizLobbyUI`는 이미 `checkNeedToRefresh`(1분마다 체크, 메시지가 10분 넘게 오래됐으면
  재전송)가 있어서 로비 생성 후엔 이게 자동으로 `last_update_time`을 계속 갱신해준다는 걸 코드로
  확인 - 두 메커니즘 다 살아있으니 안 끊길 것. **단, 로비를 만들기 전(잠금 화면에서 대기 중)엔 이
  자동 갱신이 없어서, 15분 넘게 아무 조작 없이 방치하면 `UIHolder`가 정리되며 웹 세션도 같이
  끊긴다** - Phase 4 신규 이슈가 아니라 Dev/User/Omakase 포함 웹 연동 전체에 공통된 기존 동작.
- **퀴즈 만들기 웹 UI 제공 - 인수인계 문서만 작성**: 상세 설계는 사용자가 다음 세션에서 진행하기로
  해서, 이번엔 설계 없이 `docs/WEB_QUIZ_CREATION_HANDOFF.md` 신설 — 재사용 가능한 기존 인프라(토큰
  락/하트비트/GC, 하이재킹 방어, "payload 직접 대입" 어댑터 패턴, 결과 폴링 채널), 근본적으로 다른 점
  (자유 텍스트/이미지/오디오 대량 입력, 문제 CRUD API 부재, `user-question-info-ui.ts`의 자체 경고
  주석), 착수 전 결정해야 할 질문 6개(진입점/락 UX 적합성/CRUD API 설계/미디어 입력 방식/B-1과의
  관계/리팩터 여부) 정리. `docs/ACTIVE_PLAN.md` A절에 포인터 추가.

검증(코드 변경분만): `web-frontend`에서 `npm run build` 통과(백엔드 코드는 이번 라운드에서 변경 없음).

## 2026-08-10 — Phase 4 추가 피드백 4건 + 전역 강조색 gold→blue 변경

바로 위 항목 이후 사용자가 이어서 준 피드백 4건 처리.

- **퀴즈함(FAB) 버튼 누락 수정**: `MultiplayerTab.jsx` 최초 구현 시 OmakaseTab.jsx를 참고해 만들면서
  "직접 골라 담기" 모드의 🍱 FAB+드로워(담긴 퀴즈 목록 확인/제거)를 통째로 빠뜨렸음 - 포팅 누락.
  `drawerOpen` state, `removeFromBasket`/`handleBasketDrawerItemClick` 헬퍼, FAB+드로워 JSX를
  OmakaseTab.jsx와 동일하게 추가.
- **문제 수 20개 미만 확정 가능하던 버그 수정**: `min_quiz_size=20`이 `MultiplayerQuizLobbyUI.
  createDefaultMultiplayerQuizInfo`에 있었지만, 웹 경로는 `OmakaseQuizRoomUI.
  applyWebPayloadToQuizInfo`(오마카세 공용 헬퍼, `min_quiz_size` 개념 자체가 없음 - 오마카세는
  하한이 1)를 그대로 재사용하고 있어서 하한 체크가 통째로 빠져있었음(디스코드 모달 경로인
  `quiz-info-ui.ts`의 `applySelectedQuestionCount`에만 있던 로직이라, 웹 경로가 그 함수를 우회하면서
  같이 빠짐). `MultiplayerQuizLobbyUI.applyWebPayloadToQuizInfo`에서 공용 헬퍼 호출 후
  `min_quiz_size` 이상으로 다시 한번 올리는 방어 추가(이게 최종 authoritative 지점), 프론트엔드
  스테퍼 하한도 1→20으로 수정, `web_express_app.ts`의 confirm 클램프도 20~60으로 맞춤(이중 방어).
- **참가 완료 화면 "대기실 목록으로" 제거**: 참가(join) 이후엔 디스코드 UI로만 조작하는 게 맞다는
  방침 확인 - 버튼 제거, 이제 `view:'done'`은 join 전용이라 안 쓰던 `doneAction` state도 정리(새
  로비 만들기는 예외 - 로비 운영 중엔 계속 웹에서 설정 변경 가능하게 이미 남겨둠).
- **버튼 스타일 재작업**: 실제 원인은 `.cta-primary`가 `width:100%` 고정이라 `.toolbar`(가로 flex)
  안에 넣으면 레이아웃이 깨지고 있었던 것 - `.toolbar-cta`/`.icon-btn`/`.link-btn` 3개 신설.

이어서 "버튼 배경이 gold라 촌스럽다, 다른 색 없냐"는 피드백 - 앱 전체(4개 탭 공통) 디자인 토큰이라
색 선택을 먼저 확인(`AskUserQuestion` - 블루/에메랄드/violet 재활용/직접 지정 중 사용자가 "블루 계열"
선택). `styles.css`의 `--gold`/`--gold-ink`/`--gold-bg`를 `--primary`/`--primary-ink`/`--primary-bg`로
리네임 + 라이트(`#3B82F6`/`#1D4ED8`/`#DBEAFE`)·다크(`#5B9BFF`/`#EAF2FF`/`#1E3A5F`) 값 교체, 버튼 위
하드코딩된 텍스트색(`#2a2000`, 골드 배경 대비용 어두운 갈색) 7곳을 `#FFFFFF`로, 브랜드 아이콘 그라디언트
끝단 색(`#8f6a06`)을 `#1E40AF`로 교체. violet/green/red 등 나머지 팔레트와 레이아웃은 안 건드림 -
Dev/User/Omakase/Multiplayer 4개 탭 전부에 영향.

검증: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 58 warning 기존 수준 유지)/`npm test`(267
pass)/`npm run build`(백엔드+프론트엔드) 전부 통과. `docs/TEST_CHECKLIST.md` R 섹션에 항목 추가 +
신규 S 섹션(전역 강조색 변경 검증) 신설. **아직 실제 Discord+브라우저 재검증 전** - 특히 문제 수
하한/FAB/색상 대비는 다음 세션 최우선.

## 2026-08-07 — 문서 구조 정리

루트에 흩어져 있던 계획서/로그 문서 13개를 `docs/`로 이동(`git mv`), 루트 및 하위 5개 `CLAUDE.md`의
참조 경로 갱신. `docs/ACTIVE_PLAN.md`(이 문서의 짝)와 `docs/COMPLETED_WORK_LOG.md`(이 문서)를 신설해
여러 계획서에 흩어진 완료/미완료 상태를 한 곳에서 훑어볼 수 있게 함.

## 2026-08-11 — 퀴즈 만들기 웹 UI 설계 확정 + Phase 0(UI 목업) 완료

`docs/WEB_QUIZ_CREATION_HANDOFF.md`(2026-08-10 작성)의 후속 세션. 인수인계 문서에 정리해둔 질문
6가지를 사용자와 논의해 전부 확정(진입점 투트랙 분리, 유저 스코프 세션 일반화, `user-question-info-ui.ts`
실제 리팩터, URL 입력만, 유튜브 타임스탬프 링크로 미리듣기 대체, `/api/my-quizzes` 신규 네임스페이스 등)
— Phase 0~5 전체 계획이 나옴. 플랜모드로 재확인 후 승인받고 Phase 0(UI 목업)만 이번 세션 범위로 진행.

**Phase 0 목업** (`docs/WEB_QUIZ_CREATION_UI_MOCKUP.html`, `docs/WEB_UI_MOCKUP.html`과 대칭 신규 파일):
퀴즈 목록/상세/문제편집 3화면 + "실제 디스코드에선 이렇게 보여요" 미리보기. 사용자 피드백을 3라운드
받으며 반복:

1. **1차**: 목록 화면을 퀴즈 선택 웹 UI(`docs/WEB_UI_MOCKUP.html`)의 그리드 카드 언어로 통일 + 새
   퀴즈 추가/선택→편집 플로우 연결. 상세 화면에 썸네일 미리보기 필드 추가, 태그 선택 UI가 비어 보이던
   실제 버그(화면 전환 시 `renderDetail()` 미호출) 발견해 수정, 공개 토글 스위치 레이아웃 어긋남도
   `<button>` 기본 스타일 리셋 누락 버그로 확인 후 수정. 문제 편집 화면을 디스코드 3-모달
   (`modal_question_info`/`modal_question_additional_info`/`modal_question_answering_info`) 구조
   그대로 3탭으로 재구성.
2. **2차**: 디스코드 미리보기에 힌트 화면 상태 추가(문제 출제 중/힌트 화면/정답 공개 3단계), 탭
   전환이 곧 미리보기 상태 전환이 되도록 연동. 정답 유형 선택을 별도 박스에서 "기본 정보 설정" 탭
   안으로 이동, 탭 버튼 스타일을 텍스트 밑줄에서 채워진 세그먼트 버튼으로 바꿔 가시성 개선. 오디오
   미리듣기를 "재생 중" 텍스트에서 실제 유튜브 타임스탬프 링크(`?t=<초>s`)로 교체. 문제 목록의
   이미지/오디오 구분 배지를 없애고 문제(보라)/힌트(황토)/정답(초록) 3색 content-tag로 교체, 우측
   디스코드 미리보기를 퀴즈 상세 화면에서 제거하고 대신 `WEB_UI_MOCKUP.html`의 "유저 퀴즈 선택" 상세
   카드와 동일한 구조의 "다른 사람들에게 이렇게 보여요" 카드로 교체.
3. **3차**: `initialize.ts`의 `buildCustomQuestion()`/`generateHint()`를 다시 읽고 "힌트를 안 정하면
   정답 기반 기본 힌트가 자동 생성된다"(`HINT_PERCENTAGE=2`, 정답 절반가량을 `◼`로 가림)는 실제 동작을
   확인 — 이전에 "힌트 없으면 아무 메시지도 안 감"으로 잘못 구현했던 걸 자동생성 근사 로직으로 교체.
   오디오 반복재생 필드를 기본 정보 설정으로 이동(웹 UI 한정 조정, 디스코드는 추가 정보 쪽), 반복 포함
   총합 재생시간 코드 재확인 후 정확한 값(최대 70초, 사용자가 말한 60초가 아니라
   `MAX_QUESTION_TOTAL_AUDIO_PLAY_TIME` 상수 그대로) 반영. WebP 미지원/오디오 최대 재생시간(문제용
   60초/정답공개용 13초)/원본 영상 20분 제한을 placeholder가 아니라 필드 라벨에 명시. "추가 정보 설정"
   탭을 웹 UI 한정으로 "힌트 설정"으로 개명. 필수값(퀴즈 제목, 정답 유형별 정답값) 미입력 시 인라인
   에러 표시 + 저장/이동 차단 추가.

사용자 최종 승인("UI 설계는 이정도로 끝내고"). **코드/DB/세션 인프라는 전혀 안 건드림** — Phase 1부터는
다음 세션에서 진행하기로 함. 검증은 육안 확인만(코드 변경 없어 자동 테스트 대상 없음). 상세 설계는
`C:\Users\wjswo\.claude\plans\gleaming-foraging-planet.md`(전체 Phase 0~5)와
`elegant-plotting-crystal.md`(이번 세션 실행판) — Phase 1 착수 시 `docs/WEB_QUIZ_CREATION_PLAN.md`로
옮겨적을 것. `docs/ACTIVE_PLAN.md` B-5 신설.

## 2026-08-11 — 퀴즈 만들기 웹 UI Phase 1(세션 스코프 일반화 + 진입점 스켈레톤)

신규 `docs/WEB_QUIZ_CREATION_PLAN.md`로 설계 원본 이관. `web_session_manager.ts`를 guild/owner
두 스코프로 일반화(`scope`/`scope_id` 필드, `broadcast(guild_id,...)`→`broadcast(scope_id,...)`
리네임, `owner_token_map`+`createOwnerScopedSession`/`releaseOwnerScopedSession` — DM은 1:1이라
하이재킹 개념 없이 무조건 교체). `web_express_app.ts`의 `GET /api/session`이 `scope`/`scope_id`/
`owner_name`도 반환(기존 `guild_id` 필드 하위 호환 유지). `ui-system-core.ts`: `UIHolder.free()`가
PRIVATE 홀더면 `release_owner_session`도 전송, `relayWebSessionSignal`이 `.scope_id`로 라우팅,
신규 `createQuizEditWebHandoffUIHolder`, `createQuizToolUIHolder`의 최초 화면을
`QuizEditSelectUIModeUI`로 교체(`/퀴즈만들기`도 `SelectUIModeUI`와 동일한 디스코드/웹 투트랙 진입).
신규 `quiz-edit-select-ui-mode-ui.ts`/`quiz-edit-web-handoff-ui.ts`(하이재킹 방어 없음). `config/
system_setting.js`에 `MAX_QUESTIONS_PER_QUIZ: 50` 추가(교체는 Phase 2). 프론트엔드:
`web-frontend/editor.html`+`editor-main.jsx`(Vite 멀티페이지), `QuizEditorApp.jsx`(세션 부트스트랩
플레이스홀더, 기존 `api.js` 재사용), `vite.config.js`에 `build.rollupOptions.input` 추가,
`react-router-dom` 설치(실사용은 Phase 3부터). 검증: `npx tsc --noEmit`/`npm run lint`(0 error)/
`npm test`(274 pass, 기존 `signal.guild_id` assert 갱신 + owner-scope 신규 테스트 7건)/`npm run build`
(백엔드+프론트엔드 index.html·editor.html 둘 다) 전부 통과. **미검증** — 실제 Discord+브라우저 테스트
전무, 다음 세션 최우선(`docs/TEST_CHECKLIST.md` 신설 섹션). `docs/ACTIVE_PLAN.md` B-5 갱신.

**✅ 2026-08-11 실사용 검증 + `/editor.html` URL 정리, 같은 세션**: 사용자가 실제 봇으로 DM
`/퀴즈만들기` 투트랙 진입 확인(디스코드 UI/웹 UI 분기, `editor.html` 세션 인증까지 정상 동작). 이어서
편집 링크가 `.html` 확장자로 뜨는 게 촌스럽다는 피드백을 받아 `web_express_app.ts`에 `/editor`,
`/editor/*`(Phase 3~4에서 react-router-dom 클라이언트 라우팅이 붙었을 때 새로고침/딥링크 대비 와일드카드
까지 미리 처리) 라우트를 추가해 `editor.html`을 서빙하도록 하고, `quiz-edit-web-handoff-ui.ts`의 링크도
`/editor?token=...`로 변경. 격리된 포트로 직접 서버를 띄워 `/editor`/`/editor/quiz/123` 둘 다 200을
반환하는지 수동 확인. 검증: `npx tsc --noEmit`/`npm run lint`(0 error)/`npm test`(274 pass) 전부 통과.

## 2026-08-11 — 퀴즈 만들기 웹 UI Phase 2(공유 검증 모듈 추출 + 디스코드 쪽 리팩터)

신규 `quizbot/managers/quiz_editor_validation.ts` — `user-question-info-ui.ts`/`user-quiz-info.ui.ts`에
흩어져 있던 인터랙션-비의존 검증/파싱 로직을 순수 함수 7개(`parseAudioRangePoints`/
`redefineRepeatCount`/`parseUseAnswerTimer`/`isValidAudioUrl`/`isValidImageUrl`/`isDiscordCdnLink`/
`canGoPublic`)로 추출(`multiplayer_mmr.js`와 동일 관례). `user-question-info-ui.ts`(호출부 8곳 교체,
원본 메서드 2개 삭제, 매직넘버 50→`SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ` 3곳)/`user-quiz-info.ui.ts`
(`quiz_toggle_public` 1곳)가 이 모듈을 호출하도록 전면 교체 — **동작 변경 없는 순수 이관**,
`sendDelayedUI`/`sendAudioPreview`/`duplicateQuestion`의 디스코드 전용 우회는 100% 유지. 신규
`test/managers/quiz_editor_validation.test.js`(21건, 경계값 전부). 검증: `npx tsc --noEmit`/
`npm run lint`(0 error)/`npm test`(295 pass)/`npm run build` 전부 통과. 웹 기능(REST 등)은 이 phase에
전혀 없음. `docs/WEB_QUIZ_CREATION_PLAN.md`/`docs/ACTIVE_PLAN.md` B-5 갱신, 다음은 Phase 3(퀴즈 메타데이터
REST CRUD)부터.

## 2026-08-11 — 퀴즈 만들기 웹 UI Phase 3(퀴즈 메타데이터 REST CRUD), 같은 세션

`db_quiz.ts`에 `selectOwnedQuizInfoById(quiz_id, creator_id)`(`is_private` 필터 없이 `creator_id`로
소유권을 DB 레벨에서 강제)/`user_quiz_info_manager.ts`에 `loadOwnedUserQuizInfoById` 신설(기존
`selectQuizInfoById`/`loadUserQuizInfoById`와 동일 패턴). 신규 `quizbot/managers/web/
web_quiz_editor_routes.ts`(Express Router, `web_express_app.ts`에 `requireWebSession`+
`requireOwnerScopedSession`으로 감싸 `/api/my-quizzes`에 마운트) — `requireQuizOwnership` 미들웨어가
`loadOwnedUserQuizInfoById`로 소유권을 확인하고 `req.owned_quiz`에 담아 재조회를 막는다. 라우트 7개:
`GET /`(목록+태그), `POST /`(생성 - `UserQuizListUI.addQuiz`와 동일 기본값), `GET /:quiz_id`(메타데이터+
문제 목록+`quiz_editor_validation`의 검증 플래그), `PUT /:quiz_id`(`editQuizInfo`와 동일 로직, 글자수
서버 검증), `PUT /:quiz_id/tags`(`QUIZ_TAG`에 정의된 비트로만 마스킹), `POST /:quiz_id/toggle-public`
(`canGoPublic` 체크), `DELETE /:quiz_id`(소프트 삭제, 관리자 삭제+밴은 제외 - 확정 사항). 프론트엔드:
`web-frontend/src/editor/EditorApi.js`(신규 클라이언트, `api.js`의 싱글턴 토큰 재사용)/
`QuizListPage.jsx`(목록+생성 폼)/`QuizDetailPage.jsx`(메타데이터 수정+태그+공개토글+삭제, 삭제는
디스코드와 동등한 2클릭 확인), `QuizEditorApp.jsx`에 `react-router-dom` `BrowserRouter basename="/editor"`
배선(`/`→목록, `/quiz/:quizId`→상세) - Phase 1에서 미리 설치해둔 의존성을 이제 실제로 사용. 문제 목록은
이 phase에선 검증 경고(⚠️) 배지만 보여주는 읽기 전용 placeholder(실제 CRUD는 Phase 4). 신규
`test/managers/web/web_quiz_editor_routes.test.js`(14건 - CRUD 왕복, 소유권 403/404, 글자수 400, 태그
마스킹, toggle-public 태그 검증), `db_manager.test.js`/`user_quiz_info_manager.test.js`에 신규 함수
검증 추가. 검증: `npx tsc --noEmit`/`npm run lint`(0 error)/`npm test`(312 pass)/양쪽
`npm run build` 전부 통과. **미검증** — 실제 Discord+브라우저 테스트 전무, 다음 세션 최우선
(`docs/TEST_CHECKLIST.md` T 섹션에 항목 추가). `docs/WEB_QUIZ_CREATION_PLAN.md`/`docs/ACTIVE_PLAN.md`
B-5 갱신, 다음은 Phase 4(문제 CRUD REST + 프론트 문제 편집기)부터.

**✅ 2026-08-11 Phase 3 UI 피드백 3건 반영, 같은 세션**: 사용자가 코드 리뷰 중 3가지 UI 개선을 요청함.
(1) 퀴즈 상세 화면에 썸네일 URL을 입력해도 미리보기가 안 뜨던 문제 - 우측에 "다른 사람들에게 이렇게
보여요" 카드 추가(`QuizDetailCard.jsx` 재사용, 저장 전 `form` 상태를 실시간으로 반영). (2) 목록으로
돌아가는 길이 breadcrumb 텍스트 클릭뿐이라 발견성이 낮음 - `←` 아이콘 버튼을 breadcrumb 우측에 추가.
(3) 퀴즈 만들기 웹 UI(`editor.html`)에 테마 토글이 아예 없어 다크모드가 강제되던 문제 - `App.jsx`에
있던 `ThemeToggle`을 `ThemeToggle.jsx`로 분리해 두 진입점이 공유하도록 리팩터. 전부 프론트엔드 전용
수정(백엔드 무변경). 검증: 양쪽 `npm run build` 통과.

## 2026-08-11 — 퀴즈 만들기 웹 UI Phase 4(문제 CRUD REST + 프론트 문제 편집기), 같은 세션

`web_quiz_editor_routes.ts`에 문제(question) CRUD REST 4개 추가(전부 `requireQuizOwnership` 경유):
`POST /:quiz_id/questions`(최대 50개 체크→검증→생성), `PUT /:quiz_id/questions/:question_id`(partial
update, `question_id`가 실제 그 퀴즈 소속인지 `loadQuestionListFromDB()` 결과에서 재확인), `DELETE
/:quiz_id/questions/:question_id`(hard delete), `POST /:quiz_id/questions/:question_id/duplicate`
(`cloneDeep(source.data)`로 복제, 최대 50개 체크). 신규 헬퍼 `validateQuestionFields`/
`applyQuestionFields` — 후자는 `UserQuestionInfoUI`의 `applyQuestionInfo`/`applyQuestionAdditionalInfo`/
`applyQuestionAnsweringInfo` 3개를 단일 함수로 합친 버전으로, `is_partial` 플래그로 POST(전체 반영)/
PUT(body에 실린 필드만 반영)을 분기한다. `quiz_editor_validation.ts`(Phase 2)의
`parseAudioRangePoints`/`redefineRepeatCount`를 그대로 재사용 - 디스코드 쪽(`user-question-info-ui.ts`)은
Phase 2에서 이미 이 모듈을 쓰도록 리팩터돼 있어 이번 phase에서 전혀 안 건드림. DB에 문제 단건 조회
함수가 없어(`selectQuestionInfo`는 quiz_id 전체 조회만) 개수 체크/소속 확인 모두
`loadQuestionListFromDB()`로 매번 전체를 로드하는 방식 재사용(GET `/:quiz_id`와 동일 패턴).

프론트엔드: 신규 `web-frontend/src/editor/QuestionEditPage.jsx` — 디스코드 3모달(기본정보/힌트설정/
정답공개)을 탭 3개로 합친 단일 폼(승인된 `WEB_QUIZ_CREATION_UI_MOCKUP.html` 레이아웃 그대로 구현).
정답 유형은 세그먼트 버튼(주관식/OX/객관식) + 유형별 입력(주관식은 자유 텍스트, OX/객관식은 선택
버튼)으로 최종엔 전부 `answers` 문자열로 직렬화. 오디오 재생 시작/끝은 숫자 입력 2개로 받아 제출 시
`"40~80"` 형식 문자열로 합쳐 백엔드 `parseAudioRangePoints`가 그대로 파싱하게 함. 이미지는 `<img src>`
직접 표시(디스코드의 강제 재전송 워크어라운드 불필요 - 설계 결정), 오디오는 유튜브 링크 + `?t=<초>`로
미리듣기 대체(설계 결정, 새 스트리밍 엔드포인트 불필요). `cdn.discordapp.com` 경고는
`quiz_editor_validation.ts`가 CJS 백엔드 전용 모듈이라 이 독립 Vite/ESM 프로젝트에서 직접 import할 수
없어 한 줄 로직을 프론트에 그대로 복제해 타이핑 중 즉시 표시, URL 형식 유효성(`is_valid_*`)은 수정
모드에서 로드된 서버 스냅샷 값만 배지로 보여줌(저장 시점 기준, 실시간 재검증 없음). `EditorApi.js`에
문제 CRUD 클라이언트 4개 추가. `QuizDetailPage.jsx`의 "곧 추가될 예정이에요" placeholder를 실제
목록 패널로 교체 — 각 행에 수정/복제/삭제 버튼, "+ 새 문제 추가"/복제는 50개 도달 시 비활성화(프론트가
이미 글자수 제한처럼 `SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ` 값을 하드코딩 미러링하던 기존 관행 재사용),
삭제는 기존 퀴즈 삭제와 동일한 2클릭 확인. 복제는 정렬 특성(question_id 오름차순이라 새 문제가 항상
맨 뒤)상 낙관적으로 끼워넣지 않고 매번 `getMyQuizDetail`로 전체 재조회. `QuizEditorApp.jsx`에
`/quiz/:quizId/questions/new`, `/quiz/:quizId/questions/:questionId` 라우트 2개 추가. 기존
CSS 클래스(`tabrail`/`mode-switch`/`tag-chip`/`tree-row`/`icon-btn`/`switch-field`)만 재사용해 신규
CSS 추가 없음.

신규 `test/managers/web/web_quiz_editor_routes.test.js` 확장(10건 - 최대 개수 초과 400, 필수값 누락
400, 오디오 구간 파싱+`answer_type` 기본값 확인, partial update 시 미전송 필드 유지 확인, PUT/DELETE/
duplicate 소유권 위반 404, 삭제/복제 데이터 검증). 검증: `npx tsc --noEmit`/`npm run lint`(0 error)/
`npm test`(322 pass)/양쪽 `npm run build`/컴파일된 라우터 require 스모크 테스트 전부 통과. **미검증** —
실제 Discord+브라우저 테스트 전무, 다음 세션 최우선(`docs/TEST_CHECKLIST.md`에 항목 추가).
`docs/WEB_QUIZ_CREATION_PLAN.md`/`docs/ACTIVE_PLAN.md` B-5 갱신, 다음은 Phase 5(폴리시 + 통합 검증)부터.

## 2026-08-12 — 퀴즈 만들기 웹 UI Phase 4 UI 피드백 4건 반영, 같은 세션

사용자가 문제 목록/편집 화면을 직접 보고 승인된 Phase 0 목업(`docs/WEB_QUIZ_CREATION_UI_MOCKUP.html`)의
설계가 상당수 빠졌다고 지적: (1) 문제 목록 행이 단순 텍스트뿐이라 경계가 애매함, (2) 클릭으로 편집
화면 이동은 되지만 명시적 수정 버튼이 없음, (3) "1번 문제"식 표시만으로는 문제를 구별할 수 없음(목업엔
유형/내용 태그가 있었음 + 사용자 재확인 결과 필수 입력값인 `answers`(주관식 텍스트/OX/객관식 선택값)도
같이 보여줘야 함), (4) 문제 편집 화면에 있었던 "실제 디스코드에선 이렇게 보여요" 미리보기 패널이
통째로 빠짐. 마지막 항목은 Phase 4 계획 수립 당시 이 미리보기를 "Phase 0 데모 전용"으로 잘못
스코프아웃한 게 원인이었음(계획 오류를 사용자가 잡아준 것).

목업의 실제 JS(`renderQuestionEmbed`/`renderHintEmbed`/`renderAnswerEmbed`/`computeContentTags`/
`approximateAutoHint` 등)를 재독하고, 근거로 인용된 실제 코드(`quiz_system/lifecycle/question/
question.ts`의 `createQuestionUI`/`startProgressBar`, `correct_answer.ts`,
`config/text_contents.json`의 `quiz_play_ui`/`correct_answer_ui`/`icon.ICON_PROGRESS_*`/
`icon.ICON_CUSTOM_QUIZ`)까지 대조해 정확한 텍스트/색상/구조로 이식했다(단순 데모 근사치가 아니라
실제 코드 기준). 신규 `web-frontend/src/editor/questionDisplay.jsx` — `ANSWER_TYPE_LABEL`/
`computeContentTags`/`ContentTagChips`(문제별 내용 요약 칩, 목록 행과 편집 화면 상단 양쪽이 공유) +
`DiscordQuestionPreview`/`DiscordHintPreview`/`DiscordAnswerPreview`(탭 전환에 따라 문제 출제 중/힌트
공개/정답 공개 3가지 임베드 상태를 실시간 시뮬레이션, `approximateAutoHint`가 실제 `generateHint()`의
절반 마스킹 로직을 재현). `QuizDetailPage.jsx`의 문제 행을 테두리 있는 카드(`.question-row`)로
교체하고 제목(question_text, 없으면 안내 문구) + 유형 칩 + **"정답: {answers}" 칩**(필수 입력값 그대로
표시 — 사용자가 명확히 확인해준 요구사항) + 내용 칩을 붙였고, 클릭-편집은 유지하면서 ✏️/⧉/🗑
버튼도 명시적으로 추가. `QuestionEditPage.jsx`는 우측에 미리보기 패널(활성 탭 따라 전환)과 상단에
내용 요약 칩을 추가. `styles.css`에 `.question-row`/`.chip`/`.discord-frame`/`.df-*` 신규 - 디스코드
프리뷰는 앱 자체 테마와 무관하게 항상 같은 디스코드 다크 색상을 하드코딩(목업의 의도적 설계 유지).
검증: 양쪽 `npm run build` 통과(백엔드 무변경, 프론트엔드 전용 수정이라 `npm test`/`tsc`/`lint`
재실행 불필요). **미검증** — 실제 브라우저로 미리보기 정확도(특히 힌트 자동생성 마스킹) 확인 안 함.

## 2026-08-12 — 퀴즈 만들기 웹 UI Phase 4 UI 피드백 2차 9건 반영, 같은 세션

위 피드백 1차 반영을 사용자가 직접 화면으로 확인하고 준 9건의 후속 피드백.

1. **오디오 미리듣기 방식** — "유튜브에서 미리듣기" 새 탭 링크가 아니라 지정한 시작 지점부터 바로
   재생 가능한 UI를 요청. `questionDisplay.jsx`에 `extractYoutubeVideoId`(URL에서 11자 video id 추출,
   `youtu.be`/`watch?v=`/`embed`/`shorts` 전부 지원) + `YoutubeEmbed`(그 자리에
   `youtube.com/embed/<id>?start=<초>` iframe을 직접 띄움, autoplay는 안 함) 신설 — 기존 `AudioLink`
   완전 대체. Discord 미리보기 패널 안의 오디오도 동일하게 교체(목업이 "Phase 4 실제 웹에서는 이 자리에
   플레이어가 바로 삽입돼요"라고 예고했던 부분을 실제로 구현).
2. **문제 목록에서 문제 구별** — 답/문제텍스트/이미지/오디오 요약을 보여달라는 요청 + 요약이 생기면
   기존 "정답: 칩"은 중복이니 빼달라는 요청. `q-summary` 한 줄(정답 텍스트 40자 truncate + 이미지
   미니 썸네일 20x20 + 유튜브 썸네일 미니 아이콘)로 재설계, "정답: 칩" 제거(제목은 여전히
   question_text). 유형 칩(주관식/OX/객관식)은 유지 요청대로 그대로 둠.
3. **문제 검증 실패 표시** — URL 오입력 등 서버 검증 실패, *그리고* 새로 정의된 케이스(문제 텍스트/
   이미지/오디오가 전부 비어 문제 자체를 구별할 수 없는 경우 - 저장은 되지만 검증 실패로 취급)를 행
   배경색(`--red-bg`)으로 표시(`.question-row.has-error`).
4. **인증 마크(목록)** — 유저 퀴즈 선택 UI(`UserQuizTab.jsx`/`OmakaseTab.jsx`)와 동일한
   `<span className="thumb-badge verified">✓ 인증</span>`을 `QuizListPage.jsx` 그리드 카드에 추가.
5. **인증 마크(상세)** — `QuizDetailCard.jsx`(선택 플로우 3곳 + 편집 플로우 `QuizDetailPage.jsx`가
   전부 공유하는 컴포넌트)의 인증 표시가 제작자 텍스트 줄에 "· 인증된 퀴즈"로 섞여 있던 걸 목록 카드와
   동일한 썸네일 뱃지로 승격 — 공유 컴포넌트 수정 하나로 선택/편집 양쪽이 동시에 일관되게 맞춰짐(사용자가
   "동일하게 맞췄는지 검증해달라"고 요청한 부분이기도 함).
6. **정답 유형 전환 버그** — 주관식→OX→주관식으로 오가면 주관식 정답이 사라지던 것(의도하지 않은
   버그로 확인). `answerDrafts` state(유형별 마지막 입력값 저장)를 추가해 `selectAnswerType`이 전환
   직전 값을 저장하고 전환 대상 유형의 기존 draft를 복구하도록 수정.
7. **저장 후 화면 유지** — "저장이 습관화된 사람들은 자주 저장할 것"이라는 이유로, 저장해도 퀴즈 상세로
   안 돌아가고 이 화면에 머무르도록 변경("✓ 저장됨" 버튼 텍스트 플래시로 피드백). 새 문제는 저장 성공
   시 URL만 `/questions/:questionId`로 조용히 바뀌어(`navigate(..., {replace:true})`) 이후 저장부터
   PUT으로 전환되고, 매 저장마다 응답의 `data`로 폼을 재동기화(서버 정규화값 반영).
8. **문제 위치 표시** — breadcrumb에 `N/전체`(수정 모드) 또는 `N번째로 추가`(생성 모드) 칩 추가.
9. **이전/다음 문제 이동** — 저장 버튼 옆에 이전/다음 문제 버튼 추가(같은 퀴즈의 `question_id` 순서
   기준, 양 끝에서 자동 비활성화). 버튼이 늘어난 만큼 저장 버튼만 파란 `toolbar-cta`, 나머지는 신규
   `.btn-secondary`(중립색)로 시각 구분 — `.cta-primary`는 `width:100%` 고정이라 가로 버튼 로우에
   넣으면 레이아웃이 깨지는 기존에 이미 알려진 함정이라 안 씀.

전부 `web-frontend/src/editor/questionDisplay.jsx`(신규 헬퍼/컴포넌트 추가)·`QuizDetailPage.jsx`·
`QuestionEditPage.jsx`·`QuizListPage.jsx`·`QuizDetailCard.jsx`·`styles.css` 프론트엔드 전용 수정
(백엔드 무변경). 검증: 양쪽 `npm run build` 통과. **미검증** — 실제 브라우저 테스트 전무, 특히 유튜브
임베드 재생/인증 뱃지/이전·다음 이동은 다음 세션 최우선 확인 대상.

## 2026-08-12 — 퀴즈 만들기 웹 UI Phase 4 UI 피드백 3차 1건 반영, 같은 세션

2차 피드백에서 문제 목록 행의 "문제: 텍스트,이미지" 칩(`computeContentTags`의 `basic` 카테고리)을
q-summary 요약(답/이미지/오디오 미니 썸네일)과 중복이라 판단해 `ContentTagChips`의 `hideBasic` prop으로
숨겼는데, 힌트/정답 칩은 그대로 있으면서 문제 칩만 빠진 게 오히려 비일관적이라는 지적 — 예를 들어
`question_text`+`question_image_url`만 설정한 문제는 "힌트: -"/"정답: -" 칩 없이 "문제: 텍스트,이미지"
칩 하나만 있어야 정상인데 그게 안 보였음. `questionDisplay.jsx`의 `ContentTagChips`에서 `hideBasic`
prop을 완전히 제거(이제 쓰는 곳이 없어짐 - 도입한 지 한 세션 안에 되돌린 셈)하고 항상 세 카테고리
(문제/힌트/정답) 전부 표시하도록 원복. `QuizDetailPage.jsx`의 호출부(`<ContentTagChips tags={tags}
hideBasic />`)에서도 `hideBasic` 제거. 검증: `npm run build`(프론트엔드) 통과.

**세션 마무리 - Phase 5 인수인계 준비**: Phase 4(REST+프론트 구현, UI 피드백 3라운드)까지 이번 세션에서
전부 완료됐지만 실제 Discord 봇 + 브라우저로 단 한 번도 통합 테스트를 안 해봤다 — 다음 세션 최우선
과제. 상세 인수인계 프롬프트는 세션 종료 시 사용자에게 별도 전달.

## 2026-08-12 — 퀴즈 만들기 웹 UI Phase 3/4 실사용 검증 완료 (별도 세션)

바로 위 인수인계를 받아 진행. `npm run build`(백엔드) + `web-frontend`의 `npm run build` 후 실행 중이던
`dist/index.js`/`dist/quizbot/bot.js`를 재시작(taskkill 후 재기동, DB 연결/명령어 등록/admin 인스턴스
동기화까지 정상 확인 — 로그에 KOREANBOTS JWT 토큰 관련 에러가 있었지만 이는 무관한 기존 이슈로 봇
초기화 자체는 정상 완료됨). 이후 `docs/TEST_CHECKLIST.md` U섹션(Phase 3, 목록/생성/메타데이터/태그/
공개토글/삭제/문제목록표시/UI피드백3건)과 V섹션(Phase 4, 문제 추가/수정/삭제/복제/동기화/UI피드백
1·2차 총 13건)을 사용자와 함께 위에서부터 순서대로 실제 클릭해가며 전부 확인 — 전 항목 정상 동작.

**발견한 버그 1건 → 같은 세션에서 수정 완료**: 문제 편집 화면에서 정답 유형이 OX/객관식일 때 정답을
선택하지 않고 저장하면, 주관식(`<input required>`)과 달리 버튼 클릭 UI라 브라우저 필수값 검증이 걸리지
않아 요청이 그대로 서버까지 가고, 서버가 반환한 에러 코드 `invalid_answers`가 화면에 raw 문자열로 그대로
노출됨. `QuestionEditPage.jsx`의 `handleSave`에 제출 직전 `form.answers === ''` 체크를 추가해 "정답을
선택하거나 입력해주세요."라는 한글 안내로 대체(주관식에도 동일 체크가 적용되지만 기존 `required`가 이미
막고 있어 동작 변화 없음). 프론트엔드 전용 수정, 백엔드 무변경. `npm run build`(프론트엔드) 통과 후
사용자가 재검증까지 완료(더 이상 raw 에러 문자열이 안 뜸).

`docs/TEST_CHECKLIST.md` U/V 섹션 전체를 `[x]`로 갱신, `docs/ACTIVE_PLAN.md` B-5/`docs/
WEB_QUIZ_CREATION_PLAN.md` Phase 4 하단에 검증 완료 기록 반영. **다음 세션은 Phase 5(폴리시 + 통합
검증)부터** — 착수 전 플랜모드로 범위 정리 후 사용자 확인 필요.

## 2026-08-12 — 퀴즈 만들기 웹 UI Phase 5(폴리시 + 통합 검증) 완료, "퀴즈 만들기 웹 UI" 전체 마무리

바로 위 인수인계를 받아 플랜모드로 범위 정리(선택 기능 2개는 스킵, 2클러스터 검증은 지금 진행) 후 착수.

- **전체 회귀**: `tsc --noEmit`(0 error)/`lint`(0 error)/`test`(324 pass)/양쪽 `build` 전부 통과.
- **2클러스터 이상 강제 실행 환경 relay 검증**: `index.js`의 `ClusterManager` 설정을 임시로
  `shardsPerClusters:1, totalShards:2`로 바꿔 2클러스터 강제 기동. `web_session_manager.ts`(브로드캐스트
  시점)/`ipc_manager.ts`(클러스터별 수신)/`ui-system-core.ts`의 `relayWebSessionSignal`(로컬
  UIHolder 존재 여부)에 임시 디버그 로그 3곳을 추가해 실제 신호 흐름을 로그로 실측 — 같은 `scope_id`에
  대해 소유 클러스터는 `REACT`, 비소유 클러스터는 `DROP`으로 정확히 갈리는 것을 확인. 검증 후 디버그
  로그 3곳 제거(사용자 결정 - 매 이벤트마다 남는 상시 로그라 용량 부담), `index.js` 원래 설정으로
  원복 + 재시작.
- **GC 세션 만료 시나리오**: 웹 세션 열고 탭 닫아 heartbeat 중단 → 15분(`WEB_SESSION_EXPIRE_SEC=900`)
  이상 대기 → 디스코드 DM 잠금 화면이 자동으로 해제되는 것을 사용자가 직접 확인.
- **선택 기능 2개는 스킵**: `close_owner_session` 액션("웹에서 편집 완료" 버튼), "현재 편집 중" 실시간
  표시 — 둘 다 설계 문서에서도 선택 항목이었고 사용자가 이번엔 제외 결정. 필요해지면 별도 착수.

**Phase 5 검증 도중 사용자가 준 추가 피드백 3건 처리**:
1. **투트랙 선택 버튼 라벨 개선** — `/퀴즈`/`/퀴즈만들기` 최초 화면의 버튼이 숫자 `'1'`/`'2'`뿐이라
   임베드 description의 안내문을 먼저 읽어야 의미가 파악되던 문제. `base_components.ts`의
   `select_ui_mode_btn_component`(두 화면이 공유하는 컴포넌트) 라벨을 `'디스코드 UI'`/`'웹 UI'`로
   변경 — 한 곳 수정으로 양쪽 다 반영. `customId`는 그대로 유지해 `onInteractionCreate` 분기 로직
   무변경. `text_contents.json`의 description 중복 안내("1️⃣)/2️⃣)")도 같이 간소화. 사용자가 직접
   확인("바로보임").
2. **"권한 가져오기"(force_take) 레이스 버그 발견 + 수정** — 조사 결과 "새 토큰 발급" 자체는 이미
   구현돼 있었음(기존 토큰 파기 + 완전히 새 토큰 생성, 테스트로도 고정됨). 그런데 그 직후 예전
   소유자의 `UIHolder.free()`가 보내는 `{action:'release', guild_id}`가 어떤 토큰인지 확인 없이 "그
   길드에 지금 매핑된 토큰"을 지우는 방식이라, force_take가 막 발급한 새 토큰을 곧바로 무효화하는
   레이스가 있었음(코드 조사로 발견, 실제 프로덕션에서 이 경합을 겪었는지는 불명). `web_session_
   manager.ts`의 `releaseSession(guild_id, expected_token?)`에 토큰 일치 검사 추가 —
   `UIHolder.free()`가 `this.ui?.token`을 같이 넘기고, 이미 다른 토큰으로 교체됐으면 조용히 무시.
   `token`을 안 넘기는 기존 호출부(`handleStartQuiz` 등)는 그대로 무조건 파기(하위호환). 레이스를
   재현하는 회귀 테스트 2건 추가(`test/managers/web/web_session_manager.test.js`, 총 22건 pass).
3. **서버 설정 화면 권한 검증 누락 발견** — 조사 중 디스코드 쪽 서버 설정 화면(`server-setting-ui.ts`)에
   권한 체크가 전혀 없어 서버의 아무나 옵션을 바꿀 수 있다는 걸 발견(사용자도 "처음 알았다"). 이건
   범위가 달라(버그 수정이 아니라 이 프로젝트에 없던 "서버 관리 권한" 개념을 처음 도입하는 작업) 이번엔
   고치지 않고 다음 세션으로 이월 — 아래 신규 계획 문서 참고.

**"퀴즈 만들기 웹 UI"(Phase 0~5) 전체 완료.** `docs/ACTIVE_PLAN.md` B-5 항목을 완료 처리하고 B-6(잔여
3건 - 서버 설정 권한 검증 + 나머지 화면 웹 포팅)을 신설, 상세 계획은 `docs/
WEB_UI_REMAINING_SCREENS_PLAN.md`(신규)에 분리.

## 2026-08-12 — 나머지 디스코드 전용 화면(안내/공지사항/서버 설정) 웹 포팅 완료 (B-6, 같은 세션)

`docs/WEB_UI_REMAINING_SCREENS_PLAN.md`가 정리해둔 "착수 전 결정 필요 사항" 5개를 플랜모드로 전부
확정: **권한 체크는 추가하지 않음**(서버 설정을 아무 서버원이나 바꿀 수 있는 건 버그가 아니라 의도된
기존 동작 — 사용자 확인, 디스코드/웹 둘 다 그대로 유지), **패치노트 탭은 스코프 아웃**(더 이상 안
씀, 공지사항만 유지), **DB 쿼리는 웹 전용 함수를 새로 파라미터화**(기존 `db_option.ts`는 무변경),
**진입점은 기존 "퀴즈 선택 웹"(App.jsx)에 네비게이션 추가**(새 URL/탭 없음).

신규 `quizbot/managers/notice_manager.ts`(`loadNoticeList`/`readNoticeFile`, `note-select-ui.ts`/
`note-ui.ts`의 파일 읽기 로직을 순수 함수로 추출 — `quiz_editor_validation.ts`와 동일 관례, 디스코드
UI가 이 함수들을 호출하도록 순수 이관). `db_option.ts`에 `updateOptionParameterized`(서버 설정
웹 API 전용, `$n` 플레이스홀더 — 기존 `selectOption`/`updateOption`은 무변경). `web_express_app.ts`에
신규 라우트 5개(`GET /api/quiz-tool-guide`, `GET /api/notices`, `GET /api/notices/:name`,
`GET`/`PUT /api/server-option`) + `requireGuildScopedSession` 미들웨어(`requireOwnerScopedSession`과
대칭). 서버 설정 PUT은 `text_contents.json`의 `select_menu.option_values`를 화이트리스트로 값을
검증한 뒤 디스코드 UI와 **같은 `OptionStorage` 메모리 캐시**를 직접 갱신 — 웹에서 바꾸면 디스코드
쪽도 즉시 같은 값을 보게 된다. 프론트엔드: `web-frontend/src/GuidePanel.jsx`/`NoticesPanel.jsx`/
`ServerSettingPanel.jsx` 신설, `App.jsx`에 헤더 드롭다운 메뉴(`utilityPanel` state)로 통합(퀴즈 탭
4개와 성격이 달라 `tabrail`엔 안 넣음). 신규 순수 함수(`notice_manager.ts`)/REST 통합 테스트
(`web_express_app.test.js`) 추가, `db_manager.test.js`의 재수출 개수 골든 테스트(35→36) 갱신. 검증:
`tsc --noEmit`(0 error)/`lint`(0 error)/`test`(336 pass)/양쪽 `build` 전부 통과. **미검증** — 실제
Discord+브라우저 테스트 전무(3화면 전부), 다음 세션 최우선.

**같은 세션, 사용자 리뷰로 발견한 버그 수정**: `PUT /api/server-option`이 `db_manager.
updateOptionParameterized(...)`를 그냥 `await`만 하고 결과값을 안 보고 항상 `success:true`를
반환하고 있었음 — `db_core.sendQuery`는 연결 실패/쿼리 에러를 던지지 않고 조용히 `undefined`만
반환하므로(`db_core.ts`), DB 저장이 실제로 실패해도 API는 성공으로 응답하고 있었다. 디스코드 쪽
`server-setting-ui.ts`의 `handleSaveOption`이 이미 쓰던 대로(`result !== undefined`로 성공/실패
판정) 응답의 `success` 필드를 실제 결과 기준으로 고침. 프론트엔드도 저장 버튼 라벨을 1.5초 반짝이는
것만으로 성공 여부를 알리던 걸 `success-banner`/`error-banner`(신규 CSS, `.error-banner`와 대칭)로
명확하게 구분해서 보여주도록 개선. 회귀 테스트 1건 추가(DB 실패 mock 시 `success:false` 확인), 기존
성공 테스트의 mock이 `undefined`를 반환해 새 로직에서 `success:false`로 잘못 걸리던 것도 같이 수정.
검증: `tsc --noEmit`/`lint`(0 error)/`test`(337 pass)/양쪽 `build` 전부 통과.

**같은 세션, 발견성 개선(사용자 피드백)**: "☰" 아이콘 하나뿐이던 헤더 메뉴 버튼이라 서버 설정/공지사항의
존재를 알아채기 힘들다는 지적 — 제시한 개선안 4개 중 "라벨 추가"(저비용)와 "공지사항 안 읽음 배지"
조합을 선택. 버튼을 `.icon-btn`(정사각형 아이콘 전용) 대신 신규 `.menu-trigger`(라벨 포함, "☰ 더보기")로
교체. 공지사항 배지는 `localStorage`(`quizbot_web_last_seen_notice_mtime`)에 마지막으로 확인한 공지의
mtime을 저장해, `GET /api/notices` 응답의 최신 mtime과 비교해 트리거 버튼 + 드롭다운의 "📢 공지사항"
항목 양쪽에 빨간 점을 띄운다. 처음 방문한 브라우저는 저장값이 없어 전부 "안 읽음"으로 취급(흔한 관례).
"📢 공지사항"을 클릭하는 순간 `localStorage`를 갱신하고 배지를 지움 — 신규 서버 API 없이 프론트엔드
로컬 상태만으로 구현. 백엔드 무변경, 검증: `npm run build`(프론트엔드) 통과.

## 2026-08-12 — 문제 미리보기 마크다운 지원 + 웹 API 보안 점검 완료 (B-7, 별도 세션)

인수인계 문서(`docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md`)의 조사 결과를 재조사 없이 바로
착수. 착수 전 rate limit 스코프(전체 API vs 쓰기 전용, 토큰 vs IP)와 작업 순서만 사용자에게 확인
(계층형 - 조회 느슨/쓰기 빡빡, 토큰 우선+세션 없는 요청은 IP 폴백, 마크다운 먼저).

**작업 1(마크다운 미리보기)**: `web-frontend/src/editor/questionDisplay.jsx`의 `DiscordQuestionPreview`/
`DiscordHintPreview`/`DiscordAnswerPreview` 3곳에 `react-markdown`+`remark-breaks`(신규 의존성 -
단일 개행도 디스코드처럼 줄바꿈되게) 적용. 문제 텍스트는 블록, 힌트/정답은 고정 문구 사이에 인라인으로
섞여야 해서 `<p>`를 Fragment로 치환하는 `INLINE_MARKDOWN_COMPONENTS`로 분리 처리. 힌트는 자동 생성된
경우(`isAuto`) 마크다운 적용 대상에서 제외(◼로 가린 정답이라 서식 대상이 아님). 신규 CSS `.df-markdown`
(`styles.css`)은 기존 `.markdown-desc`와 달리 앱 라이트/다크 테마 변수를 쓰지 않고 `color: inherit`로
디스코드 다크 하드코딩 색을 그대로 물려받음(주변 `.discord-frame` 계열과 동일 원칙).

**작업 2(웹 API 보안 점검)**: 문서의 우선순위 체크리스트를 그대로 진행.
1. **Rate limiting 신규 도입**(`quizbot/managers/web/web_rate_limit.ts`, `express-rate-limit`) -
   `/api/*`+`/health`에 계층형 적용(정적 자산 제외). 처음엔 문서 제안대로 고정 윈도우 250ms/1회(조회),
   1000ms/1회(쓰기)로 구현했다가 기존 통합 테스트 다수(트리 조회 직후 세션 재확인, "확정 후 바로
   재선택" 등 정상적인 순차/버스트 호출)가 깨지는 걸 발견 — 평균 처리량은 유지하되 윈도우를 1초로 넓혀
   짧은 버스트를 허용하도록 조정(조회 1000ms/4회, 쓰기 1000ms/3회). 키는 세션 토큰 우선, 토큰 없는
   요청/무효 토큰은 IP로 폴백(`ipKeyGenerator` 사용, IPv6 정규화). 유닛테스트 4건 신규
   (`test/managers/web/web_rate_limit.test.js`).
2. **IDOR 라이브 검증** - 코드 리뷰로는 이미 안전 확인됨(SQL 레벨 소유권 강제). 기존 회귀 테스트는
   `selectOwnedQuizInfoById`를 무조건 빈 배열로 mock해서 "404가 나온다"만 확인하던 것을, 서로 다른
   두 세션(owner_A/owner_B)을 실제로 만들고 mock이 creator_id를 비교하게 해 교차 접근을 더 사실적으로
   재현하는 테스트 2건(PUT/DELETE) 추가.
3. **백엔드 검증 구멍 2개 수정**(`web_quiz_editor_routes.ts`) - `answer_type` 화이트리스트 체크 추가,
   `validateQuizMetadata`/`validateQuestionFields`가 `typeof === 'string'`일 때만 길이를 검사해
   비문자열(객체/배열/숫자) 입력이 검증을 통째로 건너뛰던 문제 수정(`answers` 필드는 타입 체크 없이
   `.trim()`을 호출해 TypeError로 요청이 죽을 수 있는 경로였음 - 가장 심각했던 구멍).
4. **SQL 하드닝** - `db_quiz.ts`의 `updateQuizInfo`/`updateQuestionInfo`가 `quiz_id`/`question_id`를
   쿼리 문자열에 직접 보간하던 걸 `$n` 플레이스홀더로 교체(실익은 없었지만 방어적 코드로 정리).

검증: `tsc --noEmit`(0 error)/`lint`(0 error)/`test`(343 pass)/양쪽 `build` 전부 통과. 실제
Discord+브라우저 재검증은 안 함(보안 점검이라 코드/테스트 레벨 검증이 핵심, UI 변경은 마크다운 렌더링
뿐이라 낮은 리스크로 판단).

## 2026-08-12 — 웹 API 보안 점검 심화 재조사, 실제 SQL 인젝션 1건 발견+수정 (B-7 추가, 같은 세션)

위 B-7 완료 직후 사용자가 "모든 API CALL이 정말 안전한거 맞지?"라고 재확인 요청 — 원래 조사 스코프
(`/api/my-quizzes`, 퀴즈 편집 API)만 믿지 않고 웹에서 도달 가능한 모든 라우트(`web_express_app.ts`
전체)를 그 데이터가 최종적으로 어디서 쓰이는지까지 따라가며 재검토했다.

**[심각] SQL 인젝션 발견+수정**: `POST /api/session/confirm`(mode:omakase/multiplayer)의
`basket_items`가 서버 검증 없이 그대로 브로드캐스트→`quiz_info`에 저장됐다가, 퀴즈가 실제 시작될 때
(`quiz_system/lifecycle/initialize.ts`의 `OmakaseQuizInitialize`, 장바구니 모드)
`db_quiz.ts`의 `selectRandomQuestionListByBasket`이 각 `basket_item.quiz_id`를 문자열로 이어붙여
`WHERE quiz_id IN ${...}`에 그대로 삽입하는 지점까지 도달할 수 있었음. 디스코드 전용이던 시절엔
이 값이 항상 DB에서 읽은 실제 정수로만 채워져 무해했지만(기존 회귀 테스트도 이 "문자열 그대로 삽입"
동작을 정상으로 간주해 고정하고 있었음), 웹 API가 이 필드를 검증 없이 그대로 받게 되면서 UI를 거치지
않고 직접 API를 호출하면 임의 SQL을 흘려보낼 수 있는 실제 취약점이 됐던 것. 수정: (1)
`selectRandomQuestionListByBasket`을 `quiz_id_list: number[]`를 받아 `WHERE quiz_id =
ANY($1::int[])`로 파라미터화, (2) `user_quiz_info_manager.ts`의 `loadQuestionListByBasket`도 배열을
그대로 전달하도록 시그니처 변경, (3) `initialize.ts`의 `OmakaseQuizInitialize`에서 실제 SQL 호출
직전 `parseInt`+`Number.isInteger`로 정수만 필터링(호출부 방어까지 이중으로). 회귀 테스트: 기존
`db_manager.test.js`의 "문자열 그대로 삽입" 테스트를 파라미터화 검증으로 교체, `user_quiz_info_manager
.test.js`에 빈 배열 short-circuit + 배열 그대로 전달 테스트 2건 신규.

**[경미] 미검증 텍스트가 공유 embed에 반영되던 문제도 같이 수정**: `POST /api/session/select`
(진행 중 선택 미리보기)의 `title`이 길이 검증 없이 `WebHandoffUI.refreshLockedEmbed()`를 통해 그
길드의 공유 잠금 화면 embed에 그대로 꽂히고 있었음 — UI 없이 직접 호출하면 임의 길이 문자열로 embed를
깨뜨리거나 다른 길드원에게 스팸성 텍스트를 노출시킬 수 있었던 지점. 표시 직전 60자로 자르도록 수정
(`quiz_ui/web-handoff-ui.ts`).

**Rate limit 수치도 완화**: 사용자가 처음 도입한 값(조회 1초당 4회/쓰기 1초당 3회)이 실사용 기준
너무 빡빡하다고 판단 — 조회 1초당 10회/쓰기 1초당 8회로 완화(`web_rate_limit.ts`, 유닛테스트
`web_rate_limit.test.js`도 새 수치로 갱신).

검증: `tsc --noEmit`(0 error)/`lint`(0 error)/`test`(345 pass)/양쪽 `build` 전부 통과. **미검증** —
오마카세/멀티플레이 장바구니 모드는 이번에 SQL 호출 방식(문자열 조립 → 파라미터화 배열)이 실제로
바뀌었으니 다음 세션에 실제 Discord에서 한 번 플레이해서 정상 동작하는지 확인 권장
(`docs/TEST_CHECKLIST.md` Y 섹션).
