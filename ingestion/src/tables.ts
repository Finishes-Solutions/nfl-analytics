/**
 * tables.ts — single source of truth for the database schema.
 *
 * Both the DDL generator (generate-ddl.ts) and the OPENJSON-based upsert layer
 * (db.ts) read from these specs, so column names/types can never drift between
 * the database and the ingestion code.
 *
 * Field inventory is the UNION of the BALLDONTLIE NFL docs example payloads and
 * the OpenAPI spec (the spec is stale/incomplete as of 2026-08; docs are richer).
 * Every table also stores raw_json so undocumented fields are never lost.
 */

export type SqlType =
  | { kind: 'int' }
  | { kind: 'bigint' }
  | { kind: 'tinyint' }
  | { kind: 'float' }
  | { kind: 'bit' }
  | { kind: 'nvarchar'; len: number | 'max' }
  | { kind: 'datetime2' };

export interface ColumnSpec {
  name: string;
  type: SqlType;
  nullable?: boolean; // default true
  pk?: boolean;
}

export interface TableSpec {
  name: string;
  columns: ColumnSpec[];
  /** append-only tables get an IDENTITY surrogate key + captured_at and are never MERGEd */
  appendOnly?: boolean;
  indexes?: { name: string; cols: string[] }[];
  /** add raw_json NVARCHAR(MAX) column (default true for fact tables) */
  rawJson?: boolean;
  /** add updated_at DATETIME2 maintained by upserts (default true for upsert tables) */
  trackUpdated?: boolean;
}

// ---- helpers ---------------------------------------------------------------

const I = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'int' }, ...o });
const BI = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'bigint' }, ...o });
const TI = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'tinyint' }, ...o });
const F = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'float' }, ...o });
const B = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'bit' }, ...o });
const S = (name: string, len: number | 'max' = 255, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'nvarchar', len }, ...o });
const D = (name: string, o: Partial<ColumnSpec> = {}): ColumnSpec => ({ name, type: { kind: 'datetime2' }, ...o });

// ---- dimension tables ------------------------------------------------------

export const teams: TableSpec = {
  name: 'teams',
  columns: [
    I('id', { pk: true, nullable: false }),
    S('conference', 8),
    S('division', 8),
    S('location', 64),
    S('name', 64),
    S('full_name', 96),
    S('abbreviation', 8),
  ],
  indexes: [{ name: 'IX_teams_abbr', cols: ['abbreviation'] }],
};

export const players: TableSpec = {
  name: 'players',
  columns: [
    I('id', { pk: true, nullable: false }),
    S('first_name', 64),
    S('last_name', 64),
    S('position', 48),
    S('position_abbreviation', 8),
    S('height', 16),          // raw display string, e.g. 6' 2"
    S('weight', 16),          // raw display string, e.g. 205 lbs
    I('height_inches'),       // parsed by ingestion
    I('weight_lbs'),          // parsed by ingestion
    S('jersey_number', 8),
    S('college', 96),
    S('experience', 32),
    I('age'),                 // snapshot at time of last sync — NOT historical
    I('team_id'),
    B('is_active'),
  ],
  indexes: [
    { name: 'IX_players_name', cols: ['last_name', 'first_name'] },
    { name: 'IX_players_team', cols: ['team_id'] },
    { name: 'IX_players_pos', cols: ['position_abbreviation'] },
  ],
};

// ---- games -----------------------------------------------------------------

export const games: TableSpec = {
  name: 'games',
  columns: [
    I('id', { pk: true, nullable: false }),
    I('season', { nullable: false }),
    I('week'),
    TI('season_type', { nullable: false }), // 1 pre / 2 reg / 3 post — from request context, NOT in API payload
    B('postseason'),
    D('game_date'),
    S('status', 32),
    S('venue', 128),
    S('summary', 1024),
    I('home_team_id'),
    I('visitor_team_id'),
    I('home_team_score'), I('home_team_q1'), I('home_team_q2'), I('home_team_q3'), I('home_team_q4'), I('home_team_ot'),
    I('visitor_team_score'), I('visitor_team_q1'), I('visitor_team_q2'), I('visitor_team_q3'), I('visitor_team_q4'), I('visitor_team_ot'),
  ],
  indexes: [
    { name: 'IX_games_season_week', cols: ['season', 'season_type', 'week'] },
    { name: 'IX_games_date', cols: ['game_date'] },
    { name: 'IX_games_home', cols: ['home_team_id', 'season'] },
    { name: 'IX_games_visitor', cols: ['visitor_team_id', 'season'] },
  ],
};

