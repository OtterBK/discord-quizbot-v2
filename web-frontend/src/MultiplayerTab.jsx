import { useEffect, useMemo, useState } from 'react';
import { getMultiplayerLobbies, getMultiplayerResult, getOmakaseTags, getUserQuizzes, getUserQuizDetail, confirmMultiplayer } from './api.js';
import { fallbackThumbFor, SORT_OPTIONS, compareQuizzesBySort, useHoverPreview } from './quizCardUtils.js';
import { ChipRow, BasketQuizCard } from './OmakaseTab.jsx';
import QuizDetailCard from './QuizDetailCard.jsx';
import QuizHoverPreview from './QuizHoverPreview.jsx';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MULTIPLAYER_QUIZ_SIZE = 60; // MultiplayerQuizLobbyUI.createDefaultMultiplayerQuizInfo의 quiz_size와 동일(고정값, 랜덤 퀴즈보다 낮음)
const MULTIPLAYER_MIN_QUIZ_SIZE = 20; // 같은 파일의 min_quiz_size와 동일 - 20개 미만이면 백엔드(quiz-info-ui.ts의 applySelectedQuestionCount)가 강제로 20으로 올림

// confirmMultiplayer 응답은 항상 success:true(마스터는 브로드캐스트만 하고 실제 밴/음성채널 체크·로비
// 생성/참가는 그 길드를 담당하는 클러스터가 비동기로 처리하기 때문) - 실제 결과는 클러스터가
// report_multiplayer_result로 다시 보고한 걸 이 폴링으로 읽어와야 한다(web_session_manager.ts 참고).
async function pollMultiplayerResult(action, { attempts = 8, intervalMs = 400 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    // eslint-disable-next-line no-await-in-loop
    const { result } = await getMultiplayerResult();
    if (result !== null && result.action === action) return result;
  }
  return null; // 타임아웃 - 드문 케이스(딥 IPC 실패 등)라 낙관적으로 성공 취급
}

