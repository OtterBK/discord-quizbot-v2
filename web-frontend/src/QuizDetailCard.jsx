import Markdown from 'react-markdown';
import { fallbackThumbFor, isValidThumbnailUrl, formatDate } from './quizCardUtils.js';

// UserQuizTab.jsx/OmakaseTab.jsx가 공유하는 유저 퀴즈 상세 정보 표시.
// 제작자/한줄 소개/상세 설명/태그를 각각 field-label로 분리해서 보여준다(2026-08-09 피드백 반영 —
// 기존엔 전부 detail-desc 하나로 뭉쳐 있어서 어디까지가 어떤 정보인지 구분이 안 갔음). 상세 설명은
// 태그보다 위에 두고(2026-08-09 피드백), 유저가 마크다운으로 작성했을 수 있어 react-markdown으로
// 렌더링한다(react-markdown은 결과를 React 엘리먼트로만 만들고 raw HTML을 그대로 꽂지 않아 유저가
// 입력한 설명에 스크립트가 섞여 있어도 안전 - dangerouslySetInnerHTML 사용 금지).
// children으로 각 탭 전용 액션(문제 수 스테퍼+확정 버튼 / 퀴즈함 담기·빼기 버튼)을 받는다.
export default function QuizDetailCard({ detail, tagNameByValue, children }) {
  const thumb = fallbackThumbFor(detail.quiz_id);
  const hasThumbnail = isValidThumbnailUrl(detail.thumbnail);
  const matchedTagNames = tagNameByValue
    ? Object.entries(tagNameByValue).filter(([value]) => (detail.tags_value & Number(value)) !== 0).map(([, name]) => name)
    : [];

  return (
    <>
      <span
        className="card-thumb"
        style={{
          borderRadius: 10,
          ...(hasThumbnail
            ? { backgroundImage: `url(${detail.thumbnail})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { background: `linear-gradient(155deg, ${thumb.from} 0%, ${thumb.to} 100%)` }),
        }}
      >
        {!hasThumbnail && <span className="thumb-glyph">🎯</span>}
        {detail.certified === true && <span className="thumb-badge verified">✓ 인증</span>}
      </span>

      <div className="detail-title">{detail.title}</div>

      <div>
        <span className="field-label">제작자</span>
        <div className="detail-desc">{detail.creator_name ?? '알 수 없음'}</div>
      </div>

      {detail.simple_description && (
        <div>
          <span className="field-label">한줄 소개</span>
          <div className="detail-desc">{detail.simple_description}</div>
        </div>
      )}

      {detail.description && (
        <div>
          <span className="field-label">상세 설명</span>
          <div className="detail-desc markdown-desc">
            <Markdown>{detail.description}</Markdown>
          </div>
        </div>
      )}

      {matchedTagNames.length > 0 && (
        <div>
          <span className="field-label">태그</span>
          <div className="detail-tags">
            {matchedTagNames.map((name) => <span key={name} className="tag-block">{name}</span>)}
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat-box">
          <div className="k">좋아요</div>
          <div className="v">{detail.like_count ?? 0}</div>
        </div>
        <div className="stat-box">
          <div className="k">보유 문제</div>
          <div className="v">{detail.question_count}</div>
        </div>
        {detail.played_count !== undefined && (
          <div className="stat-box">
            <div className="k">플레이한 서버</div>
            <div className="v">{detail.played_count ?? 0}</div>
          </div>
        )}
        {detail.birthtime !== undefined && (
          <div className="stat-box">
            <div className="k">만들어진 날짜</div>
            <div className="v" style={{ fontSize: 13 }}>{formatDate(detail.birthtime)}</div>
          </div>
        )}
        {detail.modified_time !== undefined && (
          <div className="stat-box">
            <div className="k">업데이트 날짜</div>
            <div className="v" style={{ fontSize: 13 }}>{formatDate(detail.modified_time)}</div>
          </div>
        )}
      </div>

      {children}
    </>
  );
}
