//웹 API 보안 점검(docs/QUESTION_PREVIEW_AND_SECURITY_REVIEW_PLAN.md 작업 2) - Rate limiting.
//사용자 확정 사항(2026-08-12): 조회(GET/HEAD)는 느슨하게(평균 0.25초당 1회), 쓰기(POST/PUT/DELETE
//등)는 그보다 빡빡하게 계층형으로 적용(구체적 수치는 아래 readLimiter/writeLimiter 주석 참고 - 정상
//흐름의 짧은 버스트를 허용하도록 조정됨). web_express_app.ts가 /api/*와 /health에 이 미들웨어를 건다
//(정적 자산(/editor, 빌드 산출물)은 브라우저가 여러 파일을 동시에 요청하는 게 정상이라 대상에서 제외).
//
//키는 세션 토큰(Authorization: Bearer) 우선 - 같은 길드/네트워크를 공유하는 여러 유저가 IP 기준으로
//서로를 막는 걸 방지(사용자 확정). 토큰이 없는 요청(세션 발급 전, 무효한 토큰 무차별 대입 시도 포함)은
//IP로 폴백 - ipKeyGenerator는 express-rate-limit 권장 헬퍼로 IPv6 주소도 안전하게 정규화해준다.

const { rateLimit, ipKeyGenerator, MemoryStore } = require('express-rate-limit');

const extractToken = (req: any): string | undefined =>
{
  const auth_header = req.headers['authorization'] ?? '';
  return auth_header.startsWith('Bearer ') ? auth_header.slice('Bearer '.length) : undefined;
};

const keyGenerator = (req: any): string =>
{
  const token = extractToken(req);
  return token !== undefined ? `token:${token}` : `ip:${ipKeyGenerator(req.ip)}`;
};

const handler = (req: any, res: any): void =>
{
  res.status(429).json({ error: 'rate_limited' });
};

//고정 윈도우 max:1(예: 250ms당 1회)로는 "탭 전환 시 목록+상세를 동시에 조회" 같은 정상적인 순차 호출도
//막혀버린다(윈도우 경계 안에서 살짝만 겹쳐도 즉시 429) - 실제로 기존 통합 테스트 중 정상 흐름(트리
//조회 직후 세션 재확인, 공지 목록 직후 상세 조회, "확정 후 바로 재선택" 등)이 이 방식으로는 깨졌음.
//1차로 조회 초당 4회/쓰기 초당 3회로 조정했다가 사용자 확인 결과 실사용에 비해 너무 빡빡하다는 피드백
//(2026-08-12) - 조회 초당 10회/쓰기 초당 8회로 완화. 어뷰징 방지라는 목적 자체는 유지하되(무제한은
//아님, 여전히 쓰기가 조회보다 빡빡함), 정상적인 빠른 조작(연타/빠른 탭 전환)에서 429가 뜨지 않는 걸
//우선한다.
//store를 직접 만들어 쥐고 있는 이유는 테스트에서 resetAll()로 카운터를 초기화할 수 있게 하기 위함
//(rateLimit() 미들웨어 자체는 resetKey(key)만 노출해서 키를 몰라도 되는 전체 초기화가 안 됨).
const read_store = new MemoryStore();
const write_store = new MemoryStore();

const readLimiter = rateLimit({ windowMs: 1000, max: 10, keyGenerator, handler, standardHeaders: true, legacyHeaders: false, store: read_store });
const writeLimiter = rateLimit({ windowMs: 1000, max: 8, keyGenerator, handler, standardHeaders: true, legacyHeaders: false, store: write_store });

//GET/HEAD는 느슨한 리밋만, 나머지(쓰기)는 빡빡한 리밋만 적용한다 - 메서드당 리밋 하나만 소모시켜야
//쓰기 요청이 두 카운터를 동시에 깎아 의도보다 더 빡빡해지는 걸 막는다.
exports.apiRateLimiter = (req: any, res: any, next: any): void =>
{
  const limiter = (req.method === 'GET' || req.method === 'HEAD') ? readLimiter : writeLimiter;
  limiter(req, res, next);
};

//유닛테스트 전용 - IP 폴백 키처럼 여러 테스트가 같은 키를 공유할 수 있는 경우를 위해 카운터를 완전히
//비운다(audio_cache_manager.js의 "순수 함수는 테스트를 위해 추가로 export" 관례와 동일).
exports.__resetForTest = (): void =>
{
  read_store.resetAll();
  write_store.resetAll();
};
