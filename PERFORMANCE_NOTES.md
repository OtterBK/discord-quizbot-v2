# 성능/최적화 관찰 로그

> 구조 개편(REFACTOR_PLAN.md) 진행 중 눈에 띈 성능/메모리/로직 최적화 포인트를 기록하는 문서.
> **원칙: 지금 당장 고치지 않고 위치와 내용만 기록한다** (사용자 확인, 2026-08-03).
> 리팩토링(구조 이동, 동작 변경 없음)과 성능 개선(동작이 바뀔 수 있음)은 성격이 달라 커밋을 섞지 않는다.
> 이후 사용자가 정한 시점에 이 목록을 훑어보며 우선순위를 정해 한 번에 처리한다.

## 기록 양식

```
### [발견 위치] 짧은 제목

- 파일/위치: `path/to/file.js:123`
- 발견일: YYYY-MM-DD
- 현재 동작: (지금 코드가 어떻게 하고 있는지)
- 문제/개선 여지: (왜 최적화가 필요한지 - 메모리/CPU/로직 중복 등)
- 예상 효과: (개선하면 뭐가 좋아지는지, 가늠되면 체감 규모도)
- 우선순위 추정: 낮음 | 중간 | 높음 (확신 없으면 생략)
- 상태: 기록됨 (미착수)
```

---

## 목록

### [Phase 2] `ffmpegAgingManager`의 `ffmpeg_aging_map`이 항상 비어있음 (죽은 정리 로직)

- 파일/위치: `quizbot/quiz_system/quiz_system.js` (`ffmpeg_aging_map` 선언, `ffmpegAgingManager` 함수)
- 발견일: 2026-08-03
- 현재 동작: `ffmpegAgingManager()`가 `SYSTEM_CONFIG.FFMPEG_AGING_MANAGER_INTERVAL`마다 `setInterval`로 깨어나서 `ffmpeg_aging_map`을 순회하며, 일정 시간(`FFMPEG_AGING_MANAGER_CRITERIA`)보다 오래된 ffmpeg 핸들을 찾아 `kill()`하는 "오래된 ffmpeg 프로세스 정리" 로직. 함수 자체의 주석에 `TODO ps-node 모듈을 이용한 방식으로 수정해야함`이 이미 달려있음(REFACTOR_PLAN.md 2.1에서도 이 TODO를 인지하고 있었음).
- 문제/개선 여지: `ffmpeg_aging_map`에 `.set(...)`으로 값을 넣는 코드가 **`quizbot/` 전체에 단 한 군데도 없음** (grep 확인). 즉 이 정리 로직은 항상 빈 Map을 순회할 뿐 실질적으로 아무 ffmpeg 프로세스도 정리하지 못하고 있고, `setInterval`만 계속 돌면서 로그(`Aginging FFmpeg... targets: 0`)만 남기는 상태로 추정됨. TODO 주석대로 애초에 이 Map 기반 추적 방식을 버리고 `ps-node`로 갈아탄 흔적으로 보이는데, 정작 새 구현으로 완전히 옮겨가지 않고 죽은 코드만 남은 것으로 보임.
- 예상 효과: 만약 실제로 ffmpeg 프로세스가 정상 종료되지 않고 누적되는 경로가 있다면(예: 강제 종료/에러 상황), 이 정리 로직의 공백이 **장시간 운영 시 좀비 ffmpeg 프로세스 누적 → 메모리/CPU 누수**로 이어질 수 있음. 반대로 다른 경로(예: `fluent-ffmpeg`의 자체 프로세스 종료 처리)가 이미 확실히 커버하고 있다면, 이 죽은 코드는 정리(삭제 또는 TODO대로 `ps-node` 기반 재구현)만 하면 됨. 실제 ffmpeg 프로세스 정리가 다른 경로로 되고 있는지부터 확인이 필요.
- 우선순위 추정: 중간 (당장 장애를 일으키는 건 아니지만, 장기 운영 안정성과 직결될 수 있어 확인 가치가 있음)
- 상태: 기록됨 (미착수)
- 추가 조사 (2026-08-04, TS 전환 전 최종 점검 중):
  - `quizbot/` 전체에서 `new ffmpeg(...)`(fluent-ffmpeg로 프로세스 생성)를 호출하는 곳은 `audio_cache_manager.js:513`(`convertToWebm`) 단 한 곳뿐인데, 여기서도 `ffmpeg_aging_map`에 등록하는 코드가 없음.
  - `quiz_system.js`가 import하는 `ffmpeg-static`(`pathToFfmpeg`)은 직접 프로세스를 스폰하는 데 쓰이는 게 아니라 `process.env.FFMPEG_PATH`를 설정하는 용도로만 쓰임 — `@discordjs/voice`(prism-media)가 내부적으로 오디오 트랜스코딩할 때 참조하는 ffmpeg 바이너리 경로를 알려주기 위함으로 추정됨. 즉 `@discordjs/voice`가 내부적으로 스폰하는 ffmpeg 프로세스는 애초에 이 코드가 핸들을 쥐고 있지 않아 Map으로 추적 자체가 불가능한 구조.
  - 결론: `ffmpeg_aging_map`이 원래 추적하려던 대상이 정확히 무엇이었는지 코드만으로는 특정 불가. `@discordjs/voice`가 자체적으로 프로세스 생명주기를 관리한다면 이 코드는 애초에 불필요했을 가능성이 있고, 반대로 과거에는 직접 프로세스를 스폰해 추적하다가 라이브러리 전환 과정에서 등록 코드만 누락됐을 가능성도 있음. **정적 코드 분석만으로는 실제 운영 환경에서 ffmpeg 좀비 프로세스가 쌓이는지 확인 불가** — 운영 서버에서 ffmpeg 프로세스 개수를 모니터링해봐야 확정 가능. 이번 점검에서는 추측성 재구현(ps-node 기반)을 하지 않고 조사 결과만 기록.
