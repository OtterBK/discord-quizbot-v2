import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import { getNotices, getNoticeDetail } from './api.js';

const formatDate = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - quiz_ui/note-select-ui.ts(목록)/
// note-ui.ts(상세)를 목록→상세 2단 패널로 옮김. 디스코드 쪽 페이지네이션(10개 단위)은 현재 공지 파일이
// 2개뿐이라 생략 - 나중에 파일이 늘어나면 다시 검토.
export default function NoticesPanel({ onBack, onSessionInvalid }) {
  const [notices, setNotices] = useState(null);
  const [selected, setSelected] = useState(null); // { title, content, mtime }
  const [error, setError] = useState(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getNotices()
      .then(({ notices }) => setNotices(notices))
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNotice = (name) => {
    getNoticeDetail(name).then(setSelected).catch(handleApiError);
  };

  return (
    <div className="card section-block">
      <button
        type="button"
        className="link-btn"
        onClick={selected !== null ? () => setSelected(null) : onBack}
      >
        {selected !== null ? '← 목록으로' : '← 퀴즈 선택으로'}
      </button>

      {error && <div className="error-banner">🔸 오류가 발생했어요. ({error})</div>}

      {selected === null ? (
        <>
          {notices === null && error === null && <div className="empty-hint">불러오는 중...</div>}
          {notices !== null && notices.length === 0 && <div className="empty-hint">등록된 공지가 없어요.</div>}
          <div className="tree-list" style={{ marginTop: 10 }}>
            {(notices ?? []).map((notice) => (
              <button
                type="button"
                key={notice.name}
                className="tree-row folder"
                onClick={() => openNotice(notice.name)}
              >
                <span className="icon">📄</span>
                <span className="label">{notice.name}</span>
                <span className="sub">{formatDate(notice.mtime)}</span>
                <span className="chev">›</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="detail-title" style={{ marginTop: 10 }}>{selected.title}</div>
          <div className="detail-desc" style={{ marginBottom: 8 }}>{formatDate(selected.mtime)}</div>
          <div className="markdown-desc"><Markdown>{selected.content}</Markdown></div>
        </>
      )}
    </div>
  );
}
