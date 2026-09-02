// 퀴즈 만들기 웹 연동(docs/WEB_QUIZ_CREATION_PLAN.md) Phase 4 - 문제 편집 폼. 디스코드의 3개 모달
// (modal_question_info/modal_question_additional_info/modal_question_answering_info, 전부
// UserQuestionInfoUI)을 탭 3개로 나눈 단일 폼으로 합쳤다 - 저장은 한 번에(REST POST/PUT).
//
// 문제 단건 조회 API가 따로 없어(REST 스펙에 4개 CRUD만 있음), 수정 모드에서도 getMyQuizDetail로
// 퀴즈 상세(문제 목록 포함)를 불러와 questionId로 찾는다 - QuizDetailPage.jsx와 동일한 패턴. 같은
// 응답의 questions 배열 순서(question_id 오름차순)를 이전/다음 문제 이동(2026-08-12 피드백)에도 쓴다.
//
// 이미지는 <img src>로 바로 표시(디스코드의 sendDelayedUI 강제 재전송 불필요 - 설계 결정 6번).
// 오디오는 2026-08-12 피드백 반영 - 새 탭 링크 대신 지정한 시작 지점부터 바로 재생 가능한 유튜브 인라인
// 임베드 플레이어(questionDisplay.jsx의 YoutubeEmbed)를 그 자리에 띄운다. cdn.discordapp.com 경고는
// quiz_editor_validation.ts(백엔드 전용 CJS 모듈이라 이 독립 Vite/ESM 프로젝트에서 직접 import 불가)의
// isDiscordCdnLink와 동일한 한 줄 로직을 questionDisplay.jsx에 복제해 타이핑 중 즉시 보여준다. URL
// 형식 유효성(is_valid_*)은 수정 모드에서 로드된 서버 스냅샷 값만 배지로 보여준다(저장 시점 기준이라
// 실시간 재검증은 안 함).
//
// 2026-08-12 피드백 반영: 우측에 "실제 디스코드에선 이렇게 보여요" 미리보기 패널 추가(Phase 0
// 목업에서 승인됐던 설계인데 Phase 4 최초 구현에서 누락됐던 부분) - 활성 탭(기본정보/힌트설정/
// 정답공개)에 따라 문제 출제 중/힌트 공개/정답 공개 3가지 상태를 실시간으로 전환해 보여준다.
//
// 2026-08-12 추가 피드백 반영(같은 세션): (1) 정답 유형을 주관식→OX→주관식으로 오가도 각 유형에 입력해둔
// 값을 잃지 않도록 유형별 draft를 별도로 들고 있음. (2) 저장해도 목록으로 안 돌아가고 이 화면에 계속
// 머무름("저장됨" 플래시로 피드백) - 새 문제는 저장 성공 시 URL만 조용히 /questions/:questionId로
// 바뀌어(replace) 이후 저장부터는 PUT으로 전환됨. (3) breadcrumb에 몇 번째 문제인지 표시. (4) 저장 버튼
// 옆에 이전/다음 문제 버튼 추가(양 끝에서는 비활성화), 저장 버튼만 다른 색(toolbar-cta, 파란색)으로
// 구분하고 취소/이전/다음은 중립색(btn-secondary) - .cta-primary는 width:100% 고정이라 가로 버튼
// 로우에 넣으면 레이아웃이 깨져서(기존에도 있던 알려진 함정) 안 씀.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getMyQuizDetail, createMyQuestion, updateMyQuestion } from './EditorApi.js';
import {
  ANSWER_TYPE,
  isDiscordCdnLink,
  computeContentTags,
  ContentTagChips,
  YoutubeEmbed,
  DiscordQuestionPreview,
  DiscordHintPreview,
  DiscordAnswerPreview,
} from './questionDisplay.jsx';

const MAX_QUESTIONS_PER_QUIZ = 50; //config/system_setting.js SYSTEM_CONFIG.MAX_QUESTIONS_PER_QUIZ 미러링(QuizDetailPage.jsx와 동일 관례)

