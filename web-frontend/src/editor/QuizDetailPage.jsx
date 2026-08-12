// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - 퀴즈 상세(메타데이터 수정+태그+
// 공개토글+삭제). 디스코드 UserQuizInfoUI(user-quiz-info.ui.ts)의 편집 모드와 대응되는 화면.
//
// 2026-08-11 피드백 반영: 우측에 "다른 사람들에게 이렇게 보여요" 미리보기 카드 추가 - 퀴즈 선택 웹
// 연동(UserQuizTab.jsx/OmakaseTab.jsx)이 이미 쓰고 있는 QuizDetailCard를 그대로 재사용하되, 저장된
// detail이 아니라 지금 입력 중인 form 값을 실시간으로 먹여서(썸네일 URL 등) 타이핑하는 즉시 반영되게
// 한다. 목록으로 돌아가는 명시적 "뒤로가기" 버튼도 breadcrumb 우측에 추가(기존엔 "내 퀴즈" 텍스트를
// 눌러야 하는 탐색기 스타일뿐이라 발견성이 낮았음).
//
// Phase 4: 문제 목록이 읽기 전용 placeholder에서 실제 추가/수정/삭제/복제 패널로 교체됨. "+ 새 문제
// 추가"/각 행 "복제"는 MAX_QUESTIONS_PER_QUIZ(50, SYSTEM_CONFIG는 백엔드 전용이라 프론트는 이미
// 글자수 제한(4/40/60/500)처럼 값만 미러링)에 도달하면 비활성화 - 서버의 400(max_questions_reached)이
// 최종 방어선. 복제는 question_id 오름차순 정렬상 항상 목록 맨 뒤에 새로 생기므로, 낙관적으로 특정
// 위치에 끼워넣지 않고 매번 getMyQuizDetail로 전체 재조회한다.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  getMyQuizDetail,
  updateMyQuiz,
  updateMyQuizTags,
  toggleMyQuizPublic,
  deleteMyQuiz,
  deleteMyQuestion,
  duplicateMyQuestion,
} from './EditorApi.js';
import QuizDetailCard from '../QuizDetailCard.jsx';
import { ANSWER_TYPE_LABEL, computeContentTags, ContentTagChips, truncate, youtubeThumbnailUrl } from './questionDisplay.jsx';

const MAX_QUESTIONS_PER_QUIZ = 50; //config/system_setting.js SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ 미러링

