const { SYSTEM_CONFIG } = require('../../config/system_setting.js');
const logger = require('../../utility/logger.js')('AudioCacheManager');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cloneDeep = require("lodash/cloneDeep.js");
const { json } = require('express');
const utility = require('../../utility/utility.js');
const ffmpeg_path = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

ffmpeg.setFfmpegPath(ffmpeg_path);

const DOWNLOAD_RESULT_TYPE =
{
  SUCCESS: 0,
  ERROR: 1,
  OVER_DURATION: 2,
  OVER_MAX_FILE_SIZE: 3,
  ALREADY_EXIST: 4,
  NO_MATCH_FILTER: 5,
  VIDEO_UNAVAILABLE: 6,
  PRIVATE_VIDEO: 7,
  PREMIUM: 8,
  BOT_DETECTED: 9, //"Sign in to confirm you're not a bot" - IP 평판 차단, 다른 IP 시나리오로는 될 수 있음
  UNKNOWN: 10,
  COOKIE_INVALID: 11, //쿠키가 로그아웃/폐기됨 - 재발급 필요
  NETWORK_ERROR: 12, //해당 source-address로 외부 통신 불가(Network is unreachable, 바인드 실패)
  AGE_RESTRICTED: 13, //연령 제한 영상 - 로그인(쿠키) 없이는 IP를 바꿔도 안 됨
};

const getHashedPath = (target: string): string | undefined =>
{
  if(target == undefined || target.length == 0)
  {
    return undefined;
  }

  const cache_path = SYSTEM_CONFIG.CUSTOM_AUDIO_CACHE_PATH;
  const sub_path = target.charAt(0).toUpperCase();

  return path.join(cache_path, sub_path);
};

const getAudioCache = (video_id: string): string | undefined =>
{
  const cache_path = getHashedPath(video_id);
  const cache_file_path = path.join(cache_path, `${video_id}.webm`); //우선 webm으로 찾는다

  if(fs.existsSync(cache_file_path)) //바로 찾으면 개꿀~
  {
    return cache_file_path;
  }

  return undefined; //이제 webm으로 다 변환해두기 때문에 밑어 더 볼 필요는 없음

  /**Deprecated
  //하 없으면 찾아보자
  const cache_info = getAudioCacheInfo(video_id);
  if(cache_info == undefined)
  {
    return undefined;
  }

  const cache_result = cache_info.cache_result;
  if(cache_result == undefined)
  {
    return undefined;
  }

  if(cache_result.success == false || cache_info.ext == undefined)
  {
    return undefined;
  }

  //캐싱 성공은 했어?
  const ext = cache_info.ext;
  cache_file_path = path.join(cache_path, `${video_id}.${ext}`);

  if(fs.existsSync(cache_file_path)) //다시 찾아보자
  {
    return cache_file_path;
  }

  return undefined;
  */
};

const getAudioCacheInfo = (video_id: string): any | undefined =>
{
  const cache_path = getHashedPath(video_id);
  const info_filename = `${video_id}.info.json`;
  const info_file_path = path.join(cache_path, info_filename);

  if(fs.existsSync(info_file_path) == false)
  {
    return undefined;
  }

  const stat = fs.statSync(info_file_path);
  if(stat.isFile() == false) //이건 뭔 경우냐...
  {
    fs.unlinkSync(info_file_path);
    return undefined;
  }

  const data = fs.readFileSync(info_file_path, 'utf8');
  const json_data = JSON.parse(data);

  return json_data;
};

const reWriteCacheInfo = (video_id: string, cache_result: any): void =>
{
  try
  {
    logger.debug(`rewriting info file ${video_id}.info.json`);

    let cache_info = getAudioCacheInfo(video_id);

    if(cache_info == undefined)
    {
      logger.debug(`${video_id}'s info is not exists. generating cache info`);
      cache_info = {};
    }

    delete cache_info.formats;
    delete cache_info.thumbnails;
    delete cache_info.automatic_captions;
    delete cache_info.subtitles;
    delete cache_info.heatmap;

    if(cache_result != undefined)
    {
      cache_info['cache_result'] = cache_result;
    }

    const cache_path = getHashedPath(video_id);
    const info_filename = `${video_id}.info.json`;
    const info_file_path = path.join(cache_path, info_filename);

    if(fs.existsSync(cache_path) == false)
    {
      fs.mkdirSync(cache_path, { recursive: true });
    }

    fs.writeFileSync(info_file_path, JSON.stringify(cache_info), 'utf-8',  (err: any) =>
    {
      if (err)
      {
        logger.error(`remove format info write error ${err.message}`);
      }
    });
  }
  catch(err: any)
  {
    logger.error(`rewrite cache info error. ${err.message}`);
  }
};

