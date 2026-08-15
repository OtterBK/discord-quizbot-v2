# discord-quizbot-v2

한국어 Discord 퀴즈봇. 수년째 혼자 개발/운영 중인 프로덕션 봇으로, 최근 무중단 안정 운영 중. 2026-08에 대규모 구조 리팩터(`docs/plans/REFACTOR_PLAN.md`)를 거쳤다.

## 기술 스택

- Node.js (CommonJS, `require`/`module.exports` — ESM 아님)
- `discord.js` + `discord-hybrid-sharding` (멀티 클러스터, `index.js`가 마스터/샤드매니저 프로세스, `quizbot/bot.js`가 클러스터 자식 프로세스)
- PostgreSQL (`pg`, `quizbot/managers/db/`)
- 노래 맞추기 퀴즈: `youtube-dl-exec`(yt-dlp) + `fluent-ffmpeg` + `@discordjs/voice`
- `custom_node_modules/` — `@discordjs/voice`/`ytdl-core`/`play-dl`을 **직접 패치**해서 씀 (seek/duration 지원 등). 여기 건드릴 때 특히 주의.
- 테스트: Node 내장 `node:test` + `node:assert/strict` (별도 프레임워크 없음)
- 린트: `eslint.config.js` (flat config) — 기존 코드 관행을 규칙으로 고정한 것, 새 스타일 강제 아님

## 디렉터리 지도

```
index.js                    샤드매니저(마스터) 진입점
quizbot/
  bot.js                     클러스터 자식 프로세스 진입점 - 슬래시커맨드 dispatch, 매니저 초기화 시퀀스
  managers/                  비즈니스 로직 서비스 (거의 다 싱글턴 모듈 + initialize()) → 상세: managers/CLAUDE.md
    db/                      DB 쿼리 (db_manager.js가 facade) → db/CLAUDE.md
    report/                  신고 처리 (report_manager.js가 facade) → report/CLAUDE.md
  quiz_system/               State 패턴 퀴즈 진행 엔진 (원래 5,959줄짜리 quiz_system.js 하나였음) → quiz_system/CLAUDE.md
  quiz_ui/                   디스코드 UI 화면들 (embed+버튼/셀렉트메뉴) → quiz_ui/CLAUDE.md, components/ 하위 컴포넌트 정의는 quiz_ui/components/CLAUDE.md
  quiz_option/               서버별 옵션 로직 → quiz_option/CLAUDE.md
utility/                     범용 유틸 (utility.js가 facade, util/ 하위에 도메인별 분리) → utility/CLAUDE.md
config/                      공개 설정 + 비밀 설정 → config/CLAUDE.md
  private_config.json        **비밀** (봇 토큰, DB 접속정보, ADMIN_ID) - gitignore 대상, 절대 커밋 금지
  text_contents.json         언어별 UI 문구
test/                        quizbot/utility 구조를 그대로 미러링한 node:test 스위트
resources/                   퀴즈 데이터, 오디오 캐시, BGM, banned_user.txt 등 런타임 리소스
web-frontend/                퀴즈 선택 웹 연동 프론트엔드(React+Vite, 독립 프로젝트, 별도 package.json) →
                              docs/plans/WEB_INTEGRATION_PLAN.md. tsconfig/copy-js-assets 빌드 파이프라인 및
                              루트 eslint.config.js 대상 밖(독립 ESM/JSX). quizbot/managers/web/web_express_app.js가
                              빌드 산출물(web-frontend/dist/)을 정적 서빙.
```

## 아키텍처 핵심 패턴

**매니저 패턴**: `quizbot/managers/*.js`는 대부분 상태를 가진 싱글턴 모듈. `exports.initialize(...)`를 노출하면 `bot.js`의 시작 시퀀스(`logger.info('Initializing X')` 다음 줄들)에서 순서대로 호출됨 — 새 매니저를 추가하면 여기 등록 필요.

