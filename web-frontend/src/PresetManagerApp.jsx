// 랜덤 퀴즈 프리셋 관리 웹 페이지(/프리셋관리 명령어, docs/plans/RANDOM_QUIZ_PRESET_PLAN.md 후속,
// 2026-08-20 신설) - 세션 부트스트랩 패턴은 QuizEditorApp.jsx와 동일(같은 api.js 재사용, owner-scoped
// 세션엔 guild 개념이 없어 react-router 없이 로컬 state로만 목록⟷상세를 전환한다 - 하위 경로가 없어
// BrowserRouter가 굳이 필요 없음). 목록/상세 둘 다 OmakaseTab.jsx의 프리셋 드로워(저장/불러오기/삭제)와
// 시각적 관용구(qd-row/qd-list 등)를 그대로 재사용하되, 이 페이지는 디스코드 "프리셋 관리" 화면
// (basket-manage-flow.ts)이 갖고 있던 이름변경/항목 개별 제거에 더해 "퀴즈 추가"까지 지원한다 -
// 디스코드 쪽은 화면 전환 체계상 라이브 퀴즈함이 있어야만 담기 UI(UserQuizSelectUI)를 쓸 수 있어서
// 추가 기능을 못 넣었지만, 웹은 애초에 퀴즈 브라우징이 세션과 무관하게 항상 가능해 훨씬 간단하다.

import { useEffect, useState } from 'react';
import {
  token, getSession, heartbeat, getUserQuizzes,
  getRandomQuizPresets, createRandomQuizPreset, deleteRandomQuizPreset,
  renameRandomQuizPreset, replaceRandomQuizPresetItems, removeRandomQuizPresetItem,
} from './api.js';
import ThemeToggle from './ThemeToggle.jsx';

const PRESET_MAX_COUNT = 10; // web_express_app.ts의 RANDOM_QUIZ_PRESET_MAX_COUNT와 동일 값(공유 상수 모듈 없음, 기존 관행)
const PRESET_NAME_MAX_LENGTH = 30;
const PRESET_ITEM_MAX_COUNT = 100;

const PRESET_ERROR_MESSAGES = {
  invalid_preset_name: '이름은 1~30자로 입력해주세요.',
  duplicate_name: '이미 같은 이름의 프리셋이 있어요.',
  invalid_quiz_id_list: '퀴즈함이 비어있어요.',
  max_presets_reached: '프리셋은 최대 10개까지만 저장할 수 있어요.',
};

