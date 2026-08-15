import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import { getQuizToolGuide } from './api.js';

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/quiz-tool-guide-ui.ts를 그대로
// 옮긴 정적 안내 화면. 인터랙션 없음(뒤로가기만). 원문(config/text_contents.json의 quiz_tool_guide_ui)은
// 디스코드 임베드와 그대로 공유하되(TEST_CHECKLIST.md에 "동일 내용이어야 함"이 명시돼 있음), 웹에서는
// 카드형 레이아웃 + remark-breaks(디스코드처럼 단일 줄바꿈도 그대로 반영)로 좀 더 화사하게 보여준다
// (2026-08-15 피드백).
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
        <div className="guide-page">
          <div className="guide-hero">
            <span className="guide-hero-icon">🛠</span>
            <div className="detail-title" style={{ fontSize: 17 }}>{guide.title}</div>
          </div>

          <div className="guide-card">
            <div className="markdown-desc">
              <Markdown remarkPlugins={[remarkBreaks]}>{guide.description}</Markdown>
            </div>
          </div>

          {guide.fields.map((field, i) => (
            <div key={i} className={`guide-card guide-card-accent-${i % 2 === 0 ? 'violet' : 'primary'}`}>
              <span className="field-label">{field.name}</span>
              <div className="markdown-desc">
                <Markdown remarkPlugins={[remarkBreaks]}>{field.value}</Markdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