**Facade 패턴**: 큰 파일을 도메인별로 쪼갤 때, 원본 파일 이름은 하위 파일들을 spread(`{...a, ...b}`)로 재수출하는 얇은 facade로 남기는 방식을 반복 사용함 (`db_manager.js`, `utility.js`, `quiz_ui/components.js`, `report_manager.js`). **파일을 찾을 때 facade만 보고 끝내지 말고, 실제 로직은 하위 디렉터리(`db/`, `util/`, `components/`, `report/`)에 있다는 걸 기억할 것.**

**UI 프레임워크** (`quiz_ui/common-ui.js`, `quiz_ui/ui-system-core.js`):
- 모든 화면은 `QuizbotUI`(단순 메뉴) 또는 `QuizBotControlComponentUI`(페이지네이션 있는 목록) 상속.
- `onInteractionCreate(interaction)`가 새 UI 인스턴스를 반환하면 자동으로 이전 화면이 `prev_ui_stack`에 쌓이고 화면 전환됨 (`ui-system-core.js`의 `onUIReceived`/`appendNewUI`). `'back'` customId(컴포넌트: `only_back_comp`)는 `UIHolder`가 전역으로 가로채 자동으로 뒤로가기 처리 — 개별 UI가 직접 구현할 필요 없음.
- `UIHolder`는 `UI_HOLDER_TYPE.PUBLIC`(길드 채널, `holder_id = guild_id`) / `PRIVATE`(개인 메시지, `holder_id = user_id`) 두 종류. 새 진입점 만들 때 `ui-system-core.js`의 `createXXXUIHolder` 패턴(`createQuizToolUIHolder`, `createAdminPanelUIHolder`) 그대로 복제하면 됨.

**관리자 전용 기능**: `PRIVATE_CONFIG.ADMIN_ID`와 `interaction.user.id` 비교로 판별. 확립된 컨벤션:
- 어드민 전용 명령어(`/quizmgr`)는 일부러 평범한 이름 — 호기심 유발 방지.
- 비어드민이면 **응답을 아예 하지 않고 return**(reply/deferReply 등 일체 없음) → Discord 클라이언트엔 자연스러운 인터랙션 타임아웃으로만 보임. `quizbot/bot.js`의 `quiz_manager_panel_handler` 참고.
- 진입점 + UI 홀더 생성 함수 양쪽에서 ADMIN_ID를 이중으로 재확인(방어적 체크) — 하나가 실수로 깨져도 두 번째가 막음.
- 응답은 전부 DM으로만 (`UI_HOLDER_TYPE.PRIVATE`) — 다른 유저 인터랙션이 애초에 그 홀더로 라우팅될 수 없음(Discord DM은 1:1).
- 밴 목록(`resources/banned_user.txt`)은 길드ID(멀티플레이 밴)와 유저ID(퀴즈 생성 영구밴)를 **같은 파일/캐시**로 관리 (`ban_manager.js`, 의도된 동작).

**IPC / 멀티 클러스터**: `discord-hybrid-sharding` 기반. `multiplayer_signal.js`의 `CLIENT_SIGNAL`/`SERVER_SIGNAL` 비트 태그(서버 시그널은 최상위 비트 set, `0x80` 이상)로 방향 구분. 이 영역은 배포 중 롤링 재시작 시 신·구 버전이 잠시 공존할 수 있어 특히 조심스럽게 다뤄야 함 — `docs/archive/BUGS_FOUND.md`에 이 영역의 알려진(수정 안 한) 이슈가 기록돼 있음.

**이름 충돌 주의**: `quizbot/managers/multiplayer_session.js`(cross-서버 대결의 `MultiplayerSession` 클래스, IPC로 동기화되는 길드 단위 대결 세션)와 `quizbot/quiz_system/session/multiplayer_session.js`(같은 길드 안에서 진행되는 State 패턴 퀴즈 세션의 `MultiplayerLobbySession`/`MultiplayerQuizSession`)는 **이름은 비슷해도 완전히 다른 클래스**. 헷갈리기 쉬우니 import 경로를 항상 확인할 것.

## 코드 스타일 (기존 관행, `eslint.config.js`로 고정됨)

