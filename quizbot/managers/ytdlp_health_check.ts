//봇 시작 시 1회 yt-dlp 동작 점검 후 결과를 어드민 DM으로 보낸다 (2026-11-01).
//auto_script/server_script/check_yt-dlp.sh와 같은 내용(쿠키 파일 검사 + 시나리오별 시험)을 봇 안에서 수행.
//봇과 완전히 같은 시나리오 구성(audio_cache_manager.buildDownloadScenarios)으로 --simulate 실행하므로
//실제 파일은 받지 않고, 다운로드 시나리오 차단 상태(scenario_health)에도 영향을 주지 않는다.
//cluster가 여러 개라 0번 cluster에서만 호출할 것(bot.js registerMainClusterService).

const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const utility = require('../../utility/utility.js');
const audio_cache_manager = require('./audio_cache_manager');
const logger = require('../../utility/logger.js')('YtdlpHealthCheck');

const { DOWNLOAD_RESULT_TYPE } = audio_cache_manager;

const DEFAULT_HEALTH_CHECK_URL = 'https://youtu.be/gGNHBKW_pgo'; //쿠키 없으면 접근 안 되는 영상 - 쿠키 유효성 확인용
const LOGIN_COOKIE_NAMES = ['LOGIN_INFO', 'SAPISID', '__Secure-3PSID'];
const SCENARIO_TIMEOUT_MS = 60000;
const DAY_MS = 24 * 60 * 60 * 1000;

const RESULT_LABELS: Record<number, string> = {
  [DOWNLOAD_RESULT_TYPE.BOT_DETECTED]: '봇 차단',
  [DOWNLOAD_RESULT_TYPE.COOKIE_INVALID]: '쿠키 무효',
  [DOWNLOAD_RESULT_TYPE.NETWORK_ERROR]: '네트워크 불가',
  [DOWNLOAD_RESULT_TYPE.AGE_RESTRICTED]: '연령 제한(로그인 안 됨)',
  [DOWNLOAD_RESULT_TYPE.VIDEO_UNAVAILABLE]: '영상 삭제됨(테스트 URL 교체 필요)',
  [DOWNLOAD_RESULT_TYPE.PRIVATE_VIDEO]: '비공개 영상(테스트 URL 교체 필요)',
  [DOWNLOAD_RESULT_TYPE.PREMIUM]: '프리미엄 전용',
  [DOWNLOAD_RESULT_TYPE.ERROR]: '기타 오류',
};

/**
 * Netscape 형식 쿠키 파일 내용 검사. 쿠키 값은 다루지 않고 이름/만료일만 본다.
 * @returns problems: 문제 목록, expires_at: 로그인 쿠키 중 가장 이른 만료 시각(ms, 세션 쿠키만 있으면 undefined)
 */
const inspectCookieContent = (content: string): { problems: string[], expires_at: number | undefined } =>
{
  const problems: string[] = [];

  if(content.startsWith('# Netscape HTTP Cookie File') == false)
  {
    problems.push('Netscape 형식 아님');
  }
  if(content.includes('\r'))
  {
    problems.push('CRLF 줄바꿈 포함');
  }

  let expires_at: number | undefined = undefined;
  for(const name of LOGIN_COOKIE_NAMES)
  {
    const fields = content.split('\n')
      .map((line) => line.trim().split('\t'))
      .find((cols) => cols.length >= 7 && cols[0].endsWith('youtube.com') && cols[5] === name);

    if(fields == undefined)
    {
      problems.push(`${name} 없음(로그인 쿠키 아님)`);
      continue;
    }

    const expire_sec = Number(fields[4]);
    if(expire_sec > 0)
    {
      expires_at = Math.min(expires_at ?? Infinity, expire_sec * 1000);
    }
  }

  return { problems, expires_at };
};

const getYtdlpVersion = async (): Promise<string> =>
{
  try
  {
    const subprocess = await youtubedl.exec('', { version: true }, { timeout: 10000 });
    return String(subprocess.stdout).trim();
  }
  catch(err: any)
  {
    return `확인 실패(${err.message?.split('\n')[0]})`;
  }
};

//포맷 선택까지만 시험(--simulate). 성공하면 고른 format_id를 돌려준다
const runSimulateScenario = async (url: string, scenario: any, cookie_path: string | undefined): Promise<{ success: boolean, result_type: number, format_id: string }> =>
{
  const execute = async (option: any) =>
  {
    let stdout = '';
    let stderr = '';
    const subprocess = youtubedl.exec(url, option, { timeout: SCENARIO_TIMEOUT_MS, killSignal: 'SIGKILL' });
    subprocess.stdout.on('data', (data: any) => { stdout += data.toString(); });
    subprocess.stderr.on('data', (data: any) => { stderr += data.toString(); });

    try
    {
      await subprocess;
      return { success: stdout.trim().length > 0, result_type: DOWNLOAD_RESULT_TYPE.SUCCESS, format_id: stdout.trim().split('\n').pop() ?? '' };
    }
    catch(err: any)
    {
      return { success: false, result_type: audio_cache_manager.getExpectedErrorType(stderr), format_id: '' };
    }
  };

  if(scenario.use_cookie && cookie_path != undefined)
  {
    return audio_cache_manager.runWithCookieCopy(cookie_path, (cookie_copy_path: string) => execute({ ...scenario.option, cookies: cookie_copy_path }));
  }

  return execute(scenario.option);
};

