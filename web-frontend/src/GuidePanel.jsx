import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { getQuizToolGuide } from './api.js';

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/quiz-tool-guide-ui.ts를 그대로
// 옮긴 정적 안내 화면. 인터랙션 없음(뒤로가기만).
export default function GuidePanel({ onBack, onSessionInvalid }) {
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getQuizToolGuide()
      .then(setGuide)
      .catch((err) => {
        if (err.status === 401) {
          onSessionInvalid();
          return;
        }
        setError(err.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card section-block">
      <button type="button" className="link-btn" onClick={onBack}>← 퀴즈 선택으로</button>

      {error && <div className="error-banner">🔸 오류가 발생했어요. ({error})</div>}
      {guide === null && error === null && <div className="empty-hint">불러오는 중...</div>}

      {guide !== null && (
        <>
          <div className="detail-title" style={{ marginTop: 10, fontSize: 16 }}>{guide.title}</div>
          <div className="markdown-desc" style={{ marginTop: 8 }}><Markdown>{guide.description}</Markdown></div>
          {guide.fields.map((field, i) => (
            <div key={i} style={{ marginTop: 16 }}>
              <span className="field-label">{field.name}</span>
              <div className="markdown-desc"><Markdown>{field.value}</Markdown></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
