import { useMemo } from 'react';
import { dateTime, FORMAT_LABEL, n1, pct, SEASON_TYPE_LABEL, spread, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { LineChart, SERIES } from '../components/charts';
import { Card, DataTable, ErrorBox, PlayerLink, Pos } from '../components/ui';

interface GameData { game: Row; teamStats: Row[]; players: Row[]; plays: Row[]; lines: Row[]; movement: Row[] }

const STAT_ROWS: [string, string][] = [
  ['first_downs', 'First downs'], ['total_yards', 'Total yards'], ['yards_per_play', 'Yards per play'],
  ['net_passing_yards', 'Net passing'], ['rushing_yards', 'Rushing'], ['third_down_efficiency', '3rd down'],
  ['fourth_down_efficiency', '4th down'], ['red_zone', 'Red zone'], ['turnovers', 'Turnovers'],
  ['sacks', 'Sacks taken'], ['penalties', 'Penalties'], ['possession_time', 'Possession'],
];

export function Game({ id }: { id: number }) {
  const f = useFilters();
  const { data, error } = useApi<GameData>(`games/${id}`);
  const k = f.format === 'ppr' ? 'fp_ppr' : f.format === 'half_ppr' ? 'fp_half_ppr' : 'fp_standard';

  // line movement: pivot snapshots by capture time, forward-fill each book (only changes are stored)
  const movement = useMemo(() => {
    const rows = data?.movement ?? [];
    const vendors = [...new Set(rows.map((r) => r.vendor as string))].slice(0, 4);
    const times = [...new Set(rows.map((r) => r.captured_at as string))].sort();
    const last: Record<string, number | null> = {};
    const series = vendors.map((v) => ({ name: v, values: [] as (number | null)[] }));
    for (const t of times) {
      for (const [i, v] of vendors.entries()) {
        const hit = rows.find((r) => r.captured_at === t && r.vendor === v);
        if (hit) last[v] = hit.spread_home;
        series[i].values.push(last[v] ?? null);
      }
    }
    return { times, series };
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const g = data.game;
  const ts = (teamId: number) => data.teamStats.find((t) => t.team_id === teamId) ?? {};
  const away = ts(g.visitor_team_id), home = ts(g.home_team_id);
  const statVal = (t: Row, key: string) => key === 'red_zone' ? (t.red_zone_attempts !== undefined ? `${t.red_zone_scores ?? 0}/${t.red_zone_attempts ?? 0}` : '—') : (t[key] ?? '—');
  const plays = data.plays;
  const wpPlays = plays.filter((p) => p.home_win_probability !== null);
  const scoring = plays.filter((p) => p.scoring_play);
  const hasOt = g.home_team_ot !== null || g.visitor_team_ot !== null;
  const q = (side: 'home' | 'visitor') => [1, 2, 3, 4].map((n) => g[`${side}_team_q${n}`]).concat(hasOt ? [g[`${side}_team_ot`]] : []);

  return (
    <div>
      <h1>{g.visitor_name} {g.visitor_team_score ?? ''} @ {g.home_name} {g.home_team_score ?? ''}</h1>
      <p className="sub">{g.season} {SEASON_TYPE_LABEL[g.season_type].toLowerCase()} · week {g.week} · {dateTime(g.game_date)} · {g.venue ?? ''} · {g.status}</p>

      <div className="grid g-2-1 section" style={{ alignItems: 'start' }}>
        <Card title="Home win probability" right={<span className="muted">{g.home} · from play-by-play</span>}>
          {wpPlays.length > 0 ? (
            <LineChart height={300} yDomain={[0, 1]} yFormat={(v) => pct(v)}
              x={wpPlays.map((p) => (p.period > 4 ? 'OT' : `Q${p.period}`))}
              xTicks={wpPlays.map((p, i) => (i === 0 || wpPlays[i - 1].period !== p.period ? i : -1)).filter((i) => i >= 0)}
              tipTitle={(i) => `Q${wpPlays[i].period} ${wpPlays[i].clock_display ?? ''} · ${g.visitor} ${wpPlays[i].away_score}-${wpPlays[i].home_score} ${g.home}`}
              series={[{ name: `${g.home} win probability`, color: 'var(--s1)', values: wpPlays.map((p) => p.home_win_probability) }]}
              refLine={{ value: 0.5, label: '50%' }} />
          ) : <p className="muted">No play-by-play win probability for this game.</p>}
        </Card>
        <Card title="Score by quarter" className="flush">
          <table className="dt">
            <thead><tr><th className="l">Team</th>{['1', '2', '3', '4'].concat(hasOt ? ['OT'] : []).map((h) => <th key={h}>{h}</th>)}<th>Final</th></tr></thead>
            <tbody>
              <tr><td className="l">{g.visitor}</td>{q('visitor').map((v, i) => <td key={i}>{v ?? '—'}</td>)}<td><b>{g.visitor_team_score ?? '—'}</b></td></tr>
              <tr><td className="l">{g.home}</td>{q('home').map((v, i) => <td key={i}>{v ?? '—'}</td>)}<td><b>{g.home_team_score ?? '—'}</b></td></tr>
            </tbody>
          </table>
          <h2 style={{ marginTop: 14 }}>Team stats</h2>
          <table className="dt">
            <thead><tr><th className="l" /><th>{g.visitor}</th><th>{g.home}</th></tr></thead>
            <tbody>
              {STAT_ROWS.map(([key, label]) => (
                <tr key={key}><td className="l muted">{label}</td><td>{statVal(away, key)}</td><td>{statVal(home, key)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid g2 section">
        {[g.visitor_team_id, g.home_team_id].map((tid) => (
          <Card key={tid} title={`${tid === g.home_team_id ? g.home : g.visitor} fantasy box`} className="flush">
            <DataTable rows={data.players.filter((p) => p.team_id === tid)} sort={k} maxHeight={360} cols={[
              { key: 'last_name', label: 'Player', left: true, render: (r) => <><Pos pos={r.pos} /> <PlayerLink id={r.player_id} {...r} season={g.season} /></> },
              { key: 'passing_yards', label: 'Pass', render: (r) => r.passing_attempts ? `${r.passing_completions}/${r.passing_attempts} ${r.passing_yards} ${r.passing_touchdowns}TD ${r.passing_interceptions}INT` : '' },
              { key: 'rushing_yards', label: 'Rush', render: (r) => r.rushing_attempts ? `${r.rushing_attempts}-${r.rushing_yards}${r.rushing_touchdowns ? ` ${r.rushing_touchdowns}TD` : ''}` : '' },
              { key: 'receiving_yards', label: 'Rec', render: (r) => r.receiving_targets ? `${r.receptions}/${r.receiving_targets} ${r.receiving_yards}${r.receiving_touchdowns ? ` ${r.receiving_touchdowns}TD` : ''}` : '' },
              { key: k, label: FORMAT_LABEL[f.format], render: (r) => <b>{n1(r[k])}</b> },
            ]} />
          </Card>
        ))}
      </div>

      <div className="grid g2 section">
        <Card title="Lines by book" className="flush">
          {data.lines.length ? (
            <DataTable rows={data.lines} sort="vendor" desc={false} cols={[
              { key: 'vendor', label: 'Book', left: true },
              { key: 'open_spread_home', label: `Open (${g.home})`, render: (r) => spread(r.open_spread_home) },
              { key: 'close_spread_home', label: 'Close', render: (r) => spread(r.close_spread_home) },
              { key: 'open_total', label: 'Open O/U', render: (r) => n1(r.open_total) },
              { key: 'close_total', label: 'Close O/U', render: (r) => n1(r.close_total) },
              { key: 'ats_winner', label: 'ATS', render: (r) => r.ats_winner === 'home' ? g.home : r.ats_winner === 'away' ? g.visitor : r.ats_winner ?? '—' },
              { key: 'total_result', label: 'Total', render: (r) => r.total_result ?? '—' },
            ]} />
          ) : <p className="muted" style={{ padding: '0 18px 14px' }}>No odds archived for this game (odds coverage starts 2025 week 8).</p>}
        </Card>
        <Card title={`Spread movement (${g.home})`} right={<span className="muted">Each book carried forward between changes</span>}>
          {movement.times.length > 1 ? (
            <LineChart height={220} yFormat={(v) => spread(v)}
              x={movement.times.map((t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}
              tipTitle={(i) => dateTime(movement.times[i])}
              series={movement.series.map((s, i) => ({ name: s.name, color: SERIES[i], values: s.values }))} />
          ) : <p className="muted">Not enough snapshots to show movement.</p>}
        </Card>
      </div>

      {scoring.length > 0 && (
        <Card title="Scoring plays" className="flush section">
          <table className="dt"><tbody>
            {scoring.map((p) => (
              <tr key={p.play_no}>
                <td className="l muted">Q{p.period} {p.clock_display}</td>
                <td className="l">{p.type_text}</td>
                <td className="l" style={{ whiteSpace: 'normal' }}>{p.text}</td>
                <td>{g.visitor} {p.away_score} – {p.home_score} {g.home}</td>
              </tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}
