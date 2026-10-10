/* =============================================================================
   004_analytics_views.sql — Analytics layer for the dashboard and MCP tools.
   All views; zero ingestion changes. Run after 002_views_fantasy.sql.
   Idempotent (CREATE OR ALTER) — safe to re-run.

   Sections
     1. Game results           v_game_results               team / game
     2. Player game context    v_player_game_context        player / game
                               (opponent, usage share, rolling form)
     3. Player season usage    v_player_usage_season        player / season
     4. Player form            v_player_form                player / season (latest game)
     5. Season-over-season     v_player_season_yoy          player / season
     6. Team efficiency        v_team_game_efficiency       team / game
                               v_team_season_summary        team / season
                               (record, Pythagorean luck, one-score games)
     7. Betting                v_game_lines                 game / vendor
                               v_game_lines_consensus       game
                               v_prop_results               prop / game
     8. Data health            v_dh_season_coverage         season / season_type
                               v_dh_season_stats_reconciliation
                               v_dh_table_freshness

   Conventions
   - "Completed game" = both scores present AND status contains 'Final'.
   - Usage shares are computed against the team totals of the games the
     player appeared in (player_game_stats rows), not the whole team season.
   - Rolling windows are ordered by game_date within (player, season, season_type).
============================================================================= */

/* ---------------------------------------------------------------------------
   1. Game results, one row per TEAM per completed game. The building block
   for records, splits, and anything that needs "who was the opponent".
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_game_results AS
SELECT
    g.id                         AS game_id,
    g.season, g.week, g.season_type, g.game_date,
    x.team_id, x.opponent_team_id, x.is_home,
    x.points_for, x.points_against,
    x.points_for - x.points_against AS margin,
    CASE WHEN x.points_for > x.points_against THEN 'W'
         WHEN x.points_for < x.points_against THEN 'L' ELSE 'T' END AS result,
    CASE WHEN ISNULL(g.home_team_ot,0) + ISNULL(g.visitor_team_ot,0) > 0 THEN 1 ELSE 0 END AS overtime
FROM dbo.games g
CROSS APPLY (VALUES
    (g.home_team_id,    g.visitor_team_id, CAST(1 AS BIT), g.home_team_score,    g.visitor_team_score),
    (g.visitor_team_id, g.home_team_id,    CAST(0 AS BIT), g.visitor_team_score, g.home_team_score)
) x(team_id, opponent_team_id, is_home, points_for, points_against)
WHERE g.home_team_score IS NOT NULL
  AND g.visitor_team_score IS NOT NULL
  AND g.status LIKE '%Final%';
GO

/* ---------------------------------------------------------------------------
   2. Player game context: the fantasy game row plus everything a game log or
   trend chart needs — opponent, home/away, result, raw volume, usage share
   of the team's targets/carries, and rolling form in all three formats.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_game_context AS
WITH base AS (
    SELECT
        f.game_id, f.player_id, f.team_id, f.season, f.week, f.season_type,
        f.first_name, f.last_name, f.pos,
        g.game_date,
        CASE WHEN f.team_id = g.home_team_id THEN g.visitor_team_id ELSE g.home_team_id END AS opponent_team_id,
        CAST(CASE WHEN f.team_id = g.home_team_id THEN 1 ELSE 0 END AS BIT) AS is_home,
        CASE WHEN f.team_id = g.home_team_id THEN g.home_team_score ELSE g.visitor_team_score END AS team_points,
        CASE WHEN f.team_id = g.home_team_id THEN g.visitor_team_score ELSE g.home_team_score END AS opponent_points,
        s.passing_completions, s.passing_attempts, s.passing_yards, s.passing_touchdowns, s.passing_interceptions,
        s.rushing_attempts, s.rushing_yards, s.rushing_touchdowns,
        s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns,
        s.fumbles_lost,
        f.fp_standard, f.fp_half_ppr, f.fp_ppr,
        SUM(ISNULL(s.receiving_targets,0)) OVER (PARTITION BY s.game_id, s.team_id) AS team_targets,
        SUM(ISNULL(s.rushing_attempts,0))  OVER (PARTITION BY s.game_id, s.team_id) AS team_carries
    FROM dbo.v_player_fantasy_game f
    JOIN dbo.player_game_stats s ON s.game_id = f.game_id AND s.player_id = f.player_id
    JOIN dbo.games g             ON g.id = f.game_id
)
SELECT
    b.*,
    ot.abbreviation AS opponent,
    CAST(CASE WHEN b.team_points IS NULL OR b.opponent_points IS NULL THEN NULL
              WHEN b.team_points > b.opponent_points THEN 'W'
              WHEN b.team_points < b.opponent_points THEN 'L' ELSE 'T' END AS CHAR(1)) AS result,
    CAST(1.0 * b.receiving_targets / NULLIF(b.team_targets, 0) AS DECIMAL(5,3)) AS target_share,
    CAST(1.0 * b.rushing_attempts  / NULLIF(b.team_carries, 0) AS DECIMAL(5,3)) AS carry_share,
    CAST(ROW_NUMBER() OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id) AS INT) AS game_no,
    CAST(AVG(b.fp_ppr)      OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS DECIMAL(8,2)) AS fp_ppr_roll3,
    CAST(AVG(b.fp_half_ppr) OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS DECIMAL(8,2)) AS fp_half_ppr_roll3,
    CAST(AVG(b.fp_standard) OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS DECIMAL(8,2)) AS fp_standard_roll3,
    CAST(AVG(b.fp_ppr)      OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS BETWEEN 5 PRECEDING AND CURRENT ROW) AS DECIMAL(8,2)) AS fp_ppr_roll6,
    CAST(AVG(b.fp_ppr)      OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS UNBOUNDED PRECEDING) AS DECIMAL(8,2))           AS fp_ppr_season_to_date,
    CAST(AVG(b.fp_half_ppr) OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS UNBOUNDED PRECEDING) AS DECIMAL(8,2))           AS fp_half_ppr_season_to_date,
    CAST(AVG(b.fp_standard) OVER (PARTITION BY b.player_id, b.season, b.season_type ORDER BY b.game_date, b.game_id
                                  ROWS UNBOUNDED PRECEDING) AS DECIMAL(8,2))           AS fp_standard_season_to_date
FROM base b
LEFT JOIN dbo.teams ot ON ot.id = b.opponent_team_id;
GO

/* ---------------------------------------------------------------------------
   3. Player season usage: volume and share of team opportunity. Target and
   carry share are the most stable predictors of future fantasy output — far
   stickier than touchdowns.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_usage_season AS
SELECT
    c.player_id, c.season, c.season_type,
    MAX(c.first_name) AS first_name, MAX(c.last_name) AS last_name, MAX(c.pos) AS pos,
    COUNT(*)                                  AS games,
    SUM(ISNULL(c.receiving_targets,0))        AS targets,
    SUM(ISNULL(c.rushing_attempts,0))         AS carries,
    SUM(ISNULL(c.receiving_targets,0)) + SUM(ISNULL(c.rushing_attempts,0)) AS opportunities,
    CAST(1.0 * SUM(ISNULL(c.receiving_targets,0)) / COUNT(*) AS DECIMAL(6,2)) AS targets_pg,
    CAST(1.0 * SUM(ISNULL(c.rushing_attempts,0))  / COUNT(*) AS DECIMAL(6,2)) AS carries_pg,
    CAST(1.0 * SUM(ISNULL(c.receiving_targets,0)) / NULLIF(SUM(c.team_targets),0) AS DECIMAL(5,3)) AS target_share,
    CAST(1.0 * SUM(ISNULL(c.rushing_attempts,0))  / NULLIF(SUM(c.team_carries),0) AS DECIMAL(5,3)) AS carry_share,
    CAST(1.0 * SUM(ISNULL(c.receptions,0)) / NULLIF(SUM(c.receiving_targets),0) AS DECIMAL(5,3))    AS catch_rate,
    CAST(1.0 * SUM(ISNULL(c.receiving_yards,0)) / NULLIF(SUM(c.receiving_targets),0) AS DECIMAL(6,2)) AS yards_per_target,
    CAST(1.0 * SUM(ISNULL(c.rushing_yards,0)) / NULLIF(SUM(c.rushing_attempts),0) AS DECIMAL(6,2))   AS yards_per_carry,
    CAST(SUM(c.fp_ppr) / NULLIF(SUM(ISNULL(c.receiving_targets,0)) + SUM(ISNULL(c.rushing_attempts,0)),0)
         AS DECIMAL(6,3))                     AS fp_ppr_per_opportunity
FROM dbo.v_player_game_context c
GROUP BY c.player_id, c.season, c.season_type;
GO

/* ---------------------------------------------------------------------------
   4. Player form: one row per player-season = their most recent game, with
   last-3 average vs season average. "Who's hot / who's cold" in one query.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_form AS
SELECT
    c.player_id, c.first_name, c.last_name, c.pos, c.team_id, c.season, c.season_type,
    c.game_no AS games,
    c.week    AS last_week,
    c.game_date AS last_game_date,
    c.fp_ppr_roll3, c.fp_ppr_season_to_date AS fp_ppr_season_avg,
    CAST(c.fp_ppr_roll3 - c.fp_ppr_season_to_date AS DECIMAL(8,2))           AS fp_ppr_form_delta,
    c.fp_half_ppr_roll3, c.fp_half_ppr_season_to_date AS fp_half_ppr_season_avg,
    CAST(c.fp_half_ppr_roll3 - c.fp_half_ppr_season_to_date AS DECIMAL(8,2)) AS fp_half_ppr_form_delta,
    c.fp_standard_roll3, c.fp_standard_season_to_date AS fp_standard_season_avg,
    CAST(c.fp_standard_roll3 - c.fp_standard_season_to_date AS DECIMAL(8,2)) AS fp_standard_form_delta
FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY player_id, season, season_type
                                 ORDER BY game_date DESC, game_id DESC) AS rn_desc
    FROM dbo.v_player_game_context
) c
WHERE c.rn_desc = 1;
GO

/* ---------------------------------------------------------------------------
   5. Season-over-season: each player-season beside the previous season the
   player appeared in (not necessarily season-1 — injuries skip years).
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_season_yoy AS
SELECT
    f.player_id, f.first_name, f.last_name, f.pos, f.season, f.season_type, f.games,
    f.fp_ppr_total, f.fp_ppr_pg, f.fp_half_ppr_pg, f.fp_standard_pg,
    LAG(f.season)    OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS prev_season,
    LAG(f.games)     OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS prev_games,
    LAG(f.fp_ppr_pg) OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS prev_fp_ppr_pg,
    CAST(f.fp_ppr_pg - LAG(f.fp_ppr_pg) OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS DECIMAL(8,2))           AS fp_ppr_pg_delta,
    CAST(f.fp_half_ppr_pg - LAG(f.fp_half_ppr_pg) OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS DECIMAL(8,2)) AS fp_half_ppr_pg_delta,
    CAST(f.fp_standard_pg - LAG(f.fp_standard_pg) OVER (PARTITION BY f.player_id, f.season_type ORDER BY f.season) AS DECIMAL(8,2)) AS fp_standard_pg_delta
FROM dbo.v_player_fantasy_season f;
GO

/* ---------------------------------------------------------------------------
   6a. Team efficiency per game: offense from the team's own row, defense from
   the opponent's row (same trick as DST scoring).
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_team_game_efficiency AS
SELECT
    r.game_id, r.season, r.week, r.season_type, r.game_date,
    r.team_id, r.opponent_team_id, r.is_home, r.result,
    r.points_for, r.points_against, r.margin,
    me.total_yards, me.total_offensive_plays, me.yards_per_play,
    me.net_passing_yards, me.rushing_yards, me.rushing_attempts,
    me.third_down_conversions, me.third_down_attempts,
    me.red_zone_scores, me.red_zone_attempts,
    me.turnovers, me.total_drives, me.penalties, me.penalty_yards,
    me.sacks AS sacks_taken, me.possession_time_seconds,
    op.total_yards            AS yards_allowed,
    op.total_offensive_plays  AS plays_allowed,
    op.yards_per_play         AS yards_per_play_allowed,
    op.turnovers              AS takeaways,
    op.sacks                  AS sacks_made,
    op.third_down_conversions AS opp_third_down_conversions,
    op.third_down_attempts    AS opp_third_down_attempts,
    op.red_zone_scores        AS opp_red_zone_scores,
    op.red_zone_attempts      AS opp_red_zone_attempts
FROM dbo.v_game_results r
LEFT JOIN dbo.team_game_stats me ON me.game_id = r.game_id AND me.team_id = r.team_id
LEFT JOIN dbo.team_game_stats op ON op.game_id = r.game_id AND op.team_id = r.opponent_team_id;
GO

/* ---------------------------------------------------------------------------
   6b. Team season summary. Records come from games (complete back to 2002),
   not the standings endpoint (2004+). Pythagorean expectation uses the NFL
   exponent 2.37; luck = actual wins − expected. Teams far above expectation
   and with strong one-score records tend to regress the following season.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_team_season_summary AS
SELECT
    e.team_id, t.abbreviation AS team, t.full_name, t.conference, t.division,
    e.season, e.season_type,
    COUNT(*)                                          AS games,
    SUM(CASE WHEN e.result='W' THEN 1 ELSE 0 END)     AS wins,
    SUM(CASE WHEN e.result='L' THEN 1 ELSE 0 END)     AS losses,
    SUM(CASE WHEN e.result='T' THEN 1 ELSE 0 END)     AS ties,
    SUM(e.points_for)                                 AS points_for,
    SUM(e.points_against)                             AS points_against,
    SUM(e.margin)                                     AS point_differential,
    CAST(1.0 * SUM(e.points_for) / COUNT(*) AS DECIMAL(6,2))     AS points_pg,
    CAST(1.0 * SUM(e.points_against) / COUNT(*) AS DECIMAL(6,2)) AS points_allowed_pg,
    CAST(COUNT(*) * POWER(1.0 * NULLIF(SUM(e.points_for),0), 2.37)
         / NULLIF(POWER(1.0 * NULLIF(SUM(e.points_for),0), 2.37) + POWER(1.0 * NULLIF(SUM(e.points_against),0), 2.37), 0)
         AS DECIMAL(5,2))                             AS pythag_wins,
    CAST(SUM(CASE WHEN e.result='W' THEN 1.0 WHEN e.result='T' THEN 0.5 ELSE 0 END)
         - COUNT(*) * POWER(1.0 * NULLIF(SUM(e.points_for),0), 2.37)
           / NULLIF(POWER(1.0 * NULLIF(SUM(e.points_for),0), 2.37) + POWER(1.0 * NULLIF(SUM(e.points_against),0), 2.37), 0)
         AS DECIMAL(5,2))                             AS luck_wins,
    SUM(CASE WHEN ABS(e.margin) <= 8 AND e.result='W' THEN 1 ELSE 0 END) AS one_score_wins,
    SUM(CASE WHEN ABS(e.margin) <= 8 AND e.result='L' THEN 1 ELSE 0 END) AS one_score_losses,
    CAST(1.0 * SUM(e.total_yards) / NULLIF(SUM(e.total_offensive_plays),0) AS DECIMAL(5,2)) AS yards_per_play,
    CAST(1.0 * SUM(e.yards_allowed) / NULLIF(SUM(e.plays_allowed),0) AS DECIMAL(5,2))       AS yards_per_play_allowed,
    CAST(1.0 * SUM(e.third_down_conversions) / NULLIF(SUM(e.third_down_attempts),0) AS DECIMAL(5,3))         AS third_down_pct,
    CAST(1.0 * SUM(e.opp_third_down_conversions) / NULLIF(SUM(e.opp_third_down_attempts),0) AS DECIMAL(5,3)) AS third_down_pct_allowed,
    CAST(1.0 * SUM(e.red_zone_scores) / NULLIF(SUM(e.red_zone_attempts),0) AS DECIMAL(5,3))                  AS red_zone_pct,
    CAST(1.0 * SUM(e.opp_red_zone_scores) / NULLIF(SUM(e.opp_red_zone_attempts),0) AS DECIMAL(5,3))          AS red_zone_pct_allowed,
    SUM(e.takeaways)                                  AS takeaways,
    SUM(e.turnovers)                                  AS giveaways,
    SUM(e.takeaways) - SUM(e.turnovers)               AS turnover_differential,
    SUM(e.sacks_made)                                 AS sacks_made,
    SUM(e.sacks_taken)                                AS sacks_taken,
    CAST(1.0 * SUM(e.points_for) / NULLIF(SUM(e.total_drives),0) AS DECIMAL(5,2)) AS points_per_drive
FROM dbo.v_team_game_efficiency e
JOIN dbo.teams t ON t.id = e.team_id
GROUP BY e.team_id, t.abbreviation, t.full_name, t.conference, t.division, e.season, e.season_type;
GO

/* ---------------------------------------------------------------------------
   7a. Game lines per vendor: opening (odds_opening) vs closing (latest
   snapshot captured before kickoff; if none, the latest snapshot at all) and
   the result against both. spread_home follows the usual convention:
   −7 = home favored by 7. Home covers when margin + spread_home > 0.
   Coverage: odds exist from 2025 week 8 onward.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_game_lines AS
WITH closing AS (
    SELECT o.*, ROW_NUMBER() OVER (
             PARTITION BY o.game_id, o.vendor
             ORDER BY CASE WHEN o.captured_at <= g.game_date THEN 0 ELSE 1 END, o.captured_at DESC) AS rn,
           CAST(COUNT(*) OVER (PARTITION BY o.game_id, o.vendor) AS INT) AS snapshots
    FROM dbo.odds_snapshots o
    JOIN dbo.games g ON g.id = o.game_id
),
opening AS (
    SELECT o.*, ROW_NUMBER() OVER (PARTITION BY o.game_id, o.vendor ORDER BY o.opened_at, o.api_odds_id) AS rn
    FROM dbo.odds_opening o
)
SELECT
    g.id AS game_id, g.season, g.week, g.season_type, g.game_date, g.status,
    g.home_team_id, ht.abbreviation AS home, g.visitor_team_id, vt.abbreviation AS visitor,
    c.vendor,
    op.spread_home  AS open_spread_home,
    c.spread_home   AS close_spread_home,
    CAST(c.spread_home - op.spread_home AS DECIMAL(5,1)) AS spread_move,
    op.total_points AS open_total,
    c.total_points  AS close_total,
    CAST(c.total_points - op.total_points AS DECIMAL(5,1)) AS total_move,
    c.moneyline_home_odds AS close_ml_home, c.moneyline_away_odds AS close_ml_away,
    c.snapshots,
    c.captured_at   AS close_captured_at,
    g.home_team_score, g.visitor_team_score,
    g.home_team_score - g.visitor_team_score AS home_margin,
    g.home_team_score + g.visitor_team_score AS total_scored,
    CASE WHEN g.home_team_score IS NULL OR c.spread_home IS NULL THEN NULL
         WHEN g.home_team_score - g.visitor_team_score + c.spread_home > 0 THEN 'home'
         WHEN g.home_team_score - g.visitor_team_score + c.spread_home < 0 THEN 'away'
         ELSE 'push' END AS ats_winner,
    CASE WHEN g.home_team_score IS NULL OR c.total_points IS NULL THEN NULL
         WHEN g.home_team_score + g.visitor_team_score > c.total_points THEN 'over'
         WHEN g.home_team_score + g.visitor_team_score < c.total_points THEN 'under'
         ELSE 'push' END AS total_result
FROM closing c
JOIN dbo.games g  ON g.id = c.game_id
JOIN dbo.teams ht ON ht.id = g.home_team_id
JOIN dbo.teams vt ON vt.id = g.visitor_team_id
LEFT JOIN opening op ON op.game_id = c.game_id AND op.vendor = c.vendor AND op.rn = 1
WHERE c.rn = 1;
GO

/* 7b. Consensus line per game: median-free simple mean across vendors. */
CREATE OR ALTER VIEW dbo.v_game_lines_consensus AS
SELECT
    l.game_id, l.season, l.week, l.season_type, l.game_date, l.status,
    l.home_team_id, l.home, l.visitor_team_id, l.visitor,
    COUNT(*)                                        AS vendors,
    CAST(AVG(l.open_spread_home)  AS DECIMAL(5,1))  AS open_spread_home,
    CAST(AVG(l.close_spread_home) AS DECIMAL(5,1))  AS close_spread_home,
    CAST(AVG(l.open_total)        AS DECIMAL(5,1))  AS open_total,
    CAST(AVG(l.close_total)       AS DECIMAL(5,1))  AS close_total,
    MAX(l.home_team_score) AS home_team_score, MAX(l.visitor_team_score) AS visitor_team_score,
    MAX(l.home_margin)  AS home_margin,
    MAX(l.total_scored) AS total_scored,
    CASE WHEN MAX(l.home_margin) IS NULL OR AVG(l.close_spread_home) IS NULL THEN NULL
         WHEN MAX(l.home_margin) + AVG(l.close_spread_home) > 0 THEN 'home'
         WHEN MAX(l.home_margin) + AVG(l.close_spread_home) < 0 THEN 'away' ELSE 'push' END AS ats_winner,
    CASE WHEN MAX(l.total_scored) IS NULL OR AVG(l.close_total) IS NULL THEN NULL
         WHEN MAX(l.total_scored) > AVG(l.close_total) THEN 'over'
         WHEN MAX(l.total_scored) < AVG(l.close_total) THEN 'under' ELSE 'push' END AS total_result
