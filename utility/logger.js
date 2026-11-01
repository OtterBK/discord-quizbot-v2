'use strict';

/**
* logger.js
* 로깅용 모듈
*/

const { SYSTEM_CONFIG } = require('../config/system_setting.js'); 
const winston = require('winston');
const winstonDaily = require('winston-daily-rotate-file'); // 날짜별로 로그 저장
const { combine, timestamp, printf } = winston.format;
 
const logDir = SYSTEM_CONFIG.LOG_PATH;  // 로그 저장할 경로
const colorize = winston.format.colorize(); // 로그레벨별로 색상 정의
 
// 기본설정을 사용하면 로그레벨만 색상이 적용되어 출력되는 로그를 재정의하였다.
// Define log format
const logFormat = printf(({ level, message, label, timestamp }) => 
{
  return `${colorize.colorize(level, `${timestamp} [${level}] [${label ?? 'default'}]`)} : ${message}`;
  // return `${colorize.colorize(level, `[${timestamp}] [${level.toUpperCase()}] ${label ?? 'default'}:`)} ${message}`;
});
 
//모든 모듈이 공유하는 단일 base logger - 예전엔 getLogger() 호출(모듈 약 60개)마다 createLogger +
//DailyRotateFile을 새로 만들어서, 한 프로세스 안에서 같은 %DATE%.log에 쓰는 파일 스트림이 모듈 수만큼
//열리고 회전/압축도 각자 따로 돌았음(2026-09-28 로그에서 .log.N.gz가 0바이트로 남는 회전 충돌 흔적 확인).
//이제 transport는 프로세스당 하나만 만들고, 모듈별 라벨은 child logger의 메타데이터로 붙인다.
let base_logger = undefined;

const createBaseLogger = () =>
{
  /**
     * Log Level
     * error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6
     */
  const logger = winston.createLogger({
    format: combine(
      timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      logFormat,
    ),
    transports: [
      // info 레벨 로그를 저장할 파일 설정
      new winston.transports.DailyRotateFile({
        levels: { // 숫자가 낮을 수록 우선순위가 높습니다.
          error: 0,
          warn: 1,
          info: 2,
          debug: 3,
        },
        level: SYSTEM_CONFIG.DEVELOP_MODE ? 'debug' : 'info',
        datePattern: 'YYYY-MM-DD',
        dirname: logDir,
        filename: `%DATE%.log`,
        zippedArchive: true,	
        // handleExceptions: true,
        maxFiles: SYSTEM_CONFIG.LOG_MAX_FILES,
        maxSize: SYSTEM_CONFIG.LOG_MAX_SIZE,
      }),
      // // error 레벨 로그를 저장할 파일 설정
      // new winstonDaily({
      //     level: 'error',
      //     datePattern: 'YYYY-MM-DD',
      //     dirname: logDir + '/error',  // error.log 파일은 /logs/error 하위에 저장
      //     filename: `%DATE%.error.log`,
      //     maxFiles: 30,
      //     zippedArchive: true,
      // }),
    ],
  });
 
  // Production 환경이 아닌 경우(dev 등) - Console 로그 출력
  if (SYSTEM_CONFIG.DEVELOP_MODE == true) 
  {
    logger.add(new winston.transports.Console({
      // handleExceptions: true,
      // json: false,
      format: combine(
        timestamp(),
        logFormat,
        // `${info.level}: ${info.message} JSON.stringify({ ...rest })` 포맷으로 출력
        // winston.format.simple(),  
      ),
      level: 'debug',
    }));

    //stdout/stderr가 끊긴 상태(EPIPE - 콘솔 창 닫힘, 파이프 끊김 등)에서 Console transport가 쓰기를
    //시도하면 소켓 error 이벤트가 uncaughtException으로 올라가고, 그 핸들러가 다시 logger.error로
    //콘솔에 쓰다가 또 EPIPE가 나는 무한 루프가 생김(2026-09-28 실제 발생 - 수 초 만에 로그 ~570MB).
    //콘솔이 이미 끊긴 거라 할 수 있는 게 없으므로 조용히 무시한다(파일 transport는 그대로 기록됨).
    const ignoreStreamError = () => {};
    process.stdout.on('error', ignoreStreamError);
    process.stderr.on('error', ignoreStreamError);
  }

  return logger;
};

/**
 * winston 로그 사용을 위한 함수
 * @param path{string}: label
 * @returns {Logger}
 */
const getLogger = (path) => 
{
  if (base_logger === undefined)
  {
    base_logger = createBaseLogger();
  }

  return base_logger.child({ label: path });
};
 
module.exports = getLogger;
