# Schema Reference — All 20 Tables + Semantic Layer

> Generated from `ingestion/src/tables.ts` (the single source of truth). Regenerate after editing specs (`python3 tools/gen_schema_doc.py`).

Conventions: PK columns marked **PK**. Every fact table carries `raw_json` (verbatim API row). Upsert tables carry `first_seen_at`/`updated_at`; append-only tables carry `snapshot_id` (IDENTITY) + `captured_at`.


## Dimensions

### `teams`

One row per franchise. Static.

| Column | Type | Key |
|---|---|---|
| id | INT | **PK** |
| conference | NVARCHAR |  |
| division | NVARCHAR |  |
| location | NVARCHAR |  |
| name | NVARCHAR |  |
| full_name | NVARCHAR |  |
| abbreviation | NVARCHAR |  |
| raw_json | NVARCHAR |  |

### `players`

All-time player dimension. `height_inches`/`weight_lbs` are parsed by ingestion; `age`, height, weight are **current snapshots**, not historical. `is_active` set by the active-player sweep.

| Column | Type | Key |
|---|---|---|
| id | INT | **PK** |
| first_name | NVARCHAR |  |
| last_name | NVARCHAR |  |
| position | NVARCHAR |  |
| position_abbreviation | NVARCHAR |  |
| height | NVARCHAR |  |
| weight | NVARCHAR |  |
| height_inches | INT |  |
| weight_lbs | INT |  |
| jersey_number | NVARCHAR |  |
| college | NVARCHAR |  |
| experience | NVARCHAR |  |
| age | INT |  |
| team_id | INT |  |
| is_active | BIT |  |
| raw_json | NVARCHAR |  |

### `games`

All seasons, all season types. `season_type` (1=pre, 2=reg, 3=post) is stamped from request context — payloads only carry a `postseason` boolean.

| Column | Type | Key |
|---|---|---|
| id | INT | **PK** |
| season | INT |  |
| week | INT |  |
| season_type | TINYINT |  |
| postseason | BIT |  |
| game_date | DATETIME2 |  |
| status | NVARCHAR |  |
| venue | NVARCHAR |  |
| summary | NVARCHAR |  |
| home_team_id | INT |  |
| visitor_team_id | INT |  |
| home_team_score | INT |  |
| home_team_q1 | INT |  |
| home_team_q2 | INT |  |
| home_team_q3 | INT |  |
| home_team_q4 | INT |  |
| home_team_ot | INT |  |
| visitor_team_score | INT |  |
| visitor_team_q1 | INT |  |
| visitor_team_q2 | INT |  |
| visitor_team_q3 | INT |  |
| visitor_team_q4 | INT |  |
| visitor_team_ot | INT |  |
| raw_json | NVARCHAR |  |


## Game Facts

### `player_game_stats`

The core box-score fact table, ~25k rows/season. All seven stat families in typed columns.

| Column | Type | Key |
|---|---|---|
| game_id | INT | **PK** |
| player_id | INT | **PK** |
| team_id | INT |  |
| season | INT |  |
| week | INT |  |
| season_type | TINYINT |  |
| passing_completions | INT |  |
| passing_attempts | INT |  |
| passing_yards | INT |  |
| yards_per_pass_attempt | FLOAT |  |
| passing_touchdowns | INT |  |
| passing_interceptions | INT |  |
| sacks | INT |  |
| sacks_loss | INT |  |
| qbr | FLOAT |  |
| qb_rating | FLOAT |  |
| rushing_attempts | INT |  |
| rushing_yards | INT |  |
| yards_per_rush_attempt | FLOAT |  |
| rushing_touchdowns | INT |  |
| long_rushing | INT |  |
| receptions | INT |  |
| receiving_yards | INT |  |
| yards_per_reception | FLOAT |  |
| receiving_touchdowns | INT |  |
| long_reception | INT |  |
| receiving_targets | INT |  |
| fumbles | INT |  |
| fumbles_lost | INT |  |
| fumbles_recovered | INT |  |
| total_tackles | INT |  |
| defensive_sacks | FLOAT |  |
| solo_tackles | INT |  |
| tackles_for_loss | FLOAT |  |
| passes_defended | INT |  |
| qb_hits | INT |  |
| fumbles_touchdowns | INT |  |
| defensive_interceptions | INT |  |
| interception_yards | INT |  |
| interception_touchdowns | INT |  |
| kick_returns | INT |  |
| kick_return_yards | INT |  |
| yards_per_kick_return | FLOAT |  |
| long_kick_return | INT |  |
| kick_return_touchdowns | INT |  |
| punt_returns | INT |  |
| punt_return_yards | INT |  |
| yards_per_punt_return | FLOAT |  |
| long_punt_return | INT |  |
| punt_return_touchdowns | INT |  |
| field_goal_attempts | INT |  |
| field_goals_made | INT |  |
| field_goal_pct | FLOAT |  |
| long_field_goal_made | INT |  |
| extra_points_made | INT |  |
| total_points | INT |  |
| punts | INT |  |
| punt_yards | INT |  |
| gross_avg_punt_yards | FLOAT |  |
| touchbacks | INT |  |
| punts_inside_20 | INT |  |
| long_punt | INT |  |
| raw_json | NVARCHAR |  |