FROM dbo.v_game_lines l
GROUP BY l.game_id, l.season, l.week, l.season_type, l.game_date, l.status,
         l.home_team_id, l.home, l.visitor_team_id, l.visitor;
GO

/* ---------------------------------------------------------------------------
   7c. Player props vs actual. Closing line = latest snapshot before kickoff
   (falls back to latest overall). prop_type → stat mapping below covers the
   types seen in the sample data; unmapped types return actual NULL and
   outcome 'unmapped' — extend the CASE as new prop types appear (the data
   health page lists them). anytime_td counts rushing + receiving TDs.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_prop_results AS
WITH closing AS (
    SELECT p.*, ROW_NUMBER() OVER (
             PARTITION BY p.game_id, p.player_id, p.vendor, p.prop_type, p.market_type
             ORDER BY CASE WHEN p.captured_at <= g.game_date THEN 0 ELSE 1 END, p.captured_at DESC) AS rn
    FROM dbo.prop_snapshots p
    JOIN dbo.games g ON g.id = p.game_id
)
SELECT
    c.game_id, g.season, g.week, g.season_type, g.game_date,
    c.player_id, pl.first_name, pl.last_name, pl.position_abbreviation AS pos,
    c.vendor, c.prop_type, c.market_type, c.line, c.over_odds, c.under_odds, c.milestone_odds,
    c.captured_at AS close_captured_at,
    a.actual,
    CASE
      WHEN g.status NOT LIKE '%Final%' OR g.status IS NULL THEN 'pending'
      WHEN a.mapped = 0                         THEN 'unmapped'
      WHEN s.player_id IS NULL                  THEN 'no_action'   -- did not record a stat line
      WHEN c.market_type = 'milestone'          THEN CASE WHEN a.actual >= ISNULL(c.line, 1) THEN 'hit' ELSE 'miss' END
      WHEN c.line IS NULL                       THEN NULL
      WHEN a.actual > c.line                    THEN 'over'
      WHEN a.actual < c.line                    THEN 'under'
      ELSE 'push'
    END AS outcome
FROM closing c
JOIN dbo.games g ON g.id = c.game_id
LEFT JOIN dbo.players pl ON pl.id = c.player_id
LEFT JOIN dbo.player_game_stats s ON s.game_id = c.game_id AND s.player_id = c.player_id
CROSS APPLY (SELECT
    CASE c.prop_type
      WHEN 'passing_yards'       THEN s.passing_yards
      WHEN 'passing_tds'         THEN s.passing_touchdowns
      WHEN 'passing_touchdowns'  THEN s.passing_touchdowns
      WHEN 'passing_completions' THEN s.passing_completions
      WHEN 'passing_attempts'    THEN s.passing_attempts
      WHEN 'passing_interceptions' THEN s.passing_interceptions
      WHEN 'interceptions'       THEN s.passing_interceptions
      WHEN 'rushing_yards'       THEN s.rushing_yards
      WHEN 'rushing_attempts'    THEN s.rushing_attempts
      WHEN 'rushing_tds'         THEN s.rushing_touchdowns
      WHEN 'receiving_yards'     THEN s.receiving_yards
      WHEN 'receptions'          THEN s.receptions
      WHEN 'receiving_tds'       THEN s.receiving_touchdowns
      WHEN 'longest_reception'   THEN s.long_reception
      WHEN 'longest_rush'        THEN s.long_rushing
      WHEN 'anytime_td'          THEN ISNULL(s.rushing_touchdowns,0) + ISNULL(s.receiving_touchdowns,0)
      WHEN 'rushing_receiving_yards' THEN ISNULL(s.rushing_yards,0) + ISNULL(s.receiving_yards,0)
      WHEN 'passing_rushing_yards'   THEN ISNULL(s.passing_yards,0) + ISNULL(s.rushing_yards,0)
    END AS actual,
    CASE WHEN c.prop_type IN ('passing_yards','passing_tds','passing_touchdowns','passing_completions',
              'passing_attempts','passing_interceptions','interceptions','rushing_yards','rushing_attempts',
              'rushing_tds','receiving_yards','receptions','receiving_tds','longest_reception','longest_rush',
              'anytime_td','rushing_receiving_yards','passing_rushing_yards') THEN 1 ELSE 0 END AS mapped
) a
WHERE c.rn = 1;
GO

/* ---------------------------------------------------------------------------
   8a. Data health — per season/season_type: how complete is each fact table
   for completed games? Every EXISTS rides an index on game_id.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_dh_season_coverage AS
SELECT
    x.season, x.season_type,
    COUNT(*)                                           AS games,
    SUM(x.is_final)                                    AS final_games,
    SUM(x.is_final * x.has_player_stats)               AS with_player_stats,
    SUM(x.is_final * x.has_team_stats)                 AS with_team_stats,
    SUM(x.is_final * x.has_plays)                      AS with_plays,
    SUM(x.has_odds)                                    AS with_odds,
    SUM(x.is_final * x.missing_score)                  AS final_missing_score
FROM (
    SELECT g.season, g.season_type,
        CASE WHEN g.status LIKE '%Final%' THEN 1 ELSE 0 END AS is_final,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.player_game_stats s WHERE s.game_id = g.id) THEN 1 ELSE 0 END AS has_player_stats,
        CASE WHEN (SELECT COUNT(*) FROM dbo.team_game_stats t WHERE t.game_id = g.id) = 2 THEN 1 ELSE 0 END AS has_team_stats,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.plays p WHERE p.game_id = g.id) THEN 1 ELSE 0 END AS has_plays,
        CASE WHEN EXISTS (SELECT 1 FROM dbo.odds_snapshots o WHERE o.game_id = g.id) THEN 1 ELSE 0 END AS has_odds,
        CASE WHEN g.home_team_score IS NULL OR g.visitor_team_score IS NULL THEN 1 ELSE 0 END AS missing_score
    FROM dbo.games g
) x
GROUP BY x.season, x.season_type;
GO

/* 8b. How far does the season_stats endpoint disagree with summed game logs?
   Quantifies the known player_season_stats defects (NULL / wrong INTs etc.). */
