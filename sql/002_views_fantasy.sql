/* =============================================================================
   002_views_fantasy.sql — Fantasy scoring semantic layer
   Computed, never stored: change a scoring rule here and 24 seasons rescore
   instantly. Three formats side by side (standard / half PPR / full PPR).

   Scoring rules (edit in ONE place: the fp_* expressions below):
     Passing:  0.04/yd · 4/TD · -2/INT
     Rushing:  0.1/yd  · 6/TD
     Receiving:0.1/yd  · 6/TD · receptions 0 / 0.5 / 1 by format
     Fumbles:  -2 per fumble lost · 6 per offensive fumble-recovery TD
     Returns:  6 per KR/PR TD
     Kicking:  3/FG made · 1/XP  (flat — see limitation 1)
     DST:      1/sack · 2/INT · 2/fumble rec · 6/def TD · points-allowed brackets

   Known limitations (documented, not hidden):
     1. Per-game FG distance isn't in the box score (only season buckets), so
        kickers score a flat 3/FG here. 40+/50+ bonuses would need parsing from
        plays.text — a later enhancement, the data is captured.
     2. Two-point conversions aren't a box-score field; they're also only
        recoverable from plays. Standard-league impact is small but nonzero.
     3. DST safeties and blocked kicks aren't box-score fields either; the
        bracket + turnover + sack + TD components cover ~95% of DST scoring.
============================================================================= */

/* ---------------------------------------------------------------------------
   Player fantasy points, per game. One row per player per game with the
   scoring components exposed so the dashboard can show the "why".
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_fantasy_game AS
SELECT
    s.game_id,
    s.player_id,
    s.team_id,
    s.season,
    s.week,
    s.season_type,
    p.first_name,
    p.last_name,
    p.position_abbreviation AS pos,

    /* component points (format-independent parts) */
    ISNULL(s.passing_yards, 0)        * 0.04                          AS pts_pass_yds,
    ISNULL(s.passing_touchdowns, 0)   * 4.0                           AS pts_pass_td,
    ISNULL(s.passing_interceptions,0) * -2.0                          AS pts_int,
    ISNULL(s.rushing_yards, 0)        * 0.1                           AS pts_rush_yds,
    ISNULL(s.rushing_touchdowns, 0)   * 6.0                           AS pts_rush_td,
    ISNULL(s.receiving_yards, 0)      * 0.1                           AS pts_rec_yds,
    ISNULL(s.receiving_touchdowns, 0) * 6.0                           AS pts_rec_td,
    ISNULL(s.fumbles_lost, 0)         * -2.0                          AS pts_fum_lost,
    (ISNULL(s.kick_return_touchdowns,0) + ISNULL(s.punt_return_touchdowns,0)
     + ISNULL(s.fumbles_touchdowns,0)) * 6.0                          AS pts_return_misc_td,
    ISNULL(s.field_goals_made, 0)     * 3.0
      + ISNULL(s.extra_points_made,0) * 1.0                           AS pts_kicking,
    ISNULL(s.receptions, 0)                                            AS receptions,

    /* the three formats */
    CAST(
        ISNULL(s.passing_yards,0)*0.04 + ISNULL(s.passing_touchdowns,0)*4
      - ISNULL(s.passing_interceptions,0)*2
      + ISNULL(s.rushing_yards,0)*0.1  + ISNULL(s.rushing_touchdowns,0)*6
      + ISNULL(s.receiving_yards,0)*0.1+ ISNULL(s.receiving_touchdowns,0)*6
      - ISNULL(s.fumbles_lost,0)*2
      + (ISNULL(s.kick_return_touchdowns,0)+ISNULL(s.punt_return_touchdowns,0)
         +ISNULL(s.fumbles_touchdowns,0))*6
      + ISNULL(s.field_goals_made,0)*3 + ISNULL(s.extra_points_made,0)
    AS DECIMAL(8,2))                                                  AS fp_standard,

    CAST(
        ISNULL(s.passing_yards,0)*0.04 + ISNULL(s.passing_touchdowns,0)*4
      - ISNULL(s.passing_interceptions,0)*2
      + ISNULL(s.rushing_yards,0)*0.1  + ISNULL(s.rushing_touchdowns,0)*6
      + ISNULL(s.receiving_yards,0)*0.1+ ISNULL(s.receiving_touchdowns,0)*6
      + ISNULL(s.receptions,0)*0.5
      - ISNULL(s.fumbles_lost,0)*2
      + (ISNULL(s.kick_return_touchdowns,0)+ISNULL(s.punt_return_touchdowns,0)
         +ISNULL(s.fumbles_touchdowns,0))*6
      + ISNULL(s.field_goals_made,0)*3 + ISNULL(s.extra_points_made,0)
    AS DECIMAL(8,2))                                                  AS fp_half_ppr,

    CAST(
        ISNULL(s.passing_yards,0)*0.04 + ISNULL(s.passing_touchdowns,0)*4
      - ISNULL(s.passing_interceptions,0)*2
      + ISNULL(s.rushing_yards,0)*0.1  + ISNULL(s.rushing_touchdowns,0)*6
      + ISNULL(s.receiving_yards,0)*0.1+ ISNULL(s.receiving_touchdowns,0)*6
      + ISNULL(s.receptions,0)*1.0
      - ISNULL(s.fumbles_lost,0)*2
      + (ISNULL(s.kick_return_touchdowns,0)+ISNULL(s.punt_return_touchdowns,0)
         +ISNULL(s.fumbles_touchdowns,0))*6
      + ISNULL(s.field_goals_made,0)*3 + ISNULL(s.extra_points_made,0)
    AS DECIMAL(8,2))                                                  AS fp_ppr
