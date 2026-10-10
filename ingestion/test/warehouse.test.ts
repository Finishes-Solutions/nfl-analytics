/**
 * Integration tests against a dev SQL Server loaded with tools/gen_dev_data.py.
 * Skipped unless SQL_SERVER is set. They assert invariants of the views (the
 * numbers must add up) and the snapshot insert options in db.ts.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const live = !!process.env.SQL_SERVER && process.env.SQL_SERVER !== 'x';
process.env.BDL_API_KEY ??= 'test';

async function db() { return import('../src/db'); }
after(async () => { if (live) await (await db()).closePool(); });

const one = async <T = Record<string, number>>(sql: string): Promise<T> => (await (await db()).query<T>(sql))[0];

test('season fantasy totals equal the sum of game rows', { skip: !live }, async () => {
  const r = await one(`
    SELECT COUNT(*) AS bad FROM dbo.v_player_fantasy_season s
    JOIN (SELECT player_id, season, season_type, SUM(fp_ppr) AS t, SUM(fp_standard) AS st, COUNT(*) AS g
          FROM dbo.v_player_fantasy_game GROUP BY player_id, season, season_type) g
      ON g.player_id=s.player_id AND g.season=s.season AND g.season_type=s.season_type
    WHERE ABS(s.fp_ppr_total - g.t) > 0.01 OR ABS(s.fp_standard_total - g.st) > 0.01 OR s.games <> g.g`);
  assert.equal(r.bad, 0);
});

test('v_game_results: two mirrored rows per completed game', { skip: !live }, async () => {
  const r = await one(`
    SELECT (SELECT COUNT(*) FROM dbo.v_game_results) AS rows_,
           (SELECT 2*COUNT(*) FROM dbo.games WHERE status LIKE '%Final%' AND home_team_score IS NOT NULL) AS expected,
           (SELECT SUM(margin) FROM dbo.v_game_results) AS margin_sum`);
  assert.equal(r.rows_, r.expected);
  assert.equal(r.margin_sum, 0, 'margins must cancel out across both sides');
});

test('team season summary: W+L+T = games, league wins = league losses', { skip: !live }, async () => {
  const r = await one(`
    SELECT SUM(CASE WHEN wins+losses+ties <> games THEN 1 ELSE 0 END) AS bad,
           SUM(wins) - SUM(losses) AS diff
    FROM dbo.v_team_season_summary`);
  assert.equal(r.bad, 0);
  assert.equal(r.diff, 0);
});

test('points allowed by defenses = points scored by players with a known team', { skip: !live }, async () => {
  const r = await one(`
    SELECT (SELECT CAST(SUM(fp_ppr_allowed_total) AS DECIMAL(12,2)) FROM dbo.v_fantasy_points_allowed WHERE season=2025) AS allowed,
           (SELECT CAST(SUM(fp_ppr) AS DECIMAL(12,2)) FROM dbo.v_player_fantasy_game WHERE season=2025 AND team_id IS NOT NULL) AS scored`);
  assert.equal(Number(r.allowed), Number(r.scored));
});

test('usage shares are fractions and team target shares sum to 1 per game', { skip: !live }, async () => {
  const r = await one(`
    SELECT SUM(CASE WHEN target_share < 0 OR target_share > 1 OR carry_share < 0 OR carry_share > 1 THEN 1 ELSE 0 END) AS out_of_range,
           (SELECT COUNT(*) FROM (SELECT game_id, team_id, SUM(target_share) s FROM dbo.v_player_game_context
                                  WHERE team_targets > 0 GROUP BY game_id, team_id HAVING ABS(SUM(target_share) - 1) > 0.02) x) AS bad_sums
    FROM dbo.v_player_game_context`);
  assert.equal(r.out_of_range, 0);
  assert.equal(r.bad_sums, 0);
});

test('rolling 3-game average matches a manual window', { skip: !live }, async () => {
  const r = await one(`
    SELECT player_id, season, season_type, game_no, fp_ppr, fp_ppr_roll3
    INTO #c FROM dbo.v_player_game_context WHERE season=2025;
    SELECT COUNT(*) AS bad FROM #c c
    JOIN #c x ON x.player_id=c.player_id AND x.season=c.season AND x.season_type=c.season_type
             AND x.game_no BETWEEN c.game_no-2 AND c.game_no
    GROUP BY c.player_id, c.season, c.season_type, c.game_no, c.fp_ppr_roll3
    HAVING ABS(AVG(x.fp_ppr) - c.fp_ppr_roll3) > 0.01`);
  assert.equal(r?.bad ?? 0, 0);
});

test('ATS + totals grading agrees with scores', { skip: !live }, async () => {
  const r = await one(`
    SELECT SUM(CASE WHEN (ats_winner='home' AND home_margin + close_spread_home <= 0)
                      OR (ats_winner='away' AND home_margin + close_spread_home >= 0)
                      OR (total_result='over' AND total_scored <= close_total) THEN 1 ELSE 0 END) AS bad,
           COUNT(*) AS graded
    FROM dbo.v_game_lines WHERE ats_winner IS NOT NULL`);
  assert.equal(r.bad, 0);
  assert.ok(r.graded > 0);
});

test('prop outcomes are consistent with line vs actual', { skip: !live }, async () => {
  const r = await one(`
    SELECT SUM(CASE WHEN (outcome='over' AND actual <= line) OR (outcome='under' AND actual >= line)
                      OR (outcome='hit' AND actual < ISNULL(line,1)) THEN 1 ELSE 0 END) AS bad
    FROM dbo.v_prop_results`);
  assert.equal(r.bad, 0);
});

test('insertRows: dedupe skips unchanged lines, capturedAtFrom stamps history', { skip: !live }, async () => {
  const D = await db();
  const T = await import('../src/tables');
  const X = await import('../src/transform');
  const GAME = 2_000_000_001;
  await D.query(`DELETE FROM dbo.odds_snapshots WHERE game_id = ${GAME}`);
  try {
    const raw = { id: 77, game_id: GAME, vendor: 'testbook', spread_home_value: '-3.5', spread_away_value: '3.5',
      total_value: '44.5', updated_at: '2025-11-01T12:00:00.000Z' };
    const row = X.oddsSnapshotRow(raw);
    // backfill path: vendor timestamp, not "now"
    assert.equal(await D.insertRows(T.oddsSnapshots, [row], new Date(), { capturedAtFrom: 'api_updated_at', dedupe: D.ODDS_DEDUPE }), 1);
    const stamped = await one<{ captured_at: Date }>(`SELECT captured_at FROM dbo.odds_snapshots WHERE game_id=${GAME}`);
    assert.equal(stamped.captured_at.toISOString(), '2025-11-01T12:00:00.000Z');
    // game-day path: identical line again -> skipped
    assert.equal(await D.insertRows(T.oddsSnapshots, [row], new Date(), { dedupe: D.ODDS_DEDUPE }), 0);
    // line moves -> inserted; NULL-vs-NULL odds compare equal (INTERSECT semantics)
    const moved = X.oddsSnapshotRow({ ...raw, spread_home_value: '-4.5', spread_away_value: '4.5' });
    assert.equal(await D.insertRows(T.oddsSnapshots, [moved], new Date(), { dedupe: D.ODDS_DEDUPE }), 1);
    assert.equal(await D.insertRows(T.oddsSnapshots, [moved], new Date(), { dedupe: D.ODDS_DEDUPE }), 0);
    // moving back to the original line is a real change and must be recorded
    assert.equal(await D.insertRows(T.oddsSnapshots, [row], new Date(), { dedupe: D.ODDS_DEDUPE }), 1);
    // without options: plain append (old behaviour)
    assert.equal(await D.insertRows(T.oddsSnapshots, [row]), 1);
  } finally {
    await D.query(`DELETE FROM dbo.odds_snapshots WHERE game_id = ${GAME}`);
  }
});

test('insertRows rejects unknown option columns', { skip: !live }, async () => {
  const D = await db();
  const T = await import('../src/tables');
  await assert.rejects(D.insertRows(T.oddsSnapshots, [{}], new Date(), { capturedAtFrom: 'nope' }), /unknown column/);
});