// 검색 결과 목록(생성 폼/상세 화면 "퀴즈 추가" 둘 다 공유) - OmakaseTab의 카드 그리드와 달리 썸네일 없는
// 단순 리스트로 충분해서 qd-row를 그대로 재사용한다. 결과가 너무 길어지지 않게 상위 50개만 보여줌
// (검색어를 좁히면 됨 - OmakaseTab처럼 전용 그리드/필터 칩까지는 이 화면 성격상 과함).
function QuizPicker({ quizzes, excludeIds, onPick, disabled }) {
  const [search, setSearch] = useState('');

  const keyword = search.trim().toLowerCase();
  const excludeSet = new Set(excludeIds);
  const filtered = quizzes
    .filter((q) => !excludeSet.has(q.quiz_id))
    .filter((q) => keyword === '' || q.title?.toLowerCase().includes(keyword) || q.creator_name?.toLowerCase().includes(keyword))
    .slice(0, 50);

  return (
    <div className="section-block">
      <div className="search-field">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        <input type="text" placeholder="추가할 퀴즈 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="qd-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {filtered.length === 0 && <div className="empty-hint">조건에 맞는 퀴즈가 없어요.</div>}
        {filtered.map((q) => (
          <div key={q.quiz_id} className="qd-row">
            <div className="qd-info">
              <div className="qd-title">{q.title}</div>
              <div className="qd-sub">by {q.creator_name ?? '알 수 없음'}</div>
            </div>
            <button type="button" className="toolbar-cta" disabled={disabled} onClick={() => onPick(q)}>+ 추가</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function PresetListView({ presets, allQuizzes, onOpen, onCreated, onDeleted, onSessionInvalid }) {
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [stagedIds, setStagedIds] = useState([]);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return true;
    }
    return false;
  };

  const handleCreate = async () => {
    const preset_name = nameDraft.trim();
    if (preset_name === '' || stagedIds.length === 0) return;

    setCreatingBusy(true);
    setCreateError(null);
    try {
      const created = await createRandomQuizPreset(preset_name, stagedIds);
      onCreated(created);
      setCreating(false);
      setNameDraft('');
      setStagedIds([]);
    } catch (err) {
      if (!handleApiError(err)) {
        setCreateError(PRESET_ERROR_MESSAGES[err.message] ?? '생성에 실패했어요.');
      }
    } finally {
      setCreatingBusy(false);
    }
  };

  // 문제 삭제 등 다른 화면과 동일한 2클릭 확인 관례(QuizDetailPage.jsx의 confirmingDeleteQuestionId).
  const handleDelete = async (preset_id) => {
    if (confirmingDeleteId !== preset_id) {
      setConfirmingDeleteId(preset_id);
      return;
    }

    try {
      await deleteRandomQuizPreset(preset_id);
      onDeleted(preset_id);
    } catch (err) {
      handleApiError(err);
    } finally {
      setConfirmingDeleteId(null);
    }
  };

  return (
    <div className="card">
      <div className="section-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-title">📌 저장된 프리셋 ({presets.length}/{PRESET_MAX_COUNT})</span>
        <button
          type="button"
          className="toolbar-cta"
          disabled={presets.length >= PRESET_MAX_COUNT}
          onClick={() => setCreating((v) => !v)}
        >
          {creating ? '취소' : '+ 새 프리셋 만들기'}
        </button>
      </div>

      {creating && (
        <div className="section-block">
          <span className="field-label">프리셋 이름</span>
          <input
            className="text-field"
            placeholder="프리셋 이름"
            maxLength={PRESET_NAME_MAX_LENGTH}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            autoFocus
          />

          <div className="section-title" style={{ marginTop: 12 }}>담을 퀴즈 선택 ({stagedIds.length}개)</div>
          {stagedIds.length > 0 && (
            <div className="qd-list">
              {stagedIds.map((quiz_id) => {
                const quiz = allQuizzes.find((q) => q.quiz_id === quiz_id);
                return (
                  <div key={quiz_id} className="qd-row">
                    <div className="qd-info"><div className="qd-title">{quiz?.title ?? `#${quiz_id}`}</div></div>
                    <button type="button" className="qd-remove" onClick={() => setStagedIds((ids) => ids.filter((id) => id !== quiz_id))}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
          <QuizPicker
            quizzes={allQuizzes}
            excludeIds={stagedIds}
            disabled={stagedIds.length >= PRESET_ITEM_MAX_COUNT}
            onPick={(quiz) => setStagedIds((ids) => [...ids, quiz.quiz_id])}
          />

          {createError && <div className="error-banner">{createError}</div>}
          <button
            type="button"
            className="cta-primary"
            disabled={creatingBusy || nameDraft.trim() === '' || stagedIds.length === 0}
            onClick={handleCreate}
          >
            {creatingBusy ? '만드는 중...' : '프리셋 만들기'}
          </button>
        </div>
      )}

      <div className="qd-list">
        {presets.length === 0 && !creating && <div className="empty-hint">아직 저장된 프리셋이 없어요.</div>}
        {presets.map((p) => (
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
          <div key={p.preset_id} role="button" tabIndex={0} className="qd-row" onClick={() => onOpen(p.preset_id)}>
            <span className="mini-thumb" style={{ background: 'linear-gradient(155deg, var(--primary) 0%, var(--violet) 100%)' }}>📌</span>
            <div className="qd-info">
              <div className="qd-title">{p.preset_name}</div>
              <div className="qd-sub">{p.quiz_id_list.length}개</div>
            </div>
            <button
              type="button"
              className="qd-remove"
              title="삭제"
              onClick={(e) => { e.stopPropagation(); handleDelete(p.preset_id); }}
            >
              {confirmingDeleteId === p.preset_id ? '⚠️' : '✕'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// items는 preset.quiz_id_list를 quizzesById로 제목까지 붙인 것 - 삭제/비공개 전환된 항목은 조용히
// 빼는 대신(OmakaseTab의 "불러오기"와 다르게 여긴 정리가 목적) 자리를 그대로 보여주고 제거만 가능하게
// 함(basket-manage-flow.ts의 renderPresetManageDetail과 동일 관례).
function PresetDetailView({ preset, quizzesById, allQuizzes, onBack, onRenamed, onItemsChanged, onDeleted, onSessionInvalid }) {
  const [nameDraft, setNameDraft] = useState(preset.preset_name);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState(null);
  const [busyQuizId, setBusyQuizId] = useState(null); // 추가/제거 진행 중인 quiz_id - 중복 클릭 방지
  const [itemsError, setItemsError] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return true;
    }
    return false;
  };

  const items = preset.quiz_id_list.map((quiz_id) => ({
    quiz_id,
    title: quizzesById[quiz_id]?.title ?? `(더 이상 사용할 수 없는 퀴즈 #${quiz_id})`,
  }));

  const handleRename = async () => {
    const preset_name = nameDraft.trim();
    if (preset_name === '' || preset_name.length > PRESET_NAME_MAX_LENGTH || preset_name === preset.preset_name) return;

    setRenaming(true);
    setRenameError(null);
    try {
      await renameRandomQuizPreset(preset.preset_id, preset_name);
      onRenamed(preset.preset_id, preset_name);
    } catch (err) {
      if (!handleApiError(err)) {
        setRenameError(err.message === 'duplicate_name' ? '이미 같은 이름의 프리셋이 있어요.' : '이름 변경에 실패했어요.');
      }
    } finally {
      setRenaming(false);
    }
  };

  // 항목 목록 통째 교체 엔드포인트를 재사용 - 클릭 한 번마다 즉시 반영(다른 화면들의 "클릭=즉시 반영"
  // 관례와 동일, 별도 "저장" 버튼 없음).
  const handleAddQuiz = async (quiz) => {
    setBusyQuizId(quiz.quiz_id);
    setItemsError(null);
    try {
      const next_ids = [...preset.quiz_id_list, quiz.quiz_id];
      await replaceRandomQuizPresetItems(preset.preset_id, next_ids);
      onItemsChanged(preset.preset_id, next_ids);
    } catch (err) {
      if (!handleApiError(err)) setItemsError('추가에 실패했어요.');
    } finally {
      setBusyQuizId(null);
    }
  };

  const handleRemoveItem = async (quiz_id) => {
    setBusyQuizId(quiz_id);
    setItemsError(null);
    try {
      await removeRandomQuizPresetItem(preset.preset_id, quiz_id);
      onItemsChanged(preset.preset_id, preset.quiz_id_list.filter((id) => id !== quiz_id));
    } catch (err) {
      if (!handleApiError(err)) setItemsError('제거에 실패했어요.');
    } finally {
      setBusyQuizId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    try {
      await deleteRandomQuizPreset(preset.preset_id);
      onDeleted(preset.preset_id);
    } catch (err) {
      handleApiError(err);
    }
  };

  return (
    <div className="card">
      <button type="button" className="link-btn" onClick={onBack}>← 목록으로</button>

      <div className="section-block" style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <span className="field-label">프리셋 이름</span>
          <input
            className="text-field"
            value={nameDraft}
            maxLength={PRESET_NAME_MAX_LENGTH}
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="toolbar-cta"
          disabled={renaming || nameDraft.trim() === '' || nameDraft.trim() === preset.preset_name}
          onClick={handleRename}
        >
          {renaming ? '저장 중...' : '이름 저장'}
        </button>
      </div>
      {renameError && <div className="error-banner">{renameError}</div>}

      <div className="section-block">
        <span className="section-title">🧺 담긴 퀴즈 ({items.length}/{PRESET_ITEM_MAX_COUNT})</span>
        <div className="qd-list">
          {items.length === 0 && <div className="qd-empty">아직 담긴 퀴즈가 없어요.</div>}
          {items.map((item) => (
            <div key={item.quiz_id} className="qd-row">
              <div className="qd-info"><div className="qd-title">{item.title}</div></div>
              <button
                type="button"
                className="qd-remove"
                disabled={busyQuizId === item.quiz_id}
                onClick={() => handleRemoveItem(item.quiz_id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        {itemsError && <div className="error-banner">{itemsError}</div>}
      </div>

      <div className="section-block">
        <button type="button" className="toolbar-cta" onClick={() => setShowPicker((v) => !v)}>
          {showPicker ? '닫기' : '+ 퀴즈 추가'}
        </button>
        {showPicker && (
          <QuizPicker
            quizzes={allQuizzes}
            excludeIds={preset.quiz_id_list}
            disabled={busyQuizId !== null || items.length >= PRESET_ITEM_MAX_COUNT}
            onPick={handleAddQuiz}
          />
        )}
      </div>

      <div className="section-block">
        <button type="button" className="cta-primary variant-danger" onClick={handleDelete}>
          {confirmingDelete ? '⚠️ 정말 삭제할까요? 다시 누르면 삭제됩니다' : '🗑 이 프리셋 삭제'}
        </button>
      </div>
    </div>
  );
}

export default function PresetManagerApp() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [presets, setPresets] = useState(null);
  const [quizzes, setQuizzes] = useState(null);
  const [view, setView] = useState({ mode: 'list' });

  const handleSessionInvalid = () => setError('session_invalid');

  useEffect(() => {
    if (!token) {
      setError('missing_token');
      return;
    }

    getSession()
      .then(setSession)
      .catch(handleSessionInvalid);
  }, []);

  // 세션이 만료/파기되면 하트비트도 멈춘다(QuizEditorApp.jsx와 동일 관행).
  useEffect(() => {
    if (session === null || error !== null) return undefined;

    const interval = setInterval(() => {
      heartbeat().catch(handleSessionInvalid);
    }, 60000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, error]);

  useEffect(() => {
    if (session === null) return;

    Promise.all([getRandomQuizPresets(), getUserQuizzes()])
      .then(([{ presets: preset_list }, { quizzes: quiz_list }]) => {
        setPresets(preset_list);
        setQuizzes(quiz_list);
      })
      .catch((err) => {
        if (err.status === 401) handleSessionInvalid();
        else setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (error) {
    return (
      <div className="shell">
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          🔒 세션이 만료되었거나 잘못된 링크예요.
          <br />
          디스코드에서 [/프리셋관리] 명령어를 다시 입력해주세요.
        </div>
      </div>
    );
  }

  if (session === null || presets === null || quizzes === null) {
    return (
      <div className="shell">
        <div className="empty-hint">불러오는 중...</div>
      </div>
    );
  }

  const quizzesById = Object.fromEntries(quizzes.map((q) => [q.quiz_id, q]));
  const openPreset = view.mode === 'detail' ? presets.find((p) => p.preset_id === view.presetId) : undefined;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">🧺</div>
          <div className="brand-text">
            <h1>프리셋 관리</h1>
            <p>{session.owner_name ? `${session.owner_name} 님` : '관리 중'}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      {openPreset === undefined ? (
        <PresetListView
          presets={presets}
          allQuizzes={quizzes}
          onOpen={(preset_id) => setView({ mode: 'detail', presetId: preset_id })}
          onCreated={(created) => setPresets((prev) => [...prev, created])}
          onDeleted={(preset_id) => setPresets((prev) => prev.filter((p) => p.preset_id !== preset_id))}
          onSessionInvalid={handleSessionInvalid}
        />
      ) : (
        <PresetDetailView
          preset={openPreset}
          quizzesById={quizzesById}
          allQuizzes={quizzes}
          onBack={() => setView({ mode: 'list' })}
          onRenamed={(preset_id, preset_name) =>
            setPresets((prev) => prev.map((p) => (p.preset_id === preset_id ? { ...p, preset_name } : p)))}
          onItemsChanged={(preset_id, quiz_id_list) =>
            setPresets((prev) => prev.map((p) => (p.preset_id === preset_id ? { ...p, quiz_id_list } : p)))}
          onDeleted={(preset_id) => {
            setPresets((prev) => prev.filter((p) => p.preset_id !== preset_id));
            setView({ mode: 'list' });
          }}
          onSessionInvalid={handleSessionInvalid}
        />
      )}
    </div>
  );
}
