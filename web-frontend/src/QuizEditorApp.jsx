// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) - 세션 부트스트랩 + 라우팅 진입점.
// 기존 App.jsx/api.js의 토큰 추출/마스킹/heartbeat 패턴을 그대로 재사용한다(같은 api.js, 신규 클라이언트
// 불필요 - GET /api/session/POST /api/session/heartbeat는 owner 세션에도 그대로 동작함).
// Phase 3부터 react-router-dom으로 목록(/)→상세(/quiz/:quizId) 라우트가 들어옴 - basename은 express가
// /editor, /editor/*를 전부 editor.html로 서빙하는 것과 맞춰(web_express_app.ts) '/editor'로 고정.
// Phase 4: 상세 화면 아래 계층으로 문제 편집(/quiz/:quizId/questions/new, /quiz/:quizId/questions/:questionId)
// 라우트 추가.

import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { token, getSession, heartbeat } from './api.js';
import ThemeToggle from './ThemeToggle.jsx';
import QuizListPage from './editor/QuizListPage.jsx';
import QuizDetailPage from './editor/QuizDetailPage.jsx';
import QuestionEditPage from './editor/QuestionEditPage.jsx';

export default function QuizEditorApp() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);

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

  // 세션이 만료/파기(GC, DM에서 재입력 등)되면 하트비트도 멈춘다 - 계속 돌리면 죽은 토큰으로
  // 60초마다 401만 반복해서 부를 뿐이라(App.jsx와 동일 관행).
  useEffect(() => {
    if (session === null || error !== null) return undefined;

    const interval = setInterval(() => {
      heartbeat().catch(handleSessionInvalid);
    }, 60000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, error]);

  if (error) {
    return (
      <div className="shell">
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          🔒 세션이 만료되었거나 잘못된 링크예요.
          <br />
          디스코드에서 [/퀴즈만들기] 명령어를 다시 입력해주세요.
        </div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="shell">
        <div className="empty-hint">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">🛠</div>
          <div className="brand-text">
            <h1>퀴즈 편집기</h1>
            <p>{session.owner_name ? `${session.owner_name} 님` : '편집 중'}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle />
        </div>
      </header>

      <BrowserRouter basename="/editor">
        <Routes>
          <Route path="/" element={<QuizListPage onSessionInvalid={handleSessionInvalid} />} />
          <Route path="/quiz/:quizId" element={<QuizDetailPage onSessionInvalid={handleSessionInvalid} />} />
          <Route path="/quiz/:quizId/questions/new" element={<QuestionEditPage onSessionInvalid={handleSessionInvalid} />} />
          <Route path="/quiz/:quizId/questions/:questionId" element={<QuestionEditPage onSessionInvalid={handleSessionInvalid} />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
