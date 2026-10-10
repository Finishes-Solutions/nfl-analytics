import { ago, dateTime, n0, pct, useApi } from '../lib';
import type { Row } from '../types';
import { Card, DataTable, ErrorBox } from '../components/ui';

/** Thresholds (hours) after which a table is considered stale during the season. */
const STALE: Record<string, number> = {
  games: 36, player_game_stats: 36, team_game_stats: 36, standings: 48, injury_snapshots: 36,
  roster_snapshots: 48, odds_snapshots: 24 * 8, prop_snapshots: 24 * 8, sync_state: 36,
};

function Status({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return <span className={`pill ${ok ? 'good' : warn ? 'warn' : 'bad'}`}>{ok ? '✓ OK' : warn ? '! Check' : '✕ Stale'}</span>;
}

export function Health() {
  const { data, error, loading } = useApi<{ freshness: Row[]; coverage: Row[]; reconciliation: Row[]; sync: Row[]; coverageMap: Row[]; propTypes: Row[] }>('health');
  const ratio = (a: number, b: number) => (b ? a / b : null);
  return (
    <div className={loading ? 'loading' : ''}>
      <h1>Data health</h1>
      <p className="sub">Is the warehouse current, complete, and internally consistent? Everything here is computed from the 004 data-health views.</p>
      <ErrorBox error={error} />
      <div className="grid g2 section">
        <Card title="Freshness" className="flush">
          <DataTable rows={data?.freshness ?? []} sort="table_name" desc={false} cols={[
            { key: 'table_name', label: 'Table', left: true },
            { key: 'row_count', label: 'Rows', render: (r) => n0(r.row_count) },
            { key: 'last_write', label: 'Last write', render: (r) => <span className="muted">{dateTime(r.last_write)}</span> },
            { key: 'hours_since_write', label: 'Age', render: (r) => r.last_write ? ago(r.hours_since_write) : <span className="muted">{STALE[r.table_name] ? 'never' : 'not tracked'}</span> },
            { key: 'status', label: 'Status', value: (r) => (STALE[r.table_name] ? r.hours_since_write ?? 1e9 : 0),
              render: (r) => STALE[r.table_name] ? <Status ok={r.hours_since_write !== null && r.hours_since_write <= STALE[r.table_name]} /> : <span className="muted">—</span> },
          ]} />
          <p className="note" style={{ padding: '0 18px 12px' }}>Stale flags assume an active season with nightly + game-day sync running. Snapshot tables (injuries, odds, props) can't be backfilled — gaps are permanent.</p>
        </Card>
        <Card title="Recent sync runs" className="flush">
          <DataTable rows={data?.sync ?? []} sort="last_run" cols={[
            { key: 'scope', label: 'Scope', left: true },
            { key: 'watermark', label: 'Watermark', left: true },
            { key: 'last_run', label: 'Last run', render: (r) => dateTime(r.last_run) },
            { key: 'note', label: 'Note', left: true, render: (r) => <span className="muted">{r.note}</span> },
          ]} />
        </Card>
      </div>
      <Card title="Coverage by season" className="flush section">
        <DataTable rows={data?.coverage ?? []} sort="season" maxHeight={520} rowKey={(r) => `${r.season}:${r.season_type}`} cols={[
          { key: 'season', label: 'Season', left: true, render: (r) => `${r.season}${r.season_type === 3 ? ' post' : r.season_type === 1 ? ' pre' : ''}` },
          { key: 'games', label: 'Games' },
          { key: 'final_games', label: 'Final' },
          { key: 'with_player_stats', label: 'Box scores', render: (r) => pct(ratio(r.with_player_stats, r.final_games)) },
          { key: 'with_team_stats', label: 'Team stats', render: (r) => pct(ratio(r.with_team_stats, r.final_games)) },
          { key: 'with_plays', label: 'Play-by-play', render: (r) => pct(ratio(r.with_plays, r.final_games)) },
          { key: 'with_odds', label: 'Odds (games)', render: (r) => n0(r.with_odds) },
          { key: 'final_missing_score', label: 'Final, no score', render: (r) => r.final_missing_score ? <span className="down">{r.final_missing_score}</span> : '0' },
          { key: 'ok', label: 'Status', value: (r) => ratio(r.with_player_stats, r.final_games) ?? 0,
            render: (r) => <Status ok={!r.final_games || (r.with_player_stats === r.final_games && r.with_team_stats === r.final_games && !r.final_missing_score)} warn /> },
        ]} />
      </Card>
      <div className="grid g2 section">
        <Card title="season_stats endpoint vs summed game logs" className="flush">
          <DataTable rows={data?.reconciliation ?? []} sort="season" maxHeight={420} rowKey={(r) => `${r.season}:${r.season_type}`} cols={[
            { key: 'season', label: 'Season', left: true, render: (r) => `${r.season}${r.season_type === 3 ? ' post' : ''}` },
            { key: 'player_seasons', label: 'Rows' },
            { key: 'int_null', label: 'INT null', title: 'Passers whose season INT total is NULL' },
            { key: 'int_mismatch', label: 'INT wrong', title: 'Season INTs disagree with summed game logs' },
            { key: 'pass_yds_mismatch', label: 'Pass yds ≠', title: 'Off by more than 5 yards' },
            { key: 'rush_yds_mismatch', label: 'Rush yds ≠' },
            { key: 'rec_yds_mismatch', label: 'Rec yds ≠' },
            { key: 'qb_rating_null', label: 'Rating null' },
          ]} />
          <p className="note" style={{ padding: '0 18px 12px' }}>Why the views aggregate from game logs (v_player_season_from_games) instead of trusting player_season_stats.</p>
        </Card>
        <div className="grid">
          <Card title="Endpoint coverage (probe)" className="flush">
            <DataTable rows={data?.coverageMap ?? []} sort="endpoint" desc={false} cols={[
              { key: 'endpoint', label: 'Endpoint', left: true },
              { key: 'first_season', label: 'From' },
              { key: 'last_season', label: 'To' },
              { key: 'seasons_with_data', label: 'Seasons' },
            ]} />
          </Card>
          <Card title="Prop types captured" className="flush">
            <DataTable rows={data?.propTypes ?? []} sort="snapshots" maxHeight={260} cols={[
              { key: 'prop_type', label: 'Prop type', left: true },
              { key: 'market_type', label: 'Market', left: true },
              { key: 'snapshots', label: 'Snapshots', render: (r) => n0(r.snapshots) },
            ]} />
          </Card>
        </div>
      </div>
    </div>
  );
}