// ---- player game stats (box scores) ----------------------------------------

export const playerGameStats: TableSpec = {
  name: 'player_game_stats',
  columns: [
    I('game_id', { pk: true, nullable: false }),
    I('player_id', { pk: true, nullable: false }),
    I('team_id'),
    // denormalized from the game object for fast filtering
    I('season'), I('week'), TI('season_type'),
    // passing
    I('passing_completions'), I('passing_attempts'), I('passing_yards'),
    F('yards_per_pass_attempt'), I('passing_touchdowns'), I('passing_interceptions'),
    I('sacks'), I('sacks_loss'), F('qbr'), F('qb_rating'),
    // rushing
    I('rushing_attempts'), I('rushing_yards'), F('yards_per_rush_attempt'),
    I('rushing_touchdowns'), I('long_rushing'),
    // receiving
    I('receptions'), I('receiving_yards'), F('yards_per_reception'),
    I('receiving_touchdowns'), I('long_reception'), I('receiving_targets'),
    // fumbles
    I('fumbles'), I('fumbles_lost'), I('fumbles_recovered'),
    // defense
    I('total_tackles'), F('defensive_sacks'), I('solo_tackles'), F('tackles_for_loss'),
    I('passes_defended'), I('qb_hits'), I('fumbles_touchdowns'),
    I('defensive_interceptions'), I('interception_yards'), I('interception_touchdowns'),
    // returns
    I('kick_returns'), I('kick_return_yards'), F('yards_per_kick_return'),
    I('long_kick_return'), I('kick_return_touchdowns'),
    I('punt_returns'), I('punt_return_yards'), F('yards_per_punt_return'),
    I('long_punt_return'), I('punt_return_touchdowns'),
    // kicking
    I('field_goal_attempts'), I('field_goals_made'), F('field_goal_pct'),
    I('long_field_goal_made'), I('extra_points_made'), I('total_points'),
    // punting
    I('punts'), I('punt_yards'), F('gross_avg_punt_yards'),
    I('touchbacks'), I('punts_inside_20'), I('long_punt'),
  ],
  indexes: [
    { name: 'IX_pgs_player_season', cols: ['player_id', 'season', 'week'] },
    { name: 'IX_pgs_season_week', cols: ['season', 'season_type', 'week'] },
    { name: 'IX_pgs_team_season', cols: ['team_id', 'season'] },
  ],
};

// ---- team game stats -------------------------------------------------------

export const teamGameStats: TableSpec = {
  name: 'team_game_stats',
  columns: [
    I('game_id', { pk: true, nullable: false }),
    I('team_id', { pk: true, nullable: false }),
    I('season'), I('week'), TI('season_type'),
    S('home_away', 8),
    I('first_downs'), I('first_downs_passing'), I('first_downs_rushing'), I('first_downs_penalty'),
    S('third_down_efficiency', 16), I('third_down_conversions'), I('third_down_attempts'),
    S('fourth_down_efficiency', 16), I('fourth_down_conversions'), I('fourth_down_attempts'),
    I('total_offensive_plays'), I('total_yards'), F('yards_per_play'), I('total_drives'),
    I('net_passing_yards'), I('passing_completions'), I('passing_attempts'), F('yards_per_pass'),
    I('sacks'), I('sack_yards_lost'),
    I('rushing_yards'), I('rushing_attempts'), F('yards_per_rush_attempt'),
    I('red_zone_scores'), I('red_zone_attempts'),
    I('penalties'), I('penalty_yards'),
    I('turnovers'), I('fumbles_lost'), I('interceptions_thrown'),
    I('defensive_touchdowns'),
    S('possession_time', 8), I('possession_time_seconds'),
  ],
  indexes: [
    { name: 'IX_tgs_team_season', cols: ['team_id', 'season', 'week'] },
    { name: 'IX_tgs_season', cols: ['season', 'season_type', 'week'] },
  ],
};

