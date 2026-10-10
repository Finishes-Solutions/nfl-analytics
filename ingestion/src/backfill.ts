/**
 * backfill.ts — historical backfill orchestrator (2002 -> current).
 *
 * Usage:
 *   npx tsx src/backfill.ts --phase teams
 *   npx tsx src/backfill.ts --phase all --from 2002 --to 2025
 *
 * Phases (run order matters for the first full backfill):
 *   teams -> players -> games -> [probe] -> player_stats -> team_stats ->
 *   season_stats -> team_season_stats -> standings -> advanced -> plays ->
 *   odds -> opening_odds -> opening_props -> rosters -> injuries
 *
 * Respects dbo.coverage_map when populated (run probe.ts after games).
 * Progress is checkpointed in dbo.sync_state, so re-running a phase resumes
 * at season granularity instead of starting over.
 */
import { paginate, get } from './api';
import { upsertRows, insertRows, query, closePool, toSqlDate, ODDS_DEDUPE } from './db';
import * as T from './tables';
import * as X from './transform';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);

const FROM = Number(args.get('from') ?? process.env.BACKFILL_FROM ?? 2002);
const TO = Number(args.get('to') ?? process.env.BACKFILL_TO ?? new Date().getFullYear());
const PHASE = args.get('phase') ?? 'all';

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

// ---- sync_state checkpoints ------------------------------------------------

async function getWatermark(scope: string): Promise<string | null> {
  const r = await query<{ watermark: string }>(
    `SELECT watermark FROM dbo.sync_state WHERE scope = '${scope.replace(/'/g, "''")}'`);
  return r[0]?.watermark ?? null;
}

async function setWatermark(scope: string, watermark: string, note = ''): Promise<void> {
  await upsertRows(T.syncState, [{
    scope, watermark, last_run: toSqlDate(new Date().toISOString()), note,
  }]);
}

/** seasons that have data per coverage_map; falls back to full range if probe hasn't run */
async function coveredSeasons(endpoint: string, seasonType: number): Promise<number[]> {
  const r = await query<{ season: number }>(`
    SELECT season FROM dbo.coverage_map
    WHERE endpoint = '${endpoint}' AND season_type = ${seasonType} AND has_data = 1
      AND season BETWEEN ${FROM} AND ${TO} ORDER BY season`);
  if (r.length) return r.map((x) => x.season);
  const all: number[] = [];
  for (let s = FROM; s <= TO; s++) all.push(s);
  return all;
}

const fieldsAfterKeys = (spec: T.TableSpec, skip: string[]): string[] =>
  spec.columns.filter((c) => !c.pk && !skip.includes(c.name)).map((c) => c.name);

// ---- phases ----------------------------------------------------------------

async function phaseTeams() {
  const page = await get<any>('/nfl/v1/teams');
  const n = await upsertRows(T.teams, page.data.map(X.teamRow));
  log(`teams: ${n} rows`);
}

async function phasePlayers() {
  let n = 0;
  for await (const batch of paginate<any>('/nfl/v1/players')) {
    n += await upsertRows(T.players, batch.map((p) => X.playerRow(p, null)));
  }
  log(`players: ${n} historical rows`);
  // flag active players (second pass overwrites is_active)
  let a = 0;
  for await (const batch of paginate<any>('/nfl/v1/players/active')) {
    a += await upsertRows(T.players, batch.map((p) => X.playerRow(p, true)));
  }
  log(`players: ${a} active-flagged`);
}

async function phaseGames() {
  for (let season = FROM; season <= TO; season++) {
    for (const st of [1, 2, 3]) {
      const scope = `backfill:games:${season}:${st}`;
      if (await getWatermark(scope) === 'done') continue;
      let n = 0;
      for await (const batch of paginate<any>('/nfl/v1/games', { 'seasons[]': [season], season_type: st })) {
        n += await upsertRows(T.games, batch.map((g) => X.gameRow(g, st)));
      }
      await setWatermark(scope, 'done', `${n} rows`);
      log(`games ${season} st=${st}: ${n} rows`);
    }
  }
}

async function phasePlayerStats() {
  for (const st of [1, 2, 3]) {
    for (const season of await coveredSeasons('stats', st)) {
      const scope = `backfill:stats:${season}:${st}`;
      if (await getWatermark(scope) === 'done') continue;
      let n = 0;
      for await (const batch of paginate<any>('/nfl/v1/stats', { 'seasons[]': [season], season_type: st })) {
        n += await upsertRows(T.playerGameStats, batch.map((s) => X.playerGameStatRow(s, st)));
      }
      await setWatermark(scope, 'done', `${n} rows`);
      log(`player stats ${season} st=${st}: ${n} rows`);
    }
  }
}

