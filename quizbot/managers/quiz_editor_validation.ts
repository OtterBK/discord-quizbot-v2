'use strict';

//퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 2 - user-question-info-ui.ts(파일 자체 주석:
//"건드릴 엄두가 안난다... 우선 돌아가면 장땡")/user-quiz-info.ui.ts에 흩어져 있던 인터랙션-비의존
//검증/파싱 로직을 순수 함수로 추출한 모듈. multiplayer_mmr.js와 동일한 관례("부수효과 없는 순수
//함수는 managers/에 바로 둔다"). 디스코드 UI가 계속 이 함수들을 호출하고(동작 변경 없는 순수 이관),
//Phase 3~4의 REST 핸들러(web_quiz_editor_routes.ts)도 같은 함수를 재사용한다.

const ytdl = require('discord-ytdl-core');

const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const utility = require('../../utility/utility.js');

//user-question-info-ui.ts의 applyQuestionInfo/applyQuestionAnsweringInfo가 모달의 "25 ~ 40" 형식
//입력을 [start, end, play_time]으로 파싱하던 로직 그대로 이관 - 동작 변경 없음(순수 이관).
exports.parseAudioRangePoints = (audio_range_row: any): [number | undefined, number | undefined, number | undefined] =>
{
  if(audio_range_row.undefined || audio_range_row.length === 0) //생략 시,
  {
    return [undefined, undefined, undefined];
  }

  audio_range_row = audio_range_row.trim();
  if(audio_range_row.endsWith('~')) //25 ~ 이런식으로 쳤으면 ~ 제거
  {
    audio_range_row = audio_range_row.slice(0, audio_range_row.length - 1);
  }

  if(audio_range_row.length === 0) //정제하니깐 생략 시,
  {
    return [undefined, undefined, undefined];
  }

  const audio_range_split = audio_range_row.split('~');

  const audio_start = audio_range_split[0].trim();
  const audio_end = (audio_range_split.length >= 2 ? audio_range_split[1].trim() : undefined);
  let audio_play_time = undefined;

  let audio_start_value = (isNaN(audio_start) || audio_start < 0) ? undefined : Math.floor(audio_start); //소수점과 음수값일 경우 처리
  let audio_end_value = (isNaN(audio_end) || audio_end < 0) ? undefined : Math.floor(audio_end);

  if(audio_start_value !== undefined
    && audio_end_value !== undefined)
  {
    if(audio_start_value > audio_end_value) //start > end 처리
    {
      const temp = audio_start_value;
      audio_start_value = audio_end_value;
      audio_end_value = temp;
    }

    audio_play_time = (audio_end_value - audio_start_value);
  }

  return [audio_start_value, audio_end_value, audio_play_time];
};

//user-question-info-ui.ts의 applyQuestionAdditionalInfo가 오디오 반복 횟수 입력을 정제하던 로직 그대로
//이관 - SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT 상한 클램프 포함.
exports.redefineRepeatCount = (audio_repeat_count: any): number =>
{
  if(!audio_repeat_count || isNaN(audio_repeat_count)) //생략 시,
  {
    return 1; //기본 1회
  }

  const count = parseInt(audio_repeat_count);

  if(count <= 0)
  {
    return 1;
  }

  if(count > SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT)
  {
    return SYSTEM_CONFIG.MAX_QUESTION_AUDIO_REPEAT;
  }

  return count;
};

//user-question-info-ui.ts의 applyQuestionAdditionalInfo에 인라인으로 있던 문자열 매칭 - 뭐라도
//입력만 하면(스페이스 하나 실수로 입력해도) 사용으로 처리되던 예전 버그를 막기 위해 명확한 긍정
//응답 5개만 인정한다(디스코드 모달 전용 - 웹은 실제 체크박스가 있어 boolean을 직접 받음, Phase 4).
exports.parseUseAnswerTimer = (input: any): boolean =>
{
  return ['사용', '네', '예', 'y', 'Y'].includes((input ?? '').trim());
};

//user-question-info-ui.ts의 displayQuestionInfo에 3번(문제/힌트/정답) 반복되던 "빈 값이면 유효한 것으로
//취급, 아니면 실제 URL 형식 검사" 패턴 - 이미지용.
exports.isValidImageUrl = (url: any): boolean =>
{
  return (url ?? '').length === 0 || utility.isValidURL(url);
};

//위와 동일 패턴의 오디오용(ytdl.validateURL 기준).
exports.isValidAudioUrl = (url: any): boolean =>
{
  return (url ?? '').length === 0 || ytdl.validateURL(url);
};

//user-question-info-ui.ts의 displayQuestionInfo에 3번(문제/힌트/정답 이미지) 반복되던 디스코드 CDN
//경고 체크 - cdn.discordapp.com에 올린 이미지는 일정 시간 후 만료되므로 경고 문구를 붙여줘야 함.
exports.isDiscordCdnLink = (url: any): boolean =>
{
  return (url ?? '').includes('cdn.discordapp.com');
};

//user-quiz-info.ui.ts의 quiz_toggle_public 핸들러에 있던 "태그를 1개 이상 선택해야 공개 전환 가능"
//조건 추출 - 비공개→공개 전환 시에만 체크(공개→비공개는 항상 허용, 호출부에서 그대로 분기).
exports.canGoPublic = (tags_value: any): boolean =>
{
  return !(!tags_value || tags_value === 0);
};