- 세미콜론 사용, 함수 선언부 다음 줄에 여는 중괄호(`function foo()\n{`)
- `snake_case` 변수/함수명 혼용, 클래스는 `PascalCase`
- 개발자가 직접 쓴 주석은 **삭제 금지** — 코드가 이동하면 주석도 같이 이동, 코드 자체가 없어지면 `docs/archive/RELOCATED_COMMENTS.md`/`docs/archive/DEPRECATED_CODE_REMOVED.md`에 원문 보존
- 새 기능을 짤 때도 이 스타일 그대로 따를 것 (TypeScript 전환 등 큰 방향 전환 전까지)

## 테스트 원칙

- `node:test` + `node:assert/strict`, 외부 의존(파일시스템, DB, Discord API, yt-dlp 등)은 `t.mock.method`로 경계에서 mock 처리
- UI 클래스(`quiz_ui/*.js`)는 관례상 유닛테스트 대상이 아님 (Discord 인터랙션 의존이 커서) — 대신 `managers/`의 순수 로직/DB 래퍼가 테스트 대상. UI를 손댔으면 `node -e`로 require 스모크테스트만 해도 충분한 경우가 많음.
- `npm test` / `npm run lint` (0 error 기준, warning은 기존 관행 수준 유지)

## 빌드/배포 (운영 봇은 반드시 `dist/index.js`로 실행)

- `npm run build`(`tsc && copy-js-assets.js`)가 `.ts`는 컴파일, `.js`/`.json`은 byte-for-byte 복사해서 `dist/`를 만듦(`config/system_setting.js`의 `PROJECT_ROOT`가 `package.json` 위치까지 올라가서 찾으므로 `resources/`/`log/` 등 경로는 `dist/`에서 실행해도 항상 저장소 루트를 정확히 가리킴). **소스(`utility/`, `quizbot/` 등)만 고치고 재빌드를 안 하면 변경이 전혀 반영 안 됨** — 실제로 이 문제로 수정한 버그가 안 고쳐진 것처럼 보인 적 있음(2026-08-08). 코드 수정 후 사용자가 직접 재생/재현 테스트를 할 예정이면 `npm run build`부터 안내할 것.
- 88개 이상의 `quizbot/`/`utility/`/`config` 하위 파일이 이미 `.ts`로 전환 완료됐고, 전환된 파일은 원본 `.js`가 삭제됨 — Node.js는 `.ts`를 직접 `require()`할 수 없고(`ts-node/register` 같은 런타임 트랜스파일 훅이 `index.js`/`bot.js` 어디에도 없음) 이 때문에 **소스 트리의 `index.js`를 그대로(`npm run build` 없이) 실행하면 전환된 매니저를 require하는 순간 크래시함**. 즉 운영 봇은 이제 선택이 아니라 필수로 `dist/index.js`를 실행해야 함(2026-08-12, `auto_script/` 점검 중 확인 — 그 전까지 실제 운영 서버는 TS 마이그레이션 이전 구코드가 배포된 상태였음).
- `auto_script/install_quizbot3.sh`가 설치 마지막 단계에 `npm run build`를 실행하고 `auto_script/systemd/quizbot3.service.template`으로 systemd 유닛(`quizbot3.service`, `ExecStart=node dist/index.js`)을 생성/enable함. `auto_script/server_script/quizbot_start.sh`/`quizbot_stop.sh`는 `systemctl start/stop quizbot3` 래퍼임 — 자세한 흐름은 `auto_script/정석 사용법.txt`.
  - **`install_quizbot3.sh`가 설치 초반에 UTF-8 locale(`en_US.UTF-8`)을 설정함(2026-08-15 추가)** — GCP 등 일부 클라우드 기본 이미지가 non-UTF-8 locale이라, `resources/notices/` 등 한글 파일명이 `ls`에 물음표로 깨져 보이는 문제 방지용(실제 파일 데이터는 항상 UTF-8이라 봇 동작 자체엔 영향 없었음 — 순전히 터미널 표시 문제). 이전 서버는 소급 적용 안 되니 수동으로 `locale-gen`/`update-locale` 필요(`auto_script/정석 사용법.txt` 참고).
  - **`quizbot3.service`의 `ExecStartPre`/`ExecStopPost`가 둘 다 `auto_script/server_script/kill_orphan_quizbot.sh`를 실행함(2026-08-15 추가)** — ffmpeg/yt-dlp 등 자식 프로세스가 systemd의 cgroup 기반 종료(SIGTERM→`TimeoutStopSec`(20초) 후 SIGKILL)를 빠져나가 `quizbot_stop.sh` 후에도 남는 문제 때문에, `pkill -9`로 남은 `node dist/index.js`/ffmpeg/yt-dlp를 확실히 정리함. 이 훅은 유닛 자체에 있어 `systemctl start/stop/restart quizbot3`를 직접 써도 항상 같이 실행됨(래퍼 스크립트 경유 불필요) — start 쪽 청소 덕분에 이전 인스턴스가 안 죽은 채 남아있어도 새 시작과 중복 실행되지 않음. **`quizbot_update.sh`는 서비스 파일 자체를 재생성하지 않으므로, 이 개선 이전에 설치된 서버는 서비스 파일을 수동으로 다시 설치해야 적용됨**(명령어는 `auto_script/정석 사용법.txt` 참고).
