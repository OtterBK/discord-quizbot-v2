# 스코어보드 시즌 아카이브 + 웹 UI 노출 (2026-08-15 설계/구현)

## 배경

사용자 요청 2건: (1) 순위표(스코어보드)를 웹 UI에서도 볼 수 있게, (2) 이전 시즌 스코어보드도 조회
가능하게. 조사 결과 "시즌"은 `text_contents.json`의 `scoreboard.season_label`이라는 **순수 텍스트
라벨**일 뿐이었고, DB에 시즌이라는 데이터 구조 자체가 없었음(`tb_global_scoreboard`는 길드당 1행만
계속 누적, 시즌 컬럼 없음). 시즌 전환은 관리자가 지금까지 수동으로(코드화 안 된 SQL) 해온 것으로
추정 — 즉 **이 기능 이전의 과거 시즌 데이터는 복구 불가능**(아카이브 테이블이 없었으므로).

## 설계 결정

- **기존 `tb_global_scoreboard`는 손대지 않음** — 멀티플레이 매치 종료마다 호출되는 핫패스
  (`multiplayer_session.js`의 `processWinner`/`processLoser`)라 리스크를 최소화. 이 테이블은 계속
  "현재 시즌" 그 자체를 의미.
- **새 아카이브 테이블 `tb_global_scoreboard_archive`**: 시즌 종료 시점의 `tb_global_scoreboard`
  스냅샷을 시즌별로 보관.
- **새 시즌 메타 테이블 `tb_scoreboard_season`**: 종료된 시즌의 이름/종료시각만 기록(진행 중인
  시즌은 이 테이블에 없음 — `tb_global_scoreboard` 자체가 "현재 시즌"이므로).
- **트랜잭션 없음**: `db_core.ts`에 트랜잭션 헬퍼가 없고(`docs/plans/RANDOM_QUIZ_PRESET_PLAN.md`와
  동일 상황), 이 프로젝트는 여러 쿼리를 원자적으로 묶어야 할 때 항상 "실패 시 보상(compensating)
  쿼리로 직접 정리" 패턴을 써왔음 — 이번에도 동일하게 따름(`db_scoreboard.ts`의 `endCurrentSeason`
  참고).
- **"현재 시즌 이름"도 `text_contents.json`에서 `resources/current_season_name.txt`로 이관** —
  `resources/current_notice.txt`/`maintenance_notice.txt`와 동일 패턴(admin이 quizmgr에서 재배포 없이
  바로 수정 가능). git 추적 대상으로 유지하고(기본값 있어야 하니) `quizbot_update.sh`의
  `PROTECTED_PATHS`에 추가해 업데이트 때 원복 안 되게 보호.

## DB 마이그레이션 (사용자가 운영/개발 DB에 직접 psql로 실행할 것)

`docs/plans/RANDOM_QUIZ_PRESET_PLAN.md`와 동일한 절차 — 이 프로젝트엔 마이그레이션 프레임워크가
없어서, 아래 SQL을 직접 실행 후 `auto_script/db_backup/base.sql`에도 반영(신규 설치용, 이미 완료).

```sql
-- 시즌 메타(종료된 시즌만 기록)
CREATE TABLE quizbot.tb_scoreboard_season (
    season_id integer NOT NULL,
    season_name character varying NOT NULL,
    ended_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE quizbot.tb_scoreboard_season_season_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE quizbot.tb_scoreboard_season_season_id_seq OWNED BY quizbot.tb_scoreboard_season.season_id;

ALTER TABLE ONLY quizbot.tb_scoreboard_season ALTER COLUMN season_id SET DEFAULT nextval('quizbot.tb_scoreboard_season_season_id_seq'::regclass);

ALTER TABLE ONLY quizbot.tb_scoreboard_season
    ADD CONSTRAINT tb_scoreboard_season_pkey PRIMARY KEY (season_id);

-- 시즌 종료 시점의 tb_global_scoreboard 스냅샷
CREATE TABLE quizbot.tb_global_scoreboard_archive (
    season_id integer NOT NULL,
    guild_id bigint NOT NULL,
    win integer,
    lose integer,
    play integer,
    mmr integer,
    guild_name character varying
);

ALTER TABLE ONLY quizbot.tb_global_scoreboard_archive
    ADD CONSTRAINT tb_global_scoreboard_archive_pkey PRIMARY KEY (season_id, guild_id);

ALTER TABLE ONLY quizbot.tb_global_scoreboard_archive
    ADD CONSTRAINT tb_global_scoreboard_archive_season_fk FOREIGN KEY (season_id) REFERENCES quizbot.tb_scoreboard_season(season_id) ON DELETE CASCADE;

CREATE INDEX idx_global_scoreboard_archive_season_mmr ON quizbot.tb_global_scoreboard_archive USING btree (season_id, mmr DESC);
```

**주의**: 개발 DB/운영 DB 둘 다 실행해야 실제로 동작함. 실행 전까지는 이번에 추가되는
`db_manager.endCurrentSeason`/`selectSeasonList`/`selectArchivedTop10Scoreboard`/
`selectArchivedGuildScoreboard`가 전부 조용히 `undefined`를 반환함(`db_core.sendQuery`가 에러를
던지지 않고 로깅만 하는 기존 관행 — 화면에는 "데이터를 불러오지 못했습니다" 정도로만 보임, 크래시
없음).

## 구현 범위

1. `db/db_scoreboard.ts` — 시즌 관련 쿼리 4개 추가(`selectSeasonList`/`selectArchivedTop10Scoreboard`/
   `selectArchivedGuildScoreboard`/`endCurrentSeason`). 기존 3개 함수는 무변경.
2. `managers/scoreboard_season_manager.ts`(신규) — "현재 시즌 이름" 파일 읽기/쓰기 +
   "시즌 종료 후 새 시즌 시작"을 한 동작으로 묶는 `endSeasonAndStartNew`.
3. `quiz_ui/scoreboard-ui.ts` — 시즌 select 메뉴 추가(과거 시즌이 1개 이상 있을 때만 노출), 선택한
   시즌에 따라 현재/아카이브 쿼리로 분기.
4. `quiz_ui/admin-season-ui.ts`(신규) — quizmgr "🏆 시즌 관리": 현재 시즌 이름 표시 + "시즌 종료 및
   새 시즌 시작" 버튼(확인 절차 → 새 시즌 이름 모달).
5. `managers/web/web_express_app.ts` — `GET /api/scoreboard`(선택적 `season_id` 쿼리)/
   `GET /api/scoreboard/seasons`, `requireWebSession + requireGuildScopedSession`.
6. `web-frontend/src/ScoreboardPanel.jsx`(신규) — App.jsx "☰ 더보기"에 "🎖 순위표" 추가.
7. `quizbot_update.sh` — `PROTECTED_PATHS`에 `resources/current_season_name.txt` 추가.
