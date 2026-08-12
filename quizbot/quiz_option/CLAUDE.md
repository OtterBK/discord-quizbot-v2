# quizbot/quiz_option/

`quiz_option.js` 하나. 길드별 퀴즈 옵션(오디오 재생시간, 힌트/스킵 방식, 정답 유사도 매칭, 점수 방식 등)을 관리.

- `OPTION_TYPE` — 옵션 값 enum(`HINT_TYPE.{AUTO,VOTE,OWNER}`, `SKIP_TYPE.{VOTE,OWNER}`, `SCORE_TYPE.{TIME,POINT}`, `ENABLED`/`DISABLED`/`UNLIMITED`).
- `getOptionStorage(guild_id)` — 메모리 캐시(`option_storage_map`, 프로세스 생존 기간 내 유지)에서 조회, 없으면 기본값으로 생성 + DB 저장(fire-and-forget, await/catch 없음).
- `getOptionData(guild_id)` / `loadOptionData(guild_id)`(시작 시 DB에서 실제 로드).
- `getDefaultQuizOption()`(2026-08-12, UI 개선 2라운드 B-4 [P2] "기본값으로 초기화" 신설) — 모듈 상수 `DEFAULT_QUIZ_OPTION`(원래 `OptionStorage` 생성자에 인라인으로 있던 값을 그대로 추출, 값 변경 없음)의 얕은 복사본을 반환. `server-setting-ui.ts`의 초기화 버튼이 이 값으로 `option_data`를 되돌리는 데 씀 — DB에는 바로 안 쓰고 [저장] 버튼을 눌러야 반영됨(기존 관례 그대로).

**주의**: `OptionStorage.saveOptionToDB`가 SQL 값을 문자열 직접 삽입으로 만듦(파라미터화 아님) — `quizbot/managers/db/db_option.js`와 같은 스타일/같은 주의사항. `getOptionStorage`의 기본값 생성 경로가 DB 저장 실패를 조용히 무시함(에러 핸들링 없음).

`quiz_system/`(constants.js, lifecycle/initialize.js, prepare.js, question.js)과 `server-setting-ui.js`에서 널리 쓰임 — 옵션 관련 버그 조사 시 이 파일이 시작점.