- **`web-frontend/`(퀴즈 선택 웹 UI)는 루트와 별개의 독립 프로젝트라 루트 `npm run build`로는 안 만들어짐** — `install_quizbot3.sh`/`quizbot_update.sh` 둘 다 루트 빌드 직후 `cd web-frontend && npm install && npm run build`를 별도로 실행함(2026-08-15 추가, 이 단계가 빠지면 웹 UI 접속 시 `express.static`이 `web-frontend/dist/`를 못 찾아 "Cannot GET /"만 뜸). 로컬에서 `web-frontend/` 소스만 고쳤을 때도 마찬가지로 `cd web-frontend && npm run build`를 별도로 돌려야 반영됨(루트 `npm run build`와는 완전히 별개).
- 운영 서버(`develop`/`master` 브랜치)에 신규 커밋을 반영할 땐 `auto_script/server_script/quizbot_update.sh`(신규) — 실행 시 업데이트할 브랜치를 물어봄(Enter면 현재 브랜치 유지, develop/master 중 다른 쪽 입력 시 전환 — 2026-08-15 추가, develop 검증 후 master로 옮겨 운영하는 시나리오 지원). `git fetch`+(전환 시 `checkout`)+`reset --hard origin/<선택 브랜치>` → `npm install` → `custom_node_modules` 패치 재적용 → `npm run build` → `web-frontend` 빌드(위 항목) → **`chown -R ubuntu:ubuntu`로 소유권 복원**까지 처리하고 **서비스는 자동으로 재시작하지 않음**(2026-08-15 변경, 이전엔 `systemctl restart`까지 자동 실행했으나 확인할 틈 없이 바로 재시작되는 게 위험하다는 판단 — 완료 후 `quizbot_start.sh`로 직접 시작). `private_config.json`/`resources/notices/`(quizmgr 공지)/`resources/maintenance_notice.txt`(점검 모드) 등 gitignore 대상 파일은 안 건드림. `config/system_setting.js`/`resources/current_notice.txt`/`resources/banned_user.txt`(quizdata/bgm과 달리 코드로 배포되면 안 되는 서버별 운영 상태 3종 — 로컬 설정 커스터마이징/quizmgr 실시간 공지/실시간 밴 목록)는 git 추적 대상이지만 reset 전후로 백업/복원해서 원복되지 않게 보호함(2026-08-15 추가·확장 — 파일들에 새 내용이 추가되면 이 방식으론 자동 반영 안 되니 수동 병합 필요). 이미 유효기간이 지난 레거시 공지 2개는 git 추적에서 아예 뺌(2026-08-15) — 관리자가 quizmgr로 지워도 다음 업데이트 때 되살아나지 않게. `develop-claude`(작업용 브랜치)에서는 실행 거부되는 안전장치 있음. **소유권 버그(2026-08-15 발견·수정)**: 이전 버전은 `sudo`로 손댄 파일들이 소유권 복원 없이 root로 남아, `User=ubuntu`로 도는 `quizbot3.service`가 그 파일을 쓰거나 지울 때(예: `/quizmgr` 공지 삭제) EACCES로 실패했음 — 과거에 이미 업데이트를 돌린 서버는 `sudo chown -R ubuntu:ubuntu <설치 경로>`를 한 번 수동 실행해야 함.
- Windows PowerShell 기본 실행 정책이 `npm run build`(`npm.ps1`)를 막을 수 있음 — `npm.cmd run build`로 우회하거나 `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`로 영구 해결.