export default function QuizDetailPage({ onSessionInvalid }) {
  const { quizId } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const [activeTagValues, setActiveTagValues] = useState(new Set());
  const [publicError, setPublicError] = useState(null);
  const [togglingPublic, setTogglingPublic] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [confirmingDeleteQuestionId, setConfirmingDeleteQuestionId] = useState(null);
  const [questionActionError, setQuestionActionError] = useState(null);
  const [busyQuestionId, setBusyQuestionId] = useState(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getMyQuizDetail(quizId)
      .then((d) => {
        setDetail(d);
        setForm({
          quiz_title: d.title ?? '',
          simple_description: d.simple_description ?? '',
          description: d.description ?? '',
          thumbnail: d.thumbnail ?? '',
        });
        setActiveTagValues(new Set(d.tags.filter((t) => (d.tags_value & t.value) !== 0).map((t) => t.value)));
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  const handleSaveMetadata = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const updated = await updateMyQuiz(quizId, form);
      setDetail((d) => ({ ...d, ...updated }));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleTag = async (value) => {
    const next = new Set(activeTagValues);
    if (next.has(value)) next.delete(value); else next.add(value);
    setActiveTagValues(next);

    const tags_value = [...next].reduce((acc, v) => acc | v, 0);
    try {
      await updateMyQuizTags(quizId, tags_value);
      setDetail((d) => ({ ...d, tags_value }));
    } catch (err) {
      handleApiError(err);
    }
  };

  const handleTogglePublic = async () => {
    setTogglingPublic(true);
    setPublicError(null);
    try {
      const { is_private } = await toggleMyQuizPublic(quizId);
      setDetail((d) => ({ ...d, is_private }));
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      if (err.status === 400) {
        setPublicError('태그를 1개 이상 선택해주세요.');
      } else {
        setPublicError(err.message);
      }
    } finally {
      setTogglingPublic(false);
    }
  };

  const handleDelete = async () => {
    if (confirmingDelete === false) {
      setConfirmingDelete(true);
      return;
    }

    setDeleting(true);
    try {
      await deleteMyQuiz(quizId);
      navigate('/');
    } catch (err) {
      handleApiError(err);
      setDeleting(false);
    }
  };

  const handleDeleteQuestion = async (question_id) => {
    if (confirmingDeleteQuestionId !== question_id) {
      setConfirmingDeleteQuestionId(question_id);
      return;
    }

    setConfirmingDeleteQuestionId(null);
    setQuestionActionError(null);
    setBusyQuestionId(question_id);
    try {
      await deleteMyQuestion(quizId, question_id);
      setDetail((d) => ({ ...d, questions: d.questions.filter((q) => q.question_id !== question_id) }));
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      setQuestionActionError(err.message);
    } finally {
      setBusyQuestionId(null);
    }
  };

  const handleDuplicateQuestion = async (question_id) => {
    setQuestionActionError(null);
    setBusyQuestionId(question_id);
    try {
      await duplicateMyQuestion(quizId, question_id);
      const refreshed = await getMyQuizDetail(quizId); //복제된 문제는 항상 목록 맨 뒤에 위치하므로 전체 재조회
      setDetail((d) => ({ ...d, questions: refreshed.questions }));
    } catch (err) {
      if (err.status === 401) {
        onSessionInvalid();
        return;
      }
      setQuestionActionError(err.message);
    } finally {
      setBusyQuestionId(null);
    }
  };

  const tagNameByValue = useMemo(
    () => (detail ? Object.fromEntries(detail.tags.map((t) => [t.value, t.name])) : {}),
    [detail],
  );

  // 저장된 detail이 아니라 지금 입력 중인 form/activeTagValues를 얹어서 - 타이핑하는 즉시(저장 전에도)
  // "다른 사람들에게 이렇게 보여요" 카드가 갱신되게 한다.
  const livePreview = useMemo(() => {
    if (detail === null || form === null) return null;

    return {
      ...detail,
      title: form.quiz_title,
      simple_description: form.simple_description,
      description: form.description,
      thumbnail: form.thumbnail,
      tags_value: [...activeTagValues].reduce((acc, v) => acc | v, 0),
      question_count: detail.questions.length,
    };
  }, [detail, form, activeTagValues]);

  if (error) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({error})</div>;
  }

  if (detail === null || form === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  return (
    <div className="panel active">
      <div className="card">
        <div className="breadcrumb section-block" style={{ justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" onClick={() => navigate('/')}>📑 내 퀴즈</button>
            <span className="sep">/</span>
            <button type="button" className="current">{detail.title}</button>
          </span>
          <button type="button" className="icon-btn" title="내 퀴즈 목록으로 돌아가기" onClick={() => navigate('/')}>←</button>
        </div>

        <div className="section-block">
          <span className="section-title">
            🏷 상태: {detail.is_private ? '🔒 비공개' : '🌐 공개'}
          </span>
          <button type="button" className="toolbar-cta" disabled={togglingPublic} onClick={handleTogglePublic}>
            {togglingPublic ? '전환 중...' : detail.is_private ? '🌐 공개로 전환' : '🔒 비공개로 전환'}
          </button>
          {publicError && <div className="error-banner">🔸 {publicError}</div>}
        </div>

        <form className="section-block" onSubmit={handleSaveMetadata} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="section-title">퀴즈 정보</span>
          <div>
            <span className="field-label">퀴즈 제목 (4~40자)</span>
            <input
              className="text-field"
              value={form.quiz_title}
              onChange={(e) => setForm((f) => ({ ...f, quiz_title: e.target.value }))}
              minLength={4}
              maxLength={40}
              required
            />
          </div>
          <div>
            <span className="field-label">한줄 소개 (최대 60자)</span>
            <input
              className="text-field"
              value={form.simple_description}
              onChange={(e) => setForm((f) => ({ ...f, simple_description: e.target.value }))}
              maxLength={60}
            />
          </div>
          <div>
            <span className="field-label">상세 설명 (최대 500자)</span>
            <textarea
              className="text-field"
              rows={4}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={500}
            />
          </div>
          <div>
            <span className="field-label">썸네일 이미지 URL</span>
            <input
              className="text-field"
              value={form.thumbnail}
              onChange={(e) => setForm((f) => ({ ...f, thumbnail: e.target.value }))}
              placeholder="https://..."
              maxLength={500}
            />
            <div className="hint-text">우측 미리보기 카드에 바로 반영돼요.</div>
          </div>
          {formError && <div className="error-banner">🔸 {formError}</div>}
          <button type="submit" className="cta-primary" disabled={saving}>
            {savedFlash ? '✓ 저장됨' : saving ? '저장 중...' : '퀴즈 정보 저장'}
          </button>
        </form>

        <div className="section-block">
          <span className="section-title">🏷 퀴즈 태그</span>
          <div className="chip-row">
            {detail.tags.map((t) => (
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
        </div>

        <div className="section-block">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
            <span className="section-title" style={{ marginBottom: 0 }}>📦 문제 목록 ({detail.questions.length}/{MAX_QUESTIONS_PER_QUIZ}개)</span>
            <button
              type="button"
              className="toolbar-cta"
              disabled={detail.questions.length >= MAX_QUESTIONS_PER_QUIZ}
              onClick={() => navigate(`/quiz/${quizId}/questions/new`)}
            >
              + 새 문제 추가
            </button>
          </div>

          {questionActionError && <div className="error-banner">🔸 {questionActionError}</div>}

          {detail.questions.length === 0 && (
            <div className="empty-hint">아직 만든 문제가 없어요. 새 문제를 추가해 보세요!</div>
          )}

          <div className="question-rows" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.questions.map((q, i) => {
              const tags = computeContentTags(q.data);
              // 서버 검증 실패(URL 형식 오류) 또는 "기본 정보"(문제 텍스트/이미지/오디오)가 전부 비어서
              // 플레이어에게 보여줄 문제 자체가 없는 경우(2026-08-12 피드백 - "문제 태그에 붙일 게 하나도
              // 없으면 검증 실패", 힌트/정답 공개 내용 유무와는 무관) - 둘 다 저장은 되지만 눈에 띄게 경고.
              const has_validation_error = q.validation.is_valid_question_audio_url === false
                || q.validation.is_valid_question_image_url === false
                || q.validation.is_valid_answer_audio_url === false
                || q.validation.is_valid_answer_image_url === false;
              const has_no_content = tags.basic.length === 0;
              const has_error = has_validation_error || has_no_content;

              const busy = busyQuestionId === q.question_id;
              const question_text = (q.data.question_text ?? '').trim();
              const image_thumb = (q.data.question_image_url ?? '').trim() || null;
              const audio_thumb = youtubeThumbnailUrl(q.data.question_audio_url);

              return (
                // 행 전체 클릭으로도 편집 화면 이동 가능(기존 동작 유지) + 아래 명시적 "수정" 버튼도 제공
                <div
                  key={q.question_id}
                  className={`question-row${has_error ? ' has-error' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/quiz/${quizId}/questions/${q.question_id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/quiz/${quizId}/questions/${q.question_id}`); }}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="q-index">{i + 1}</span>
                  <div className="q-body">
                    <div className={`q-text${question_text ? '' : ' empty'}`}>
                      {question_text || '(문제 텍스트 없음)'}{has_error && ' ⚠️'}
                    </div>
                    <div className="q-summary">
                      <span className="q-summary-answer">🗨 {truncate(q.data.answers, 40) || '(정답 미입력)'}</span>
                      {image_thumb && <img className="q-mini-thumb" src={image_thumb} alt="문제 이미지" />}
                      {audio_thumb && <img className="q-mini-thumb" src={audio_thumb} alt="문제 오디오" />}
                    </div>
                    <div className="q-flags">
                      <span className="chip type">{ANSWER_TYPE_LABEL[q.data.answer_type] ?? ANSWER_TYPE_LABEL[1]}</span>
                      <ContentTagChips tags={tags} />
                    </div>
                  </div>
                  <span className="q-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn"
                      title="수정"
                      disabled={busy}
                      onClick={() => navigate(`/quiz/${quizId}/questions/${q.question_id}`)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="복제"
                      disabled={busy || detail.questions.length >= MAX_QUESTIONS_PER_QUIZ}
                      onClick={() => handleDuplicateQuestion(q.question_id)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="삭제"
                      disabled={busy}
                      onClick={() => handleDeleteQuestion(q.question_id)}
                    >
                      {confirmingDeleteQuestionId === q.question_id ? '⚠️' : '🗑'}
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="section-block">
          <button
            type="button"
            className="cta-primary variant-danger"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? '삭제 중...' : confirmingDelete ? '⚠️ 정말 삭제하려면 한 번 더 눌러주세요' : '🗑 퀴즈 삭제'}
          </button>
        </div>
      </div>

      <div className="detail-col">
        <div className="card detail-card">
          <span className="field-label">👀 다른 사람들에게 이렇게 보여요</span>
          {livePreview && <QuizDetailCard detail={livePreview} tagNameByValue={tagNameByValue} />}
        </div>
      </div>
    </div>
  );
}
