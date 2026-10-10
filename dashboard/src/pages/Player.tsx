import { useEffect, useState } from 'react';
import { dateShort, FORMAT_LABEL, href, n0, n1, pct, qs, SEASON_TYPE_LABEL, signed, useApi, useFilters } from '../lib';
import type { Row } from '../types';
import { ColumnChart, LineChart } from '../components/charts';
import { Card, DataTable, ErrorBox, Tile } from '../components/ui';

const ADV_LABELS: Record<string, [string, string, (v: number) => string][]> = {
  passing: [
    ['avg_time_to_throw', 'Time to throw (s)', (v) => v.toFixed(2)],
    ['avg_intended_air_yards', 'Intended air yds', (v) => v.toFixed(1)],
    ['completion_percentage_above_expectation', 'CPOE', (v) => signed(v)],
    ['aggressiveness', 'Aggressiveness %', (v) => v.toFixed(1)],
    ['passer_rating', 'Passer rating', (v) => v.toFixed(1)],
  ],
  rushing: [
    ['rush_yards_over_expected_per_att', 'RYOE / att', (v) => signed(v, 2)],
    ['efficiency', 'Efficiency', (v) => v.toFixed(2)],
    ['avg_time_to_los', 'Time to LOS (s)', (v) => v.toFixed(2)],
    ['percent_attempts_gte_eight_defenders', '8+ in box %', (v) => v.toFixed(1)],
  ],
  receiving: [
    ['avg_separation', 'Separation (yds)', (v) => v.toFixed(2)],
    ['avg_cushion', 'Cushion (yds)', (v) => v.toFixed(2)],
    ['avg_yac_above_expectation', 'YAC over expected', (v) => signed(v, 2)],
    ['percent_share_of_intended_air_yards', 'Air yards share %', (v) => v.toFixed(1)],
    ['catch_percentage', 'Catch %', (v) => v.toFixed(1)],
  ],
};