## 알아두면 좋은 문서 (전부 `docs/` 디렉터리, 2026-08-07 루트에서 이동, 2026-08-13 하위 폴더로 재정리)

`docs/` 하위는 `ACTIVE_PLAN.md`/`COMPLETED_WORK_LOG.md`/`TEST_CHECKLIST.md`(자주 참조하는 진입점 3개)만
루트에 남기고, 나머지는 `docs/plans/`(작업계획서·설계 문서), `docs/archive/`(완료된 로그성 기록·보존용),
`docs/mockups/`(정적 HTML 목업)로 분류해뒀다.

> **새 세션은 아래 두 문서부터 읽을 것** — 나머지 문서에 흩어진 완료/미완료 상태를 요약해서
> 가리키는 진입점: `docs/ACTIVE_PLAN.md`(뭐가 아직 안 끝났는지), `docs/COMPLETED_WORK_LOG.md`
> (뭐가 언제 끝났는지). 상세 내역이 필요할 때만 아래 원본 문서로 내려갈 것.
>
> **기능 추가/수정 작업을 끝냈으면**(사용자가 별도로 요청하지 않아도) 다음을 갱신할 것: (1) 관련
> `CLAUDE.md`(루트 또는 하위 디렉터리)에 한두 줄 반영, (2) `docs/ACTIVE_PLAN.md`와
> `docs/COMPLETED_WORK_LOG.md`, (3) 관련 있으면 `docs/TEST_CHECKLIST.md`.

**진행 기록/컨벤션 (로그성 기록, 계속 개별 문서로 유지)**
- `docs/plans/REFACTOR_PLAN.md` — 구조 개편 전체 계획/진행 기록 (Phase 0~6, 뭘 왜 이렇게 나눴는지)
- `docs/plans/CONTRIBUTING_REFACTOR.md` — 브랜치/커밋 컨벤션 (`refactor:`/`fix:`/`feat:`/`test:`/`docs:` prefix 분리 원칙)
- `docs/archive/BUGS_FOUND.md` — 리팩터 중 발견한 버그 로그 (수정 완료/보류 상태 포함, 보류 항목은 왜 지금 안 고쳤는지 이유도 적혀있음)
- `docs/archive/PERFORMANCE_NOTES.md` — 성능 관찰 로그
- `docs/archive/DEPRECATED_CODE_REMOVED.md` — 삭제된 죽은 코드 원문 보존
- `docs/archive/RELOCATED_COMMENTS.md` — 코드 이동 중 자리를 못 찾은 주석 원문 보존
- `docs/archive/DUPLICATE_UI_PATTERNS.md` — 중복 UI 생성 로직 후보 (통합은 의도적으로 보류 중)

**작업계획서 (완료/미완료 요약은 ACTIVE_PLAN/COMPLETED_WORK_LOG에, 상세는 여기)**
- `docs/plans/WEB_INTEGRATION_PLAN.md` — 퀴즈 선택 웹 연동(임시 토큰 기반 리모트 컨트롤) 작업계획서. 설계+UI
  목업(`docs/mockups/WEB_UI_MOCKUP.html`)까지 완료, 코드 구현은 다음 세션부터 — Phase 0(인프라 스켈레톤)부터 시작.