### `team_game_stats`

Two rows per game. Note: `sacks` here = this team's QB sacked (offensive perspective) — the DST view exploits this via the opponent-row join.

| Column | Type | Key |
|---|---|---|
| game_id | INT | **PK** |
| team_id | INT | **PK** |
| season | INT |  |
| week | INT |  |
| season_type | TINYINT |  |
| home_away | NVARCHAR |  |
| first_downs | INT |  |
| first_downs_passing | INT |  |
| first_downs_rushing | INT |  |
| first_downs_penalty | INT |  |
| third_down_efficiency | NVARCHAR |  |
| third_down_conversions | INT |  |
| third_down_attempts | INT |  |
| fourth_down_efficiency | NVARCHAR |  |
| fourth_down_conversions | INT |  |
| fourth_down_attempts | INT |  |
| total_offensive_plays | INT |  |
| total_yards | INT |  |
| yards_per_play | FLOAT |  |
| total_drives | INT |  |
| net_passing_yards | INT |  |
| passing_completions | INT |  |
| passing_attempts | INT |  |
| yards_per_pass | FLOAT |  |
| sacks | INT |  |
| sack_yards_lost | INT |  |
| rushing_yards | INT |  |
| rushing_attempts | INT |  |
| yards_per_rush_attempt | FLOAT |  |
| red_zone_scores | INT |  |
| red_zone_attempts | INT |  |
| penalties | INT |  |
| penalty_yards | INT |  |
| turnovers | INT |  |
| fumbles_lost | INT |  |
| interceptions_thrown | INT |  |
| defensive_touchdowns | INT |  |
| possession_time | NVARCHAR |  |
| possession_time_seconds | INT |  |
| raw_json | NVARCHAR |  |

### `plays`

Full play-by-play incl. `home_win_probability`. String PK from the API. Postseason requires `season_type=3` on fetch or the endpoint silently returns nothing.

| Column | Type | Key |
|---|---|---|
| id | NVARCHAR | **PK** |
| game_id | INT |  |
| season | INT |  |
| week | INT |  |
| season_type | TINYINT |  |
| type_slug | NVARCHAR |  |
| type_abbreviation | NVARCHAR |  |
| type_text | NVARCHAR |  |
| text | NVARCHAR |  |
| short_text | NVARCHAR |  |
| away_score | INT |  |
| home_score | INT |  |
| scoring_play | BIT |  |
| period | INT |  |
| clock_display | NVARCHAR |  |
| team_id | INT |  |
| start_yard_line | INT |  |
| start_down | INT |  |
| start_distance | INT |  |
| start_yards_to_endzone | INT |  |
| end_yard_line | INT |  |
| end_down | INT |  |
| end_distance | INT |  |
| end_yards_to_endzone | INT |  |
| end_down_distance_text | NVARCHAR |  |
| end_short_down_distance_text | NVARCHAR |  |
| end_possession_text | NVARCHAR |  |
| stat_yardage | INT |  |
| home_win_probability | FLOAT |  |
| wallclock | DATETIME2 |  |
| raw_json | NVARCHAR |  |


## Season Facts

### `player_season_stats`

