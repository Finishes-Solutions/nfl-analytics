import { href, n1, n2, pct, qs, signed, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { Scatter } from '../components/charts';
import { Card, DataTable, ErrorBox, TeamLink } from '../components/ui';

export function Teams() {
  const f = useFilters();
  const { data, error, loading } = useApi<Row[]>(`teams?${qs({ season: f.season, season_type: f.seasonType })}`);
  const rows = data ?? [];
  return (
    <div className={loading ? 'loading' : ''}>
      <h1>Teams</h1>
      <p className="sub">Records come from game results; expected wins use the Pythagorean formula (exponent 2.37). Luck = actual − expected.</p>
      <ErrorBox error={error} />
      <div className="grid g-2-1 section">
        <Card title="Efficiency landscape" right={<span className="muted">Up and right = better · lines = league average</span>}>
          <Scatter invertY xLabel="Offense yards per play" yLabel="Defense yards per play allowed (lower is better)"
            points={rows.filter((r) => r.yards_per_play && r.yards_per_play_allowed).map((r) => ({
              x: r.yards_per_play, y: r.yards_per_play_allowed, label: r.team,
              onClick: () => { window.location.hash = href(`team/${r.team_id}`); },
              tip: <><div className="t">{r.full_name} · {r.wins}-{r.losses}{r.ties ? `-${r.ties}` : ''}</div>
                <div className="row"><b>{n2(r.yards_per_play)}</b><span>off. yds/play</span></div>
                <div className="row"><b>{n2(r.yards_per_play_allowed)}</b><span>def. yds/play allowed</span></div></>,
            }))} />
        </Card>
        <Card title="Regression watch" right={<span className="muted">Luck & close games</span>} className="flush">
          <DataTable rows={rows} sort="luck_wins" maxHeight={380} cols={[
            { key: 'team', label: 'Team', left: true, render: (r) => <TeamLink id={r.team_id} abbr={r.team} season={f.season} /> },
            { key: 'luck_wins', label: 'Luck', render: (r) => <span className={r.luck_wins > 1 ? 'down' : r.luck_wins < -1 ? 'up' : ''}>{signed(r.luck_wins)}</span>, title: 'Wins above Pythagorean expectation; big positive values tend to regress' },
            { key: 'one_score_wins', label: '1-score', render: (r) => `${r.one_score_wins}-${r.one_score_losses}`, title: 'Record in games decided by 8 or fewer', value: (r) => r.one_score_wins - r.one_score_losses },
            { key: 'turnover_differential', label: 'TO diff', render: (r) => signed(r.turnover_differential, 0) },
          ]} />
        </Card>
      </div>
      <Card title="All teams" className="flush">
        <DataTable rows={rows} sort="wins" maxHeight={760} rowKey={(r) => r.team_id} cols={[
          { key: 'team', label: 'Team', left: true, render: (r) => <><TeamLink id={r.team_id} abbr={r.team} season={f.season} /> <span className="muted">{r.conference} {r.division}</span></> },
          { key: 'wins', label: 'W-L', render: (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`, value: (r) => r.wins + r.ties / 2 },
          { key: 'playoff_seed', label: 'Seed', render: (r) => r.playoff_seed ?? '—' },
          { key: 'points_pg', label: 'PF/G', render: (r) => n1(r.points_pg) },
          { key: 'points_allowed_pg', label: 'PA/G', render: (r) => n1(r.points_allowed_pg) },
          { key: 'point_differential', label: 'Diff', render: (r) => signed(r.point_differential, 0) },
          { key: 'pythag_wins', label: 'Exp W', render: (r) => n1(r.pythag_wins) },
          { key: 'yards_per_play', label: 'Off YPP', render: (r) => n2(r.yards_per_play) },
          { key: 'yards_per_play_allowed', label: 'Def YPP', render: (r) => n2(r.yards_per_play_allowed) },
          { key: 'third_down_pct', label: '3rd %', render: (r) => pct(r.third_down_pct) },
          { key: 'third_down_pct_allowed', label: 'Opp 3rd %', render: (r) => pct(r.third_down_pct_allowed) },
          { key: 'red_zone_pct', label: 'RZ %', render: (r) => pct(r.red_zone_pct) },
          { key: 'points_per_drive', label: 'Pts/drive', render: (r) => n2(r.points_per_drive) },
          { key: 'sacks_made', label: 'Sacks' },
          { key: 'fp_dst_pg', label: 'DST pts/G', render: (r) => n1(r.fp_dst_pg) },
        ]} />
      </Card>
    </div>
  );
}
