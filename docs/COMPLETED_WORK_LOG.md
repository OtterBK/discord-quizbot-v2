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

## 2026-08-07 — 문서 구조 정리

루트에 흩어져 있던 계획서/로그 문서 13개를 `docs/`로 이동(`git mv`), 루트 및 하위 5개 `CLAUDE.md`의
참조 경로 갱신. `docs/ACTIVE_PLAN.md`(이 문서의 짝)와 `docs/COMPLETED_WORK_LOG.md`(이 문서)를 신설해
여러 계획서에 흩어진 완료/미완료 상태를 한 곳에서 훑어볼 수 있게 함.