const composeRangeRow = (start, end) =>
{
  if (start === '' || start === null || start === undefined) return '';
  return end === '' || end === null || end === undefined ? `${start}` : `${start}~${end}`;
};

const TAB_TO_PREVIEW_CAPTION = {
  basic: '① 기본 정보 설정 탭 미리보기 · 진행바는 시간 경과에 따라 채워지는 예시예요(질문/오디오 재생 진행률).',
  extra: '② 힌트 설정 탭 미리보기 · 힌트를 안 정하면 정답 기반 기본 힌트가 자동 생성돼요.',
  answering: '③ 정답 공개 설정 탭 미리보기 · 정답자/점수판은 예시 데이터예요.',
};

const EMPTY_FORM = {
  answer_type: ANSWER_TYPE.SHORT_ANSWER,
  answers: '',
  question_text: '',
  question_audio_url: '',
  audio_start: '',
  audio_end: '',
  question_audio_repeat: '',
  question_image_url: '',
  hint: '',
  hint_image_url: '',
  use_answer_timer: false,
  answer_audio_url: '',
  answer_audio_start: '',
  answer_audio_end: '',
  answer_image_url: '',
  answer_text: '',
};

// 문제 CRUD 응답(question.data)을 폼 state 모양으로 변환 - 최초 로드/저장 직후 재동기화 양쪽에서 공유.
const mapQuestionDataToForm = (data) => ({
  answer_type: data.answer_type ?? ANSWER_TYPE.SHORT_ANSWER,
  answers: data.answers ?? '',
  question_text: data.question_text ?? '',
  question_audio_url: data.question_audio_url ?? '',
  audio_start: data.audio_start ?? '',
  audio_end: data.audio_end ?? '',
  question_audio_repeat: data.question_audio_repeat ?? '',
  question_image_url: data.question_image_url ?? '',
  hint: data.hint ?? '',
  hint_image_url: data.hint_image_url ?? '',
  use_answer_timer: data.use_answer_timer === true,
  answer_audio_url: data.answer_audio_url ?? '',
  answer_audio_start: data.answer_audio_start ?? '',
  answer_audio_end: data.answer_audio_end ?? '',
  answer_image_url: data.answer_image_url ?? '',
  answer_text: data.answer_text ?? '',
});

