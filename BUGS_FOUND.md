# 발견된 버그 로그

> 구조 개편(REFACTOR_PLAN.md) 진행 중 발견한 버그를 기록한다.
> 사소하고 국소적인 버그는 발견한 Phase 내에서 바로 수정(별도 `fix:` 커밋)하고, 파급 범위가 크거나 불확실한 버그는 상태를 `보류`로 두고 우선순위를 논의한다.
> 규칙: REFACTOR_PLAN.md 2.3절.

## 기록 양식

```
### [Phase 번호] 짧은 제목

- 파일/위치: `path/to/file.js:123`
- 발견일: YYYY-MM-DD
- 재현 조건: ...
- 실제 동작: ...
- 기대 동작: ...
- 상태: 미수정 | 수정 완료 (커밋 <hash>) | 보류 (사유)
- 비고: (선택)
```

---

## 목록

### [Phase 1] `getQuestionListByTags`의 반환 타입 불일치 (limit <= 0)

- 파일/위치: `quizbot/managers/tagged_dev_quiz_manager.js:65-97` (수정 전 기준)
- 발견일: 2026-08-03
- 재현 조건: `getQuestionListByTags(tags_value, limit)`을 `limit <= 0`("무제한"을 뜻하는 값, 파라미터 기본값도 0)으로 호출.
- 실제 동작: 다른 모든 경로(`tags_value == 0`일 때, `limit > 0`일 때)는 `[total_question_count, question_list]` 형태의 2-tuple을 반환하는데, `limit <= 0`일 때만 `question_list` 배열 하나만 반환함. 호출부(`quiz_system.js:2882, 2893`)는 항상 `[count, list] = getQuestionListByTags(...)` 형태로 구조분해하므로, 만약 `limit`이 0으로 넘어오면 `count`에 질문 객체 0번째가, `list`에 질문 객체 1번째가 잘못 할당됨.
- 기대 동작: `limit` 값과 무관하게 항상 `[total_question_count, question_list]` 형태로 반환.
- 상태: 수정 완료 (커밋 `6acf6d6`) — 항상 `[total_question_count, list]` 튜플을 반환하도록 통일.
- 비고: 실제 호출부에서는 `limit = selected_question_count * 2`로 항상 양수 값을 넘기고 있어 지금까지 실제로 트리거된 적은 없는 잠재 버그(latent bug)였음.

### [Phase 1] `feedback_manager.do_event` → `addQuizLikeAuto` 인자 불일치 (죽은 코드)

- 파일/위치: `quizbot/managers/feedback_manager.js:41-46, 127-150`
- 발견일: 2026-08-03
- 재현 조건: `@Deprecated` 표시된 `createDynamicQuizFeedbackComponent`/`do_event` 경로가 실제로 호출되는 경우 (grep 결과 코드베이스 어디서도 호출되지 않음 — 죽은 코드).
- 실제 동작: `do_event`가 `exports.addQuizLikeAuto(guild_id, interaction.member, target_quiz.quiz_id, target_quiz.quiz_title)`로 호출하는데, `addQuizLikeAuto`의 시그니처는 `(interaction, quiz_id, quiz_title)`. 즉 첫 인자로 `interaction` 객체가 아닌 `guild_id`(문자열)가 들어가 함수 내부 `interaction.guild.id` 접근에서 `TypeError`가 발생함.
- 기대 동작: 호출 시그니처가 일치해야 함.
- 상태: 보류 — 두 함수 모두 `@Deprecated` 표시된 죽은 코드(어디서도 호출 안 됨)라 런타임 영향 없음. 삭제할지, 시그니처만 맞춰둘지는 별도 논의 필요.

### [Phase 1] `UserQuizInfo.addLike`에서 `user_id` 인자 누락 (죽은 코드)

- 파일/위치: `quizbot/managers/user_quiz_info_manager.js:172-176`
- 발견일: 2026-08-03
- 재현 조건: `@Deprecated` 표시된 `UserQuizInfo.addLike(guild_id, user_id)`가 실제로 호출되는 경우 (grep 결과 어디서도 호출되지 않음 — 죽은 코드).
- 실제 동작: `feedback_manager.addQuizLike(this.quiz_id, guild_id)`로 2개 인자만 전달하지만 `addQuizLike`의 시그니처는 `(quiz_id, guild_id, user_id)`. `user_id`가 `undefined`로 들어가 `addQuizLike` 내부 가드(`user_id == undefined`)에 걸려 항상 `false`를 반환하게 됨.
- 기대 동작: `user_id`까지 전달되어야 함.
- 상태: 보류 — `@Deprecated` 표시된 죽은 코드라 런타임 영향 없음. 삭제할지, 시그니처만 맞춰둘지는 별도 논의 필요.
