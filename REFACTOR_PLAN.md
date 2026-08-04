# Discord QuizBot v2 (Quizbot3) 구조 개편 계획서

> 작성일: 2026-08-03
> 상태: 초안 — 실행 전 승인/조정 대기
> 대상 저장소: `discord-quizbot-v2` (현재 브랜치: `master`)

---

## 0. 배경 및 목표

수년간 단독 개발/운영해온 프로덕션 디스코드 봇으로, 최근 1년은 무중단 안정 운영 중. 신규 기능 추가를 앞두고 누적된 코드 복잡도(거대 파일, 긴 함수, 임시방편 코드)를 해소하기 위한 구조 개편을 진행한다.

**작업 목표 4가지**
1. 프로젝트 구조 개편 — 아키텍처 경계를 명확히 하고 복잡한 코드를 개선
2. 코드상 로직 버그 수정
3. 개발자가 직접 작성한 주석은 임의 삭제 금지 (히스토리 관리 목적)
4. 기존 코드 스타일을 분석 후 유지 (새 스타일 강제 도입 아님)

**확정된 작업 전략 (사용자 확인 완료)**
- 점진적·모듈 단위 리팩토링 (빅뱅 재설계 아님)
- 핵심 로직 위주 유닛테스트를 신규로 작성해 회귀 방지 안전망 확보
- 개편 수준은 "파일/함수 분리 중심" — 기존 설계(State 패턴 등)는 유지하고 레이어드 아키텍처 재설계나 TypeScript 전환은 하지 않음
- 별도 `refactor/*` 브랜치 + 테스트용 디스코드 서버에서 검증 후 병합

---

## 1. 현황 분석 요약

### 1.1 규모
- 전체 JS 약 20,770줄 (node_modules/custom_node_modules 제외)
- 최대 파일 Top 5:

| 파일 | 줄 수 | 비고 |
|---|---|---|
| `quizbot/quiz_system/quiz_system.js` | 5,959 | 전체의 약 29% — 압도적 최대 |
| `quizbot/managers/multiplayer_manager.js` | 1,845 | 서버 간 대결 로직 |
| `quizbot/quiz_ui/components.js` | 1,186 | 버튼/UI 컴포넌트 팩토리 |
| `quizbot/quiz_ui/multiplayer-quiz-lobby-ui.js` | 836 | |
| `quizbot/managers/report_manager.js` | 819 | 신고/자동처리 |

### 1.2 `quiz_system.js` 내부 구조 (매우 중요)
겉보기와 달리 **완전히 무질서한 코드는 아님**. 이미 State 패턴으로 설계되어 있고, `QuizLifeCycle`을 상속하는 클래스 28개가 한 파일에 몰려있는 구조:

```
QuizPlayUI, QuizSession → NormalQuizSession / DummyQuizSession
  → MultiplayerLobbySession, MultiplayerQuizSession (Mixin 사용)
QuizLifeCycle → QuizLifeCycleWithUtility
  → Initialize → InitializeDevQuiz / InitializeCustomQuiz / InitializeOmakaseQuiz / InitializeUnknownQuiz
  → Explain, Prepare
  → Question → QuestionSong / QuestionImage / QuestionIntro / QuestionText / QuestionOX / QuestionCustom / QuestionOmakase / QuestionUnknown
  → TimeOver, CorrectAnswer, Clearing, Ending, Finish, HOLD
```
→ **개편 방향이 명확함**: 설계를 갈아엎을 필요 없이, 이 클래스 경계를 그대로 "폴더/파일 경계"로 승격시키면 됨 (섹션 4 참고).

### 1.3 안전망 부재
- 자동화 테스트 프레임워크 없음 (`package.json`에 test 스크립트/의존성 전무)
- `eslint`가 devDependency로 있으나 **설정 파일 자체가 없음** → 현재 강제되는 스타일 규칙 없음, 사실상 "개발자의 손버릇"이 곧 스타일
- CI 파이프라인 없음

