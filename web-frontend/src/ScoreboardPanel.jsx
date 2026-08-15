import { useEffect, useState } from 'react';
import { getScoreboard, getScoreboardSeasons } from './api.js';

// 스코어보드(순위표) 웹 노출(2026-08-15 신설, docs/plans/SCOREBOARD_SEASON_PLAN.md) - 디스코드 쪽
// scoreboard-ui.ts와 동일하게 현재 시즌 기본 표시 + 지난 시즌(있을 때만) select로 전환. 지난 시즌이
// 하나도 없으면 select 자체를 안 보여줌(디스코드 쪽과 동일한 단순함 유지).
export default function ScoreboardPanel({ onBack, onSessionInvalid }) {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState(''); // '' = 현재 시즌
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const handleApiError = (err) => {
    if (err.status === 401) {
      onSessionInvalid();
      return;
    }
    setError(err.message);
  };

  useEffect(() => {
    getScoreboardSeasons()
      .then(({ seasons }) => setSeasons(seasons))
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setData(null);
    const season_id = selectedSeasonId === '' ? undefined : selectedSeasonId;
    getScoreboard(season_id)
      .then(setData)
      .catch(handleApiError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeasonId]);

  return (
    <div className="card section-block">
      <button type="button" className="link-btn" onClick={onBack}>← 퀴즈 선택으로</button>

      {error && <div className="error-banner">🔸 오류가 발생했어요. ({error})</div>}

      <div className="detail-title" style={{ marginTop: 10, fontSize: 16 }}>
        🎖 순위표{data ? ` [${data.season_name}]` : ''}
      </div>

      {seasons.length > 0 && (
        <select
          className="sort-select"
          style={{ marginTop: 10 }}
          value={selectedSeasonId}
          onChange={(e) => setSelectedSeasonId(e.target.value)}
        >
          <option value="">현재 시즌</option>
          {seasons.map((season) => (
            <option key={season.season_id} value={season.season_id}>{season.season_name}</option>
          ))}
        </select>
      )}

      {data === null && error === null && <div className="empty-hint" style={{ marginTop: 10 }}>불러오는 중...</div>}

      {data !== null && (
        <>
          <div className="stat-grid" style={{ marginTop: 14 }}>
            <div className="stat-box">
              <div className="k">우리 서버 전적</div>
              <div className="v">{data.my_scoreboard ? `${data.my_scoreboard.win}승 ${data.my_scoreboard.lose}패` : '기록 없음'}</div>
            </div>
            <div className="stat-box">
              <div className="k">MMR</div>
              <div className="v">{data.my_scoreboard?.mmr ?? 0}</div>
            </div>
          </div>

          <div className="scoreboard-list" style={{ marginTop: 14 }}>
            {data.top.length === 0 && <div className="empty-hint">순위 데이터가 없어요.</div>}
            {data.top.map((row, i) => (
              <div key={row.guild_id} className="scoreboard-row">
                <span className="rank">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
                <span className="name">{row.guild_name}</span>
                <span className="record">{row.win}승 {row.lose}패 · MMR {row.mmr}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