CREATE OR ALTER VIEW dbo.v_dh_season_stats_reconciliation AS
SELECT
    ss.season, ss.season_type,
    COUNT(*) AS player_seasons,
    SUM(CASE WHEN gs.player_id IS NULL THEN 1 ELSE 0 END) AS no_game_logs,
    SUM(CASE WHEN ISNULL(gs.passing_attempts,0) > 0 AND ss.passing_interceptions IS NULL THEN 1 ELSE 0 END)                   AS int_null,
    SUM(CASE WHEN ss.passing_interceptions IS NOT NULL AND ss.passing_interceptions <> ISNULL(gs.passing_interceptions,0) THEN 1 ELSE 0 END) AS int_mismatch,
    SUM(CASE WHEN ss.passing_yards IS NOT NULL AND ABS(ss.passing_yards - ISNULL(gs.passing_yards,0)) > 5 THEN 1 ELSE 0 END)   AS pass_yds_mismatch,
    SUM(CASE WHEN ss.rushing_yards IS NOT NULL AND ABS(ss.rushing_yards - ISNULL(gs.rushing_yards,0)) > 5 THEN 1 ELSE 0 END)   AS rush_yds_mismatch,
    SUM(CASE WHEN ss.receiving_yards IS NOT NULL AND ABS(ss.receiving_yards - ISNULL(gs.receiving_yards,0)) > 5 THEN 1 ELSE 0 END) AS rec_yds_mismatch,
    SUM(CASE WHEN ISNULL(gs.passing_attempts,0) > 0 AND ss.qb_rating IS NULL THEN 1 ELSE 0 END)                               AS qb_rating_null