### 1.4 기타 특이사항
- `custom_node_modules/` — `@discordjs/voice`(seek/duration 옵션 추가), `ytdl-core`(sig.js 패치), `play-dl`(로컬 오디오 SeekStream 지원) 등 **의존성 자체를 직접 패치**해서 씀. 리팩토링 시 이 패치들을 건드리지 않도록 격리 필요.
- ~~`quiz_system/deprecated_system_func.js` (320줄) — 이름 그대로 레거시 코드~~ → 확인 결과 실제로는 죽은 코드(전부 주석 처리됨)와 ytdl-core 트러블슈팅 과정을 기록한 **연구노트**였음. 코드베이스 어디서도 require되지 않아 안전하게 `notes/deprecated_system_func.js`로 이동 완료 (섹션 6 결정 로그 참고).
- `discord-hybrid-sharding` 기반 멀티 클러스터 구조 + IPC로 멀티플레이(서버 간 대결) 상태 동기화 — 리팩토링 시 클러스터 간 메시지 프로토콜(`ipc_manager.js`, `multiplayer_signal.js`)은 특히 조심스럽게 다뤄야 함 (배포 중 롤링 재시작 시 신·구 버전이 잠시 공존할 수 있음).
- 노래 맞추기 퀴즈는 실제 YouTube 스트림에 의존 → 유닛테스트 시 네트워크 경계는 반드시 목(mock) 처리 대상.

---

## 2. 원칙 (모든 단계 공통 적용)

### 2.1 주석 보존 원칙 **(확정)**
- 기존에 사람이 작성한 주석(`//`, `/* */`, JSDoc 포함)은 **삭제 금지**. 코드 위치가 이동하면 주석도 함께 이동.
- 리팩토링으로 해당 주석이 설명하던 코드/함수 자체가 완전히 사라지는 경우, **삭제 대신 `RELOCATED_COMMENTS.md`로 옮겨서 보존**한다 (원본 파일 경로, 원본 라인 위치, 주석 원문, 이동/삭제 사유를 함께 기록).
- 자동 생성/도구가 만든 주석(예: 린터 disable 주석)은 이 원칙 대상이 아님.
- TODO 주석(`ffmpegAgingManager` 등에서 발견됨)은 실제 이슈로 전환하되 원문 주석은 유지.
- 참고: `quizbot/quiz_system/deprecated_system_func.js`(사실상 연구노트/트러블슈팅 기록)는 코드가 아니므로 이 원칙과 별개로 `notes/` 폴더로 이동 완료 (섹션 1.4, 6 참고).

### 2.2 코드 스타일 유지 원칙 **(확정 — ESLint 도입)**
- 새 스타일 가이드를 강제하지 않고, **기존 코드에서 관찰되는 관례를 그대로 따름**: 세미콜론 사용, 함수 선언부 다음 줄에 여는 중괄호(`function foo()\n{`), `snake_case` 변수/함수명 혼용, 클래스는 `PascalCase` 등.
- 각 모듈 리팩토링 착수 전, 해당 파일에서 관찰되는 스타일을 짧게 메모 후 그 스타일로 통일 (파일 간 스타일이 다르면 파일 단위로 존중).
- **관찰된 규칙을 `eslint.config.js`(flat config, ESLint 9.x 기준)로 문서화/고정한다.** 목적은 "새 스타일 강제 도입"이 아니라 **"현재 관행을 규칙으로 굳혀서 이후 회귀(스타일 흔들림)를 방지"**하는 것. Phase 0에서 기존 코드 전수 스타일 관찰 후 작성.

### 2.3 버그 수정 원칙
- 리팩토링(이동/분리) 커밋과 버그 수정 커밋은 **분리**한다. (`refactor: split QuizSession into...` vs `fix: 점수 계산 시 음수 처리 안 되는 버그`)
- 각 Phase 진행 중 발견한 버그는 `BUGS_FOUND.md`(신규)에 즉시 기록. 사소하고 국소적인 버그는 해당 Phase 내에서 바로 수정, 파급 범위가 크거나 불확실한 버그는 별도 Phase로 분리해 우선순위 논의 후 처리.
- 버그 수정은 반드시 "수정 전 재현 조건 → 수정 내용" 형태로 커밋 메시지/기록에 남겨 히스토리 추적 가능하게 함.

