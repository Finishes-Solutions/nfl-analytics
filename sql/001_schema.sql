/* =============================================================================
   BALLDONTLIE NFL Analytics Warehouse — Azure SQL schema
   Generated from ingestion/src/tables.ts on 2026-08-01
   Do not edit by hand; edit tables.ts and re-run: npx tsx src/generate-ddl.ts

   Conventions:
   - API IDs are used as primary keys; all upserts MERGE on those keys.
   - Every fact table stores raw_json (verbatim API row) so undocumented
     fields are never lost. Spec/docs disagree; raw capture is the safety net.
   - Snapshot tables (injuries, rosters, odds, props) are APPEND-ONLY with an
     IDENTITY snapshot_id + captured_at; they build history the API discards.
   - season_type: 1 = preseason, 2 = regular, 3 = postseason (from request
     context — the API payloads only carry a boolean 'postseason').
   - Rate stats are FLOAT even where the OpenAPI spec says integer (the spec
     is wrong: QBR, yards-per-attempt etc. are fractional in real payloads).
============================================================================= */

IF OBJECT_ID('dbo.teams', 'U') IS NULL
CREATE TABLE dbo.[teams] (
  [id] INT NOT NULL,
  [conference] NVARCHAR(8) NULL,
  [division] NVARCHAR(8) NULL,
  [location] NVARCHAR(64) NULL,
  [name] NVARCHAR(64) NULL,
  [full_name] NVARCHAR(96) NULL,
  [abbreviation] NVARCHAR(8) NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_teams_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_teams_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_teams] PRIMARY KEY CLUSTERED ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_teams_abbr' AND object_id = OBJECT_ID('dbo.teams'))
  CREATE NONCLUSTERED INDEX [IX_teams_abbr] ON dbo.[teams] ([abbreviation]);
GO

