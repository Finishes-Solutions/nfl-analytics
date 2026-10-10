import { dateShort, FORMAT_LABEL, href, n1, n2, pct, qs, signed, SEASON_TYPE_LABEL, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { BarList, ColumnChart } from '../components/charts';
import { Card, DataTable, ErrorBox, PlayerLink, Pos, Tile } from '../components/ui';

export function Team({ id }: { id: number }) {
  const f = useFilters();
  const { data, error, loading } = useApi<{ team: Row; summary: Row | null; games: Row[]; players: Row[]; allowed: Row[] }>(
    `teams/${id}?${qs({ season: f.season, season_type: f.seasonType, format: f.format })}`);
  const league = useApi<{ league: Row[] }>(`matchups?${qs({ season: f.season, season_type: f.seasonType, format: f.format })}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  const s = data.summary;
  const avg = (pos: string) => league.data?.league.find((l) => l.pos === pos)?.league_avg;

  return (
    <div className={loading ? 'loading' : ''}>
      <h1>{data.team.full_name}</h1>
      <p className="sub">{data.team.conference} {data.team.division} · {f.season} {SEASON_TYPE_LABEL[f.seasonType].toLowerCase()}</p>
      {!s && <p className="muted">No completed games for this team in the selected season.</p>}
      {s && (
        <div className="grid g4 section">
          <Tile label="Record" value={`${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`} delta={`Expected ${n1(s.pythag_wins)} wins (${signed(s.luck_wins)} luck)`} />
          <Tile label="Point differential" value={signed(s.point_differential, 0)} delta={`${n1(s.points_pg)} scored · ${n1(s.points_allowed_pg)} allowed per game`} deltaGood={s.point_differential > 0} />
          <Tile label="Yards per play" value={n2(s.yards_per_play)} delta={`Defense allows ${n2(s.yards_per_play_allowed)}`} deltaGood={s.yards_per_play > s.yards_per_play_allowed} />
          <Tile label="Turnover differential" value={signed(s.turnover_differential, 0)} delta={`${s.takeaways} takeaways · ${s.giveaways} giveaways`} deltaGood={s.turnover_differential > 0} />
        </div>
      )}
      <div className="grid g-2-1 section">
        <Card title="Scoring margin by game">
          <ColumnChart diverging height={230} yFormat={(v) => signed(v, 0)}
            data={data.games.map((g) => ({
              label: `W${g.week}`, value: g.margin,
              onClick: () => { window.location.hash = href(`game/${g.game_id}`); },
              tip: <><div className="t">Week {g.week} {g.is_home ? 'vs' : '@'} {g.opponent}</div><div className="row"><b>{g.result} {g.points_for}-{g.points_against}</b></div></>,
            }))} />
        </Card>
        <Card title={`Fantasy points allowed`} right={<span className="muted">{FORMAT_LABEL[f.format]} · vs league avg</span>}>
          <BarList diverging format={(v) => signed(v)}
            data={['QB', 'RB', 'WR', 'TE'].map((pos) => {
              const a = data.allowed.find((x) => x.pos === pos);
              const l = avg(pos);
              return { key: pos, label: pos, value: a && l !== undefined ? a.fp_allowed_pg - l : null,
                       tip: a ? `${n1(a.fp_allowed_pg)}/game allowed (league ${n1(l)})` : undefined };
            })} />
          <p className="note">Positive = softer than average against that position (good matchup for opposing players).</p>
        </Card>
      </div>
      <div className="grid g2 section">
        <Card title="Fantasy contributors" className="flush">
          <DataTable rows={data.players} sort="fp_total" maxHeight={420} cols={[
            { key: 'last_name', label: 'Player', left: true, render: (r) => <><Pos pos={r.pos} /> <PlayerLink id={r.player_id} {...r} season={f.season} /></> },
            { key: 'games', label: 'G' },
            { key: 'fp_total', label: 'Points', render: (r) => n1(r.fp_total) },
            { key: 'fp_pg', label: 'Pts/G', render: (r) => n1(r.fp_pg) },
            { key: 'target_share', label: 'Tgt %', render: (r) => pct(r.target_share, 1) },
            { key: 'carry_share', label: 'Carry %', render: (r) => pct(r.carry_share, 1) },
          ]} />
        </Card>
        <Card title="Results" className="flush">
          <DataTable rows={data.games} sort="game_date" desc={false} maxHeight={420} cols={[
            { key: 'week', label: 'Wk', left: true, render: (r) => <a className="link" href={href(`game/${r.game_id}`)}>{r.week}</a> },
            { key: 'game_date', label: 'Date', left: true, render: (r) => <span className="muted">{dateShort(r.game_date)}</span> },
            { key: 'opponent', label: 'Opp', left: true, render: (r) => `${r.is_home ? 'vs' : '@'} ${r.opponent}` },
            { key: 'margin', label: 'Result', render: (r) => <span className={r.result === 'W' ? 'up' : r.result === 'L' ? 'down' : ''}>{r.result} {r.points_for}-{r.points_against}</span> },
            { key: 'total_yards', label: 'Yds' },
            { key: 'yards_allowed', label: 'Yds allowed' },
            { key: 'turnovers', label: 'TO', render: (r) => `${r.turnovers ?? '—'} / ${r.takeaways ?? '—'}`, title: 'Giveaways / takeaways' },
          ]} />
        </Card>
      </div>
    </div>
  );
}
