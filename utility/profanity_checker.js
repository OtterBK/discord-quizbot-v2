// profanity_checker.js
// Node 18+, CommonJS 모듈
// GPT가 짜준거임

const default_options =
{
  try_strip: true,            // 공백/특수문자 제거 후 재검사 여부
  apply_homoglyph: true,      // 숫자->문자 치환 적용 여부
  normalize: true,            // Unicode 정규화(NFKC) 적용 여부
  to_lower_case: true,        // 검사 전 소문자화 (영문 안정성)
  max_input_length: 2048,     // 입력 길이 제한 (bytes/characters)
  return_matches: false       // check()에서 매칭 정보 반환 여부
};

const default_homoglyph_map =
{
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a',
  '5': 's', '6': 'g', '7': 't', '8': 'b', '9': 'g'
};

// 사용자가 제공한 복잡한 패턴(원하시면 수정 가능) - https://github.com/curioustorvald/KoreanCursewordRegex
const default_pattern =
  `[시씨씪슈쓔쉬쉽쒸쓉](?:[0-9]*|[0-9]+ *)[바발벌빠빡빨뻘파팔펄]|[섊좆좇졷좄좃좉졽썅춍봊]|[ㅈ조][0-9]*까|ㅅㅣㅂㅏㄹ?|ㅂ[0-9]*ㅅ|[ㅄᄲᇪᄺᄡᄣᄦᇠ]|[ㅅㅆᄴ][0-9]*[ㄲㅅㅆᄴㅂ]|[존좉좇][0-9 ]*나|[자보][0-9]+지|보빨|[봊봋봇봈볻봁봍] *[빨이]|[후훚훐훛훋훗훘훟훝훑][장앙]|[엠앰]창|애[미비]|애자|[가-탏탑-힣]색기|(?:[샊샛세쉐쉑쉨쉒객갞갟갯갰갴겍겎겏겤곅곆곇곗곘곜걕걖걗걧걨걬] *[끼키퀴])|새 *[키퀴]|[병븅][0-9]*[신딱딲]|미친[가-닣닥-힣]|[믿밑]힌|[염옘][0-9]*병|[샊샛샜샠섹섺셋셌셐셱솃솄솈섁섂섓섔섘]기|[섹섺섻쎅쎆쎇쎽쎾쎿섁섂섃썍썎썏][스쓰]|[지야][0-9]*랄|니[애에]미|갈[0-9]*보[^가-힣]|[뻐뻑뻒뻙뻨][0-9]*[뀨큐킹낑)|꼬[0-9]*추|곧[0-9]*휴|[가-힣]슬아치|자[0-9]*박꼼|빨통|[사싸](?:이코|가지|[0-9]*까시)|육[0-9]*시[랄럴]|육[0-9]*실[알얼할헐]|즐[^가-힣]|찌[0-9]*(?:질이|랭이)|찐[0-9]*따|찐[0-9]*찌버거|창[녀놈]|[가-힣]{2,}충[^가-힣]|[가-힣]{2,}츙|부녀자|화냥년|환[양향]년|호[0-9]*[구모]|조[선센][징]|조센|[쪼쪽쪾](?:[발빨]이|[바빠]리)|盧|무현|찌끄[레래]기|(?:하악){2,}|하[앍앜]|[낭당랑앙항남담람암함][ ]?[가-힣]+[띠찌]|느[금급]마|文在|在寅|(?<=[^\\n])[家哥]|속냐|[tT]l[qQ]kf|Wls|[ㅂ]신|[ㅅ]발|[ㅈ]밥`;

/**
 * escapeRegex
 */
function escapeRegex(s)
{
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * sanitizeRegexFlags - 'g' 제거 (test() 반복 호출 안전)
 */
function sanitizeRegexFlags(flags)
{
  if (!flags) return '';
  return flags.replace(/g/g, '');
}

/**
 * compilePattern
 *  - patternInput: RegExp or string
 *  - 반환: RegExp (flags에서 'g' 제거, 기본 'iu' 적용)
 */
function compilePattern(patternInput)
{
  if (!patternInput)
  {
    // 기본 패턴 사용
    try
    {
      return new RegExp(default_pattern, 'iu');
    }
    catch (e)
    {
      // 만약 기본 패턴이 에러면 안전한 escaped 패턴으로 변환
      return new RegExp(escapeRegex(default_pattern), 'iu');
    }
  }

  if (patternInput instanceof RegExp)
  {
    const flags = sanitizeRegexFlags(patternInput.flags) || 'iu';
    return new RegExp(patternInput.source, flags);
  }

  if (typeof patternInput === 'string')
  {
    const trimmed = patternInput.trim();

    // '/.../flags' 형태인지 확인
    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0)
    {
      const last_slash = trimmed.lastIndexOf('/');
      const src = trimmed.slice(1, last_slash);
      const flags = sanitizeRegexFlags(trimmed.slice(last_slash + 1)) || 'iu';
      try
      {
        return new RegExp(src, flags);
      }
      catch (e)
      {
        // 실패하면 escape 처리
        return new RegExp(escapeRegex(src), flags);
      }
    }

    // 일반 문자열 패턴 -> RegExp 생성 시도
    try
    {
      return new RegExp(patternInput, 'iu');
    }
    catch (e)
    {
      // 실패하면 escaped pattern 으로
      return new RegExp(escapeRegex(patternInput), 'iu');
    }
  }

  return null;
}