Season aggregates (reg + post only; no preseason upstream). Union of docs + spec fields.

| Column | Type | Key |
|---|---|---|
| player_id | INT | **PK** |
| season | INT | **PK** |
| season_type | TINYINT | **PK** |
| games_played | INT |  |
| postseason | BIT |  |
| passing_completions | INT |  |
| passing_attempts | INT |  |
| passing_yards | INT |  |
| passing_yards_per_game | FLOAT |  |
| yards_per_pass_attempt | FLOAT |  |
| passing_touchdowns | INT |  |
| passing_interceptions | INT |  |
| passing_completion_pct | FLOAT |  |
| qbr | FLOAT |  |
| qb_rating | FLOAT |  |
| passing_first_downs | INT |  |
| passing_first_down_pct | FLOAT |  |
| passing_20_plus_yards | INT |  |
| passing_40_plus_yards | INT |  |
| passing_long | INT |  |
| passing_sacks | INT |  |
| passing_sack_yards | INT |  |
| rushing_attempts | INT |  |
| rushing_yards | INT |  |
| rushing_yards_per_game | FLOAT |  |
| yards_per_rush_attempt | FLOAT |  |
| rushing_average | FLOAT |  |
| rushing_touchdowns | INT |  |
| rushing_fumbles | INT |  |
| rushing_fumbles_lost | INT |  |
| rushing_first_downs | INT |  |
| rushing_first_down_pct | FLOAT |  |
| rushing_20_plus_yards | INT |  |
| rushing_40_plus_yards | INT |  |
| rushing_long | INT |  |
| receptions | INT |  |
| receiving_yards | INT |  |
| receiving_yards_per_game | FLOAT |  |
| yards_per_reception | FLOAT |  |
| receiving_average | FLOAT |  |
| receiving_touchdowns | INT |  |
| receiving_fumbles | INT |  |
| receiving_fumbles_lost | INT |  |
| receiving_first_downs | INT |  |
| receiving_first_down_pct | FLOAT |  |
| receiving_20_plus_yards | INT |  |
| receiving_40_plus_yards | INT |  |
| receiving_long | INT |  |
| receiving_targets | INT |  |
| fumbles | INT |  |
| fumbles_lost | INT |  |
| fumbles_forced | INT |  |
| fumbles_recovered | INT |  |
| fumbles_touchdowns | INT |  |
| total_tackles | INT |  |
| defensive_sacks | FLOAT |  |
| defensive_sack_yards | INT |  |
| solo_tackles | INT |  |
| assist_tackles | INT |  |
| defensive_interceptions | INT |  |
| interception_touchdowns | INT |  |
| kick_returns | INT |  |
| kick_return_yards | INT |  |
| yards_per_kick_return | FLOAT |  |
| kick_return_touchdowns | INT |  |
| punt_returner_returns | INT |  |
| punt_returner_return_yards | INT |  |
| yards_per_punt_return | FLOAT |  |
| punt_return_touchdowns | INT |  |
| field_goal_attempts | INT |  |
| field_goals_made | INT |  |
| field_goal_pct | FLOAT |  |
| punts | INT |  |
| punt_yards | INT |  |
| field_goals_made_1_19 | INT |  |
| field_goals_made_20_29 | INT |  |
| field_goals_made_30_39 | INT |  |
| field_goals_made_40_49 | INT |  |
| field_goals_made_50 | INT |  |
| field_goals_attempts_1_19 | INT |  |
| field_goals_attempts_20_29 | INT |  |
| field_goals_attempts_30_39 | INT |  |
| field_goals_attempts_40_49 | INT |  |
| field_goals_attempts_50 | INT |  |
| raw_json | NVARCHAR |  |

### `team_season_stats`

