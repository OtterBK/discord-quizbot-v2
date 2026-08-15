# quizbot/managers/report/

`report_manager.js`(상위 디렉터리)가 이 폴더 전체를 조합하는 얇은 facade — 원본에서 노출하던 `initialize(client)`/`checkReportEvent(interaction)` 두 개만 재수출함. 원본은 819줄짜리 `report_manager.js` 하나였고, 원본 파일 안의 8개 `/** ... */` 주석 구획을 그대로 파일 경계로 승격시켜 분리됨.

## 흐름

1. 유저가 채팅 메시지에 신고 버튼(`chat_report_...`)을 누름 → **`report_submission.js`**(`requestReportChatModal`)가 모달을 띄움 → 제출되면(`submitReportChatModal`) `chat_cache.js`에 캐싱해둔 채팅 원문과 함께 DB에 저장.
2. 관리자가 `/quizmgr` 관리자 패널의 "신고처리" 버튼을 클릭(2026-08-14부터 유일한 진입점 — 원래 있던 `/신고처리` 슬래시커맨드는 `/quizmgr`로 진입 경로가 통합되면서 삭제됨, `docs/archive/DEPRECATED_CODE_REMOVED.md` 참고) → **`report_manual_processing.js`**(`sendReportLog`)가 최근 신고 목록을 DM으로 보냄 → 항목별 "처벌"/"반려" 버튼(`processReportLog`) → 밴 시 후속 조치 버튼(취소/추가처벌/길드밴, `processFollowUpAction`).
3. `auto_report_processing.js`가 3분마다 주기적으로 미처리 신고를 훑어 욕설 필터(`utility/profanity_checker.js`)에 걸리면 자동으로 밴 처리.
4. **`report_processing_core.js`**의 `processReportCore`/`applyBan`/`sendProcessedBanResult`/`notifyProcessedReportLog`/`notifyBannedUser`는 수동(2번)과 자동(3번) 양쪽에서 공통으로 쓰이는 핵심 로직. `notifyBannedUser`(B-4, 2026-08-07 신설)는 밴 당사자에게 정지 사유(원문)+총 정지 횟수+만료일(취소 시 "취소되었습니다") DM을 보냄 — 최초 처벌(`report_manual_processing.js`의 `processReportLog`)/후속 취소·추가처벌(`processFollowUpAction`)/자동 처리(`auto_report_processing.js`) 세 지점 모두에서 호출.
5. **`report_event_dispatch.js`**의 `checkReportEvent`가 customId 패턴(`chat_report_*`, `ps_rpt_*`, `ps_flwup_*`)으로 위 흐름들을 라우팅.

## 파일별 요약

- **`report_state.js`** — 원본에서 모듈 최상위 변수였던 `bot_client`를 여러 파일이 공유해야 해서 뺀 것. `setClient(client)`/`getClient()`만 있음. `bot.js`에서 `report_manager.initialize(client)` 호출 시 채워짐.
- **`chat_cache.js`** — `chat_content_cache`(신고 접수 시 채팅 원문 임시 보관, 5분 TTL). `cleanUpChatCache`가 1분마다 정리. **주의**: `insertChatCache`가 이미 캐시된 chat_id에 대해 `cached_time`을 갱신 못하던 버그가 있었는데 수정됨(`docs/archive/BUGS_FOUND.md` Phase 5 — 원본에는 없던 `'use strict'`를 실수로 붙였다가 sloppy-mode에서 조용히 무시되던 버그가 표면화되며 발견함).
- **`report_chat_info.js`** — `getChatId`/`extractChatInfo`(chat_id 포맷은 `"guild_id-user_id-timestamp"`), `CHAT_INFO_COLUMN`/`REPORT_INFO_COLUMN`(DB 컬럼 목록), `REPORT_PROCESSED_RESULT_TYPE`(`IN_PROGRESS`/`BANNED`/`DENY`)/`FOLLOWUP_PROCESSED_RESULT_TYPE`(`IN_PROGRESS`/`UNBANNED`/`BANNED`/`GUILD_BANNED`) enum.
- **`report_submission.js`** — 유저가 신고 버튼을 누르는 흐름(`requestReportChatModal`/`submitReportChatModal`).
- **`report_processing_core.js`** — 신고 처리 핵심(밴 적용, DB 반영, 알림 발송). 수동/자동 양쪽의 공통 의존.
- **`report_manual_processing.js`** — 관리자가 직접 검토/처벌하는 흐름. `applyGuildBan`이 `ban_manager.banId(guild_id)`로 위임(원래는 이 파일에서 직접 `BANNED_USER_PATH`를 읽고 쓰는 중복 로직이었는데 `ban_manager.js`로 통합됨). `processFollowUpAction`(취소/추가처벌)은 `db_manager.selectChatInfoById(chat_id)`(B-4, 2026-08-07 신설, `db_report.ts`)로 원문 채팅 내용을 재조회해 `notifyBannedUser`에 넘김 — 이 시점엔 신고 로그(`tb_report_info`)가 이미 삭제된 상태라 `tb_chat_info`(처리 후에도 row가 남음)에서 다시 가져와야 함. `sendReportLog`(2026-08-15 수정)는 함수 맨 앞에서 동기적으로 `interaction.explicit_replied = true`를 세움 — DB 조회 `await` 전에 이걸 안 세우면 `bot.js` 전역 fallback이 먼저 `deferUpdate()`로 선점해버려서 나중에 `interaction.reply()`를 호출할 때 "Interaction has already been acknowledged" 에러가 남(`user-question-info-ui.ts`의 `duplicateQuestion`과 동일 패턴). 이 함수의 모든 종료 경로는 `interaction.reply()`로 응답해야 함(예전엔 두 실패 분기가 `user.send()`만 호출해서 사실상 인터랙션에 무응답이었음).
- **`auto_report_processing.js`** — `utility/profanity_checker.js` 기반 자동 밴, 180초 주기.
- **`report_event_dispatch.js`** — customId 기반 디스패처. `isReportChatButton`/`isReportChatModal`/`isReportProcessButton`/`isFollowUpProcessButton` 판별 함수들은 export되지 않고 이 파일 내부에서만 쓰임(`isReportManageCommand`는 `/신고처리` 커맨드와 함께 2026-08-14 삭제됨).
