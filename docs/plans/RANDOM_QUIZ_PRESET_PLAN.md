# 랜덤 퀴즈 프리셋 계획서

> 2026-08-13 설계+구현 완료. DB 테이블 생성 SQL 실행 완료(사용자), DB 헬퍼/Express API/프론트엔드 UI
> 구현 완료, `tsc`/`lint`/`test`(361 pass)/양쪽 `build` 전부 통과. **실사용(실제 브라우저) 검증만
> 아직 안 함** — `docs/TEST_CHECKLIST.md` AE 섹션 참고. `docs/ACTIVE_PLAN.md` B-8에 이 문서를 가리키는
> 항목이 있음.

## 배경

웹 UI(`web-frontend/src/OmakaseTab.jsx`, "랜덤 퀴즈" 탭)에서 "직접 담기" 모드로 퀴즈함(quiz_id 목록)을
고를 때마다 매번 처음부터 다시 검색/선택해야 하는 불편이 있다. 자주 쓰는 퀴즈함 조합을 이름 붙여
저장해두고 다음에 한 번에 불러올 수 있는 **프리셋** 기능을 추가한다. **웹 UI 한정 기능** — 디스코드
쪽 UI/명령어에는 추가하지 않는다.

## 확정 범위 (사용자 결정, 2026-08-13)

1. 프리셋이 저장하는 값은 **퀴즈함(quiz_id) 목록뿐**이다. 시간제한/정답방식/태그필터 같은 랜덤 퀴즈
   옵션(`selected_question_count`, `certified_filter` 등)은 프리셋에 담지 않고, 항상 불러오는 시점의
   현재 화면 설정을 그대로 따른다.
2. 저장 단위는 **유저(Discord user_id) 단위**다. 어느 길드에서 웹으로 접속하든 같은 프리셋 목록을
   본다(길드 단위 아님). **유저당 최대 10개.**

## 기존 관행 조사 결과 (스키마 설계 근거)

- **마이그레이션 프레임워크/`schema.sql` 없음.** DDL은 직접 `psql`로 실행하고, 신규 설치용 덤프
  (`auto_script/db_backup/base.sql`, `install_quizbot3.sh`가 `psql -f base.sql`로 복원)에도 나중에
  반영해야 실제로 새 서버에 테이블이 생긴다. `quizbot/managers/db/*.ts`엔 `CREATE TABLE`이 전혀 없음 —
  테이블은 항상 미리 존재한다고 가정하고 쿼리만 한다.
- **네이밍**: 테이블명 `tb_` 접두사 + `snake_case`. PK는 `SERIAL`류 정수 시퀀스(`tb_quiz_info.quiz_id`
  방식).
- **Discord 유저 id 타입**: `tb_like_info`/`tb_option`/`tb_global_scoreboard`/`tb_ban_history` 전부
  `bigint`(다수 관행). `tb_quiz_info.creator_id`만 `character varying`인 예외 — 새 테이블은 다수
  관행인 `bigint`를 따른다.
- **배열 컬럼 미사용**: 기존 스키마 어디에도 Postgres 배열 타입을 안 쓴다. 대신 `tb_like_info`처럼
  (부모키, 대상키) 조합을 담는 얇은 연결 테이블 패턴을 쓴다. 프리셋도 같은 패턴(본문 테이블 + 항목
  연결 테이블 2개)으로 설계 — 퀴즈함(`tb_quiz_info`)이 삭제되면 `ON DELETE CASCADE`로 항목이 자동
  정리되어, `basket_items`(웹 세션의 인메모리 표현)처럼 죽은 `quiz_id`가 남아있다가 조회 시점에
  걸러지는 방식보다 데이터가 항상 일관된다.
- **쿼리 스타일**: 파라미터 바인딩(`$1`, `$2`) 필수 — `db_scoreboard.ts`의
  `INSERT ... ON CONFLICT DO UPDATE` 업서트 패턴을 참고할 것(구현 단계에서).

## DB 스키마

### 테이블 1: `tb_random_quiz_preset` — 프리셋 메타(이름/소유자)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `preset_id` | `integer` (PK, serial) | |
| `user_id` | `bigint NOT NULL` | 소유자 Discord user id |
| `preset_name` | `varchar(30) NOT NULL` | 사용자가 붙인 이름 |
| `created_time` | `timestamp NOT NULL DEFAULT now()` | |
| `modified_time` | `timestamp` | 항목 구성이 바뀔 때 갱신 |

`UNIQUE(user_id, preset_name)` — 같은 유저가 이름을 중복해서 만들지 못하게 DB 레벨에서 막는다.