FROM dbo.player_season_stats ss
LEFT JOIN dbo.v_player_season_from_games gs
  ON gs.player_id = ss.player_id AND gs.season = ss.season AND gs.season_type = ss.season_type
GROUP BY ss.season, ss.season_type;
GO

/* 8c. Freshness: row counts from metadata (no scans) + the newest write per
   table. Large tables use indexed columns only, so this stays cheap. */
CREATE OR ALTER VIEW dbo.v_dh_table_freshness AS
WITH counts AS (
    SELECT o.name AS table_name, CAST(SUM(p.rows) AS INT) AS row_count
    FROM sys.objects o
    JOIN sys.partitions p ON p.object_id = o.object_id AND p.index_id IN (0, 1)
    WHERE o.type = 'U' AND SCHEMA_NAME(o.schema_id) = 'dbo'
    GROUP BY o.name
),
latest AS (
    SELECT 'games' AS table_name, MAX(updated_at) AS last_write FROM dbo.games
    UNION ALL SELECT 'teams', MAX(updated_at) FROM dbo.teams
    UNION ALL SELECT 'players', MAX(updated_at) FROM dbo.players
    UNION ALL SELECT 'standings', MAX(updated_at) FROM dbo.standings
    UNION ALL SELECT 'player_game_stats', MAX(updated_at) FROM dbo.player_game_stats
              WHERE season = (SELECT MAX(season) FROM dbo.player_game_stats)
    UNION ALL SELECT 'team_game_stats', MAX(updated_at) FROM dbo.team_game_stats
              WHERE season = (SELECT MAX(season) FROM dbo.team_game_stats)
    UNION ALL SELECT 'player_season_stats', MAX(updated_at) FROM dbo.player_season_stats
              WHERE season = (SELECT MAX(season) FROM dbo.player_season_stats)
    UNION ALL SELECT 'team_season_stats', MAX(updated_at) FROM dbo.team_season_stats
    UNION ALL SELECT 'adv_passing_stats', MAX(updated_at) FROM dbo.adv_passing_stats
              WHERE season = (SELECT MAX(season) FROM dbo.adv_passing_stats)
    UNION ALL SELECT 'injury_snapshots', MAX(captured_at) FROM dbo.injury_snapshots
    UNION ALL SELECT 'roster_snapshots', MAX(captured_at) FROM dbo.roster_snapshots
    UNION ALL SELECT 'odds_snapshots', MAX(captured_at) FROM dbo.odds_snapshots
    UNION ALL SELECT 'prop_snapshots', MAX(captured_at) FROM dbo.prop_snapshots
    UNION ALL SELECT 'sync_state', MAX(last_run) FROM dbo.sync_state
)
SELECT c.table_name, c.row_count, l.last_write,
       DATEDIFF(HOUR, l.last_write, SYSUTCDATETIME()) AS hours_since_write
FROM counts c
LEFT JOIN latest l ON l.table_name = c.table_name;
GO
