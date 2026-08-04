# quizbot/managers/db/

`db_manager.js`(상위 디렉터리)가 이 폴더 전체를 spread로 재수출하는 facade. 원본은 500줄짜리 `db_manager.js` 하나였고, 테이블/도메인별로 분리됨. **`sendQuery`는 `db_core.js`에서만 쓰이고 facade에는 재수출되지 않음** (원본에 없던 함수라 API 표면을 그대로 유지하기 위함) — 새 도메인 파일을 추가할 땐 `db_core.js`를 require해서 `db_core.sendQuery(...)`를 쓰면 됨.

- **`db_core.js`** — `pg.Pool` 생성, `sendQuery(query_string, values)`(내부 헬퍼, 연결 안 됐으면 조용히 `undefined` 반환 — 에러를 던지지 않음), `initialize()`(풀 연결), `executeQuery(query, values)`(트랜잭션 등에서 직접 쓰는 raw 버전).
- **`db_option.js`** — 서버별 옵션(`tb_option`). **주의**: `selectOption`/`updateOption`은 파라미터화 쿼리(`$1`)가 아니라 문자열 직접 삽입 방식 — 원본 주석에 "옵션쪽은 어차피 고정값이니깐 placeholder 사용하지 말자, 건드리기 두렵다"고 적혀있음. 여기 손댈 때 SQL 인젝션 여지 있는지 특히 조심.
- **`db_quiz.js`** — 유저 퀴즈/문제 CRUD, 좋아요, 인증(certify), 태그/장바구니 기반 랜덤 문제 선택(`selectRandomQuestionListByTags`/`selectRandomQuestionListByBasket`). 가장 큰 파일 — 원본에서 "User Quiz info"와 "User QuestioN Info" 관련 함수가 서로 섞여 있던 순서를 그대로 유지했음(임의로 재배열 안 함).
- **`db_report.js`** — 신고 처리 관련(`tb_chat_info`, `tb_report_info`, `tb_ban_history`). `report/CLAUDE.md`의 신고 흐름과 짝을 이룸.
- **`db_scoreboard.js`** — 멀티플레이 글로벌 스코어보드(`tb_global_scoreboard`, win/lose/mmr).