const formatDate = (time_ms: number): string =>
{
  const date = new Date(time_ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * 점검 결과로 어드민 DM 메시지를 만든다 (순수 함수 - 테스트용으로 분리)
 */
const buildReportMessage = ({ version, cookie_path, cookie_problems, cookie_expires_at, scenario_results, now }: any): string =>
{
  const warnings: string[] = [];
  const lines: string[] = [];

  //쿠키 상태
  const warn_days = SYSTEM_CONFIG.YTDL_COOKIE_EXPIRE_WARN_DAYS ?? 14;
  if(cookie_path == undefined)
  {
    lines.push(`쿠키: 미설정 (YTDL_COOKIE_PATH 파일 없음)`);
  }
  else if(cookie_problems.length > 0)
  {
    lines.push(`쿠키: ❌ ${cookie_problems.join(', ')}`);
    warnings.push('⚠️ 쿠키 파일 문제 - 재발급 필요');
  }
  else if(cookie_expires_at == undefined)
  {
    lines.push(`쿠키: ✅ (세션 쿠키 - 만료일 없음)`);
  }
  else
  {
    const days_left = Math.floor((cookie_expires_at - now) / DAY_MS);
    lines.push(`쿠키: ${days_left < 0 ? '❌' : '✅'} 만료 ${formatDate(cookie_expires_at)} (D-${days_left})`);
    if(days_left < 0)
    {
      warnings.push('⚠️ 쿠키 만료됨 - 재발급 필요');
    }
    else if(days_left <= warn_days)
    {
      warnings.push(`⚠️ 쿠키 만료 임박 (D-${days_left}) - 미리 재발급 권장`);
    }
  }

  //시나리오별 결과
  for(const { label, result } of scenario_results)
  {
    lines.push(result.success
      ? `${label}: ✅ (format ${result.format_id})`
      : `${label}: ❌ ${RESULT_LABELS[result.result_type] ?? '알 수 없음'}`);
  }

  const cookie_results = scenario_results.filter(({ use_cookie }: any) => use_cookie);
  if(cookie_results.length > 0 && cookie_results.every(({ result }: any) => result.success == false))
  {
    warnings.push('⚠️ 쿠키 시나리오 전부 실패 - 쿠키 재발급 필요');
  }
  if(scenario_results.length > 0 && scenario_results.every(({ result }: any) => result.success == false))
  {
    warnings.push('🚨 모든 시나리오 실패 - 노래 다운로드 불가 상태');
  }

  return [
    `🎵 yt-dlp 시작 점검 (yt-dlp ${version})`,
    ...warnings,
    ...lines,
  ].join('\n');
};

const runHealthCheck = async (): Promise<string> =>
{
  const url = SYSTEM_CONFIG.YTDL_HEALTH_CHECK_URL ?? DEFAULT_HEALTH_CHECK_URL;
  const version = await getYtdlpVersion();

  const cookie_path = audio_cache_manager.getYtdlCookiePath();
  let cookie_problems: string[] = [];
  let cookie_expires_at: number | undefined = undefined;
  if(cookie_path != undefined)
  {
    ({ problems: cookie_problems, expires_at: cookie_expires_at } = inspectCookieContent(fs.readFileSync(cookie_path, 'utf8')));
  }

  //봇의 다운로드와 같은 IP 선택 기준(initialize.ts)
  const ip_info = {
    ipv4: utility.getIPv4Address()[0],
    ipv6: SYSTEM_CONFIG.YTDL_IPV6_USE ? utility.getIPv6Address()[0] : undefined,
  };

  const base_option = {
    simulate: true,
    print: 'format_id',
    formatSort: '+size',
    format: 'bestaudio[ext=webm]/bestaudio', //audio_cache_manager.ts와 동일
    noPlaylist: true,
    noCheckCertificates: true,
    noWarnings: true,
    addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
  };

  //부하를 줄이려고 순차 실행
  const scenario_results: any[] = [];
  for(const scenario of audio_cache_manager.buildDownloadScenarios(base_option, ip_info, cookie_path))
  {
    const result = await runSimulateScenario(url, scenario, cookie_path);
    scenario_results.push({ label: scenario.label, use_cookie: scenario.use_cookie, result });
  }

  return buildReportMessage({ version, cookie_path, cookie_problems, cookie_expires_at, scenario_results, now: Date.now() });
};

/**
 * 점검을 실행하고 결과를 어드민에게 DM으로 보낸다. 실패해도 봇 동작엔 영향 없도록 에러는 로그만 남김.
 */
const runHealthCheckAndNotifyAdmin = async (client: any, admin_id: string | undefined): Promise<void> =>
{
  try
  {
    logger.info(`Running yt-dlp startup health check...`);
    const report = await runHealthCheck();
    logger.info(`yt-dlp startup health check result:\n${report}`);

    if(admin_id == undefined || admin_id.length == 0)
    {
      return;
    }

    const admin_user = await client.users.fetch(admin_id);
    await admin_user.send(report);
  }
  catch(err: any)
  {
    logger.error(`Failed yt-dlp startup health check, err: ${err.stack ?? err.message}`);
  }
};

module.exports = {
  runHealthCheckAndNotifyAdmin,
  //테스트용
  inspectCookieContent,
  buildReportMessage,
};
