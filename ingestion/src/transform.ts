/**
 * transform.ts — flatten API payloads into DB rows.
 * Every transform attaches raw_json = verbatim API object, and derives
 * season/week/season_type context that the payload itself doesn't carry.
 */
import { toSqlDate } from './db';
import { TEAM_SEASON_STAT_FIELDS } from './tables';

type Row = Record<string, unknown>;
const raw = (o: unknown) => JSON.stringify(o);

// -- parsing helpers ---------------------------------------------------------

/** `6' 2"` -> 74 */
export function parseHeightInches(h: string | null | undefined): number | null {
  if (!h) return null;
  const m = h.match(/(\d+)\s*'\s*(\d+)/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

/** `205 lbs` -> 205 */
export function parseWeightLbs(w: string | null | undefined): number | null {
  if (!w) return null;
  const m = w.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** odds line strings like "-6.5" / "6" -> number; "pk"/"" -> null */
function parseLine(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// -- transforms --------------------------------------------------------------

export function teamRow(t: any): Row {
  return {
    id: t.id, conference: t.conference, division: t.division,
    location: t.location, name: t.name, full_name: t.full_name,
    abbreviation: t.abbreviation, raw_json: raw(t),
  };
}

export function playerRow(p: any, isActive: boolean | null = null): Row {
  return {
    id: p.id, first_name: p.first_name, last_name: p.last_name,
    position: p.position, position_abbreviation: p.position_abbreviation,
    height: p.height, weight: p.weight,
    height_inches: parseHeightInches(p.height),
    weight_lbs: parseWeightLbs(p.weight),
    jersey_number: p.jersey_number, college: p.college,
    experience: p.experience, age: p.age,
    team_id: p.team?.id ?? null,
    is_active: isActive === null ? null : isActive ? 1 : 0,
    raw_json: raw(p),
  };
}

export function gameRow(g: any, seasonType: number): Row {
  return {
    id: g.id, season: g.season, week: g.week, season_type: seasonType,
    postseason: g.postseason ? 1 : 0,
    game_date: toSqlDate(g.date), status: g.status, venue: g.venue, summary: g.summary,
    home_team_id: g.home_team?.id ?? null, visitor_team_id: g.visitor_team?.id ?? null,
    home_team_score: g.home_team_score,
    home_team_q1: g.home_team_q1, home_team_q2: g.home_team_q2,
    home_team_q3: g.home_team_q3, home_team_q4: g.home_team_q4, home_team_ot: g.home_team_ot,
    visitor_team_score: g.visitor_team_score,
    visitor_team_q1: g.visitor_team_q1, visitor_team_q2: g.visitor_team_q2,
    visitor_team_q3: g.visitor_team_q3, visitor_team_q4: g.visitor_team_q4, visitor_team_ot: g.visitor_team_ot,
    raw_json: raw(g),
  };
}

const PLAYER_GAME_STAT_FIELDS = [
  'passing_completions','passing_attempts','passing_yards','yards_per_pass_attempt',
  'passing_touchdowns','passing_interceptions','sacks','sacks_loss','qbr','qb_rating',
  'rushing_attempts','rushing_yards','yards_per_rush_attempt','rushing_touchdowns','long_rushing',
  'receptions','receiving_yards','yards_per_reception','receiving_touchdowns','long_reception','receiving_targets',
  'fumbles','fumbles_lost','fumbles_recovered',
  'total_tackles','defensive_sacks','solo_tackles','tackles_for_loss','passes_defended','qb_hits',
  'fumbles_touchdowns','defensive_interceptions','interception_yards','interception_touchdowns',
  'kick_returns','kick_return_yards','yards_per_kick_return','long_kick_return','kick_return_touchdowns',
  'punt_returns','punt_return_yards','yards_per_punt_return','long_punt_return','punt_return_touchdowns',
  'field_goal_attempts','field_goals_made','field_goal_pct','long_field_goal_made','extra_points_made','total_points',
  'punts','punt_yards','gross_avg_punt_yards','touchbacks','punts_inside_20','long_punt',
];

export function playerGameStatRow(s: any, seasonType: number): Row {
  const row: Row = {
    game_id: s.game?.id, player_id: s.player?.id, team_id: s.team?.id ?? null,
    season: s.game?.season ?? null, week: s.game?.week ?? null, season_type: seasonType,
    raw_json: raw(s),
  };
  for (const f of PLAYER_GAME_STAT_FIELDS) row[f] = s[f] ?? null;
  return row;
}

const TEAM_GAME_STAT_FIELDS = [
  'home_away','first_downs','first_downs_passing','first_downs_rushing','first_downs_penalty',
  'third_down_efficiency','third_down_conversions','third_down_attempts',
  'fourth_down_efficiency','fourth_down_conversions','fourth_down_attempts',
  'total_offensive_plays','total_yards','yards_per_play','total_drives',
  'net_passing_yards','passing_completions','passing_attempts','yards_per_pass',
  'sacks','sack_yards_lost','rushing_yards','rushing_attempts','yards_per_rush_attempt',
  'red_zone_scores','red_zone_attempts','penalties','penalty_yards',
  'turnovers','fumbles_lost','interceptions_thrown','defensive_touchdowns',
  'possession_time','possession_time_seconds',
];

export function teamGameStatRow(s: any, seasonType: number): Row {
  const row: Row = {
    game_id: s.game?.id, team_id: s.team?.id,
    season: s.game?.season ?? null, week: s.game?.week ?? null, season_type: seasonType,
    raw_json: raw(s),
  };
  for (const f of TEAM_GAME_STAT_FIELDS) row[f] = s[f] ?? null;
  return row;
}

export function playerSeasonStatRow(s: any, season: number, seasonType: number, extraFields: string[]): Row {
  const row: Row = {
    player_id: s.player?.id, season, season_type: seasonType,
    games_played: s.games_played ?? null,
    postseason: s.postseason ? 1 : 0,
    raw_json: raw(s),
  };
  for (const f of extraFields) row[f] = s[f] ?? null;
  return row;
}

export function teamSeasonStatRow(s: any): Row {
  const row: Row = {
    team_id: s.team?.id, season: s.season, season_type: s.season_type ?? 2,
    raw_json: raw(s),
  };
  for (const f of TEAM_SEASON_STAT_FIELDS) row[f] = s[f] ?? null;
  return row;
}

export function standingsRow(s: any): Row {
  return {
    team_id: s.team?.id, season: s.season,
    win_streak: s.win_streak, points_for: s.points_for, points_against: s.points_against,
    playoff_seed: s.playoff_seed, point_differential: s.point_differential,
    overall_record: s.overall_record, conference_record: s.conference_record,
    division_record: s.division_record,
    wins: s.wins, losses: s.losses, ties: s.ties,
    home_record: s.home_record, road_record: s.road_record,
    raw_json: raw(s),
  };
}

export function advStatRow(s: any, seasonType: number, fields: string[]): Row {
  const row: Row = {
    player_id: s.player?.id, season: s.season, week: s.week ?? 0, season_type: seasonType,
    postseason: s.postseason ? 1 : 0,
    raw_json: raw(s),
  };
  for (const f of fields) row[f] = s[f] ?? null;
  return row;
}

export function playRow(p: any, game: { season: number; week: number | null; season_type: number }): Row {
  return {
    id: String(p.id), game_id: p.game?.id,
    season: game.season, week: game.week, season_type: game.season_type,
    type_slug: p.type_slug, type_abbreviation: p.type_abbreviation, type_text: p.type_text,
    text: p.text, short_text: p.short_text,
    away_score: p.away_score, home_score: p.home_score,
    scoring_play: p.scoring_play ? 1 : 0,
    period: p.period, clock_display: p.clock_display,
    team_id: p.team?.id ?? null,
    start_yard_line: p.start_yard_line, start_down: p.start_down,
    start_distance: p.start_distance, start_yards_to_endzone: p.start_yards_to_endzone,
    end_yard_line: p.end_yard_line, end_down: p.end_down,
    end_distance: p.end_distance, end_yards_to_endzone: p.end_yards_to_endzone,
    end_down_distance_text: p.end_down_distance_text,
    end_short_down_distance_text: p.end_short_down_distance_text,
    end_possession_text: p.end_possession_text,
    stat_yardage: p.stat_yardage, home_win_probability: p.home_win_probability,
    wallclock: toSqlDate(p.wallclock),
    raw_json: raw(p),
  };
}

export function injuryRow(i: any): Row {
  return {
    player_id: i.player?.id, team_id: i.player?.team?.id ?? null,
    status: i.status, comment: i.comment, injury_date: toSqlDate(i.date),
    raw_json: raw(i),
  };
}

export function rosterRow(e: any, teamId: number, season: number): Row {
  return {
    season, team_id: teamId, player_id: e.player?.id ?? null,
    roster_position: e.position, depth: e.depth,
    player_name: e.player_name, injury_status: e.injury_status,
    raw_json: raw(e),
  };
}

function oddsCommon(o: any): Row {
  return {
    api_odds_id: o.id, game_id: o.game_id, vendor: o.vendor,
    spread_home_value: o.spread_home_value, spread_home: parseLine(o.spread_home_value),
    spread_home_odds: o.spread_home_odds,
    spread_away_value: o.spread_away_value, spread_away: parseLine(o.spread_away_value),
    spread_away_odds: o.spread_away_odds,
    moneyline_home_odds: o.moneyline_home_odds, moneyline_away_odds: o.moneyline_away_odds,
    total_value: o.total_value, total_points: parseLine(o.total_value),
    total_over_odds: o.total_over_odds, total_under_odds: o.total_under_odds,
    raw_json: raw(o),
  };
}

export function oddsSnapshotRow(o: any): Row {
  return { ...oddsCommon(o), api_updated_at: toSqlDate(o.updated_at) };
}

export function oddsOpeningRow(o: any): Row {
  return { ...oddsCommon(o), opened_at: toSqlDate(o.opened_at) };
}

function propCommon(p: any): Row {
  const m = p.market ?? {};
  return {
    api_prop_id: p.id, game_id: p.game_id, player_id: p.player_id, vendor: p.vendor,
    prop_type: p.prop_type, line_value: p.line_value, line: parseLine(p.line_value),
    market_type: m.type ?? null,
    over_odds: m.over_odds ?? null, under_odds: m.under_odds ?? null,
    milestone_odds: m.type === 'milestone' ? m.odds ?? null : null,
    raw_json: raw(p),
  };
}

export function propSnapshotRow(p: any): Row {
  return { ...propCommon(p), api_updated_at: toSqlDate(p.updated_at) };
}

export function propOpeningRow(p: any): Row {
  return { ...propCommon(p), opened_at: toSqlDate(p.opened_at) };
}
