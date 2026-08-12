# 운영 스크립트(`auto_script/`) 개선 작업계획서 (2026-08-12 조사+구현 완료)

> **✅ 완료 (2026-08-12, 같은 날 후속 세션).** 아래 "확인이 필요한 질문" 5개를 순서대로 사용자와
> 논의해 답을 받고, 착수 확인 과정에서 더 심각한 사실(운영 서버가 TS 마이그레이션 이전 구코드로
> 돌고 있음 — "결정 사항" 섹션 참고)을 추가로 발견해 함께 반영했다. 실제 변경 내용 요약은
> `docs/COMPLETED_WORK_LOG.md` 2026-08-12 "`auto_script/` 운영 스크립트 개선 구현 완료" 항목 참고.
> 아래 원본 조사 내용(발견 8건, 질문 5개)은 왜 이렇게 결정했는지 근거로 그대로 남겨둔다.

## 결정 사항 (2026-08-12, 질문 답변 결과)

1. **운영 방식**: 스크립트 그대로(포그라운드 `node index.js`, `dist/` 안 씀) 확인됨 — 단, 확인 도중
   `.ts`로 전환된 매니저가 있어 이 실행 방식 자체가 이제 크래시를 유발한다는 걸 발견(아래 참고).
   → **`dist/index.js` 실행 + systemd 데몬화로 전환**.
2. **저장소 주소**: `OtterBK/Quizbot3`는 실수로 안 고친 옛 이름, `OtterBK/discord-quizbot-v2`가 맞음 →
   수정 완료. 추가 요구사항으로 **설치 시 브랜치 선택(master/develop-v3.5 등) 프롬프트**도 함께 추가.
3. **설치 경로**: 항상 기본 경로(`/home/ubuntu/quizbot3`)만 사용해왔음 — 하드코딩 버그가 실제로 겪은
   문제는 아니었지만 systemd 전환으로 경로 하드코딩 자체가 사라짐.
4. **개선 범위**: cron 스크립트 전체 포함하기로 함 — `drop_ffmpeg.sh`/`db_script/` 하위는 검토 결과
   로직 버그 없어 그대로 유지, `update_yt-dlp.sh`는 curl 다운로드 경로 수정.
5. **데몬화 방식**: systemd 서비스 유닛 선택. cron의 기존 하루 2번(9시/21시) 명시적 stop/start와
   충돌 없도록 `Restart=on-failure`로 설계(수동 stop은 systemd 시맨틱상 자동재시작 대상이 아님).

**추가로 발견한 사실 (질문 1번 확인 도중)**: 지금 운영 중인 서버는 **TS 마이그레이션 이전 구코드가
배포된 상태**. 88개 이상의 `quizbot/`/`utility/`/`config` 하위 파일이 이미 `.ts`로 전환됐고 원본
`.js`는 삭제됐는데, Node.js는 `.ts`를 직접 `require()`할 수 없고(`ts-node/register` 같은 런타임 훅이
`index.js`/`bot.js` 어디에도 없음) `npm run build`(→ `dist/`) 없이 소스 `index.js`를 그대로 실행하면
전환된 매니저를 require하는 순간 크래시한다는 걸 실제로 재현해 확인함. 마침 현재 서버가 곧 만료돼
GCP에 새 서버를 만들 예정이고, 이번엔 `develop-v3.5`(TS 마이그레이션 반영 브랜치) 기준으로 재구축할
것이라 이 사실을 반영해 스크립트를 설계함 — `install_quizbot3.sh`가 `npm run build`까지 수행하고,
systemd 유닛이 `dist/index.js`를 실행하도록 함.

**이번 스코프에서 제외한 것**: 원격 백업(rsync) 스크립트 정식화(레포에는 실주소 안 남게 설계는
검토했으나 사용자가 "이번엔 빼줘"로 보류) — 지금처럼 크론탭에 수동으로만 유지.

## 대상 파일 지도

```
auto_script/
  install_quizbot3.sh              봇 자동 설치 스크립트 (신규 서버 프로비저닝)
  (deprecated)setup_quizbot3.sh    구버전 설치 스크립트 (이름부터 deprecated로 표시돼 있음, 참고만)
  정석 사용법.txt                    설치~운영 수동 절차 메모 (구버전 스크립트 이름을 참조하고 있어 최신화 필요해 보임)
  server_script/
    quizbot_start.sh                봇 실행 스크립트
    quizbot_stop.sh                 봇 중지 스크립트
    drop_ffmpeg.sh                  5분 이상 살아있는 orphan ffmpeg 프로세스 강제 종료 (cron, 매시 정각)
    update_yt-dlp.sh                yt-dlp 바이너리 최신화 (cron, 매일 9시/21시)
  db_script/
    backup_script.sh                DB 덤프 + 7일 지난 백업 삭제 (cron, 매일 8시/20시)
    reset_played_count_of_week.sh   주간 플레이 카운트 초기화 (cron, 매주 월요일 0시)
  db_backup/base.sql                최초 설치 시 복원용 기본 DB 덤프
```

