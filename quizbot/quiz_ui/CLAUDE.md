# quizbot/quiz_ui/

Discord UI 화면들. `components/`(→ `components/CLAUDE.md`)에 버튼/모달/셀렉트메뉴 정의가 있고, 이 디렉터리 파일들은 그 컴포넌트를 조합한 화면(embed+components) 클래스.

## 프레임워크 (`common-ui.js`, `ui-system-core.js`)

- 모든 화면은 `QuizbotUI`(단순 메뉴) 또는 `QuizBotControlComponentUI`(페이지네이션 있는 목록, `prev`/`next`/`request_modal_page_jump` 처리 내장) 상속.
- `onInteractionCreate(interaction)`가 `new SomeUI(...)`를 반환하면 자동으로 화면 전환 + 이전 화면이 `prev_ui_stack`에 쌓임(뒤로가기용). `this`를 반환하면 같은 화면 유지하며 `update()`만. `undefined`면 아무 것도 안 함.
- `'back'` customId(컴포넌트: `only_back_comp`)는 `UIHolder`가 전역으로 가로채 자동 처리 — 개별 화면이 구현할 필요 없음.
- `UIHolder`: `UI_HOLDER_TYPE.PUBLIC`(길드 채널, `holder_id=guild_id`) / `PRIVATE`(DM, `holder_id=user_id`). `ui-system-core.js`의 `createXXXUIHolder` 함수들이 진입점(`createMainUIHolder`/`createQuizToolUIHolder`/`createAdminPanelUIHolder`).
- `onAwaked()`: 자식 화면에서 뒤로가기로 돌아왔을 때 호출됨(선택 개수/태그 텍스트 재계산 등에 씀).

## 진입/관리자 (직접 다뤄본 파일)

