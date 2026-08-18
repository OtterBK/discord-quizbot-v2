# 퀴즈함 50개 확장 + 프리셋 관리 UI 신설 (독립 화면 분리) 작업계획서

> ✅ **2026-08-18 구현 완료(오마카세 한정, 코드/자동테스트 레벨만 — 실사용 미검증).** 같은 날 설계
> 확정 → 같은 날 바로 구현까지 완료. **범위 조정 1건**: 구현 착수 시 멀티플레이 로비
> (`multiplayer-quiz-lobby-ui.js`)도 동일한 `BASKET_CACHE` 로직을 복사해서 쓰고 있고 바구니 변경 시
> IPC 브로드캐스트(`sendEditLobbySignal`)까지 필요해 오마카세보다 위험하다는 걸 발견 — 사용자와 상의해
> **오마카세만 이번에 진행, 멀티플레이는 별도 작업으로 명시적으로 미룸**(아래 "미결정 사항"/"예상 파일
> 변경 목록"은 이 조정 전 초안이라 일부는 실제 구현과 다를 수 있음 — 실제 구현 내역은
> `docs/COMPLETED_WORK_LOG.md` 2026-08-18 항목이 최신). **같은 날 두 번째 후속**: 사용자가 상세 플로우를
> 다시 정리해줘서 방장 권한 모델(라이브 퀴즈함은 방장만, "프리셋 관리"는 누구나) + 프리셋 자체 편집
> (이름변경/항목제거, 신규 DB 함수 2개 - 웹 UI엔 아직 없는 기능)을 추가 구현 완료 — 아래 본문은 이
> 두 번째 후속 이전의 더 단순한 초안이라, 최신 상태는 `docs/COMPLETED_WORK_LOG.md`의 같은 날 두 번째
> 항목을 볼 것. 상세 검증은 `docs/TEST_CHECKLIST.md` AG섹션(방장 권한 분기 + 프리셋 관리 세부
> 플로우까지 반영해 전면 갱신됨).
> **`DISCORD_UI_SEPARATION_AUDIT_PLAN.md`(같은 날 신설)의 1호 적용 사례** — 그 문서가 정의한 "독립
> ephemeral 화면 분리" 패턴을 여기서 처음 적용.
> **✅ 2026-08-19 멀티플레이 로비까지 이식 완료** — 위에서 "별도 작업으로 미룸"이라고 적었던 범위가
> 이번에 완료됨(코드/자동테스트 레벨만, 실사용 미검증). `basket-manage-flow.ts`를 오마카세와 100%
> 공용으로 재사용, 상세는 `docs/COMPLETED_WORK_LOG.md` 2026-08-19 항목.

## 배경

랜덤 퀴즈("직접 담기" 모드)의 퀴즈함 기능에 두 가지 요청이 들어옴:

1. 웹 UI는 퀴즈함 개수 제한이 없는데, 디스코드 UI는 25개로 막혀있음 — 50개까지 늘려달라는 요청.
2. 웹 UI에는 이미 있는 "프리셋 저장/불러오기/삭제" 기능이 디스코드 UI엔 아예 없음 — 디스코드에도
   추가해달라는 요청.

처음엔 두 기능을 `OmakaseQuizRoomUI`(메인 퀴즈 설정 화면)에 그대로 욱여넣는 안으로 설계했다가, 그
화면의 컴포넌트 행 예산이 이미 5/5로 꽉 차는 문제를 발견 — 대신 **퀴즈함 관련 기능 전체를 독립된
ephemeral 화면으로 완전히 분리**하기로 재설계함(사용자 결정, 2026-08-18). 이 결정으로 행 예산 문제가
근본적으로 사라짐(새 화면이 자기만의 5행 예산을 통째로 씀).

## 설계 확정: 퀴즈함 = 독립 ephemeral 화면

### 메인 화면(`OmakaseQuizRoomUI`)에 남는 것

바구니 모드일 때 버튼 2개만 남음:
- "퀴즈함에 퀴즈 더 담기"(`use_basket_mode`) — **그대로 유지**, 기존처럼 `UserQuizSelectUI`(영구
  화면, `UIHolder` 스택에 정상적으로 쌓이는 화면 전환)로 진입. 카탈로그 검색/필터가 필요한 큰 흐름이라
  ephemeral 미니 화면엔 안 어울림 — 계속 메인 화면 전환 방식으로 유지.