IF OBJECT_ID('dbo.players', 'U') IS NULL
CREATE TABLE dbo.[players] (
  [id] INT NOT NULL,
  [first_name] NVARCHAR(64) NULL,
  [last_name] NVARCHAR(64) NULL,
  [position] NVARCHAR(48) NULL,
  [position_abbreviation] NVARCHAR(8) NULL,
  [height] NVARCHAR(16) NULL,
  [weight] NVARCHAR(16) NULL,
  [height_inches] INT NULL,
  [weight_lbs] INT NULL,
  [jersey_number] NVARCHAR(8) NULL,
  [college] NVARCHAR(96) NULL,
  [experience] NVARCHAR(32) NULL,
  [age] INT NULL,
  [team_id] INT NULL,
  [is_active] BIT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_players_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_players_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_players] PRIMARY KEY CLUSTERED ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_players_name' AND object_id = OBJECT_ID('dbo.players'))
  CREATE NONCLUSTERED INDEX [IX_players_name] ON dbo.[players] ([last_name], [first_name]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_players_team' AND object_id = OBJECT_ID('dbo.players'))
  CREATE NONCLUSTERED INDEX [IX_players_team] ON dbo.[players] ([team_id]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_players_pos' AND object_id = OBJECT_ID('dbo.players'))
  CREATE NONCLUSTERED INDEX [IX_players_pos] ON dbo.[players] ([position_abbreviation]);
GO

IF OBJECT_ID('dbo.games', 'U') IS NULL
CREATE TABLE dbo.[games] (
  [id] INT NOT NULL,
  [season] INT NOT NULL,
  [week] INT NULL,
  [season_type] TINYINT NOT NULL,
  [postseason] BIT NULL,
  [game_date] DATETIME2(3) NULL,
  [status] NVARCHAR(32) NULL,
  [venue] NVARCHAR(128) NULL,
  [summary] NVARCHAR(1024) NULL,
  [home_team_id] INT NULL,
  [visitor_team_id] INT NULL,
  [home_team_score] INT NULL,
  [home_team_q1] INT NULL,
  [home_team_q2] INT NULL,
  [home_team_q3] INT NULL,
  [home_team_q4] INT NULL,
  [home_team_ot] INT NULL,
  [visitor_team_score] INT NULL,
  [visitor_team_q1] INT NULL,
  [visitor_team_q2] INT NULL,
  [visitor_team_q3] INT NULL,
  [visitor_team_q4] INT NULL,
  [visitor_team_ot] INT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_games_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_games_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_games] PRIMARY KEY CLUSTERED ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_games_season_week' AND object_id = OBJECT_ID('dbo.games'))
  CREATE NONCLUSTERED INDEX [IX_games_season_week] ON dbo.[games] ([season], [season_type], [week]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_games_date' AND object_id = OBJECT_ID('dbo.games'))
  CREATE NONCLUSTERED INDEX [IX_games_date] ON dbo.[games] ([game_date]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_games_home' AND object_id = OBJECT_ID('dbo.games'))
  CREATE NONCLUSTERED INDEX [IX_games_home] ON dbo.[games] ([home_team_id], [season]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_games_visitor' AND object_id = OBJECT_ID('dbo.games'))
  CREATE NONCLUSTERED INDEX [IX_games_visitor] ON dbo.[games] ([visitor_team_id], [season]);
GO

IF OBJECT_ID('dbo.player_game_stats', 'U') IS NULL
CREATE TABLE dbo.[player_game_stats] (
  [game_id] INT NOT NULL,
  [player_id] INT NOT NULL,
  [team_id] INT NULL,
  [season] INT NULL,
  [week] INT NULL,
  [season_type] TINYINT NULL,
  [passing_completions] INT NULL,
  [passing_attempts] INT NULL,
  [passing_yards] INT NULL,
  [yards_per_pass_attempt] FLOAT NULL,
  [passing_touchdowns] INT NULL,
  [passing_interceptions] INT NULL,
  [sacks] INT NULL,
  [sacks_loss] INT NULL,
  [qbr] FLOAT NULL,
  [qb_rating] FLOAT NULL,
  [rushing_attempts] INT NULL,
  [rushing_yards] INT NULL,
  [yards_per_rush_attempt] FLOAT NULL,
  [rushing_touchdowns] INT NULL,
  [long_rushing] INT NULL,
  [receptions] INT NULL,
  [receiving_yards] INT NULL,
  [yards_per_reception] FLOAT NULL,
  [receiving_touchdowns] INT NULL,
  [long_reception] INT NULL,
  [receiving_targets] INT NULL,
  [fumbles] INT NULL,
  [fumbles_lost] INT NULL,
  [fumbles_recovered] INT NULL,
  [total_tackles] INT NULL,
  [defensive_sacks] FLOAT NULL,
  [solo_tackles] INT NULL,
  [tackles_for_loss] FLOAT NULL,
  [passes_defended] INT NULL,
  [qb_hits] INT NULL,
  [fumbles_touchdowns] INT NULL,
  [defensive_interceptions] INT NULL,
  [interception_yards] INT NULL,
  [interception_touchdowns] INT NULL,
  [kick_returns] INT NULL,
  [kick_return_yards] INT NULL,
  [yards_per_kick_return] FLOAT NULL,
  [long_kick_return] INT NULL,
  [kick_return_touchdowns] INT NULL,
  [punt_returns] INT NULL,
  [punt_return_yards] INT NULL,
  [yards_per_punt_return] FLOAT NULL,
  [long_punt_return] INT NULL,
  [punt_return_touchdowns] INT NULL,
  [field_goal_attempts] INT NULL,
  [field_goals_made] INT NULL,
  [field_goal_pct] FLOAT NULL,
  [long_field_goal_made] INT NULL,
  [extra_points_made] INT NULL,
  [total_points] INT NULL,
  [punts] INT NULL,
  [punt_yards] INT NULL,
  [gross_avg_punt_yards] FLOAT NULL,
  [touchbacks] INT NULL,
  [punts_inside_20] INT NULL,
  [long_punt] INT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_player_game_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_player_game_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_player_game_stats] PRIMARY KEY CLUSTERED ([game_id], [player_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pgs_player_season' AND object_id = OBJECT_ID('dbo.player_game_stats'))
  CREATE NONCLUSTERED INDEX [IX_pgs_player_season] ON dbo.[player_game_stats] ([player_id], [season], [week]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pgs_season_week' AND object_id = OBJECT_ID('dbo.player_game_stats'))
  CREATE NONCLUSTERED INDEX [IX_pgs_season_week] ON dbo.[player_game_stats] ([season], [season_type], [week]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pgs_team_season' AND object_id = OBJECT_ID('dbo.player_game_stats'))
  CREATE NONCLUSTERED INDEX [IX_pgs_team_season] ON dbo.[player_game_stats] ([team_id], [season]);
GO

IF OBJECT_ID('dbo.team_game_stats', 'U') IS NULL
CREATE TABLE dbo.[team_game_stats] (
  [game_id] INT NOT NULL,
  [team_id] INT NOT NULL,
  [season] INT NULL,
  [week] INT NULL,
  [season_type] TINYINT NULL,
  [home_away] NVARCHAR(8) NULL,
  [first_downs] INT NULL,
  [first_downs_passing] INT NULL,
  [first_downs_rushing] INT NULL,
  [first_downs_penalty] INT NULL,
  [third_down_efficiency] NVARCHAR(16) NULL,
  [third_down_conversions] INT NULL,
  [third_down_attempts] INT NULL,
  [fourth_down_efficiency] NVARCHAR(16) NULL,
  [fourth_down_conversions] INT NULL,
  [fourth_down_attempts] INT NULL,
  [total_offensive_plays] INT NULL,
  [total_yards] INT NULL,
  [yards_per_play] FLOAT NULL,
  [total_drives] INT NULL,
  [net_passing_yards] INT NULL,
  [passing_completions] INT NULL,
  [passing_attempts] INT NULL,
  [yards_per_pass] FLOAT NULL,
  [sacks] INT NULL,
  [sack_yards_lost] INT NULL,
  [rushing_yards] INT NULL,
  [rushing_attempts] INT NULL,
  [yards_per_rush_attempt] FLOAT NULL,
  [red_zone_scores] INT NULL,
  [red_zone_attempts] INT NULL,
  [penalties] INT NULL,
  [penalty_yards] INT NULL,
  [turnovers] INT NULL,
  [fumbles_lost] INT NULL,
  [interceptions_thrown] INT NULL,
  [defensive_touchdowns] INT NULL,
  [possession_time] NVARCHAR(8) NULL,
  [possession_time_seconds] INT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_team_game_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_team_game_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_team_game_stats] PRIMARY KEY CLUSTERED ([game_id], [team_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tgs_team_season' AND object_id = OBJECT_ID('dbo.team_game_stats'))
  CREATE NONCLUSTERED INDEX [IX_tgs_team_season] ON dbo.[team_game_stats] ([team_id], [season], [week]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tgs_season' AND object_id = OBJECT_ID('dbo.team_game_stats'))
  CREATE NONCLUSTERED INDEX [IX_tgs_season] ON dbo.[team_game_stats] ([season], [season_type], [week]);
GO

IF OBJECT_ID('dbo.player_season_stats', 'U') IS NULL
CREATE TABLE dbo.[player_season_stats] (
  [player_id] INT NOT NULL,
  [season] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [games_played] INT NULL,
  [postseason] BIT NULL,
  [passing_completions] INT NULL,
  [passing_attempts] INT NULL,
  [passing_yards] INT NULL,
  [passing_yards_per_game] FLOAT NULL,
  [yards_per_pass_attempt] FLOAT NULL,
  [passing_touchdowns] INT NULL,
  [passing_interceptions] INT NULL,
  [passing_completion_pct] FLOAT NULL,
  [qbr] FLOAT NULL,
  [qb_rating] FLOAT NULL,
  [passing_first_downs] INT NULL,
  [passing_first_down_pct] FLOAT NULL,
  [passing_20_plus_yards] INT NULL,
  [passing_40_plus_yards] INT NULL,
  [passing_long] INT NULL,
  [passing_sacks] INT NULL,
  [passing_sack_yards] INT NULL,
  [rushing_attempts] INT NULL,
  [rushing_yards] INT NULL,
  [rushing_yards_per_game] FLOAT NULL,
  [yards_per_rush_attempt] FLOAT NULL,
  [rushing_average] FLOAT NULL,
  [rushing_touchdowns] INT NULL,
  [rushing_fumbles] INT NULL,
  [rushing_fumbles_lost] INT NULL,
  [rushing_first_downs] INT NULL,
  [rushing_first_down_pct] FLOAT NULL,
  [rushing_20_plus_yards] INT NULL,
  [rushing_40_plus_yards] INT NULL,
  [rushing_long] INT NULL,
  [receptions] INT NULL,
  [receiving_yards] INT NULL,
  [receiving_yards_per_game] FLOAT NULL,
  [yards_per_reception] FLOAT NULL,
  [receiving_average] FLOAT NULL,
  [receiving_touchdowns] INT NULL,
  [receiving_fumbles] INT NULL,
  [receiving_fumbles_lost] INT NULL,
  [receiving_first_downs] INT NULL,
  [receiving_first_down_pct] FLOAT NULL,
  [receiving_20_plus_yards] INT NULL,
  [receiving_40_plus_yards] INT NULL,
  [receiving_long] INT NULL,
  [receiving_targets] INT NULL,
  [fumbles] INT NULL,
  [fumbles_lost] INT NULL,
  [fumbles_forced] INT NULL,
  [fumbles_recovered] INT NULL,
  [fumbles_touchdowns] INT NULL,
  [total_tackles] INT NULL,
  [defensive_sacks] FLOAT NULL,
  [defensive_sack_yards] INT NULL,
  [solo_tackles] INT NULL,
  [assist_tackles] INT NULL,
  [defensive_interceptions] INT NULL,
  [interception_touchdowns] INT NULL,
  [kick_returns] INT NULL,
  [kick_return_yards] INT NULL,
  [yards_per_kick_return] FLOAT NULL,
  [kick_return_touchdowns] INT NULL,
  [punt_returner_returns] INT NULL,
  [punt_returner_return_yards] INT NULL,
  [yards_per_punt_return] FLOAT NULL,
  [punt_return_touchdowns] INT NULL,
  [field_goal_attempts] INT NULL,
  [field_goals_made] INT NULL,
  [field_goal_pct] FLOAT NULL,
  [punts] INT NULL,
  [punt_yards] INT NULL,
  [field_goals_made_1_19] INT NULL,
  [field_goals_made_20_29] INT NULL,
  [field_goals_made_30_39] INT NULL,
  [field_goals_made_40_49] INT NULL,
  [field_goals_made_50] INT NULL,
  [field_goals_attempts_1_19] INT NULL,
  [field_goals_attempts_20_29] INT NULL,
  [field_goals_attempts_30_39] INT NULL,
  [field_goals_attempts_40_49] INT NULL,
  [field_goals_attempts_50] INT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_player_season_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_player_season_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_player_season_stats] PRIMARY KEY CLUSTERED ([player_id], [season], [season_type])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pss_season' AND object_id = OBJECT_ID('dbo.player_season_stats'))
  CREATE NONCLUSTERED INDEX [IX_pss_season] ON dbo.[player_season_stats] ([season], [season_type]);
GO

IF OBJECT_ID('dbo.team_season_stats', 'U') IS NULL
CREATE TABLE dbo.[team_season_stats] (
  [team_id] INT NOT NULL,
  [season] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [games_played] FLOAT NULL,
  [fumbles_recovered] FLOAT NULL,
  [fumbles_lost] FLOAT NULL,
  [total_offensive_yards] FLOAT NULL,
  [total_offensive_yards_per_game] FLOAT NULL,
  [net_passing_yards] FLOAT NULL,
  [net_passing_yards_per_game] FLOAT NULL,
  [total_points] FLOAT NULL,
  [total_points_per_game] FLOAT NULL,
  [passing_completions] FLOAT NULL,
  [passing_yards] FLOAT NULL,
  [passing_yards_per_game] FLOAT NULL,
  [passing_attempts] FLOAT NULL,
  [passing_completion_pct] FLOAT NULL,
  [net_total_offensive_yards] FLOAT NULL,
  [net_total_offensive_yards_per_game] FLOAT NULL,
  [net_yards_per_pass_attempt] FLOAT NULL,
  [yards_per_pass_attempt] FLOAT NULL,
  [passing_long] FLOAT NULL,
  [passing_touchdowns] FLOAT NULL,
  [passing_interceptions] FLOAT NULL,
  [passing_sacks] FLOAT NULL,
  [passing_sack_yards_lost] FLOAT NULL,
  [passing_qb_rating] FLOAT NULL,
  [rushing_yards] FLOAT NULL,
  [rushing_yards_per_game] FLOAT NULL,
  [rushing_attempts] FLOAT NULL,
  [rushing_yards_per_rush_attempt] FLOAT NULL,
  [rushing_long] FLOAT NULL,
  [rushing_touchdowns] FLOAT NULL,
  [rushing_fumbles] FLOAT NULL,
  [rushing_fumbles_lost] FLOAT NULL,
  [receiving_receptions] FLOAT NULL,
  [receiving_yards] FLOAT NULL,
  [receiving_yards_per_reception] FLOAT NULL,
  [receiving_long] FLOAT NULL,
  [receiving_touchdowns] FLOAT NULL,
  [receiving_fumbles] FLOAT NULL,
  [receiving_fumbles_lost] FLOAT NULL,
  [receiving_yards_per_game] FLOAT NULL,
  [misc_first_downs] FLOAT NULL,
  [misc_first_downs_rushing] FLOAT NULL,
  [misc_first_downs_passing] FLOAT NULL,
  [misc_first_downs_penalty] FLOAT NULL,
  [misc_third_down_convs] FLOAT NULL,
  [misc_third_down_attempts] FLOAT NULL,
  [misc_third_down_conv_pct] FLOAT NULL,
  [misc_fourth_down_convs] FLOAT NULL,
  [misc_fourth_down_attempts] FLOAT NULL,
  [misc_fourth_down_conv_pct] FLOAT NULL,
  [misc_total_penalties] FLOAT NULL,
  [misc_total_penalty_yards] FLOAT NULL,
  [misc_turnover_differential] FLOAT NULL,
  [misc_total_takeaways] FLOAT NULL,
  [misc_total_giveaways] FLOAT NULL,
  [returning_kick_returns] FLOAT NULL,
  [returning_kick_return_yards] FLOAT NULL,
  [returning_yards_per_kick_return] FLOAT NULL,
  [returning_long_kick_return] FLOAT NULL,
  [returning_kick_return_touchdowns] FLOAT NULL,
  [returning_punt_returns] FLOAT NULL,
  [returning_punt_return_yards] FLOAT NULL,
  [returning_yards_per_punt_return] FLOAT NULL,
  [returning_long_punt_return] FLOAT NULL,
  [returning_punt_return_touchdowns] FLOAT NULL,
  [returning_punt_return_fair_catches] FLOAT NULL,
  [kicking_field_goals_made] FLOAT NULL,
  [kicking_field_goal_attempts] FLOAT NULL,
  [kicking_field_goal_pct] FLOAT NULL,
  [kicking_long_field_goal_made] FLOAT NULL,
  [kicking_field_goals_made_1_19] FLOAT NULL,
  [kicking_field_goals_made_20_29] FLOAT NULL,
  [kicking_field_goals_made_30_39] FLOAT NULL,
  [kicking_field_goals_made_40_49] FLOAT NULL,
  [kicking_field_goals_made_50] FLOAT NULL,
  [kicking_field_goal_attempts_1_19] FLOAT NULL,
  [kicking_field_goal_attempts_20_29] FLOAT NULL,
  [kicking_field_goal_attempts_30_39] FLOAT NULL,
  [kicking_field_goal_attempts_40_49] FLOAT NULL,
  [kicking_field_goal_attempts_50] FLOAT NULL,
  [kicking_extra_points_made] FLOAT NULL,
  [kicking_extra_point_attempts] FLOAT NULL,
  [kicking_extra_point_pct] FLOAT NULL,
  [punting_punts] FLOAT NULL,
  [punting_punt_yards] FLOAT NULL,
  [punting_long_punt] FLOAT NULL,
  [punting_gross_avg_punt_yards] FLOAT NULL,
  [punting_net_avg_punt_yards] FLOAT NULL,
  [punting_punts_blocked] FLOAT NULL,
  [punting_punts_inside_20] FLOAT NULL,
  [punting_touchbacks] FLOAT NULL,
  [punting_fair_catches] FLOAT NULL,
  [punting_punt_returns] FLOAT NULL,
  [punting_punt_return_yards] FLOAT NULL,
  [punting_avg_punt_return_yards] FLOAT NULL,
  [defensive_interceptions] FLOAT NULL,
  [opp_games_played] FLOAT NULL,
  [opp_fumbles_recovered] FLOAT NULL,
  [opp_fumbles_lost] FLOAT NULL,
  [opp_total_offensive_yards] FLOAT NULL,
  [opp_total_offensive_yards_per_game] FLOAT NULL,
  [opp_net_passing_yards] FLOAT NULL,
  [opp_net_passing_yards_per_game] FLOAT NULL,
  [opp_total_points] FLOAT NULL,
  [opp_total_points_per_game] FLOAT NULL,
  [opp_passing_completions] FLOAT NULL,
  [opp_passing_yards] FLOAT NULL,
  [opp_passing_yards_per_game] FLOAT NULL,
  [opp_passing_attempts] FLOAT NULL,
  [opp_passing_completion_pct] FLOAT NULL,
  [opp_net_total_offensive_yards] FLOAT NULL,
  [opp_net_total_offensive_yards_per_game] FLOAT NULL,
  [opp_net_yards_per_pass_attempt] FLOAT NULL,
  [opp_yards_per_pass_attempt] FLOAT NULL,
  [opp_passing_long] FLOAT NULL,
  [opp_passing_touchdowns] FLOAT NULL,
  [opp_passing_interceptions] FLOAT NULL,
  [opp_passing_sacks] FLOAT NULL,
  [opp_passing_sack_yards_lost] FLOAT NULL,
  [opp_passing_qb_rating] FLOAT NULL,
  [opp_rushing_yards] FLOAT NULL,
  [opp_rushing_yards_per_game] FLOAT NULL,
  [opp_rushing_attempts] FLOAT NULL,
  [opp_rushing_yards_per_rush_attempt] FLOAT NULL,
  [opp_rushing_long] FLOAT NULL,
  [opp_rushing_touchdowns] FLOAT NULL,
  [opp_rushing_fumbles] FLOAT NULL,
  [opp_rushing_fumbles_lost] FLOAT NULL,
  [opp_receiving_receptions] FLOAT NULL,
  [opp_receiving_yards] FLOAT NULL,
  [opp_receiving_yards_per_reception] FLOAT NULL,
  [opp_receiving_long] FLOAT NULL,
  [opp_receiving_touchdowns] FLOAT NULL,
  [opp_receiving_fumbles] FLOAT NULL,
  [opp_receiving_fumbles_lost] FLOAT NULL,
  [opp_receiving_yards_per_game] FLOAT NULL,
  [opp_misc_first_downs] FLOAT NULL,
  [opp_misc_first_downs_rushing] FLOAT NULL,
  [opp_misc_first_downs_passing] FLOAT NULL,
  [opp_misc_first_downs_penalty] FLOAT NULL,
  [opp_misc_third_down_convs] FLOAT NULL,
  [opp_misc_third_down_attempts] FLOAT NULL,
  [opp_misc_third_down_conv_pct] FLOAT NULL,
  [opp_misc_fourth_down_convs] FLOAT NULL,
  [opp_misc_fourth_down_attempts] FLOAT NULL,
  [opp_misc_fourth_down_conv_pct] FLOAT NULL,
  [opp_misc_total_penalties] FLOAT NULL,
  [opp_misc_total_penalty_yards] FLOAT NULL,
  [opp_misc_turnover_differential] FLOAT NULL,
  [opp_misc_total_takeaways] FLOAT NULL,
  [opp_misc_total_giveaways] FLOAT NULL,
  [opp_returning_kick_returns] FLOAT NULL,
  [opp_returning_kick_return_yards] FLOAT NULL,
  [opp_returning_yards_per_kick_return] FLOAT NULL,
  [opp_returning_long_kick_return] FLOAT NULL,
  [opp_returning_kick_return_touchdowns] FLOAT NULL,
  [opp_returning_punt_returns] FLOAT NULL,
  [opp_returning_punt_return_yards] FLOAT NULL,
  [opp_returning_yards_per_punt_return] FLOAT NULL,
  [opp_returning_long_punt_return] FLOAT NULL,
  [opp_returning_punt_return_touchdowns] FLOAT NULL,
  [opp_returning_punt_return_fair_catches] FLOAT NULL,
  [opp_kicking_field_goals_made] FLOAT NULL,
  [opp_kicking_field_goal_attempts] FLOAT NULL,
  [opp_kicking_field_goal_pct] FLOAT NULL,
  [opp_kicking_long_field_goal_made] FLOAT NULL,
  [opp_kicking_field_goals_made_1_19] FLOAT NULL,
  [opp_kicking_field_goals_made_20_29] FLOAT NULL,
  [opp_kicking_field_goals_made_30_39] FLOAT NULL,
  [opp_kicking_field_goals_made_40_49] FLOAT NULL,
  [opp_kicking_field_goals_made_50] FLOAT NULL,
  [opp_kicking_field_goal_attempts_1_19] FLOAT NULL,
  [opp_kicking_field_goal_attempts_20_29] FLOAT NULL,
  [opp_kicking_field_goal_attempts_30_39] FLOAT NULL,
  [opp_kicking_field_goal_attempts_40_49] FLOAT NULL,
  [opp_kicking_field_goal_attempts_50] FLOAT NULL,
  [opp_kicking_extra_points_made] FLOAT NULL,
  [opp_kicking_extra_point_attempts] FLOAT NULL,
  [opp_kicking_extra_point_pct] FLOAT NULL,
  [opp_punting_punts] FLOAT NULL,
  [opp_punting_punt_yards] FLOAT NULL,
  [opp_punting_long_punt] FLOAT NULL,
  [opp_punting_gross_avg_punt_yards] FLOAT NULL,
  [opp_punting_net_avg_punt_yards] FLOAT NULL,
  [opp_punting_punts_blocked] FLOAT NULL,
  [opp_punting_punts_inside_20] FLOAT NULL,
  [opp_punting_touchbacks] FLOAT NULL,
  [opp_punting_fair_catches] FLOAT NULL,
  [opp_punting_punt_returns] FLOAT NULL,
  [opp_punting_punt_return_yards] FLOAT NULL,
  [opp_punting_avg_punt_return_yards] FLOAT NULL,
  [opp_defensive_interceptions] FLOAT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_team_season_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_team_season_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_team_season_stats] PRIMARY KEY CLUSTERED ([team_id], [season], [season_type])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tss_season' AND object_id = OBJECT_ID('dbo.team_season_stats'))
  CREATE NONCLUSTERED INDEX [IX_tss_season] ON dbo.[team_season_stats] ([season], [season_type]);
GO

IF OBJECT_ID('dbo.standings', 'U') IS NULL
CREATE TABLE dbo.[standings] (
  [team_id] INT NOT NULL,
  [season] INT NOT NULL,
  [win_streak] INT NULL,
  [points_for] INT NULL,
  [points_against] INT NULL,
  [playoff_seed] INT NULL,
  [point_differential] INT NULL,
  [overall_record] NVARCHAR(16) NULL,
  [conference_record] NVARCHAR(16) NULL,
  [division_record] NVARCHAR(16) NULL,
  [wins] INT NULL,
  [losses] INT NULL,
  [ties] INT NULL,
  [home_record] NVARCHAR(16) NULL,
  [road_record] NVARCHAR(16) NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_standings_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_standings_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_standings] PRIMARY KEY CLUSTERED ([team_id], [season])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_standings_season' AND object_id = OBJECT_ID('dbo.standings'))
  CREATE NONCLUSTERED INDEX [IX_standings_season] ON dbo.[standings] ([season]);
GO

IF OBJECT_ID('dbo.adv_passing_stats', 'U') IS NULL
CREATE TABLE dbo.[adv_passing_stats] (
  [player_id] INT NOT NULL,
  [season] INT NOT NULL,
  [week] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [postseason] BIT NULL,
  [aggressiveness] FLOAT NULL,
  [attempts] INT NULL,
  [avg_air_distance] FLOAT NULL,
  [avg_air_yards_differential] FLOAT NULL,
  [avg_air_yards_to_sticks] FLOAT NULL,
  [avg_completed_air_yards] FLOAT NULL,
  [avg_intended_air_yards] FLOAT NULL,
  [avg_time_to_throw] FLOAT NULL,
  [completion_percentage] FLOAT NULL,
  [completion_percentage_above_expectation] FLOAT NULL,
  [completions] INT NULL,
  [expected_completion_percentage] FLOAT NULL,
  [games_played] FLOAT NULL,
  [interceptions] FLOAT NULL,
  [max_air_distance] FLOAT NULL,
  [max_completed_air_distance] FLOAT NULL,
  [pass_touchdowns] FLOAT NULL,
  [pass_yards] FLOAT NULL,
  [passer_rating] FLOAT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_passing_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_passing_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_adv_passing_stats] PRIMARY KEY CLUSTERED ([player_id], [season], [week], [season_type])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_advp_season' AND object_id = OBJECT_ID('dbo.adv_passing_stats'))
  CREATE NONCLUSTERED INDEX [IX_advp_season] ON dbo.[adv_passing_stats] ([season], [week]);
GO

IF OBJECT_ID('dbo.adv_rushing_stats', 'U') IS NULL
CREATE TABLE dbo.[adv_rushing_stats] (
  [player_id] INT NOT NULL,
  [season] INT NOT NULL,
  [week] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [postseason] BIT NULL,
  [avg_time_to_los] FLOAT NULL,
  [expected_rush_yards] FLOAT NULL,
  [rush_attempts] INT NULL,
  [rush_pct_over_expected] FLOAT NULL,
  [rush_touchdowns] INT NULL,
  [rush_yards] INT NULL,
  [rush_yards_over_expected] FLOAT NULL,
  [rush_yards_over_expected_per_att] FLOAT NULL,
  [efficiency] FLOAT NULL,
  [percent_attempts_gte_eight_defenders] FLOAT NULL,
  [avg_rush_yards] FLOAT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_rushing_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_rushing_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_adv_rushing_stats] PRIMARY KEY CLUSTERED ([player_id], [season], [week], [season_type])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_advr_season' AND object_id = OBJECT_ID('dbo.adv_rushing_stats'))
  CREATE NONCLUSTERED INDEX [IX_advr_season] ON dbo.[adv_rushing_stats] ([season], [week]);
GO

IF OBJECT_ID('dbo.adv_receiving_stats', 'U') IS NULL
CREATE TABLE dbo.[adv_receiving_stats] (
  [player_id] INT NOT NULL,
  [season] INT NOT NULL,
  [week] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [postseason] BIT NULL,
  [avg_cushion] FLOAT NULL,
  [avg_expected_yac] FLOAT NULL,
  [avg_intended_air_yards] FLOAT NULL,
  [avg_separation] FLOAT NULL,
  [avg_yac] FLOAT NULL,
  [avg_yac_above_expectation] FLOAT NULL,
  [catch_percentage] FLOAT NULL,
  [percent_share_of_intended_air_yards] FLOAT NULL,
  [rec_touchdowns] INT NULL,
  [receptions] INT NULL,
  [targets] INT NULL,
  [yards] INT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_receiving_stats_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_adv_receiving_stats_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_adv_receiving_stats] PRIMARY KEY CLUSTERED ([player_id], [season], [week], [season_type])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_advrec_season' AND object_id = OBJECT_ID('dbo.adv_receiving_stats'))
  CREATE NONCLUSTERED INDEX [IX_advrec_season] ON dbo.[adv_receiving_stats] ([season], [week]);
GO

IF OBJECT_ID('dbo.plays', 'U') IS NULL
CREATE TABLE dbo.[plays] (
  [id] NVARCHAR(40) NOT NULL,
  [game_id] INT NOT NULL,
  [season] INT NULL,
  [week] INT NULL,
  [season_type] TINYINT NULL,
  [type_slug] NVARCHAR(64) NULL,
  [type_abbreviation] NVARCHAR(16) NULL,
  [type_text] NVARCHAR(64) NULL,
  [text] NVARCHAR(MAX) NULL,
  [short_text] NVARCHAR(512) NULL,
  [away_score] INT NULL,
  [home_score] INT NULL,
  [scoring_play] BIT NULL,
  [period] INT NULL,
  [clock_display] NVARCHAR(16) NULL,
  [team_id] INT NULL,
  [start_yard_line] INT NULL,
  [start_down] INT NULL,
  [start_distance] INT NULL,
  [start_yards_to_endzone] INT NULL,
  [end_yard_line] INT NULL,
  [end_down] INT NULL,
  [end_distance] INT NULL,
  [end_yards_to_endzone] INT NULL,
  [end_down_distance_text] NVARCHAR(64) NULL,
  [end_short_down_distance_text] NVARCHAR(32) NULL,
  [end_possession_text] NVARCHAR(32) NULL,
  [stat_yardage] INT NULL,
  [home_win_probability] FLOAT NULL,
  [wallclock] DATETIME2(3) NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_plays_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_plays_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_plays] PRIMARY KEY CLUSTERED ([id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_plays_game' AND object_id = OBJECT_ID('dbo.plays'))
  CREATE NONCLUSTERED INDEX [IX_plays_game] ON dbo.[plays] ([game_id], [wallclock]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_plays_scoring' AND object_id = OBJECT_ID('dbo.plays'))
  CREATE NONCLUSTERED INDEX [IX_plays_scoring] ON dbo.[plays] ([scoring_play], [game_id]);
GO

IF OBJECT_ID('dbo.injury_snapshots', 'U') IS NULL
CREATE TABLE dbo.[injury_snapshots] (
  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL,
  [player_id] INT NULL,
  [team_id] INT NULL,
  [status] NVARCHAR(64) NULL,
  [comment] NVARCHAR(MAX) NULL,
  [injury_date] DATETIME2(3) NULL,
  [captured_at] DATETIME2(3) NOT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  CONSTRAINT [PK_injury_snapshots] PRIMARY KEY CLUSTERED ([snapshot_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_inj_player' AND object_id = OBJECT_ID('dbo.injury_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_inj_player] ON dbo.[injury_snapshots] ([player_id], [captured_at]);
GO

IF OBJECT_ID('dbo.roster_snapshots', 'U') IS NULL
CREATE TABLE dbo.[roster_snapshots] (
  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL,
  [season] INT NULL,
  [team_id] INT NULL,
  [player_id] INT NULL,
  [roster_position] NVARCHAR(16) NULL,
  [depth] INT NULL,
  [player_name] NVARCHAR(128) NULL,
  [injury_status] NVARCHAR(64) NULL,
  [captured_at] DATETIME2(3) NOT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  CONSTRAINT [PK_roster_snapshots] PRIMARY KEY CLUSTERED ([snapshot_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_roster_team' AND object_id = OBJECT_ID('dbo.roster_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_roster_team] ON dbo.[roster_snapshots] ([team_id], [season], [captured_at]);
GO

IF OBJECT_ID('dbo.odds_snapshots', 'U') IS NULL
CREATE TABLE dbo.[odds_snapshots] (
  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL,
  [api_odds_id] BIGINT NULL,
  [game_id] INT NULL,
  [vendor] NVARCHAR(32) NULL,
  [spread_home_value] NVARCHAR(16) NULL,
  [spread_home] FLOAT NULL,
  [spread_home_odds] INT NULL,
  [spread_away_value] NVARCHAR(16) NULL,
  [spread_away] FLOAT NULL,
  [spread_away_odds] INT NULL,
  [moneyline_home_odds] INT NULL,
  [moneyline_away_odds] INT NULL,
  [total_value] NVARCHAR(16) NULL,
  [total_points] FLOAT NULL,
  [total_over_odds] INT NULL,
  [total_under_odds] INT NULL,
  [api_updated_at] DATETIME2(3) NULL,
  [captured_at] DATETIME2(3) NOT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  CONSTRAINT [PK_odds_snapshots] PRIMARY KEY CLUSTERED ([snapshot_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_odds_game' AND object_id = OBJECT_ID('dbo.odds_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_odds_game] ON dbo.[odds_snapshots] ([game_id], [vendor], [captured_at]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_odds_captured' AND object_id = OBJECT_ID('dbo.odds_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_odds_captured] ON dbo.[odds_snapshots] ([captured_at]);
GO

IF OBJECT_ID('dbo.odds_opening', 'U') IS NULL
CREATE TABLE dbo.[odds_opening] (
  [api_odds_id] BIGINT NOT NULL,
  [game_id] INT NULL,
  [vendor] NVARCHAR(32) NULL,
  [spread_home_value] NVARCHAR(16) NULL,
  [spread_home] FLOAT NULL,
  [spread_home_odds] INT NULL,
  [spread_away_value] NVARCHAR(16) NULL,
  [spread_away] FLOAT NULL,
  [spread_away_odds] INT NULL,
  [moneyline_home_odds] INT NULL,
  [moneyline_away_odds] INT NULL,
  [total_value] NVARCHAR(16) NULL,
  [total_points] FLOAT NULL,
  [total_over_odds] INT NULL,
  [total_under_odds] INT NULL,
  [opened_at] DATETIME2(3) NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_odds_opening_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_odds_opening_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_odds_opening] PRIMARY KEY CLUSTERED ([api_odds_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_oddsopen_game' AND object_id = OBJECT_ID('dbo.odds_opening'))
  CREATE NONCLUSTERED INDEX [IX_oddsopen_game] ON dbo.[odds_opening] ([game_id], [vendor]);
GO

IF OBJECT_ID('dbo.prop_snapshots', 'U') IS NULL
CREATE TABLE dbo.[prop_snapshots] (
  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL,
  [api_prop_id] BIGINT NULL,
  [game_id] INT NULL,
  [player_id] INT NULL,
  [vendor] NVARCHAR(32) NULL,
  [prop_type] NVARCHAR(48) NULL,
  [line_value] NVARCHAR(16) NULL,
  [line] FLOAT NULL,
  [market_type] NVARCHAR(16) NULL,
  [over_odds] INT NULL,
  [under_odds] INT NULL,
  [milestone_odds] INT NULL,
  [api_updated_at] DATETIME2(3) NULL,
  [captured_at] DATETIME2(3) NOT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  CONSTRAINT [PK_prop_snapshots] PRIMARY KEY CLUSTERED ([snapshot_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_props_game' AND object_id = OBJECT_ID('dbo.prop_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_props_game] ON dbo.[prop_snapshots] ([game_id], [captured_at]);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_props_player' AND object_id = OBJECT_ID('dbo.prop_snapshots'))
  CREATE NONCLUSTERED INDEX [IX_props_player] ON dbo.[prop_snapshots] ([player_id], [prop_type], [captured_at]);
GO

IF OBJECT_ID('dbo.prop_opening', 'U') IS NULL
CREATE TABLE dbo.[prop_opening] (
  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL,
  [api_prop_id] BIGINT NULL,
  [game_id] INT NULL,
  [player_id] INT NULL,
  [vendor] NVARCHAR(32) NULL,
  [prop_type] NVARCHAR(48) NULL,
  [line_value] NVARCHAR(16) NULL,
  [line] FLOAT NULL,
  [market_type] NVARCHAR(16) NULL,
  [over_odds] INT NULL,
  [under_odds] INT NULL,
  [milestone_odds] INT NULL,
  [opened_at] DATETIME2(3) NULL,
  [captured_at] DATETIME2(3) NOT NULL,
  [raw_json] NVARCHAR(MAX) NULL,
  CONSTRAINT [PK_prop_opening] PRIMARY KEY CLUSTERED ([snapshot_id])
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_propopen_game' AND object_id = OBJECT_ID('dbo.prop_opening'))
  CREATE NONCLUSTERED INDEX [IX_propopen_game] ON dbo.[prop_opening] ([game_id], [player_id], [prop_type]);
GO

IF OBJECT_ID('dbo.coverage_map', 'U') IS NULL
CREATE TABLE dbo.[coverage_map] (
  [endpoint] NVARCHAR(64) NOT NULL,
  [season] INT NOT NULL,
  [season_type] TINYINT NOT NULL,
  [has_data] BIT NULL,
  [sample_count] INT NULL,
  [checked_at] DATETIME2(3) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_coverage_map_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_coverage_map_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_coverage_map] PRIMARY KEY CLUSTERED ([endpoint], [season], [season_type])
);
GO

IF OBJECT_ID('dbo.sync_state', 'U') IS NULL
CREATE TABLE dbo.[sync_state] (
  [scope] NVARCHAR(128) NOT NULL,
  [watermark] NVARCHAR(128) NULL,
  [last_run] DATETIME2(3) NULL,
  [note] NVARCHAR(512) NULL,
  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_sync_state_first_seen DEFAULT SYSUTCDATETIME(),
  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_sync_state_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT [PK_sync_state] PRIMARY KEY CLUSTERED ([scope])
);
GO

/* ----------------------------------------------------------------------------
   Read-only principal for the MCP server / dashboard API.
   1) In master:   CREATE LOGIN nfl_readonly WITH PASSWORD = '<strong-password>';
   2) In this DB:  run the block below.
---------------------------------------------------------------------------- */
/*
CREATE USER nfl_readonly FOR LOGIN nfl_readonly;
ALTER ROLE db_datareader ADD MEMBER nfl_readonly;
DENY INSERT, UPDATE, DELETE, EXECUTE TO nfl_readonly;
*/
