'use strict';

exports.SYSTEM_CONFIG = {
  LANGUAGE: 'kor', //사용 언어

  DEVELOP_MODE: true, //개발자 모드 활성화, console 로깅 등
  MAINTENANCE_MODE: false, //점검 모드, 어드민만 봇 사용 가능
  MAINTENANCE_ALERT: '현재 퀴즈봇을 점검하고 있습니다.', //점검 모드 시, 안내 문구

  USE_INLINE_VOLUME: false, //성능 많이 잡아먹음, 렉 많으면 끌 것, false 설정 시, fade in,out 효과 없음 
  FADE_INTERVAL: 500, //fade in,out 시 사용할 interval(ms), 값이 낮을수록 부드러운 fade 효과를 얻을 수 있으나 리소스를 많이 잡아먹음
  FADE_IN_DURATION: 5000, //fade in 시간(ms)
  FACE_OUT_DURATION: 5000, //fade out 시간(ms)
  FACE_IN_VOLUME_INITIALIZE_TERM: 500, //fade in은 초기 볼륨을 설정하고 시작한다. 이때 볼륨 설정하고 일정한 텀을 줘야 제대로 적용된다.

  MAX_QUESTION_AUDIO_PLAY_TIME: 60, //문제용 오디오 최대 허용 길이(s)
  MAX_ANSWER_AUDIO_PLAY_TIME: 13, //정답용 오디오 최대 허용 길이(s)
  MAX_QUESTION_AUDIO_REPEAT: 5, //문제용 오디오 최대 반복 가능 횟수
  MAX_QUESTION_TOTAL_AUDIO_PLAY_TIME: 70, //반복 재생 포함하여 진짜 최대 길이

  MAX_CHECK_PREPARED_QUEUE: 120, //prepared queue 최대 확인 횟수
  PREPARED_QUEUE_CHECK_INTERVAL: 250, //prepared queue 체크 간격

  UI_HOLDER_AGING_MANAGER_CRITERIA: 900, //얼마나 오래된 holder를 삭제할 지(s)
  UI_HOLDER_AGING_MANAGER_INTERVAL: 600, //체크 주기(s)

  GUILDS_COUNT_MANAGER_INTERVAL: 10, //참여 중인 guild 수 체크 주기(s)

  CORRECT_ANSWER_CYCLE_WAIT: 6500, //정답 맞췄을 시, 얼마나 대기할 지
  TIMEOVER_CYCLE_WAIT: 6500, //타임오버 시, 얼마나 대기할 지
  GRACEFUL_TIMEOVER_MAX_TRY: 0, //타임오버 시, 부드러운 타임 오버를 위한 최대 시도 수
  GRACEFUL_TIMEOVER_INTERVAL: 500, //부드러운 타임 오버 체크 간격 (ms)

  EXPLAIN_WAIT: 3000, //퀴즈 설명 단계에서 각 설명 텀
  ENDING_WAIT: 3500, //순위 발표 단계에서 각 순위 표시 텀

  BGM_PATH: `${__dirname}/../resources/bgm`, //BGM 파일 위치
  DEV_QUIZ_PATH: `${__dirname}/../resources/quizdata`, //Dev퀴즈 파일 위치
  LOG_PATH: `${__dirname}/../log`, //LOG 저장할 위치
  NOTICES_PATH: `${__dirname}/../resources/notices`, //공지사항 파일 위치
  CURRENT_NOTICE_PATH: `${__dirname}/../resources/current_notice.txt`, //실시간 공지
  // fixed_notice_path: `${__dirname}/../resources/fixed_notice.txt`, //고정 공지...애매하네 걍 쓰지말자
  // version_info_path: `${__dirname}/../resources/version_info.txt`, //실시간 버전. 24.10.12 -> 이제 안쓴다.
  BANNED_USER_PATH: `${__dirname}/../resources/banned_user.txt`, //퀴즈만들기 밴
  TAGGED_DEV_QUIZ_INFO: `${__dirname}/../resources/tagged_dev_quiz_info.json`, //공식 퀴즈 태그 설정값

  HINT_PERCENTAGE: 2, //4로 설정하면 정답 전체의 1/4만 보여주겠다는 거임
  HINT_MAX_TRY: 1000, //힌트 만들 때 최대 시도 횟수

  PG_MAX_POOL_SIZE: 5, //Postgresql max pool 개수

  LOG_MAX_FILES: 10, //log로 남길 파일 최대 수
  LOG_MAX_SIZE: '100m', //각 log 파일 최대 크기
    
  FFMPEG_KILL_TIMEOUT: 70000, //ffmpeg에서 에러 발생 시나, start 안했을 시 안꺼지는 버그 있음. 최대 timeout 설정해서 시간 지나면 강종
  FFMPEG_AGING_MANAGER_CRITERIA: 300, //5분 지나도 안꺼지면 ffmpeg는 강종
  FFMPEG_AGING_MANAGER_INTERVAL: 300, //체크 주기(s)

  CUSTOM_AUDIO_MAX_THROTTLE: 500 * 1024,
    
  CUSTOM_AUDIO_MAX_FILE_SIZE: '10M', //문제용 오디오 파일 최대 용량
  CUSTOM_AUDIO_YTDL_MAX_LENGTH: 1200, //문제용 오디오로 사용가능한 오디오 최대 길이(s)
  // custom_audio_cache_path: `${__dirname}/../resources/cache`,
  CUSTOM_AUDIO_CACHE_PATH: `G:/quizdata/cache`,

  YTDL_COOKIE_PATH: `${__dirname}/../resources/ytdl_cookie.json`,
  YTDL_IPV6_USE: true, //IPv6도 함께 사용할지 여부

  CERTIFY_LIKE_CRITERIA: 10, //인증된 퀴즈 전환을 위한 추천 수 기준
  CERTIFY_PLAYED_COUNT_CRITERIA: 50, //인증된 퀴즈 전환을 위한 플레이 수 기준

  CHECK_KOREAN_BOT_VOTE: false, //챗 기능 사용 시, KOREAN BOT 추천해야지만 사용할 수 있는지 여부

  //Monitoring service
  MONITORING_CHECK_INTERVAL: 30000, // 리소스 모니터링 주기
  MONITORING_AVERAGE_DURATION: 300000, // 리소스 평균값 계산 시, 사용할 duration
  MONITORING_CPU_USAGE_THRESHOLD: 90, // 경고 로그 남길 기준 percentage
};