// ---- player season stats ---------------------------------------------------

export const playerSeasonStats: TableSpec = {
  name: 'player_season_stats',
  columns: [
    I('player_id', { pk: true, nullable: false }),
    I('season', { pk: true, nullable: false }),
    TI('season_type', { pk: true, nullable: false }), // 2 reg / 3 post (no preseason on this endpoint)
    I('games_played'),
    B('postseason'),
    // passing (docs + spec union)
    I('passing_completions'), I('passing_attempts'), I('passing_yards'),
    F('passing_yards_per_game'), F('yards_per_pass_attempt'),
    I('passing_touchdowns'), I('passing_interceptions'), F('passing_completion_pct'),
    F('qbr'), F('qb_rating'),
    I('passing_first_downs'), F('passing_first_down_pct'),
    I('passing_20_plus_yards'), I('passing_40_plus_yards'), I('passing_long'),
    I('passing_sacks'), I('passing_sack_yards'),
    // rushing
    I('rushing_attempts'), I('rushing_yards'), F('rushing_yards_per_game'),
    F('yards_per_rush_attempt'), F('rushing_average'),
    I('rushing_touchdowns'), I('rushing_fumbles'), I('rushing_fumbles_lost'),
    I('rushing_first_downs'), F('rushing_first_down_pct'),
    I('rushing_20_plus_yards'), I('rushing_40_plus_yards'), I('rushing_long'),
    // receiving
    I('receptions'), I('receiving_yards'), F('receiving_yards_per_game'),
    F('yards_per_reception'), F('receiving_average'),
    I('receiving_touchdowns'), I('receiving_fumbles'), I('receiving_fumbles_lost'),
    I('receiving_first_downs'), F('receiving_first_down_pct'),
    I('receiving_20_plus_yards'), I('receiving_40_plus_yards'), I('receiving_long'),
    I('receiving_targets'),
    // fumbles
    I('fumbles'), I('fumbles_lost'), I('fumbles_forced'), I('fumbles_recovered'), I('fumbles_touchdowns'),
    // defense
    I('total_tackles'), F('defensive_sacks'), I('defensive_sack_yards'),
    I('solo_tackles'), I('assist_tackles'),
    I('defensive_interceptions'), I('interception_touchdowns'),
    // returns
    I('kick_returns'), I('kick_return_yards'), F('yards_per_kick_return'), I('kick_return_touchdowns'),
    I('punt_returner_returns'), I('punt_returner_return_yards'), F('yards_per_punt_return'), I('punt_return_touchdowns'),
    // kicking / punting
    I('field_goal_attempts'), I('field_goals_made'), F('field_goal_pct'),
    I('punts'), I('punt_yards'),
    I('field_goals_made_1_19'), I('field_goals_made_20_29'), I('field_goals_made_30_39'),
    I('field_goals_made_40_49'), I('field_goals_made_50'),
    I('field_goals_attempts_1_19'), I('field_goals_attempts_20_29'), I('field_goals_attempts_30_39'),
    I('field_goals_attempts_40_49'), I('field_goals_attempts_50'),
  ],
  indexes: [{ name: 'IX_pss_season', cols: ['season', 'season_type'] }],
};

// ---- team season stats (the ~190-column monster) ---------------------------

