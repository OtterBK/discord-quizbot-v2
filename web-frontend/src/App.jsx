import { useEffect, useState } from 'react';
import { token, getSession, heartbeat, getNotices, getSupportLink } from './api.js';
import DevQuizTab from './DevQuizTab.jsx';
import UserQuizTab from './UserQuizTab.jsx';
import OmakaseTab from './OmakaseTab.jsx';
import MultiplayerTab from './MultiplayerTab.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import GuidePanel from './GuidePanel.jsx';
import NoticesPanel from './NoticesPanel.jsx';
import ServerSettingPanel from './ServerSettingPanel.jsx';

// 나머지 화면 웹 포팅(docs/WEB_UI_REMAINING_SCREENS_PLAN.md) - 디스코드 쪽 MainUI(퀴즈 선택 홈)에
// 이 세 화면이 전부 같은 자리(버튼)에서 나오므로 웹에서도 같은 메뉴에 묶어 노출한다.
const UTILITY_PANEL = { guide: '🛠 퀴즈 만들기 안내', notices: '📢 공지사항', settings: '⚙️ 서버 설정' };

// 봇 공유하기(2026-08-15 피드백) - Readme.md에 있는 것과 동일한 초대 링크. 별도 패널 없이 클립보드
// 복사 액션으로만 처리(패널이 필요할 만큼 콘텐츠가 있는 기능이 아님).
const BOT_INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=788060831660114012&permissions=2150681600&scope=bot';

// 공지사항 안 읽음 배지(2026-08-12 피드백 - 메뉴가 헤더 아이콘 하나뿐이라 서버 설정/공지사항의
// 존재 자체를 알아채기 힘들다는 지적) - 브라우저별 localStorage에 마지막으로 확인한 공지의 mtime을
// 저장해두고, 그보다 최신 공지가 있으면 배지를 띄운다. 처음 방문한 브라우저는 저장값이 없어 전부
// "안 읽음"으로 취급 - 흔한 안 읽음 배지 관례와 동일.
const LAST_SEEN_NOTICE_KEY = 'quizbot_web_last_seen_notice_mtime';

const MODE_TAB = { dev: '공식 퀴즈', user: '유저 퀴즈', omakase: '랜덤 퀴즈', multiplayer: '멀티플레이 퀴즈' };
const MODE_DESC = {
  dev: '개발자가 예전에 만든 공식 퀴즈예요. 폴더를 열어 문제 세트를 하나 골라요.',
  user: '유저 님들이 직접 만든 퀴즈예요. 검색하거나 태그로 필터링해서 골라요.',
  omakase: '공식 퀴즈 장르와 유저 퀴즈를 섞어서 랜덤으로 출제해요. 유저 퀴즈는 장르로 뽑거나 직접 골라 담을 수 있어요.',
  multiplayer: '다른 서버와 대결해요. 대기 중인 로비에 참가하거나 새로 만들 수 있어요. 퀴즈 진행/채팅은 디스코드에서만 가능해요.',
};
// 네 탭 모두 실제로 동작함(Phase 1/2/3/4 완료). 세션은 단일 mode에 고정되지 않고, 탭 전환은 순전히
// 프론트엔드 상태다 - 각 탭이 select/confirm 호출 시 자기 mode를 함께 실어보낸다
// (WEB_INTEGRATION_PLAN.md "8. 투트랙 진입점 분리").
const AVAILABLE_MODES = { dev: true, user: true, omakase: true, multiplayer: true };

