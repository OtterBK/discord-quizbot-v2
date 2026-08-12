import { useEffect, useState } from 'react';
import { getServerOption, updateServerOption } from './api.js';

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/server-setting-ui.ts를 옮긴
// 화면. 디스코드와 동일하게 로컬 편집(draft) 후 "저장"을 눌러야 실제로 반영된다(저장 안 하고 나가면
// 변경사항 소멸 - 의도된 동작, 서버 옵션 편집 권한은 디스코드 쪽과 동일하게 별도 체크 없음).
// 값 비교는 String()으로 정규화 - audio_play_time 등 일부 필드는 DB/기본값에 따라 number/string이
// 섞여 내려올 수 있어 타입까지 비교하면 실제로 안 바뀐 값도 "변경됨"으로 오탐할 수 있다.
export default function ServerSettingPanel({ onBack, onSessionInvalid }) {
  const [meta, setMeta] = useState(null); // select_menu
  const [original, setOriginal] = useState(null); // values
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'success' | 'fail'

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getServerOption()
      .then(({ values, select_menu }) => {
        setMeta(select_menu);
        setOriginal(values);
        setDraft(values);
      })
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="card section-block">
        <button type="button" className="link-btn" onClick={onBack}>← 퀴즈 선택으로</button>
        <div className="error-banner">🔸 오류가 발생했어요. ({error})</div>
      </div>
    );
  }

  if (meta === null || draft === null) {
    return (
      <div className="card section-block">
        <button type="button" className="link-btn" onClick={onBack}>← 퀴즈 선택으로</button>
        <div className="empty-hint">불러오는 중...</div>
      </div>
    );
  }

  const dirty = meta.options.some((opt) => `${draft[opt.value]}` !== `${original[opt.value]}`);

  const handleSave = async () => {
    const changed = {};
    meta.options.forEach((opt) => {
      if (`${draft[opt.value]}` !== `${original[opt.value]}`) {
        changed[opt.value] = draft[opt.value];
      }
    });
    if (Object.keys(changed).length === 0) return;

    setSaving(true);
    setSaveStatus(null);
    try {
      const { success, values } = await updateServerOption(changed);
      setOriginal(values);
      setDraft(values);
      setSaveStatus(success ? 'success' : 'fail');
      setTimeout(() => setSaveStatus(null), success ? 2500 : 5000);
    } catch (err) {
      handleApiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card section-block">
      <button type="button" className="link-btn" onClick={onBack}>← 퀴즈 선택으로</button>
      <div className="detail-title" style={{ marginTop: 10, fontSize: 16 }}>⚙ 서버 옵션 설정</div>
      <div className="hint-text" style={{ margin: '6px 0 16px' }}>
        ⚠️ 저장하지 않고 나가면 변경사항이 사라져요.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {meta.options.map((opt) => (
          <div key={opt.value}>
            <span className="field-label">{opt.label}</span>
            <div className="hint-text" style={{ marginBottom: 6 }}>{opt.description}</div>
            <select
              className="sort-select"
              value={draft[opt.value]}
              onChange={(e) => setDraft({ ...draft, [opt.value]: e.target.value })}
            >
              {(meta.option_values[opt.value] ?? []).map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {saveStatus === 'success' && (
        <div className="success-banner" style={{ marginTop: 16 }}>
          ✅ 옵션을 저장했어요 — 디스코드에도 바로 반영돼요.
        </div>
      )}
      {saveStatus === 'fail' && (
        <div className="error-banner" style={{ marginTop: 16 }}>
          🛑 옵션 저장에 실패했어요. 잠시 후 다시 시도해주세요.
        </div>
      )}

      <button
        type="button"
        className="cta-primary"
        style={{ marginTop: 16 }}
        disabled={!dirty || saving}
        onClick={handleSave}
      >
        {saving ? '저장 중...' : '저장'}
      </button>
    </div>
  );
}