- "🧺 퀴즈함 보기"(신규, 아래 참고) — 나머지(표시/제거/프리셋 전부)의 유일한 입구.
- 기존 `request_basket_reopen_comp`의 "최근 퀴즈함으로 덮어쓰기"(`load_basket_items`) 버튼은 **삭제**.

### 신규 독립 화면: 퀴즈함 관리 ephemeral 플로우

**중요한 아키텍처 차이**: 이건 기존 `QuizbotUI`/`UIHolder` 프레임워크를 안 씀. `quiz_ui/CLAUDE.md`
프레임워크 조사 결과, 이 앱의 인터랙션 라우팅은 길드/DM 단위로 "현재 떠 있는 화면 하나"에만 연결되고
(`bot.js`의 `getUIHolder(holder_id)` → `holder.on(...)`), `update()`는 항상 그 홀더가 처음에 저장해둔
메시지 하나(`base_interaction`/`base_message`)만 다시 그림 — ephemeral 메시지를 별도로 추적하는
개념이 아예 없음. 그래서 퀴즈함 화면은 `admin-panel-ui.ts`의 `report_manual_processing.sendReportLog`
(버튼 클릭 시 UI 전환 없이 자체적으로 `interaction.reply()`까지 처리하고 끝나는 기존 패턴)와 같은
계열로, **`interaction.reply()`로 최초 ephemeral 응답을 만들고, 그 안의 버튼/셀렉트는
`interaction.update()`(discord.js가 제공하는 "이 컴포넌트가 속한 메시지 자체를 편집"하는 API, 현재
`quiz_ui/` 전체에서 미사용)로 자기 자신만 갱신**하는 새 패턴을 씀 — `QuizbotUI` 상속도, `onReady`/
`onInteractionCreate` 오버라이드도 안 함.

- 진입: 메인 화면 "🧺 퀴즈함 보기" 버튼 핸들러가 `interaction.reply({ephemeral:true, ...})`로 최초
  화면을 띄움. 이때 원본 `OmakaseQuizRoomUI` 인스턴스(`this`)를 클로저로 들고 있어야 함 — 변경 완료
  시점에 메인 화면 동기화(아래)에 필요.
- 화면 구성(최대 5행, 이제 여유로움): 담긴 퀴즈 select(최대 50개 → 25개 넘으면 2행), "💾 프리셋으로
  저장"/"📥 프리셋 불러오기"/"🗑 프리셋 삭제" 버튼 1행, 필요하면 "닫기" 버튼.
- select에서 항목 선택 → 제거(다중 선택 지원, 기존 `setMaxValues` 로직 재사용) → `interaction.update()`로
  같은 ephemeral 메시지를 새 상태로 다시 그림.
- 프리셋 불러오기/저장/삭제 버튼 → 아래 "프리셋 기능" 섹션. 전부 같은 ephemeral 메시지 안에서
  `interaction.update()`(또는 모달 필요 시 `interaction.showModal()` 후 모달 제출에서 원본 메시지를
  `interaction.editReply()`류로 갱신 — discord.js 모달 제출 인터랙션이 원본 메시지를 직접 %update할
  방법 확인 필요, 구현 시 확정)로 처리.
- **메인 화면 동기화**: 퀴즈함 내용이 실제로 바뀔 때마다(추가/제거/프리셋 불러오기), 클로저로 들고
  있는 `room_ui.quiz_info['basket_items']`를 직접 갱신하고 `room_ui.update()`를 호출 — 두 메시지가
  완전히 독립적이라 이렇게 명시적으로 안 챙기면 메인 화면의 "퀴즈함 N개 담김" 문구가 stale해짐(설계
  중 발견한 핵심 함정, 놓치지 말 것).

### 퀴즈함 표시 25개 → 50개 확장