### 테이블 2: `tb_random_quiz_preset_item` — 프리셋에 담긴 퀴즈함 항목(순서 보존)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `preset_id` | `integer NOT NULL` | FK → `tb_random_quiz_preset.preset_id`, `ON DELETE CASCADE` |
| `quiz_id` | `integer NOT NULL` | FK → `tb_quiz_info.quiz_id`, `ON DELETE CASCADE` |
| `sort_order` | `integer NOT NULL DEFAULT 0` | 담긴 순서(선택 UI에 그대로 재현하기 위함) |

PK `(preset_id, quiz_id)` — 같은 프리셋에 같은 퀴즈가 중복으로 안 들어감.

## 실행할 SQL

```sql
-- 1. 프리셋 메타 테이블
CREATE SEQUENCE quizbot.tb_random_quiz_preset_preset_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE TABLE quizbot.tb_random_quiz_preset (
    preset_id     integer NOT NULL DEFAULT nextval('quizbot.tb_random_quiz_preset_preset_id_seq'),
    user_id       bigint NOT NULL,
    preset_name   character varying(30) NOT NULL,
    created_time  timestamp without time zone NOT NULL DEFAULT now(),
    modified_time timestamp without time zone
);

ALTER SEQUENCE quizbot.tb_random_quiz_preset_preset_id_seq
    OWNED BY quizbot.tb_random_quiz_preset.preset_id;

ALTER TABLE ONLY quizbot.tb_random_quiz_preset
    ADD CONSTRAINT tb_random_quiz_preset_pkey PRIMARY KEY (preset_id);

ALTER TABLE ONLY quizbot.tb_random_quiz_preset
    ADD CONSTRAINT tb_random_quiz_preset_user_name_uniq UNIQUE (user_id, preset_name);

CREATE INDEX idx_random_quiz_preset_user_id
    ON quizbot.tb_random_quiz_preset USING btree (user_id);

-- 2. 프리셋-퀴즈 연결 테이블
CREATE TABLE quizbot.tb_random_quiz_preset_item (
    preset_id  integer NOT NULL,
    quiz_id    integer NOT NULL,
    sort_order integer NOT NULL DEFAULT 0
);

ALTER TABLE ONLY quizbot.tb_random_quiz_preset_item
    ADD CONSTRAINT tb_random_quiz_preset_item_pkey PRIMARY KEY (preset_id, quiz_id);

ALTER TABLE ONLY quizbot.tb_random_quiz_preset_item
    ADD CONSTRAINT tb_random_quiz_preset_item_preset_fk
    FOREIGN KEY (preset_id) REFERENCES quizbot.tb_random_quiz_preset (preset_id) ON DELETE CASCADE;

ALTER TABLE ONLY quizbot.tb_random_quiz_preset_item
    ADD CONSTRAINT tb_random_quiz_preset_item_quiz_fk
    FOREIGN KEY (quiz_id) REFERENCES quizbot.tb_quiz_info (quiz_id) ON DELETE CASCADE;
```

> 스키마명(`quizbot.`)은 `auto_script/db_backup/base.sql`의 기존 테이블들과 동일하게 맞춘 것 —
> 실제 운영/개발 DB의 스키마명이 다르면 그에 맞게 바꿔서 실행할 것.

## 앱 코드 레벨에서 처리할 것 (DB 제약이 아님, 구현 단계 메모)

- **유저당 프리셋 10개 제한**: Postgres는 집계 조건의 `CHECK` 제약을 지원하지 않고, 기존 코드베이스에
  트리거를 쓰는 관행도 없음 — `INSERT` 전 `COUNT(*) WHERE user_id = $1` 체크로 앱에서 막는다.
- **이름 중복**: `UNIQUE(user_id, preset_name)` DB 제약으로 이미 강제됨 — 앱은 `23505` 에러를 잡아
  "이미 있는 이름" 안내로 변환.
- **불러올 때 비공개/삭제된 퀴즈**: `quiz_id` 자체가 삭제되면 FK `ON DELETE CASCADE`로 항목이 자동
  제거된다. 다만 **삭제가 아니라 `is_private=true`로 비공개 전환**된 경우엔 행이 그대로 남으므로,
  프리셋을 실제 랜덤 퀴즈 설정에 적용할 때 `db_quiz.ts`의 `selectRandomQuestionListByBasket`이 이미
  하는 것과 동일하게 `is_private = false and is_use = true` 필터를 조회 시점에 적용해야 한다.

## ✅ 테이블 2개(연결 테이블) 방식 확정 (2026-08-13)