//같은 video_id를 동시에 여러 번 다운로드 요청하면(미리듣기 연타 등) yt-dlp 프로세스를 중복 스폰하지 않고
//이미 진행 중인 다운로드의 Promise를 그대로 재사용함 (B-2 전수테스트 피드백 4번)
const downloading_promises = new Map<string, Promise<any>>();

const downloadAudioCache = async (audio_url: string, video_id: string, ip_info: any = {ipv4: undefined, ipv6: undefined}): Promise<any> =>
{
  const existing_promise = downloading_promises.get(video_id);
  if(existing_promise != undefined)
  {
    logger.debug(`${video_id} is already downloading. reusing in-flight download`);
    return existing_promise;
  }

  const download_promise = executeDownloadAudioCache(audio_url, video_id, ip_info);
  downloading_promises.set(video_id, download_promise);

  try
  {
    return await download_promise;
  }
  finally
  {
    downloading_promises.delete(video_id);
  }
};

//#region 다운로드 시나리오 (2026-11-01)
//순서: IPv6+쿠키 -> IPv4+쿠키 -> IPv6 -> IPv4. 영상마다 IP 차단 여부가 달라서 쿠키를 우선 사용하고,
//쿠키가 무효/차단일 때를 대비해 쿠키 없는 IP 시나리오를 뒤에 둔다. 쿠키 파일이 없으면 IP 시나리오만.

const YTDL_DEFAULT_TIMEOUT_MS = 20000;
const YTDL_COOKIE_TIMEOUT_MS = 60000; //로그인 추출은 JS 챌린지(node) 풀이가 붙어서 더 오래 걸림

//yt-dlp용 쿠키 파일(Netscape 형식) 경로. 설정이 비었거나 파일이 없으면 undefined(쿠키 시나리오 안 씀)
const getYtdlCookiePath = (): string | undefined =>
{
  const cookie_path = SYSTEM_CONFIG.YTDL_COOKIE_PATH;
  if(cookie_path == undefined || cookie_path.length == 0 || fs.existsSync(cookie_path) == false)
  {
    return undefined;
  }

  return cookie_path;
};

/**
 * base_option(yt-dlp 옵션)에 IP/쿠키를 조합한 시나리오 목록을 우선순위 순서로 만든다.
 * key는 시나리오 차단 상태 관리용 - IP가 바뀌면 새 시나리오로 취급되도록 IP까지 포함한다.
 */
const buildDownloadScenarios = (base_option: any, ip_info: any, cookie_path: string | undefined): any[] =>
{
  const { ipv4, ipv6 } = ip_info ?? {};

  const ip_variants: any[] = [];
  if(ipv6 != undefined)
  {
    ip_variants.push({ ip_label: 'IPv6', ip_key: `v6:${ipv6}`, ip_option: { sourceAddress: ipv6, forceIpv6: true } });
  }
  if(ipv4 != undefined)
  {
    ip_variants.push({ ip_label: 'IPv4', ip_key: `v4:${ipv4}`, ip_option: { sourceAddress: ipv4, forceIpv4: true } });
  }
  if(ip_variants.length == 0)
  {
    ip_variants.push({ ip_label: 'default', ip_key: 'default', ip_option: {} });
  }

  const scenarios: any[] = [];
  const cookie_flags = cookie_path != undefined ? [true, false] : [false];
  for(const use_cookie of cookie_flags)
  {
    for(const { ip_label, ip_key, ip_option } of ip_variants)
    {
      const option: any = { ...cloneDeep(base_option), ...ip_option };
      if(use_cookie)
      {
        option.jsRuntimes = 'node'; //로그인 상태 추출은 JS 런타임 필수
        //쿠키 무효 경고(WARNING)를 잡아야 해서 경고 출력. false로 두면 dargs가 존재하지 않는 옵션
        //--no-no-warnings로 바꿔서 yt-dlp가 즉시 에러 종료함(2026-11-01 운영에서 발생) - 반드시 delete
        delete option.noWarnings;
      }

      scenarios.push({
        key: `${use_cookie ? 'cookie' : 'nocookie'}|${ip_key}`,
        label: `${ip_label}${use_cookie ? '+쿠키' : ''}`,
        use_cookie,
        option,
      });
    }
  }

  return scenarios;
};

