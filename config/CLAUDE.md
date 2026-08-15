# config/

- **`system_setting.js`** — 공개 설정 전체. `SYSTEM_CONFIG`(타이밍/경로/한도 등 큰 잡동사니 객체, `${__dirname}/../...`로 계산된 경로 다수), `CUSTOM_EVENT_TYPE`, `QUIZ_TYPE`, `EXPLAIN_TYPE`, `BGM_TYPE`, `QUIZ_MAKER_TYPE`, `ANSWER_TYPE`, `QUIZ_TAG`/`DEV_QUIZ_TAG`(32비트 비트플래그 태그 시스템, 유저 퀴즈용/공식 퀴즈용이 서로 다른 값 체계). 코드베이스에서 가장 많이 require되는 설정 파일(67곳+).
  - **`SYSTEM_CONFIG.DEVELOP_MODE`가 현재 `true`로 커밋돼 있음** — 콘솔 로그 출력 여부, 로그 레벨(`utility/logger.js`) 등에 영향. 프로덕션 동작을 가정하기 전에 이 값부터 확인할 것.
  - 주석 처리된 채 남아있는 enum 값들(`QUIZ_TYPE.SELECT`/`TTS`/`FAST_QNA`, `QUIZ_TAG`/`DEV_QUIZ_TAG`의 일부 비트)은 "안씀"으로 표시된 의도적 비활성화 — 함부로 되살리지 말 것.
  - `QUIZ_TAG`/`DEV_QUIZ_TAG`에 새 태그 추가 시 반드시 비어있는 비트를 골라야 함(주석에 마지막 사용/여유 비트가 추적돼 있음).
- **`private_config.json`** — **비밀 값**. `BOT.{TOKEN,CLIENT_ID,KOREANBOT_TOKEN}`, `DB.{HOST,USER,PASSWORD,DATABASE,PORT}`, `ADMIN_ID`. `.gitignore`에 등록돼 있어 새로 클론한 환경엔 없음 — 직접 만들어야 봇이 뜸. **이 파일은 절대 커밋하지 말 것** (실수로 스테이징됐는지 항상 확인).
- **`private_config.example.json`** — 위 파일의 뼈대(값은 전부 `INPUT_...` 플레이스홀더/기본값). git 추적 대상이며, 새로 클론한 환경에서 이 파일을 `private_config.json`으로 복사해서 실제 값을 채우는 용도. `Readme.md`의 "봇 실행 방법" 섹션에도 같은 내용이 있음 — 필드를 추가/변경하면 두 곳(이 파일, `Readme.md`)을 같이 갱신할 것.
- **`text_contents.json`** — 언어별(`kor` 등) UI 문구. `SYSTEM_CONFIG.LANGUAGE`로 인덱싱해서 씀(`text_contents.json[SYSTEM_CONFIG.LANGUAGE]`).
