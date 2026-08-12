// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 4 피드백(2026-08-12) - QuizDetailPage.jsx의
// 문제 목록 행과 QuestionEditPage.jsx의 편집 화면이 공유하는 표시 로직. 승인된
// docs/WEB_QUIZ_CREATION_UI_MOCKUP.html의 computeContentTags/renderContentTagChips/TYPE_LABEL을
// 그대로 이식(값만 문자열 키 대신 config/system_setting.js ANSWER_TYPE의 숫자 값으로 맞춤).

export const ANSWER_TYPE = { SHORT_ANSWER: 1, OX: 2, MULTIPLE_CHOICE: 3 };

export const ANSWER_TYPE_LABEL = {
  [ANSWER_TYPE.SHORT_ANSWER]: '주관식',
  [ANSWER_TYPE.OX]: 'O/X',
  [ANSWER_TYPE.MULTIPLE_CHOICE]: '객관식',
};

// config/text_contents.json kor.icon.ICON_CUSTOM_QUIZ 미러링 - 유저 제작 퀴즈는 전부 이 아이콘 고정
// (user-quiz-info.ui.ts의 handleStartQuiz가 quiz_info['icon']에 그대로 대입하는 값과 동일).
export const ICON_CUSTOM_QUIZ = '📱';

// 문제 하나의 데이터(question.data 형태)에서 "기본/힌트/정답공개" 3개 구역에 뭐가 채워져 있는지 계산.
// UserQuestionInfoUI의 displayQuestionInfo가 텍스트로만 보여주던 정보를 목록/편집 화면 양쪽에서
// 칩으로 시각화하기 위한 공용 로직.
export function computeContentTags(data) {
  const basic = [];
  if ((data.question_text ?? '').trim()) basic.push('텍스트');
  if ((data.question_audio_url ?? '').trim()) basic.push('오디오');
  if ((data.question_image_url ?? '').trim()) basic.push('이미지');

  const hint = [];
  if ((data.hint ?? '').trim()) hint.push('텍스트');
  if ((data.hint_image_url ?? '').trim()) hint.push('이미지');

  const answering = [];
  if ((data.answer_text ?? '').trim()) answering.push('텍스트');
  if ((data.answer_audio_url ?? '').trim()) answering.push('오디오');
  if ((data.answer_image_url ?? '').trim()) answering.push('이미지');

  return { basic, hint, answering };
}

// 2026-08-12 2차 피드백에서 문제 목록 행의 "문제: 텍스트,이미지" 칩이 q-summary와 중복이라 보고
// hideBasic으로 숨겼었는데, 같은 날 3차 피드백 - "힌트/정답 칩처럼 문제 칩도 그대로 있어야 한다"는
// 요청으로 원복(hideBasic 옵션 자체를 제거 - 더 이상 아무도 안 씀).
export function ContentTagChips({ tags }) {
  if (tags.basic.length === 0 && tags.hint.length === 0 && tags.answering.length === 0) {
    return <span className="hint-text">아직 입력된 내용이 없어요.</span>;
  }

  return (
    <>
      {tags.basic.length > 0 && <span className="chip ctag basic">문제: {tags.basic.join(', ')}</span>}
      {tags.hint.length > 0 && <span className="chip ctag hint">힌트: {tags.hint.join(', ')}</span>}
      {tags.answering.length > 0 && <span className="chip ctag answering">정답: {tags.answering.join(', ')}</span>}
    </>
  );
}

