'use strict';

//multiplayer_manager.js(MultiplayerSession.calcWinnerMMR/calcLoserMMR)에서 분리 (REFACTOR_PLAN.md Phase 3)
//원래는 MultiplayerSession 인스턴스의 this.question_num/this.scoreboard.size/this.top_score를
//암묵적으로 참조하는 메서드였는데, 필요한 값을 인자로 받는 순수 함수로 뽑아냈다
//(quiz_system Phase 1의 monitoring_manager.calculateAverageCpuUsage와 같은 패턴).
//공식/주석은 원본과 동일 (계산 결과 동일, 동작 변경 없음).

interface GuildInfo
{
  stat: {
    win: number;
    lose: number;
  };
}

exports.calcWinnerMMR = (guild_info: GuildInfo | undefined, question_num: number, participant_count: number): number =>
{
  if (!guild_info)
  { // 예외 처리
    return 0;
  }

  const stat = guild_info.stat;
  const win = stat.win;
  const lose = stat.lose;

  // 승률 계산
  let win_rate = 0;
  if (win + lose !== 0)
  {
    win_rate = win / (win + lose);
  }

  const base_mmr = 80; // 기본 80
  const max_question_size = 60; // 최대 60문제
  const current_quiz_size = question_num + 1;

  // 3명부터 0.3배씩 보너스
  const participant_bonus = Math.max(0, participant_count - 2) * 0.3;
  let mmr_add = base_mmr * (1 + participant_bonus);

  // 진행된 문제 수 비율 계산
  const question_ratio = current_quiz_size / max_question_size;
  mmr_add *= question_ratio; // 문제 수 비율만큼 점수 계산

  // 승률 보너스는 최대 얻는 점수의 1/2 (base_mmr을 초과하지 않음)
  const win_rate_bonus_max = Math.min(base_mmr, mmr_add * 0.5);
  const win_rate_bonus = win_rate >= 0.5 ? Math.min(win_rate_bonus_max, win_rate * win_rate_bonus_max) : 0;

  mmr_add += win_rate_bonus; // 승률 보너스 추가

  return Math.round(mmr_add); // 소수점 반올림
};

exports.calcLoserMMR = (guild_info: GuildInfo | undefined, score: number = 0, question_num: number, top_score: number): number =>
{
  const base_mmr = -100; // 기본 -100
  if (!guild_info)
  { // 탈주 처리
    return base_mmr; // 탈주 시 최대치 패널티
  }

  let mmr_add = base_mmr;

  const max_question_size = 60; // 최대 60문제
  const current_quiz_size = question_num;

  // 우선 끝까지 했으면 80퍼만 감소
  mmr_add *= 0.80;

  // 진행된 문제 수 비율 계산
  // (2026-08-12, MMR 비대칭 보정 - 사용자 피드백 "점수 변동폭이 부적절") 원래 여기만 0.5로 캡이
  // 걸려있어서, calcWinnerMMR의 question_ratio(캡 없음, 풀게임이면 최대 1.0)와 달리 풀게임을 져도
  // 최대 -40점까지밖에 안 깎였음(승자는 최대 120점까지 얻음) - 승자와 동일하게 캡을 제거해서
  // 구조적 비대칭만 보정(다른 보너스/공식은 그대로 유지).
  const question_ratio = current_quiz_size / max_question_size;
  mmr_add *= question_ratio; // 문제 수 비율만큼 감소(적게 했으면 적게)

  // 최고 점수 대비 자신의 점수 비율 계산
  let score_ratio = 0;
  if (score > top_score || top_score === 0)
  {
    score_ratio = 0;
  }
  else
  {
    score_ratio = (score / (top_score !== 0 ? top_score : 1)) * 0.3;
  }

  // 점수 차이에 따른 보너스
  const score_bonus = (mmr_add * -1) * score_ratio;
  mmr_add += score_bonus;

  return Math.round(mmr_add); // 소수점 반올림
};
