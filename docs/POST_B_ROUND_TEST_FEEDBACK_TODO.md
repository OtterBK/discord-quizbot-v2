# B단계(A-5/B-2/B-3'/B-4) 전수 테스트 피드백 — 작업 대기 목록

> 2026-08-07, `docs/TS_MIGRATION_AND_CONVENIENCE_PLAN.md`의 A-5/B-2/B-3'/B-4까지 구현한 뒤 사용자가
> 멀티플레이 포함 전수 테스트를 진행하고 남긴 피드백 12건. **사용자 지시로 이번 세션엔 착수하지 않고
> 기록만 해둠(토큰 예산 이유) — 다음 세션에서 우선순위 정해서 하나씩 처리할 것.**
>
> 대부분은 코드 위치까지 특정해뒀으니 바로 착수 가능. 7/8/11/12번은 조사부터 필요한 순수 TODO.

---

## 1. 퀴즈만들기 메시지 전체를 ephemeral로 (버그 + 정책)

**직접 계기**: `user-quiz-info.ui.ts:321` — 태그 미선택 상태로 공개 전환 시도 시 뜨는 안내가
`interaction.user.send({..., flags: MessageFlags.Ephemeral})`로 돼있는데, **`flags`는 인터랙션
응답(`interaction.reply`/`deferReply`/`followUp`)에서만 동작하고 `user.send()`(순수 DM 전송)에는
아무 효과가 없음** — 즉 지금 저 메시지는 ephemeral이 아니라 그냥 평범한 DM. `interaction.reply({..., flags: MessageFlags.Ephemeral})`로 바꿔야 실제로 적용됨.

**확장 요청**: 퀴즈만들기(`/퀴즈만들기` 진입 이후 전체 화면 — `user-quiz-list-ui.ts`, `user-quiz-info.ui.ts`,
`user-question-info-ui.ts`, `user-quiz-select-ui.ts`, `quiz-tool-guide-ui.ts`)에서 유저에게 보내는
**모든** 메시지를 유저가 직접 지울 수 있는 ephemeral로 통일. 위 5개 파일 전체를 훑어서 `interaction.reply(`/`interaction.user.send(`/`modal_interaction.reply(` 호출부 중 `flags: MessageFlags.Ephemeral`
없는 곳을 전부 찾아 적용 필요(전수 조사 필요, 위 1개는 발견된 예시일 뿐).

---

## 2. "이미지 재로드" 버튼 스타일을 미리듣기 버튼과 통일

`quizbot/quiz_ui/components/custom_quiz_components.ts`의 `question_preview_comp` — "이미지 재로드"
버튼만 `ButtonStyle.Primary`고 옆의 "문제용/정답용 오디오 미리듣기" 2개는 `ButtonStyle.Secondary`라
같은 행인데 스타일이 안 맞음. "이미지 재로드"를 `ButtonStyle.Secondary`로 맞추면 됨.

---

## 3. 미리듣기: 랜덤 구간 재생일 때 안내 문구 추가

`quizbot/quiz_ui/user-question-info-ui.ts`의 `sendAudioPreview()` — `custom_audio_start`가
`undefined`라 `audio_start_point = 0`으로 처리되는 분기(= 문제에 오디오 구간을 지정 안 해서 실제
게임에서는 랜덤 구간이 재생되는 경우)일 때, 지금은 그냥 0초부터 보내면서 아무 설명이 없음.
"실제 게임에서는 이 구간 중 무작위로 재생됩니다" 같은 뉘앙스를 응답 문구에 추가할 것
(`convertAudioRangeToString()`이 이미 쓰는 "[랜덤 구간 재생]" 표현과 톤 맞추기).

---

## 4. 미리듣기 연타 시 같은 오디오를 중복 다운로드 시도