`install_quizbot3.sh`가 설치 마지막 단계에서 위 스크립트들을 아래 스케줄로 cron에 등록한다(사용자가
설치 시 "Cron 등록?" 프롬프트에 y로 답한 경우):

```
매시 정각        drop_ffmpeg.sh
9시/21시         quizbot_stop.sh → update_yt-dlp.sh → (1분 뒤) quizbot_start.sh   ← 하루 2번 재시작
매주 월 0시      reset_played_count_of_week.sh
8시/20시         backup_script.sh
3시간마다        sync && drop_caches
```

즉 **봇이 하루 2번(9시/21시) 의도적으로 재시작**되는 운영 방식 — 아마 메모리 누수/yt-dlp 갱신/ffmpeg
고아 프로세스 정리를 겸하는 정기 리프레시로 보인다(확인 필요, 아래 질문 참고).

## 조사 중 발견한 것들 (코드 안 고침, 관찰만)

1. **`quizbot_start.sh`가 설치 경로를 하드코딩함** — `node /home/ubuntu/quizbot3/index.js`로 고정돼
   있는데, `install_quizbot3.sh`는 설치 경로를 사용자가 프롬프트로 직접 입력받고(`$INSTALL_PATH`)
   `/etc/profile.d/quizbot_path.sh`에 `$QUIZBOT_PATH`로 전역 등록까지 해준다. `update_yt-dlp.sh`/
   `backup_script.sh`는 실제로 `$QUIZBOT_PATH`를 읽어서 쓰는데, **`quizbot_start.sh`만 이 관례를 안
   따르고 하드코딩돼 있음** — 기본 설치 경로(`/home/ubuntu/quizbot3`)가 아닌 다른 경로에 설치하면
   실행 스크립트가 깨진다.
2. **`install_quizbot3.sh`가 클론하는 저장소 주소가 이 저장소의 실제 origin과 다름** —
   `sudo git clone https://github.com/OtterBK/Quizbot3.git "$INSTALL_PATH"`라고 돼 있는데, 이
   저장소의 실제 `git remote -v`는 `https://github.com/OtterBK/discord-quizbot-v2.git`이다. 저장소가
   리네임/이관됐는데 설치 스크립트가 옛날 이름을 그대로 참조하고 있는 것으로 보인다 — **이대로 새
   서버에 설치하면 완전히 다른(오래된) 코드를 받아올 가능성이 있음**. 가장 먼저 확인해야 할 항목.
3. **`quizbot_start.sh`가 포그라운드로 `node index.js`를 그대로 실행** — `nohup`/`&`/`disown`/
   `pm2`/`systemd` 같은 데몬화 수단이 전혀 없다. cron이 호출할 땐(터미널 세션이 없으므로) 그럭저럭
   동작하지만, 사람이 SSH로 접속해서 수동으로 이 스크립트를 실행하면 SSH 세션이 끊기는 순간 봇도
   같이 죽을 수 있다. 로그를 파일로 남기는 리다이렉션도 없어서(`> log 2>&1` 등), stdout/stderr가
   그냥 사라지는 것으로 보인다(cron이면 `MAILTO` 설정에 따라 메일로 갈 수도 있음, 확인 필요).
4. **`quizbot_start.sh`/`quizbot_stop.sh`가 프로세스 종료를 전부 `pkill -f`(이름 패턴 매칭)로 함** —
   `sudo pkill -f ".*ffmpeg.*"`처럼 **`node` 프리픽스 없이 `ffmpeg`이 들어간 모든 프로세스를 무조건
   죽인다**. 같은 서버에 다른 용도로 ffmpeg를 쓰는 프로세스가 있다면 같이 죽는다(전용 서버라 실제
   위험은 낮을 수 있지만, 스크립트만 보면 위험한 패턴). PID 파일 기반이 아니라 이름 패턴 매칭이라
   봇을 여러 인스턴스 띄우거나 다른 node 프로세스가 우연히 같은 패턴에 걸리면 오작동할 수 있다.
