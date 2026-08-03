'use strict';

//multiplayer_manager.js(MultiplayerSession.calcWinnerMMR/calcLoserMMR)에서 분리 (REFACTOR_PLAN.md Phase 3)
//원래는 MultiplayerSession 인스턴스의 this.question_num/this.scoreboard.size/this.top_score를
//암묵적으로 참조하는 메서드였는데, 필요한 값을 인자로 받는 순수 함수로 뽑아냈다
//(quiz_system Phase 1의 monitoring_manager.calculateAverageCpuUsage와 같은 패턴).
//공식/주석은 원본과 동일 (계산 결과 동일, 동작 변경 없음).

exports.calcWinnerMMR = (guild_info, question_num, participant_count) =>
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

exports.calcLoserMMR = (guild_info, score = 0, question_num, top_score) =>
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
  const question_ratio = Math.min(0.5, current_quiz_size / max_question_size);
  mmr_add *= question_ratio; // 문제 수 비율만큼 감소(적게 했으면 적게) 최대 50퍼 감면

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