export function Player({ id, seasonHint }: { id: number; seasonHint?: number }) {
  const f = useFilters();
  const profile = useApi<{ bio: Row; seasons: Row[] }>(`players/${id}`);
  const seasons = profile.data?.seasons ?? [];
  const [sel, setSel] = useState<{ season: number; st: number } | null>(null);

  // choose a season: URL hint → global filter → most recent with data
  useEffect(() => {
    if (!seasons.length) return;
    const want = seasonHint ?? f.season;
    const pick = seasons.find((s) => s.season === want && s.season_type === f.seasonType)
      ?? seasons.find((s) => s.season === want) ?? seasons[0];
    setSel({ season: pick.season, st: pick.season_type });
  }, [profile.data, seasonHint, f.season, f.seasonType]); // eslint-disable-line react-hooks/exhaustive-deps

  const detail = useApi<{ games: Row[]; advanced: Row[]; injuries: Row[]; props: Row[] }>(
    sel ? `players/${id}/season?${qs({ season: sel.season, season_type: sel.st })}` : null);

  if (profile.error) return <ErrorBox error={profile.error} />;
  const bio = profile.data?.bio;
  if (!bio) return <p className="muted">Loading…</p>;

  const fmt = f.format;
  const k = fmt === 'ppr' ? 'fp_ppr' : fmt === 'half_ppr' ? 'fp_half_ppr' : 'fp_standard';
  const games = detail.data?.games ?? [];
  const cur = seasons.find((s) => sel && s.season === sel.season && s.season_type === sel.st);
  const prev = seasons.find((s) => cur && s.season_type === cur.season_type && s.season < cur.season);
  const pg = cur?.[`${k}_pg`];
  const regular = seasons.filter((s) => s.season_type === 2).sort((a, b) => a.season - b.season);
  const showRec = games.some((g) => (g.receiving_targets ?? 0) > 0);
  const showRush = games.some((g) => (g.rushing_attempts ?? 0) > 0);
  const showPass = games.some((g) => (g.passing_attempts ?? 0) > 0);

  return (
    <div>
      <h1>{bio.first_name} {bio.last_name}</h1>
      <p className="sub">
        {bio.position ?? bio.pos}{bio.team_name ? ` · ${bio.team_name}` : ''}{bio.jersey_number ? ` · #${bio.jersey_number}` : ''}
        {bio.height ? ` · ${bio.height}` : ''}{bio.weight ? `, ${bio.weight}` : ''}{bio.college ? ` · ${bio.college}` : ''}
        {bio.is_active === false ? ' · inactive' : ''}
      </p>

      <div className="filters" style={{ position: 'static', borderBottom: 0, paddingTop: 0 }}>
        <label htmlFor="ps">Showing</label>
        <select id="ps" value={sel ? `${sel.season}:${sel.st}` : ''} onChange={(e) => { const [s, t] = e.target.value.split(':').map(Number); setSel({ season: s, st: t }); }}>
          {seasons.map((s) => <option key={`${s.season}:${s.season_type}`} value={`${s.season}:${s.season_type}`}>{s.season} {SEASON_TYPE_LABEL[s.season_type]}</option>)}
        </select>
        {!seasons.length && <span className="muted">No games on record.</span>}
        <span className="grow" />
        {sel && <a className="askbtn" href={href('ask', { q: `Analyze ${bio.first_name} ${bio.last_name}'s ${sel.season} ${sel.st === 3 ? 'postseason' : 'season'} (player_id ${id}): usage trend, consistency, how it compares to his career and to other ${bio.pos}s, and what stands out.` })}>✦ Ask about this season</a>}
      </div>

      {cur && (
        <div className="grid g4 section">
          <Tile label={`${FORMAT_LABEL[fmt]} points per game`} value={n1(pg)}
                delta={prev ? `${signed(pg - prev[`${k}_pg`])} vs ${prev.season}` : 'No prior season'}
                deltaGood={prev ? pg > prev[`${k}_pg`] : null} />
          <Tile label="Total points" value={n1(cur[`${k}_total`])} delta={`${cur.games} games`} />
          <Tile label="Consistency (PPR σ)" value={n1(cur.fp_ppr_stdev)} delta="Lower = steadier week to week" />
          <Tile label={showRec ? 'Target share' : 'Carry share'} value={pct(showRec ? cur.target_share : cur.carry_share, 1)}
                delta={showRec && showRush ? `Carry share ${pct(cur.carry_share, 1)}` : 'Of team opportunities'} />
        </div>
      )}

      <div className={`grid g-2-1 section ${detail.loading ? 'loading' : ''}`}>
        <Card title={`Weekly ${FORMAT_LABEL[fmt]} points`}>
          <LineChart
            x={games.map((g) => `W${g.week}`)}
            tipTitle={(i) => `Week ${games[i].week} ${games[i].is_home ? 'vs' : '@'} ${games[i].opponent} · ${games[i].result ?? ''} ${games[i].team_points ?? ''}-${games[i].opponent_points ?? ''}`}
            series={[
              { name: 'Game points', color: 'var(--s1)', values: games.map((g) => g[k]), dots: true },
              { name: '3-game average', color: 'var(--s2)', values: games.map((g) => g[`${k}_roll3`]) },
            ]}
            refLine={pg !== undefined ? { value: pg, label: `Season avg ${n1(pg)}` } : undefined}
            yFormat={(v) => v.toFixed(0)} height={260} />
        </Card>
        <Card title="Career points per game" right={<span className="muted">Regular season</span>}>
          <ColumnChart data={regular.map((s) => ({
            label: String(s.season), value: s[`${k}_pg`],
            tip: <><div className="t">{s.season} · {s.games} games</div><div className="row"><b>{n1(s[`${k}_pg`])}</b><span>pts/game</span></div></>,
            onClick: () => setSel({ season: s.season, st: 2 }),
          }))} yFormat={(v) => v.toFixed(0)} height={260} showValues={regular.length <= 10} />
        </Card>
      </div>

      <Card title="Game log" className={`flush section ${detail.loading ? 'loading' : ''}`}>
        <DataTable rows={games} sort="game_date" desc={false} rowKey={(r) => r.game_id} cols={[
          { key: 'week', label: 'Wk', left: true, render: (r) => <a className="link" href={href(`game/${r.game_id}`)}>{r.week}</a> },
          { key: 'game_date', label: 'Date', left: true, render: (r) => <span className="muted">{dateShort(r.game_date)}</span> },
          { key: 'opponent', label: 'Opp', left: true, render: (r) => `${r.is_home ? 'vs' : '@'} ${r.opponent}` },
          { key: 'result', label: 'Result', left: true, render: (r) => r.result ? `${r.result} ${r.team_points}-${r.opponent_points}` : '—' },
          ...(showPass ? [
            { key: 'passing_yards', label: 'Pass', render: (r: Row) => r.passing_attempts ? `${r.passing_completions}/${r.passing_attempts}, ${r.passing_yards}` : '—', value: (r: Row) => r.passing_yards },
            { key: 'passing_touchdowns', label: 'TD-INT', render: (r: Row) => r.passing_attempts ? `${r.passing_touchdowns ?? 0}-${r.passing_interceptions ?? 0}` : '—' },
          ] : []),
          ...(showRush ? [
            { key: 'rushing_yards', label: 'Rush', render: (r: Row) => r.rushing_attempts ? `${r.rushing_attempts}-${r.rushing_yards}` : '—', value: (r: Row) => r.rushing_yards },
            { key: 'rushing_touchdowns', label: 'Rush TD' },
          ] : []),
          ...(showRec ? [
            { key: 'receiving_yards', label: 'Rec', render: (r: Row) => r.receiving_targets ? `${r.receptions}/${r.receiving_targets}, ${r.receiving_yards}` : '—', value: (r: Row) => r.receiving_yards },
            { key: 'receiving_touchdowns', label: 'Rec TD' },
            { key: 'target_share', label: 'Tgt %', render: (r: Row) => pct(r.target_share) },
          ] : []),
          { key: k, label: FORMAT_LABEL[fmt], render: (r) => <b>{n1(r[k])}</b> },
        ]} />
      </Card>

      <div className="grid g2 section">
        <Card title="Advanced (Next Gen Stats)" right={<span className="muted">Season aggregate · 2018+</span>}>
          {(detail.data?.advanced ?? []).length === 0 && <p className="muted">No advanced stats for this season.</p>}
          {(detail.data?.advanced ?? []).map((a) => (
            <div key={a.category} style={{ marginBottom: 12 }}>
              <div className="muted" style={{ textTransform: 'capitalize', marginBottom: 6 }}>{a.category}</div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {ADV_LABELS[a.category].filter(([key]) => a[key] !== null && a[key] !== undefined).map(([key, label, fmtFn]) => (
                  <div key={key}><div className="muted" style={{ fontSize: 12 }}>{label}</div><div style={{ fontSize: 17, fontWeight: 600 }}>{fmtFn(a[key])}</div></div>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <Card title="Injury history" right={<span className="muted">From daily snapshots</span>}>
          {(detail.data?.injuries ?? []).length === 0 && <p className="muted">No injury reports captured.</p>}
          {(detail.data?.injuries ?? []).map((i, n) => (
            <div key={n} style={{ padding: '6px 0', borderBottom: '1px solid var(--grid)' }}>
              <span className={`pill ${i.status === 'Out' || i.status === 'Injured Reserve' ? 'bad' : 'warn'}`}>{i.status}</span>{' '}
              <span className="muted">{dateShort(i.captured_at)}</span>
              <div style={{ color: 'var(--text-2)', marginTop: 2 }}>{i.comment}</div>
            </div>
          ))}
        </Card>
      </div>

      {(detail.data?.props ?? []).length > 0 && (
        <Card title="Player props vs result" className="flush section">
          <DataTable rows={detail.data!.props} sort="week" maxHeight={420} cols={[
            { key: 'week', label: 'Wk', left: true },
            { key: 'prop_type', label: 'Prop', left: true, render: (r) => r.prop_type.replace(/_/g, ' ') },
            { key: 'vendor', label: 'Book', left: true, render: (r) => <span className="muted">{r.vendor}</span> },
            { key: 'line', label: 'Line', render: (r) => n1(r.line) },
            { key: 'actual', label: 'Actual', render: (r) => n0(r.actual) },
            { key: 'outcome', label: 'Outcome', render: (r) => <span className={`pill ${['over', 'hit'].includes(r.outcome) ? 'good' : ['under', 'miss'].includes(r.outcome) ? 'bad' : ''}`}>{r.outcome}</span> },
          ]} />
        </Card>
      )}

      <Card title="Career" className="flush section">
        <DataTable rows={seasons} sort="season" rowKey={(r) => `${r.season}:${r.season_type}`} cols={[
          { key: 'season', label: 'Season', left: true, render: (r) => <a className="link" href="#" onClick={(e) => { e.preventDefault(); setSel({ season: r.season, st: r.season_type }); }}>{r.season}{r.season_type === 3 ? ' (post)' : ''}</a> },
          { key: 'games', label: 'G' },
          { key: 'passing_yards', label: 'Pass yds', render: (r) => r.passing_yards ? n0(r.passing_yards) : '—' },
          { key: 'passing_touchdowns', label: 'Pass TD', render: (r) => r.passing_yards ? r.passing_touchdowns : '—' },
          { key: 'passer_rating', label: 'Rating', render: (r) => n1(r.passer_rating) },
          { key: 'rushing_yards', label: 'Rush yds', render: (r) => n0(r.rushing_yards) },
          { key: 'receptions', label: 'Rec', render: (r) => r.receiving_targets ? `${r.receptions}/${r.receiving_targets}` : '—', value: (r) => r.receptions },
          { key: 'receiving_yards', label: 'Rec yds', render: (r) => n0(r.receiving_yards) },
          { key: 'target_share', label: 'Tgt %', render: (r) => pct(r.target_share, 1) },
          { key: `${k}_pg`, label: 'Pts/G', render: (r) => n1(r[`${k}_pg`]) },
          { key: `${k}_total`, label: 'Total', render: (r) => n1(r[`${k}_total`]) },
        ]} />
      </Card>
    </div>
  );
}