### 2.4 안전망(테스트) 원칙 **(확정)**
- 테스트 러너는 **Node.js 내장 `node:test`**를 사용한다. 추가 의존성 없이 바로 쓸 수 있고, 이미 무거운 의존성(discord.js, ffmpeg, ytdl 등)이 많은 프로젝트에 새 프레임워크를 더 얹지 않는 편이 낫다는 판단. 어서션은 내장 `node:assert` 사용, 필요시 `node --test` 커버리지 옵션(`--experimental-test-coverage`) 활용 가능.
- 테스트 대상은 "핵심 로직" 우선: 점수/랭킹 계산, 정답 채점(문자열 유사도 등), 퀴즈 상태 전이(LifeCycle 전이 조건), MMR 계산, 힌트 자동 적용 조건, 멀티플레이 신호 처리 등 **네트워크/디스코드 API/DB 의존이 적은 순수 로직**부터.
- 디스코드 API, DB, YouTube 스트림 등 외부 의존은 인터페이스 경계에서 mock 처리(`node:test`의 `t.mock` 활용). 이 경계를 명확히 하는 것 자체가 이번 리팩토링의 부산물이 됨 (외부 의존과 순수 로직이 뒤섞여 있던 부분을 분리하게 됨).
- 각 Phase는 "그 모듈에 대한 테스트가 통과해야 종료"를 완료 기준으로 삼음.

### 2.5 테스트 실행 보류 원칙 **(중요, 확정)**
- 테스트용 봇 토큰과 테스트 전용 DB는 이미 존재하며 `config/private_config.json`으로 관리된다. 다만 **현재 해당 값들은 사용자가 아직 채워넣지 않은 상태**이므로:
  - 테스트 코드(유닛테스트, 필요시 통합테스트 스캐폴딩)는 **작성은 진행**한다.
  - `npm test`(또는 `node --test`) 실행, 봇 기동, DB 연결 등 **실제 실행/연동은 사용자가 `config/private_config.json`에 테스트용 값(TOKEN, CLIENT_ID, DB 접속 정보)을 채운 뒤 "실행해도 된다"고 확인해줄 때까지 보류**한다.
  - Claude(작업 수행자)는 이 원칙이 해제되기 전까지 `node index.js`, `node --test` 등 봇 기동/DB 접속을 유발하는 명령을 임의로 실행하지 않는다.

---

## 3. 전체 워크플로우 (모든 Phase 공통)

```
1. 브랜치 생성        refactor/<module-name> (from develop)
2. 현황 스냅샷        분리 대상 파일의 책임/의존관계/스타일 메모
3. 안전망 확보        해당 모듈 핵심 로직에 대한 유닛테스트 작성 (리팩토링 전, 현재 동작 기준)
4. 구조 개편          클래스/함수 단위로 파일 분리, 긴 함수 추출 (동작 변경 없이)
5. 버그 로그          발견한 버그를 BUGS_FOUND.md에 기록, 국소 버그는 즉시 수정(별도 커밋)
6. 검증               유닛테스트 통과 + 테스트용 디스코드 서버에서 수동 시나리오 검증
7. 리뷰 & 병합         develop 브랜치로 병합 (필요 시 AI 코드리뷰 활용)
8. 모니터링           운영 배포 후 로그(winston)/모니터링 매니저로 이상 유무 확인
```

각 Phase는 **독립적으로 배포 가능한 단위**로 쪼갠다. 즉, Phase 2가 끝나기 전에 Phase 1만 먼저 운영에 반영해도 무방한 구조로 진행.

---

## 4. 단계별 로드맵 (Phase)

우선순위는 "복잡도/리스크가 큰 모듈 우선"이 아니라 **"리스크는 낮고 파급력은 검증 가능한 모듈부터 시작해 리팩토링 방법론 자체를 먼저 검증"**하는 순서로 제안한다. 처음부터 가장 큰 `quiz_system.js`로 뛰어들면 방법론 시행착오 비용이 가장 비싼 곳에서 발생하기 때문.

