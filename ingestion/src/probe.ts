/**
 * probe.ts — discover actual historical coverage per endpoint before backfilling.
 * The docs claim "2002-current" but plays/advanced/team stats almost certainly
 * have later floors (tracking data didn't exist in 2002). One cheap request per
 * (endpoint, season, season_type) records reality into coverage_map, and the
 * backfill then loops only over seasons that actually have data.
 *
 * Run: npx tsx src/probe.ts            (probes BACKFILL_FROM..BACKFILL_TO)
 */
import { get } from './api';
import { upsertRows, closePool, toSqlDate, query } from './db';
import { coverageMap } from './tables';
import { config } from './config';

interface ProbeTarget {
  endpoint: string;
  path: string;
  seasonTypes: number[];
  params: (season: number, seasonType: number) => Record<string, any>;
}

const TARGETS: ProbeTarget[] = [
  { endpoint: 'games', path: '/nfl/v1/games', seasonTypes: [1, 2, 3],
    params: (s, st) => ({ 'seasons[]': [s], season_type: st }) },
  { endpoint: 'stats', path: '/nfl/v1/stats', seasonTypes: [1, 2, 3],
    params: (s, st) => ({ 'seasons[]': [s], season_type: st }) },
  { endpoint: 'team_stats', path: '/nfl/v1/team_stats', seasonTypes: [1, 2, 3],
    params: (s, st) => ({ 'seasons[]': [s], season_type: st }) },
  { endpoint: 'season_stats', path: '/nfl/v1/season_stats', seasonTypes: [2, 3],
    params: (s, st) => ({ season: s, season_type: st }) },
  { endpoint: 'team_season_stats', path: '/nfl/v1/team_season_stats', seasonTypes: [2, 3],
    params: (s, st) => ({ season: s, season_type: st, 'team_ids[]': [1] }) },
  { endpoint: 'standings', path: '/nfl/v1/standings', seasonTypes: [2],
    params: (s) => ({ season: s }) },
  { endpoint: 'advanced_passing', path: '/nfl/v1/advanced_stats/passing', seasonTypes: [2, 3],
    params: (s, st) => ({ season: s, season_type: st }) },
  { endpoint: 'advanced_rushing', path: '/nfl/v1/advanced_stats/rushing', seasonTypes: [2, 3],
    params: (s, st) => ({ season: s, season_type: st }) },
  { endpoint: 'advanced_receiving', path: '/nfl/v1/advanced_stats/receiving', seasonTypes: [2, 3],
    params: (s, st) => ({ season: s, season_type: st }) },
];

async function main() {
  const { fromSeason, toSeason } = config.backfill;
  const rows: Record<string, unknown>[] = [];

  for (const t of TARGETS) {
    for (let season = fromSeason; season <= toSeason; season++) {
      for (const st of t.seasonTypes) {
        let hasData = false;
        let count = 0;
        try {
          const page = await get<any>(t.path, { ...t.params(season, st), per_page: 1 });
          count = page.data?.length ?? 0;
          hasData = count > 0;
        } catch (err) {
          console.warn(`probe ${t.endpoint} ${season}/${st} failed: ${(err as Error).message}`);
        }
        rows.push({
          endpoint: t.endpoint, season, season_type: st,
          has_data: hasData ? 1 : 0, sample_count: count,
          checked_at: toSqlDate(new Date().toISOString()),
        });
        console.log(`${t.endpoint.padEnd(20)} ${season} st=${st} -> ${hasData ? 'DATA' : 'empty'}`);
      }
    }
  }

  await upsertRows(coverageMap, rows);

  // plays coverage: needs a game_id, so probe one game per (season, type) already in DB
  const sampleGames = await query<{ season: number; season_type: number; id: number }>(`
    SELECT season, season_type, MIN(id) AS id
    FROM dbo.games
    WHERE season BETWEEN ${fromSeason} AND ${toSeason} AND status = 'Final'
    GROUP BY season, season_type`);
  const playRows: Record<string, unknown>[] = [];
  for (const g of sampleGames) {
    let hasData = false;
    try {
      const page = await get<any>('/nfl/v1/plays', { game_id: g.id, season_type: g.season_type, per_page: 1 });
      hasData = (page.data?.length ?? 0) > 0;
    } catch { /* keep false */ }
    playRows.push({
      endpoint: 'plays', season: g.season, season_type: g.season_type,
      has_data: hasData ? 1 : 0, sample_count: hasData ? 1 : 0,
      checked_at: toSqlDate(new Date().toISOString()),
    });
    console.log(`plays               ${g.season} st=${g.season_type} (game ${g.id}) -> ${hasData ? 'DATA' : 'empty'}`);
  }
  if (playRows.length) await upsertRows(coverageMap, playRows);
  else console.log('plays probe skipped: run games backfill first, then re-run probe');

  await closePool();
  console.log('Coverage probe complete. Query dbo.coverage_map to review before backfilling.');
}

main().catch((e) => { console.error(e); process.exit(1); });
