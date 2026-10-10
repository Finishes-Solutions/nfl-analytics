import { href, n1, pct, qs, signed, spread, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { BarList } from '../components/charts';
import { Card, DataTable, ErrorBox, TeamLink, Tile } from '../components/ui';

export function Betting() {
  const f = useFilters();
  const { data, error, loading } = useApi<{ summary: Row | null; ats: Row[]; moves: Row[]; props: Row[] }>(
    `betting?${qs({ season: f.season, season_type: f.seasonType })}`);
  const s = data?.summary;
  const decided = s ? s.home_covers + s.away_covers : 0;
  const ou = s ? s.overs + s.unders : 0;
  return (
    <div className={loading ? 'loading' : ''}>
      <h1>Betting</h1>
      <p className="sub">Consensus closing lines vs results, line movement, and player props vs actual stat lines. Odds coverage starts 2025 week 8.</p>
      <ErrorBox error={error} />
      {(!s || !s.games) && <Card><p className="muted">No settled games with archived lines for this season.</p></Card>}
      {s && s.games > 0 && (
        <>
          <div className="grid g4 section">
            <Tile label="Settled games with lines" value={s.games} />
            <Tile label="Favorites covered" value={pct(s.favorite_covers / (s.favorite_decided || 1))} delta={`${s.favorite_covers} of ${s.favorite_decided}`} />
            <Tile label="Overs hit" value={pct(s.overs / (ou || 1))} delta={`${s.overs} over · ${s.unders} under`} />
            <Tile label="Avg miss vs closing spread" value={`${n1(s.avg_spread_miss)} pts`} delta={`Totals miss by ${n1(s.avg_total_miss)} pts`} />
          </div>
          <div className="grid g-2-1 section">
            <Card title="Against the spread by team" className="flush">
              <DataTable rows={data!.ats} sort="covers" maxHeight={860} cols={[
                { key: 'team', label: 'Team', left: true, render: (r) => <TeamLink id={r.team_id} abbr={r.team} season={f.season} /> },
                { key: 'covers', label: 'ATS', render: (r) => `${r.covers}-${r.non_covers}${r.pushes ? `-${r.pushes}` : ''}`, value: (r) => r.covers - r.non_covers },
                { key: 'cover_pct', label: 'Cover %', value: (r) => r.covers / Math.max(1, r.covers + r.non_covers), render: (r) => pct(r.covers / Math.max(1, r.covers + r.non_covers)) },
                { key: 'avg_cover_margin', label: 'Avg cover margin', render: (r) => signed(r.avg_cover_margin) },
                { key: 'overs', label: 'O-U', render: (r) => `${r.overs}-${r.unders}`, value: (r) => r.overs - r.unders },
              ]} />
            </Card>
            <Card title="Cover margin" right={<span className="muted">Points beyond the closing spread, per game</span>}>
              <BarList diverging format={(v) => signed(v)}
                data={[...(data!.ats)].sort((a, b) => b.avg_cover_margin - a.avg_cover_margin).map((r) => ({ key: r.team_id, label: r.team, value: r.avg_cover_margin }))} />
            </Card>
          </div>
          <div className="grid g2 section">
            <Card title="Biggest line moves" className="flush">
              <DataTable rows={data!.moves} sort="spread_move" cols={[
                { key: 'week', label: 'Wk', left: true, render: (r) => <a className="link" href={href(`game/${r.game_id}`)}>{r.week}</a> },
                { key: 'home', label: 'Game', left: true, render: (r) => `${r.visitor} @ ${r.home}` },
                { key: 'open_spread_home', label: 'Open', render: (r) => spread(r.open_spread_home) },
                { key: 'close_spread_home', label: 'Close', render: (r) => spread(r.close_spread_home) },
                { key: 'spread_move', label: 'Move', value: (r) => Math.abs(r.spread_move), render: (r) => signed(r.spread_move) },
                { key: 'ats_winner', label: 'Covered', render: (r) => r.ats_winner === 'home' ? r.home : r.ats_winner === 'away' ? r.visitor : r.ats_winner ?? '—' },
              ]} />
            </Card>
            <Card title="Props: closing line vs result" className="flush">
              <DataTable rows={data!.props} sort="props" cols={[
                { key: 'prop_type', label: 'Prop', left: true, render: (r) => r.prop_type.replace(/_/g, ' ') },
                { key: 'props', label: 'Settled' },
                { key: 'over_rate', label: 'Over / hit %', value: (r) => r.overs_or_hits / Math.max(1, r.overs_or_hits + r.unders_or_misses), render: (r) => pct(r.overs_or_hits / Math.max(1, r.overs_or_hits + r.unders_or_misses)) },
                { key: 'avg_actual_minus_line', label: 'Actual − line', render: (r) => signed(r.avg_actual_minus_line) },
                { key: 'no_action', label: 'No action', title: 'Player recorded no stat line' },
                { key: 'unmapped', label: 'Unmapped', title: 'Prop type not yet mapped to a stat in v_prop_results' },
              ]} />
              <p className="note" style={{ padding: '0 18px 12px' }}>Book hold means a fair line lands near 50% over; a persistent lean is the interesting signal.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
