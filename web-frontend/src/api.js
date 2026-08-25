// 퀴즈 선택 웹 연동(docs/WEB_INTEGRATION_PLAN.md) API 클라이언트.
// URL 쿼리로 받은 토큰은 즉시 history.replaceState로 마스킹하고, 이후 모든 요청은
// Authorization: Bearer <token> 헤더로만 전달한다(주소창/브라우저 히스토리에 토큰이 남지 않게).

const TOKEN_STORAGE_KEY = 'quizbot_web_token';

function extractAndMaskToken() {
  const url = new URL(window.location.href);
  const token_from_query = url.searchParams.get('token');

  if (token_from_query) {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token_from_query);
    url.searchParams.delete('token');
    window.history.replaceState({}, '', url.toString());
  }

  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export const token = extractAndMaskToken();

class ApiError extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
  }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
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

export const getSession = () => apiFetch('/api/session');
export const heartbeat = () => apiFetch('/api/session/heartbeat', { method: 'POST' });
export const getDevQuizzes = () => apiFetch('/api/dev-quizzes');
export const getUserQuizzes = () => apiFetch('/api/user-quizzes');
export const getUserQuizDetail = (quiz_id) => apiFetch(`/api/user-quizzes/${quiz_id}`);
export const getOmakaseTags = () => apiFetch('/api/omakase-tags');
export const selectQuiz = (selection) =>
  apiFetch('/api/session/select', { method: 'POST', body: JSON.stringify({ selection }) });
// mode: 'dev' | 'user' - 세션 생성 시 고정된 mode 대신 요청마다 어느 탭에서 보낸 건지 실어보낸다
// (2026-08-08 Phase 2, WEB_INTEGRATION_PLAN.md "8. 투트랙 진입점 분리" 참고).
export const confirmSelection = (mode, selection, selected_question_count) =>
  apiFetch('/api/session/confirm', {
    method: 'POST',
    body: JSON.stringify({ mode, selection, selected_question_count }),
  });
// 멀티플레이 웹 연동(Phase 4) - 대기실 목록은 마스터가 직접 서빙(별도 select 불필요, 확정만 함).
export const getMultiplayerLobbies = () => apiFetch('/api/multiplayer-lobbies');
// action: 'join'(selection: {session_id}) | 'create'(selection: 랜덤 퀴즈와 동일 shape + title).
// 확정 응답은 항상 success:true(마스터는 브로드캐스트만 하고 실제 음성채널 체크/생성은 그 길드를 담당하는
// 클러스터가 비동기로 처리) - 실제 성공/실패는 getMultiplayerResult()를 폴링해서 확인해야 한다.
export const confirmMultiplayer = (action, selection, selected_question_count) =>
  apiFetch('/api/session/confirm', {
    method: 'POST',
    body: JSON.stringify({ mode: 'multiplayer', action, selection, selected_question_count }),
  });
// confirmMultiplayer 직후의 실제 처리 결과(1회성 - 읽으면 서버에서 즉시 비워짐) - { result: null | {action, success, reason} }
export const getMultiplayerResult = () => apiFetch('/api/multiplayer-result');

// 랜덤 퀴즈 프리셋(docs/plans/RANDOM_QUIZ_PRESET_PLAN.md) - "직접 담기" 모드의 퀴즈함(quiz_id 목록)을
// 유저 단위로 저장/재적용. 옵션은 저장하지 않는다.
export const getRandomQuizPresets = () => apiFetch('/api/random-quiz-presets');
export const createRandomQuizPreset = (preset_name, quiz_id_list) =>
  apiFetch('/api/random-quiz-presets', { method: 'POST', body: JSON.stringify({ preset_name, quiz_id_list }) });
export const deleteRandomQuizPreset = (preset_id) =>
  apiFetch(`/api/random-quiz-presets/${preset_id}`, { method: 'DELETE' });

// 프리셋 관리 웹 페이지(/프리셋관리 명령어, docs/plans/RANDOM_QUIZ_PRESET_PLAN.md 후속) 전용 -
// 이름 변경/항목 통째 교체(추가 겸용)/항목 하나 제거. 저장/불러오기 자체는 기존 3개 함수를 그대로 씀.
export const renameRandomQuizPreset = (preset_id, preset_name) =>
  apiFetch(`/api/random-quiz-presets/${preset_id}`, { method: 'PUT', body: JSON.stringify({ preset_name }) });
export const replaceRandomQuizPresetItems = (preset_id, quiz_id_list) =>
  apiFetch(`/api/random-quiz-presets/${preset_id}/items`, { method: 'PUT', body: JSON.stringify({ quiz_id_list }) });
export const removeRandomQuizPresetItem = (preset_id, quiz_id) =>
  apiFetch(`/api/random-quiz-presets/${preset_id}/items/${quiz_id}`, { method: 'DELETE' });

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 안내 페이지/공지사항/서버 설정.
export const getQuizToolGuide = () => apiFetch('/api/quiz-tool-guide');
export const getNotices = () => apiFetch('/api/notices');
export const getNoticeDetail = (name) => apiFetch(`/api/notices/${encodeURIComponent(name)}`);
export const getServerOption = () => apiFetch('/api/server-option');
export const updateServerOption = (fields) =>
  apiFetch('/api/server-option', { method: 'PUT', body: JSON.stringify({ fields }) });

// 봇 지원센터 링크(2026-08-15 신설) - SYSTEM_CONFIG.SUPPORT_SERVER_URL을 그대로 내려줌.
export const getSupportLink = () => apiFetch('/api/support-link');

// 스코어보드(순위표, 2026-08-15 신설) - seasonId를 안 주면 현재 시즌.
export const getScoreboard = (seasonId) =>
  apiFetch(seasonId === undefined ? '/api/scoreboard' : `/api/scoreboard?season_id=${seasonId}`);
export const getScoreboardSeasons = () => apiFetch('/api/scoreboard/seasons');