### Phase 0 — 준비 단계
- [x] `notes/` 폴더 생성 및 `deprecated_system_func.js` 이동 (완료)
- [x] `refactor/` 브랜치 전략, 커밋 컨벤션 문서화 → `CONTRIBUTING_REFACTOR.md`
- [x] `BUGS_FOUND.md`, `RELOCATED_COMMENTS.md` 템플릿 생성
- [x] 기존 코드 스타일 전수 관찰 후 `eslint.config.js`(flat config) 작성 및 `npm run lint` 스크립트 추가 (`npm run lint` 기준 0 error / 161 warning — 기존 관행이라 warn 처리, 각 Phase 진행 중 정리)
- [x] `node:test` 기반 테스트 스캐폴딩 준비 (`test/` 디렉터리, 예시 테스트 `test/utility/utility.test.js`) — 사용자가 테스트용 봇 토큰/DB 값을 `config/private_config.json`에 채우고 실행을 허가하여(2026-08-03) 섹션 2.5 보류 원칙 해제, `npm test` 실행 확인 완료 (3 pass)

### Phase 1 — 저위험 모듈로 방법론 검증
대상: `quizbot/managers/tagged_dev_quiz_manager.js`(112줄), `monitoring_manager.js`(108줄), `feedback_manager.js`(149줄) 등 소규모 매니저
- 목적: 파일 분리 + 유닛테스트 + 버그 로그 + 브랜치 워크플로우를 작은 단위로 먼저 검증하고, 이후 Phase에 적용할 템플릿/체크리스트 확정

### Phase 2 — `quiz_system.js` 분해 (최우선 대형 작업)
제안 분리 구조 (기존 State 패턴 경계를 그대로 파일 경계로 승격):
```
quizbot/quiz_system/
  session/
    quiz_session.js          (QuizSession, NormalQuizSession, DummyQuizSession)
    multiplayer_session.js   (MultiplayerLobbySession, MultiplayerQuizSession, Mixin)
  lifecycle/
    quiz_lifecycle.js        (QuizLifeCycle, QuizLifeCycleWithUtility)
    initialize.js            (Initialize + 4개 하위 클래스)
    explain.js
    prepare.js
    question/
      question.js            (Question 베이스)
      question_song.js, question_image.js, question_intro.js,
      question_text.js, question_ox.js, question_custom.js,
      question_omakase.js, question_unknown.js
    time_over.js, correct_answer.js, clearing.js, ending.js, finish.js, hold.js
  quiz_play_ui.js             (QuizPlayUI)
```
- `Prepare`(3089~3781, 약 692줄), `Question`(3781~4699, 약 918줄) 클래스는 파일을 나눠도 여전히 개별 메서드가 길 가능성이 높음 → 파일 분리 후 2차로 메서드 단위 함수 추출 진행
- 유닛테스트 우선순위: 상태 전이 조건, 점수/정답 판정, 힌트 로직
- 이 Phase는 규모상 여러 서브 브랜치로 다시 쪼갤 가능성이 높음 (예: `refactor/quiz-system-session`, `refactor/quiz-system-question` 등)

### Phase 3 — `multiplayer_manager.js` 분해 (1,845줄)
- 클러스터 간 IPC 신호 처리, 매칭/로비 관리, MMR 계산 등 책임별로 분리
- 롤링 재시작 시 신·구 IPC 메시지 포맷 호환성 검토 필수 (배포 전략과 직결)

### Phase 4 — UI 레이어 (`quiz_ui/components.js` 1,186줄 및 관련 UI 파일들)
- 버튼/컴포넌트 팩토리 함수 단위 분리, 중복 UI 생성 로직 통합
- 사용자 결정(2026-08-04): 이번 Phase는 **구조 분리만** 먼저 진행. 중복 UI 생성 로직 통합/죽은 export 정리는 `DUPLICATE_UI_PATTERNS.md`에 기록만 해두고 별도 논의 후 처리.

### Phase 5 — 나머지 매니저/유틸 (`report_manager.js`, `audio_cache_manager.js`, `db_manager.js`, `utility/utility.js` 등)
- 개별 파일 규모가 상대적으로 작아 Phase 1~4보다 빠르게 진행 가능

