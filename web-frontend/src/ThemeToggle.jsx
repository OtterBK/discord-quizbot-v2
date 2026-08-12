import { useEffect, useState } from 'react';

// App.jsx(퀴즈 선택 웹 UI)/QuizEditorApp.jsx(퀴즈 만들기 웹 UI)가 공유하는 테마 토글 - 원래
// App.jsx에만 인라인으로 있었는데, 퀴즈 만들기 웹 UI에는 아예 이 토글이 없어서 다크모드가 강제되는
// 문제가 있었음(2026-08-11 피드백 - 두 페이지 모두 별도 Vite 진입점이라 공유하려면 파일로 분리해야 함).
// 기본값은 라이트 모드(2026-08-09 피드백) - 'system'을 기본값으로 두면 OS가 다크 모드인 사용자에게는
// 첫 진입부터 다크로 보였음. 시스템 설정을 따르고 싶으면 토글에서 직접 "시스템"을 선택하면 된다.
export default function ThemeToggle() {
  const [theme, setTheme] = useState('light');

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="테마 선택">
      <button type="button" className={theme === 'light' ? 'active' : ''} title="라이트" onClick={() => setTheme('light')}>☀︎</button>
      <button type="button" className={theme === 'system' ? 'active' : ''} title="시스템" onClick={() => setTheme('system')}>◐</button>
      <button type="button" className={theme === 'dark' ? 'active' : ''} title="다크" onClick={() => setTheme('dark')}>☾</button>
    </div>
  );
}
