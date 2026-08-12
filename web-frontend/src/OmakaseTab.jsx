import { useEffect, useMemo, useRef, useState } from 'react';
import { getOmakaseTags, getUserQuizzes, getUserQuizDetail, selectQuiz, confirmSelection } from './api.js';
import { fallbackThumbFor, isValidThumbnailUrl, SORT_OPTIONS, compareQuizzesBySort, useHoverPreview } from './quizCardUtils.js';
import QuizDetailCard from './QuizDetailCard.jsx';
import QuizHoverPreview from './QuizHoverPreview.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const OMAKASE_QUIZ_SIZE = 100; // OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo의 quiz_size와 동일(고정값)

// MultiplayerTab.jsx(Phase 4)도 그대로 재사용 - 태그 select 칩 하나 표시하는 것뿐이라 omakase 전용 로직 없음.
export function ChipRow({ tags, activeMask, onToggle }) {
  return (
    <div className="chip-row">
      {tags.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`tag-chip${(activeMask & t.value) !== 0 ? ' active' : ''}`}
          onClick={() => onToggle(t.value)}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}

// 좌클릭 = 상세 정보 미리보기(선택), 우클릭 = 퀴즈함 담기/빼기 바로 토글(2026-08-09 피드백 - 원래
// 승인된 목업 설계와 동일한 상호작용). 담기/빼기는 상세 패널의 전용 버튼으로도 가능하다.
// selected = 지금 미리보고 있는 카드(테두리 강조), inBasket = 실제로 퀴즈함에 담겼는지(체크 배지).
// MultiplayerTab.jsx(Phase 4)도 그대로 재사용.
export function BasketQuizCard({ quiz, selected, inBasket, onClick, onContextMenu, onMouseEnter, onMouseLeave }) {
  const thumb = fallbackThumbFor(quiz.quiz_id);
  const hasThumbnail = isValidThumbnailUrl(quiz.thumbnail);

  return (
    <button
      type="button"
      className={`quiz-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
        {inBasket && <span className="thumb-check">✓</span>}
        {quiz.certified === true && <span className="thumb-badge verified">✓ 인증</span>}
        <span className="thumb-badge likes">♥ {quiz.like_count ?? 0}</span>
      </span>
      <span className="card-body">
        <h3>{quiz.title}</h3>
        <span className="creator">by {quiz.creator_name ?? '알 수 없음'}</span>
      </span>
    </button>
  );
}

// 확정(confirm)은 디스코드 화면을 OmakaseQuizRoomUI로 전환하지만, 세션 토큰은 그대로 유지된다
// (dev/user 탭과 동일한 토큰 생명주기). omakase는 DB 조회가 필요 없는 작은 데이터(태그/인증필터/
// 퀴즈함/문제 수)라 설정을 바꿀 때마다 select를 호출해 디스코드 임베드를 실시간으로 갱신한다.
export default function OmakaseTab({ onSessionInvalid }) {
  const [tagsData, setTagsData] = useState(null); // { dev_tags, type_tags, genre_tags }
  const [userQuizzes, setUserQuizzes] = useState(null);
  const [browseTags, setBrowseTags] = useState([]); // QUIZ_TAG 전체(유형+장르) - 퀴즈함 브라우징 필터용
  const [error, setError] = useState(null);

  const [devTags, setDevTags] = useState(0); // dev_quiz_tags
  const [userMode, setUserMode] = useState('basket'); // 'genre' | 'basket' - 실제 필드는 basket_mode
  const [typeTags, setTypeTags] = useState(0); // custom_quiz_type_tags
  const [genreTags, setGenreTags] = useState(0); // custom_quiz_tags
  const [certifiedFilter, setCertifiedFilter] = useState(true); // 장르로 뽑기 모드 전용
  const [basketItems, setBasketItems] = useState({}); // { [quiz_id]: {quiz_id, title} }
  const [questionCount, setQuestionCount] = useState(30);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  // 퀴즈함 모드 브라우징 필터(실제 omakase 필드가 아니라 검색 편의용 로컬 상태)
  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSort, setBrowseSort] = useState('modified_time');
  const [browseCertifiedOnly, setBrowseCertifiedOnly] = useState(false);
  const [activeBrowseTagValues, setActiveBrowseTagValues] = useState(new Set());

  // 퀴즈함 모드에서 카드/드로워 항목을 클릭했을 때 미리보는 상세 정보(2026-08-09 피드백)
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [omaDetail, setOmaDetail] = useState(null);

  const hoverPreview = useHoverPreview();

  const devTagSectionRef = useRef(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    Promise.all([getOmakaseTags(), getUserQuizzes()])
      .then(([tags, { quizzes, tags: quiz_tags }]) => {
        setTagsData(tags);
        setUserQuizzes(quizzes);
        setBrowseTags(quiz_tags);
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildSummaryTitle = (merged) => {
    if (tagsData === null) return undefined;

    const parts = [];
    if (merged.dev_quiz_tags !== 0) {
      const names = tagsData.dev_tags.filter((t) => (merged.dev_quiz_tags & t.value) !== 0).map((t) => t.name);
      parts.push(`공식(${names.join('/')})`);
    }
    if (merged.basket_mode) {
      const count = Object.keys(merged.basket_items).length;
      if (count > 0) parts.push(`퀴즈함 ${count}개`);
    } else if (merged.custom_quiz_type_tags !== 0) {
      const names = tagsData.type_tags.filter((t) => (merged.custom_quiz_type_tags & t.value) !== 0).map((t) => t.name);
      parts.push(`유저(${names.join('/')})`);
    }

    return parts.length > 0 ? parts.join(' + ') : undefined;
  };

  const pushUpdate = (overrides) => {
    const merged = {
      dev_quiz_tags: devTags,
      basket_mode: userMode === 'basket',
      custom_quiz_type_tags: typeTags,
      custom_quiz_tags: genreTags,
      certified_filter: certifiedFilter,
      basket_items: basketItems,
      ...overrides,
    };

    setJustApplied(false);
    selectQuiz({ mode: 'omakase', ...merged, title: buildSummaryTitle(merged) }).catch(handleApiError);

    return merged;
  };

  const toggleDevTag = (value) => {
    const next = devTags ^ value;
    setDevTags(next);
    pushUpdate({ dev_quiz_tags: next });
  };

  const toggleTypeTag = (value) => {
    const next = typeTags ^ value;
    setTypeTags(next);
    pushUpdate({ custom_quiz_type_tags: next });
  };

  const toggleGenreTag = (value) => {
    const next = genreTags ^ value;
    setGenreTags(next);
    pushUpdate({ custom_quiz_tags: next });
  };

  const toggleCertifiedFilter = () => {
    const next = !certifiedFilter;
    setCertifiedFilter(next);
    pushUpdate({ certified_filter: next });
  };

  const changeUserMode = (mode) => {
    setUserMode(mode);
    pushUpdate({ basket_mode: mode === 'basket' });
  };

  const toggleBasketItem = (quiz) => {
    const next = { ...basketItems };
    if (next[quiz.quiz_id] !== undefined) {
      delete next[quiz.quiz_id];
    } else {
      next[quiz.quiz_id] = { quiz_id: quiz.quiz_id, title: quiz.title };
    }
    setBasketItems(next);
    pushUpdate({ basket_items: next });
  };

  const removeFromBasket = (quiz_id) => {
    const next = { ...basketItems };
    delete next[quiz_id];
    setBasketItems(next);
    pushUpdate({ basket_items: next });
  };

  const changeQuestionCount = (value) => {
    setQuestionCount(value);
    pushUpdate({});
  };

  const browseTagNameByValue = useMemo(
    () => Object.fromEntries(browseTags.map((t) => [t.value, t.name])),
    [browseTags],
  );

  const handleBasketCardClick = (quiz) => {
    setSelectedQuiz(quiz);
    setOmaDetail(null);

    getUserQuizDetail(quiz.quiz_id)
      .then(setOmaDetail)
      .catch(handleApiError);
  };

  // 드로워에 담긴 퀴즈 클릭(2026-08-09 피드백) - basket_items엔 {quiz_id, title}만 있어서
  // userQuizzes 전체 목록에서 카드 표시용 요약 정보를 다시 찾는다.
  const handleBasketDrawerItemClick = (item) => {
    const quiz = userQuizzes.find((q) => q.quiz_id === item.quiz_id);
    if (quiz !== undefined) {
      handleBasketCardClick(quiz);
    }
  };

  const scrollToDevTagSection = () => {
    devTagSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const toggleBrowseTag = (value) => {
    setActiveBrowseTagValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const filteredUserQuizzes = useMemo(() => {
    if (userQuizzes === null) return [];

    const keyword = browseSearch.trim().toLowerCase();
    const active_tags_mask = [...activeBrowseTagValues].reduce((acc, v) => acc | v, 0);

    let list = userQuizzes.filter((q) => {
      if (browseCertifiedOnly && q.certified !== true) return false;
      if (active_tags_mask !== 0 && (q.tags_value & active_tags_mask) !== active_tags_mask) return false;
      if (keyword === '') return true;
      return q.title?.toLowerCase().includes(keyword) || q.creator_name?.toLowerCase().includes(keyword);
    });

    list = [...list].sort((a, b) => compareQuizzesBySort(a, b, browseSort));

    return list;
  }, [userQuizzes, browseSearch, browseSort, browseCertifiedOnly, activeBrowseTagValues]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmSelection('omakase', {
        dev_quiz_tags: devTags,
        basket_mode: userMode === 'basket',
        custom_quiz_type_tags: typeTags,
        custom_quiz_tags: genreTags,
        certified_filter: certifiedFilter,
        basket_items: basketItems,
      }, questionCount);
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

  if (tagsData === null || userQuizzes === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  const basketCount = Object.keys(basketItems).length;
  const readyToStart = devTags !== 0 || typeTags !== 0 || (userMode === 'basket' && basketCount > 0);

  return (
    <div className="panel active">
      <div className="card">
        <div className="section-block accent" ref={devTagSectionRef}>
          <div className="section-title">
            📕 공식 퀴즈 장르 (다중선택 가능)
            {devTags !== 0 && <span className="selection-badge">{tagsData.dev_tags.filter((t) => (devTags & t.value) !== 0).length}개 선택됨</span>}
          </div>
          <div className="hint-text">선택 안 해도 되지만, 고르면 아래 유저 퀴즈와 섞여서 함께 출제돼요.</div>
          <ChipRow tags={tagsData.dev_tags} activeMask={devTags} onToggle={toggleDevTag} />
        </div>
        <div className="section-block">
          <div className="section-title">📗 유저 퀴즈</div>
          <div className="mode-switch">
            <button type="button" className={userMode === 'genre' ? 'active' : ''} onClick={() => changeUserMode('genre')}>🎲 장르로 뽑기</button>
            <button type="button" className={userMode === 'basket' ? 'active' : ''} onClick={() => changeUserMode('basket')}>🧺 직접 골라 담기</button>
          </div>
        </div>

        {userMode === 'genre' ? (
          <>
            <div className="section-block">
              <div className="section-title">퀴즈 유형</div>
              <ChipRow tags={tagsData.type_tags} activeMask={typeTags} onToggle={toggleTypeTag} />
            </div>
            <div className="section-block">
              <div className="section-title">퀴즈 장르 (선택 안하면 전체 장르)</div>
              <ChipRow tags={tagsData.genre_tags} activeMask={genreTags} onToggle={toggleGenreTag} />
            </div>
            <div className="section-block">
              <button type="button" className={`switch-field${certifiedFilter ? ' on' : ''}`} onClick={toggleCertifiedFilter}>
                <span className="track" /><span>인증(추천 10개↑) 퀴즈만 출제</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="toolbar">
              <div className="search-field">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                <input
                  type="text"
                  placeholder="퀴즈함에 담을 퀴즈 검색"
                  value={browseSearch}
                  onChange={(e) => setBrowseSearch(e.target.value)}
                />
              </div>
              <select className="sort-select" value={browseSort} onChange={(e) => setBrowseSort(e.target.value)}>
                {SORT_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <button
                type="button"
                className={`switch-field${browseCertifiedOnly ? ' on' : ''}`}
                onClick={() => setBrowseCertifiedOnly((v) => !v)}
              >
                <span className="track" /><span>인증 퀴즈만 보기</span>
              </button>
            </div>
            <div className="hint-text" style={{ padding: '0 16px' }}>
              💡 카드를 좌클릭하면 상세보기, 우클릭하면 퀴즈함에 바로 담겨요(빼기도 우클릭으로).
            </div>
            <div className="tagbar">
              <button type="button" className={`tag-chip${activeBrowseTagValues.size === 0 ? ' active' : ''}`} onClick={() => setActiveBrowseTagValues(new Set())}>
                전체
              </button>
              {browseTags.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`tag-chip${activeBrowseTagValues.has(t.value) ? ' active' : ''}`}
                  onClick={() => toggleBrowseTag(t.value)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <div className="grid-wrap">
              <div className="quiz-grid">
                {filteredUserQuizzes.length === 0 && <div className="empty-hint">조건에 맞는 퀴즈가 없어요.</div>}
                {filteredUserQuizzes.map((q) => (
                  <BasketQuizCard
                    key={q.quiz_id}
                    quiz={q}
                    selected={selectedQuiz?.quiz_id === q.quiz_id}
                    inBasket={basketItems[q.quiz_id] !== undefined}
                    onClick={() => handleBasketCardClick(q)}
                    onContextMenu={(e) => { e.preventDefault(); toggleBasketItem(q); }}
                    onMouseEnter={(e) => hoverPreview.onEnter(q, e)}
                    onMouseLeave={hoverPreview.onLeave}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="detail-col">
        <div className="card detail-card">
          <div className="detail-title">🍴 랜덤 퀴즈 설정 요약</div>
          {devTags === 0 && (
            <button type="button" className="nudge" onClick={scrollToDevTagSection}>
              <span>🎯 공식 퀴즈 장르도 추가해보세요</span>
              <span>→</span>
            </button>
          )}
          <div>
            <div className="summary-row">
              <span className="k">공식 퀴즈 장르</span>
              <span className="v">{devTags !== 0 ? tagsData.dev_tags.filter((t) => (devTags & t.value) !== 0).map((t) => t.name).join(', ') : '선택 안함'}</span>
            </div>
            <div className="summary-row">
              <span className="k">유저 퀴즈 모드</span>
              <span className="v">{userMode === 'genre' ? '🎲 장르로 뽑기' : '🧺 직접 골라 담기'}</span>
            </div>
            {userMode === 'genre' ? (
              <>
                <div className="summary-row">
                  <span className="k">· 퀴즈 유형</span>
                  <span className="v">{typeTags !== 0 ? tagsData.type_tags.filter((t) => (typeTags & t.value) !== 0).map((t) => t.name).join(', ') : '선택 안함'}</span>
                </div>
                <div className="summary-row">
                  <span className="k">· 퀴즈 장르</span>
                  <span className="v">{genreTags !== 0 ? tagsData.genre_tags.filter((t) => (genreTags & t.value) !== 0).map((t) => t.name).join(', ') : '전체 장르'}</span>
                </div>
                <div className="summary-row">
                  <span className="k">· 인증 필터</span>
                  <span className="v">{certifiedFilter ? '인증된 퀴즈만' : '모든 퀴즈'}</span>
                </div>
              </>
            ) : (
              <div className="summary-row">
                <span className="k">· 퀴즈함</span>
                <span className="v">{basketCount}개 담김</span>
              </div>
            )}
          </div>

          <div>
            <span className="field-label">문제 수</span>
            <div className="stepper">
              <button type="button" disabled={questionCount <= 1} onClick={() => changeQuestionCount(clamp(questionCount - 1, 1, OMAKASE_QUIZ_SIZE))}>−</button>
              <input
                className="val"
                type="number"
                min="1"
                max={OMAKASE_QUIZ_SIZE}
                value={questionCount}
                onChange={(e) => {
                  let n = parseInt(e.target.value, 10);
                  if (isNaN(n)) n = 1;
                  changeQuestionCount(clamp(n, 1, OMAKASE_QUIZ_SIZE));
                }}
              />
              <button type="button" disabled={questionCount >= OMAKASE_QUIZ_SIZE} onClick={() => changeQuestionCount(clamp(questionCount + 1, 1, OMAKASE_QUIZ_SIZE))}>+</button>
              <span className="range">/ {OMAKASE_QUIZ_SIZE}</span>
            </div>
          </div>

          <button type="button" className="cta-primary" disabled={!readyToStart || confirming || justApplied} onClick={handleConfirm}>
            {justApplied ? '✓ 디스코드에 적용됨' : confirming ? '전송 중...' : '이 설정으로 선택 완료'}
          </button>
          {!readyToStart && (
            <div className="detail-desc">공식 퀴즈 장르 / 유저 퀴즈 유형 / 퀴즈함 중 최소 하나는 선택해야 시작할 수 있어요.</div>
          )}
          <div className="hint-text">
            디스코드 화면이 실시간으로 갱신돼요. 설정을 바꾸고 다시 눌러도 계속 반영할 수 있어요.
          </div>
        </div>

        {userMode === 'basket' && selectedQuiz !== null && (
          <div className="card detail-card">
            {omaDetail === null ? (
              <div className="detail-empty">
                <div className="glyph">⏳</div>
                <div>불러오는 중...</div>
              </div>
            ) : (
              <QuizDetailCard detail={omaDetail} tagNameByValue={browseTagNameByValue}>
                <button
                  type="button"
                  className={`cta-primary${basketItems[selectedQuiz.quiz_id] !== undefined ? ' variant-danger' : ''}`}
                  onClick={() => toggleBasketItem(selectedQuiz)}
                >
                  {basketItems[selectedQuiz.quiz_id] !== undefined ? '✕ 퀴즈함에서 빼기' : '＋ 퀴즈함에 담기'}
                </button>
              </QuizDetailCard>
            )}
          </div>
        )}
      </div>

      <button type="button" className={`quizbox-fab${userMode === 'basket' ? ' visible' : ''}`} onClick={() => setDrawerOpen((v) => !v)}>
        <span>🍱 퀴즈함</span><span className="fab-count">{basketCount}</span>
      </button>
      <div className={`quizbox-drawer${drawerOpen ? ' open' : ''}`}>
        <div className="qd-head">
          <h2>퀴즈함</h2>
          <button type="button" title="닫기" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>
        <div className="qd-list">
          {basketCount === 0 ? (
            <div className="qd-empty">아직 담긴 퀴즈가 없어요.<br />"직접 골라 담기" 모드에서 카드를 클릭해보세요.</div>
          ) : (
            Object.values(basketItems).map((item) => {
              const thumb = fallbackThumbFor(item.quiz_id);
              return (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div
                  key={item.quiz_id}
                  role="button"
                  tabIndex={0}
                  className={`qd-row${selectedQuiz?.quiz_id === item.quiz_id ? ' active' : ''}`}
                  onClick={() => handleBasketDrawerItemClick(item)}
                >
                  <span className="mini-thumb" style={{ background: `linear-gradient(155deg, ${thumb.from} 0%, ${thumb.to} 100%)` }}>🎯</span>
                  <div className="qd-info">
                    <div className="qd-title">{item.title}</div>
                  </div>
                  <button type="button" className="qd-remove" onClick={(e) => { e.stopPropagation(); removeFromBasket(item.quiz_id); }}>✕</button>
                </div>
              );
            })
          )}
        </div>
        <div className="qd-footer">
          {basketCount > 25 && <span className="qd-limit-badge">🎉 25개 초과! 웹에서만 가능한 자유예요</span>}
          <div className="qd-limit-note">💡 디스코드 목록 UI는 25개까지만 지원하지만, 여기선 자유롭게 더 담을 수 있어요.</div>
        </div>
      </div>

      <QuizHoverPreview hover={hoverPreview.hover} tagNameByValue={browseTagNameByValue} />
    </div>
  );
}
