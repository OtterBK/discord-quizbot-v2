# TS 전환 + 편의성 기능 추가 작업계획서

> **현재 상태 요약은 `docs/ACTIVE_PLAN.md`/`docs/COMPLETED_WORK_LOG.md` 참고** — 이 문서는 상세 설계/
> 구현 기록 원본. A-1~A-5, B-2/B-3'/B-4는 완료됐고 A-3 6단계/B-1이 남아있음(2026-08-07 기준).
>
> 범위 확정 경위: 2026-08-07 대화에서 프리셋/문제 일괄 등록/문제 미리듣기/퀴즈 복제/랭크 시즌 노출/밴 안내
> 문서화 6개 편의 기능 후보를 논의. 그중 **프리셋은 "TS 전환 후 별도 계획서"로, 랭크 시즌 노출과 밴 이력
> 조회는 "향후 TODO(이번 범위 아님)"로 확정**돼서 이 문서에서는 제외. 이 문서는 **TS 전환** + 남은 편의 기능
> (**문제 일괄 등록/미리듣기/문제 복제**) + **채팅 정지 사유 알림**을 다룬다.
>
> 2차 피드백(같은 날) 반영: (1) 문제 미리듣기는 "유튜브 링크"가 아니라 **실제 오디오 캐시 기반 클립**으로
> 설계 변경, (2) 미리듣기 도입을 계기로 발견된 "DM에 새 메시지가 쌓이면 편집 UI가 밀려 올라가는" 문제에
> 대한 대응 방침 확정, (3) **퀴즈(전체) 복제는 악용 가능성 때문에 보류, 대신 "문제(단일) 복제"로 대체**,
> (4) 채팅 정지 알림에 **제재 취소 시 알림 추가**, **이의 제기 방법 문구는 제외**.

---

## 파트 A. TS 전환

### A-1. 방향

- ESM 전환이 아니라 **CommonJS 유지 + TypeScript만 도입**(`module: "commonjs"`로 컴파일). `require`/`module.exports`
  관례를 그대로 유지해 기존 코드 스타일과 충돌 없음(CLAUDE.md에 명시된 "ESM 아님" 원칙 유지).
- `allowJs: true`로 `.js`/`.ts` **공존** 허용 — 파일 하나씩 `.ts`로 바꿔가는 점진적 전환. 한 번에 다 바꾸지 않음.
- `custom_node_modules/`(외부 패키지 직접 패치본)는 전환 대상에서 **제외** — 우리 코드가 아니라 벤더링된
  서드파티 패치라 타입 붙일 실익이 적고, 건드릴수록 리스크만 커짐(루트 CLAUDE.md의 "특히 주의" 경고 참고).
- **멀티플레이 관련 파일은 맨 마지막.** 이유는 이전 대화에서 합의한 대로 — 아직 실전 대결(2개 이상 길드)
  테스트가 안 끝난 유일한 영역이라, 여기서 나중에 문제가 생기면 "원래 버그인지 TS 전환이 만든 버그인지"
  구분이 안 됨.

### A-2. 선행 작업 — 빌드 파이프라인 (완료, 실제 구현 내용)

**착수 전 확인**: 최신 TypeScript(7.x)는 컴파일러 자체가 Go로 재작성돼서 `ts-node` 등 관련 툴 생태계가
TS 7.1까지는 호환 보장이 안 됨(WebSearch로 확인) → **`typescript@^6`, `@types/node@^22`(실제 런타임 Node
버전에 맞춤)로 고정**.

**실제로 구현하면서 계획과 달라진/추가된 것들**(전부 직접 재현 스크립트로 원인을 확인한 뒤 결정):

1. **자원 경로 문제** — `config/system_setting.js`가 `${__dirname}/../resources/...`로 경로를 계산해서
   `dist/`로 컴파일하면 깨짐. `process.cwd()` 대신(운영 서버의 실제 시작 스크립트 내용을 알 수 없어 CWD를
   가정하는 게 위험 판단) `package.json` 위치를 탐색하는 `findProjectRoot()`로 교체. `config/text_contents.json`/
   `private_config.json`처럼 `require()`로 불러오는 JSON 2개는 별도 처리(아래 4번 참고).
2. **`tsc`가 `module:commonjs` 출력에 `'use strict'`를 자동 삽입하는 문제** — `moduleDetection: "force"`가
   원인이었음(격리 재현으로 확인). 이 옵션은 import/export 문법이 없는 순수 CommonJS 파일도 "모듈"로
   취급하는데, TS는 모듈로 분류된 파일은 `alwaysStrict` 설정과 무관하게 항상 `'use strict'`를 강제로 넣음.
   그런데 이 옵션을 **완전히 빼면 이번엔 여러 `.ts` 파일이 흔한 top-level 이름(`fs`, `logger`,
   `SYSTEM_CONFIG` 등)을 똑같이 쓸 때 "같은 전역 스코프에 중복 선언"으로 충돌 에러가 남**(파일이 2개
   이상 되는 순간부터 필연적으로 발생 — 직접 재현해서 확인).
   → **결론: `.ts`로 전환한 파일은 이제부터 항상 strict mode가 된다는 걸 받아들이고**(TS의 구조적
   한계로, 회피 방법 없음 — `import ... = require(...)` 같은 우회도 시도해봤으나 마찬가지로 strict가
   강제됨), `moduleDetection: "force"`는 유지하되 **아직 `.ts`로 전환 안 한 `.js` 파일은 tsc의 컴파일
   대상에서 아예 제외**해서 이 영향을 안 받게 함(아래 4번).