콤마 구분 문자열 저장 방식과 비교 검토 — FK `ON DELETE CASCADE`로 퀴즈함 삭제 시 프리셋 항목이 자동
정리되는 이점이 크고(문자열 저장은 이 정리를 앱이 직접 챙겨야 함 + 파싱/이스케이프 버그 여지), 규모가
작아(유저당 최대 10개 프리셋) 조인 비용은 무시할 수준이라 판단해 위 2테이블 설계 그대로 확정.

## ✅ `auto_script/db_backup/base.sql` 반영 완료 (2026-08-13)

신규 설치 시에도 뼈대가 자동 생성되도록 위 두 테이블(+ 시퀀스/PK/UNIQUE/INDEX/FK)을 기존 pg_dump 포맷
그대로 `base.sql`에 추가 완료(알파벳 정렬 위치, serial 컬럼은 `CREATE TABLE`엔 `NOT NULL`만 넣고
`ALTER TABLE ... SET DEFAULT`로 분리하는 기존 관행대로). 라이브/테스트 서버는 여전히 위 SQL을 사용자가
직접 실행해야 함(이 파일은 신규 설치 전용, 기존 DB에 자동 반영되지 않음).

## ✅ 구현 완료 (2026-08-13, 같은 세션)

1. ~~사용자가 위 SQL을 개발/운영 DB에 직접 실행~~ — 완료.
2. ~~DB 헬퍼~~ — `quizbot/managers/db/db_random_quiz_preset.ts` 신설(목록/이름 중복 확인/개수 카운트/
   생성/삭제 5개), facade `db_manager.js`에 재수출(36→41개). `insertRandomQuizPreset`은 preset 메타
   INSERT 후 `unnest($2::int[]) with ordinality`로 quiz_id_list를 sort_order와 함께 한 번에
   벌크 삽입 — 항목 삽입이 실패하면 방금 만든 빈 preset을 직접 정리해 고아 방지(이 코드베이스에
   트랜잭션 헬퍼가 없어 2단계 삽입이라 필요한 방어).
3. ~~Express 라우터~~ — 별도 라우터 파일 대신 `web_express_app.ts`에 인라인 3개 추가(`/api/omakase-tags`
   등 기존 단순 라우트와 동일한 배치 방식) — `GET`/`POST`/`DELETE /api/random-quiz-presets[/:preset_id]`.
   당초 계획과 달리 `requireOwnerScopedSession`(owner 세션 전용) 대신 **스코프 제한 없는
   `requireWebSession`만 사용** — guild 세션(omakase 탭이 실제로 쓰는 세션 종류)도 owner 세션도 둘 다
   `owner_id` 필드를 갖고 있어(`web_session_manager.ts`), 이 필드 하나만 있으면 충분하다는 걸 코드
   확인 후 단순화함. 이름 중복은 DB의 `UNIQUE(user_id, preset_name)`이 최종 방어선이지만
   `db_core.sendQuery`가 모든 에러를 동일하게 `undefined`로 삼켜서(에러 코드 구분 불가) 사전에 SELECT로
   직접 확인하는 방식 채택. `web_rate_limit.ts`의 `apiRateLimiter`는 이미 `/api` 전체에 걸려있어
   별도 적용 불필요.
4. ~~프론트엔드~~ — `OmakaseTab.jsx`의 퀴즈함 드로워 상단에 "저장된 프리셋" 섹션 추가(기존
   `qd-row`/`qd-remove` 등 클래스 재사용, 신규 CSS는 `qd-presets`/`qd-preset-list`/`qd-preset-save`
   래퍼 3개뿐). 저장은 이름 입력 인라인 폼, 삭제는 다른 화면(`QuizDetailPage.jsx`)과 동일한 2클릭
   확인(🗑→⚠️) 관례. 불러오기는 서버가 필터링 없이 내려준 `quiz_id_list`를 프론트가 이미 불러온 공개
   퀴즈 목록(`userQuizzes`, `/api/user-quizzes`)과 대조해서 존재하는 항목만 채우고, 못 찾은 개수만큼
   안내 문구를 보여주는 방식(비공개 전환/삭제된 항목 필터링을 서버가 아니라 클라이언트가 담당 — DB/
   API에 별도 조회를 추가하지 않아 구현이 단순해짐).

