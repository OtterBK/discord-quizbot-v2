# Discord Quizbot v2 프로젝트 분석

## 1) 프로젝트 개요
- 이 저장소는 **Discord.js v14 기반 퀴즈 봇**이며, 샤딩/클러스터링을 위해 `discord-hybrid-sharding`을 사용합니다.
- 유저는 슬래시 커맨드(`/퀴즈`, `/퀴즈만들기`, `/퀴즈정리`, `/챗`, `/채팅전환`)로 기능에 접근합니다.
- 핵심 기능은 로컬 퀴즈 플레이, 유저 제작 퀴즈, 오마카세 퀴즈, 서버 간 멀티플레이입니다.

## 2) 런타임 구조
- **엔트리포인트**: `index.js`
  - ClusterManager 생성 및 클러스터별 메시지 라우팅
  - IPC 메시지 중 `SYNC_ADMIN`, `MULTIPLAYER_SIGNAL`, `CHECK_STATUS`, `SYNC_STATUS` 처리
- **워커(봇 프로세스)**: `quizbot/bot.js`
  - Discord Client 초기화 및 이벤트 처리
  - UI 시스템, 퀴즈 시스템, DB 매니저, IPC 매니저, 모니터링 서비스 초기화
  - 커맨드 등록 및 권한/점검모드 검사

## 3) 주요 모듈 책임
- `quizbot/managers/command_manager.js`
  - 전역/길드 슬래시 커맨드 정의 및 Discord API 등록
- `quizbot/managers/db_manager.js`
  - PostgreSQL 풀 연결 및 퀴즈/문항/좋아요/옵션 관련 쿼리 수행
- `quizbot/managers/multiplayer_manager.js`, `multiplayer_chat_manager.js`, `multiplayer_signal.js`
  - 서버 간 대전 로비/시그널/채팅 기능
- `quizbot/managers/monitoring_manager.js`
  - 리소스 모니터링 시작(메인 클러스터 한정)
- `quizbot/quiz_system`, `quizbot/quiz_ui`, `quizbot/quiz_option`
  - 게임 세션, UI 상태, 서버별 옵션 관리

## 4) 설정 및 데이터
- `config/private_config.json`
  - 봇 토큰/클라이언트ID, DB 연결 정보, 관리자 ID
- `config/system_setting.js`
  - 재생 시간 제한, 힌트 정책, 로그/리소스 경로, DB 풀 크기, 모니터링 임계치 등 광범위한 운영 상수
- `resources/`
  - 공지/점검/밴 목록/태그 설정 등 운영 데이터 파일

## 5) 강점
- 샤딩 + 클러스터 구조로 대규모 길드 대응을 고려한 설계
- 기능 분리(매니저/시스템/UI/옵션)로 책임이 비교적 명확
- DB 쿼리 레이어를 별도 모듈로 분리해 확장 여지 확보
- 실시간 공지, 점검모드, 관리자 알림 등 운영 편의 기능 존재

## 6) 리스크 및 개선 포인트
1. `db_manager.js`에서 일부 쿼리가 문자열 보간 방식으로 작성되어(SQL 인젝션 관점) 파라미터 바인딩 일관성이 떨어짐
2. `web/web_manager.js`의 로거 import 경로가 현재 구조와 불일치할 가능성(`../logger.js`)이 높음
3. 설정 파일(`private_config.json`)이 저장소에 포함되어 있어 운영 시크릿 노출 위험이 있음
4. ESLint 설정은 있으나 CI/검증 스크립트(`npm scripts`) 부재로 품질 게이트 자동화가 약함

## 7) 온보딩 추천 순서
1. `Readme.md`의 설치/실행 흐름 파악
2. `index.js` → `quizbot/bot.js` 순서로 부트스트랩 확인
3. `command_manager.js`로 진입점(커맨드) 파악
4. `quiz_system`과 `quiz_ui` 상호작용 추적
5. `db_manager.js`의 쿼리/테이블 스키마 요구사항 정리

## 8) 한 줄 결론
- 이 프로젝트는 실서비스 운영 경험이 반영된 **기능 풍부한 Discord 퀴즈봇**이며, 아키텍처는 충분히 확장지향적입니다. 다만 보안/품질 자동화(시크릿 관리, SQL 작성 일관성, CI)는 우선 보완 대상입니다.