/**
 * 쿠키 시나리오는 원본 쿠키 파일의 임시 복사본으로 실행한다. yt-dlp가 실행 후 쿠키 파일을 다시 쓰는데,
 * 여러 cluster/세션이 동시에 다운로드하면 같은 파일에 동시에 써서 깨질 수 있기 때문(원본은 읽기만 함).
 */
const runWithCookieCopy = async <T>(cookie_path: string, task: (cookie_copy_path: string) => Promise<T>): Promise<T> =>
{
  const cookie_copy_path = path.join(os.tmpdir(), `yt-cookies-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await fs.promises.copyFile(cookie_path, cookie_copy_path);

  try
  {
    return await task(cookie_copy_path);
  }
  finally
  {
    fs.promises.rm(cookie_copy_path, { force: true }).catch(() => {});
  }
};

const runScenario = async (audio_url: string, scenario: any, cookie_path: string | undefined): Promise<any> =>
{
  if(scenario.use_cookie == false || cookie_path == undefined)
  {
    return executeDownloadProcess(audio_url, scenario.option, YTDL_DEFAULT_TIMEOUT_MS);
  }

  return runWithCookieCopy(cookie_path, (cookie_copy_path) =>
    executeDownloadProcess(audio_url, { ...scenario.option, cookies: cookie_copy_path }, YTDL_COOKIE_TIMEOUT_MS)
  );
};

//#region 시나리오 차단 상태 - 같은 시나리오가 연속 N번(기본 3) 실패하면 일정 시간(기본 1시간) 건너뛴다.
//차단 시간이 지나면 1번만 시험해서 성공하면 해제, 실패하면 곧바로 다시 차단(매번 N번씩 헛걸음 방지).
//cluster(프로세스)마다 따로 관리되고 재시작하면 초기화됨 - 하루 2번 재시작이라 적당한 리셋 주기.

//시나리오 자체 문제(IP/쿠키)인 실패만 센다. 영상 탓(비공개/삭제/길이초과 등)이나 원인 불명(ERROR),
//서버 문제(시그널 종료/타임아웃 - ERROR로 들어옴)는 세지 않음
const COUNTABLE_FAILURE_TYPES = [
  DOWNLOAD_RESULT_TYPE.BOT_DETECTED,
  DOWNLOAD_RESULT_TYPE.COOKIE_INVALID,
  DOWNLOAD_RESULT_TYPE.NETWORK_ERROR,
];

//유튜브에 정상 도달해서 영상 단위 결과를 받은 경우 = 시나리오는 정상 -> 연속 실패 카운트 초기화
const SCENARIO_OK_TYPES = [
  DOWNLOAD_RESULT_TYPE.SUCCESS,
  DOWNLOAD_RESULT_TYPE.ALREADY_EXIST,
  DOWNLOAD_RESULT_TYPE.OVER_DURATION,
  DOWNLOAD_RESULT_TYPE.OVER_MAX_FILE_SIZE,
  DOWNLOAD_RESULT_TYPE.NO_MATCH_FILTER,
  DOWNLOAD_RESULT_TYPE.VIDEO_UNAVAILABLE,
  DOWNLOAD_RESULT_TYPE.PRIVATE_VIDEO,
  DOWNLOAD_RESULT_TYPE.PREMIUM,
];

//다음 시나리오로 넘어가서 다시 시도해볼 만한 결과 (나머지는 어느 시나리오든 결과가 같으므로 중단)
const RETRYABLE_TYPES = [
  DOWNLOAD_RESULT_TYPE.ERROR,
  ...COUNTABLE_FAILURE_TYPES,
];

const scenario_health = new Map<string, { fail_count: number, blocked_until: number }>();

const getScenarioFailLimit = (): number => SYSTEM_CONFIG.YTDL_SCENARIO_FAIL_LIMIT ?? 3;
const getScenarioBlockMs = (): number => (SYSTEM_CONFIG.YTDL_SCENARIO_BLOCK_SEC ?? 3600) * 1000;

const isScenarioBlocked = (key: string, now: number): boolean =>
{
  const health = scenario_health.get(key);
  return health != undefined && health.blocked_until > now;
};

const recordScenarioResult = (scenario: any, result_type: number): void =>
{
  const health = scenario_health.get(scenario.key);

  if(SCENARIO_OK_TYPES.includes(result_type))
  {
    if(health != undefined && health.blocked_until > 0)
    {
      logger.info(`yt-dlp scenario recovered, unblocked: ${scenario.label}(${scenario.key})`);
    }
    scenario_health.delete(scenario.key);
    return;
  }

  if(COUNTABLE_FAILURE_TYPES.includes(result_type) == false)
  {
    return;
  }

  const now = Date.now();
  const block_ms = getScenarioBlockMs();
  const new_health = health ?? { fail_count: 0, blocked_until: 0 };

  if(new_health.blocked_until > 0) //한 번 차단됐던 시나리오(차단 만료 후 시험 or 전부 차단이라 강행)가 또 실패 -> 바로 재차단
  {
    new_health.blocked_until = now + block_ms;
    logger.warn(`yt-dlp scenario still failing, blocked again for ${block_ms / 1000}s: ${scenario.label}(${scenario.key})`);
  }
  else
  {
    new_health.fail_count += 1;
    if(new_health.fail_count >= getScenarioFailLimit())
    {
      new_health.fail_count = 0;
      new_health.blocked_until = now + block_ms;
      logger.warn(`yt-dlp scenario failed ${getScenarioFailLimit()} times in a row, blocked for ${block_ms / 1000}s: ${scenario.label}(${scenario.key})`);
    }
  }

  if(scenario.use_cookie && new_health.blocked_until > now)
  {
    logger.error(`yt-dlp cookie scenario is blocked. cookies may be invalid or the account may be restricted - re-export cookies! (${SYSTEM_CONFIG.YTDL_COOKIE_PATH})`);
  }

  scenario_health.set(scenario.key, new_health);
};

//차단 안 된 시나리오만 고른다. 전부 차단이면 차단을 무시하고 전부 시도(받을 방법이 없으니 느려도 시도는 해봄)
const selectRunnableScenarios = (scenarios: any[]): any[] =>
{
  const now = Date.now();
  const runnable = scenarios.filter((scenario) => isScenarioBlocked(scenario.key, now) == false);
  if(runnable.length > 0)
  {
    return runnable;
  }

  logger.warn(`All yt-dlp scenarios are blocked. ignoring block and trying all scenarios`);
  return scenarios;
};

const resetScenarioHealth = (): void => //테스트용
{
  scenario_health.clear();
};
//#endregion
//#endregion

const executeDownloadAudioCache = async (audio_url: string, video_id: string, ip_info: any = {ipv4: undefined, ipv6: undefined}): Promise<any> =>
{
  const cache_path = getHashedPath(video_id);

  logger.debug(`Downloading Youtube Video Cache file... audio_url: ${audio_url}, video_id: ${video_id}`);

  const default_option = {
    paths: cache_path,
    output: `${video_id}.%(ext)s`,
    formatSort: '+size', //파일 크기로 오름차순 정렬
    format: 'bestaudio[ext=webm]/bestaudio', //정렬된 포맷 중 webm 확장자인것. 없으면 젤 작은 audio -> 즉 webm이면서 파일 크기가 가장 작은거
    maxFilesize: SYSTEM_CONFIG.CUSTOM_AUDIO_MAX_FILE_SIZE, //최대 파일 크기
    matchFilter: `duration <= ${SYSTEM_CONFIG.CUSTOM_AUDIO_YTDL_MAX_LENGTH}`, //최대 길이
    noPlaylist: true,
    writeInfoJson: true, //비디오 정보 json으로 저장
    noCheckCertificates: true, //ssl 체크 안함
    noWarnings: true, //경고 미출력
    addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
  };

  const cookie_path = getYtdlCookiePath();
  const download_scenarios = selectRunnableScenarios(buildDownloadScenarios(default_option, ip_info, cookie_path));

  logger.debug(`Downloading cache scenario is ${download_scenarios.length}: ${download_scenarios.map((scenario) => scenario.label).join(' -> ')}`);

  let result: any = undefined;
  let cache_result: any = {};

  const onDownloadSuccess = async (): Promise<any> =>
  {
    cache_result = {
      success: true,
      causation_message: '',
      need_retry: false
    };

    logger.info(`Downloaded cache file ${video_id}`);

    reWriteCacheInfo(video_id, cache_result);

    await convertToWebm(video_id);

    return cache_result;
  };

  for(const scenario of download_scenarios)
  {
    result = await runScenario(audio_url, scenario, cookie_path);
    recordScenarioResult(scenario, result.result_type);

    if(result.result_type == DOWNLOAD_RESULT_TYPE.SUCCESS) //성공이면 바로 반환 ^^
    {
      return await onDownloadSuccess();
    }

    if(RETRYABLE_TYPES.includes(result.result_type)) //에러발생했으면 다음 시나리오로 ㄱㄱ (봇 차단/쿠키 무효/네트워크는 시나리오 단위라 다른 시나리오로는 될 수 있음)
    {
      logger.warn(`Failed yt-dlp download... scenario: ${scenario.label}, ip: ${scenario.option.sourceAddress ?? 'default'}, url: ${audio_url}, err_message: ${result.error_message}, `);
      continue;
    }

    break; //에러도 아니고 성공도 아니면 예상된 문제들임 (어느 시나리오든 결과가 같음)
  }

  //다 해봤는데 실패한 경우임
  if(result.result_type == DOWNLOAD_RESULT_TYPE.ERROR
    || result.result_type == DOWNLOAD_RESULT_TYPE.NETWORK_ERROR
    || result.result_type == DOWNLOAD_RESULT_TYPE.COOKIE_INVALID)
  {
    logger.error(`Failed ytdlp download audio... for all scenario`);

    cache_result = {
      success: false,
      causation_message: `오디오 다운로드에 실패했습니다.\n해당 문제가 오래 지속될 경우 개발자에게 문의 바랍니다.`,
      need_retry: true
    };

    logFailedUrl(audio_url);
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.BOT_DETECTED)
  {
    logger.error(`Failed ytdlp download audio... youtube bot detection(Sign in to confirm) for all scenario, url: ${audio_url}`);

    cache_result = {
      success: false,
      causation_message: `유튜브가 봇 접근으로 판단해 오디오 다운로드를 차단했습니다.\n잠시 후 다시 시도해주세요. 해당 문제가 오래 지속될 경우 개발자에게 문의 바랍니다.`,
      need_retry: true //IP 차단은 일시적일 수 있음
    };

    logFailedUrl(audio_url);
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.AGE_RESTRICTED)
  {
    logger.warn(`${audio_url} is age restricted video (cookies: ${cookie_path != undefined ? 'used' : 'not configured'})`);
    cache_result = {
      success: false,
      causation_message: `${audio_url} 링크는 연령 제한 영상이라 다운로드할 수 없습니다.`,
      need_retry: true //쿠키가 설정/갱신되면 받을 수 있음
    };

    logFailedUrl(audio_url);
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.OVER_DURATION)
  {
    logger.warn(`${audio_url}'s durations is over than ${SYSTEM_CONFIG.CUSTOM_AUDIO_YTDL_MAX_LENGTH}`);
    cache_result = {
      success: false,
      causation_message: `오디오 길이가 ${SYSTEM_CONFIG.CUSTOM_AUDIO_YTDL_MAX_LENGTH}초를 초과합니다.`,
      need_retry: false
    };
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.OVER_MAX_FILE_SIZE)
  {
    logger.warn(`${audio_url}'s all audio file size is over than ${SYSTEM_CONFIG.CUSTOM_AUDIO_MAX_FILE_SIZE}`);
    cache_result = {
      success: false,
      causation_message: `${audio_url}의 모든 오디오 파일 크기가 ${SYSTEM_CONFIG.CUSTOM_AUDIO_MAX_FILE_SIZE}를 초과합니다.`,
      need_retry: false
    };
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.VIDEO_UNAVAILABLE)
  {
    logger.warn(`${audio_url} is video unavailable`);
    cache_result = {
      success: false,
      causation_message: `${audio_url} 링크는 삭제된 오디오입니다.`,
      need_retry: false
    };
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.PRIVATE_VIDEO)
  {
    logger.warn(`${audio_url} is private video`);
    cache_result = {
      success: false,
      causation_message: `${audio_url} 링크는 비공개 오디오입니다.`,
      need_retry: false
    };
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.ALREADY_EXIST) //이럴수가 있나 싶긴한데...
  {
    logger.warn(`${audio_url}'s cache is already exist`);
    cache_result = {
      success: true,
      causation_message: '',
      need_retry: false
    };
  }
  else if(result.result_type == DOWNLOAD_RESULT_TYPE.PREMIUM)
  {
    logger.warn(`${audio_url} is premium music`);
    cache_result = {
      success: true,
      causation_message: `${audio_url} 링크는 유튜브 프리미엄 뮤직입니다.`,
      need_retry: false
    };
  }
  else
  {
    logger.warn(`Unknown result message url: ${audio_url}, stdout: ${result.result_message}`);
    logger.debug(`${audio_url}'s stdout: ${result.result_message}`);

    //그 외는 나도 몰겄다
    cache_result = {
      success: false,
      causation_message: `확인되지 않은 오류...(추후 고쳐두겠습니다.)`,
      need_retry: true
    };

    logFailedUrl(audio_url);
  }

  reWriteCacheInfo(video_id, cache_result);
  return cache_result;
};

