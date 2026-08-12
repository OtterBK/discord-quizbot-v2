import { useEffect, useState } from 'react';
import { getDevQuizzes, selectQuiz, confirmSelection } from './api.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// docs/WEB_UI_MOCKUP.html의 THUMB_STYLES 팔레트 중 공식 퀴즈 트리(문제 형식)용 부분만 이식.
const TYPE_THUMB = {
  '노래 퀴즈': { from: '#5B4FCF', to: '#2C2470', glyph: '🎵' },
  '그림 퀴즈': { from: '#E08A2E', to: '#8A4E13', glyph: '🖼️' },
  '텍스트 퀴즈': { from: '#5C6470', to: '#2B3038', glyph: '📝' },
  'OX 퀴즈': { from: '#1E9E6B', to: '#0E5C3E', glyph: '⭕' },
};
const thumbStyleFor = (type_name) => TYPE_THUMB[type_name] ?? { from: '#8A7A63', to: '#453B2E', glyph: '🎯' };

function Breadcrumb({ path, onJump }) {
  return (
    <div className="breadcrumb">
      {path.map((node, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {i > 0 && <span className="sep">/</span>}
          <button
            type="button"
            className={i === path.length - 1 ? 'current' : ''}
            onClick={() => onJump(i)}
          >
            {node.name}
          </button>
        </span>
      ))}
    </div>
  );
}

function TreeRow({ node, selected, onClick }) {
  if (node.leaf) {
    const style = thumbStyleFor(node.type_name);
    return (
      <button type="button" className={`tree-row leaf${selected ? ' selected' : ''}`} onClick={onClick}>
        <span className="tile" style={{ background: `linear-gradient(155deg, ${style.from} 0%, ${style.to} 100%)` }}>
          {style.glyph}
        </span>
        <span className="label">{node.name}</span>
        <span className="sub">{node.type_name}</span>
        <span className="count-pill">{node.quiz_size}문제</span>
      </button>
    );
  }

  return (
    <button type="button" className="tree-row folder" onClick={onClick}>
      <span className="icon">📁</span>
      <span className="label">{node.name}</span>
      <span className="chev">›</span>
    </button>
  );
}

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

// 확정(confirm)은 디스코드 화면을 DevQuizInfoUI로 전환하지만, 세션 토큰은 그대로 유지된다
// (2026-08-08 설계 변경 — 원래는 확정 즉시 토큰을 파기해서 재선택/문제 수 재조정이 전부 막혔었음).
// 그래서 확정 후에도 이 페이지는 계속 조작 가능해야 한다 — 트리에서 다른 퀴즈를 고르거나 문제 수를
// 바꾸고 다시 "선택 완료"를 누르면, 디스코드의 DevQuizInfoUI가 실시간으로 갱신된다(dev-quiz-info-ui.ts의
// onReceivedWebSessionSignal). 세션이 실제로 끝나는 시점(퀴즈 시작, 다른 화면으로 이동, GC 만료,
// 권한 뺏김)엔 다음 API 호출이 401을 반환하고, 그건 onSessionInvalid로 처리한다.
export default function DevQuizTab({ onSessionInvalid }) {
  const [tree, setTree] = useState(null);
  const [error, setError] = useState(null);
  const [path, setPath] = useState(null); // [{name, children}, ...]
  const [selectedLeaf, setSelectedLeaf] = useState(null);
  const [questionCount, setQuestionCount] = useState(20);
  const [confirming, setConfirming] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getDevQuizzes()
      .then(({ tree }) => {
        setTree(tree);
        setPath([{ name: '전체', children: tree }]);
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({error})</div>;
  }

  if (tree === null || path === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  const current = path[path.length - 1];

  const handleRowClick = (node) => {
    if (node.leaf) {
      setSelectedLeaf(node);
      const default_count = clamp(20, 1, node.quiz_size);
      setQuestionCount(default_count);
      setJustApplied(false);
      selectQuiz({ mode: 'dev', content_path: node.content_path, title: node.name }).catch(handleApiError);
      return;
    }

    setPath([...path, node]);
  };

  const handleConfirm = async () => {
    if (selectedLeaf === undefined || selectedLeaf === null) return;

    setConfirming(true);
    try {
      await confirmSelection('dev', { content_path: selectedLeaf.content_path }, questionCount);
      setJustApplied(true);
      setTimeout(() => setJustApplied(false), 1500);
    } catch (err) {
      handleApiError(err);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="panel active">
      <div className="card">
        <Breadcrumb path={path} onJump={(i) => setPath(path.slice(0, i + 1))} />
        <div className="legacy-notice">
          🗂️ <span><b>공식 퀴즈는 2023년부터 업데이트되지 않아요</b> — 신선한 콘텐츠는 유저 퀴즈 탭에서 만나보세요!</span>
        </div>
        <div className="tree-list">
          {(current.children ?? []).map((node, i) => (
            <TreeRow
              key={node.content_path ?? `${node.name}-${i}`}
              node={node}
              selected={selectedLeaf === node}
              onClick={() => handleRowClick(node)}
            />
          ))}
        </div>
      </div>

      <div className="detail-col">
        <div className="card detail-card">
          {selectedLeaf === null ? (
            <div className="detail-empty">
              <div className="glyph">📂</div>
              <div>왼쪽에서 문제 세트를 골라주세요</div>
            </div>
          ) : (
            <>
              <div className="detail-title">{selectedLeaf.name}</div>
              <div className="detail-desc">{path.slice(1).map((n) => n.name).join(' · ')} 폴더의 공식 퀴즈입니다.</div>
              <div className="stat-grid">
                <div className="stat-box">
                  <div className="k">유형</div>
                  <div className="v" style={{ fontSize: 13 }}>{selectedLeaf.type_name}</div>
                </div>
                <div className="stat-box">
                  <div className="k">보유 문제</div>
                  <div className="v">{selectedLeaf.quiz_size}</div>
                </div>
              </div>
              <StepperBlock
                max={selectedLeaf.quiz_size}
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
        </div>
      </div>
    </div>
  );
}