- `docs/plans/TS_MIGRATION_AND_CONVENIENCE_PLAN.md` — TypeScript 점진 전환 + 편의 기능(B단계) 작업계획서. 세션 인수인계 체크포인트 포함.
- `docs/plans/B1_BULK_IMPORT_EXPORT_TODO.md` — 위 계획서의 B-1(문제 일괄 등록) 착수 전 결정 보류 중인 항목 3개.
- `docs/plans/POST_B_ROUND_TEST_FEEDBACK_TODO.md` — A-5/B-2/B-3'/B-4 전수 테스트 피드백 12건(미착수).
- `docs/plans/SERVER_SCRIPT_IMPROVEMENT_PLAN.md` — `auto_script/`(설치/실행/중지 스크립트) 개선 작업계획서.
  2026-08-12 조사+구현 완료(저장소 주소 수정, 브랜치 선택, `npm run build`+systemd 데몬화 등) — 상세는
  문서 참고.
- `docs/TEST_CHECKLIST.md` — 수동 테스트 체크리스트. 기능 추가/수정 시 관련 항목을 갱신(추가 또는 `[ ]`로 되돌리기)할 것.

**UI/UX 개선 (별도 라운드, 상태 제각각)**
- `docs/plans/UI_IMPROVEMENT_PROPOSAL.md` — 1라운드(퀴즈만들기 중심), 대부분 완료.
- `docs/plans/UI_IMPROVEMENT_PLAN_ROUND2.md` — 2라운드(봇 전역), 실제 버그 파트 완료·UX 개선 후보 파트 일부 진행 중.
- `docs/plans/I18N_ARCHITECTURE_PLAN.md` — 다국어 지원 아키텍처 조사/설계 문서. **코드 미수정, 사용자가 명시적으로 지시하기 전까지 착수 금지.**

## 브랜치 전략 (2026-08-13 확정)

3개 브랜치를 용도별로 분리해서 씀 — 새 세션은 지시 없이도 이 규칙을 지킬 것:

- **`develop-claude`** — Claude와 사용자가 실제로 코드를 짜는 브랜치(바이브코딩용). CLAUDE.md
  전체(루트+하위 9개)와 `docs/`(`ACTIVE_PLAN.md`/`COMPLETED_WORK_LOG.md`/`plans/`/`archive/`/
  `mockups/`) 전부 여기에만 있음. **평소 작업은 전부 이 브랜치에서.**
- **`develop`** — 실서버에 설치해서 전수 테스트하는 브랜치. `docs/`엔 `TEST_CHECKLIST.md`만 있고
  CLAUDE.md 전 파일과 나머지 `docs/`는 의도적으로 없음(2026-08-13 정리 완료, 이유는 아래 참고).
- **`master`** — 전수 테스트 통과 후 장기 운영하는 안정 버전.

**`develop-claude` → `develop` 반영은 반드시 `dev_tools/sync_to_develop.sh`로만 할 것 — 절대
`git merge develop-claude`를 손으로 직접 하지 말 것.** 두 브랜치가 이미 갈라져 있어서(`develop`엔
CLAUDE.md/docs 삭제 커밋이, `develop-claude`엔 그 이후 커밋들이 있음) 일반 merge는 3-way merge가
되는데, 이 상태에서:
- 기존 CLAUDE.md/docs 파일을 `develop-claude`에서 **수정**하면 modify/delete **충돌**로 걸림(눈에 보임,
  안전).
- 하지만 `develop-claude`에서 **새로 만든** CLAUDE.md나 `docs/` 밑 새 파일/폴더는 `develop` 입장에서
  "본 적 없는 파일"이라 **충돌 없이 조용히 같이 병합됨** — 이게 진짜 위험 지점.

`dev_tools/sync_to_develop.sh`는 병합을 `--no-commit`으로 멈춘 뒤 제외 목록(`EXCLUDE_PATHS`)을 다시
적용하고 나서 커밋하는 방식으로 이 문제를 막는다. **새 CLAUDE.md 파일을 추가하거나(새 하위 디렉터리
생길 때 등) `docs/` 밑에 새 최상위 카테고리 폴더를 만들면, 반드시 같은 커밋에서
`dev_tools/sync_to_develop.sh`의 `EXCLUDE_PATHS` 배열도 같이 갱신할 것** — 안 그러면 다음 동기화 때
그 파일이 `develop`으로 새어 들어간다.
