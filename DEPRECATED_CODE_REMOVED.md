# 삭제된 죽은 코드 로그

> REFACTOR_PLAN.md Phase 1~5 진행 중 발견한, 코드베이스 어디서도 호출/참조되지 않는 죽은 코드를
> Phase 6(최종 정리)에서 삭제하며 원문을 보존해두는 문서. `RELOCATED_COMMENTS.md`와 취지는 같지만
> (코드가 사라지면서 딸린 주석도 갈 곳이 없어짐), 여기서는 주석뿐 아니라 삭제된 코드 전체와
> "왜 죽은 코드로 판단했는지"까지 함께 남긴다.
> 삭제 전 반드시 `grep`으로 코드베이스 전체(테스트 포함)에서 참조가 없음을 재확인했다.

## 기록 양식

```
### 원본 파일:라인 — 짧은 설명

- 원본 위치: `path/to/file.js:123-127`
- 삭제일: YYYY-MM-DD
- 죽은 코드 판단 근거: (grep 결과 등)
- 원문:
  ```js
  (삭제된 코드 그대로)
  ```
- 관련 커밋: <hash>
```

---

## 목록

### `multiplayer_signal_handlers.js:66-69` — `isServerSignal`

- 원본 위치: `quizbot/managers/multiplayer_signal_handlers.js:66-69` (Phase 3에서 `multiplayer_manager.js`로부터 그대로 이동해온 코드)
- 삭제일: 2026-08-04
- 죽은 코드 판단 근거: `isClientSignal`의 짝 함수로 선언돼 있지만 `export`되지 않고, 이 파일뿐 아니라 코드베이스 어디서도 호출되지 않음(`grep -rn "isServerSignal"` 결과 정의부와 파일 상단 설명 주석 외 매치 없음). BUGS_FOUND.md `[Phase 3] onSignalReceived의 isClientSignal 검증이 항상 통과함` 항목에서 처음 발견.
- 원문:
  ```js
  function isServerSignal(signal) 
  {
    return (signal & 0x80) !== 0;  // 최상위 비트가 1이면 서버 시그널
  }
  ```
- 관련 커밋: `62c4839`

### `quizbot/quiz_ui/components/base_components.js:245-255` — `note_ui_component`

- 원본 위치: `quizbot/quiz_ui/components/base_components.js:245-255` (Phase 4에서 원본 `quiz_ui/components.js`로부터 그대로 이동해온 코드)
- 삭제일: 2026-08-04
- 죽은 코드 판단 근거: `module.exports`에 포함돼 `components.js` facade를 통해서까지 재수출되고 있었지만, `grep -rn "note_ui_component"` 결과 이 파일의 선언/export 외에 코드베이스 어디서도 import/사용되지 않음. DUPLICATE_UI_PATTERNS.md의 "죽은 export" 항목에서 처음 발견.
- 원문:
  ```js
  const note_ui_component = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('notice')
        .setLabel('공지사항')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('patch_note')
        .setLabel('패치노트')
        .setStyle(ButtonStyle.Secondary),
    );
  ```
- 관련 커밋: `62c4839`

### `feedback_manager.js:26-27, 39-46, 127-150` — `feedback_quiz_info_map` / `createDynamicQuizFeedbackComponent` / `do_event`

- 원본 위치: `quizbot/managers/feedback_manager.js:26-27, 39-46, 127-150`
- 삭제일: 2026-08-04
- 죽은 코드 판단 근거: 셋 다 `@Deprecated` 주석이 붙어 있고, `grep -rn "do_event\|createDynamicQuizFeedbackComponent"` 결과 정의부 외 호출부가 코드베이스 어디에도 없음. `feedback_quiz_info_map`도 이 두 함수에서만 읽고/쓰므로 함께 죽은 코드. 실제로 `do_event`를 호출하면 `addQuizLikeAuto(guild_id, interaction.member, ...)`처럼 `interaction` 객체 자리에 `guild_id`(문자열)를 넘겨 `addQuizLikeAuto` 내부 `interaction.guild.id` 접근에서 `TypeError`가 나는 버그도 있었음 (BUGS_FOUND.md `[Phase 1] feedback_manager.do_event → addQuizLikeAuto 인자 불일치` 항목).
- 원문:
  ```js
  //@Deprecated
  const feedback_quiz_info_map = {}; //dynamic quiz feedback을 위해 사용

  //@Deprecated
  //퀴즈 id별 custom_id 설정한 comp 생성
  exports.createDynamicQuizFeedbackComponent = (guild_id, quiz_id, quiz_title, creator_name) => 
  {
    feedback_quiz_info_map[guild_id] = {quiz_id: quiz_id, quiz_title: quiz_title, creator_name: creator_name};

    return exports.quiz_feedback_comp;
  };

  exports.do_event = (event_name, interaction) =>
  {
    if(interaction.custom_id != 'like')
    {
      return false;
    }

    const guild_id = interaction.guild.id;
    if(feedback_quiz_info_map.hasOwnProperty(guild_id) == false)
    {
      return false;
    }

    if(event_name != CUSTOM_EVENT_TYPE.interactionCreate)
    {
      return false;
    }

    const target_quiz = feedback_quiz_info_map[guild_id];

    exports.addQuizLikeAuto(guild_id, interaction.member, target_quiz.quiz_id, target_quiz.quiz_title);

    return true;
  };
  ```
- 관련 커밋: `62c4839`

### `user_quiz_info_manager.js:172-176` — `UserQuizInfo.addLike`

- 원본 위치: `quizbot/managers/user_quiz_info_manager.js:172-176`
- 삭제일: 2026-08-04
- 죽은 코드 판단 근거: `@Deprecated` 주석이 붙어 있고, `grep -rn "addLike"` 결과 이 메서드 정의부 외 호출부가 코드베이스 어디에도 없음. 호출한다 해도 `feedback_manager.addQuizLike(this.quiz_id, guild_id)`처럼 `user_id`를 빠뜨려 넘기는 버그가 있어(내부 가드에 걸려 항상 `false` 반환) 실제로 쓰였어도 정상 동작하지 않았을 코드 (BUGS_FOUND.md `[Phase 1] UserQuizInfo.addLike에서 user_id 인자 누락` 항목).
- 원문:
  ```js
  //@Deprecated
  async addLike(guild_id, user_id)
  {
    return await feedback_manager.addQuizLike(this.quiz_id, guild_id);
  }
  ```
- 관련 커밋: `62c4839`