FROM dbo.player_game_stats s
JOIN dbo.players p ON p.id = s.player_id;
GO

/* ---------------------------------------------------------------------------
   Player fantasy points, per season: totals, per-game average, and the
   consistency profile (stddev + floor/ceiling) that totals hide.

   Stdev is exposed in all three formats so that a standard- or half-PPR
   leaderboard reports a rate column matching its own scoring. Reporting
   fp_ppr_stdev next to a standard total is silently wrong (fixed 2026-08-05).
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_fantasy_season AS
SELECT
    f.player_id,
    MAX(f.first_name) AS first_name,
    MAX(f.last_name)  AS last_name,
    MAX(f.pos)        AS pos,
    f.season,
    f.season_type,
    COUNT(*)                                   AS games,
    CAST(SUM(f.fp_standard) AS DECIMAL(9,2))   AS fp_standard_total,
    CAST(SUM(f.fp_half_ppr) AS DECIMAL(9,2))   AS fp_half_ppr_total,
    CAST(SUM(f.fp_ppr)      AS DECIMAL(9,2))   AS fp_ppr_total,
    CAST(AVG(f.fp_standard) AS DECIMAL(8,2))   AS fp_standard_pg,
    CAST(AVG(f.fp_half_ppr) AS DECIMAL(8,2))   AS fp_half_ppr_pg,
    CAST(AVG(f.fp_ppr)      AS DECIMAL(8,2))   AS fp_ppr_pg,
    CAST(STDEV(f.fp_standard) AS DECIMAL(8,2)) AS fp_standard_stdev,  -- boom/bust
    CAST(STDEV(f.fp_half_ppr) AS DECIMAL(8,2)) AS fp_half_ppr_stdev,
    CAST(STDEV(f.fp_ppr)      AS DECIMAL(8,2)) AS fp_ppr_stdev,
    CAST(MIN(f.fp_ppr)      AS DECIMAL(8,2))   AS fp_ppr_floor,
    CAST(MAX(f.fp_ppr)      AS DECIMAL(8,2))   AS fp_ppr_ceiling
FROM dbo.v_player_fantasy_game f
GROUP BY f.player_id, f.season, f.season_type;
GO

/* ---------------------------------------------------------------------------
   Team defense / special teams (DST) fantasy points, per game.
   Built from the OPPONENT's offensive row: their QB sacked = your sacks,
   their INTs thrown = your INTs, their fumbles lost = your recoveries,
   their score (from games) = your points allowed.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_dst_fantasy_game AS
SELECT
    me.game_id,
    me.team_id,
    t.abbreviation                              AS team,
    me.season,
    me.week,
    me.season_type,
    opp.team_id                                 AS opponent_team_id,
    CASE WHEN me.team_id = g.home_team_id
         THEN ISNULL(g.visitor_team_score, 0)
         ELSE ISNULL(g.home_team_score, 0) END  AS points_allowed,
    ISNULL(opp.sacks, 0)                        AS sacks,          -- opp QB sacked
    ISNULL(opp.interceptions_thrown, 0)         AS interceptions,
    ISNULL(opp.fumbles_lost, 0)                 AS fumble_recoveries,
    ISNULL(me.defensive_touchdowns, 0)          AS def_touchdowns,
    CAST(
        ISNULL(opp.sacks,0)*1.0
      + ISNULL(opp.interceptions_thrown,0)*2.0
      + ISNULL(opp.fumbles_lost,0)*2.0
      + ISNULL(me.defensive_touchdowns,0)*6.0
      + CASE
          WHEN pa.points_allowed = 0                THEN 10
          WHEN pa.points_allowed BETWEEN 1  AND 6   THEN 7
          WHEN pa.points_allowed BETWEEN 7  AND 13  THEN 4
          WHEN pa.points_allowed BETWEEN 14 AND 20  THEN 1
          WHEN pa.points_allowed BETWEEN 21 AND 27  THEN 0
          WHEN pa.points_allowed BETWEEN 28 AND 34  THEN -1
          ELSE -4
        END
    AS DECIMAL(8,2))                            AS fp_dst
FROM dbo.team_game_stats me
JOIN dbo.games g          ON g.id = me.game_id
JOIN dbo.team_game_stats opp
       ON opp.game_id = me.game_id AND opp.team_id <> me.team_id
JOIN dbo.teams t          ON t.id = me.team_id
CROSS APPLY (SELECT CASE WHEN me.team_id = g.home_team_id
                         THEN ISNULL(g.visitor_team_score, 0)
                         ELSE ISNULL(g.home_team_score, 0) END AS points_allowed) pa;
GO

/* ---------------------------------------------------------------------------
   DST per season.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_dst_fantasy_season AS
SELECT
    d.team_id,
    MAX(d.team)                              AS team,
    d.season,
    d.season_type,
    COUNT(*)                                 AS games,
    CAST(SUM(d.fp_dst) AS DECIMAL(9,2))      AS fp_dst_total,
    CAST(AVG(d.fp_dst) AS DECIMAL(8,2))      AS fp_dst_pg,
    SUM(d.sacks)                             AS sacks,
    SUM(d.interceptions)                     AS interceptions,
    SUM(d.fumble_recoveries)                 AS fumble_recoveries,
    SUM(d.def_touchdowns)                    AS def_touchdowns,
    SUM(d.points_allowed)                    AS points_allowed
FROM dbo.v_dst_fantasy_game d
GROUP BY d.team_id, d.season, d.season_type;
GO

/* ---------------------------------------------------------------------------
   Fantasy points ALLOWED by each defense, per position — "matchup difficulty",
   the most-asked fantasy question, and the input your projections will need.
   (PPR basis; swap the column to change format.)
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_fantasy_points_allowed AS
SELECT
    d.team_id                                AS defense_team_id,
    t.abbreviation                           AS defense,
    f.pos,
    f.season,
    f.season_type,
    COUNT(DISTINCT f.game_id)                AS games,
    CAST(SUM(f.fp_ppr)  AS DECIMAL(9,2))     AS fp_ppr_allowed_total,
    CAST(SUM(f.fp_ppr) * 1.0
         / NULLIF(COUNT(DISTINCT f.game_id),0) AS DECIMAL(8,2)) AS fp_ppr_allowed_pg
FROM dbo.v_player_fantasy_game f
JOIN dbo.games g ON g.id = f.game_id
CROSS APPLY (SELECT CASE WHEN f.team_id = g.home_team_id
                         THEN g.visitor_team_id ELSE g.home_team_id END AS team_id) d
JOIN dbo.teams t ON t.id = d.team_id
GROUP BY d.team_id, t.abbreviation, f.pos, f.season, f.season_type;
GO
/* ---------------------------------------------------------------------------
   Season totals derived from GAMELOGS, not from the season_stats endpoint.

   Why: dbo.player_season_stats is unreliable for passing detail. As of the
   2002-2026 backfill, passing_interceptions is NULL for roughly two-thirds of
   qualifying QB seasons (e.g. 4 of 39 populated in 2024), and some populated
   values are simply wrong (Baker Mayfield 2024 stored as 1 INT; actual 16).
   dbo.player_game_stats has validated correctly against the public record on
   every spot-check, so aggregate from there instead.

   Use this view — not player_season_stats — for any season-level passing math.
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_player_season_from_games AS
SELECT
    player_id,
    season,
    season_type,
    COUNT(*)                   AS games,
    SUM(passing_completions)   AS passing_completions,
    SUM(passing_attempts)      AS passing_attempts,
    SUM(passing_yards)         AS passing_yards,
    SUM(passing_touchdowns)    AS passing_touchdowns,
    SUM(passing_interceptions) AS passing_interceptions,
    SUM(rushing_attempts)      AS rushing_attempts,
    SUM(rushing_yards)         AS rushing_yards,
    SUM(rushing_touchdowns)    AS rushing_touchdowns,
    SUM(receptions)            AS receptions,
    SUM(receiving_targets)     AS receiving_targets,
    SUM(receiving_yards)       AS receiving_yards,
    SUM(receiving_touchdowns)  AS receiving_touchdowns
FROM dbo.player_game_stats
GROUP BY player_id, season, season_type;
GO

/* ---------------------------------------------------------------------------
   Traditional NFL passer rating (0-158.3).

   Why: the season_stats endpoint returns qb_rating NULL on all 1,028
   qualifying seasons. It does return qbr (ESPN Total QBR, 0-100) on 943 of
   them, but that is a different metric and not interchangeable.

   Four components, each clamped to [0, 2.375], averaged and scaled by 100/6.
   Reads from v_player_season_from_games for the INT-accuracy reason above.

   Validated: Brady 2009 = 96.17 (actual 96.2), Rodgers 2011 = 122.46 (122.5),
   Manning 2004 = 121.11 (121.1), Brady 2007 = 117.18 (117.2).
--------------------------------------------------------------------------- */
CREATE OR ALTER VIEW dbo.v_qb_passer_rating AS
SELECT player_id, season, season_type,
  CAST(((
    CASE WHEN (1.0*passing_completions/NULLIF(passing_attempts,0) - 0.3)*5 > 2.375 THEN 2.375
         WHEN (1.0*passing_completions/NULLIF(passing_attempts,0) - 0.3)*5 < 0 THEN 0
         ELSE (1.0*passing_completions/NULLIF(passing_attempts,0) - 0.3)*5 END +
    CASE WHEN (1.0*passing_yards/NULLIF(passing_attempts,0) - 3)*0.25 > 2.375 THEN 2.375
         WHEN (1.0*passing_yards/NULLIF(passing_attempts,0) - 3)*0.25 < 0 THEN 0
         ELSE (1.0*passing_yards/NULLIF(passing_attempts,0) - 3)*0.25 END +
    CASE WHEN (1.0*passing_touchdowns/NULLIF(passing_attempts,0))*20 > 2.375 THEN 2.375
         ELSE (1.0*passing_touchdowns/NULLIF(passing_attempts,0))*20 END +
    CASE WHEN 2.375 - (1.0*passing_interceptions/NULLIF(passing_attempts,0))*25 < 0 THEN 0
         ELSE 2.375 - (1.0*passing_interceptions/NULLIF(passing_attempts,0))*25 END
  ) / 6.0) * 100 AS DECIMAL(6,2)) AS passer_rating
FROM dbo.v_player_season_from_games
WHERE passing_attempts > 0;
GO
