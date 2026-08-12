import { useEffect, useRef, useState } from 'react';

// UserQuizTab.jsx/OmakaseTab.jsx가 공유하는 유저 퀴즈 카드 표시 헬퍼.
// docs/WEB_UI_MOCKUP.html의 THUMB_STYLES 팔레트 중 일부 - 실제 thumbnail URL이 있으면 그걸 쓰고
// (없거나 깨졌으면), quiz_id로 고정된 그라디언트를 fallback으로 쓴다.
export const FALLBACK_THUMBS = [
  { from: '#5B4FCF', to: '#2C2470' },
  { from: '#E08A2E', to: '#8A4E13' },
  { from: '#1E9E6B', to: '#0E5C3E' },
  { from: '#C43B7B', to: '#5C1A3B' },
  { from: '#2E86AB', to: '#12384A' },
];

export const fallbackThumbFor = (quiz_id) => FALLBACK_THUMBS[quiz_id % FALLBACK_THUMBS.length];

export const isValidThumbnailUrl = (url) => typeof url === 'string' && /^https?:\/\//.test(url);

export const formatDate = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

// 디스코드 sort_by_select_menu(quizbot/quiz_ui/components/base_components.ts)와 정확히 동일한
// 정렬 옵션 - 웹에서 임의로 "이름순" 같은 걸 새로 만들지 않고 기존 지원 목록 그대로 맞춘다
// (2026-08-09 피드백: 없던 정렬이 생기고 기존 정렬 몇 개가 누락돼 있었음).
export const SORT_OPTIONS = [
  { value: 'modified_time', label: '업데이트순' },
  { value: 'played_count_of_week', label: '주간 인기순' },
  { value: 'played_count', label: '전체 인기순' },
  { value: 'like_count', label: '추천순' },
  { value: 'birthtime', label: '최신순' },
  { value: 'birthtime_reverse', label: '오래된순' },
];

export const compareQuizzesBySort = (a, b, sortBy) => {
  if (sortBy === 'played_count_of_week') return (b.played_count_of_week ?? 0) - (a.played_count_of_week ?? 0);
  if (sortBy === 'played_count') return (b.played_count ?? 0) - (a.played_count ?? 0);
  if (sortBy === 'like_count') return (b.like_count ?? 0) - (a.like_count ?? 0);
  if (sortBy === 'birthtime') return new Date(b.birthtime).getTime() - new Date(a.birthtime).getTime();
  if (sortBy === 'birthtime_reverse') return new Date(a.birthtime).getTime() - new Date(b.birthtime).getTime();
  // modified_time (기본값)
  return new Date(b.modified_time).getTime() - new Date(a.modified_time).getTime();
};

// 카드에 마우스를 올리고 잠시 기다리면 플로팅 미리보기를 띄운다(2026-08-09 피드백). 이미 목록에
// 불러와둔 요약 정보(quiz)만 쓰므로 추가 API 호출이 없어 즉각 반응한다 - 정확한 문제 수 등은
// 좌클릭으로 여는 전체 상세보기에서만 보여준다.
export function useHoverPreview(delay = 500) {
  const [hover, setHover] = useState(null); // { quiz, rect }
  const timerRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const onEnter = (quiz, e) => {
    clearTimer();
    const rect = e.currentTarget.getBoundingClientRect();
    timerRef.current = setTimeout(() => setHover({ quiz, rect }), delay);
  };

  const onLeave = () => {
    clearTimer();
    setHover(null);
  };

  // 스크롤하면 앵커 위치가 낡아지므로 미리보기를 닫는다(위치 재계산 대신 단순 숨김 - 짧은 툴팁이라 충분).
  useEffect(() => {
    if (hover === null) return undefined;

    const handleScroll = () => onLeave();
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', handleScroll, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hover]);

  useEffect(() => clearTimer, []);

  return { hover, onEnter, onLeave };
}
