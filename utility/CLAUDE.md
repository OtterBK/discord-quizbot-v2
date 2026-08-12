# utility/

범용 유틸. `utility.js`가 `util/` 하위 4개 파일을 재수출하는 facade — 22개+ 소비 파일이 `const utility = require(".../utility.js")` 형태로 whole-object로 쓰기 때문에(구조분해 아님) facade 스타일이 자유로움.

## `util/` (facade가 재수출하는 도메인 파일)

- **`quiz_content_loader.js`** — `loadLocalDirectoryQuiz`/`getQuizTypeFromIcon`/`parseContentInfoFromDirName`. 로컬 디스크에서 공식 퀴즈 디렉터리 트리를 읽어옴(`DevQuizSelectUI`가 클래스 정의 시점에 한 번만 호출해서 캐싱 — 실행 중 파일 추가해도 재시작 전까진 안 보임). **세 함수가 서로 `this.xxx(...)`로 호출**함(모듈 최상위 `this === module.exports`인 CommonJS 특성 이용) — 이 파일을 더 쪼개면 이 자기 참조가 깨지니 한 파일에 묶어둔 것.
- **`audio_utility.js`** — BGM 재생(`playBGM`, `initializeBGM`), 오디오 페이드(`fade_audio_play`), 메타데이터 파싱(`getAudioInfoFrom{Path,Stream,Buffer}`). `playBGM` 내부에서 랜덤 롱타이머 고를 때 `misc_utility.getRandom(...)`을 씀(원래 `exports.getRandom`이었다가 분리하면서 재배선됨).
- **`network_utility.js`** — `getIPv4Address`/`getIPv6Address` (OS 네트워크 인터페이스 조회).
- **`misc_utility.js`** — 나머지 전부: `getRandom`, `sleep`, `sortDictByValue`/`sortMapByProperty`, `isImageFile`/`isValidURL`, `convertTagsValueToString`(비트플래그 태그 → 문자열), `extractYoutubeVideoID`, `generateUUID`, `calcTagsValue`, `removeMarkdownSpecialChars`, `sanitizeName`(멘션/마크다운 인젝션 방지).
- **`web_token_utility.js`** (신규, 2026-08-08) — 퀴즈 선택 웹 연동(`docs/plans/WEB_INTEGRATION_PLAN.md`)용 세션 토큰 생성. `generateWebSessionToken()`은 `crypto.randomBytes(32).toString('hex')` 기반 — `misc_utility.generateUUID()`는 `Math.random()` 기반이라 암호학적으로 안전하지 않아 세션 토큰 용도로는 재사용하지 않았다.

facade(`utility.js`) 자체에 죽은 import 5개(`EmbedBuilder`/`axios`/`PRIVATE_CONFIG`/`CUSTOM_EVENT_TYPE`/`orderBy`)가 남아있음 — 원본에도 있던 미사용 import라 lint 경고 개수를 그대로 유지하려고 일부러 지우지 않음.

## `SeekStream/` — 로컬 오디오 파일 seek 재생

- **`SeekStream.js`** — 원래 YouTube 스트림용이던 걸 로컬 파일용으로 개조("24.01.18 custom node modules 의존성 없앨겸 file stream 용으로 마개조"). `quizbot/quiz_system/lifecycle/prepare.js`에서만 실제로 쓰임(노래 퀴즈 재생 시 특정 지점부터 재생하는 기능). `seek()`가 헤더 파싱 후 `WebmSeeker.seek(content_length)`(Cues 테이블 기반 정확한 byte offset)를 먼저 시도하고, 실패/범위초과(`Error` 또는 `0` 반환)면 `loop()`의 전체 파일 평균 비트레이트 추정(`per_sec_bytes * sec`)으로 폴백함(`this.accurate_start_point`, 2026-08-08 수정) — 아래 `WebmSeeker.seek()` 항목 참고.
- **`WebmSeeker.js`** — WEBM/EBML 컨테이너를 직접 파싱해 seek 지점의 byte offset을 찾는 저수준 `Duplex` 스트림. **TS 컴파일 결과물로 보임**(`Object.defineProperty(exports, "__esModule"...)`, sourcemap 주석 있으나 `.map` 파일은 없음) — 소스가 아니라 생성된 코드를 직접 수정하는 셈이니 수정 시 유의. `play-audio` npm 패키지(EBML 파싱)에 의존. 바이너리 포맷 파싱이라 고위험 영역. **`seek(content_length)`(71-93번 줄)** — webm 파일 자체에 내장된 Cues 엘리먼트(실제 timestamp→byte position 매핑, 10초 간격으로 박혀있음을 실제 캐시 파일로 확인함)를 읽어 정확한 클러스터 byte offset을 계산 + 클러스터 내부 로컬 비트레이트로 보간. 2026-08-08 이전까지는 **정의만 되고 어디서도 호출되지 않는 죽은 코드**였음(webm 시작 지점 부정확 버그의 원인, `docs/plans/POST_B_ROUND_TEST_FEEDBACK_TODO.md` 7/8번) — `SeekStream.seek()`에서 연결함. Cues가 없거나(`return new Error('Failed to Parse Cues')`) seek 대상이 마지막 cue 범위를 벗어나면 `0`을 반환하는 엣지케이스가 있어 호출부에서 `> 0` 검증 필요.

## 그 외 (전부 독립 실행 스크립트/모듈, 순서대로 사용 빈도 높은 것부터)

- **`logger.js`** — `getLogger(label)` 팩토리, `winston` + `winston-daily-rotate-file` 기반. **코드베이스에서 가장 많이 require되는 파일**(~49곳, `require('.../logger.js')('라벨')` 패턴). `SYSTEM_CONFIG.DEVELOP_MODE`가 true면 콘솔에도 debug 레벨까지 출력, false면 파일에 info 레벨부터만.
- **`profanity_checker.js`** — 한국어 욕설 필터(`createProfanityChecker`). 정규화(NFKC, zero-width 제거, 동형이의 문자 치환) 후 큰 정규식으로 검사. 실사용처는 `quizbot/managers/report/auto_report_processing.js` 한 곳뿐.
- **`audio_converter.js`**, **`check_dependency.js`**, **`delete_m4a_format.js`**, **`download_cache.js`** — 전부 **봇 실행에는 안 쓰이는 수동 CLI 스크립트**(어디서도 require 안 됨, `node utility/xxx.js`로 직접 실행). `audio_converter.js`는 디렉터리 재귀 오디오→webm 변환(원본 삭제, 파괴적). `check_dependency.js`는 `@discordjs/voice` 의존성 체크(`@Deprecated` 표시됨). `delete_m4a_format.js`는 **하드코딩된 `G:/quizdata/cache/` 경로**를 스캔하는 캐시 정리 스크립트라 다른 머신에서는 경로부터 고쳐야 함. `download_cache.js`는 `audio_cache_manager.forceCaching(...)`을 4개 스레드로 병렬 실행하는 사전 캐싱 도구 — `utility/audio_url{0-3}.txt` 파일이 미리 있어야 함(리포에는 없음).