- **`main-ui.js`** — 메인 메뉴(`MainUI`). 죽은 코드였던 `loadVersionInfo()`(설정에서 이미 비활성화된 기능)는 삭제됨.
- **`quiz-tool-guide-ui.js`** — "퀴즈 만들기" 안내 화면, 정적 안내문 + 뒤로가기만.
- **`note-select-ui.js`** — 공지/패치노트 목록.
- **`user-quiz-list-ui.js`** — 내 퀴즈 목록(`UserQuizListUI`). 생성자 2번째 인자 `show_all_quizzes`(기본 false) — true면 전체 유저 퀴즈 조회(관리자 패널 전용). `/퀴즈만들기`(`createQuizToolUIHolder`)는 항상 false로 호출되므로 어드민도 이제 자기 퀴즈만 봄.
- **`user-quiz-info.ui.js`** — 유저 퀴즈 상세/편집(`UserQuizInfoUI`). 삭제 버튼이 `interaction.user.id === PRIVATE_CONFIG.ADMIN_ID` 여부로 `quiz_delete_confirm_comp`(일반, 2버튼) vs `quiz_delete_confirm_admin_comp`(관리자, 3버튼: 취소/삭제/삭제+영구밴) 분기.
- **`multiplayer-quiz-select-ui.js`** — 멀티플레이 로비 생성/참가 진입점. `checkMultiplayerBan`이 `ban_manager.isBanned(...)`로 위임.
- **`admin-panel-ui.js`**/**`admin-ban-list-ui.js`** — `/quizmgr` 관리자 패널(밴 목록 관리/신고처리/퀴즈 관리). 다른 유저는 절대 접근 불가하도록 다층 방어(루트 `CLAUDE.md`의 "관리자 전용 기능" 참고).

## 그 외 화면 (탐색 결과 요약)

**퀴즈 선택/시작 흐름**
- **`select-quiz-type-ui.js`** — "개발자 퀴즈/유저 제작 퀴즈/오마카세 퀴즈" 선택 (main-ui의 '3'번에서 진입).
- **`dev-quiz-select-ui.js`** — 공식 퀴즈 폴더 트리 브라우저. `static resource_path`/`quiz_contents_sorted_by_name`이 **클래스 정의 시점에 한 번만** 로드됨 — 실행 중 파일 추가해도 재시작 전까진 안 보임.
- **`dev-quiz-info-ui.js`** — `QuizInfoUI`를 감싸기만 하는 얇은 래퍼(`DevQuizInfoUI`).
- **`omakase-quiz-room-ui.js`** — 로컬(비-멀티) 오마카세 퀴즈 설정방. 태그/장바구니 모드 지원(`QuizInfoUI`의 no-op을 오버라이드).
- **`multiplayer-quiz-lobby-ui.js`** — 멀티플레이 로비(IPC 기반, 가장 복잡). `CLIENT_SIGNAL`/`SERVER_SIGNAL` 송수신. 60초마다 메시지 신선도 체크(`checkNeedToRefresh`, 10분 넘으면 강제 재전송 — Discord 인터랙션 토큰 만료 대응). `requestKick`에 `selected_value > this.participant_guilds_info`(문자열-배열 비교, 항상 false인 죽은 검증)로 보이는 버그 있음.
- **`quiz-info-ui.js`** — `DevQuizInfoUI`/`OmakaseQuizRoomUI`/`MultiplayerQuizLobbyUI` 공통 베이스(`QuizInfoUI`). 시작/설정/태그선택/바구니 버튼 핸들러 맵이 여기 있음 — 새 퀴즈 설정 화면 만들 때 여기부터 볼 것. `scoreboard` 버튼 핸들러는 **TODO 빈 껍데기**(실제 스코어보드는 `multiplayer-quiz-select-ui.js`에서 별도 진입). `BASKET_CACHE`(static, 길드별 장바구니 캐시, 서버 재시작 시 초기화)를 `OmakaseQuizRoomUI`/`MultiplayerQuizLobbyUI`와 공유.
- **`user-quiz-select-ui.js`** — 유저 퀴즈 목록/검색/정렬 + 장바구니 담기 모드(생성자에 `basket_items` 넘기면 담기 모드로 전환). `onReady()`에서 전체 유저 퀴즈를 한 번에(`loadUserQuizListFromDB(undefined)`) 불러와 클라이언트 사이드에서 필터/정렬.
- **`user-question-info-ui.js`** — 유저 퀴즈의 문제 편집기. **파일 자체 주석: "건드릴 엄두가 안난다... 우선 돌아가면 장땡"** — 조심해서 다룰 것. 문제 최대 50개 제한. 이미지 URL 변경 시 `update()` 대신 강제 재전송(`sendDelayedUI(this, true)`) — Discord embed edit이 새 이미지 URL을 바로 안 불러오는 문제 우회. `duplicateQuestion`(B-3', 2026-08-07)은 현재 문제를 복사해 바로 다음 위치에 삽입. `sendAudioPreview`(B-2, 2026-08-07)는 미리듣기 버튼 핸들러 — `updatePrivateUI()`(카드 edit) 대신 `interaction.reply({files, flags: Ephemeral})`로 직접 응답(B-2-1 "새 메시지 금지" 방침의 명시적 예외, 상세는 `docs/TS_MIGRATION_AND_CONVENIENCE_PLAN.md` B-2 섹션 참고).
- **`alert-quiz-start-ui.js`** — "퀴즈 시작합니다" 안내(정적, 인터랙션 없음). 모든 퀴즈 시작 경로의 종착점.
- **`scoreboard-ui.js`** — 서버별/글로벌 랭킹. `db_manager.selectGlobalScoreboard`/`selectTop10Scoreboard` 사용. 제목에 "베타 시즌"이 하드코딩돼 있음.
- **`server-setting-ui.js`** — 서버 옵션 편집. `quiz_option.js`의 `OptionStorage`를 **클론해서** 편집하다가 "저장" 버튼을 눌러야 커밋됨 — 저장 안 하고 나가면 변경사항 사라짐(의도된 동작).
- **`note-ui.js`** — 공지/패치노트 본문(동기 `fs.readFileSync`로 즉시 읽음, try/catch 없음).

## 화면 이동 그래프 (요약)

```
MainUI ─┬─ SelectQuizTypeUI ─┬─ DevQuizSelectUI ──(트리 재귀)──┬─ DevQuizInfoUI
        │                    │                                 └─ DevQuizSelectUI(하위)
        │                    ├─ UserQuizSelectUI(브라우징) ─── UserQuizInfoUI ── UserQuestionInfoUI
        │                    └─ OmakaseQuizRoomUI ── (바구니모드) UserQuizSelectUI(담기모드)
        └─ ServerSettingUI

MultiplayerQuizSelectUI ─┬─ MultiplayerQuizLobbyUI ── (바구니모드) UserQuizSelectUI(담기모드)
                         └─ ScoreboardUI

QuizInfoUI 계열(Dev/Omakase/MultiplayerLobby 공통) 'start' → AlertQuizStartUI
NoteSelectUI → NoteUI
AdminPanelUI ─┬─ AdminBanListUI
              ├─ (신고처리, sendReportLog 직접 호출)
              └─ UserQuizListUI(show_all_quizzes=true)
```
