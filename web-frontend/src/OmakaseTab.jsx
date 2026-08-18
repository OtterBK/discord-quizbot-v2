import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getOmakaseTags, getUserQuizzes, getUserQuizDetail, selectQuiz, confirmSelection,
  getRandomQuizPresets, createRandomQuizPreset, deleteRandomQuizPreset,
} from './api.js';
import { fallbackThumbFor, isValidThumbnailUrl, SORT_OPTIONS, compareQuizzesBySort, useHoverPreview } from './quizCardUtils.js';
import QuizDetailCard from './QuizDetailCard.jsx';
import QuizHoverPreview from './QuizHoverPreview.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const OMAKASE_QUIZ_SIZE = 100; // OmakaseQuizRoomUI.createDefaultOmakaseQuizInfo의 quiz_size와 동일(고정값)

// 랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md) 저장 실패 사유별 안내 문구 - web_express_app.ts의
// error 코드와 1:1 대응.
const PRESET_ERROR_MESSAGES = {
  invalid_preset_name: '이름은 1~30자로 입력해주세요.',
  duplicate_name: '이미 같은 이름의 프리셋이 있어요.',
  invalid_quiz_id_list: '퀴즈함이 비어있어요.',
  max_presets_reached: '프리셋은 최대 10개까지만 저장할 수 있어요.',
};

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
export function BasketQuizCard({ quiz, tagNameByValue, selected, inBasket, onClick, onContextMenu, onMouseEnter, onMouseLeave }) {
  const thumb = fallbackThumbFor(quiz.quiz_id);
  const hasThumbnail = isValidThumbnailUrl(quiz.thumbnail);
  const matchedTagNames = tagNameByValue
    ? Object.entries(tagNameByValue)
      .filter(([value]) => (quiz.tags_value & Number(value)) !== 0)
      .map(([, name]) => name)
    : [];

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
        <span className="tags">
          {matchedTagNames.map((name) => <span key={name} className="mini-tag">{name}</span>)}
        </span>
      </span>
    </button>
  );
}