export const truncate = (text, max) => {
  const trimmed = (text ?? '').trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

// ======================================================================================
// "실제 디스코드에선 이렇게 보여요" 미리보기 - docs/WEB_QUIZ_CREATION_UI_MOCKUP.html의
// renderQuestionEmbed/renderHintEmbed/renderAnswerEmbed를 그대로 이식(설계 결정 5/6: 이미지는
// <img src> 직접 표시, 오디오는 유튜브 ?t=<초> 링크). 텍스트/색상/버튼 구성은 실제 코드
// (quiz_system/lifecycle/question/question.ts의 createQuestionUI, correct_answer.ts,
// config/text_contents.json의 quiz_play_ui/correct_answer_ui)를 대조해 확정한 값 그대로다.
// ======================================================================================

export const isDiscordCdnLink = (url) => (url ?? '').includes('cdn.discordapp.com');

// utility/util/misc_utility.ts의 extractYoutubeVideoID와 동일한 패턴(watch?v=/youtu.be/embed/shorts) -
// 백엔드 CJS 모듈이라 프론트에서 직접 import 못 해 동일 로직을 복제(questionDisplay.jsx 상단 주석의
// 기존 관행 그대로).
export const extractYoutubeVideoId = (url) => {
  const match = (url ?? '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
};

export const youtubeThumbnailUrl = (url) => {
  const video_id = extractYoutubeVideoId(url);
  return video_id ? `https://img.youtube.com/vi/${video_id}/default.jpg` : null;
};

const formatSeconds = (s) => {
  const n = parseInt(s, 10);
  if (isNaN(n) || n < 0) return null;
  const m = Math.floor(n / 60);
  const sec = n % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
};

// question.ts startProgressBar()의 10칸 진행바(text_contents.icon.ICON_PROGRESS_PROGRESSED/WATING)를
// 그대로 재현 - 실시간 재생 진행률이라 편집 화면에선 실제 값을 알 수 없으므로 절반 채워진 예시로 고정.
const progressBarString = (filled, total) => {
  let s = '';
  for (let i = 0; i < total; i++) s += (i < filled ? '⏩' : '⬜');
  return s;
};

function MsgHead() {
  return (
    <div className="df-msghead">
      <div className="df-avatar">🤖</div>
      <div className="df-who">
        <span className="df-name">퀴즈봇</span>
        <span className="df-bot-badge">BOT</span>
        <span className="df-time">방금 전</span>
      </div>
    </div>
  );
}

// 2026-08-12 피드백: 새 탭 링크가 아니라 지정한 시작 지점부터 바로 재생 가능한 유튜브 임베드 플레이어를
// 그 자리에 직접 띄운다(목업의 "Phase 4 실제 웹에서는 이 자리에 유튜브 플레이어가 바로 삽입돼요"라는
// 예고를 실제로 구현). youtube.com/embed/<id>?start=<초> - autoplay는 안 함(브라우저 자동재생 정책 +
// 편집 중 매 타이핑마다 갑자기 소리가 나면 오히려 방해가 됨, 유저가 직접 재생 버튼을 누름).
export function YoutubeEmbed({ url, start, label }) {
  const trimmed = (url ?? '').trim();
  const video_id = extractYoutubeVideoId(trimmed);
  if (!video_id) return null;

  const start_seconds = (start === '' || start === null || start === undefined) ? 0 : (parseInt(start, 10) || 0);
  const t = formatSeconds(start_seconds);
  const src = `https://www.youtube.com/embed/${video_id}?start=${start_seconds}`;

  return (
    <div className="yt-embed-wrap">
      {label && <div className="yt-embed-label">▶ {label}{t ? ` (${t}~)` : ''}</div>}
      <iframe
        className="yt-embed"
        src={src}
        title={label || '오디오 미리듣기'}
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}

// initialize.ts generateHint()의 근사치 - HINT_PERCENTAGE=2라서 정답 글자의 절반가량을 무작위로
// 남기고 나머진 ◼로 가림(1글자면 ◼ 1개).
export const approximateAutoHint = (answer) => {
  answer = (answer || '').trim();
  const letters = answer.replace(/ /g, '').length;
  if (letters === 0) return '';
  if (letters === 1) return '◼';

  const revealCount = Math.ceil(letters / 2);
  const revealableIdx = [];
  for (let i = 0; i < answer.length; i++) { if (answer[i] !== ' ') revealableIdx.push(i); }
  const shuffled = [...revealableIdx].sort(() => Math.random() - 0.5);
  const revealSet = new Set(shuffled.slice(0, revealCount));

  let out = '';
  for (let j = 0; j < answer.length; j++) {
    out += (answer[j] === ' ' || revealSet.has(j)) ? answer[j] : '◼';
  }
  return out;
};

// 자동 힌트는 정답(answers) 기준으로 생성됨 - 주관식이면 첫 번째 정답(쉼표 구분), OX/객관식은 저장된
// 값(O/X/1~5) 그대로(어차피 answers 필드에 그 리터럴 값이 저장돼있음).
const primaryAnswerForHint = (form) => {
  if (form.answer_type === ANSWER_TYPE.SHORT_ANSWER) return (form.answers || '').split(',')[0].trim();
  return form.answers ? String(form.answers) : '';
};

export function DiscordQuestionPreview({ quizTitle, form, index, total }) {
  const promptText = (form.question_text ?? '').trim() || '(아직 문제 텍스트를 입력하지 않았어요)';

  return (
    <div className="discord-frame">
      <MsgHead />
      <div className="df-embed">
        <div className="df-title">[ {ICON_CUSTOM_QUIZ} {quizTitle} ]</div>
        <div className="df-desc">
          <span className="q-prompt">{promptText}</span>
          <span className="df-progress">{progressBarString(4, 10)}</span>
        </div>
        <YoutubeEmbed url={form.question_audio_url} start={form.audio_start} label="오디오 미리듣기" />
        {(form.question_image_url ?? '').trim() && <img className="df-image-ph" src={form.question_image_url} alt="문제 이미지 미리보기" />}
        <div className="df-footer">📦 문제 {index} / {total} | 💡 힌트 자동   ⏭ 스킵 다수결</div>
      </div>
      <div className="df-buttons">
        <button type="button" className="df-btn success" disabled>💡 힌트</button>
        <button type="button" className="df-btn primary" disabled>⏭ 스킵</button>
        <button type="button" className="df-btn danger" disabled>⏹ 그만하기</button>
      </div>
      {form.answer_type === ANSWER_TYPE.OX && (
        <div className="df-buttons">
          <button type="button" className="df-btn secondary" disabled>⭕</button>
          <button type="button" className="df-btn secondary" disabled>❌</button>
        </div>
      )}
      {form.answer_type === ANSWER_TYPE.MULTIPLE_CHOICE && (
        <div className="df-buttons">
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="df-btn secondary" disabled>{n}</button>)}
        </div>
      )}
    </div>
  );
}

export function DiscordHintPreview({ form }) {
  const hasImage = (form.hint_image_url ?? '').trim() !== '';
  const explicitText = (form.hint ?? '').trim();
  const primaryAnswer = primaryAnswerForHint(form);

  let effectiveText = null;
  let isAuto = false;
  if (explicitText) {
    effectiveText = explicitText;
  } else if (primaryAnswer) {
    effectiveText = approximateAutoHint(primaryAnswer);
    isAuto = true;
  }

  if (hasImage === false && effectiveText === null) {
    return (
      <div className="discord-frame">
        <MsgHead />
        <div className="df-empty-note">
          🔕 정답이 아직 없어서 힌트를 만들 수 없어요 — 힌트 버튼을 눌러도 아무 메시지도 안 나가요.<br />
          (① 기본 정보 설정에서 정답을 입력하면 기본 힌트가 자동으로 생겨요)
        </div>
      </div>
    );
  }

  const hintLine = `💡 힌트 공개: ${effectiveText || '(힌트 텍스트 없음)'}`;

  return (
    <div className="discord-frame">
      <MsgHead />
      {hasImage ? (
        <div className="df-embed state-hint">
          <div className="df-title">🖼 그림 힌트</div>
          <div className="df-plain-msg" style={{ background: 'transparent', padding: 0 }}>{hintLine}</div>
          <img className="df-image-ph" src={form.hint_image_url} alt="힌트 이미지 미리보기" />
        </div>
      ) : (
        <div className="df-plain-msg">{hintLine}</div>
      )}
      {isAuto && (
        <div className="df-empty-note" style={{ padding: '4px 2px 0' }}>
          자동 생성된 기본 힌트예요 — 정답 절반가량을 ◼로 가려요, 가리는 위치는 매번 무작위예요.
        </div>
      )}
    </div>
  );
}

export function DiscordAnswerPreview({ form }) {
  let answerText;
  if (form.answer_type === ANSWER_TYPE.OX) {
    answerText = form.answers === 'X' ? '❌' : form.answers === 'O' ? '⭕' : '(정답 미선택)';
  } else if (form.answer_type === ANSWER_TYPE.MULTIPLE_CHOICE) {
    answerText = form.answers ? `${form.answers}번` : '(정답 미선택)';
  } else {
    answerText = (form.answers ?? '').trim() || '(정답 미입력)';
  }
  const answering_text = (form.answer_text ?? '').trim();

  return (
    <div className="discord-frame">
      <MsgHead />
      <div className="df-embed state-answer">
        <div className="df-title">[ 💯 정답!!! ]</div>
        <div className="df-desc">
          😆 정답자: <b>모건, 루크</b>{'\n\n'}📄 정답 목록{'\n'}{answerText}
          {answering_text && `\n\n${answering_text}`}
        </div>
        <YoutubeEmbed url={form.answer_audio_url} start={form.answer_audio_start} label="정답 오디오 미리듣기" />
        {(form.answer_image_url ?? '').trim() && <img className="df-image-ph" src={form.answer_image_url} alt="정답 이미지 미리보기" />}
        <div className="df-fields">
          <div className="df-field"><div className="fk">🧮 점수판</div><div className="fv">모건 · 4점</div></div>
          <div className="df-field"><div className="fk">&nbsp;</div><div className="fv">루크 · 2점</div></div>
        </div>
        <div className="df-footer">🔶 곧 다음 문제로 진행됩니다.</div>
      </div>
    </div>
  );
}