/** base stat field names; each also exists as opp_<name>. All FLOAT per spec ("number, nullable"). */
const TEAM_SEASON_BASE = [
  'games_played', 'fumbles_recovered', 'fumbles_lost',
  'total_offensive_yards', 'total_offensive_yards_per_game',
  'net_passing_yards', 'net_passing_yards_per_game',
  'total_points', 'total_points_per_game',
  'passing_completions', 'passing_yards', 'passing_yards_per_game', 'passing_attempts',
  'passing_completion_pct', 'net_total_offensive_yards', 'net_total_offensive_yards_per_game',
  'net_yards_per_pass_attempt', 'yards_per_pass_attempt', 'passing_long',
  'passing_touchdowns', 'passing_interceptions', 'passing_sacks', 'passing_sack_yards_lost',
  'passing_qb_rating',
  'rushing_yards', 'rushing_yards_per_game', 'rushing_attempts', 'rushing_yards_per_rush_attempt',
  'rushing_long', 'rushing_touchdowns', 'rushing_fumbles', 'rushing_fumbles_lost',
  'receiving_receptions', 'receiving_yards', 'receiving_yards_per_reception', 'receiving_long',
  'receiving_touchdowns', 'receiving_fumbles', 'receiving_fumbles_lost', 'receiving_yards_per_game',
  'misc_first_downs', 'misc_first_downs_rushing', 'misc_first_downs_passing', 'misc_first_downs_penalty',
  'misc_third_down_convs', 'misc_third_down_attempts', 'misc_third_down_conv_pct',
  'misc_fourth_down_convs', 'misc_fourth_down_attempts', 'misc_fourth_down_conv_pct',
  'misc_total_penalties', 'misc_total_penalty_yards',
  'misc_turnover_differential', 'misc_total_takeaways', 'misc_total_giveaways',
  'returning_kick_returns', 'returning_kick_return_yards', 'returning_yards_per_kick_return',
  'returning_long_kick_return', 'returning_kick_return_touchdowns',
  'returning_punt_returns', 'returning_punt_return_yards', 'returning_yards_per_punt_return',
  'returning_long_punt_return', 'returning_punt_return_touchdowns', 'returning_punt_return_fair_catches',
  'kicking_field_goals_made', 'kicking_field_goal_attempts', 'kicking_field_goal_pct',
  'kicking_long_field_goal_made',
  'kicking_field_goals_made_1_19', 'kicking_field_goals_made_20_29', 'kicking_field_goals_made_30_39',
  'kicking_field_goals_made_40_49', 'kicking_field_goals_made_50',
  'kicking_field_goal_attempts_1_19', 'kicking_field_goal_attempts_20_29', 'kicking_field_goal_attempts_30_39',
  'kicking_field_goal_attempts_40_49', 'kicking_field_goal_attempts_50',
  'kicking_extra_points_made', 'kicking_extra_point_attempts', 'kicking_extra_point_pct',
  'punting_punts', 'punting_punt_yards', 'punting_long_punt',
  'punting_gross_avg_punt_yards', 'punting_net_avg_punt_yards', 'punting_punts_blocked',
  'punting_punts_inside_20', 'punting_touchbacks', 'punting_fair_catches',
  'punting_punt_returns', 'punting_punt_return_yards', 'punting_avg_punt_return_yards',
  'defensive_interceptions',
] as const;

export const TEAM_SEASON_STAT_FIELDS: string[] = [
  ...TEAM_SEASON_BASE,
  ...TEAM_SEASON_BASE.map((n) => `opp_${n}`),
];

export const teamSeasonStats: TableSpec = {
  name: 'team_season_stats',
  columns: [
    I('team_id', { pk: true, nullable: false }),
    I('season', { pk: true, nullable: false }),
    TI('season_type', { pk: true, nullable: false }),
    ...TEAM_SEASON_STAT_FIELDS.map((n) => F(n)),
  ],
  indexes: [{ name: 'IX_tss_season', cols: ['season', 'season_type'] }],
};

// ---- standings -------------------------------------------------------------

export const standings: TableSpec = {
  name: 'standings',
  columns: [
    I('team_id', { pk: true, nullable: false }),
    I('season', { pk: true, nullable: false }),
    I('win_streak'), I('points_for'), I('points_against'),
    I('playoff_seed'), I('point_differential'),
    S('overall_record', 16), S('conference_record', 16), S('division_record', 16),
    I('wins'), I('losses'), I('ties'),
    S('home_record', 16), S('road_record', 16),
  ],
  indexes: [{ name: 'IX_standings_season', cols: ['season'] }],
};

// ---- advanced stats --------------------------------------------------------