async function phaseTeamStats() {
  for (const st of [1, 2, 3]) {
    for (const season of await coveredSeasons('team_stats', st)) {
      const scope = `backfill:team_stats:${season}:${st}`;
      if (await getWatermark(scope) === 'done') continue;
      let n = 0;
      for await (const batch of paginate<any>('/nfl/v1/team_stats', { 'seasons[]': [season], season_type: st })) {
        n += await upsertRows(T.teamGameStats, batch.map((s) => X.teamGameStatRow(s, st)));
      }
      await setWatermark(scope, 'done', `${n} rows`);
      log(`team stats ${season} st=${st}: ${n} rows`);
    }
  }
}

async function phaseSeasonStats() {
  const extra = fieldsAfterKeys(T.playerSeasonStats, ['games_played', 'postseason']);
  for (const st of [2, 3]) {
    for (const season of await coveredSeasons('season_stats', st)) {
      const scope = `backfill:season_stats:${season}:${st}`;
      if (await getWatermark(scope) === 'done') continue;
      let n = 0;
      for await (const batch of paginate<any>('/nfl/v1/season_stats', { season, season_type: st })) {
        n += await upsertRows(T.playerSeasonStats, batch.map((s) => X.playerSeasonStatRow(s, season, st, extra)));
      }
      await setWatermark(scope, 'done', `${n} rows`);
      log(`season stats ${season} st=${st}: ${n} rows`);
    }
  }
}

async function phaseTeamSeasonStats() {
  const teamIds = (await query<{ id: number }>('SELECT id FROM dbo.teams')).map((t) => t.id);
  if (!teamIds.length) throw new Error('run --phase teams first');
  for (const st of [2, 3]) {
    for (const season of await coveredSeasons('team_season_stats', st)) {
      const scope = `backfill:team_season_stats:${season}:${st}`;
      if (await getWatermark(scope) === 'done') continue;
      let n = 0;
      for await (const batch of paginate<any>('/nfl/v1/team_season_stats',
        { season, season_type: st, 'team_ids[]': teamIds })) {
        n += await upsertRows(T.teamSeasonStats, batch.map(X.teamSeasonStatRow));
      }
      await setWatermark(scope, 'done', `${n} rows`);
      log(`team season stats ${season} st=${st}: ${n} rows`);
    }
  }
}

async function phaseStandings() {
  for (const season of await coveredSeasons('standings', 2)) {
    const page = await get<any>('/nfl/v1/standings', { season });
    const n = await upsertRows(T.standings, page.data.map(X.standingsRow));
    log(`standings ${season}: ${n} rows`);
  }
}

async function phaseAdvanced() {
  const targets = [
    { path: '/nfl/v1/advanced_stats/passing', spec: T.advPassing, cov: 'advanced_passing' },
    { path: '/nfl/v1/advanced_stats/rushing', spec: T.advRushing, cov: 'advanced_rushing' },
    { path: '/nfl/v1/advanced_stats/receiving', spec: T.advReceiving, cov: 'advanced_receiving' },
  ];
  for (const t of targets) {
    const fields = fieldsAfterKeys(t.spec, ['postseason']);
    for (const st of [2, 3]) {
      for (const season of await coveredSeasons(t.cov, st)) {
        const scope = `backfill:${t.cov}:${season}:${st}`;
        if (await getWatermark(scope) === 'done') continue;
        let n = 0;
        // week 0 = season aggregate; weeks 1..22 = weekly rows. Querying without a
        // week param returns week-0 rows in observed payloads, so iterate explicitly.
        for (const week of [0, ...Array.from({ length: 22 }, (_, i) => i + 1)]) {
          for await (const batch of paginate<any>(t.path, { season, season_type: st, week })) {
            n += await upsertRows(t.spec, batch.map((s) => X.advStatRow(s, st, fields)));
          }
        }
        await setWatermark(scope, 'done', `${n} rows`);
        log(`${t.cov} ${season} st=${st}: ${n} rows`);
      }
    }
  }
}

async function phasePlays() {
  const gamesToFetch = await query<{ id: number; season: number; week: number | null; season_type: number }>(`
    SELECT g.id, g.season, g.week, g.season_type
    FROM dbo.games g
    WHERE g.season BETWEEN ${FROM} AND ${TO}
      AND NOT EXISTS (SELECT 1 FROM dbo.sync_state s WHERE s.scope = CONCAT('backfill:plays:', g.id) AND s.watermark = 'done')
      AND EXISTS (SELECT 1 FROM dbo.coverage_map c
                  WHERE c.endpoint = 'plays' AND c.season = g.season
                    AND c.season_type = g.season_type AND c.has_data = 1)
    ORDER BY g.season, g.id`);
  log(`plays: ${gamesToFetch.length} games to fetch`);
  for (const g of gamesToFetch) {
    let n = 0;
    // season_type MUST be passed: the endpoint defaults to regular season and
    // silently returns nothing for postseason games otherwise.
    for await (const batch of paginate<any>('/nfl/v1/plays', { game_id: g.id, season_type: g.season_type })) {
      n += await upsertRows(T.plays, batch.map((p) => X.playRow(p, g)));
    }
    await setWatermark(`backfill:plays:${g.id}`, 'done', `${n} plays`);
    if (g.id % 50 === 0) log(`plays progress: game ${g.id} (${g.season})`);
  }
  log('plays: done');
}

