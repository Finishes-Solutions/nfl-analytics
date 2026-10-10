import { useState } from 'react';
import { FORMAT_LABEL, n1, n2, pct, qs, signed, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { Card, CellBar, DataTable, ErrorBox, PlayerLink, Pos, Seg } from '../components/ui';

type PosFilter = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'PK';

export function Players() {
  const f = useFilters();
  const [pos, setPos] = useState<PosFilter>('ALL');
  const [minGames, setMinGames] = useState(4);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('fp_total');
  const [desc, setDesc] = useState(true);
  const { data, error, loading } = useApi<{ rows: Row[] }>(`players/leaders?${qs({
    season: f.season, season_type: f.seasonType, format: f.format, pos, min_games: minGames,
    q: search.trim().length >= 2 ? search.trim() : undefined, sort, dir: desc ? 'desc' : 'asc', limit: 250,
  })}`);
  const rows = data?.rows ?? [];
  const max = (k: string) => Math.max(0, ...rows.map((r) => r[k] ?? 0));

  return (
    <div>
      <h1>Players</h1>
      <p className="sub">Season fantasy production with usage. {FORMAT_LABEL[f.format]} scoring; floor/ceiling are PPR single-game extremes.</p>
      <div className="filters" style={{ position: 'static', borderBottom: 0, paddingTop: 0 }}>
        <Seg<PosFilter> value={pos} options={(['ALL', 'QB', 'RB', 'WR', 'TE', 'PK'] as PosFilter[]).map((p) => [p, p === 'ALL' ? 'All' : p])} onChange={setPos} />
        <label htmlFor="mg">Min games</label>
        <select id="mg" value={minGames} onChange={(e) => setMinGames(Number(e.target.value))}>
          {[1, 2, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="text" placeholder="Filter by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted">{rows.length} players{rows.length === 250 ? ' (top 250)' : ''}</span>
      </div>
      <ErrorBox error={error} />
      <Card className={`flush ${loading ? 'loading' : ''}`}>
        <DataTable rows={rows} sort={sort} desc={desc} maxHeight={720} rowKey={(r) => r.player_id}
          onSort={(k, d) => { setSort(k); setDesc(d); }}
          cols={[
            { key: 'last_name', label: 'Player', left: true, render: (r) => <><Pos pos={r.pos} /> <PlayerLink id={r.player_id} {...r} season={f.season} /></> },
            { key: 'team', label: 'Team', left: true, render: (r) => <span className="muted">{r.team ?? '—'}</span> },
            { key: 'games', label: 'G' },
            { key: 'fp_total', label: 'Points', render: (r) => <CellBar value={r.fp_total} max={max('fp_total')} text={n1(r.fp_total)} /> },
            { key: 'fp_pg', label: 'Pts/G', render: (r) => n1(r.fp_pg) },
            { key: 'delta', label: 'vs last yr', title: 'Change in points per game vs the previous season played', render: (r) => <span className={r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}>{signed(r.delta)}</span> },
            { key: 'fp_stdev', label: 'σ', title: 'Week-to-week standard deviation (lower = steadier)', render: (r) => n1(r.fp_stdev) },
            { key: 'floor', label: 'Floor', render: (r) => n1(r.floor) },
            { key: 'ceiling', label: 'Ceiling', render: (r) => n1(r.ceiling) },
            { key: 'opportunities', label: 'Opps', title: 'Targets + carries' },
            { key: 'target_share', label: 'Tgt share', render: (r) => pct(r.target_share, 1) },
            { key: 'carry_share', label: 'Carry share', render: (r) => pct(r.carry_share, 1) },
            { key: 'yards_per_target', label: 'Yds/Tgt', render: (r) => n1(r.yards_per_target) },
            { key: 'yards_per_carry', label: 'YPC', render: (r) => n1(r.yards_per_carry) },
            { key: 'fp_per_opp', label: 'PPR/Opp', title: 'PPR points per target+carry — efficiency', render: (r) => n2(r.fp_per_opp) },
          ]} />
      </Card>
      <p className="note">Shares are of the team's targets/carries in games the player appeared in. Sorting is done in the warehouse, so the top 250 is always the true top 250.</p>
    </div>
  );
}