const executeDownloadProcess = async (audio_url: string, yt_dlp_option: any, timeout_ms: number = YTDL_DEFAULT_TIMEOUT_MS): Promise<{result_type: number, result_message: string, error_message: string}> =>
{
  /** 24.07.16 root 권한으로 yt-dlp 실행하면 webm 포맷이 안뜬다.
     * 아마 환경변수 때문인 것 같음.
     * 따라서 quizbot은 root가 아닌 일반 계정으로 실행할 것!!!
     */
  const subprocess = youtubedl.exec(
    audio_url,
    yt_dlp_option,
    {
      timeout: timeout_ms,
      killSignal: 'SIGKILL'
    }
  );

  let result_type = DOWNLOAD_RESULT_TYPE.ERROR;
  let stdout = '';
  let stderr = '';

  // 표준 출력 스트림 데이터 수집
  subprocess.stdout.on('data', (data: any) =>
  {
    stdout += data.toString();
  });

  // 표준 오류 스트림 데이터 수집
  subprocess.stderr.on('data', (data: any) =>
  {
    stderr += data.toString();
  });

  try
  {
    await subprocess;

    result_type = getDownloadResultType(stdout);

    if(isCookieInvalidMessage(stderr)) //쿠키가 무효여도 비로그인으로 받아지는 영상은 성공함 - 쿠키 재발급 필요만 알림
    {
      logger.error(`yt-dlp reported cookies are no longer valid (downloaded without login) - re-export cookies! url: ${audio_url}`);
    }
  }
  catch(err: any)
  {
    logger.debug(`download process error occurred! ${err.message}`);

    //tinyspawn이 childProcess 속성(signalCode/killed)을 error에 복사해줌.
    //exit code가 null이면 시그널로 강제종료된 것(우리 timeout이면 killed=true, OOM killer 등 외부 kill이면 false)
    if(err.signalCode != undefined)
    {
      logger.error(`yt-dlp process was killed by signal: ${err.signalCode}, killed_by_timeout: ${err.killed === true}, url: ${audio_url}`);
    }

    result_type = getExpectedErrorType(stderr);

    if(result_type == DOWNLOAD_RESULT_TYPE.BOT_DETECTED)
    {
      logger.warn(`youtube bot detection(Sign in to confirm) with ip: ${yt_dlp_option?.sourceAddress ?? 'default'}, url: ${audio_url}`);
    }
    else if(result_type == DOWNLOAD_RESULT_TYPE.ERROR)
    {
      logger.error(`its unknown type error: ${err}`);
    }
  }

  return {
    result_type: result_type,
    result_message: stdout.toString(),
    error_message: stderr.toString()
  };
};