검증: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 기존 57 warning 수준 유지)/`npm test`
(361 pass — 신규 `db_random_quiz_preset` 회귀 테스트 4건 + `/api/random-quiz-presets` 통합 테스트
9건 포함, `db_manager.js` export 개수 회귀 테스트 36→41 갱신)/`npm run build`(백엔드)/`npm run build`
(프론트엔드) 전부 통과. **미검증** — 실제 Discord+브라우저로 아직 안 돌려봄, 다음 세션 최우선
(`docs/TEST_CHECKLIST.md` AE 섹션).

## ✅ 최초 구현 직후 사용자 피드백 3건 반영 (2026-08-13, 같은 세션)

1. **불러오기 토스트 없음**: 프리셋을 불러와도 아무 반응이 없어 헷갈림 — `qd-presets` 영역의 안내
   문구 자리를 재사용해 `✓ "이름" 불러왔어요.`(또는 제외 항목이 있으면 그 안내)를 3초간 표시 후
   자동으로 지우도록 수정(`OmakaseTab.jsx`, `presetNoticeTimeoutRef`로 중복 타이머 방지).
2. **API 직접 호출로 10개 제한 우회 가능한지 점검 요청 → 실제로 TOCTOU 허점 있었음, 수정**: 기존엔
   "개수 확인(SELECT)" 후 "저장(INSERT)"이 별도의 두 요청이라, 동시에 여러 번 직접 호출하면 둘 다
   구 개수를 보고 통과해 10개를 넘길 수 있었음. `insertRandomQuizPreset`의 INSERT 문 자체를
   `insert into ... select $1, $2 where (select count(*) ...) < $3`로 바꿔 그 순간의 실제 개수를
   INSERT와 같은 SQL 문 안에서 재확인하도록 수정 — 완전한 직렬화(SERIALIZABLE/명시적 락)까지는 아니라
   이론상 극히 드문 완전 동시 요청은 여전히 새어나갈 수 있지만(이 코드베이스에 트랜잭션/락 인프라
   자체가 없어 완전 방지는 이 기능 대비 과함), 기존의 "두 번의 별도 왕복" 창을 "단일 SQL 문 실행
   시간"으로 크게 좁힘. 회귀 테스트 추가(`insertRandomQuizPreset`이 4번째 인자로 `max_count`를 받고,
   WHERE 조건에 걸리면 0 row로 실패하는 케이스).
3. **삭제 확인(🗑→⚠️) 아이콘 레이아웃 어긋남**: `.qd-remove`가 원래 "✕" 문자 하나만 염두에 두고
   만들어져 `display:flex` 중앙정렬이 없었음 — 이모지로 바뀌면서 글리프 폭/높이가 달라 박스 안에서
   삐뚤어져 보였던 것. `display:flex`+`align-items/justify-content:center`+`line-height:1` 추가,
   폰트 크기도 11px→12px로 소폭 조정(`styles.css`, 퀴즈함 항목 삭제 버튼도 같은 클래스라 함께 개선됨).

검증(재실행): `tsc`/`lint`(0 error)/`test`(362 pass)/`web-frontend` `build` 전부 통과. 백엔드
`npm run build`는 `config/private_config.json`이 `dist/`로 복사되는 부작용을 피하려고 이번엔
`tsc --noEmit`으로만 재검증(코드 정확성은 동일하게 확인됨) — 상세 경위는 `[[feedback_private_config_json_build_caution]]` 메모리 참고.

## ✅ `/프리셋관리` 개인 명령어(웹 전용) 추가 (2026-08-20, 신규 세션)

**배경**: 사용자가 "프리셋 기능을 개인 명령어로도 관리할 수 있게 할 수 있나?"라고 문의 — 조사 결과
디스코드 "프리셋 관리" 화면(`basket-manage-flow.ts`)의 이름변경/항목제거/전체삭제 4개 상태 함수는
이미 `room_ui`를 전혀 받지 않는 순수 `user_id` 기반이라 개인 명령어로 뽑아내는 것 자체는 쉬웠지만,
"퀴즈를 프리셋에 **추가**하는 기능도 있어야 하지 않나"라는 사용자의 후속 지적으로 범위가 커짐 —
퀴즈를 고르는 화면(`UserQuizSelectUI`)은 `QuizbotUI`/`UIHolder` 화면 전환 스택에 올라타는 걸 전제로
설계돼 있어, 화면 전환 체계를 안 쓰는 `basket-manage-flow.ts`(독립 ephemeral 플로우)에 그대로 못
끼워 넣는 구조적 문제 발견. 반면 **웹 쪽은 "직접 담기" 모드(`OmakaseTab.jsx`)에 퀴즈 브라우징 UI가
이미 있어서 새 화면이 필요 없었음** — 그래서 사용자가 "명령어로는 웹만 지원하자, DM 강제도 필요
없지?"로 스코프를 확정.

