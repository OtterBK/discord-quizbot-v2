'use strict';

//os(운영체제 리소스 조회)를 경계에서 mock 처리해 실행 환경의 실제 CPU/메모리 상태에
//의존하지 않고 계산 로직을 검증한다 (REFACTOR_PLAN.md 2.4).
//calculateAverageCpuUsage는 원래 모듈 스코프의 cpu_usage_history를 직접 필터링/참조하는
//비순수 함수였는데, (history, now)를 인자로 받는 순수 함수로 추출해 테스트 가능하게 만들었다.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const monitoring_manager = require('../../quizbot/managers/monitoring_manager.js');

test('getCpuUsage: 코어별 idle/tick 합산으로 사용률(%)을 계산한다', (t) =>
{
  const fake_core_times = { user: 50, nice: 0, sys: 30, idle: 20, irq: 0 }; // core당 tick 합 100, idle 20 -> 사용률 80%

  t.mock.method(os, 'cpus', () => [
    { times: { ...fake_core_times } },
    { times: { ...fake_core_times } },
  ]);

  assert.equal(monitoring_manager.getCpuUsage(), '80.00');
});

test('getMemoryUsage: 전체 메모리 대비 사용 중인 메모리 비율(%)을 계산한다', (t) =>
{
  t.mock.method(os, 'totalmem', () => 1000);
  t.mock.method(os, 'freemem', () => 250);

  assert.equal(monitoring_manager.getMemoryUsage(), '75.00');
});

test('calculateAverageCpuUsage: 기록이 없으면 null을 반환한다', () =>
{
  assert.equal(monitoring_manager.calculateAverageCpuUsage([], Date.now()), null);
});

test('calculateAverageCpuUsage: 아직 평균 계산 기간(duration)만큼 기록이 쌓이지 않았으면 null을 반환한다', () =>
{
  const now = 1_000_000;
  const history = [{ timestamp: now - 1000, usage: 50 }]; // duration(300000)에 비해 너무 최근 기록뿐

  assert.equal(monitoring_manager.calculateAverageCpuUsage(history, now), null);
});

test('calculateAverageCpuUsage: duration 밖의 오래된 기록은 제외하고 평균을 계산한다', () =>
{
  const duration = SYSTEM_CONFIG.MONITORING_AVERAGE_DURATION;
  const now = 1_000_000;

  const history = [
    { timestamp: now - duration - 1000, usage: 999 }, // duration 밖 -> 제외되어야 함
    { timestamp: now - duration, usage: 10 },          // duration 경계(포함)
    { timestamp: now - 100000, usage: 20 },
    { timestamp: now - 1000, usage: 30 },
  ];

  // (10 + 20 + 30) / 3 = 20.00, 999는 포함되면 안 됨
  assert.equal(monitoring_manager.calculateAverageCpuUsage(history, now), '20.00');
});

test('getLogFilePath: LOG_PATH 아래 monitoring_log_YYYY_MM_DD.csv 형식 경로를 반환한다', () =>
{
  const log_file_path = monitoring_manager.getLogFilePath();

  //SYSTEM_CONFIG.LOG_PATH는 정규화 전 경로(슬래시 혼용)라 path.resolve로 맞춰서 비교
  assert.equal(path.dirname(log_file_path), path.resolve(SYSTEM_CONFIG.LOG_PATH));
  assert.match(path.basename(log_file_path), /^monitoring_log_\d{4}_\d{2}_\d{2}\.csv$/);
});