- 담기 상한: `user-quiz-select-ui.ts:42`의 `this.max_basket_size` 25 → 50 (단순 상수 변경).
- 표시: 위 새 ephemeral 화면이 자기 5행을 다 쓸 수 있어서, `omakase_basket_select_menu`를 25개 넘으면
  `cloneDeep`으로 하나 더 만들어 2행(1~25/26~50)으로 나누면 됨 — 예전 설계의 "메인 화면 행 예산
  압박" 문제가 사라졌으므로 페이지네이션(B안, 이전 초안에서 검토했던 대안)은 불필요.

## 프리셋 기능

### 재사용 가능한 기존 자산 (조사 완료, 그대로 씀)

- **DB 계층**: `quizbot/managers/db/db_random_quiz_preset.ts`의 함수 5개
  (`selectRandomQuizPresetsByUser`/`selectRandomQuizPresetByName`/`countRandomQuizPresetsByUser`/
  `insertRandomQuizPreset`/`deleteRandomQuizPreset`) 전부 순수 `user_id: string` 파라미터라 웹 세션과
  무관 — 디스코드 핸들러가 `interaction.user.id`만 넘기면 그대로 재사용 가능. **수정 불필요.**
- **정책**: 유저당 프리셋 최대 10개(TOCTOU-safe INSERT로 이미 DB 레벨에서 강제), 이름 최대 30자,
  퀴즈함 quiz_id 목록만 저장(옵션은 저장 안 함) — 웹과 동일 정책 그대로 따름.

### 새로 필요한 DB 함수 1개

`db_quiz.ts`에 `selectQuizInfoByIds(quiz_id_list: number[])` 신설 — 저장된 `quiz_id_list`(정수 배열)를
`{quiz_id, title}`로 바꿔야 "불러오기" 화면에 제목을 보여줄 수 있음. `selectRandomQuestionListByBasket`이
이미 쓰는 `WHERE quiz_id = ANY($1::int[])` 패턴 재사용, `is_private = false AND is_use = true`인 것만
(삭제되거나 비공개로 바뀐 quiz_id는 "더 이상 사용할 수 없어 제외됨" 처리, 웹의 `OmakaseTab.jsx`와
동일한 필터 기준).

### 저장/불러오기/삭제 UX

- **저장**: "💾 프리셋으로 저장" → 모달(이름 1개, 최대 30자) → `insertRandomQuizPreset` 호출. 이름
  중복은 제출 전 `selectRandomQuizPresetByName`으로 먼저 확인해서 안내(웹과 동일 기준, 최종 방어는
  DB단 TOCTOU-safe INSERT). 퀴즈함 비었거나 10/10 도달 시 버튼 비활성화.
- **불러오기**: 프리셋 select(유저당 최대 10개 → Discord 25개 한도에 걸릴 일 없음, 페이지네이션
  불필요) → 선택 후 "불러오기" → `selectQuizInfoByIds`로 조회 → 유효한 것만 `basket_items`에 **덮어씀
  (기존 내용 대체, 병합 아님 — 웹과 동일 동작)** → 제외된 개수 있으면 "N개 항목은 더 이상 사용할 수
  없어 제외됐어요" 안내.
- **삭제**: 2단계 확인(`admin_notice_delete_confirm_comp`와 동일 패턴) → `deleteRandomQuizPreset`.

## `BASKET_CACHE` — 완전 제거 확정 (2026-08-18)

`QuizInfoUI.BASKET_CACHE`(static, `quiz-info-ui.ts:34`, 길드 단위·유저 구분 없음·재시작 시 초기화되던
임시 캐시)는 프리셋 기능이 사실상 상위 호환이라 **완전히 걷어냄**:
- `quiz-info-ui.ts`의 `BASKET_CACHE` static 필드 자체 삭제.
- `omakase-quiz-room-ui.ts`의 `handleLoadBasketItems` 핸들러 및 이 캐시를 쓰는 모든 참조 삭제.
- `web-handoff-ui.ts`의 `buildOmakaseQuizInfoUI`가 웹에서 오마카세 확정할 때마다 이 캐시를 같이
  갱신하던 코드도 삭제(구현 시 `grep -rn BASKET_CACHE`로 남은 참조 전부 확인).

## 테스트 계획

- 26개 이상 담아서 ephemeral 화면의 select 2행이 정상적으로 뜨는지, 25개 이하면 1행만 뜨는지, 50개
  담기 시도 시 초과 방지되는지.