/**
 * normalizeText
 */
function normalizeText(s)
{
  if (typeof s !== 'string') return '';
  let out = s;
  try
  {
    out = out.normalize('NFKC');
  }
  catch (e)
  {
    // 대부분 Node 환경은 지원하므로 예외는 무시
  }
  // 제로폭 문자 제거
  out = out.replace(/[\u200B-\u200D\uFEFF]/g, '');
  return out;
}

/**
 * stripObfuscation: 공백/특수문자 제거
 */
function stripObfuscation(s)
{
  return s.replace(/[\s`~!@#$%^&*()\-_=+\[\]{}\\|;:'",.<>\/?·•◆■★☆…—–]/g, '');
}

/**
 * applyHomoglyphMap
 */
function applyHomoglyphMap(s, map)
{
  const used_map = map || default_homoglyph_map;
  return s.replace(/[0-9]/g, function (ch)
  {
    return used_map[ch] || ch;
  });
}

/**
 * createProfanityChecker
 *  - pattern: RegExp or string (null이면 기본 패턴 사용)
 *  - options: 덮어쓰기 가능
 *
 * 반환 API:
 *  - isProfane(content) -> boolean
 *  - check(content) -> { found: boolean, matches: Array, error?: Error }
 *  - setPattern(newPattern)
 *  - getRegex() -> RegExp
 */
function createProfanityChecker(pattern, options)
{
  const opts = Object.assign({}, default_options, options || {});
  let profanity_regex = compilePattern(pattern);

  function setPattern(new_pattern)
  {
    profanity_regex = compilePattern(new_pattern);
  }

  function getRegex()
  {
    return profanity_regex;
  }

  function safeTestOnString(input)
  {
    if (!profanity_regex)
    {
      return opts.return_matches ? { found: false, matches: [] } : false;
    }

    let s = (input === undefined || input === null) ? '' : String(input);

    // 입력 길이 제한(문자 단위)
    if (s.length > opts.max_input_length)
    {
      s = s.slice(0, opts.max_input_length);
    }

    // 정규화 및 소문자화
    let work = opts.normalize ? normalizeText(s) : s;
    if (opts.to_lower_case) work = work.toLowerCase();

    // 1) 원본(정규화만)에서 검사
    try
    {
      const m = profanity_regex.exec(work);
      if (m)
      {
        return opts.return_matches ? { found: true, matches: Array.from(m) } : true;
      }
    }
    catch (e)
    {
      // 정규식 실행 중 에러 발생 시 false 반환하되 정보 포함
      return opts.return_matches ? { found: false, matches: [], error: e } : false;
    }
    finally
    {
      // exec 사용 시 상태 문제 방지: lastIndex를 0으로 강제
      try
      {
        if (profanity_regex && typeof profanity_regex.lastIndex !== 'undefined')
        {
          profanity_regex.lastIndex = 0;
        }
      }
      catch (e) { /* noop */ }
    }

    // 2) 우회(공백/특수문자, 숫자 치환) 대응
    if (opts.try_strip)
    {
      let stripped = stripObfuscation(work);
      if (opts.apply_homoglyph) stripped = applyHomoglyphMap(stripped);

      if (stripped !== work)
      {
        try
        {
          const m2 = profanity_regex.exec(stripped);
          if (m2)
          {
            return opts.return_matches ? { found: true, matches: Array.from(m2) } : true;
          }
        }
        catch (e)
        {
          return opts.return_matches ? { found: false, matches: [], error: e } : false;
        }
        finally
        {
          try
          {
            if (profanity_regex && typeof profanity_regex.lastIndex !== 'undefined')
            {
              profanity_regex.lastIndex = 0;
            }
          }
          catch (e) { /* noop */ }
        }
      }
    }

    return opts.return_matches ? { found: false, matches: [] } : false;
  }

  return {
    isProfane: function (content)
    {
      const r = safeTestOnString(content);
      return (typeof r === 'object') ? !!r.found : !!r;
    },

    check: function (content)
    {
      const r = safeTestOnString(content);
      if (typeof r === 'object') return r;
      return { found: !!r, matches: [] };
    },

    setPattern: setPattern,
    getRegex: getRegex
  };
}

module.exports =
{
  createProfanityChecker: createProfanityChecker,
  default_options: default_options,
  default_homoglyph_map: default_homoglyph_map
};