**재현 로그**:
```
[warn] [AudioCacheManager] : https://youtu.be/.../fLl1EgWv6jE...'s cache is already exist
[debug] [AudioCacheManager] : rewriting info file fLl1EgWv6jE.info.json
[warn] [AudioCacheManager] : ...'s cache is already exist   (몇 초 뒤 또)
```
캐시 없는 오디오로 미리듣기를 여러 번 누르면 `sendAudioPreview()`가 매번
`audio_cache_manager.downloadAudioCache(...)`를 새로 호출함 — yt-dlp가 "이미 있음"으로 방어는 되지만,
**애초에 같은 `video_id`가 다운로드 진행 중이면 yt-dlp 프로세스 자체를 다시 안 띄우는 게 맞음** (불필요한
프로세스 스폰 + 파일 I/O 반복). `audio_cache_manager.ts`에 "현재 다운로드 진행 중인 video_id" 추적용
Map/Set(예: `downloading_video_ids`)을 두고, `downloadAudioCache` 호출 전에 이미 진행 중이면 그 Promise를
그대로 재사용하거나(진행 중이니 기다리게) 스킵하는 가드 필요. 미리듣기뿐 아니라 다른 다운로드 트리거 경로
(실제 게임 재생 `prepare.ts`)에도 이론상 같은 레이스가 있을 수 있어 공통 가드로 만드는 게 나음.

---

## 5. 문제 복제 시 "Interaction has already been acknowledged" 에러 (원인 특정 완료)

**재현 로그**:
```
Unhandled promise rejection!!! reason: DiscordAPIError[40060]: Interaction has already been acknowledged.
    at async ButtonInteraction.deferUpdate (...InteractionResponses.js:305:22)
```

**원인**: `user-question-info-ui.ts`의 `duplicateQuestion()` — 50개 제한 분기/`source_question_info`
undefined 분기는 `interaction.explicit_replied = true`를 **await 전에(동기적으로)** 설정하지만, 성공
경로는 `await user_question_info.saveDataToDB()` **이후에야** `explicit_replied`를 설정함. 그 사이
(await 대기 중) `bot.js:518~527`의 전역 fallback이 "아직 아무도 응답 안 했다"고 판단해서 먼저
`interaction.deferUpdate()`를 호출해버림 → 나중에 `duplicateQuestion()`이 재개돼서 또
`interaction.deferUpdate()`를 호출하면 이미 응답된 인터랙션이라 위 에러 발생. 기능 자체(복제)는 DB
저장/화면 갱신이 다 끝난 뒤 일어나는 일이라 정상 동작하지만, 이 에러가 계속 로그에 쌓임.

**같은 문제를 이미 겪고 고친 전례**: `multiplayer-quiz-select-ui.js:159`에
`interaction.explicit_replied = true; //IPC 응답 기다리는 동안 전역 fallback이 먼저 deferUpdate 하지 않도록 미리 표시`
주석과 함께 정확히 이 패턴으로 고쳐져 있음.

**수정 방법**: `duplicateQuestion(interaction: any)` 함수의 **맨 첫 줄**에
`interaction.explicit_replied = true;`를 두면 됨(현재처럼 각 분기 안에서 나중에 설정하지 말고). 한 줄
이동으로 끝나는 수정. `sendAudioPreview()`는 이미 첫 줄에서 설정하고 있어서 이 레이스 없음 — 참고용으로
비교해볼 것.

---

## 6. 유저 퀴즈 목록 정렬 드롭다운 텍스트 개선

현재 "업데이트순/인기순/추천순/최신순/오래된순" — 사용자가 표현이 어색하다고 지적. 정확히 어느 파일/컴포넌트인지는
`user-quiz-select-ui.ts` 또는 관련 select menu 컴포넌트(`quiz_ui/components/*`)에서 정렬 옵션 라벨을
찾아서 확인 필요(이번 세션에서 정확한 위치까지는 특정 안 함). 대안 문구는 다음 세션에서 사용자와 논의.

---

## 7. (TODO만, 조사 필요) webm 오디오 시작 지점이 부정확함

