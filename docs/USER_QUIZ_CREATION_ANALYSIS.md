# 유저 퀴즈 제작 기능 상세 분석

## 1. 진입점과 접근 제약
- 유저 제작 기능의 진입점은 `/퀴즈만들기` 슬래시 명령(또는 동일 버튼 이벤트)입니다.
- 길드 채널에서 요청하면 즉시 DM 사용을 안내하고, 실제 제작 UI는 **개인 채널(DM)** 에서만 생성됩니다.
- 밴 목록(`resources/banned_user.txt`)에 포함된 유저는 제작 기능 진입이 차단됩니다.

## 2. UI 아키텍처(핵심)
- 제작 UI는 `ui-system-core`의 `createQuizToolUIHolder()`에서 생성됩니다.
- holder key는 `user_id`이며, 동일 유저의 이전 제작 UI holder가 있으면 free 후 교체합니다.
- `UI_HOLDER_TYPE.PRIVATE`로 생성되어 DM 메시지 기반으로 업데이트됩니다.

## 3. 제작 플로우(Quiz 단위)
1) `UserQuizListUI` 로드
- `onReady()`에서 DB 조회 후 보유 퀴즈 목록을 출력합니다.
- 목록이 없으면 생성 유도 문구를 보여줍니다.

2) 새 퀴즈 생성
- `request_modal_quiz_create` 클릭 시 `modal_quiz_info` 표시
- 입력값(제목/한줄소개/상세설명/썸네일)을 `UserQuizInfo`에 매핑
- 초기값: `is_private=true`, `played_count=0`, `played_count_of_week=0` 등
- `saveDataToDB()` 성공 시 생성된 `quiz_id`로 편집 화면 진입

3) 퀴즈 편집
- `UserQuizInfoUI(readonly=false)`에서 제목/설명/태그/공개여부/삭제 관리
- 공개 전환 시 태그 1개 이상 강제(태그 미선택이면 공개 전환 거부)
- 삭제는 hard delete가 아니라 `is_use=false` 처리

## 4. 제작 플로우(Question 단위)
1) 문제 추가
- `request_modal_question_add` → `modal_question_info`
- 최대 50문제 제한

2) 문제 정보 저장
- 기본 정보(`answers`, 문제 오디오/이미지/텍스트, 오디오 구간)
- 추가 정보(힌트, 힌트 이미지, 오디오 반복, 정답 여유시간)
- 정답 이벤트 정보(정답 오디오/이미지/텍스트, 정답 오디오 구간)

3) 보정/검증 로직
- 오디오 구간은 `~` 기반 파싱, 음수/NaN 방어, start/end 역전 시 swap
- 오디오 반복 횟수는 1~`MAX_QUESTION_AUDIO_REPEAT`로 보정
- URL은 표시 시점에 유효성 검사를 수행하며, 문제/정답 이미지 URL 변경 시 embed resend 우회 처리

## 5. 데이터 모델과 저장 구조
- 퀴즈 메타: `tb_quiz_info`
  - 작성자 정보, 제목/설명/썸네일, 공개 여부, 태그값, 플레이/좋아요/인증 통계
- 문제 데이터: `tb_question_info`
  - 정답, 문제/정답 오디오·이미지·텍스트, 구간값, 힌트, answer_type 등
- 매니저 계층:
  - `UserQuizInfo.saveDataToDB()` → `db_manager.insertQuizInfo/updateQuizInfo`
  - `UserQuestionInfo.saveDataToDB()` → `db_manager.insertQuestionInfo/updateQuestionInfo`

## 6. 플레이 연결(제작 → 소비)
- 제작된 퀴즈는 `UserQuizSelectUI`에서 전체 조회/정렬/태그/키워드 검색 후 선택 가능
- 선택 시 `UserQuizInfoUI(readonly=true)`로 열리고, start 버튼으로 실제 게임 세션 시작
- 시작 전 `quiz_system.checkReadyForStartQuiz()`로 보이스 채널 등 준비 상태 확인
- `InitializeCustomQuiz`가 `quiz_info.question_list`를 `quiz_data.question_list`로 변환/섞기 후 출제

## 7. 현재 구현의 장점
- DM 전용 편집 UX로 서버 채널 노이즈 최소화
- Quiz/Question 분리 편집, 모달 기반 입력으로 사용성 확보
- 공개 전 태그 강제, 문제 수 상한(50), 오디오/구간 보정 등 안전장치 보유
- readonly/편집 모드 분리로 재사용성 좋음

## 8. 개선 우선순위 제안(실제 운영 기준)
1) DB write await 일관성
- `delete()`, `addPlayedCount()`, `updateModifiedTime()` 등이 await 없이 fire-and-forget 형태인 구간이 있음.
- 실패 전파/재시도/사용자 피드백을 위해 중요한 쓰기 경로는 await + 에러 핸들링 권장.

2) 필드 정합성 검증 강화
- 현재 URL 유효성 검사는 주로 표시/플레이 단계에서 처리됨.
- 저장 시점에도 최소한의 검증/정규화(예: 공백 trim, 잘못된 URL 거부)를 추가하면 데이터 품질이 개선됨.

3) N+1성 호출 및 UI 갱신 동기화
- 일부 경로에서 저장 후 별도 메타 업데이트(수정일) 호출이 분리되어 있음.
- 트랜잭션 또는 단일 쿼리 묶음으로 정합성과 성능을 개선할 수 있음.

4) 검색/정렬 성능
- `UserQuizSelectUI`는 전체 로드 후 메모리 정렬/필터 방식.
- 퀴즈가 대량화되면 DB 레벨 페이징/검색으로 이전하는 것이 유리함.

## 9. 참고: 이전 코멘트 반영 사항
- `private_config.json`은 예시용이라는 점을 고려해 시크릿 리스크를 일반론으로 과장하지 않음.
- `web_manager.js`는 현재 미사용(폐기) 모듈로 간주하여 핵심 분석 대상에서 제외.
- ESLint 재설정은 추후 과제로 분리하고, 당장 핵심은 퀴즈 제작/저장 플로우 안정화에 둠.
