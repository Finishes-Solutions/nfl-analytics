import { ago, dateShort, FORMAT_LABEL, href, n1, qs, SEASON_TYPE_LABEL, signed, useApi, useFilters } from '../lib';
import type { Meta, Row } from '../types';
import { BarList } from '../components/charts';
import { Card, DataTable, ErrorBox, PlayerLink, Pos, TeamLink, Tile } from '../components/ui';

export function Overview({ meta }: { meta: Meta }) {
  const f = useFilters();
  const { data, error, loading } = useApi<Row>(`overview?${qs({ season: f.season, season_type: f.seasonType, format: f.format })}`);
  const seasonRow = meta.seasons.find((s) => s.season === f.season && s.season_type === f.seasonType);
  const fresh = (t: string) => data?.health?.find((h: Row) => h.table_name === t);
  const stale = (h?: Row) => !h || h.hours_since_write === null || h.hours_since_write > 36;
  const teams: Row[] = data?.teams ?? [];
  const byDiff = [...teams].sort((a, b) => b.point_differential - a.point_differential);
  const byLuck = [...teams].sort((a, b) => b.luck_wins - a.luck_wins);

  return (
    <div className={loading ? 'loading' : ''}>
      <h1>{f.season} {SEASON_TYPE_LABEL[f.seasonType].toLowerCase()}</h1>
      <p className="sub">Fantasy scoring: {FORMAT_LABEL[f.format]}. Click any player, team, or game for detail.</p>
      <ErrorBox error={error} />

      <div className="grid g4 section">
        <Tile label="Games final" value={`${seasonRow?.final_games ?? 0} of ${seasonRow?.games ?? 0}`}
              delta={seasonRow?.max_week ? `Through week ${seasonRow.max_week}` : 'Not started'} />
        <Tile label="Box scores updated" value={ago(fresh('player_game_stats')?.hours_since_write)}
              delta={stale(fresh('player_game_stats')) ? 'Over 36h — is nightly sync running?' : 'Nightly sync looks current'}
              deltaGood={!stale(fresh('player_game_stats'))} />
        <Tile label="Injury report captured" value={ago(fresh('injury_snapshots')?.hours_since_write)}
              delta={stale(fresh('injury_snapshots')) ? 'Snapshots lag — history is being lost' : 'Snapshots current'}
              deltaGood={!stale(fresh('injury_snapshots'))} />
        <Tile label="Odds captured" value={ago(fresh('odds_snapshots')?.hours_since_write)}
              delta="Game-day sync archives lines + props" />
      </div>

      <div className="grid g4 section">
        {['QB', 'RB', 'WR', 'TE'].map((pos) => (
          <Card key={pos} title={`Top ${pos}`} className="flush">
            <DataTable rows={(data?.leaders ?? []).filter((r: Row) => r.pos === pos)} sort="fp_total"
              cols={[
                { key: 'last_name', label: 'Player', left: true, render: (r) => <PlayerLink id={r.player_id} {...r} season={f.season} /> },
                { key: 'fp_pg', label: 'Pts/G', render: (r) => n1(r.fp_pg) },
                { key: 'fp_total', label: 'Total', render: (r) => n1(r.fp_total) },
              ]} />
          </Card>
        ))}
      </div>

      <div className="grid g2 section">
        <Card title="Heating up" right={<span className="muted">Last 3 games vs season avg</span>}>
          <BarList format={(v) => signed(v)} diverging
            data={(data?.hot ?? []).map((r: Row) => ({
              key: r.player_id, value: r.delta,
              tip: `Last 3: ${n1(r.roll3)} · Season: ${n1(r.season_avg)}`,
              label: <><Pos pos={r.pos} /> <PlayerLink id={r.player_id} {...r} season={f.season} /> <span className="muted">{r.team}</span></>,
            }))} />
          {!data?.hot?.length && <p className="muted">Needs 4+ games of data.</p>}
        </Card>
        <Card title="Cooling off" right={<span className="muted">Last 3 games vs season avg</span>}>
          <BarList format={(v) => signed(v)} diverging
            data={(data?.cold ?? []).map((r: Row) => ({
              key: r.player_id, value: r.delta,
              tip: `Last 3: ${n1(r.roll3)} · Season: ${n1(r.season_avg)}`,
              label: <><Pos pos={r.pos} /> <PlayerLink id={r.player_id} {...r} season={f.season} /> <span className="muted">{r.team}</span></>,
            }))} />
          {!data?.cold?.length && <p className="muted">Needs 4+ games of data.</p>}
        </Card>
      </div>

      <div className="grid g3 section">
        <Card title="Point differential" className="flush">
          <DataTable rows={byDiff.slice(0, 10)} sort="point_differential" cols={[
            { key: 'team', label: 'Team', left: true, render: (r) => <TeamLink id={r.team_id} abbr={r.team} season={f.season} /> },
            { key: 'wins', label: 'W-L', render: (r) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`, value: (r) => r.wins },
            { key: 'point_differential', label: 'Diff', render: (r) => signed(r.point_differential, 0) },
          ]} />
        </Card>
        <Card title="Luckiest records" className="flush" right={<span className="muted" style={{ paddingRight: 18 }}>Wins vs Pythagorean</span>}>
          <DataTable rows={byLuck.slice(0, 10)} sort="luck_wins" cols={[
            { key: 'team', label: 'Team', left: true, render: (r) => <TeamLink id={r.team_id} abbr={r.team} season={f.season} /> },
            { key: 'wins', label: 'W', value: (r) => r.wins },
            { key: 'pythag_wins', label: 'Expected', render: (r) => n1(r.pythag_wins) },
            { key: 'luck_wins', label: 'Luck', render: (r) => signed(r.luck_wins) },
          ]} />
        </Card>
        <Card title="Latest results" className="flush">
          <div className="scroll" style={{ maxHeight: 380 }}>
            <table className="dt"><tbody>
              {(data?.recent ?? []).map((g: Row) => (
                <tr key={g.game_id}>
                  <td className="l muted">W{g.week} · {dateShort(g.game_date)}</td>
                  <td className="l"><a className="link" href={href(`game/${g.game_id}`)}>
                    {g.visitor} {g.visitor_score} @ {g.home} {g.home_score}</a></td>
                </tr>
              ))}
            </tbody></table>
          </div>
        </Card>
      </div>
    </div>
  );
}