**DM 강제가 필요 없는 이유**: `/퀴즈만들기`가 DM 전용인 건 `UIHolder`(`ui_holder_map`)를 만들어서
후속 인터랙션(버튼 클릭 등)을 같은 클러스터 프로세스가 받아야 하는데, 길드에서 요청하면 그 길드를
담당하는 클러스터와 DM을 받는 클러스터가 샤딩 때문에 다를 수 있어서다(`create_quiz_handler`의
"샤딩돼 있어서..." 주석). `/프리셋관리`는 Link 버튼(URL, 인터랙션 미발생) 하나로 끝나는 1회성
에페메럴 응답이라 `UIHolder`를 아예 안 만들고, 그래서 이 제약 자체가 적용되지 않음 — 길드/DM 어디서
호출해도 동일하게 동작.

**구현**:
- **DB**: `db_random_quiz_preset.ts`에 `replaceRandomQuizPresetItems(preset_id, user_id, quiz_id_list)`
  신설 — 항목 목록을 통째로 교체(`insertRandomQuizPreset`의 item 삽입부와 동일한
  `unnest ... with ordinality` 패턴). "추가"와 "정리" 둘 다 최종 목록을 클라이언트가 계산해서
  넘기는 방식으로 통일 — 개별 추가 API를 따로 만들지 않음.
- **REST**(`web_express_app.ts`, `requireWebSession`만 — 기존 프리셋 라우트와 동일하게 스코프 제한
  없음): `PUT /api/random-quiz-presets/:preset_id`(이름변경, `updateRandomQuizPresetName` 재사용),
  `PUT /api/random-quiz-presets/:preset_id/items`(항목 통째 교체), `DELETE
  /api/random-quiz-presets/:preset_id/items/:quiz_id`(항목 하나 제거, `deleteRandomQuizPresetItem`
  재사용 — 디스코드 "프리셋 관리" 화면과 동일 함수).
- **디스코드 진입점**: `command_manager.ts`에 `/프리셋관리` 슬래시커맨드 신설, `bot.js`에
  `preset_manage_handler`(owner-scoped 웹 세션 발급 후 Link 버튼 1개 에페메럴 응답, `UIHolder` 없음).
- **웹 페이지**: `editor.html`/`editor-main.jsx`/`QuizEditorApp.jsx`(퀴즈 편집기)와 대칭되는 신규
  진입점 `presets.html`/`presets-main.jsx`/`PresetManagerApp.jsx` — Vite 멀티페이지 빌드에 세 번째
  진입점으로 추가(`vite.config.js`), `web_express_app.ts`가 `/editor`와 동일한 방식으로 `/presets`
  정적 서빙. 하위 라우트가 없는 단일 화면이라(퀴즈 편집기와 달리 `react-router-dom` 불필요) 로컬
  state로만 목록⟷상세를 전환. 목록 화면은 프리셋 생성(이름+퀴즈 검색 피커로 담을 항목 미리 선택 후
  한 번에 `POST`, 빈 프리셋 생성은 허용 안 함 — 기존 "퀴즈함이 비어있어요" 정책 유지)/삭제(2클릭
  확인, `OmakaseTab.jsx`/`QuizDetailPage.jsx`와 동일 관례), 상세 화면은 이름변경/항목 개별
  제거(디스코드와 동일하게 삭제/비공개 전환된 항목은 자리를 남기고 "더 이상 사용할 수 없는 퀴즈"로
  표시)/**퀴즈 추가**(검색 피커에서 클릭 즉시 `PUT .../items`로 반영, 별도 저장 버튼 없음 — 클릭=즉시
  반영이라는 이 앱의 기존 관례를 따름). 신규 CSS 없음 — `OmakaseTab.jsx`의 `qd-row`/`qd-list` 등
  드로워 관용구, `QuizListPage.jsx`의 `section-block`/`text-field`/`toolbar-cta` 등 폼 관용구를
  그대로 재사용.

검증: `npx tsc --noEmit`(0 error)/`npm run lint`(0 error, 기존 57 warning 수준 유지)/`npm test`(421
pass — 신규 PUT/DELETE 라우트 테스트 8건 포함, `db_manager.js` export 개수 회귀 테스트 48→49
갱신)/`npm run build`(백엔드)/`npm run build`(프론트엔드, `presets.html` 정상 산출 확인) 전부 통과.
**미검증** — 실제 Discord+브라우저로 아직 안 돌려봄, `docs/TEST_CHECKLIST.md` AI섹션(프리셋 관리 웹
페이지) 신설.