const getDownloadResultType = (result_message: string): number =>
{
  const lines = result_message.split('\n');

  for (let i = lines.length - 1; i >= 0; --i)
  {
    const line = lines[i].trim();
    if(line.startsWith('[download]') == false)
    {
      continue;
    }

    if(line.includes("has already been downloaded"))
    {
      return DOWNLOAD_RESULT_TYPE.ALREADY_EXIST;
    }

    if(line.includes("does not pass filter"))
    {
      if(line.includes("duration"))
      {
        return DOWNLOAD_RESULT_TYPE.OVER_DURATION;
      }

      return DOWNLOAD_RESULT_TYPE.NO_MATCH_FILTER;
    }

    if(line.includes("File is larger"))
    {
      return DOWNLOAD_RESULT_TYPE.OVER_MAX_FILE_SIZE;
    }

    if(line.includes("Video unavailable"))
    {
      return DOWNLOAD_RESULT_TYPE.VIDEO_UNAVAILABLE;
    }

    if(line.includes("Private video"))
    {
      return DOWNLOAD_RESULT_TYPE.PRIVATE_VIDEO;
    }

    if(line.includes("Destination:"))
    {
      return DOWNLOAD_RESULT_TYPE.SUCCESS;
    }
  }

  return DOWNLOAD_RESULT_TYPE.UNKNOWN;
};

