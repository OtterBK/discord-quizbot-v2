// 카드에 마우스를 올리고 잠시 기다리면 뜨는 플로팅 미리보기(2026-08-09 피드백). 이미 목록에 있는
// 요약 정보만 보여주는 가벼운 툴팁이라 QuizDetailCard(전체 상세보기)와는 별도 컴포넌트로 둔다 -
// 정확한 문제 수/전체 설명 등은 좌클릭으로 여는 전체 상세보기에서 확인.
const WIDTH = 300;
const MARGIN = 12;

export default function QuizHoverPreview({ hover, tagNameByValue }) {
  if (hover === null) {
    return null;
  }

  const { quiz, rect } = hover;

  const space_right = window.innerWidth - rect.right;
  const left = space_right >= WIDTH + MARGIN
    ? rect.right + MARGIN
    : Math.max(MARGIN, rect.left - WIDTH - MARGIN);
  const top = Math.min(Math.max(MARGIN, rect.top), window.innerHeight - 200);

  const matchedTagNames = tagNameByValue
    ? Object.entries(tagNameByValue).filter(([value]) => (quiz.tags_value & Number(value)) !== 0).map(([, name]) => name)
    : [];

  return (
    <div className="hover-preview" style={{ top, left, width: WIDTH }}>
      <div className="hover-preview-title">{quiz.title}</div>
      <div className="hover-preview-creator">
        by {quiz.creator_name ?? '알 수 없음'}{quiz.certified ? ' · 인증된 퀴즈' : ''}
      </div>
      {quiz.simple_description && <div className="hover-preview-desc">{quiz.simple_description}</div>}
      {matchedTagNames.length > 0 && (
        <div className="detail-tags">
          {matchedTagNames.slice(0, 6).map((name) => <span key={name} className="tag-block">{name}</span>)}
        </div>
      )}
      <div className="hover-preview-stats">♥ {quiz.like_count ?? 0}</div>
    </div>
  );
}