const advKey: ColumnSpec[] = [
  I('player_id', { pk: true, nullable: false }),
  I('season', { pk: true, nullable: false }),
  I('week', { pk: true, nullable: false }), // 0 = full-season aggregate
  TI('season_type', { pk: true, nullable: false }),
  B('postseason'),
];

export const advPassing: TableSpec = {
  name: 'adv_passing_stats',
  columns: [
    ...advKey,
    F('aggressiveness'), I('attempts'), F('avg_air_distance'),
    F('avg_air_yards_differential'), F('avg_air_yards_to_sticks'),
    F('avg_completed_air_yards'), F('avg_intended_air_yards'), F('avg_time_to_throw'),
    F('completion_percentage'), F('completion_percentage_above_expectation'),
    I('completions'), F('expected_completion_percentage'), F('games_played'),
    F('interceptions'), F('max_air_distance'), F('max_completed_air_distance'),
    F('pass_touchdowns'), F('pass_yards'), F('passer_rating'),
  ],
  indexes: [{ name: 'IX_advp_season', cols: ['season', 'week'] }],
};

export const advRushing: TableSpec = {
  name: 'adv_rushing_stats',
  columns: [
    ...advKey,
    F('avg_time_to_los'), F('expected_rush_yards'), I('rush_attempts'),
    F('rush_pct_over_expected'), I('rush_touchdowns'), I('rush_yards'),
    F('rush_yards_over_expected'), F('rush_yards_over_expected_per_att'),
    F('efficiency'), F('percent_attempts_gte_eight_defenders'), F('avg_rush_yards'),
  ],
  indexes: [{ name: 'IX_advr_season', cols: ['season', 'week'] }],
};

export const advReceiving: TableSpec = {
  name: 'adv_receiving_stats',
  columns: [
    ...advKey,
    F('avg_cushion'), F('avg_expected_yac'), F('avg_intended_air_yards'),
    F('avg_separation'), F('avg_yac'), F('avg_yac_above_expectation'),
    F('catch_percentage'), F('percent_share_of_intended_air_yards'),
    I('rec_touchdowns'), I('receptions'), I('targets'), I('yards'),
  ],
  indexes: [{ name: 'IX_advrec_season', cols: ['season', 'week'] }],
};

// ---- plays -----------------------------------------------------------------

export const plays: TableSpec = {
  name: 'plays',
  columns: [
    S('id', 40, { pk: true, nullable: false }), // API play id is a string
    I('game_id', { nullable: false }),
    I('season'), I('week'), TI('season_type'),
    S('type_slug', 64), S('type_abbreviation', 16), S('type_text', 64),
    S('text', 'max'), S('short_text', 512),
    I('away_score'), I('home_score'), B('scoring_play'),
    I('period'), S('clock_display', 16),
    I('team_id'),
    I('start_yard_line'), I('start_down'), I('start_distance'), I('start_yards_to_endzone'),
    I('end_yard_line'), I('end_down'), I('end_distance'), I('end_yards_to_endzone'),
    S('end_down_distance_text', 64), S('end_short_down_distance_text', 32), S('end_possession_text', 32),
    I('stat_yardage'), F('home_win_probability'),
    D('wallclock'),
  ],
  indexes: [
    { name: 'IX_plays_game', cols: ['game_id', 'wallclock'] },
    { name: 'IX_plays_scoring', cols: ['scoring_play', 'game_id'] },
  ],
};

// ---- snapshot (append-only) tables ----------------------------------------

export const injurySnapshots: TableSpec = {
  name: 'injury_snapshots',
  appendOnly: true,
  columns: [
    I('player_id'), I('team_id'),
    S('status', 64), S('comment', 'max'), D('injury_date'),
  ],
  indexes: [{ name: 'IX_inj_player', cols: ['player_id', 'captured_at'] }],
};

export const rosterSnapshots: TableSpec = {
  name: 'roster_snapshots',
  appendOnly: true,
  columns: [
    I('season'), I('team_id'), I('player_id'),
    S('roster_position', 16), I('depth'),
    S('player_name', 128), S('injury_status', 64),
  ],
  indexes: [{ name: 'IX_roster_team', cols: ['team_id', 'season', 'captured_at'] }],
};

