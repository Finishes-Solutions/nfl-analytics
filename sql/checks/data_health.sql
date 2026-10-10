/* =============================================================================
   data_health.sql — READ-ONLY warehouse report. Safe to run any time.
   Uses base tables only (no 004 views), so it works before migrations.
   Run:  GitHub → Actions → "SQL (apply / check)" → action=check
         or locally: cd ingestion && npx tsx src/run-sql.ts check ../sql/checks/data_health.sql
============================================================================= */

-- @check objects: which analytics views are installed
SELECT name, type_desc, CONVERT(VARCHAR(19), modify_date, 120) AS modified
FROM sys.objects
WHERE SCHEMA_NAME(schema_id) = 'dbo' AND type IN ('V', 'P')
ORDER BY name;
GO

-- @check row counts (metadata, no scans)
SELECT o.name AS table_name, CAST(SUM(p.rows) AS INT) AS row_count
FROM sys.objects o JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
WHERE o.type = 'U' AND SCHEMA_NAME(o.schema_id) = 'dbo'
GROUP BY o.name ORDER BY o.name;
GO

-- @check freshness: newest write per table
SELECT 'games' AS t, MAX(updated_at) AS last_write FROM dbo.games
UNION ALL SELECT 'player_game_stats (latest season)', MAX(updated_at) FROM dbo.player_game_stats WHERE season = (SELECT MAX(season) FROM dbo.player_game_stats)
UNION ALL SELECT 'team_game_stats (latest season)', MAX(updated_at) FROM dbo.team_game_stats WHERE season = (SELECT MAX(season) FROM dbo.team_game_stats)
UNION ALL SELECT 'standings', MAX(updated_at) FROM dbo.standings
UNION ALL SELECT 'injury_snapshots', MAX(captured_at) FROM dbo.injury_snapshots
UNION ALL SELECT 'roster_snapshots', MAX(captured_at) FROM dbo.roster_snapshots
UNION ALL SELECT 'odds_snapshots', MAX(captured_at) FROM dbo.odds_snapshots
UNION ALL SELECT 'prop_snapshots', MAX(captured_at) FROM dbo.prop_snapshots
UNION ALL SELECT 'sync_state', MAX(last_run) FROM dbo.sync_state;
GO

-- @check recent sync runs (excluding per-game backfill markers)
SELECT TOP 20 scope, watermark, CONVERT(VARCHAR(19), last_run, 120) AS last_run, note
FROM dbo.sync_state
WHERE scope NOT LIKE 'backfill:plays:%' AND scope NOT LIKE 'backfill:opening_props:%'
ORDER BY last_run DESC;
GO

-- @check games by season: completeness of box scores / team stats / plays for final games
SELECT g.season, g.season_type, COUNT(*) AS games,
       SUM(CASE WHEN g.status LIKE '%Final%' THEN 1 ELSE 0 END) AS final_games,
       SUM(CASE WHEN g.status LIKE '%Final%' AND x.pgs = 0 THEN 1 ELSE 0 END) AS final_no_box,
       SUM(CASE WHEN g.status LIKE '%Final%' AND x.tgs <> 2 THEN 1 ELSE 0 END) AS final_bad_team_stats,
       SUM(CASE WHEN g.status LIKE '%Final%' AND x.pl = 0 THEN 1 ELSE 0 END) AS final_no_plays,
       SUM(CASE WHEN g.status LIKE '%Final%' AND (g.home_team_score IS NULL OR g.visitor_team_score IS NULL) THEN 1 ELSE 0 END) AS final_no_score
FROM dbo.games g
CROSS APPLY (SELECT
    (SELECT COUNT(*) FROM dbo.player_game_stats s WHERE s.game_id = g.id) AS pgs,
    (SELECT COUNT(*) FROM dbo.team_game_stats t WHERE t.game_id = g.id) AS tgs,
    CASE WHEN EXISTS (SELECT 1 FROM dbo.plays p WHERE p.game_id = g.id) THEN 1 ELSE 0 END AS pl) x
GROUP BY g.season, g.season_type
ORDER BY g.season DESC, g.season_type;
GO

-- @check distinct game statuses (views treat '%Final%' as completed)
SELECT status, COUNT(*) AS games FROM dbo.games GROUP BY status ORDER BY games DESC;
GO

-- @check player_game_stats rows with NULL team_id (excluded from matchup views)
SELECT season, COUNT(*) AS rows_null_team
FROM dbo.player_game_stats WHERE team_id IS NULL GROUP BY season ORDER BY season DESC;
GO

-- @check season_stats endpoint vs summed game logs, passers (known defect)
SELECT ss.season,
       SUM(CASE WHEN gs.att > 0 THEN 1 ELSE 0 END) AS passers,
       SUM(CASE WHEN gs.att > 0 AND ss.passing_interceptions IS NULL THEN 1 ELSE 0 END) AS int_null,
       SUM(CASE WHEN ss.passing_interceptions IS NOT NULL AND ss.passing_interceptions <> gs.ints THEN 1 ELSE 0 END) AS int_mismatch
FROM dbo.player_season_stats ss
JOIN (SELECT player_id, season, season_type, SUM(passing_attempts) AS att, SUM(ISNULL(passing_interceptions,0)) AS ints
      FROM dbo.player_game_stats GROUP BY player_id, season, season_type) gs
  ON gs.player_id = ss.player_id AND gs.season = ss.season AND gs.season_type = ss.season_type
WHERE ss.season_type = 2 AND ss.season >= 2015
GROUP BY ss.season ORDER BY ss.season DESC;
GO

-- @check odds snapshots: volume and duplicate (unchanged) re-captures per game/vendor
SELECT TOP 15 o.game_id, o.vendor, COUNT(*) AS snapshots,
       COUNT(DISTINCT CONCAT(o.spread_home_value, '|', o.total_value, '|', o.moneyline_home_odds)) AS distinct_lines,
       CONVERT(VARCHAR(19), MIN(o.captured_at), 120) AS first_seen, CONVERT(VARCHAR(19), MAX(o.captured_at), 120) AS last_seen
FROM dbo.odds_snapshots o
GROUP BY o.game_id, o.vendor
ORDER BY COUNT(*) DESC;
GO

-- @check prop types captured (extend v_prop_results mapping for any new ones)
SELECT prop_type, market_type, COUNT(*) AS snapshots, COUNT(DISTINCT game_id) AS games
FROM dbo.prop_snapshots GROUP BY prop_type, market_type ORDER BY snapshots DESC;
GO

-- @check coverage_map summary (from probe.ts)
SELECT endpoint, season_type,
       MIN(CASE WHEN has_data = 1 THEN season END) AS first_season,
       MAX(CASE WHEN has_data = 1 THEN season END) AS last_season,
       SUM(CASE WHEN has_data = 1 THEN 1 ELSE 0 END) AS seasons
FROM dbo.coverage_map GROUP BY endpoint, season_type ORDER BY endpoint, season_type;
GO

-- @check readonly principal: does nfl_readonly exist and can it run sp_semantic_search?
SELECT dp.name AS principal, perm.permission_name, perm.state_desc, OBJECT_NAME(perm.major_id) AS on_object
FROM sys.database_principals dp
LEFT JOIN sys.database_permissions perm ON perm.grantee_principal_id = dp.principal_id
WHERE dp.name IN ('nfl_readonly', 'nfl_ingest')
ORDER BY dp.name, perm.permission_name;
GO
