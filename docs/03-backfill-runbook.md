# 03 — Backfill Runbook (2002 → now)

Time budget: ~1–2 hours wall clock at 550 req/min. Everything checkpoints to
`dbo.sync_state` at season (plays: per-game) granularity — kill and re-run freely.

## Order matters

```bash
npm run backfill -- --phase teams      # 32 rows, seconds
npm run backfill -- --phase players    # all-time + active flags, ~2–3 min
npm run backfill -- --phase games      # every season × pre/reg/post
npm run probe                          # ← REVIEW coverage_map BEFORE continuing
npm run backfill -- --phase all        # remaining phases honor coverage_map
```

Why games-then-probe: the plays probe needs real game IDs, and every later
phase loops only over seasons the probe verified. Expectations: advanced stats
likely floor ~2016–2018 (tracking data), plays and team_stats somewhere in the
2000s–2010s. `SELECT * FROM coverage_map WHERE has_data = 0 ORDER BY endpoint, season;`

## Phase inventory (backfill --phase X)

teams · players · games · player_stats · team_stats · season_stats ·
team_season_stats · standings · advanced · plays · odds · opening_odds ·
opening_props · rosters · injuries

Notes:
- **games/stats/team_stats** run all three season_types; playoffs are NOT the default upstream.
- **advanced** iterates week 0 (season aggregate) + weeks 1–22 explicitly. If the API returns all weeks without the param, the loop is redundant but harmless (upserts).
- **odds/opening_odds** only exist from 2025 week 8 → the loops start there automatically.
- **opening_props** covers the most recent season only (upstream limitation).
- **rosters/injuries** are snapshot captures of *current* state — history starts the day you start running them.

## Resuming & re-running

- Completed scopes are skipped (`sync_state.watermark = 'done'`).
- Force a season redo: `DELETE FROM sync_state WHERE scope = 'backfill:stats:2019:2';`
- All writes are MERGE upserts — re-running a completed phase is a no-op, not duplication.

## Validation queries (after full run)

```sql
SELECT season, season_type, COUNT(*) games FROM games GROUP BY season, season_type ORDER BY 1,2;
-- expect ~256–285 reg games/season, 11–13 post, preseason varies

SELECT season, COUNT(*) FROM player_game_stats GROUP BY season ORDER BY 1;
-- expect ~20k–28k rows/season within covered years

SELECT TOP 20 * FROM v_player_fantasy_season
WHERE season = 2024 AND season_type = 2 ORDER BY fp_ppr_total DESC;
-- sanity: top of this list should look like the actual 2024 fantasy leaders
```

That last query is the real acceptance test: if the leaderboard looks wrong,
a stat column probably missed its mapping — check raw_json on a sample row.