const getExpectedErrorType = (error_message: any): number =>
{
  if(error_message == undefined || (typeof error_message !== 'string' && !(error_message instanceof String)))
  {
    return DOWNLOAD_RESULT_TYPE.ERROR;
  }

  error_message = String(error_message);
  const result_type = getErrorTypeFromErrorLines(error_message);

  //쿠키 무효는 ERROR가 아니라 WARNING으로 찍히고(쿠키 시나리오는 noWarnings를 끔), yt-dlp는 비로그인으로
  //계속 진행하다가 봇 차단 등으로 실패함 - 이 경우 진짜 원인은 쿠키라서 COOKIE_INVALID로 분류
  if((result_type == DOWNLOAD_RESULT_TYPE.ERROR || result_type == DOWNLOAD_RESULT_TYPE.BOT_DETECTED)
    && isCookieInvalidMessage(error_message))
  {
    return DOWNLOAD_RESULT_TYPE.COOKIE_INVALID;
  }

  return result_type;
};

const isCookieInvalidMessage = (error_message: string): boolean =>
{
  return error_message.includes("cookies are no longer valid");
};

const getErrorTypeFromErrorLines = (error_message: string): number =>
{
  const lines = error_message.split('\n');

  for (let i = lines.length - 1; i >= 0; --i)
  {
    const line = lines[i].trim();
    if(line.includes('ERROR:') == false)
    {
      continue;
    }

    if(line.includes("Network is unreachable") || line.includes("Cannot assign requested address"))
    {
      return DOWNLOAD_RESULT_TYPE.NETWORK_ERROR;
    }

    if(line.includes("Video unavailable"))
    {
      return DOWNLOAD_RESULT_TYPE.VIDEO_UNAVAILABLE;
    }

    if(line.includes("Private video"))
    {
      return DOWNLOAD_RESULT_TYPE.PRIVATE_VIDEO;
    }

    if(line.includes("Music Premium"))
    {
      return DOWNLOAD_RESULT_TYPE.PREMIUM;
    }

    if(line.includes("Sign in to confirm your age")) //"Sign in to confirm" 포함이라 봇 차단보다 먼저 검사
    {
      return DOWNLOAD_RESULT_TYPE.AGE_RESTRICTED;
    }

    if(line.includes("Sign in to confirm"))
    {
      return DOWNLOAD_RESULT_TYPE.BOT_DETECTED;
    }
  }

  return DOWNLOAD_RESULT_TYPE.ERROR;
};

