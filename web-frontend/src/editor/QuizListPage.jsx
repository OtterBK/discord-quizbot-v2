// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - 내 퀴즈 목록 + 생성 폼.
// 디스코드 UserQuizListUI(user-quiz-list-ui.ts)와 대응되는 화면. 카드 클릭 시 QuizDetailPage로 이동.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyQuizzes, createMyQuiz } from './EditorApi.js';

const EMPTY_FORM = { quiz_title: '', simple_description: '', description: '', thumbnail: '' };

export default function QuizListPage({ onSessionInvalid }) {
  const [quizzes, setQuizzes] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getMyQuizzes()
      .then(({ quizzes }) => setQuizzes(quizzes))
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const created = await createMyQuiz(form);
      setCreating(false);
      setForm(EMPTY_FORM);
      navigate(`/quiz/${created.quiz_id}`);
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({error})</div>;
  }

  if (quizzes === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  return (
    <div className="card">
      <div className="section-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-title">📑 보유한 퀴즈 목록</span>
        <button type="button" className="toolbar-cta" onClick={() => setCreating((v) => !v)}>
          {creating ? '취소' : '+ 새 퀴즈 만들기'}
        </button>
      </div>

      {creating && (
        <form className="section-block" onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <span className="field-label">퀴즈 제목 (4~40자)</span>
            <input
              className="text-field"
              value={form.quiz_title}
              onChange={(e) => setForm((f) => ({ ...f, quiz_title: e.target.value }))}
              placeholder="예시) 2023년 팝송 맞히기"
              minLength={4}
              maxLength={40}
              required
            />
          </div>
          <div>
            <span className="field-label">한줄 소개 (최대 60자, 선택)</span>
            <input
              className="text-field"
              value={form.simple_description}
              onChange={(e) => setForm((f) => ({ ...f, simple_description: e.target.value }))}
              placeholder="예시: 2023년에 새로 나온 팝송을 맞히는 퀴즈입니다."
              maxLength={60}
            />
          </div>
          <div>
            <span className="field-label">상세 설명 (최대 500자, 선택)</span>
            <textarea
              className="text-field"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={500}
            />
          </div>
          <div>
            <span className="field-label">썸네일 이미지 URL (선택)</span>
            <input
              className="text-field"
              value={form.thumbnail}
              onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
              placeholder="https://..."
              maxLength={500}
            />
          </div>
          {formError && <div className="error-banner">🔸 {formError}</div>}
          <button type="submit" className="cta-primary" disabled={submitting}>
            {submitting ? '생성 중...' : '퀴즈 생성'}
          </button>
        </form>
      )}

      <div className="grid-wrap">
        <div className="quiz-grid">
          {quizzes.length === 0 && (
            <div className="empty-hint">아직 제작하신 퀴즈가 없어요. 새로운 퀴즈를 만들어 보세요!</div>
          )}
          {quizzes.map((quiz) => (
            <button
              key={quiz.quiz_id}
              type="button"
              className="quiz-card"
              onClick={() => navigate(`/quiz/${quiz.quiz_id}`)}
            >
              <span
                className="card-thumb"
                style={quiz.thumbnail
                  ? { backgroundImage: `url(${quiz.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : undefined}
              >
                {!quiz.thumbnail && <span className="thumb-glyph">🎯</span>}
                {quiz.certified === true && <span className="thumb-badge verified">✓ 인증</span>}
              </span>
              <span className="card-body">
                <h3>{quiz.title}</h3>
                {quiz.simple_description && <span className="card-desc">{quiz.simple_description}</span>}
                <span className="tags">
                  <span className="mini-tag">{quiz.is_private ? '🔒 비공개' : '🌐 공개'}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
