/* =============================================================================
   analytics_smoke.sql — READ-ONLY. Run after applying 004_analytics_views.sql
   to confirm every analytics view returns sensible rows on real data.
============================================================================= */

-- @check latest regular season: top 10 PPR with usage
DECLARE @s INT = (SELECT MAX(season) FROM dbo.games WHERE season_type = 2 AND status LIKE '%Final%');
SELECT TOP 10 f.season, f.first_name, f.last_name, f.pos, f.games, f.fp_ppr_total, f.fp_ppr_pg,
       u.target_share, u.carry_share
FROM dbo.v_player_fantasy_season f
LEFT JOIN dbo.v_player_usage_season u ON u.player_id = f.player_id AND u.season = f.season AND u.season_type = f.season_type
WHERE f.season = @s AND f.season_type = 2 ORDER BY f.fp_ppr_total DESC;
GO

-- @check team season summary vs standings (wins should match where standings exist)
DECLARE @s INT = (SELECT MAX(season) FROM dbo.standings);
SELECT t.team, t.wins, st.wins AS standings_wins, t.losses, st.losses AS standings_losses,
       t.point_differential, st.point_differential AS standings_diff, t.pythag_wins, t.luck_wins
FROM dbo.v_team_season_summary t
LEFT JOIN dbo.standings st ON st.team_id = t.team_id AND st.season = t.season
WHERE t.season = @s AND t.season_type = 2
ORDER BY CASE WHEN t.wins = st.wins THEN 1 ELSE 0 END, t.wins DESC;
GO

-- @check view row counts by season (last 3 seasons)
SELECT 'v_game_results' AS v, season, COUNT(*) AS n FROM dbo.v_game_results WHERE season >= YEAR(GETDATE()) - 2 GROUP BY season
UNION ALL SELECT 'v_player_form', season, COUNT(*) FROM dbo.v_player_form WHERE season >= YEAR(GETDATE()) - 2 GROUP BY season
UNION ALL SELECT 'v_game_lines', season, COUNT(*) FROM dbo.v_game_lines WHERE season >= YEAR(GETDATE()) - 2 GROUP BY season
UNION ALL SELECT 'v_prop_results', season, COUNT(*) FROM dbo.v_prop_results WHERE season >= YEAR(GETDATE()) - 2 GROUP BY season
ORDER BY v, season;
GO

-- @check prop outcome mix (look for 'unmapped')
SELECT prop_type, outcome, COUNT(*) AS n FROM dbo.v_prop_results GROUP BY prop_type, outcome ORDER BY prop_type, outcome;
GO

-- @check data-health views
SELECT * FROM dbo.v_dh_table_freshness ORDER BY table_name;
GO