const logFailedUrl = (url_list: string): void =>
{
  const cache_root_path = SYSTEM_CONFIG.CUSTOM_AUDIO_CACHE_PATH;
  const failed_url_path = path.join(cache_root_path, "failed_url.txt");
  fs.appendFile(failed_url_path, `${url_list}\n`, 'utf8', (err: any) =>
  {
    if (err)
    {
      console.error(`Log Failed Url write url_list: ${url_list}, error: ${err.message}`);
    }
  });
};

const convertToWebm = (video_id: string): Promise<void> | undefined =>
{
  if(video_id == undefined)
  {
    return;
  }

  const cache_info = getAudioCacheInfo(video_id);
  if(cache_info == undefined)
  {
    return;
  }

  const ext = cache_info.ext;
  if(ext == 'webm') //이미 webm이면 패스
  {
    return;
  }

  const cache_file_path = path.join(getHashedPath(video_id), `${video_id}.${ext}`);
  if(fs.existsSync(cache_file_path) == false) //변환 대상 찾아보자
  {
    logger.error(`convert target ${cache_file_path} is not exists`);
    return;
  }

  const converted_file_name = path.basename(cache_file_path, path.extname(cache_file_path)) + '.webm';
  const converted_file_path = path.resolve(path.dirname(cache_file_path), converted_file_name);

  logger.warn(`converting file ${video_id}.${ext} to webm`);

  const ffmpeg_handler = new ffmpeg(cache_file_path);
  ffmpeg_handler.format('webm');

  return new Promise<void>((resolve, reject)=>
  {

    ffmpeg_handler.saveToFile(converted_file_path)
      .on('end', function()
      {
        resolve();

        logger.warn(`converted to ${converted_file_path}`);

        fs.unlink(cache_file_path, (err: any) =>
        {
          if(err != null && err.code == 'ENOENT')
          {
            console.log(`Failed to unlink ${cache_file_path}, err: ${err.message}`);
          }
        }); //기존 파일 삭제
      })
      .on('error', function(err: any)
      {
        resolve();

        logger.error(`converting error occurred!: ${converted_file_path}, ${err.message}`);
        resolve();
      });
  });
};

