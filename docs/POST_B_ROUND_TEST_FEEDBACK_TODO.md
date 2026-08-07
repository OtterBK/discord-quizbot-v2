# B단계(A-5/B-2/B-3'/B-4) 전수 테스트 피드백 — 작업 대기 목록

> 2026-08-07, `docs/TS_MIGRATION_AND_CONVENIENCE_PLAN.md`의 A-5/B-2/B-3'/B-4까지 구현한 뒤 사용자가
> 멀티플레이 포함 전수 테스트를 진행하고 남긴 피드백 12건.
>
> **2026-08-08: 실동작 버그 1/4/5번, UX·텍스트 2/3/6/9/10번 수정 완료** — 상세는
> `docs/COMPLETED_WORK_LOG.md` 2026-08-08 항목 2건 참고. 아래 각 항목 제목에도 완료 표시해둠(원본
> 내용은 기록용으로 그대로 유지).
>
> 남은 항목(7/8/11/12번, 전부 조사·논의부터 필요한 순수 TODO)은 다음 세션에서 진행할 것.

---

## 1. 퀴즈만들기 메시지 전체를 ephemeral로 (버그 + 정책) — ✅ 2026-08-08 수정 완료

**직접 계기**: `user-quiz-info.ui.ts:321` — 태그 미선택 상태로 공개 전환 시도 시 뜨는 안내가
`interaction.user.send({..., flags: MessageFlags.Ephemeral})`로 돼있는데, **`flags`는 인터랙션
응답(`interaction.reply`/`deferReply`/`followUp`)에서만 동작하고 `user.send()`(순수 DM 전송)에는
아무 효과가 없음** — 즉 지금 저 메시지는 ephemeral이 아니라 그냥 평범한 DM. `interaction.reply({..., flags: MessageFlags.Ephemeral})`로 바꿔야 실제로 적용됨.

**확장 요청**: 퀴즈만들기(`/퀴즈만들기` 진입 이후 전체 화면 — `user-quiz-list-ui.ts`, `user-quiz-info.ui.ts`,
`user-question-info-ui.ts`, `user-quiz-select-ui.ts`, `quiz-tool-guide-ui.ts`)에서 유저에게 보내는
**모든** 메시지를 유저가 직접 지울 수 있는 ephemeral로 통일. 위 5개 파일 전체를 훑어서 `interaction.reply(`/`interaction.user.send(`/`modal_interaction.reply(` 호출부 중 `flags: MessageFlags.Ephemeral`
없는 곳을 전부 찾아 적용 필요(전수 조사 필요, 위 1개는 발견된 예시일 뿐).

---

## 2. "이미지 재로드" 버튼 스타일을 미리듣기 버튼과 통일 — ✅ 2026-08-08 수정 완료

`quizbot/quiz_ui/components/custom_quiz_components.ts`의 `question_preview_comp` — "이미지 재로드"
버튼만 `ButtonStyle.Primary`고 옆의 "문제용/정답용 오디오 미리듣기" 2개는 `ButtonStyle.Secondary`라
같은 행인데 스타일이 안 맞음. "이미지 재로드"를 `ButtonStyle.Secondary`로 맞추면 됨.

---

## 3. 미리듣기: 랜덤 구간 재생일 때 안내 문구 추가 — ✅ 2026-08-08 수정 완료

`quizbot/quiz_ui/user-question-info-ui.ts`의 `sendAudioPreview()` — `custom_audio_start`가
`undefined`라 `audio_start_point = 0`으로 처리되는 분기(= 문제에 오디오 구간을 지정 안 해서 실제
게임에서는 랜덤 구간이 재생되는 경우)일 때, 지금은 그냥 0초부터 보내면서 아무 설명이 없음.
"실제 게임에서는 이 구간 중 무작위로 재생됩니다" 같은 뉘앙스를 응답 문구에 추가할 것
(`convertAudioRangeToString()`이 이미 쓰는 "[랜덤 구간 재생]" 표현과 톤 맞추기).

---

## 4. 미리듣기 연타 시 같은 오디오를 중복 다운로드 시도 — ✅ 2026-08-08 수정 완료

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

## 5. 문제 복제 시 "Interaction has already been acknowledged" 에러 (원인 특정 완료) — ✅ 2026-08-08 수정 완료

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

## 6. 유저 퀴즈 목록 정렬 드롭다운 텍스트 개선 — ✅ 2026-08-08 수정 완료

현재 "업데이트순/인기순/추천순/최신순/오래된순" — 사용자가 표현이 어색하다고 지적. 정확히 어느 파일/컴포넌트인지는
`user-quiz-select-ui.ts` 또는 관련 select menu 컴포넌트(`quiz_ui/components/*`)에서 정렬 옵션 라벨을
찾아서 확인 필요(이번 세션에서 정확한 위치까지는 특정 안 함). 대안 문구는 다음 세션에서 사용자와 논의.

---

## 7. (TODO만, 조사 필요) webm 오디오 시작 지점이 부정확함 — ✅ 2026-08-08 원인 특정 + 수정 완료(실제 재생 검증 필요)

10초로 지정해도 실제로는 ±3초 정도 어긋남. `SeekStream`/`WebmSeeker.js`가 정확한 클러스터 오프셋이
아니라 **비트레이트 추정치 기반**(`per_sec_bytes = bitrate / 8`)으로 바이트 위치를 계산하는 구조라
(`utility/SeekStream/SeekStream.js`의 `loop()` 참고) 원천적으로 근사치일 수밖에 없어 보임 — webm 자체
한계인지, 계산 로직 개선 여지가 있는지 조사 필요. `utility/CLAUDE.md`에 "고위험 바이너리 파싱 영역"으로
이미 표시돼 있어 손댈 때 특히 신중해야 함.

