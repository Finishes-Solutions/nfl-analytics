import { dateTime, href, qs, spread, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { Card, ErrorBox } from '../components/ui';

export function Games({ week }: { week?: number }) {
  const f = useFilters();
  const { data, error, loading } = useApi<{ week: number; weeks: number[]; games: Row[] }>(
    `games?${qs({ season: f.season, season_type: f.seasonType, week })}`);
  const wk = data?.week;
  const label = (w: number) => f.seasonType === 3 ? ({ 1: 'Wild Card', 2: 'Divisional', 3: 'Conference', 4: 'Pro Bowl', 5: 'Super Bowl' } as Record<number, string>)[w] ?? `Round ${w}` : `Week ${w}`;
  return (
    <div className={loading ? 'loading' : ''}>
      <h1>Games</h1>
      <p className="sub">Scores with the consensus closing line (mean across books). Click a game for box score, win probability and line movement.</p>
      <ErrorBox error={error} />
      <div className="filters" style={{ position: 'static', borderBottom: 0, paddingTop: 0 }}>
        <div className="seg">
          {(data?.weeks ?? []).map((w) => (
            <button key={w} className={w === wk ? 'on' : ''} onClick={() => { window.location.hash = href('games', { week: w }); }}>{f.seasonType === 3 ? label(w) : w}</button>
          ))}
        </div>
      </div>
      {wk !== undefined && <h2>{label(wk)}</h2>}
      <div className="grid g3">
        {(data?.games ?? []).map((g) => {
          const final = g.home_score !== null && g.visitor_score !== null;
          const homeWon = final && g.home_score > g.visitor_score;
          const awayWon = final && g.visitor_score > g.home_score;
          return (
            <a key={g.game_id} href={href(`game/${g.game_id}`)} className="card" style={{ display: 'block' }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{final ? g.status : dateTime(g.game_date)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: awayWon ? 650 : 400 }}><span>{g.visitor}</span><span>{g.visitor_score ?? ''}</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: homeWon ? 650 : 400 }}><span>@ {g.home}</span><span>{g.home_score ?? ''}</span></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {g.close_spread_home !== null && g.close_spread_home !== undefined
                  ? <>{g.home} {spread(g.close_spread_home)} · O/U {g.close_total ?? '—'}
                      {g.ats_winner && <> · {g.ats_winner === 'push' ? 'ATS push' : `${g.ats_winner === 'home' ? g.home : g.visitor} covered`} · {g.total_result}</>}</>
                  : 'No line archived'}
              </div>
            </a>
          );
        })}
      </div>
      {data && !data.games.length && <Card><p className="muted">No games this week.</p></Card>}
    </div>
  );
}
