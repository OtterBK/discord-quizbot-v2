import { useEffect, useMemo, useState } from 'react';
import { getUserQuizzes, getUserQuizDetail, selectQuiz, confirmSelection } from './api.js';
import { fallbackThumbFor, isValidThumbnailUrl, SORT_OPTIONS, compareQuizzesBySort, useHoverPreview } from './quizCardUtils.js';
import QuizDetailCard from './QuizDetailCard.jsx';
import QuizHoverPreview from './QuizHoverPreview.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function StepperBlock({ max, value, onChange }) {
  const commit = (raw) => {
    let n = parseInt(raw, 10);
    if (isNaN(n)) n = 1;
    onChange(clamp(n, 1, max));
  };

  return (
    <div>
      <span className="field-label">문제 수</span>
      <div className="stepper">
        <button type="button" disabled={value <= 1} onClick={() => commit(value - 1)}>−</button>
        <input
          className="val"
          type="number"
          min="1"
          max={max}
          value={value}
          onChange={(e) => commit(e.target.value)}
        />
        <button type="button" disabled={value >= max} onClick={() => commit(value + 1)}>+</button>
        <span className="range">/ {max}</span>
      </div>
    </div>
  );
}

function QuizCard({ quiz, tagNameByValue, selected, onClick, onMouseEnter, onMouseLeave }) {
  const thumb = fallbackThumbFor(quiz.quiz_id);
  const hasThumbnail = isValidThumbnailUrl(quiz.thumbnail);
  const matchedTagNames = Object.entries(tagNameByValue)
    .filter(([value]) => (quiz.tags_value & Number(value)) !== 0)
    .map(([, name]) => name);

  return (
    <button
      type="button"
      className={`quiz-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <span
        className="card-thumb"
        style={hasThumbnail
          ? { backgroundImage: `url(${quiz.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: `linear-gradient(155deg, ${thumb.from} 0%, ${thumb.to} 100%)` }}
      >
        {!hasThumbnail && <span className="thumb-glyph">🎯</span>}
        {quiz.certified === true && <span className="thumb-badge verified">✓ 인증</span>}
        <span className="thumb-badge likes">♥ {quiz.like_count ?? 0}</span>
      </span>
      <span className="card-body">
        <h3>{quiz.title}</h3>
        <span className="creator">by {quiz.creator_name ?? '알 수 없음'}</span>
        {quiz.simple_description && <span className="card-desc">{quiz.simple_description}</span>}
        <span className="tags">
          {matchedTagNames.map((name) => <span key={name} className="mini-tag">{name}</span>)}
        </span>
      </span>
    </button>
  );
}

// 확정(confirm)은 디스코드 화면을 UserQuizInfoUI로 전환하지만, 세션 토큰은 그대로 유지된다
// (dev 탭과 동일한 토큰 생명주기 - WEB_INTEGRATION_PLAN.md "5-1. 토큰 생명주기" 참고). 그래서 확정
// 후에도 이 페이지는 계속 조작 가능해야 한다 - 다른 퀴즈를 고르거나 문제 수를 바꾸고 다시 "선택
// 완료"를 누르면, 디스코드의 UserQuizInfoUI가 실시간으로 갱신된다(user-quiz-info.ui.ts의
// onReceivedWebSessionSignal).
export default function UserQuizTab({ onSessionInvalid }) {
  const [quizzes, setQuizzes] = useState(null);
  const [tags, setTags] = useState([]);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('modified_time');
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [activeTagValues, setActiveTagValues] = useState(new Set());

  const [selectedQuiz, setSelectedQuiz] = useState(null); // 목록 카드(요약 정보)
  const [detail, setDetail] = useState(null); // 상세(question_count 포함)
  const [questionCount, setQuestionCount] = useState(20);
  const [confirming, setConfirming] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const hoverPreview = useHoverPreview();

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getUserQuizzes()
      .then(({ quizzes, tags }) => {
        setQuizzes(quizzes);
        setTags(tags);
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tagNameByValue = useMemo(
    () => Object.fromEntries(tags.map((t) => [t.value, t.name])),
    [tags],
  );

  const filteredQuizzes = useMemo(() => {
    if (quizzes === null) return [];

    const keyword = search.trim().toLowerCase();
    const active_tags_mask = [...activeTagValues].reduce((acc, v) => acc | v, 0);

    let list = quizzes.filter((q) => {
      if (certifiedOnly && q.certified !== true) return false;
      if (active_tags_mask !== 0 && (q.tags_value & active_tags_mask) !== active_tags_mask) return false;
      if (keyword === '') return true;
      return (
        q.title?.toLowerCase().includes(keyword)
        || q.simple_description?.toLowerCase().includes(keyword)
        || q.creator_name?.toLowerCase().includes(keyword)
      );
    });

    list = [...list].sort((a, b) => compareQuizzesBySort(a, b, sortBy));

    return list;
  }, [quizzes, search, sortBy, certifiedOnly, activeTagValues]);

  const toggleTag = (value) => {
    setActiveTagValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const handleCardClick = (quiz) => {
    setSelectedQuiz(quiz);
    setDetail(null);
    setJustApplied(false);
    selectQuiz({ mode: 'user', quiz_id: quiz.quiz_id, title: quiz.title }).catch(handleApiError);

    getUserQuizDetail(quiz.quiz_id)
      .then((d) => {
        setDetail(d);
        setQuestionCount(clamp(20, 1, Math.max(1, d.question_count)));
      })
      .catch(handleApiError);
  };

  const handleConfirm = async () => {
    if (detail === null) return;

    setConfirming(true);
    try {
      await confirmSelection('user', { quiz_id: detail.quiz_id }, questionCount);
      setJustApplied(true);
      setTimeout(() => setJustApplied(false), 1500);
    } catch (err) {
      handleApiError(err);
    } finally {
      setConfirming(false);
    }
  };

  if (error) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({error})</div>;
  }

  if (quizzes === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  return (
    <div className="panel active">
      <div className="card">
        <div className="toolbar">
          <div className="search-field">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              type="text"
              placeholder="퀴즈 이름, 제작자로 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <button
            type="button"
            className={`switch-field${certifiedOnly ? ' on' : ''}`}
            onClick={() => setCertifiedOnly((v) => !v)}
          >
            <span className="track" /><span>인증 퀴즈만</span>
          </button>
        </div>
        <div className="tagbar">
          <button type="button" className={`tag-chip${activeTagValues.size === 0 ? ' active' : ''}`} onClick={() => setActiveTagValues(new Set())}>
            전체
          </button>
          {tags.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`tag-chip${activeTagValues.has(t.value) ? ' active' : ''}`}
              onClick={() => toggleTag(t.value)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="grid-wrap">
          <div className="quiz-grid">
            {filteredQuizzes.length === 0 && <div className="empty-hint">조건에 맞는 퀴즈가 없어요.</div>}
            {filteredQuizzes.map((q) => (
              <QuizCard
                key={q.quiz_id}
                quiz={q}
                tagNameByValue={tagNameByValue}
                selected={selectedQuiz?.quiz_id === q.quiz_id}
                onClick={() => handleCardClick(q)}
                onMouseEnter={(e) => hoverPreview.onEnter(q, e)}
                onMouseLeave={hoverPreview.onLeave}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="detail-col">
        <div className="card detail-card">
          {selectedQuiz === null ? (
            <div className="detail-empty">
              <div className="glyph">🔍</div>
              <div>퀴즈를 검색하고 골라보세요</div>
            </div>
          ) : detail === null ? (
            <div className="detail-empty">
              <div className="glyph">⏳</div>
              <div>불러오는 중...</div>
            </div>
          ) : (
            <QuizDetailCard detail={detail} tagNameByValue={tagNameByValue}>
              {detail.question_count === 0 ? (
                <div className="hint-text">이 퀴즈는 아직 등록된 문제가 없어 시작할 수 없어요.</div>
              ) : (
                <>
                  <StepperBlock
                    max={detail.question_count}
                    value={questionCount}
                    onChange={(v) => { setQuestionCount(v); setJustApplied(false); }}
                  />
                  <button type="button" className="cta-primary" disabled={confirming || justApplied} onClick={handleConfirm}>
                    {justApplied ? '✓ 디스코드에 적용됨' : confirming ? '전송 중...' : '이 퀴즈로 선택 완료'}
                  </button>
                  <div className="hint-text">
                    디스코드 화면이 실시간으로 갱신돼요. 다른 퀴즈를 고르거나 문제 수를 바꾸고 다시
                    눌러도 계속 반영할 수 있어요.
                  </div>
                </>
              )}
            </QuizDetailCard>
          )}
        </div>
      </div>

      <QuizHoverPreview hover={hoverPreview.hover} tagNameByValue={tagNameByValue} />
    </div>
  );
}