3. **`this === module.exports` 자기참조 패턴(`quiz_content_loader.ts`)** — 파일이 "모듈"로 강제 분류되면서
   TS가 top-level `this`를 `undefined` 타입으로 추론해 `this.xxx(...)` 호출에서 타입 에러 발생. 실제
   Node CommonJS 런타임 동작(모듈 래퍼가 `this`를 `module.exports`로 바인딩)은 전혀 안 바뀌므로,
   `(this as any).xxx(...)`로 타입 단언만 추가(호출 방식/런타임 동작 자체는 원본과 100% 동일).
4. **`.ts`/`.js` 완전 분리 빌드** — 위 2번 문제 때문에, `tsconfig.json`의 `include`는 **`**/*.ts`만** 포함
   (`.js`는 아예 안 건드림). 대신 `scripts/copy-js-assets.js`(새 스크립트)가 아직 전환 안 한 `.js`와
   `config/*.json`(`text_contents.json`, `private_config.json`)을 dist/에 **원본 그대로(byte-for-byte)**
   복사. 이러면 tsc가 손도 안 대는 `.js` 파일은 strict 주입도, 스코프 충돌 검사도 절대 안 받음 — 안전.
5. **ESLint가 `dist/`까지 스캔하면서 경고 개수가 163→320으로 두 배가 됨** — `eslint.config.js`의 `ignores`에
   `dist/**` 추가로 해결.
6. **ESLint는 `.ts` 파일을 아예 인식 못함**(TypeScript ESLint 플러그인 미설치) — `.ts`로 전환된 파일은
   lint 완전 사각지대가 됨. 지금 당장은 넘어가지만, `.ts` 파일이 늘어나기 전에 `@typescript-eslint` 도입을
   후속 과제로 고려.
7. `npm test`가 `.ts` 소스를 직접 실행할 수 있어야 해서 `ts-node`를 devDependency로 추가,
   `"test": "node --require ts-node/register --test"`로 변경(`transpileOnly: true`로 타입체크는 생략,
   전체 타입체크는 `npm run build`가 담당). `.ts`로 바뀐 파일을 `require()`하던 곳들은 명시적 `.js`
   확장자를 반드시 제거해야 함(붙이면 이제 없는 파일을 찾다가 실패 — `.ts`/컴파일된 `.js` 양쪽에 다
   투명하게 대응하려면 확장자 없이 require).

**검증 방식(매 파일 전환마다 반복)**: `npm run build`(0 errors) → `dist/` 산출물의 `'use strict'` 유무가
의도대로인지(안 바꾼 `.js`는 원본과 동일, 전환한 `.ts`는 이제 항상 strict) → `npm test`(222개) →
`npm run lint`(0 errors, 경고 수 변화 확인) → 필요시 `node -e`로 실제 함수 호출까지 스모크테스트.

### A-3. 파일 전환 순서 (저위험 → 고위험)

