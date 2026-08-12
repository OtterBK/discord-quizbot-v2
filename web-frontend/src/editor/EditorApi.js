// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 3 - /api/my-quizzes 클라이언트.
// 토큰 추출/마스킹은 ../api.js의 싱글턴 토큰을 그대로 재사용한다(같은 모듈이라 최초 1번만 실행됨).

import { token } from '../api.js';

class ApiError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`/api/my-quizzes${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body.error || body.reason || `HTTP ${res.status}`);
  }

  return body;
}

export const getMyQuizzes = () => apiFetch('');
export const createMyQuiz = (metadata) => apiFetch('', { method: 'POST', body: JSON.stringify(metadata) });
export const getMyQuizDetail = (quizId) => apiFetch(`/${quizId}`);
export const updateMyQuiz = (quizId, metadata) => apiFetch(`/${quizId}`, { method: 'PUT', body: JSON.stringify(metadata) });
export const updateMyQuizTags = (quizId, tagsValue) =>
  apiFetch(`/${quizId}/tags`, { method: 'PUT', body: JSON.stringify({ tags_value: tagsValue }) });
export const toggleMyQuizPublic = (quizId) => apiFetch(`/${quizId}/toggle-public`, { method: 'POST' });
export const deleteMyQuiz = (quizId) => apiFetch(`/${quizId}`, { method: 'DELETE' });

// Phase 4 - 문제(question) CRUD
export const createMyQuestion = (quizId, question) =>
  apiFetch(`/${quizId}/questions`, { method: 'POST', body: JSON.stringify(question) });
export const updateMyQuestion = (quizId, questionId, question) =>
  apiFetch(`/${quizId}/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(question) });
export const deleteMyQuestion = (quizId, questionId) =>
  apiFetch(`/${quizId}/questions/${questionId}`, { method: 'DELETE' });
export const duplicateMyQuestion = (quizId, questionId) =>
  apiFetch(`/${quizId}/questions/${questionId}/duplicate`, { method: 'POST' });