The 190-column table: every stat plus its `opp_` mirror. All stat fields FLOAT (the spec's integer typing is wrong).

| Column | Type | Key |
|---|---|---|
| team_id | INT | **PK** |
| season | INT | **PK** |
| season_type | TINYINT | **PK** |
| *…190 stat columns…* | FLOAT | see `TEAM_SEASON_STAT_FIELDS` in tables.ts |
| raw_json | NVARCHAR(MAX) | |

### `standings`

Per team-season records, streaks, seed, differential.

| Column | Type | Key |
|---|---|---|
| team_id | INT | **PK** |
| season | INT | **PK** |
| win_streak | INT |  |
| points_for | INT |  |
| points_against | INT |  |
| playoff_seed | INT |  |
| point_differential | INT |  |
| overall_record | NVARCHAR |  |
| conference_record | NVARCHAR |  |
| division_record | NVARCHAR |  |
| wins | INT |  |
| losses | INT |  |
| ties | INT |  |
| home_record | NVARCHAR |  |
| road_record | NVARCHAR |  |
| raw_json | NVARCHAR |  |


## Advanced (Tracking-Era) Stats

### `adv_passing_stats`

Next Gen-style metrics. `week=0` = full-season aggregate row.

| Column | Type | Key |
|---|---|---|
| player_id | INT | **PK** |
| season | INT | **PK** |
| week | INT | **PK** |
| season_type | TINYINT | **PK** |
| postseason | BIT |  |
| aggressiveness | FLOAT |  |
| attempts | INT |  |
| avg_air_distance | FLOAT |  |
| avg_air_yards_differential | FLOAT |  |
| avg_air_yards_to_sticks | FLOAT |  |
| avg_completed_air_yards | FLOAT |  |
| avg_intended_air_yards | FLOAT |  |
| avg_time_to_throw | FLOAT |  |
| completion_percentage | FLOAT |  |
| completion_percentage_above_expectation | FLOAT |  |
| completions | INT |  |
| expected_completion_percentage | FLOAT |  |
| games_played | FLOAT |  |
| interceptions | FLOAT |  |
| max_air_distance | FLOAT |  |
| max_completed_air_distance | FLOAT |  |
| pass_touchdowns | FLOAT |  |
| pass_yards | FLOAT |  |
| passer_rating | FLOAT |  |
| raw_json | NVARCHAR |  |

### `adv_rushing_stats`

Same grain as adv_passing.

| Column | Type | Key |
|---|---|---|
| player_id | INT | **PK** |
| season | INT | **PK** |
| week | INT | **PK** |
| season_type | TINYINT | **PK** |
| postseason | BIT |  |
| avg_time_to_los | FLOAT |  |
| expected_rush_yards | FLOAT |  |
| rush_attempts | INT |  |
| rush_pct_over_expected | FLOAT |  |
| rush_touchdowns | INT |  |
| rush_yards | INT |  |
| rush_yards_over_expected | FLOAT |  |
| rush_yards_over_expected_per_att | FLOAT |  |
| efficiency | FLOAT |  |
| percent_attempts_gte_eight_defenders | FLOAT |  |
| avg_rush_yards | FLOAT |  |
| raw_json | NVARCHAR |  |

### `adv_receiving_stats`

Same grain as adv_passing.

| Column | Type | Key |
|---|---|---|
| player_id | INT | **PK** |
| season | INT | **PK** |
| week | INT | **PK** |
| season_type | TINYINT | **PK** |
| postseason | BIT |  |
| avg_cushion | FLOAT |  |
| avg_expected_yac | FLOAT |  |
| avg_intended_air_yards | FLOAT |  |
| avg_separation | FLOAT |  |
| avg_yac | FLOAT |  |
| avg_yac_above_expectation | FLOAT |  |
| catch_percentage | FLOAT |  |
| percent_share_of_intended_air_yards | FLOAT |  |
| rec_touchdowns | INT |  |
| receptions | INT |  |
| targets | INT |  |
| yards | INT |  |
| raw_json | NVARCHAR |  |


## Append-Only Snapshots

### `injury_snapshots`

Daily append-only capture — builds the injury timeline the API deletes.

| Column | Type | Key |
|---|---|---|
| player_id | INT |  |
| team_id | INT |  |
| status | NVARCHAR |  |
| comment | NVARCHAR |  |
| injury_date | DATETIME2 |  |
| captured_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |

### `roster_snapshots`

Daily depth-chart capture (2025+ upstream).

| Column | Type | Key |
|---|---|---|
| season | INT |  |
| team_id | INT |  |
| player_id | INT |  |
| roster_position | NVARCHAR |  |
| depth | INT |  |
| player_name | NVARCHAR |  |
| injury_status | NVARCHAR |  |
| captured_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |

### `odds_snapshots`

Per-poll capture per vendor/game. Line values stored raw (string) AND parsed (float).

| Column | Type | Key |
|---|---|---|
| api_odds_id | BIGINT |  |
| game_id | INT |  |
| vendor | NVARCHAR |  |
| spread_home_value | NVARCHAR |  |
| spread_home | FLOAT |  |
| spread_home_odds | INT |  |
| spread_away_value | NVARCHAR |  |
| spread_away | FLOAT |  |
| spread_away_odds | INT |  |
| moneyline_home_odds | INT |  |
| moneyline_away_odds | INT |  |
| total_value | NVARCHAR |  |
| total_points | FLOAT |  |
| total_over_odds | INT |  |
| total_under_odds | INT |  |
| api_updated_at | DATETIME2 |  |
| captured_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |

### `odds_opening`

Keyed on API odds id — one opening line per vendor/game.

| Column | Type | Key |
|---|---|---|
| api_odds_id | BIGINT | **PK** |
| game_id | INT |  |
| vendor | NVARCHAR |  |
| spread_home_value | NVARCHAR |  |
| spread_home | FLOAT |  |
| spread_home_odds | INT |  |
| spread_away_value | NVARCHAR |  |
| spread_away | FLOAT |  |
| spread_away_odds | INT |  |
| moneyline_home_odds | INT |  |
| moneyline_away_odds | INT |  |
| total_value | NVARCHAR |  |
| total_points | FLOAT |  |
| total_over_odds | INT |  |
| total_under_odds | INT |  |
| opened_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |

### `prop_snapshots`

Player props are LIVE-only upstream; this table is the archive. 36 prop types, over/under + milestone markets.

| Column | Type | Key |
|---|---|---|
| api_prop_id | BIGINT |  |
| game_id | INT |  |
| player_id | INT |  |
| vendor | NVARCHAR |  |
| prop_type | NVARCHAR |  |
| line_value | NVARCHAR |  |
| line | FLOAT |  |
| market_type | NVARCHAR |  |
| over_odds | INT |  |
| under_odds | INT |  |
| milestone_odds | INT |  |
| api_updated_at | DATETIME2 |  |
| captured_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |

### `prop_opening`

Opening props, append + dedupe (opening IDs not clearly globally unique).

| Column | Type | Key |
|---|---|---|
| api_prop_id | BIGINT |  |
| game_id | INT |  |
| player_id | INT |  |
| vendor | NVARCHAR |  |
| prop_type | NVARCHAR |  |
| line_value | NVARCHAR |  |
| line | FLOAT |  |
| market_type | NVARCHAR |  |
| over_odds | INT |  |
| under_odds | INT |  |
| milestone_odds | INT |  |
| opened_at | DATETIME2 |  |
| captured_at | DATETIME2 |  |
| raw_json | NVARCHAR |  |


## Operations

### `coverage_map`

Probe results: which endpoint/season/type combos actually have data. Backfill loops only over verified coverage.

| Column | Type | Key |
|---|---|---|
| endpoint | NVARCHAR | **PK** |
| season | INT | **PK** |
| season_type | TINYINT | **PK** |
| has_data | BIT |  |
| sample_count | INT |  |
| checked_at | DATETIME2 |  |

### `sync_state`

Watermark checkpoints. Scope format: `backfill:stats:2024:2`, `backfill:plays:<game_id>`.

| Column | Type | Key |
|---|---|---|
| scope | NVARCHAR | **PK** |
| watermark | NVARCHAR |  |
| last_run | DATETIME2 |  |
| note | NVARCHAR |  |


## Semantic Layer (003_semantic.sql)

### `semantic_documents`
Embeddings beside the stats (Azure SQL native VECTOR, 1536-dim). PK (`doc_type`,`doc_key`). Doc types: `play` (filtered corpus), `player_card` (`player_id:season`), `injury`, `game_summary`. Search entry point: `sp_semantic_search`.


## Views (002_views_fantasy.sql)

`v_player_fantasy_game` · `v_player_fantasy_season` · `v_dst_fantasy_game` · `v_dst_fantasy_season` · `v_fantasy_points_allowed` — see docs/06-fantasy-scoring.md.