- ephemeral 화면에서 항목 제거/추가 후 메인 `OmakaseQuizRoomUI` 화면의 "퀴즈함 N개" 문구가 즉시
  갱신되는지(동기화 핵심 회귀 포인트).
- 저장(이름 중복/30자 초과/10/10 도달 시 비활성화)/불러오기(유효한 것만 채워지고 무효 항목 개수
  안내)/삭제(2단계 확인) 각각 정상 동작.
- **웹에서 만든 프리셋을 디스코드에서 불러오기(반대 방향도)** — 유저 단위 저장이라 웹/디스코드 어느
  쪽에서 만들어도 서로 보여야 정상(핵심 회귀 포인트).
- `grep -rn BASKET_CACHE`로 참조가 완전히 사라졌는지 확인(제거 누락 방지).

## 미결정 사항 (착수 전 결정 필요)

1. ~~`BASKET_CACHE` 처리 방안~~ — ✅ 결정 완료(완전 제거, 위 섹션 참고).
2. ~~퀴즈함을 메인 화면에 넣을지 분리할지~~ — ✅ 결정 완료(독립 ephemeral 화면으로 분리).
3. **모달 제출 후 ephemeral 메시지 갱신 방법** — discord.js에서 모달 제출(`ModalSubmitInteraction`)이
   그 모달을 띄운 버튼이 속한 원본 ephemeral 메시지를 직접 수정할 수 있는 정확한 API 조합(예:
   `interaction.update()`가 모달 제출 인터랙션에서도 되는지, 아니면 원본 메시지 참조를 따로 들고
   `interaction.webhook.editMessage(original_message_id, ...)`류를 써야 하는지)을 구현 착수 시 스파이크
   테스트로 먼저 확인 필요 — 계획 단계에서 확정 못 함.
4. **퀴즈함 관리 화면 진입 시마다 새로 `interaction.reply()`할지, 한 번 띄운 뒤 15분(ephemeral 메시지
   상호작용 가능 시간) 동안은 재사용할지** — 단순하게 매번 새로 여는 것으로 시작 추천(상태 관리
   복잡도 최소화), 실사용해보고 불편하면 재검토.

## 예상 파일 변경 목록

- `quizbot/quiz_ui/user-quiz-select-ui.ts` (수정) — `max_basket_size` 25 → 50.
- `quizbot/quiz_ui/basket-manage-flow.ts`(가칭, 신규) — 퀴즈함 ephemeral 화면 전체 로직(표시/추가제거
  select/프리셋 저장·불러오기·삭제), `QuizbotUI` 비상속.
- `quizbot/managers/db/db_quiz.ts` (수정) — `selectQuizInfoByIds` 신설.
- `quizbot/quiz_ui/omakase-quiz-room-ui.ts` (수정) — 버튼 교체("최근 퀴즈함 불러오기" 삭제 → "퀴즈함
  보기" 추가), `handleLoadBasketItems`/`BASKET_CACHE` 관련 코드 삭제.
- `quizbot/quiz_ui/quiz-info-ui.ts` (수정) — `BASKET_CACHE` static 필드 삭제, 기존
  `setupBasketSelectMenu`/`handleBasketSelected`(메인 화면 안에 있던 구버전 표시 로직)는 새 ephemeral
  화면으로 이관 후 삭제.
- `quizbot/quiz_ui/web-handoff-ui.ts` (수정) — `BASKET_CACHE` 갱신 코드 삭제.
- `quizbot/quiz_ui/components/omakase_components.ts` (수정) — `request_basket_reopen_comp` 버튼 교체,
  퀴즈함 관리 화면용 컴포넌트(select/버튼/모달) 신규.
- `test/managers/db_manager.test.js` (export 개수 갱신, `selectQuizInfoByIds` 테스트 추가)
- `test/quiz_ui/components.test.js` (export 개수 갱신)
- `docs/TEST_CHECKLIST.md`/`docs/COMPLETED_WORK_LOG.md`/`docs/ACTIVE_PLAN.md`/관련 `CLAUDE.md` 갱신
  (완료 후, 기존 관행대로)