// 확정(confirm)은 디스코드 화면을 OmakaseQuizRoomUI로 전환하지만, 세션 토큰은 그대로 유지된다
// (dev/user 탭과 동일한 토큰 생명주기). omakase는 DB 조회가 필요 없는 작은 데이터(태그/인증필터/
// 퀴즈함/문제 수)라 설정을 바꿀 때마다 select를 호출해 디스코드 임베드를 실시간으로 갱신한다.
// basketItems/setBasketItems는 부모(App.jsx)에서 끌어올려 받는다 - 탭 전환으로 이 컴포넌트가
// 언마운트돼도 "직접 담기" 퀴즈함 내용이 유지되게 하기 위함(2026-08-15 피드백).
export default function OmakaseTab({ onSessionInvalid, basketItems, setBasketItems }) {
  const [tagsData, setTagsData] = useState(null); // { dev_tags, type_tags, genre_tags }
  const [userQuizzes, setUserQuizzes] = useState(null);
  const [browseTags, setBrowseTags] = useState([]); // QUIZ_TAG 전체(유형+장르) - 퀴즈함 브라우징 필터용
  const [error, setError] = useState(null);

  const [devTags, setDevTags] = useState(0); // dev_quiz_tags
  const [userMode, setUserMode] = useState('basket'); // 'genre' | 'basket' - 실제 필드는 basket_mode
  const [typeTags, setTypeTags] = useState(0); // custom_quiz_type_tags
  const [genreTags, setGenreTags] = useState(0); // custom_quiz_tags
  const [certifiedFilter, setCertifiedFilter] = useState(true); // 장르로 뽑기 모드 전용
  // basketItems({ [quiz_id]: {quiz_id, title} })는 이제 부모(App.jsx)가 들고 있는 prop
  const [questionCount, setQuestionCount] = useState(30);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  // 랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md) - "직접 담기" 모드의 퀴즈함(quiz_id 목록)만
  // 유저 단위로 저장/재적용. 옵션은 프리셋에 안 담고 항상 지금 화면의 현재 설정을 따른다.
  const [presets, setPresets] = useState([]);
  const [showPresetSaveInput, setShowPresetSaveInput] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetError, setPresetError] = useState(null);
  const [presetNotice, setPresetNotice] = useState(null); // 불러오기 시 제외된 항목 안내
  const [confirmingDeletePresetId, setConfirmingDeletePresetId] = useState(null);

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
  const presetNoticeTimeoutRef = useRef(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    Promise.all([getOmakaseTags(), getUserQuizzes(), getRandomQuizPresets()])
      .then(([tags, { quizzes, tags: quiz_tags }, { presets: preset_list }]) => {
        setTagsData(tags);
        setUserQuizzes(quizzes);
        setBrowseTags(quiz_tags);
        setPresets(preset_list);
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

  const handleSavePreset = async () => {
    const preset_name = presetNameDraft.trim();
    if (preset_name === '') return;

    setSavingPreset(true);
    setPresetError(null);
    try {
      const quiz_id_list = Object.keys(basketItems).map(Number);
      const created = await createRandomQuizPreset(preset_name, quiz_id_list);
      setPresets((prev) => [...prev, created]);
      setPresetNameDraft('');
      setShowPresetSaveInput(false);
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      setPresetError(PRESET_ERROR_MESSAGES[err.message] ?? '저장에 실패했어요.');
    } finally {
      setSavingPreset(false);
    }
  };

  // 프리셋의 quiz_id_list는 서버가 필터링 없이 그대로 내려준다(비공개 전환/삭제된 항목까지 포함) -
  // 이미 불러온 공개 퀴즈 목록(userQuizzes)에서 실제로 찾아지는 항목만 퀴즈함에 채우고, 못 찾은
  // 개수만큼 안내한다(계획 문서의 "앱 코드 레벨" 필터링 항목). 불러왔다는 걸 알 수 있는 확인용
  // 안내가 없다는 2026-08-13 피드백 - dev 탭 확정 버튼의 justApplied(1.5초 표시 후 자동 해제)와
  // 같은 톤으로, 이 자리에 이미 있던 hint-text 한 줄을 잠깐 보여줬다가 자동으로 지운다.
  const handleLoadPreset = (preset) => {
    const next = {};
    for (const quiz_id of preset.quiz_id_list) {
      const quiz = userQuizzes.find((q) => q.quiz_id === quiz_id);
      if (quiz !== undefined) next[quiz_id] = { quiz_id, title: quiz.title };
    }

    const dropped_count = preset.quiz_id_list.length - Object.keys(next).length;
    setPresetNotice(dropped_count > 0
      ? `"${preset.preset_name}" 불러옴 — ${dropped_count}개 항목은 더 이상 사용할 수 없어 제외됐어요.`
      : `✓ "${preset.preset_name}" 불러왔어요.`);
    clearTimeout(presetNoticeTimeoutRef.current);
    presetNoticeTimeoutRef.current = setTimeout(() => setPresetNotice(null), 3000);

    setUserMode('basket');
    setBasketItems(next);
    pushUpdate({ basket_mode: true, basket_items: next });
  };

  // 문제 삭제 등 다른 화면과 동일한 2클릭 확인 관례(QuizDetailPage.jsx의 confirmingDeleteQuestionId).
  const handleDeletePreset = async (preset_id) => {
    if (confirmingDeletePresetId !== preset_id) {
      setConfirmingDeletePresetId(preset_id);
      return;
    }

    try {
      await deleteRandomQuizPreset(preset_id);
      setPresets((prev) => prev.filter((p) => p.preset_id !== preset_id));
    } catch (err) {
      handleApiError(err);
    } finally {
      setConfirmingDeletePresetId(null);
    }
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
                    tagNameByValue={browseTagNameByValue}
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
        <div className="qd-presets">
          <span className="field-label">📌 저장된 프리셋 ({presets.length}/10)</span>
          {presets.length > 0 && (
            <div className="qd-preset-list">
              {presets.map((p) => (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div key={p.preset_id} role="button" tabIndex={0} className="qd-row" onClick={() => handleLoadPreset(p)}>
                  <span className="mini-thumb" style={{ background: 'linear-gradient(155deg, var(--primary) 0%, var(--violet) 100%)' }}>📌</span>
                  <div className="qd-info">
                    <div className="qd-title">{p.preset_name}</div>
                    <div className="qd-sub">{p.quiz_id_list.length}개</div>
                  </div>
                  <button
                    type="button"
                    className="qd-remove"
                    title="삭제"
                    onClick={(e) => { e.stopPropagation(); handleDeletePreset(p.preset_id); }}
                  >
                    {confirmingDeletePresetId === p.preset_id ? '⚠️' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {showPresetSaveInput ? (
            <div className="qd-preset-save">
              <input
                type="text"
                className="text-field"
                placeholder="프리셋 이름"
                maxLength={30}
                value={presetNameDraft}
                onChange={(e) => setPresetNameDraft(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="toolbar-cta"
                disabled={savingPreset || presetNameDraft.trim() === ''}
                onClick={handleSavePreset}
              >
                {savingPreset ? '저장 중...' : '저장'}
              </button>
              <button type="button" className="link-btn" onClick={() => { setShowPresetSaveInput(false); setPresetError(null); }}>취소</button>
            </div>
          ) : (
            <button
              type="button"
              className="link-btn"
              disabled={basketCount === 0 || presets.length >= 10}
              onClick={() => setShowPresetSaveInput(true)}
            >
              + 현재 퀴즈함을 프리셋으로 저장
            </button>
          )}
          {presetError && <div className="error-banner">{presetError}</div>}
          {presetNotice && <div className="hint-text">{presetNotice}</div>}
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
      </div>

      <QuizHoverPreview hover={hoverPreview.hover} tagNameByValue={browseTagNameByValue} />
    </div>
  );
}