**2026-08-08 조사 결과**: webm 자체 한계가 아니었음. `WebmSeeker.js`에 webm 파일 내장 Cues 테이블(실제
timestamp→byte position 매핑)로 정확한 offset을 계산하는 `seek(content_length)` 메서드(71-93번 줄)가
**이미 완성돼 있었는데, 코드베이스 어디서도 호출되지 않는 죽은 코드**였음. 실제 캐시 파일 5개를 직접
바이트 단위로 파싱해서 검증: Cues가 정확히 10초 간격으로 박혀있고(코드의 `Math.floor(sec/10)*10` 가정과
일치), `seek()`가 계산한 byte offset 바로 뒤(12바이트 이내)에 `Cluster` 엘리먼트(`1f43b675`)와 실제
오디오 블록(`0xa3`)이 정확히 위치함을 확인 — 큰 폭 스캔이 아니라 계산 자체가 정확했음. `SeekStream.seek()`가
헤더 파싱 후 이 메서드를 먼저 호출하고(`this.accurate_start_point`), 실패/범위초과 시(Cues 없음, 또는
seek 대상이 마지막 cue 범위를 벗어나 `0`을 반환하는 엣지케이스) 기존 추정 방식으로 폴백하도록 연결함.
End-to-end로 실제 캐시 파일에 대해 스트림 생성 → 에러 없이 정상적으로 오디오 데이터가 흐르는 것까지
확인했으나, **실제 Discord 음성 재생으로 들어보는 검증은 못 함**(도구로 라이브 재생 테스트 불가) —
`docs/TEST_CHECKLIST.md` I번 섹션에 검증 항목 추가해둠.

---

## 8. (TODO만, 조사 필요) 미리듣기와 실제 퀴즈 재생 구간이 서로 다름 — ✅ 2026-08-08 원인 특정 + 수정 + 사용자 실제 검증 완료

100~140초 지정 시: 미리듣기는 90~137초, 실제 퀴즈는 97초~137초로 재생됨. 7번(SeekStream 부정확성)을
감안해도 **두 경로가 같은 캐시 파일, 같은 클램프 로직을 쓰는데 왜 미리듣기 클립이 7초 더 긴지**(40초가
아니라 47초) 이론상 설명이 안 됨 — `sendAudioPreview()`(미리듣기, `-c copy` ffmpeg 트림)와
`prepare.ts`의 `generateAudioResourceFromWeb()`/`SeekStream`(실제 재생) 두 경로의 구간 계산 로직을
나란히 놓고 비교 조사 필요. ffmpeg `-c copy`가 키프레임 경계로 스냅되면서 앞뒤로 패딩이 붙는 것인지,
클램프 계산식 자체가 다른지부터 확인.

**2026-08-08 조사 결과**: 끝점(137초)은 두 경로 다 동일 — 버그가 아니라 오디오 원본 길이 자체가 137초라
140초 요청이 양쪽 다 `audio_duration_sec` 클램프로 137초가 된 것(정상 동작). 진짜 차이는 시작점뿐:
실제 재생 97초(-3초, 7번의 그 오차) vs 미리듣기 90초(-10초, ffmpeg `-ss`+`-c copy`가 클러스터 경계로
스냅되는 별도 특성). 즉 8번은 별개의 새 버그가 아니라 **7번과 같은 "seek 부정확" 문제가 서로 다른 두
메커니즘(커스텀 WebmSeeker vs ffmpeg 자체 디먹서)에서 각자 다른 크기로 나타난 것**으로 결론.

**2026-08-08 미리듣기 쪽도 수정 완료**: 원인은 `fluent-ffmpeg`의 `.setStartTime()`이 `-ss`를 `-i` **앞**에
붙이는 input seek이라 `-c copy`와 같이 쓰면 요청 시각 이전 가장 가까운 클러스터 경계(최대 10초)로
스냅백하는 것. `ffmpeg ... -f null -` 드라이런(오디오 파일 생성 없이 타임스탬프만 확인)으로 실측: input
seek은 `time=-00:00:09.97`(요청보다 10초 이른 패킷부터 시작)로 나오고, `-ss`를 `-i` **뒤**로 옮긴
output seek은 `time=00:00:00.00`(정확히 요청 지점부터)으로 나옴 — 컨테이너 seek 속도(수천 배속)는
그대로 유지됨. `fluent-ffmpeg`에 이미 output seek용 `seekOutput()`(`= .seek()`, `lib/options/output.js`)
메서드가 있어서, `audio_cache_manager.ts`의 `generatePreviewClipStream()`에서 `.setStartTime()`을
`.seekOutput()`으로 교체함. in-memory 스트림 테스트(파일 저장 없이 바이트 수만 확인)로 에러 없이 동작하는
것 + **2026-08-08 사용자가 실제 봇으로 재생해서 미리듣기 구간이 실제 재생 구간과 일치함을 검증 완료**.

---

## 9. 멀티플레이 로비 문제 수 설정 — "최대 50개" 문구가 실제 한도(60개)와 불일치 — ✅ 2026-08-08 수정 완료

로비 생성 화면에 "최대 50개"라고 표시되지만 실제 설정 가능한 최대값은 60개. 텍스트를 60으로 통일.
(참고: 유저 제작 퀴즈의 문제 개수 자체 상한은 50개가 맞음(`user-question-info-ui.ts`) — 이건 멀티플레이
로비의 "몇 문제 낼지" 설정값이라 별개의 숫자.)

---

## 10. 멀티플레이 퀴즈 설명에 "/퀴즈로 UI 재생성 가능" 안내 추가 — ✅ 2026-08-08 수정 완료

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