// 웹은 "로비를 찾아서 참가/생성하는 것 + 참가 전 설정"까지만 담당하고, 실제 퀴즈 진행/채팅은 100%
// 디스코드에 남는다(WEB_INTEGRATION_PLAN.md Phase 4).
export default function MultiplayerTab({ onSessionInvalid }) {
  const [view, setView] = useState('list'); // 'list' | 'create' | 'done'

  const [lobbies, setLobbies] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState(null);
  const [joiningSessionId, setJoiningSessionId] = useState(null);
  const [joinError, setJoinError] = useState(null);

  // "새 로비 만들기" 설정 - OmakaseTab.jsx의 설정 화면과 동일한 shape(다만 문제 수 상한이 60으로 낮음).
  const [title, setTitle] = useState('멀티플레이 퀴즈');
  const [tagsData, setTagsData] = useState(null);
  const [userQuizzes, setUserQuizzes] = useState(null);
  const [browseTags, setBrowseTags] = useState([]);

  const [devTags, setDevTags] = useState(0);
  const [userMode, setUserMode] = useState('basket');
  const [typeTags, setTypeTags] = useState(0);
  const [genreTags, setGenreTags] = useState(0);
  const [certifiedFilter, setCertifiedFilter] = useState(true);
  const [basketItems, setBasketItems] = useState({});
  const [questionCount, setQuestionCount] = useState(30);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  // 로비를 실제로 만든 뒤에도(디스코드 쪽 MultiplayerQuizLobbyUI가 onReceivedWebSessionSignal로
  // 재확정을 받아준다) 계속 이 화면에서 설정을 바꿔 반영할 수 있다 - "대기실 목록으로"는 숨겨서
  // 실수로 두 번째 로비를 또 만드는 걸 막는다(2026-08-10 피드백 4/5번 반영).
  const [hostingLobby, setHostingLobby] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const [browseSearch, setBrowseSearch] = useState('');
  const [browseSort, setBrowseSort] = useState('modified_time');
  const [browseCertifiedOnly, setBrowseCertifiedOnly] = useState(false);
  const [activeBrowseTagValues, setActiveBrowseTagValues] = useState(new Set());
  const [selectedQuiz, setSelectedQuiz] = useState(null);
  const [quizDetail, setQuizDetail] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const hoverPreview = useHoverPreview();

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  const loadLobbies = () => {
    setLoadingList(true);
    getMultiplayerLobbies()
      .then(({ lobbies: list }) => setLobbies(list))
      .catch(handleApiError)
      .finally(() => setLoadingList(false));
  };

  useEffect(() => {
    if (view === 'list') loadLobbies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (view !== 'create' || tagsData !== null) return;

    Promise.all([getOmakaseTags(), getUserQuizzes()])
      .then(([tags, { quizzes, tags: quiz_tags }]) => {
        setTagsData(tags);
        setUserQuizzes(quizzes);
        setBrowseTags(quiz_tags);
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleJoin = async (lobby) => {
    setJoiningSessionId(lobby.session_id);
    setJoinError(null);
    try {
      await confirmMultiplayer('join', { session_id: lobby.session_id });
      const result = await pollMultiplayerResult('join');
      if (result !== null && result.success === false) {
        setJoinError(result.reason ?? '참가에 실패했어요.');
        return;
      }
      setView('done');
    } catch (err) {
      handleApiError(err);
    } finally {
      setJoiningSessionId(null);
    }
  };

  const toggleBasketItem = (quiz) => {
    setBasketItems((prev) => {
      const next = { ...prev };
      if (next[quiz.quiz_id] !== undefined) delete next[quiz.quiz_id];
      else next[quiz.quiz_id] = { quiz_id: quiz.quiz_id, title: quiz.title };
      return next;
    });
  };

  const removeFromBasket = (quiz_id) => {
    setBasketItems((prev) => {
      const next = { ...prev };
      delete next[quiz_id];
      return next;
    });
  };

  const handleBasketCardClick = (quiz) => {
    setSelectedQuiz(quiz);
    setQuizDetail(null);
    getUserQuizDetail(quiz.quiz_id).then(setQuizDetail).catch(handleApiError);
  };

  // 드로워에 담긴 퀴즈 클릭(OmakaseTab.jsx와 동일) - basket_items엔 {quiz_id, title}만 있어서
  // userQuizzes 전체 목록에서 카드 표시용 요약 정보를 다시 찾는다.
  const handleBasketDrawerItemClick = (item) => {
    const quiz = userQuizzes.find((q) => q.quiz_id === item.quiz_id);
    if (quiz !== undefined) {
      handleBasketCardClick(quiz);
    }
  };

  const toggleBrowseTag = (value) => {
    setActiveBrowseTagValues((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  const browseTagNameByValue = useMemo(
    () => Object.fromEntries(browseTags.map((t) => [t.value, t.name])),
    [browseTags],
  );

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

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      await confirmMultiplayer('create', {
        title,
        dev_quiz_tags: devTags,
        basket_mode: userMode === 'basket',
        custom_quiz_type_tags: typeTags,
        custom_quiz_tags: genreTags,
        certified_filter: certifiedFilter,
        basket_items: basketItems,
      }, questionCount);

      // 최초 생성이 아니라 이미 로비를 운영 중인 상태에서 설정만 다시 반영하는 거라면, 디스코드 쪽은
      // MultiplayerQuizLobbyUI.onReceivedWebSessionSignal이 즉시(동기) 처리해서 실패할 일이 없다 -
      // 밴/음성채널 체크는 최초 생성 시도(WebHandoffUI.buildMultiplayerUI)에서만 일어난다.
      if (!hostingLobby) {
        const result = await pollMultiplayerResult('create');
        if (result !== null && result.success === false) {
          setCreateError(result.reason ?? '로비 생성에 실패했어요.');
          return;
        }
        setHostingLobby(true);
      }

      setJustApplied(true);
      setTimeout(() => setJustApplied(false), 1500);
    } catch (err) {
      handleApiError(err);
    } finally {
      setCreating(false);
    }
  };

  if (error) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({error})</div>;
  }

  if (view === 'done') {
    // 참가 완료 후엔 웹의 역할이 끝난다 - 대기실 목록으로 돌아가는 길을 일부러 안 만든다("새 로비
    // 만들기"는 로비를 계속 운영하는 화면이라 예외, 참가는 그 뒤로 디스코드 UI로만 조작).
    return (
      <div className="panel active">
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌐</div>
          참가했어요!
          <div className="hint-text" style={{ marginTop: 8 }}>
            지금부터는 디스코드 채널에서 로비를 확인하고 조작해주세요.
          </div>
        </div>
      </div>
    );
  }

  if (view === 'list') {
    return (
      <div className="panel active">
        <div className="card">
          <div className="hint-text" style={{ padding: 16 }}>
            💡 참가/생성 전에 반드시 디스코드 음성채널에 먼저 들어가 있어야 해요.
          </div>
          {joinError !== null && (
            <div className="error-banner" style={{ margin: '0 16px 14px' }}>🔸 {joinError}</div>
          )}
          <div className="toolbar">
            <button type="button" className="toolbar-cta" onClick={() => setView('create')}>🌐 새 로비 만들기</button>
            <button type="button" className="icon-btn" onClick={loadLobbies} disabled={loadingList} title="새로고침" aria-label="새로고침">
              {loadingList ? '⏳' : '🔄'}
            </button>
          </div>

          {loadingList && lobbies === null && <div className="empty-hint">불러오는 중...</div>}
          {lobbies !== null && lobbies.length === 0 && (
            <div className="empty-hint">🔹대기 중인 멀티플레이 로비가 없어요. 직접 만들어보세요!</div>
          )}

          <div className="quiz-grid">
            {(lobbies ?? []).map((lobby) => (
              <div key={lobby.session_id} className="card detail-card">
                <h3>{lobby.session_name}</h3>
                <div className="summary-row">
                  <span className="k">상태</span>
                  <span className="v">{lobby.is_ingame ? '🎮 게임 중' : '⏳ 대기 중'}</span>
                </div>
                <div className="summary-row">
                  <span className="k">참가 인원</span>
                  <span className="v">{lobby.participant_count}</span>
                </div>
                <div className="summary-row">
                  <span className="k">호스트</span>
                  <span className="v">{lobby.host_name}</span>
                </div>
                <div className="summary-row">
                  <span className="k">평균 MMR</span>
                  <span className="v">{lobby.mmr_avg}</span>
                </div>
                <button
                  type="button"
                  className="cta-primary"
                  disabled={lobby.is_ingame || joiningSessionId !== null}
                  onClick={() => handleJoin(lobby)}
                >
                  {joiningSessionId === lobby.session_id ? '참가 요청 중...' : '참가하기'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // view === 'create'
  if (tagsData === null || userQuizzes === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  const basketCount = Object.keys(basketItems).length;
  const readyToCreate = title.trim().length > 0 && (devTags !== 0 || typeTags !== 0 || (userMode === 'basket' && basketCount > 0));

  return (
    <div className="panel active">
      <div className="card">
        <div className="section-block">
          <div className="section-title">🌐 방 제목</div>
          <input
            type="text"
            className="text-field"
            maxLength={20}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="1~20자"
          />
        </div>
        <div className="section-block accent">
          <div className="section-title">
            📕 공식 퀴즈 장르 (다중선택 가능)
            {devTags !== 0 && <span className="selection-badge">{tagsData.dev_tags.filter((t) => (devTags & t.value) !== 0).length}개 선택됨</span>}
          </div>
          <ChipRow tags={tagsData.dev_tags} activeMask={devTags} onToggle={(v) => setDevTags((prev) => prev ^ v)} />
        </div>
        <div className="section-block">
          <div className="section-title">📗 유저 퀴즈</div>
          <div className="mode-switch">
            <button type="button" className={userMode === 'genre' ? 'active' : ''} onClick={() => setUserMode('genre')}>🎲 장르로 뽑기</button>
            <button type="button" className={userMode === 'basket' ? 'active' : ''} onClick={() => setUserMode('basket')}>🧺 직접 골라 담기</button>
          </div>
        </div>

        {userMode === 'genre' ? (
          <>
            <div className="section-block">
              <div className="section-title">퀴즈 유형</div>
              <ChipRow tags={tagsData.type_tags} activeMask={typeTags} onToggle={(v) => setTypeTags((prev) => prev ^ v)} />
            </div>
            <div className="section-block">
              <div className="section-title">퀴즈 장르 (선택 안하면 전체 장르)</div>
              <ChipRow tags={tagsData.genre_tags} activeMask={genreTags} onToggle={(v) => setGenreTags((prev) => prev ^ v)} />
            </div>
            <div className="section-block">
              <button type="button" className={`switch-field${certifiedFilter ? ' on' : ''}`} onClick={() => setCertifiedFilter((v) => !v)}>
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
          <div className="detail-title">🌐 멀티플레이 로비 설정 요약</div>
          <div>
            <div className="summary-row">
              <span className="k">방 제목</span>
              <span className="v">{title || '(입력 필요)'}</span>
            </div>
            <div className="summary-row">
              <span className="k">공식 퀴즈 장르</span>
              <span className="v">{devTags !== 0 ? tagsData.dev_tags.filter((t) => (devTags & t.value) !== 0).map((t) => t.name).join(', ') : '선택 안함'}</span>
            </div>
            <div className="summary-row">
              <span className="k">유저 퀴즈 모드</span>
              <span className="v">{userMode === 'genre' ? '🎲 장르로 뽑기' : '🧺 직접 골라 담기'}</span>
            </div>
            {userMode === 'basket' && (
              <div className="summary-row">
                <span className="k">· 퀴즈함</span>
                <span className="v">{basketCount}개 담김</span>
              </div>
            )}
          </div>

          <div>
            <span className="field-label">문제 수 (최소 {MULTIPLAYER_MIN_QUIZ_SIZE})</span>
            <div className="stepper">
              <button type="button" disabled={questionCount <= MULTIPLAYER_MIN_QUIZ_SIZE} onClick={() => setQuestionCount((v) => clamp(v - 1, MULTIPLAYER_MIN_QUIZ_SIZE, MULTIPLAYER_QUIZ_SIZE))}>−</button>
              <input
                className="val"
                type="number"
                min={MULTIPLAYER_MIN_QUIZ_SIZE}
                max={MULTIPLAYER_QUIZ_SIZE}
                value={questionCount}
                onChange={(e) => {
                  let n = parseInt(e.target.value, 10);
                  if (isNaN(n)) n = MULTIPLAYER_MIN_QUIZ_SIZE;
                  setQuestionCount(clamp(n, MULTIPLAYER_MIN_QUIZ_SIZE, MULTIPLAYER_QUIZ_SIZE));
                }}
              />
              <button type="button" disabled={questionCount >= MULTIPLAYER_QUIZ_SIZE} onClick={() => setQuestionCount((v) => clamp(v + 1, MULTIPLAYER_MIN_QUIZ_SIZE, MULTIPLAYER_QUIZ_SIZE))}>+</button>
              <span className="range">/ {MULTIPLAYER_QUIZ_SIZE}</span>
            </div>
          </div>

          {createError !== null && <div className="error-banner">🔸 {createError}</div>}

          <button type="button" className="cta-primary" disabled={!readyToCreate || creating} onClick={handleCreate}>
            {creating ? '전송 중...' : justApplied ? '✓ 디스코드에 반영됨' : hostingLobby ? '🌐 변경사항 반영' : '🌐 이 설정으로 로비 만들기'}
          </button>
          {!readyToCreate && (
            <div className="detail-desc">방 제목을 입력하고, 공식 퀴즈 장르 / 유저 퀴즈 유형 / 퀴즈함 중 최소 하나는 선택해야 해요.</div>
          )}

          {hostingLobby ? (
            <div className="hint-text">🌐 로비를 운영 중이에요. 설정을 바꾸고 다시 누르면 디스코드 로비에 바로 반영돼요.</div>
          ) : (
            <button type="button" className="link-btn" onClick={() => setView('list')}>← 대기실 목록으로</button>
          )}
        </div>

        {userMode === 'basket' && selectedQuiz !== null && (
          <div className="card detail-card">
            {quizDetail === null ? (
              <div className="detail-empty">
                <div className="glyph">⏳</div>
                <div>불러오는 중...</div>
              </div>
            ) : (
              <QuizDetailCard detail={quizDetail} tagNameByValue={browseTagNameByValue}>
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