export default function App() {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('dev');
  const [utilityPanel, setUtilityPanel] = useState(null); // null | 'guide' | 'notices' | 'settings'
  const [menuOpen, setMenuOpen] = useState(false);
  const [latestNoticeMtime, setLatestNoticeMtime] = useState(null);
  const [hasUnreadNotice, setHasUnreadNotice] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [supportUrl, setSupportUrl] = useState(null);
  // 랜덤 퀴즈 탭의 "직접 담기" 퀴즈함(quiz_id 목록) - 탭을 전환하면 OmakaseTab이 통째로 언마운트돼
  // 로컬 state가 날아가던 문제(2026-08-15 피드백)로, 이 값만 부모(App)로 끌어올려 탭을 오가도 유지되게 함.
  const [omakaseBasketItems, setOmakaseBasketItems] = useState({});

  const handleSessionInvalid = () => setError('session_invalid');

  const openUtilityPanel = (key) => {
    setUtilityPanel(key);
    setMenuOpen(false);

    if (key === 'notices' && latestNoticeMtime !== null) {
      localStorage.setItem(LAST_SEEN_NOTICE_KEY, latestNoticeMtime);
      setHasUnreadNotice(false);
    }
  };

  const shareBot = async () => {
    try {
      await navigator.clipboard.writeText(BOT_INVITE_URL);
    } catch {
      window.open(BOT_INVITE_URL, '_blank', 'noopener,noreferrer');
    }
    setShareCopied(true);
    //복사 확인 문구를 보여줘야 하니 메뉴를 바로 닫지 않고, 잠깐 보여준 뒤에 같이 닫는다
    setTimeout(() => {
      setShareCopied(false);
      setMenuOpen(false);
    }, 1200);
  };

  useEffect(() => {
    if (!token) {
      setError('missing_token');
      return;
    }

    getSession()
      .then((s) => {
        setSession(s);
        setActiveTab(s.mode);
      })
      .catch(handleSessionInvalid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 세션이 만료/파기(force_take, 확정 후 종료, GC 등)되면 하트비트도 멈춘다 - 계속 돌리면
  // 죽은 토큰으로 60초마다 401만 반복해서 부를 뿐이라.
  useEffect(() => {
    if (session === null || error !== null) return undefined;

    const interval = setInterval(() => {
      heartbeat().catch(handleSessionInvalid);
    }, 60000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, error]);

  // 지원센터 링크(2026-08-15 신설) - 헤더 pill 하나 띄우자고 세션을 깨뜨릴 순 없으니 실패해도 조용히 무시.
  useEffect(() => {
    if (session === null) return;

    getSupportLink()
      .then(({ url }) => setSupportUrl(url))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // 안 읽은 공지 배지 - 배지 하나 띄우자고 세션을 깨뜨릴 순 없으니 실패해도 조용히 무시한다.
  useEffect(() => {
    if (session === null) return;

    getNotices()
      .then(({ notices }) => {
        if (notices.length === 0) return;

        const latest_mtime = notices.reduce(
          (max, notice) => (new Date(notice.mtime) > new Date(max) ? notice.mtime : max),
          notices[0].mtime,
        );
        setLatestNoticeMtime(latest_mtime);

        const last_seen = localStorage.getItem(LAST_SEEN_NOTICE_KEY);
        if (last_seen === null || new Date(latest_mtime) > new Date(last_seen)) {
          setHasUnreadNotice(true);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  if (error) {
    return (
      <div className="shell">
        <div className="card" style={{ padding: 24, textAlign: 'center' }}>
          🔒 세션이 만료되었거나 잘못된 링크예요.
          <br />
          디스코드에서 [/퀴즈] 명령어를 다시 입력해주세요.
        </div>
      </div>
    );
  }

  if (session === null) {
    return (
      <div className="shell">
        <div className="empty-hint">불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">🎯</div>
          <div className="brand-text">
            <h1>퀴즈 세팅</h1>
            <p>서버 세팅 진행 중</p>
          </div>
        </div>
        <div className="topbar-actions">
          {supportUrl && (
            <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="support-link">
              ❓ 지원센터
            </a>
          )}
          <div className="utility-menu">
            <button type="button" className="menu-trigger" onClick={() => setMenuOpen((v) => !v)}>
              ☰ 더보기
              {hasUnreadNotice && <span className="unread-dot" />}
            </button>
            {menuOpen && (
              <>
                <button type="button" className="menu-backdrop" aria-label="메뉴 닫기" onClick={() => setMenuOpen(false)} />
                <div className="utility-menu-dropdown">
                  {Object.entries(UTILITY_PANEL).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => openUtilityPanel(key)}>
                      {label}
                      {key === 'notices' && hasUnreadNotice && <span className="unread-dot inline" />}
                    </button>
                  ))}
                  <button type="button" onClick={shareBot}>
                    {shareCopied ? '✓ 초대 링크가 복사됐어요' : '🔗 봇 공유하기'}
                  </button>
                </div>
              </>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      {utilityPanel === null ? (
        <>
          <nav className="tabrail" role="tablist">
            {Object.entries(MODE_TAB).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={activeTab === mode ? 'active' : ''}
                disabled={!AVAILABLE_MODES[mode]}
                onClick={() => setActiveTab(mode)}
              >
                <span className="dot" />{label}
              </button>
            ))}
          </nav>
          <div className="mode-desc" dangerouslySetInnerHTML={{ __html: MODE_DESC[activeTab] }} />

          {activeTab === 'dev' && <DevQuizTab onSessionInvalid={handleSessionInvalid} />}
          {activeTab === 'user' && <UserQuizTab onSessionInvalid={handleSessionInvalid} />}
          {activeTab === 'omakase' && (
            <OmakaseTab
              onSessionInvalid={handleSessionInvalid}
              basketItems={omakaseBasketItems}
              setBasketItems={setOmakaseBasketItems}
            />
          )}
          {activeTab === 'multiplayer' && <MultiplayerTab onSessionInvalid={handleSessionInvalid} />}
        </>
      ) : (
        <>
          {utilityPanel === 'guide' && <GuidePanel onBack={() => setUtilityPanel(null)} onSessionInvalid={handleSessionInvalid} />}
          {utilityPanel === 'notices' && <NoticesPanel onBack={() => setUtilityPanel(null)} onSessionInvalid={handleSessionInvalid} />}
          {utilityPanel === 'settings' && <ServerSettingPanel onBack={() => setUtilityPanel(null)} onSessionInvalid={handleSessionInvalid} />}
        </>
      )}
    </div>
  );
}