export const oddsSnapshots: TableSpec = {
  name: 'odds_snapshots',
  appendOnly: true,
  columns: [
    BI('api_odds_id'), I('game_id'), S('vendor', 32),
    S('spread_home_value', 16), F('spread_home'), I('spread_home_odds'),
    S('spread_away_value', 16), F('spread_away'), I('spread_away_odds'),
    I('moneyline_home_odds'), I('moneyline_away_odds'),
    S('total_value', 16), F('total_points'), I('total_over_odds'), I('total_under_odds'),
    D('api_updated_at'),
  ],
  indexes: [
    { name: 'IX_odds_game', cols: ['game_id', 'vendor', 'captured_at'] },
    { name: 'IX_odds_captured', cols: ['captured_at'] },
  ],
};

export const oddsOpening: TableSpec = {
  name: 'odds_opening',
  columns: [
    BI('api_odds_id', { pk: true, nullable: false }),
    I('game_id'), S('vendor', 32),
    S('spread_home_value', 16), F('spread_home'), I('spread_home_odds'),
    S('spread_away_value', 16), F('spread_away'), I('spread_away_odds'),
    I('moneyline_home_odds'), I('moneyline_away_odds'),
    S('total_value', 16), F('total_points'), I('total_over_odds'), I('total_under_odds'),
    D('opened_at'),
  ],
  indexes: [{ name: 'IX_oddsopen_game', cols: ['game_id', 'vendor'] }],
};

export const propSnapshots: TableSpec = {
  name: 'prop_snapshots',
  appendOnly: true,
  columns: [
    BI('api_prop_id'), I('game_id'), I('player_id'), S('vendor', 32),
    S('prop_type', 48), S('line_value', 16), F('line'),
    S('market_type', 16), I('over_odds'), I('under_odds'), I('milestone_odds'),
    D('api_updated_at'),
  ],
  indexes: [
    { name: 'IX_props_game', cols: ['game_id', 'captured_at'] },
    { name: 'IX_props_player', cols: ['player_id', 'prop_type', 'captured_at'] },
  ],
};

export const propOpening: TableSpec = {
  name: 'prop_opening',
  appendOnly: true, // opening prop IDs are not clearly globally unique; append + dedupe view if needed
  columns: [
    BI('api_prop_id'), I('game_id'), I('player_id'), S('vendor', 32),
    S('prop_type', 48), S('line_value', 16), F('line'),
    S('market_type', 16), I('over_odds'), I('under_odds'), I('milestone_odds'),
    D('opened_at'),
  ],
  indexes: [{ name: 'IX_propopen_game', cols: ['game_id', 'player_id', 'prop_type'] }],
};

// ---- infrastructure tables -------------------------------------------------

export const coverageMap: TableSpec = {
  name: 'coverage_map',
  rawJson: false,
  columns: [
    S('endpoint', 64, { pk: true, nullable: false }),
    I('season', { pk: true, nullable: false }),
    TI('season_type', { pk: true, nullable: false }),
    B('has_data'), I('sample_count'), D('checked_at'),
  ],
};

export const syncState: TableSpec = {
  name: 'sync_state',
  rawJson: false,
  columns: [
    S('scope', 128, { pk: true, nullable: false }),
    S('watermark', 128),
    D('last_run'),
    S('note', 512),
  ],
};

export const ALL_TABLES: TableSpec[] = [
  teams, players, games,
  playerGameStats, teamGameStats,
  playerSeasonStats, teamSeasonStats, standings,
  advPassing, advRushing, advReceiving,
  plays,
  injurySnapshots, rosterSnapshots,
  oddsSnapshots, oddsOpening, propSnapshots, propOpening,
  coverageMap, syncState,
];

/** effective column list including auto columns, mirroring generate-ddl */
export function effectiveColumns(t: TableSpec): ColumnSpec[] {
  const cols = [...t.columns];
  if (t.appendOnly) {
    cols.push(D('captured_at', { nullable: false }));
  }
  if (t.rawJson !== false) {
    cols.push(S('raw_json', 'max'));
  }
  return cols;
}