### Phase 6 — 최종 정리
- Phase 1~5 진행 중 추가로 발견되는 죽은 코드/레거시 조각을 `notes/` 이동 또는 제거로 정리
- `BUGS_FOUND.md`, `RELOCATED_COMMENTS.md` 최종 리뷰

**Phase 순서는 확정** (사용자 확인: 권장안 그대로 진행). Phase 1(저위험 소형 모듈)로 방법론/템플릿을 먼저 검증한 뒤 Phase 2(`quiz_system.js`)로 진입한다. 다만 Phase 1 결과에 따라 Phase 2 착수 전 세부 조정은 열어둔다.

---

## 5. 산출물 / 완료 기준

각 Phase 종료 시 다음을 만족해야 "완료"로 간주:
- [ ] 대상 파일이 책임 단위로 분리되고, 개별 파일/함수 길이가 합리적 수준으로 감소
- [ ] 핵심 로직에 대한 유닛테스트 작성 및 통과
- [ ] 기존 주석 100% 보존 (위치 이동 포함, 삭제 없음)
- [ ] `BUGS_FOUND.md`에 발견 버그와 처리 결과 기록
- [ ] 테스트용 디스코드 서버에서 해당 모듈 관련 기능 수동 검증 완료
- [ ] develop 브랜치 병합 후 일정 기간 운영 모니터링 이상 없음

---

## 6. 결정 로그 (2026-08-03 확정)

| # | 질문 | 결정 |
|---|---|---|
| 1 | `deprecated_system_func.js` 레거시 여부 | 연구노트로 확인됨. `notes/` 최상위 폴더 신설 후 그대로 이동 완료 (require 참조 없음을 grep으로 확인). |
| 2 | 주석 보존 예외 처리 | "옮겨서 보존" 채택. 코드가 사라져 주석이 갈 곳이 없어지면 `RELOCATED_COMMENTS.md`에 원본 경로/라인/원문/사유와 함께 기록 (섹션 2.1). |
| 3 | ESLint 도입 여부 | 도입 확정. 기존 코드 관행을 관찰해 `eslint.config.js`(flat config)로 고정 — 새 스타일 강제가 아니라 현재 관행의 회귀 방지용 (섹션 2.2). |
| 4 | 테스트 러너 선택 | 권장안 채택: **`node:test`** (내장, 추가 의존성 없음) (섹션 2.4). |
| 5 | Phase 착수 순서 | 권장안 채택: Phase 1(저위험 소형 모듈)로 방법론 검증 → Phase 2(`quiz_system.js`) → 이후 순서대로. |
| 6 | 테스트용 디스코드 서버/DB | 이미 존재 (`config/private_config.json`으로 관리). 단, 값은 사용자가 추후 직접 채워 넣을 예정 — **그 전까지 테스트 코드는 작성하되 실제 실행(봇 기동/DB 연결)은 보류** (섹션 2.5, 신규 원칙). |

`notes/` 폴더의 성격: 코드가 아닌 트러블슈팅 기록, 조사 로그, "왜 이렇게 했는지"에 대한 개발자 메모를 보관하는 곳. 리팩토링 중 유사한 성격의 코드(죽은 코드 + 서술형 주석 뭉치)를 추가로 발견하면 이 폴더로 옮기는 것을 기본 처리 방식으로 삼는다.

---

## 7. 다음 액션

1. Phase 0(준비 단계) 착수 — 브랜치/커밋 컨벤션 문서화, `BUGS_FOUND.md`/`RELOCATED_COMMENTS.md` 템플릿 생성, 스타일 관찰 후 `eslint.config.js` 작성, `node:test` 스캐폴딩 준비 (실행은 보류)
2. Phase 1 대상 모듈(저위험 소형 매니저) 확정 및 첫 `refactor/*` 브랜치 생성
3. 사용자가 `config/private_config.json`에 테스트용 봇 토큰/DB 정보를 채우고 실행을 허가하면 섹션 2.5 보류 원칙 해제