/** 캐시 파일에서 [audio_start_point, audio_start_point+audio_length_sec] 구간만 재인코딩 없이(-c copy) 잘라 스트림으로 반환 (B-2, 문제 미리듣기용) */
const generatePreviewClipStream = (cache_file_path: string, audio_start_point: number, audio_length_sec: number): NodeJS.ReadableStream =>
{
  const output_stream = new PassThrough();

  //setStartTime()(input seek, -i 앞에 -ss)은 -c copy와 같이 쓰면 요청 시각 이전의 가장 가까운 webm
  //클러스터 경계로 스냅백함(최대 10초 오차, 2026-08-08 B-2 피드백 8번). seekOutput()(-i 뒤에 -ss)으로
  //바꾸면 컨테이너 seek 속도는 그대로 유지하면서 정확한 시각부터 시작함(-f null 드라이런으로 검증 완료).
  const command = ffmpeg(cache_file_path)
    .seekOutput(audio_start_point)
    .setDuration(audio_length_sec)
    .outputOptions('-c', 'copy')
    .format('webm');

  command.on('error', (err: any) =>
  {
    logger.error(`generatePreviewClipStream error. cache_file_path: ${cache_file_path}, audio_start_point: ${audio_start_point}, audio_length_sec: ${audio_length_sec}, err: ${err.message}`);
    output_stream.destroy(err);
  });

  command.pipe(output_stream, { end: true });

  return output_stream;
};

const forceCaching = async (audio_url_list_path: string, thread_index = 0): Promise<number> =>
{
  if(fs.existsSync(audio_url_list_path) == false)
  {
    console.log(`cannot find audio url list data: ${audio_url_list_path}`);
    return 0;
  }

  const audio_url_list_data = fs.readFileSync(audio_url_list_path, 'utf8');
  const audio_url_list = audio_url_list_data.split('\n');

  let new_cached_count = 0;
  let failed_count = 0;
  let failed_url_list = '';

  for (let i = 0; i < audio_url_list.length; i++)
  {
    try
    {
      console.log(`caching... ${i+1} / ${audio_url_list.length}`);

      const audio_url = audio_url_list[i];

      if(audio_url == undefined || audio_url.trim() == '')
      {
        continue;
      }

      const video_id = utility.extractYoutubeVideoID(audio_url);
      if(video_id == undefined)
      {
        console.error(`${audio_url} has no video id`);
        failed_url_list += `${audio_url}\n`;
        ++failed_count;
        continue;
      }

      const cache_file_path = getAudioCache(video_id);
      const cache_info = getAudioCacheInfo(video_id);

      if(cache_file_path != undefined && cache_info != undefined)
      {
        console.log(`${video_id} is already cached. skip this`);
        continue;
      }

      if(cache_info?.cache_result?.need_retry == false) //이 경우 어차피 재시도해도 캐싱 안되는건 똑같은거임
      {
        console.log(`Skip downloading cache reason: ${cache_info.cache_result.causation_message}`);
        continue;
      }

      const result = await downloadAudioCache(audio_url, video_id);

      if(result.success == false)
      {
        console.error(`Failed to caching ${audio_url}. error: ${result.causation_message}`);

        if(result.need_retry == false)
        {
          console.warn(`Do not need to retry... skip this`);
          continue;
        }

        failed_url_list += `${audio_url}\n`;
        ++failed_count;
        continue;
      }

      ++new_cached_count;
    }
    catch(err: any)
    {
      console.error(`Error occurred! ${err.stack}`);
    }
  }

  console.log(`new cached ${new_cached_count}!. failed ${failed_count}...`);
  if(failed_count > 0)
  {
    const failed_log_path = path.join(SYSTEM_CONFIG.CUSTOM_AUDIO_CACHE_PATH, `failed_url${thread_index}.txt`);
    fs.writeFileSync(failed_log_path, failed_url_list, 'utf-8');
  }

  return new_cached_count;
};

module.exports = {
  getAudioCache,
  getAudioCacheInfo,
  downloadAudioCache,
  reWriteCacheInfo,
  forceCaching,
  generatePreviewClipStream,
  //아래 4개는 유닛테스트를 위해 추가로 export함 (REFACTOR_PLAN.md Phase 5/TS 전환 전 점검).
  //monitoring_manager.js에서 calculateAverageCpuUsage를 export한 것과 동일한 패턴.
  getHashedPath,
  getDownloadResultType,
  getExpectedErrorType,
  executeDownloadProcess,
  executeDownloadAudioCache, //다운로드 시나리오 테스트용
  resetScenarioHealth, //테스트용
  //아래는 ytdlp_health_check.ts(시작 시 점검)와 공유
  DOWNLOAD_RESULT_TYPE,
  getYtdlCookiePath,
  buildDownloadScenarios,
  runWithCookieCopy,
};
