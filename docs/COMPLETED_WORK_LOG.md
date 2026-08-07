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

## 2026-08-07 — 문서 구조 정리

루트에 흩어져 있던 계획서/로그 문서 13개를 `docs/`로 이동(`git mv`), 루트 및 하위 5개 `CLAUDE.md`의
참조 경로 갱신. `docs/ACTIVE_PLAN.md`(이 문서의 짝)와 `docs/COMPLETED_WORK_LOG.md`(이 문서)를 신설해
여러 계획서에 흩어진 완료/미완료 상태를 한 곳에서 훑어볼 수 있게 함.