10초로 지정해도 실제로는 ±3초 정도 어긋남. `SeekStream`/`WebmSeeker.js`가 정확한 클러스터 오프셋이
아니라 **비트레이트 추정치 기반**(`per_sec_bytes = bitrate / 8`)으로 바이트 위치를 계산하는 구조라
(`utility/SeekStream/SeekStream.js`의 `loop()` 참고) 원천적으로 근사치일 수밖에 없어 보임 — webm 자체
한계인지, 계산 로직 개선 여지가 있는지 조사 필요. `utility/CLAUDE.md`에 "고위험 바이너리 파싱 영역"으로
이미 표시돼 있어 손댈 때 특히 신중해야 함.

---

## 8. (TODO만, 조사 필요) 미리듣기와 실제 퀴즈 재생 구간이 서로 다름

100~140초 지정 시: 미리듣기는 90~137초, 실제 퀴즈는 97초~137초로 재생됨. 7번(SeekStream 부정확성)을
감안해도 **두 경로가 같은 캐시 파일, 같은 클램프 로직을 쓰는데 왜 미리듣기 클립이 7초 더 긴지**(40초가
아니라 47초) 이론상 설명이 안 됨 — `sendAudioPreview()`(미리듣기, `-c copy` ffmpeg 트림)와
`prepare.ts`의 `generateAudioResourceFromWeb()`/`SeekStream`(실제 재생) 두 경로의 구간 계산 로직을
나란히 놓고 비교 조사 필요. ffmpeg `-c copy`가 키프레임 경계로 스냅되면서 앞뒤로 패딩이 붙는 것인지,
클램프 계산식 자체가 다른지부터 확인.

---

## 9. 멀티플레이 로비 문제 수 설정 — "최대 50개" 문구가 실제 한도(60개)와 불일치

로비 생성 화면에 "최대 50개"라고 표시되지만 실제 설정 가능한 최대값은 60개. 텍스트를 60으로 통일.
(참고: 유저 제작 퀴즈의 문제 개수 자체 상한은 50개가 맞음(`user-question-info-ui.ts`) — 이건 멀티플레이
로비의 "몇 문제 낼지" 설정값이라 별개의 숫자.)

---

## 10. 멀티플레이 퀴즈 설명에 "/퀴즈로 UI 재생성 가능" 안내 추가

현재 문구:
```
선택 메뉴에서 플레이하실 퀴즈 장르나 항목을 선택해주세요!
선택하신 퀴즈에서 무작위로 문제를 제출합니다.

'/챗' 명령어로 전체 대화가 가능합니다.
```
채팅이 밀려서 UI 카드가 스크롤 위로 올라갔을 때 대응용으로, "`/퀴즈` 명령어를 다시 입력하면 UI를 새로
받을 수 있습니다" 같은 안내 한 줄 추가. 정확한 위치는 `quiz-info-ui.ts` 계열(멀티플레이 로비 설명이
`MultiplayerQuizLobbyUI`에서 조합되는 지점) 확인 필요.

---

## 11. (TODO만) MMR 시스템 개선

`quizbot/managers/multiplayer_mmr.js`(`calcWinnerMMR`/`calcLoserMMR`) — 현재 로직 평가 및 개선 필요성
검토. 구체적으로 뭐가 문제인지는 아직 정리 안 됨, 다음 세션에서 사용자와 논의부터 시작.

---

## 12. (TODO만) 공식/유저 퀴즈 무작위 추첨 알고리즘 평가

오마카세/멀티플레이 등에서 공식 퀴즈·유저 퀴즈 풀 중 무작위로 문제를 뽑는 알고리즘
(`db_quiz.ts`의 `selectRandomQuestionListByTags`/`selectRandomQuestionListByBasket` 등이 관련될
것으로 추정) 평가 및 개선 필요성 체크. 구체적 불만 사항은 아직 정리 안 됨, 다음 세션에서 논의부터 시작.