exports.CUSTOM_EVENT_TYPE = {
  interactionCreate: "interactionCreate",
  messageCreate: "messageCreate",
  receivedMultiplayerSignal: "receivedMultiplayerSignal"
};

exports.QUIZ_TYPE = {
  SONG: "노래 퀴즈",
  SCRIPT: "대사 퀴즈",
  // SELECT: "객관식", //안씀
  // TTS: "TTS 사용방식", //안씀
  GLOWLING: "포켓몬 울음소리",
  IMAGE: "그림 퀴즈",
  OX: "OX 퀴즈",
  OX_LONG: "타이머 긴 OX 퀴즈",
  TEXT: "텍스트 퀴즈",
  TEXT_LONG: "타이머 긴 텍스트 퀴즈",
  // FAST_QNA: "텍스트 기반 qna, 타이머 짧음", //안씀
  INTRO: "인트로 맞추기",
  MULTIPLAY: "멀티플레이",
  IMAGE_LONG: "타이머 긴 그림 퀴즈",
  CUSTOM: "커스텀 퀴즈",
  OMAKASE: "오마카세 퀴즈",
};

exports.EXPLAIN_TYPE = {
  SHORT_ANSWER_TYPE: "short_answer",
  CUSTOM_ANSWER_TYPE: "custom_answer",
  OMAKASE_ANSWER_TYPE: "omakase_answer",
  MULTIPLAYER_ANSWER_TYPE: "multiplayer_answer",
};

exports.BGM_TYPE = {
  BELL: "bell.webm",
  COUNTDOWN_10: "countdown10.webm",
  COUNTDOWN_LONG: "longTimer",
  ENDING: "ENDING.webm",
  FAIL: "FAIL.webm",
  MATCH_FIND: "MATCH_FIND.webm",
  MATCHING: "MATCHING.webm",
  PLING: "pling.webm",
  ROUND_ALARM: "ROUND_ALARM.webm",
  SCORE_ALARM: "SCORE_ALARM.webm",
  SUCCESS: "SUCCESS.webm",
  FAILOVER: "FAILOVER.webm",
  DOOR_BELL: "DOOR_BELL.webm",
  CHAT: "CHAT.webm",
};

exports.QUIZ_MAKER_TYPE = {
  BY_DEVELOPER: '개발자 제작 퀴즈',
  CUSTOM: '유저 제작 퀴즈',
  OMAKASE: '오마카세 퀴즈',
  UNKNOWN: '알 수 없음',
};

exports.ANSWER_TYPE = {
  SHORT_ANSWER: 1,
  OX: 2,
  MULTIPLE_CHOICE: 3,
};

exports.QUIZ_TAG = { // 태그는 32비트로 확장
  '선택 안함':     0b00000000000000000000000000000000,  // 0
  '음악 퀴즈':     0b00000000000000000000000000000001,  // 1
  '그림 퀴즈':     0b00000000000000000000000000000010,  // 2
  '텍스트 퀴즈':   0b00000000000000000000000000000100,  // 4

  '가요':          0b00000000000000000000000000001000,  // 8
  '애니':          0b00000000000000000000000000010000,  // 16
  '게임':          0b00000000000000000000000000100000,  // 32
  '방송':          0b00000000000000000001000000000000,  // 4096
  '드라마':        0b00000000000000000000000001000000,  // 64
  '영화':          0b00000000000000000000000010000000,  // 128
  '스포츠':        0b00000000000000000010000000000000,  // 8192
    
  '팝송':          0b00000000000000000000000100000000,  // 256
  'K팝':           0b00000000000000000000001000000000,  // 512
  'J팝':           0b00000000000000000000010000000000,  // 1024
  '보컬로이드':    0b00000000000000000100000000000000,  // 16384

  '기타':          0b00000000000000000000100000000000,  // 2048
	
  // 남은 비트: 0b11000000000000000000000000000000  // 3221225472
};

exports.DEV_QUIZ_TAG = { // 공식 퀴즈용 태그, 32비트로 확장
  "선택 안함":     0b00000000000000000000000000000000,  // 0
  // "음악 퀴즈":  0b00000000000000000000000000000001,  // 1
  // "그림 퀴즈":  0b00000000000000000000000000000010,  // 2
  // "텍스트 퀴즈":0b00000000000000000000000000000100,  // 4

  // "가요":       0b00000000000000000000000000001000,  // 8
  "애니":          0b00000000000000000000000000010000,  // 16
  "게임":          0b00000000000000000000000000100000,  // 32
  // "방송":       0b00000000000000000001000000000000,  // 4096
  "드라마":        0b00000000000000000000000001000000,  // 64
  "영화":          0b00000000000000000000000010000000,  // 128
  // "스포츠":     0b00000000000000000010000000000000,  // 8192
    
  "팝송":          0b00000000000000000000000100000000,  // 256
  "K팝":           0b00000000000000000000001000000000,  // 512
  // "J팝":        0b00000000000000000000010000000000,  // 1024

  // "기타":       0b00000000000000000000100000000000,  // 2048
  "고전가요":      0b00000000000000000100000000000000,  // 16384
};