| 단계 | 대상 | 이유 |
|---|---|---|
| 1 | `utility/util/*.js` (순수 함수 위주) — ✅ **완료** | 외부 의존 적고 기존 유닛테스트 있음(`test/utility/`) |
| 2 | `quizbot/managers/multiplayer_mmr.js`, `db/*.js` — ✅ **완료** | 순수 함수/쿼리 빌더 위주, 부수효과 적고 테스트 있음. 전부 원본에 이미 'use strict' 있어서 strict 전환 리스크 없었음 |
| 3 | `quizbot/managers/*.js` (멀티플레이 제외) — ✅ **완료** | ban_manager, command_manager, ipc_manager, feedback_manager, monitoring_manager, tagged_dev_quiz_manager, report_manager+report/* 8개, user_quiz_info_manager, audio_cache_manager 총 15개 파일 |
| 4 | `quizbot/quiz_ui/*.js` (멀티플레이 제외) — ✅ **완료** | 화면 클래스 대부분 — 양이 제일 많음. components/*(4개)+facade, common-ui(프레임워크 코어, 소비자보다 먼저 전환), leaf UI 5개, 중간 복잡도 7개, QuizInfoUI 계열+유저 퀴즈 관리 6개, ui-system-core(라우팅 코어, 마지막) 총 24개 파일 |
| 5 | `quizbot/quiz_system/**` (멀티플레이 세션 제외) — ✅ **완료** | State 패턴 엔진 본체 |
| 6 | **`multiplayer_*` 전체** (managers/multiplayer_*, quiz_ui/multiplayer-*, quiz_system/session/multiplayer_session.js, IPC 시그널 레이어) | 실전 대결 테스트 완료 후 착수 |

- 매 단계마다 `npm test`/`npm run lint` 통과 + 해당 파일 관련 `node -e` 스모크테스트로 검증(지금까지 계속 써온 방식 그대로).
- 한 파일을 `.ts`로 바꿀 때 **로직은 그대로 두고 타입만 추가**하는 걸 원칙으로 함 — 리팩터링과 타입 추가를
  같은 커밋에서 섞으면 회귀 원인 추적이 어려워짐(1라운드에서 겪은 `'use strict'` 사고와 같은 종류의 함정).
- **새 원칙(A-2에서 확정)**: `.ts`로 전환하는 순간 그 파일은 항상 strict mode가 됨. 그러니 전환하기 전에
  "sloppy mode에만 의존하는 로직이 있는지"(과거 `chat_cache.js` 사고 같은 패턴 — 원시값일 수 있는 값에
  프로퍼티를 대입하는 등) 한 번 훑어보는 걸 각 파일 전환 체크리스트에 포함. 문제를 발견하면 타입 추가와
  분리해서 별도 `fix:` 커밋으로 처리(1라운드 방식 그대로).

### A-3-체크포인트. 세션 인수인계 (컨텍스트 길어져서 새 대화로 넘어갈 때 참고)

**2026-08-07 기준 정확한 위치**: **A-5(quiz_system/**, 멀티플레이 세션 제외) 완료.** 완료된 하위 단계:
- A: `constants.ts`, `session_registry.ts`
- B: 베이스 클래스 우선 전환 — `quiz_lifecycle.ts`(QuizLifeCycle/QuizLifeCycleWithUtility), `question.ts`(베이스 Question, 937줄)
- C: 단순 lifecycle 7개 — `hold`/`finish`/`explain`/`time_over`/`clearing`/`correct_answer`/`ending`
- D: question 하위 클래스 8개 — `question_unknown`/`song`/`intro`/`text`/`image`/`ox`/`custom`/`omakase`
- E: `initialize.ts`(880줄, Initialize+4개 하위클래스)
- F: `prepare.ts`(711줄, **A-5 최고난도** — YouTube/커스텀 오디오 파이프라인) 완료. `generateAudioResourceFromWeb`
  호출부가 원본부터 함수가 안 받는 5번째 인자(ip 정보)를 넘기고 있던 것 발견 — 동작 안 바꾸고 미사용 파라미터로
  선언만 추가해 TS 인자개수 체크 통과시킴(진짜 버그인지는 불명, 수정 안 하고 그대로 둠).
- G: `session/quiz_session.js`(458줄) → `quiz_session.ts` — `QuizSession`/`NormalQuizSession`/`DummyQuizSession`.
  `sendMultiplayerSignal()`의 지연 `require('.../ipc_manager')` 패턴은 그대로 유지(모듈 상단으로 안 옮김).
- H: `quiz_system.js`(217줄, facade) → `quiz_system.ts` + `quiz_play_ui.js`(244줄) → `quiz_play_ui.ts` — **A-5 마지막**.
  `checkReadyForStartQuiz`/`getMultiplayerQuizSessionCount`에서 top-level 화살표 함수 안 `this`(=
  `module.exports` 자기참조) 접근이 `moduleDetection:force`로 인해 "undefined 타입" 에러가 남 —
  A-2에서 `quiz_content_loader.ts` 전환 때 겪은 것과 똑같은 패턴. `(this as any).xxx(...)`로 해결.

**A-5 완료 후 다음 단계 관련 확정 사항(2026-08-07, 사용자 지시)**:
- A-3 표의 6단계(`multiplayer_*` 전체)는 **여전히 착수하지 말 것** — 실전 대결 테스트 끝나기 전까지 보류.
- **B단계(편의 기능)도 사용자가 명시적으로 재개를 지시하기 전까지 시작하지 말 것.** A-5가 끝났다고
  자동으로 B-3'/B-4 등으로 넘어가면 안 됨 — "A-5 끝나면 잠깐 멈춰달라"는 이번 세션의 명시적 요청.
  새 세션에서 이 문서를 읽고 이어갈 때도 이 지시가 여전히 유효한지 사용자에게 먼저 확인할 것.
- 참고로 B단계 내부에서도 순서가 균일하지 않음: B-3'/B-4는 설계가 이미 끝나서 바로 구현 가능하지만,
  B-1(포맷 스펙)과 B-2(UI 목업+`updatePrivateUI` 확장)는 착수 전에 사람이 결정해야 할 게 남아있음
  (자세한 내용은 "권장 실행 순서" 섹션 참고).

**전환 중 반복적으로 튀어나온 패턴들 (앞으로 A-3 6단계 착수 시에도 다시 나올 가능성 높음)**:
- **부모 클래스 우선 전환**: 자식 클래스 여러 개가 상속하는 베이스 클래스(`QuizLifeCycle`, `Question`)는
  자식들보다 먼저 `.ts`로 바꾸고 `[key: string]: any;` 인덱스 시그니처를 달아둠 — 그래야 자식 클래스들이
  제각각 만드는 임시 프로퍼티(`skip_prepare`, `prepared_question` 등)를 개별 선언 없이 그대로 컴파일 가능.
  `session/quiz_session.js`도 같은 이유로 이 패턴이 필요할 가능성이 높음(자체 프로퍼티가 매우 많은 클래스로 보임).
- **`parseInt(숫자)` 패턴**: 원본 JS가 `parseInt`에 문자열이 아니라 숫자를 그대로 넘기는 곳이 반복적으로
  나옴(JS는 암묵적으로 문자열 변환하지만 TS `parseInt` 시그니처는 `string`만 받음) → `parseInt(String(...))`으로
  감싸면 런타임 동작 100% 동일하게 유지하며 컴파일 통과.
- **bitwise 연산자(`|=`, `&`) + boolean 피연산자**: TS는 이 연산자에 number 계열만 허용. 원본이 boolean
  반환 함수 결과에 `|=`/`&`를 쓰는 경우 `(표현식 as any)`로 캐스팅해서 원본의 JS 암묵 변환(true→1,
  false→0) 동작을 그대로 보존.
- **로컬 `.js` require는 실제로 `any`가 아닐 수 있음**: `allowJs`가 켜져 있어서, `.ts` 파일이 아직 안
  바뀐 로컬 `.js` 파일을 require하면 tsc가 그 파일의 실제 구조를 추론해서 반영함(외부 npm 패키지 require는
  그냥 `any`가 되는 것과 다름). `Object.entries(로컬JS객체)`의 값 타입이 `unknown`으로 추론되는 등
  예상 밖의 타입 에러가 날 수 있음 — 매번 실제 `npm run build` 에러 메시지를 보고 대응할 것(미리 예측하려
  하지 말고).
- **`​`(zero-width space) 트랜스크립션 함정 — 이번 세션에서 3번 겪음**: 원본 소스에 `'​'`(백슬래시
  포함 6글자 이스케이프 텍스트)가 있는 줄을 옮길 때, 실수로 실제 유니코드 문자 1개로 붙여넣어지는 사고가
  반복됨(Edit 도구가 둘을 시각적으로 구분 못해서 고칠 때도 Node 스크립트가 필요함). **문자열 리터럴에
  이스케이프 시퀀스가 있는 줄을 옮길 때는 항상 `git show HEAD:원본경로`로 바이트 단위 diff해서 확인할 것.**
- **`useDefineForClassFields`(target ES2022+ 기본값)**: 클래스 필드를 초기값 없이 선언만 해도(`question_id: any;`)
  런타임에 자동으로 `undefined`로 초기화됨 — 생성자 밖에서 동적으로 프로퍼티를 만들던 원본 패턴과
  호환됨(user_quiz_info_manager.ts에서 확인).
- **검증 순서(매 파일 동일)**: ① 사고나면 안되니 sloppy-mode 위험 요소 먼저 훑기 → ② `.ts` 작성 → ③ 기존
  `.js` `git rm` → ④ `rm -rf dist && npm run build`(0 errors 될 때까지 타입 에러 대응) → ⑤ require하던
  다른 파일들의 `.js` 확장자 제거(주의: 비슷한 이름의 다른 파일 오매칭 조심, 이번 세션에서
  `multiplayer_session_registry.js` vs `session_registry.js` 헷갈릴 뻔함) → ⑥ `npm test`(222개) →
  ⑦ `npm run lint`(0 error) → ⑧ `dist/`에서 `head -1`로 `'use strict'` 확인 → ⑨ `node -e`로 실제 동작
  스모크테스트 → ⑩ 커밋(한국어, 발견한 이슈/버그 있으면 본문에 기록) → ⑪ 이 문서의 표/체크포인트 갱신.

**새 대화 시작 시 이어가는 방법**: A-5는 완료됐고, 다음은 A-3 6단계(멀티플레이, 실전 테스트 전까지 보류)
아니면 B단계(편의 기능)인데 둘 다 "사용자가 먼저 지시해야 시작" 상태다. 새 세션에서 이 문서를 읽었다면
바로 진행하지 말고, 사용자에게 "B-3'/B-4부터 시작할지, 다른 우선순위가 있는지" 먼저 확인할 것.

---

## 파트 B. 편의 기능

### B-1. 문제 일괄 등록 (Export / Import)

**확인 결과(요청하신 사전 체크)**: Discord `TextInputBuilder`의 `max_length`는 **공식 문서 기준 최대 4000자**
(`min_length`는 0~4000). 이게 설계에 실질적 영향을 줌 — 문제 하나당 정답/오디오URL/이미지URL/텍스트/힌트 등을
JSON으로 표현하면 문제 1개에 못해도 150~300자는 나오는데, 50문제를 다 넣으면 최소 만 자 단위라 **모달 텍스트
필드 하나로는 절대 안 들어감**. 30문제만 잘라도 빠듯함.

**→ 결론: 모달(텍스트 붙여넣기) 방식이 아니라 파일 첨부 방식으로 설계해야 함.**

- **Export**: 유저가 "내보내기" 버튼을 누르면, 봇이 해당 퀴즈의 전체 문제 데이터를 JSON으로 만들어
  `AttachmentBuilder`로 `.json` 파일을 DM에 첨부해서 보냄(메시지 본문 2000자 제한도 동일하게 걸리므로
  텍스트로 보내는 건 애초에 불가능 — 파일 첨부가 유일한 방법).
- **Import**: 유저가 `.json` 파일을 첨부한 메시지를 DM으로 보내면, 봇이 `messageCreate` 이벤트에서 첨부파일을
  감지해 URL로 다운로드 → 파싱 → 검증 → 기존 문제 추가 로직(`applyQuestionInfo` 등) 재사용해서 일괄 등록.
  파일 크기 제한(Discord 기본 업로드 한도)은 퀴즈 JSON 용량 대비 넉넉해서 문제 안 됨.
- **설계 시 정해야 할 것 — 2026-08-07 논의 중 보류, `B1_BULK_IMPORT_EXPORT_TODO.md`로 분리**:
  1. JSON 포맷 스펙(필드명을 DB 컬럼명과 맞출지, 좀 더 사람이 읽기 쉬운 이름으로 할지).
  2. 검증 실패 시(형식 오류, 필수 필드 누락, 50개 초과 등) 어디까지 친절하게 에러 메시지를 줄지.
  3. Import 시 "기존 문제에 추가"할지 "전부 교체"할지.
  각 항목의 옵션/추천안은 `B1_BULK_IMPORT_EXPORT_TODO.md` 참고. B-1 착수 시 그 문서부터 다시 열어서 확정할 것.

### B-2. 문제 미리듣기 (설계 변경: 오디오 캐시 기반 클립) — ✅ **완료** (2026-08-07)

기존 안(유튜브 타임스탬프 링크)은 "정확히 어디서 시작하는지"만 보여줄 뿐, 실제 게임 중 재생되는 **트리밍된
구간(최대 재생시간 클램프 등)과 다를 수 있어서** 재검토함. 실제로는 게임 재생 로직이 이미 쓰는 캐시를 그대로
재사용하는 게 정확함.

- **재사용할 기존 함수** (`quizbot/managers/audio_cache_manager.js`, 이미 export돼 있음):
  - `getAudioCache(video_id)` — 캐시 파일 경로 반환, 없으면 `undefined`.
  - `downloadAudioCache(audio_url, video_id, ip_info)` — 캐시 없을 때 다운로드(시간 걸림, yt-dlp+ffmpeg).
  - 실제 사용 예시가 `quiz_system/lifecycle/prepare.js:610~646`에 이미 있어서 그대로 참고 가능. 단, 거기선
    `ip_info`를 `this.quiz_session.ipv4/ipv6`에서 가져오는데 DM 편집 도구엔 `quiz_session`이 없으므로
    `network_utility.js`의 `getIPv4Address`/`getIPv6Address`에서 직접 구해야 함(구현 시 주의점).
- **캐시 있을 때(대부분) — 클립 생성 방식 2026-08-07 확정**: `fluent-ffmpeg`로 캐시 파일에서
  `[audio_start, min(audio_start+MAX_PLAY_TIME, audio_end)]` 구간만 **`-c copy`(stream copy, 재인코딩
  없음)로 잘라 스트림으로 바로 뽑아서** `AttachmentBuilder`에 넘김(디스크에 임시파일 안 씀). 디스코드는
  오디오 파일 첨부 시 클라이언트에서 바로 재생 버튼을 보여주므로 별도 플레이어 UI 불필요.
  - **왜 ffmpeg를 다시 쓰는지(실시간 게임 재생과 다른 점)**: 실제 게임 재생(`prepare.js`)은
    `SeekStream`/`WebmSeeker.js`로 ffmpeg 없이 webm 캐시 파일을 seek하는데, 이건 컨테이너 없는 raw
    opus 페이로드만 뽑아서 `@discordjs/voice`에 바로 흘려보내는 방식이라(`WebmSeeker.readTag()`가
    `simpleBlock`에서 헤더 4바이트만 벗기고 push) **독립된 재생 가능 파일이 아님** — 디스코드 클라이언트가
    첨부파일로 재생 버튼을 그리려면 유효한 컨테이너(webm)가 필요해서 이 경로는 재사용 불가.
  - **왜 `-c copy`가 예전에 무거웠던 실시간 ffmpeg 재생과 다른지**: 로컬 벤치마크(개발 장비,
    `resources/cache/`의 실제 캐시 파일 기준) 결과 10초 클립 `-c copy` 자르기 ~30ms, 재인코딩까지 해도
    ~105ms, 심지어 5분짜리 파일 전체 재인코딩도 1.6초. 예전에 무거웠던 원인은 순수 연산량이 아니라
    **재생 속도(1배속)에 맞춰 노래 길이 내내 프로세스를 실시간으로 붙잡고 있어야 했던 것 + 여러 길드
    동시 재생 시 그 프로세스가 배수로 늘어나는 동시성**으로 추정 — `-c copy` 클립 자르기는 이 두 특성이
    둘 다 없음(수십 ms 안에 끝나고 죽는 단발성 프로세스, DM에서 유저 1명이 가끔 누를 때만 발생).
- **캐시 없을 때(신규 문제 오디오라 처음 여는 경우)**: 프로젝트에 이미 있는 문구
  (`prepare.js:625`, `"현재 재생할 오디오에 대한 캐시가 없어 다운로드 중입니다. 시간이 좀 걸릴 수 있습니다"`)와
  같은 톤으로 안내 — **다만 새 메시지로 보내지 않고 아래 "메시지 밀림 대응"에 따라 처리**(B-2-1 참고).
- **전달 방식 — 2026-08-07 확정, `updatePrivateUI()` 확장 불필요로 결론남**: 처음엔 카드(`base_message`)를
  edit해서 클립을 첨부하는 안(→ 공유 프레임워크 `updatePrivateUI()`에 `files` 옵션 추가 필요)이었으나,
  대신 **미리듣기 버튼의 인터랙션에 `interaction.reply({content, files, flags: MessageFlags.Ephemeral})`로
  바로 응답**하는 방식으로 변경. 기존 코드베이스에 이미 널리 쓰이는 패턴(`addQuestion` 등의 에러 응답)
  그대로 재사용하는 거라 공유 프레임워크 파일을 전혀 안 건드림. 캐시 없어서 다운로드 중인 경우도 카드를
  edit하는 대신 **같은 방식으로 에페메럴 텍스트 응답**하면 돼서 분기도 단순해짐.
  - **에페메럴+파일첨부 자체가 DM 컴포넌트 인터랙션에서 실제로 되는지 임시 버튼으로 직접 검증함**
    (`temp_ephemeral_file_test`, 검증 후 제거) — 로컬 개발 환경에서 DM 편집 화면에 테스트 버튼을 달아
    캐시 파일을 그대로 첨부해 에페메럴 응답으로 보내봤고, 정상 수신+재생 확인(2026-08-07, 사용자 확인).
  - **B-2-1("새 메시지 절대 안 만든다") 방침과의 관계**: 에페메럴 응답도 인터랙션 시점에 새 메시지가 뜨는
    거라 그 순간 카드가 스크롤 위로 밀리는 증상 자체는 동일하게 발생함. 다만 B-2-1이 막으려던 건 "유저가
    요청 안 했는데 쌓이는 토스트"였고, 이건 유저가 방금 누른 버튼에 대한 즉시 응답(바로 들으려는 콘텐츠)
    + 유저가 직접 지울 수 있고 인터랙션 토큰 만료(15분) 후 자연 소멸돼서 **B-2-1의 명시적 예외**로 취급.
  - **클립 생성 방식**은 위 항목대로 `-c copy`(재인코딩 없음) + 스트림으로 바로 첨부(디스크에 파일 안 씀).
- **UI 배치 — 2026-08-07 확정**: 새 행 하나를 추가하되, 기존 1번 행("이미지 재로드")에서 그 버튼을
  새 행으로 옮겨 미리듣기 버튼 2개와 묶는다. `question_answer_type_select_menu`(문제 유형 선택)는
  맨 아래로 옮긴다. 확정된 최종 5행 순서:
  1. 기본 정보 설정 / 추가 정보 설정 / 정답 공개 설정 (기존 `question_edit_comp`에서 이미지 재로드 제외)
  2. **(신규)** 이미지 재로드 / 문제용 오디오 미리듣기 / 정답용 오디오 미리듣기
  3. 새로운 문제 추가 / 현재 문제 복제 / 현재 문제 삭제 (`question_edit_comp2`, 변경 없음)
  4. 이전 문제 / 뒤로가기 / 다음 문제 (`question_control_btn_component`, 변경 없음)
  5. 문제 유형 선택(select menu) — 기존 2번 위치에서 맨 아래로 이동

**실제 구현 요약(2026-08-07)**:
- `quizbot/managers/audio_cache_manager.ts`에 `generatePreviewClipStream(cache_file_path, audio_start_point, audio_length_sec)` 추가 — `fluent-ffmpeg` `-c copy`로 잘라 `PassThrough` 스트림으로 반환(디스크에 파일 안 씀).
- `quizbot/quiz_ui/components/custom_quiz_components.ts`: `question_edit_comp`에서 "이미지 재로드" 제거, 새 `question_preview_comp`(이미지 재로드/문제용 미리듣기/정답용 미리듣기) 추가·export(`components.js` 재수출 개수 61→62, `test/quiz_ui/components.test.js` 갱신).
- `quizbot/quiz_ui/user-question-info-ui.ts`: `initializeComponents()`가 5행 순서(위 목록)로 조립. `sendAudioPreview(interaction, audio_url, custom_audio_start, custom_audio_end, max_play_time, file_label)` 메서드가 캐시 조회→(없으면 다운로드 트리거+에페메럴 안내)→구간 클램프(`prepare.js`의 `generateAudioResourceFromWeb`과 동일한 클램프 로직, 서버별 `audio_play_time` 옵션 대신 `SYSTEM_CONFIG.MAX_QUESTION_AUDIO_PLAY_TIME`/`MAX_ANSWER_AUDIO_PLAY_TIME` 사용 — DM에는 특정 길드 옵션이 없어서)→클립 생성→에페메럴 첨부까지 전부 처리. `question_preview`/`answer_preview` 버튼이 각각 이 메서드를 호출.
- 실제 캐시 파일(`resources/cache/`)로 `-c copy` 클립을 만들어 `ffmpeg -i`로 재검증 — 요청한 구간과 정확히 일치하는 duration의 유효한 webm/opus 파일 생성 확인(스모크 테스트, 회귀 테스트로 별도 등록은 안 함 — UI 클래스는 관례상 유닛테스트 대상 아님).

### B-2-1. 공통 UX 이슈 — DM 편집 중 "메시지 밀림" 문제 (확정 방침, 미리듣기 착수 전 필독)

**문제**: 퀴즈만들기(DM) 도중 봇이 별도 메시지(예: 설정 확인 토스트, 앞으로 추가될 미리듣기 결과 등)를 보내면,
그 메시지가 새로 쌓이면서 편집 중이던 카드가 스크롤 위로 밀려 올라가 불편함.

**확정 방침(문제 미리듣기부터 바로 적용, 다른 기존 토스트 전체 리팩터는 이번 범위 아님)**:
- **미리듣기는 새 메시지를 절대 만들지 않는다.** 캐시가 있어서 클립을 바로 보낼 수 있든, 캐시가 없어서
  "다운로드 중" 상태를 보여줘야 하든, **항상 지금 편집 중인 그 카드 자체를 `edit()`으로 갱신**한다
  (캐시 없음 → 카드 footer/description에 "⏳ 오디오 준비 중입니다, 잠시 후 다시 눌러주세요" 표시만 하고 끝;
  캐시 있음 → 같은 카드에 클립 파일을 첨부해서 갱신).
- 이렇게 하면 미리듣기 기능 자체가 "메시지 밀림" 문제를 새로 더 키우지 않음.
- **기존에 이미 있는 다른 토스트들(예: 옵션 저장 확인, 문제 추가 완료 등)까지 전부 이 방식으로 바꾸는 건
  이번 계획 범위 밖** — 파일이 많고(quiz_ui 전반) 영향도 커서 별도로 검토 필요. 다만 **앞으로 새로 추가하는
  기능(문제 복제 등)은 가능하면 새 토스트 대신 카드 자체 갱신으로 피드백을 주는 걸 기본 원칙으로 삼는다.**

### B-3. 퀴즈(전체) 복제 — 보류, 악용 가능성 선결 필요

**보류 사유(사용자 지적)**: 악의적 유저가 이미 있는 인기 퀴즈를 반복 복제해서 퀴즈 목록을 스팸으로 도배하는
"퀴즈 목록 테러"가 가능해짐. 지금까지 그런 사례는 없었지만, 복제 버튼으로 그 공격이 훨씬 쉬워짐.

**근본 대응 방안 검토** (실제 착수 전 먼저 결정해야 함):
1. **사실 이 공격은 지금도 가능함을 먼저 인지**: 복제 기능이 없어도 지금 `/퀴즈만들기`로 하나씩 만들면
   동일한 스팸이 이미 가능함. 즉 근본 원인은 "복제"가 아니라 **"퀴즈 생성 자체에 빈도 제한이 없다"**는 것.
   → **유저별 퀴즈 생성 개수/빈도 제한**(예: 하루 N개, 또는 계정당 보유 가능한 미인증 퀴즈 총 개수 제한)을
   먼저 두면 복제든 수동 생성이든 스팸 자체가 막힘. 이게 가장 근본적인 해법.
2. **복제본은 무조건 비공개로 시작**(원래 계획에도 있었음) — 목록 스팸이 실제로 "먹히려면" 공개 전환까지
   가야 하는데, 그 자체가 한 단계 추가 마찰이 됨.
3. **(선택) 공개 전환 시 유사 퀴즈 감지**: 제목/문제 구성이 기존 공개 퀴즈와 거의 동일하면 공개 전환 시 경고.
   1번보다 구현이 크고 복제 스팸에만 특화된 대응이라 우선순위는 낮음.

**결론**: 1번(생성 빈도 제한)이 자리잡기 전까지 **퀴즈 전체 복제 기능은 만들지 않음**. 대신 아래 B-3'으로 대체.

### B-3'. 문제(단일) 복제 — ✅ **완료** (2026-08-07)

퀴즈 복제와 달리 **내가 이미 만들고 있는 퀴즈의 문제 목록 안에서만** 일어나는 동작이라, 공개 목록 스팸
가능성이 전혀 없음(기존 50문제 상한도 그대로 적용됨). 사용자가 원래 의도했던 것도 이쪽.

- **UI 배치**: `user-question-info-ui.js`의 `question_edit_comp2`(현재 [새로운 문제 추가 / 현재 문제 삭제]
  2버튼)에 "현재 문제 복제" 버튼 추가 → 3개, 5개 한도 안에 여유 있음.
- **구현 개요**: 현재 보고 있는 문제의 `data` 전체를 복사해 새 `UserQuestionInfo`로 저장, `question_list`의
  바로 다음 위치에 삽입, 화면을 그 복제본으로 이동. 이미 50개 꽉 찼으면 차단(기존 "문제 추가" 시 50개 제한
  로직과 동일한 가드 재사용).

### B-4. 채팅 정지 시 사유/취소 알림 — ✅ **완료** (2026-08-07)

- **현재 상태**: `report_processing_core.js`의 `applyBan`이 성공해도, **밴 당사자에게는 아무 DM도 안 감**
  (관리자에게는 처리 요약, 신고자에게는 "처리 완료됐습니다"만 감). 실제 유저 문의("그냥 대화만 했는데
  정지먹었다")가 바로 이 구조 때문으로 추정.
- **설계 답**: 신고 처리가 애초에 `chat_id`(메시지 1개) 단위로 하나씩 이뤄지므로, "밴카운트가 누적됐을 때
  어느 원문을 보여줄지" 고민할 필요 없이 **처리 시점마다 그 건의 원문으로 그때그때 개별 알림**을 보내면 됨.
- **제재 취소 시에도 알림 추가**(신규 요청 반영): `report_manual_processing.js`의 `processFollowUpAction`
  (`report_manual_processing.js:198~`)이 "밴 취소"(`ps_flwup_user_unban_`)와 "밴 추가"(`ps_flwup_user_ban_`)를
  **같은 `applyBan(chat_info.user_id, ban_count)` 호출 하나**로 처리하고 있어서(취소는 `ban_count=-1`, 추가는
  `+1`), 알림 함수 하나를 만들어 밴/추가처벌/취소 세 경우 모두 이 지점 하나에서 호출하면 됨 — 별도 분기 불필요.
- **이의 제기 방법 문구는 제외**(신규 요청 반영 — 문의가 많아지는 걸 피하기 위함).
- **구현 지점**: `report_processing_core.js`에 알림 함수 추가(예: `notifyBannedUser(user_id, chat_content, ban_history, action_label)`), 호출 지점 2곳: `auto_report_processing.js`(자동 처리, 이미 `content` 보유)의 `applyBan` 성공 직후, `report_manual_processing.js`의 `processFollowUpAction`(취소/추가처벌) 및 최초 처벌 처리 지점.
- 내용 초안(이의 제기 문구 제외 반영): "정지/취소된 사유(원문) + 현재 총 정지 횟수 + 정지 만료일(취소 시에는
  '정지가 취소되었습니다'로 대체)".

**실제 구현하면서 계획과 달라진/추가된 것**: `processFollowUpAction`(취소/추가처벌) 시점엔 원문 채팅 내용을
들고 있는 값이 없음(신고 로그는 처리 시 `deleteReportedLog`로 이미 삭제됨) — 다만 `tb_chat_info` row 자체는
`result` 컬럼만 갱신될 뿐 삭제되지 않고 남아있는 걸 확인해서, `db_report.ts`에 `selectChatInfoById(chat_id)`
쿼리를 새로 추가해 원문을 재조회하도록 함(`db_manager.js` 재수출 개수 테스트도 32→33으로 갱신). 호출 지점은
계획대로 3곳: `auto_report_processing.ts`(자동 처리), `report_manual_processing.ts`의 `processReportLog`
(최초 처벌)와 `processFollowUpAction`(취소/추가처벌) — 길드밴(`GUILD_BANNED`) 분기는 개인 알림 대상이
아니므로 제외.

---

## 향후 TODO (이번 계획 범위 아님 — 참고용 기록만)

- **프리셋 기능**: TS 전환 완료 후 별도 계획서로 다시 착수(이번 대화에서 확정).
- **랭크 시즌 정보 노출**: 현재 시즌 초기화를 수동으로 하고 계셔서, 자동화/노출 기능은 나중에.
- **밴 이력 조회 기능(본인이 자기 밴 이력 확인)**: B-4(정지 사유 알림)와 세트로 나중에.
- **퀴즈(전체) 복제**: B-3에서 제안한 "유저별 생성 빈도 제한"이 먼저 자리잡으면 재검토.
- **(신규) 유저별 퀴즈 생성 빈도 제한**: B-3 논의 중 발견된, 복제 기능과 무관하게 지금도 존재하는 잠재
  스팸 취약점. 이번 계획 범위는 아니지만 퀴즈 복제 재검토의 전제 조건이라 TODO로 등록.

---

## 권장 실행 순서 (2026-08-07 기준 갱신)

1. **A-2(TS 빌드 파이프라인 선행 작업)** — ✅ 완료.
2. **A-3 1~5단계(멀티플레이 제외 TS 전환)** — ✅ 완료.
3. **B-3'(문제 복제)** — ✅ 완료.
4. **B-4(정지/취소 사유 알림)** — ✅ 완료.
5. **B-2(문제 미리듣기)** — ✅ 완료. 원래 계획했던 `updatePrivateUI` 프레임워크 확장은 에페메럴 응답 방식으로
   대체하면서 불필요해짐(B-2 섹션의 "전달 방식" 참고).
6. **B-1(문제 일괄 등록)** — 미착수. 포맷 스펙/Import 정책/에러 메시지 상세도 3가지 결정이 보류 중
   (`B1_BULK_IMPORT_EXPORT_TODO.md` 참고). 다른 작업과 병행하기보다 결정부터 마무리한 뒤 한 번에
   설계→구현→테스트를 권장.
7. **A-3 6단계(멀티플레이 TS 전환)** — 실전 대결 테스트 완료 후 맨 마지막(아직 보류).

우선순위나 순서 조정하고 싶으신 부분 있으면 말씀해주세요.