export default function QuestionEditPage({ onSessionInvalid }) {
  const { quizId, questionId } = useParams();
  const navigate = useNavigate();
  const isEditMode = questionId !== undefined;

  const [quizTitle, setQuizTitle] = useState(null);
  // 같은 퀴즈 안의 문제 question_id 목록(question_id 오름차순, GET 응답 순서 그대로) - 미리보기 푸터의
  // "문제 N / 전체" 계산과 이전/다음 문제 이동에 같이 씀.
  const [questionOrder, setQuestionOrder] = useState(null);
  const [serverValidation, setServerValidation] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(isEditMode ? null : EMPTY_FORM);
  // 정답 유형별로 마지막에 입력해둔 값을 따로 보관 - 주관식→OX→주관식으로 되돌아와도 값이 안 사라지게
  const [answerDrafts, setAnswerDrafts] = useState({});
  const [activeTab, setActiveTab] = useState('basic');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setLoadError(err.message);
  };

  useEffect(() => {
    getMyQuizDetail(quizId)
      .then((detail) => {
        setQuizTitle(detail.title);
        setQuestionOrder(detail.questions.map((q) => q.question_id));

        if (isEditMode === false) {
          //"이전 문제"/"다음 문제"와 같은 방식으로 같은 컴포넌트 인스턴스가 재사용되며 이 route로
          //넘어오는 경우(예: 저장 후 "+ 새 문제 추가") 이전 문제의 폼 값이 남아있지 않도록 초기화
          setForm(EMPTY_FORM);
          setAnswerDrafts({});
          setServerValidation(null);
          setLoadError(null);
          return;
        }

        const question = detail.questions.find((q) => String(q.question_id) === questionId);
        if (question === undefined) {
          setLoadError('question_not_found');
          return;
        }

        setServerValidation(question.validation);
        const loaded_form = mapQuestionDataToForm(question.data);
        setForm(loaded_form);
        setAnswerDrafts({ [loaded_form.answer_type]: loaded_form.answers });
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, questionId]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const selectAnswerType = (answer_type) => {
    if (form.answer_type === answer_type) return;
    setAnswerDrafts((drafts) => ({ ...drafts, [form.answer_type]: form.answers })); //바뀌기 전 유형에 입력한 값 보관
    setForm((f) => ({ ...f, answer_type, answers: answerDrafts[answer_type] ?? '' })); //그 유형에 이미 보관해둔 값 복구
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);

    // OX/객관식은 버튼 클릭으로만 값을 채우는 UI라 <input required>가 못 잡음(주관식은 잡힘) - 서버의
    // invalid_answers를 그대로 노출하지 않기 위해 여기서 먼저 체크.
    if (form.answers === '') {
      setFormError('정답을 선택하거나 입력해주세요.');
      return;
    }

    setSaving(true);

    const payload = {
      answer_type: form.answer_type,
      answers: form.answers,
      question_text: form.question_text,
      question_audio_url: form.question_audio_url,
      audio_range_row: composeRangeRow(form.audio_start, form.audio_end),
      question_audio_repeat: form.question_audio_repeat,
      question_image_url: form.question_image_url,
      hint: form.hint,
      hint_image_url: form.hint_image_url,
      use_answer_timer: form.use_answer_timer,
      answer_audio_url: form.answer_audio_url,
      answer_audio_range_row: composeRangeRow(form.answer_audio_start, form.answer_audio_end),
      answer_image_url: form.answer_image_url,
      answer_text: form.answer_text,
    };

    try {
      const saved = isEditMode
        ? await updateMyQuestion(quizId, questionId, payload)
        : await createMyQuestion(quizId, payload);

      const synced_form = mapQuestionDataToForm(saved.data);
      setForm(synced_form);
      setAnswerDrafts((drafts) => ({ ...drafts, [synced_form.answer_type]: synced_form.answers }));
      setServerValidation(saved.validation);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);

      if (isEditMode === false) {
        //새 문제가 저장되면 URL만 조용히 갈아끼워 이후 저장부터는 PUT으로 전환(화면 이동 없음 - 습관적으로
        //자주 저장하는 사용자를 위해 목록으로 튕겨나가지 않게 해달라는 피드백)
        navigate(`/quiz/${quizId}/questions/${saved.question_id}`, { replace: true });
      }
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

  if (loadError) {
    return <div className="empty-hint">🔸 오류가 발생했어요. ({loadError})</div>;
  }

  if (form === null || quizTitle === null || questionOrder === null) {
    return <div className="empty-hint">불러오는 중...</div>;
  }

  const total = isEditMode ? questionOrder.length : questionOrder.length + 1;
  const index = isEditMode ? questionOrder.indexOf(Number(questionId)) + 1 : questionOrder.length + 1;
  const prevQuestionId = index > 1 ? questionOrder[index - 2] : null;
  const nextQuestionId = index < total ? questionOrder[index] : null;

  return (
    <div className="panel active">
      <div className="card">
        <div className="breadcrumb section-block" style={{ justifyContent: 'space-between' }}>
          <span className="breadcrumb-trail">
            <button type="button" onClick={() => navigate('/')}>📑 내 퀴즈</button>
            <span className="sep">/</span>
            <button type="button" onClick={() => navigate(`/quiz/${quizId}`)}>{quizTitle}</button>
            <span className="sep">/</span>
            <button type="button" className="current">{isEditMode ? '문제 수정' : '새 문제 추가'}</button>
            <span className="q-position-chip">{isEditMode ? `${index}/${total}` : `${index}번째로 추가`}</span>
          </span>
          <button type="button" className="icon-btn" title="퀴즈 상세로 돌아가기" onClick={() => navigate(`/quiz/${quizId}`)}>←</button>
        </div>

        <form onSubmit={handleSave}>
          <div className="section-block chip-row" style={{ paddingBottom: 10 }}>
            <ContentTagChips tags={computeContentTags(form)} />
          </div>

          <div className="segmented-tabrail section-block" style={{ paddingTop: 0, paddingBottom: 0 }}>
            <button type="button" className={activeTab === 'basic' ? 'active' : ''} onClick={() => setActiveTab('basic')}>① 기본 정보</button>
            <button type="button" className={activeTab === 'extra' ? 'active' : ''} onClick={() => setActiveTab('extra')}>② 힌트 설정</button>
            <button type="button" className={activeTab === 'answering' ? 'active' : ''} onClick={() => setActiveTab('answering')}>③ 정답 공개 설정</button>
          </div>

          {activeTab === 'basic' && (
            <div className="section-block" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span className="field-label">정답 유형</span>
                <div className="mode-switch">
                  <button type="button" className={form.answer_type === ANSWER_TYPE.SHORT_ANSWER ? 'active' : ''} onClick={() => selectAnswerType(ANSWER_TYPE.SHORT_ANSWER)}>주관식</button>
                  <button type="button" className={form.answer_type === ANSWER_TYPE.OX ? 'active' : ''} onClick={() => selectAnswerType(ANSWER_TYPE.OX)}>O/X 선택</button>
                  <button type="button" className={form.answer_type === ANSWER_TYPE.MULTIPLE_CHOICE ? 'active' : ''} onClick={() => selectAnswerType(ANSWER_TYPE.MULTIPLE_CHOICE)}>객관식 (1~5)</button>
                </div>
              </div>

              {form.answer_type === ANSWER_TYPE.SHORT_ANSWER && (
                <div>
                  <span className="field-label">주관식 정답 (여러 개면 쉼표로 구분, 필수)</span>
                  <input className="text-field" value={form.answers} onChange={(e) => setField('answers', e.target.value)} maxLength={100} placeholder="카트라이더, 카트, kartrider" required />
                </div>
              )}
              {form.answer_type === ANSWER_TYPE.OX && (
                <div>
                  <span className="field-label">정답 선택 (필수)</span>
                  <div className="chip-row">
                    <button type="button" className={`tag-chip${form.answers === 'O' ? ' active' : ''}`} onClick={() => setField('answers', 'O')}>⭕ O</button>
                    <button type="button" className={`tag-chip${form.answers === 'X' ? ' active' : ''}`} onClick={() => setField('answers', 'X')}>❌ X</button>
                  </div>
                </div>
              )}
              {form.answer_type === ANSWER_TYPE.MULTIPLE_CHOICE && (
                <div>
                  <span className="field-label">정답 선택 (필수)</span>
                  <div className="chip-row">
                    {['1', '2', '3', '4', '5'].map((n) => (
                      <button key={n} type="button" className={`tag-chip${form.answers === n ? ' active' : ''}`} onClick={() => setField('answers', n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="field-label">문제와 함께 표시할 텍스트</span>
                <textarea className="text-field" rows={3} value={form.question_text} onChange={(e) => setField('question_text', e.target.value)} maxLength={500} placeholder="자유롭게 텍스트를 입력해주세요." />
              </div>

              <div>
                <span className="field-label">문제 오디오 URL (선택, 유튜브 · 20분 이하 영상만 가능)</span>
                <input className="text-field" value={form.question_audio_url} onChange={(e) => setField('question_audio_url', e.target.value)} maxLength={500} placeholder="https://youtu.be/... [생략 시 10초 타이머 BGM]" />
                {isEditMode && serverValidation?.is_valid_question_audio_url === false && (
                  <div className="error-banner">❗ 저장된 오디오 URL이 사용 불가능한 형식이에요.</div>
                )}
                <div style={{ marginTop: form.question_audio_url ? 8 : 0 }}>
                  <YoutubeEmbed url={form.question_audio_url} start={form.audio_start} label="오디오 미리듣기" />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <span className="field-label">재생 시작(초)</span>
                  <input className="text-field" type="number" min={0} value={form.audio_start} onChange={(e) => setField('audio_start', e.target.value)} placeholder="예시: 40" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="field-label">재생 끝(초)</span>
                  <input className="text-field" type="number" min={0} value={form.audio_end} onChange={(e) => setField('audio_end', e.target.value)} placeholder="예시: 80" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="field-label">반복 재생 (최대 5회)</span>
                  <input className="text-field" type="number" min={1} max={5} value={form.question_audio_repeat} onChange={(e) => setField('question_audio_repeat', e.target.value)} placeholder="1" />
                </div>
              </div>
              <div className="hint-text">생략하면 매번 무작위 구간이 재생돼요. 한 번에 최대 60초, 반복 재생을 포함해도 최대 70초까지만 재생돼요.</div>

              <div>
                <span className="field-label">문제 이미지 URL (선택, WebP 불가)</span>
                <input className="text-field" value={form.question_image_url} onChange={(e) => setField('question_image_url', e.target.value)} maxLength={500} placeholder="https://..." />
                {isEditMode && serverValidation?.is_valid_question_image_url === false && (
                  <div className="error-banner">❗ 저장된 이미지 URL이 사용 불가능한 형식이에요.</div>
                )}
                {isDiscordCdnLink(form.question_image_url) && (
                  <div className="error-banner">❗ 디스코드에 업로드한 이미지 URL 같아요. 일정 시간이 지나면 사라져요.</div>
                )}
                {form.question_image_url && <img src={form.question_image_url} alt="문제 이미지 미리보기" style={{ maxWidth: '100%', maxHeight: 160, marginTop: 8, borderRadius: 10 }} />}
              </div>
            </div>
          )}

          {activeTab === 'extra' && (
            <div className="section-block" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span className="field-label">힌트 텍스트 (선택)</span>
                <input className="text-field" value={form.hint} onChange={(e) => setField('hint', e.target.value)} maxLength={500} placeholder="예시: 한때 유행했던 추억의 레이싱 게임!" />
                <div className="hint-text">비워두면 정답 일부를 가린 기본 힌트가 자동으로 사용돼요.</div>
              </div>
              <div>
                <span className="field-label">힌트 이미지 URL (선택, WebP 불가)</span>
                <input className="text-field" value={form.hint_image_url} onChange={(e) => setField('hint_image_url', e.target.value)} maxLength={500} placeholder="https://..." />
                {isEditMode && serverValidation?.is_valid_hint_image_url === false && (
                  <div className="error-banner">❗ 저장된 이미지 URL이 사용 불가능한 형식이에요.</div>
                )}
                {isDiscordCdnLink(form.hint_image_url) && (
                  <div className="error-banner">❗ 디스코드에 업로드한 이미지 URL 같아요. 일정 시간이 지나면 사라져요.</div>
                )}
                {form.hint_image_url && <img src={form.hint_image_url} alt="힌트 이미지 미리보기" style={{ maxWidth: '100%', maxHeight: 160, marginTop: 8, borderRadius: 10 }} />}
              </div>
              <label className={`switch-field${form.use_answer_timer ? ' on' : ''}`} style={{ width: 'fit-content' }}>
                <input type="checkbox" checked={form.use_answer_timer} onChange={(e) => setField('use_answer_timer', e.target.checked)} style={{ display: 'none' }} />
                <span className="track" />
                문제 제출 후 정답 맞추기까지 여유 시간 추가
              </label>
            </div>
          )}

          {activeTab === 'answering' && (
            <div className="section-block" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <span className="field-label">정답 공개 오디오 URL (선택, 20분 이하 영상만 가능)</span>
                <input className="text-field" value={form.answer_audio_url} onChange={(e) => setField('answer_audio_url', e.target.value)} maxLength={500} placeholder="https://youtu.be/... [생략 가능]" />
                {isEditMode && serverValidation?.is_valid_answer_audio_url === false && (
                  <div className="error-banner">❗ 저장된 오디오 URL이 사용 불가능한 형식이에요.</div>
                )}
                <div style={{ marginTop: form.answer_audio_url ? 8 : 0 }}>
                  <YoutubeEmbed url={form.answer_audio_url} start={form.answer_audio_start} label="정답 오디오 미리듣기" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <span className="field-label">재생 시작(초)</span>
                  <input className="text-field" type="number" min={0} value={form.answer_audio_start} onChange={(e) => setField('answer_audio_start', e.target.value)} placeholder="예시: 40" />
                </div>
                <div style={{ flex: 1 }}>
                  <span className="field-label">재생 끝(초)</span>
                  <input className="text-field" type="number" min={0} value={form.answer_audio_end} onChange={(e) => setField('answer_audio_end', e.target.value)} placeholder="예시: 50" />
                </div>
              </div>
              <div className="hint-text">최대 13초까지만 재생돼요.</div>

              <div>
                <span className="field-label">정답 공개 이미지 URL (선택, WebP 불가)</span>
                <input className="text-field" value={form.answer_image_url} onChange={(e) => setField('answer_image_url', e.target.value)} maxLength={500} placeholder="https://..." />
                {isEditMode && serverValidation?.is_valid_answer_image_url === false && (
                  <div className="error-banner">❗ 저장된 이미지 URL이 사용 불가능한 형식이에요.</div>
                )}
                {isDiscordCdnLink(form.answer_image_url) && (
                  <div className="error-banner">❗ 디스코드에 업로드한 이미지 URL 같아요. 일정 시간이 지나면 사라져요.</div>
                )}
                {form.answer_image_url && <img src={form.answer_image_url} alt="정답 이미지 미리보기" style={{ maxWidth: '100%', maxHeight: 160, marginTop: 8, borderRadius: 10 }} />}
              </div>

              <div>
                <span className="field-label">정답 공개 시 표시할 텍스트 (선택)</span>
                <textarea className="text-field" rows={3} value={form.answer_text} onChange={(e) => setField('answer_text', e.target.value)} maxLength={500} placeholder="자유롭게 텍스트를 입력해주세요." />
              </div>
            </div>
          )}

          {formError && <div className="error-banner section-block">🔸 {formError}</div>}

          <div className="section-block" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={prevQuestionId === null}
                onClick={() => navigate(`/quiz/${quizId}/questions/${prevQuestionId}`)}
              >
                ← 이전 문제
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={nextQuestionId === null}
                onClick={() => navigate(`/quiz/${quizId}/questions/${nextQuestionId}`)}
              >
                다음 문제 →
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={questionOrder.length >= MAX_QUESTIONS_PER_QUIZ}
                title={questionOrder.length >= MAX_QUESTIONS_PER_QUIZ ? `문제는 최대 ${MAX_QUESTIONS_PER_QUIZ}개까지 만들 수 있어요.` : undefined}
                onClick={() => navigate(`/quiz/${quizId}/questions/new`)}
              >
                + 새 문제 추가
              </button>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => navigate(`/quiz/${quizId}`)}>취소</button>
              <button type="submit" className="toolbar-cta" disabled={saving}>
                {savedFlash ? '✓ 저장됨' : saving ? '저장 중...' : '저장'}
              </button>
            </span>
          </div>
        </form>
      </div>

      <div className="detail-col">
        <div className="card detail-card">
          <span className="field-label">👀 실제 디스코드에선 이렇게 보여요</span>
          {activeTab === 'basic' && (
            <DiscordQuestionPreview quizTitle={quizTitle} form={form} index={index} total={total} />
          )}
          {activeTab === 'extra' && <DiscordHintPreview form={form} />}
          {activeTab === 'answering' && <DiscordAnswerPreview form={form} />}
          <p className="preview-caption">{TAB_TO_PREVIEW_CAPTION[activeTab]}</p>
        </div>
      </div>
    </div>
  );
}