async function phaseOdds() {
  // odds exist from 2025 week 8 onward only
  for (let season = Math.max(FROM, 2025); season <= TO; season++) {
    const startWeek = season === 2025 ? 8 : 1;
    for (let week = startWeek; week <= 22; week++) {
      for await (const batch of paginate<any>('/nfl/v1/odds', { season, week })) {
        // stamp with the vendor's updated_at, not the backfill time; skip lines
        // already archived by game-day sync so re-runs don't duplicate history
        await insertRows(T.oddsSnapshots, batch.map(X.oddsSnapshotRow), new Date(),
          { capturedAtFrom: 'api_updated_at', dedupe: ODDS_DEDUPE });
      }
    }
    log(`odds snapshots backfilled for ${season}`);
  }
}

async function phaseOpeningOdds() {
  for (let season = Math.max(FROM, 2025); season <= TO; season++) {
    const startWeek = season === 2025 ? 8 : 1;
    for (let week = startWeek; week <= 22; week++) {
      for await (const batch of paginate<any>('/nfl/v1/odds/opening', { season, week })) {
        await upsertRows(T.oddsOpening, batch.map(X.oddsOpeningRow));
      }
    }
    log(`opening odds backfilled for ${season}`);
  }
}

async function phaseOpeningProps() {
  // coverage: most recently completed season + ongoing; try recent games only
  const games = await query<{ id: number }>(`
    SELECT id FROM dbo.games
    WHERE season >= ${Math.max(FROM, 2025)}
      AND NOT EXISTS (SELECT 1 FROM dbo.sync_state s
                      WHERE s.scope = CONCAT('backfill:opening_props:', games.id) AND s.watermark = 'done')
    ORDER BY id`);
  for (const g of games) {
    try {
      const page = await get<any>('/nfl/v1/odds/player_props/opening', { game_id: g.id });
      if (page.data?.length) await insertRows(T.propOpening, page.data.map(X.propOpeningRow));
      await setWatermark(`backfill:opening_props:${g.id}`, 'done', `${page.data?.length ?? 0} props`);
    } catch (err) {
      log(`opening props game ${g.id} failed: ${(err as Error).message}`);
    }
  }
  log('opening props: done');
}

async function phaseRosters() {
  const teamIds = (await query<{ id: number }>('SELECT id FROM dbo.teams')).map((t) => t.id);
  const season = TO; // roster data exists 2025+ and defaults to most recent
  const now = new Date();
  for (const id of teamIds) {
    try {
      const page = await get<any>(`/nfl/v1/teams/${id}/roster`, { season });
      await insertRows(T.rosterSnapshots, page.data.map((e: any) => X.rosterRow(e, id, season)), now);
    } catch (err) {
      log(`roster team ${id} failed: ${(err as Error).message}`);
    }
  }
  log('roster snapshot captured');
}

async function phaseInjuries() {
  const now = new Date();
  let n = 0;
  for await (const batch of paginate<any>('/nfl/v1/player_injuries')) {
    n += await insertRows(T.injurySnapshots, batch.map(X.injuryRow), now);
  }
  log(`injury snapshot captured: ${n} rows`);
}

// ---- main ------------------------------------------------------------------

const PHASES: Record<string, () => Promise<void>> = {
  teams: phaseTeams,
  players: phasePlayers,
  games: phaseGames,
  player_stats: phasePlayerStats,
  team_stats: phaseTeamStats,
  season_stats: phaseSeasonStats,
  team_season_stats: phaseTeamSeasonStats,
  standings: phaseStandings,
  advanced: phaseAdvanced,
  plays: phasePlays,
  odds: phaseOdds,
  opening_odds: phaseOpeningOdds,
  opening_props: phaseOpeningProps,
  rosters: phaseRosters,
  injuries: phaseInjuries,
};

const ORDER = Object.keys(PHASES);

async function main() {
  const toRun = PHASE === 'all' ? ORDER : [PHASE];
  for (const name of toRun) {
    const fn = PHASES[name];
    if (!fn) throw new Error(`unknown phase '${name}'. Valid: all, ${ORDER.join(', ')}`);
    log(`=== phase: ${name} (seasons ${FROM}-${TO}) ===`);
    await fn();
  }
  await closePool();
  log('backfill complete');
}

main().catch(async (e) => {
  console.error(e);
  await closePool().catch(() => {});
  process.exit(1);
});
