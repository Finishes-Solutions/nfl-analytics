/**
 * sync.ts — keeps the warehouse current after the backfill.
 *
 * Modes:
 *   npx tsx src/sync.ts --mode nightly    (run once daily via Azure Function timer)
 *   npx tsx src/sync.ts --mode gameday    (run every 1-15 min on game days)
 *
 * nightly: refresh current-season games/stats/team stats for the last 3 weeks,
 *          season aggregates, standings, advanced stats (current season),
 *          plus injury + roster snapshots.
 * gameday: refresh live/recent games + their box scores + plays tail, and
 *          snapshot odds + player props (the data the API does not keep).
 *
 * Deploy either as an Azure Function timer trigger calling these entry points,
 * or as cron on any always-on compute. All writes are idempotent upserts or
 * append-only snapshots, so overlapping runs are safe.
 */
import { paginate, get } from './api';
import { upsertRows, insertRows, query, closePool, ODDS_DEDUPE, PROPS_DEDUPE } from './db';
import * as T from './tables';
import * as X from './transform';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const MODE = args.get('mode') ?? 'nightly';
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

/** NFL season year: Aug-Dec -> current year; Jan-Jul -> previous year */
function currentSeason(): number {
  const now = new Date();
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

async function refreshRecentWeeks(season: number) {
  const recent = await query<{ season_type: number; week: number }>(`
    SELECT DISTINCT season_type, week FROM dbo.games
    WHERE season = ${season} AND game_date >= DATEADD(DAY, -21, SYSUTCDATETIME())`);
  const bySt = new Map<number, number[]>();
  for (const r of recent) {
    if (!bySt.has(r.season_type)) bySt.set(r.season_type, []);
    bySt.get(r.season_type)!.push(r.week);
  }
  // also pull the full current-season schedule so newly announced games appear
  for (const st of [1, 2, 3]) {
    for await (const batch of paginate<any>('/nfl/v1/games', { 'seasons[]': [season], season_type: st })) {
      await upsertRows(T.games, batch.map((g) => X.gameRow(g, st)));
    }
  }
  for (const [st, weeks] of bySt) {
    for await (const batch of paginate<any>('/nfl/v1/stats',
      { 'seasons[]': [season], season_type: st, /* weeks not filterable on stats; season-scoped refresh */ })) {
      await upsertRows(T.playerGameStats, batch.map((s) => X.playerGameStatRow(s, st)));
    }
    for await (const batch of paginate<any>('/nfl/v1/team_stats', { 'seasons[]': [season], season_type: st })) {
      await upsertRows(T.teamGameStats, batch.map((s) => X.teamGameStatRow(s, st)));
    }
    log(`refreshed stats season=${season} st=${st} (weeks in window: ${weeks.join(',')})`);
  }
}

async function nightly() {
  const season = currentSeason();
  await refreshRecentWeeks(season);

  // season aggregates + standings
  const extra = T.playerSeasonStats.columns
    .filter((c) => !c.pk && !['games_played', 'postseason'].includes(c.name)).map((c) => c.name);
  for (const st of [2, 3]) {
    for await (const batch of paginate<any>('/nfl/v1/season_stats', { season, season_type: st })) {
      await upsertRows(T.playerSeasonStats, batch.map((s) => X.playerSeasonStatRow(s, season, st, extra)));
    }
  }
  const teamIds = (await query<{ id: number }>('SELECT id FROM dbo.teams')).map((t) => t.id);
  for (const st of [2, 3]) {
    for await (const batch of paginate<any>('/nfl/v1/team_season_stats',
      { season, season_type: st, 'team_ids[]': teamIds })) {
      await upsertRows(T.teamSeasonStats, batch.map(X.teamSeasonStatRow));
    }
  }
  const standingsPage = await get<any>('/nfl/v1/standings', { season });
  await upsertRows(T.standings, standingsPage.data.map(X.standingsRow));

  // advanced stats, current season, week 0 + recent weeks
  const advTargets = [
    { path: '/nfl/v1/advanced_stats/passing', spec: T.advPassing },
    { path: '/nfl/v1/advanced_stats/rushing', spec: T.advRushing },
    { path: '/nfl/v1/advanced_stats/receiving', spec: T.advReceiving },
  ];
  for (const t of advTargets) {
    const fields = t.spec.columns.filter((c) => !c.pk && c.name !== 'postseason').map((c) => c.name);
    for (const st of [2, 3]) {
      for (const week of [0, ...Array.from({ length: 22 }, (_, i) => i + 1)]) {
        for await (const batch of paginate<any>(t.path, { season, season_type: st, week })) {
          await upsertRows(t.spec, batch.map((s) => X.advStatRow(s, st, fields)));
        }
      }
    }
  }

  // daily snapshots: injuries + rosters (append-only history the API discards)
  const now = new Date();
  for await (const batch of paginate<any>('/nfl/v1/player_injuries')) {
    await insertRows(T.injurySnapshots, batch.map(X.injuryRow), now);
  }
  for (const id of teamIds) {
    try {
      const page = await get<any>(`/nfl/v1/teams/${id}/roster`, { season });
      await insertRows(T.rosterSnapshots, page.data.map((e: any) => X.rosterRow(e, id, season)), now);
    } catch { /* roster is 2025+ / GOAT-gated; skip failures */ }
  }
  // sweep any new players
  for await (const batch of paginate<any>('/nfl/v1/players/active')) {
    await upsertRows(T.players, batch.map((p) => X.playerRow(p, true)));
  }
  log('nightly sync complete');
}

async function gameday() {
  const season = currentSeason();
  const now = new Date();

  // games in a live window: started in last 6h or starting within 1h
  const live = await query<{ id: number; season_type: number; week: number | null }>(`
    SELECT id, season_type, week FROM dbo.games
    WHERE season = ${season}
      AND game_date BETWEEN DATEADD(HOUR, -6, SYSUTCDATETIME()) AND DATEADD(HOUR, 1, SYSUTCDATETIME())`);
  if (!live.length) { log('gameday: no live-window games'); return; }
  const ids = live.map((g) => g.id);
  const weeks = [...new Set(live.map((g) => g.week).filter((w): w is number => w != null))];
  log(`gameday: ${ids.length} live-window games (weeks ${weeks.join(',')})`);

  // scores
  for (const st of [...new Set(live.map((g) => g.season_type))]) {
    for await (const batch of paginate<any>('/nfl/v1/games',
      { 'seasons[]': [season], season_type: st, 'weeks[]': weeks })) {
      await upsertRows(T.games, batch.map((g) => X.gameRow(g, st)));
    }
  }
  // box scores + team stats + plays tail per live game
  for (const g of live) {
    for await (const batch of paginate<any>('/nfl/v1/stats', { 'game_ids[]': [g.id], season_type: g.season_type })) {
      await upsertRows(T.playerGameStats, batch.map((s) => X.playerGameStatRow(s, g.season_type)));
    }
    for await (const batch of paginate<any>('/nfl/v1/team_stats', { 'game_ids[]': [g.id], season_type: g.season_type })) {
      await upsertRows(T.teamGameStats, batch.map((s) => X.teamGameStatRow(s, g.season_type)));
    }
    for await (const batch of paginate<any>('/nfl/v1/plays', { game_id: g.id, season_type: g.season_type })) {
      await upsertRows(T.plays, batch.map((p) => X.playRow(p, { season, week: g.week, season_type: g.season_type })));
    }
    // player props snapshot (LIVE-only data; this is the archive nobody else has)
    try {
      const props = await get<any>('/nfl/v1/odds/player_props', { game_id: g.id });
      if (props.data?.length) await insertRows(T.propSnapshots, props.data.map(X.propSnapshotRow), now, { dedupe: PROPS_DEDUPE });
    } catch { /* props vanish near game end; expected */ }
  }
  // odds snapshot for the active weeks
  for (const week of weeks) {
    for await (const batch of paginate<any>('/nfl/v1/odds', { season, week })) {
      await insertRows(T.oddsSnapshots, batch.map(X.oddsSnapshotRow), now, { dedupe: ODDS_DEDUPE });
    }
  }
  log('gameday sync complete');
}

(MODE === 'gameday' ? gameday() : nightly())
  .then(() => closePool())
  .catch(async (e) => { console.error(e); await closePool().catch(() => {}); process.exit(1); });