5. **`npm run build`/`dist/`를 이 설치·실행 흐름 어디서도 안 씀** — `install_quizbot3.sh`는
   `npm install` + `custom_node_modules` 복사만 하고 빌드는 안 함, `quizbot_start.sh`도 저장소
   루트의 `index.js`를 직접 실행(“`dist/index.js`”가 아님). 루트 `CLAUDE.md`엔 "운영 중인 봇 프로세스가
   `dist/`를 참조한다면 재빌드 필요"라는 경고가 있는데, **이 자동화 스크립트 기준으로는 애초에
   `dist/`를 안 쓰고 소스에서 직접 실행하는 것으로 보임** — 실제 운영 서버가 정말 이 스크립트 그대로
   돌고 있는지, 아니면 사람이 수동으로 `npm run build` 후 `dist/`에서 돌리는 별도 절차가 있는지
   확인 필요(아래 질문 1번과 직결).
6. **`정석 사용법.txt`가 옛날 스크립트 이름(`setup_quizbot3.sh`)을 참조** — 지금은
   `(deprecated)setup_quizbot3.sh`로 이름이 바뀌어 있고 실제 설치 스크립트는 `install_quizbot3.sh`인데,
   이 메모는 안 갱신된 것으로 보임.
7. **`update_yt-dlp.sh`가 `curl -LO`로 현재 작업 디렉터리에 먼저 내려받고 나서 `mv`로 옮김** — cron
   실행 시 작업 디렉터리가 어디인지에 따라 다운로드 파일이 엉뚱한 곳에 남을 수 있음(`-o
   "$TARGET_PATH/yt-dlp"`로 바로 받으면 더 안전). 상대적으로 경미한 항목.
8. **`install_quizbot3.sh`가 PostgreSQL 14를 하드코딩** — 최신 Ubuntu 기본 apt 저장소에서 14가 계속
   유효한 버전인지는 실제 설치 시점에 확인 필요.

## 확인이 필요한 질문 (착수 전 사용자에게 먼저 물어볼 것)

1. **실제 운영 서버는 지금 이 스크립트(포그라운드 `node index.js`, `dist/` 안 씀) 그대로 돌아가고
   있는가, 아니면 사람이 수동으로 다르게(pm2/systemd/`dist/` 빌드 등) 운영 중인가?** — 이게 스크립트
   개선 방향을 완전히 바꾼다(단순 버그 수정 vs 데몬화 방식 전면 교체).
2. **`install_quizbot3.sh`가 클론하는 저장소 주소(`OtterBK/Quizbot3`)가 실제로 옛날 저장소인가,
   의도된 것인가?** — 위 발견 2번. 만약 옛날 저장소가 맞다면 이건 단순 스타일 문제가 아니라 "새
   서버 설치하면 완전히 오래된 코드가 깔리는" 실질적 버그이므로 최우선 처리 후보.
3. **하드코딩된 `/home/ubuntu/quizbot3` 외의 경로로 실제 설치해본 적이 있는가?** — 위 발견 1번이
   실제로 문제였던 적이 있는지, 아니면 지금까지 항상 기본 경로만 써서 안 드러났는지.
4. **개선 범위**: "자동 설치 스크립트, 실행 스크립트, 중지 스크립트"라고만 지정됐는데, `drop_ffmpeg.sh`/
   `update_yt-dlp.sh`/`db_script/` 하위(백업/주간 초기화)도 같이 손볼지, 아니면 딱 install/start/stop
   3개만 볼지.
5. **데몬화 방식 선호**: 만약 포그라운드 실행이 실제 문제로 확인되면, `pm2`/`systemd` 서비스 유닛/
   단순 `nohup ... &` 중 어떤 방식을 선호하는지(설치 스크립트가 이미 `sudo` 기반 Ubuntu 서버를
   가정하고 있어 `systemd`가 자연스러워 보이지만, 기존 cron 기반 재시작 스케줄과 겹치지 않게
   설계해야 함 — 이미 하루 2번 cron이 stop/start를 명시적으로 호출하고 있어서, systemd의
   자동재시작(`Restart=always`)과 cron의 명시적 재시작이 서로 경쟁하지 않도록 조율 필요).

## 코드 스타일/컨벤션 참고

- 이 저장소의 `docs/CLAUDE.md`(루트)에 셸 스크립트 전용 컨벤션은 따로 없음 — `auto_script/` 내
  기존 스크립트들의 스타일(주석 영어, `print_emphasized`류 헬퍼, `set -e` 없이 각 명령 결과를
  암묵적으로 무시하는 방식)을 그대로 따르면 무난해 보임.
- 루트 `CLAUDE.md`의 "빌드/배포" 섹션(`dist/` 관련 경고)과 이 문서의 발견 5번이 서로 어긋나 보이므로,
  착수 시 실제 상태를 먼저 확인해서 필요하면 루트 `CLAUDE.md`도 같이 갱신할 것.
