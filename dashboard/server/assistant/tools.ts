/**
 * tools.ts — what the assistant can do. Curated tools first (reliable joins,
 * right formats); run_sql is the escape hatch for analysis the curated tools
 * don't cover; render_chart lets an answer include a chart.
 *
 * Every tool: zod-validated args (also converted to JSON Schema for the model),
 * parameterized SQL, compact JSON results capped in rows and bytes.
 */
import { z } from 'zod';
import { getPool, q } from '../db.js';
import { checkSql } from './sqlguard.js';

const int = z.number().int();
const seasonType = int.min(1).max(3).default(2).describe('1=preseason, 2=regular season (default), 3=postseason');
const format = z.enum(['standard', 'half_ppr', 'ppr']).default('ppr').describe('Fantasy scoring format');
const prefix = (f: string) => (f === 'standard' ? 'fp_standard' : f === 'half_ppr' ? 'fp_half_ppr' : 'fp_ppr');

/** Chart spec the client renders. Values are numbers or null (gaps). */
export const chartSpec = z.object({
  type: z.enum(['line', 'bar']).describe('line for trends over weeks/seasons; bar for comparing categories'),
  title: z.string().max(120),
  x: z.array(z.string().max(24)).min(1).max(60).describe('x-axis labels, e.g. ["W1","W2"] or ["2022","2023"]'),
  series: z.array(z.object({ name: z.string().max(40), values: z.array(z.number().nullable()) })).min(1).max(4)
    .describe('1-4 series, each with one value per x label'),
  y_label: z.string().max(40).optional(),
});
export type ChartSpec = z.infer<typeof chartSpec>;

export interface ToolContext { onChart: (c: ChartSpec) => void; embed?: (text: string) => Promise<number[]> }

interface ToolDef<S extends z.ZodTypeAny> {
  description: string;
  schema: S;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
  enabled?: (ctx: ToolContext) => boolean;
}
const tool = <S extends z.ZodTypeAny>(d: ToolDef<S>) => d;

/** Resolve a team given as abbreviation ("KC"), name ("Chiefs") or id. */
async function teamId(team: string | number): Promise<number | null> {
  if (typeof team === 'number') return team;
  const r = await q<{ id: number }>(
    `SELECT TOP 1 id FROM dbo.teams WHERE abbreviation=@t OR name=@t OR full_name=@t OR location=@t`, { t: team.trim() });
  return r[0]?.id ?? null;
}

/** sort option → column expression (real columns, usable in WHERE and ORDER BY); pf = format prefix */
const LEADER_SORT: Record<string, (pf: string) => string> = {
  total: (pf) => `f.${pf}_total`, per_game: (pf) => `f.${pf}_pg`, consistency: (pf) => `f.${pf}_stdev`,
  target_share: () => 'u.target_share', carry_share: () => 'u.carry_share', opportunities: () => 'u.opportunities',
  yards_per_target: () => 'u.yards_per_target', yards_per_carry: () => 'u.yards_per_carry',
  points_per_opportunity: () => 'u.fp_ppr_per_opportunity', yoy_change: (pf) => `y.${pf}_pg_delta`,
};

export const TOOLS = {
  search_players: tool({
    description: 'Find players by (partial) name → player_id. Call before any per-player tool when you only have a name.',
    schema: z.object({ name: z.string().min(2).max(40), position: z.string().max(4).optional() }),
    run: ({ name, position }) => q(`
      SELECT TOP 10 p.id AS player_id, p.first_name, p.last_name, p.position_abbreviation AS pos,
             t.abbreviation AS current_team, p.is_active
      FROM dbo.players p LEFT JOIN dbo.teams t ON t.id = p.team_id
      WHERE CONCAT(p.first_name, ' ', p.last_name) LIKE @n AND (@pos IS NULL OR p.position_abbreviation = @pos)
      ORDER BY CASE WHEN p.is_active = 1 THEN 0 ELSE 1 END, p.last_name`,
      { n: `%${name}%`, pos: position ?? null }),
  }),

  player_profile: tool({
    description: 'One player: bio plus every season (games, fantasy points/game in all formats, key volume stats, target/carry share, YoY change). Use for career questions and to pick a season.',
    schema: z.object({ player_id: int }),
    run: async ({ player_id }) => {
      const [bio, seasons] = await Promise.all([
        q(`SELECT p.id AS player_id, p.first_name, p.last_name, p.position_abbreviation AS pos, p.age, p.college,
                  p.experience, t.abbreviation AS current_team FROM dbo.players p LEFT JOIN dbo.teams t ON t.id=p.team_id WHERE p.id=@id`, { id: player_id }),
        q(`SELECT y.season, y.season_type, y.games, y.fp_standard_pg, y.fp_half_ppr_pg, y.fp_ppr_pg, y.fp_ppr_total,
                  y.fp_ppr_pg_delta AS ppr_pg_change_vs_prev, s.passing_yards, s.passing_touchdowns, s.passing_interceptions,
                  s.rushing_yards, s.rushing_touchdowns, s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns,
                  u.target_share, u.carry_share, r.passer_rating
           FROM dbo.v_player_season_yoy y
           LEFT JOIN dbo.v_player_season_from_games s ON s.player_id=y.player_id AND s.season=y.season AND s.season_type=y.season_type
           LEFT JOIN dbo.v_player_usage_season u ON u.player_id=y.player_id AND u.season=y.season AND u.season_type=y.season_type
           LEFT JOIN dbo.v_qb_passer_rating r ON r.player_id=y.player_id AND r.season=y.season AND r.season_type=y.season_type
           WHERE y.player_id=@id ORDER BY y.season, y.season_type`, { id: player_id }),
      ]);
      return bio.length ? { bio: bio[0], seasons } : { error: 'no such player_id' };
    },
  }),

  player_game_log: tool({
    description: 'Week-by-week games for one player-season: opponent, result, box score, target/carry share, fantasy points and 3-game rolling average. Use for trends, "last N games", boom/bust.',
    schema: z.object({ player_id: int, season: int, season_type: seasonType, format }),
    run: ({ player_id, season, season_type, format }) => q(`
      SELECT week, CONVERT(VARCHAR(10), game_date, 23) AS date, opponent, CASE WHEN is_home=1 THEN 'home' ELSE 'away' END AS venue,
             result, team_points, opponent_points,
             passing_completions, passing_attempts, passing_yards, passing_touchdowns, passing_interceptions,
             rushing_attempts, rushing_yards, rushing_touchdowns, receptions, receiving_targets, receiving_yards, receiving_touchdowns,
             target_share, carry_share, ${prefix(format)} AS fantasy_points, ${prefix(format)}_roll3 AS rolling_3
      FROM dbo.v_player_game_context WHERE player_id=@p AND season=@s AND season_type=@st ORDER BY game_date`,
      { p: player_id, s: season, st: season_type }),
  }),

  leaderboard: tool({
    description: 'Ranked player list for a season: fantasy points (any format), usage (target/carry share, opportunities), efficiency, year-over-year change. Filter by position and minimum games.',
    schema: z.object({
      season: int, season_type: seasonType, format,
      position: z.enum(['QB', 'RB', 'WR', 'TE', 'PK']).optional(),
      sort_by: z.enum(Object.keys(LEADER_SORT) as [string, ...string[]]).default('total'),
      ascending: z.boolean().default(false),
      min_games: int.min(0).max(20).default(4),
      limit: int.min(1).max(50).default(15),
    }),
    run: ({ season, season_type, format, position, sort_by, ascending, min_games, limit }) => {
      const pf = prefix(format);
      return q(`
        SELECT TOP (@limit) f.player_id, f.first_name, f.last_name, f.pos, f.games,
               f.${pf}_total AS fp_total, f.${pf}_pg AS fp_pg, f.${pf}_stdev AS fp_stdev,
               u.target_share, u.carry_share, u.opportunities, u.yards_per_target, u.yards_per_carry,
               u.fp_ppr_per_opportunity, y.${pf}_pg_delta AS delta
        FROM dbo.v_player_fantasy_season f
        LEFT JOIN dbo.v_player_usage_season u ON u.player_id=f.player_id AND u.season=f.season AND u.season_type=f.season_type
        LEFT JOIN dbo.v_player_season_yoy y ON y.player_id=f.player_id AND y.season=f.season AND y.season_type=f.season_type
        WHERE f.season=@s AND f.season_type=@st AND f.games >= @mg
          AND (@pos IS NULL OR f.pos=@pos) AND (@pos IS NOT NULL OR f.pos IN ('QB','RB','WR','TE','PK'))
          AND ${LEADER_SORT[sort_by](pf)} IS NOT NULL
        ORDER BY ${LEADER_SORT[sort_by](pf)} ${ascending ? 'ASC' : 'DESC'}`,
        { s: season, st: season_type, mg: min_games, pos: position ?? null, limit });
    },
  }),

  hot_and_cold: tool({
    description: 'Players whose last-3-game average most exceeds (heating up) or trails (cooling off) their season average.',
    schema: z.object({ season: int, season_type: seasonType, format, position: z.enum(['QB', 'RB', 'WR', 'TE']).optional(), direction: z.enum(['hot', 'cold']).default('hot') }),
    run: ({ season, season_type, format, position, direction }) => {
      const pf = prefix(format);
      return q(`
        SELECT TOP 12 f.player_id, f.first_name, f.last_name, f.pos, t.abbreviation AS team, f.games,
               f.${pf}_roll3 AS last3_avg, f.${pf}_season_avg AS season_avg, f.${pf}_form_delta AS delta
        FROM dbo.v_player_form f LEFT JOIN dbo.teams t ON t.id=f.team_id
        WHERE f.season=@s AND f.season_type=@st AND f.games >= 4 AND f.${pf}_season_avg >= 6
          AND (@pos IS NULL OR f.pos=@pos) AND (@pos IS NOT NULL OR f.pos IN ('QB','RB','WR','TE'))
        ORDER BY delta ${direction === 'hot' ? 'DESC' : 'ASC'}`,
        { s: season, st: season_type, pos: position ?? null });
    },
  }),

  team_summary: tool({
    description: 'One team-season: record, Pythagorean expected wins and luck, one-score record, efficiency both sides, turnover differential, game-by-game results, top fantasy contributors.',
    schema: z.object({ team: z.union([z.string().min(2).max(32), int]).describe('abbreviation (KC), nickname (Chiefs) or team id'), season: int, season_type: seasonType }),
    run: async ({ team, season, season_type }) => {
      const id = await teamId(team);
      if (!id) return { error: `unknown team "${team}"` };
      const p = { id, s: season, st: season_type };
      const [summary, games, players] = await Promise.all([
        q(`SELECT * FROM dbo.v_team_season_summary WHERE team_id=@id AND season=@s AND season_type=@st`, p),
        q(`SELECT e.week, ot.abbreviation AS opponent, CASE WHEN e.is_home=1 THEN 'home' ELSE 'away' END AS venue, e.result,
                  e.points_for, e.points_against, e.total_yards, e.yards_allowed, e.turnovers, e.takeaways
           FROM dbo.v_team_game_efficiency e JOIN dbo.teams ot ON ot.id=e.opponent_team_id
           WHERE e.team_id=@id AND e.season=@s AND e.season_type=@st ORDER BY e.game_date`, p),
        q(`SELECT TOP 8 c.player_id, MAX(c.first_name) AS first_name, MAX(c.last_name) AS last_name, MAX(c.pos) AS pos,
                  COUNT(*) AS games, CAST(SUM(c.fp_ppr) AS DECIMAL(8,1)) AS fp_ppr_total
           FROM dbo.v_player_game_context c WHERE c.team_id=@id AND c.season=@s AND c.season_type=@st
           GROUP BY c.player_id ORDER BY fp_ppr_total DESC`, p),
      ]);
      return { summary: summary[0] ?? null, games, top_fantasy_players: players };
    },
  }),

  league_teams: tool({
    description: 'All teams in a season side by side: record, points for/against, expected wins, luck, yards per play both ways, 3rd-down and red-zone rates, turnover differential, DST points.',
    schema: z.object({ season: int, season_type: seasonType }),
    run: ({ season, season_type }) => q(`
      SELECT s.team, s.conference, s.division, s.wins, s.losses, s.ties, s.points_pg, s.points_allowed_pg, s.point_differential,
             s.pythag_wins, s.luck_wins, s.one_score_wins, s.one_score_losses, s.yards_per_play, s.yards_per_play_allowed,
             s.third_down_pct, s.red_zone_pct, s.turnover_differential, s.points_per_drive, d.fp_dst_pg
      FROM dbo.v_team_season_summary s
      LEFT JOIN dbo.v_dst_fantasy_season d ON d.team_id=s.team_id AND d.season=s.season AND d.season_type=s.season_type
      WHERE s.season=@s AND s.season_type=@st ORDER BY s.wins DESC, s.point_differential DESC`, { s: season, st: season_type }),
  }),

  matchups: tool({
    description: 'Fantasy points allowed per game by each defense to a position, vs the league average. Higher = softer matchup.',
    schema: z.object({ season: int, season_type: seasonType, position: z.enum(['QB', 'RB', 'WR', 'TE', 'PK']), format }),
    run: ({ season, season_type, position, format }) => {
      const col = `${prefix(format)}_allowed_pg`;
      return q(`
        SELECT defense, games, ${col} AS fp_allowed_pg,
               CAST(${col} - AVG(${col}) OVER () AS DECIMAL(6,2)) AS vs_league_avg
        FROM dbo.v_fantasy_points_allowed WHERE season=@s AND season_type=@st AND pos=@pos ORDER BY ${col} DESC`,
        { s: season, st: season_type, pos: position });
    },
  }),

  games: tool({
    description: 'Schedule/results for a season, optionally one week and/or one team, with consensus closing spread/total and ATS result. Returns game_ids.',
    schema: z.object({ season: int, season_type: seasonType, week: int.min(1).max(22).optional(), team: z.union([z.string().max(32), int]).optional() }),
    run: async ({ season, season_type, week, team }) => {
      const tid = team !== undefined ? await teamId(team) : null;
      if (team !== undefined && !tid) return { error: `unknown team "${team}"` };
      return q(`
        SELECT TOP 40 g.id AS game_id, g.week, CONVERT(VARCHAR(10), g.game_date, 23) AS date, g.status,
               vt.abbreviation AS visitor, g.visitor_team_score AS visitor_score, ht.abbreviation AS home, g.home_team_score AS home_score,
               l.close_spread_home, l.close_total, l.ats_winner, l.total_result
        FROM dbo.games g JOIN dbo.teams ht ON ht.id=g.home_team_id JOIN dbo.teams vt ON vt.id=g.visitor_team_id
        LEFT JOIN dbo.v_game_lines_consensus l ON l.game_id=g.id
        WHERE g.season=@s AND g.season_type=@st AND (@wk IS NULL OR g.week=@wk)
          AND (@t IS NULL OR g.home_team_id=@t OR g.visitor_team_id=@t)
        ORDER BY g.game_date`, { s: season, st: season_type, wk: week ?? null, t: tid });
    },
  }),

  game_detail: tool({
    description: 'One game: quarter scores, team stats, top fantasy performers, scoring plays, and lines by book (open/close).',
    schema: z.object({ game_id: int }),
    run: async ({ game_id }) => {
      const p = { id: game_id };
      const [game, teams, players, scoring, lines] = await Promise.all([
        q(`SELECT g.season, g.week, g.season_type, g.status, vt.abbreviation AS visitor, g.visitor_team_score,
                  g.visitor_team_q1, g.visitor_team_q2, g.visitor_team_q3, g.visitor_team_q4, g.visitor_team_ot,
                  ht.abbreviation AS home, g.home_team_score, g.home_team_q1, g.home_team_q2, g.home_team_q3, g.home_team_q4, g.home_team_ot
           FROM dbo.games g JOIN dbo.teams ht ON ht.id=g.home_team_id JOIN dbo.teams vt ON vt.id=g.visitor_team_id WHERE g.id=@id`, p),
        q(`SELECT tm.abbreviation AS team, t.total_yards, t.yards_per_play, t.net_passing_yards, t.rushing_yards, t.third_down_efficiency,
                  t.red_zone_scores, t.red_zone_attempts, t.turnovers, t.sacks, t.penalties, t.possession_time
           FROM dbo.team_game_stats t JOIN dbo.teams tm ON tm.id=t.team_id WHERE t.game_id=@id`, p),
        q(`SELECT TOP 10 c.first_name, c.last_name, c.pos, tm.abbreviation AS team, c.passing_yards, c.passing_touchdowns,
                  c.rushing_yards, c.rushing_touchdowns, c.receptions, c.receiving_yards, c.receiving_touchdowns, c.fp_ppr
           FROM dbo.v_player_game_context c JOIN dbo.teams tm ON tm.id=c.team_id WHERE c.game_id=@id ORDER BY c.fp_ppr DESC`, p),
        q(`SELECT period, clock_display, type_text, text, away_score, home_score FROM dbo.plays
           WHERE game_id=@id AND scoring_play=1 ORDER BY wallclock, id`, p),
        q(`SELECT vendor, open_spread_home, close_spread_home, open_total, close_total, ats_winner, total_result
           FROM dbo.v_game_lines WHERE game_id=@id`, p),
      ]);
      return game.length ? { game: game[0], team_stats: teams, top_performers: players, scoring_plays: scoring, lines } : { error: 'no such game_id' };
    },
  }),

  betting_summary: tool({
    description: 'Season betting results from archived lines (coverage 2025 week 8+): favorite cover rate, overs, ATS record by team, props over-rate by prop type.',
    schema: z.object({ season: int, season_type: seasonType }),
    run: async ({ season, season_type }) => {
      const p = { s: season, st: season_type };
      const [overall, props] = await Promise.all([
        q(`SELECT COUNT(*) AS games,
                  SUM(CASE WHEN (close_spread_home < 0 AND ats_winner='home') OR (close_spread_home > 0 AND ats_winner='away') THEN 1 ELSE 0 END) AS favorite_covers,
                  SUM(CASE WHEN total_result='over' THEN 1 ELSE 0 END) AS overs, SUM(CASE WHEN total_result='under' THEN 1 ELSE 0 END) AS unders,
                  CAST(AVG(ABS(1.0*home_margin + close_spread_home)) AS DECIMAL(5,2)) AS avg_points_vs_spread
           FROM dbo.v_game_lines_consensus WHERE season=@s AND season_type=@st AND ats_winner IS NOT NULL`, p),
        q(`SELECT prop_type, COUNT(*) AS settled,
                  CAST(1.0*SUM(CASE WHEN outcome IN ('over','hit') THEN 1 ELSE 0 END)
                       / NULLIF(SUM(CASE WHEN outcome IN ('over','hit','under','miss') THEN 1 ELSE 0 END),0) AS DECIMAL(4,3)) AS over_or_hit_rate
           FROM dbo.v_prop_results WHERE season=@s AND season_type=@st AND outcome NOT IN ('pending','unmapped','no_action')
           GROUP BY prop_type ORDER BY settled DESC`, p),
      ]);
      return { overall: overall[0] ?? null, props };
    },
  }),

  semantic_search: tool({
    description: 'Similarity search over play descriptions, player-season profile cards, injury notes and game recaps ("comeback wins", "backs like X", "plays like..."). NOT for numbers — follow up with numeric tools using the returned ids.',
    schema: z.object({
      question: z.string().min(3).max(300),
      doc_type: z.enum(['play', 'player_card', 'injury', 'game_summary']).optional(),
      season_from: int.optional(), season_to: int.optional(),
      top_n: int.min(1).max(15).default(8),
    }),
    enabled: (ctx) => !!ctx.embed,
    run: async ({ question, doc_type, season_from, season_to, top_n }, ctx) => {
      const v = await ctx.embed!(question);
      return q(`EXEC dbo.sp_semantic_search @query_vector=@qv, @doc_type=@dt, @season_from=@sf, @season_to=@stt, @player_id=NULL, @top_n=@n`,
        { qv: JSON.stringify(v), dt: doc_type ?? null, sf: season_from ?? null, stt: season_to ?? null, n: top_n });
    },
  }),

  describe_schema: tool({
    description: 'Columns of the queryable views/tables (for run_sql). Pass names to get columns; omit to list all objects with one-line descriptions.',
    schema: z.object({ objects: z.array(z.string().max(64)).max(8).optional() }),
    run: async ({ objects }) => {
      if (!objects?.length) return { objects: SCHEMA_GUIDE };
      const names = objects.map((o) => o.replace(/^dbo\./, '').toLowerCase());
      const rows = await q<{ t: string; c: string; ty: string }>(`
        SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS ty FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA='dbo' AND LOWER(TABLE_NAME) IN (SELECT LOWER(value) FROM STRING_SPLIT(@n, ','))
          AND COLUMN_NAME NOT IN ('raw_json','first_seen_at')
        ORDER BY TABLE_NAME, ORDINAL_POSITION`, { n: names.join(',') });
      const out: Record<string, string[]> = {};
      for (const r of rows) (out[r.t] ??= []).push(`${r.c} ${r.ty}`);
      return out;
    },
  }),

  run_sql: tool({
    description: 'Run ONE read-only T-SQL SELECT (or WITH … SELECT) against dbo views/tables for analysis the other tools cannot do. Max 500 rows, 20s. Prefer the v_* views (they already fix known data defects). Call describe_schema first if unsure of columns. Use TOP / GROUP BY to keep results small.',
    schema: z.object({ query: z.string().min(10).max(8000), purpose: z.string().max(200).describe('One line: what this query answers (shown to the user)') }),
    run: async ({ query }) => {
      const g = checkSql(query);
      if (!g.ok) return { error: g.error };
      const req = (await getPool()).request();
      const timer = setTimeout(() => req.cancel(), 20_000);
      try {
        const r = await req.query(`SET ROWCOUNT 500;\n${g.sql}`);
        return r.recordset ?? [];
      } catch (e) {
        return { error: `SQL error: ${(e as Error).message}` };
      } finally {
        clearTimeout(timer);
      }
    },
  }),

  render_chart: tool({
    description: 'Show a chart under your answer. Use when a trend or comparison is clearer visually (weekly points, season arcs, team comparisons). Only chart numbers you got from other tools. Never more than 4 series; line = trends, bar = categories.',
    schema: chartSpec,
    run: async (spec, ctx) => {
      for (const s of spec.series) {
        if (s.values.length !== spec.x.length) return { error: `series "${s.name}" has ${s.values.length} values for ${spec.x.length} x labels` };
      }
      ctx.onChart(spec);
      return { rendered: true };
    },
  }),
} as const;

export type ToolName = keyof typeof TOOLS;

/** One line per queryable object — the map the model reads before writing SQL. */
const SCHEMA_GUIDE: Record<string, string> = {
  v_player_fantasy_game: 'player/game fantasy points (3 formats) + components',
  v_player_fantasy_season: 'player/season fantasy totals, per-game, stdev, floor/ceiling',
  v_player_game_context: 'player/game: opponent, result, box score, target/carry share, rolling averages',
  v_player_usage_season: 'player/season: targets, carries, shares, catch rate, efficiency',
  v_player_form: 'player/season: last-3 vs season average',
  v_player_season_yoy: 'player/season vs previous season',
  v_player_season_from_games: 'player/season raw totals summed from game logs (trust over player_season_stats)',
  v_qb_passer_rating: 'QB season passer rating',
  v_game_results: 'team/game result, margin, opponent',
  v_team_game_efficiency: 'team/game offense + defense efficiency',
  v_team_season_summary: 'team/season record, Pythagorean, luck, efficiency',
  v_dst_fantasy_game: 'team defense fantasy per game', v_dst_fantasy_season: 'team defense fantasy per season',
  v_fantasy_points_allowed: 'defense/position/season points allowed (3 formats)',
  v_game_lines: 'game/book open+close spread/total, ATS/total result',
  v_game_lines_consensus: 'game consensus lines + results',
  v_prop_results: 'player prop closing line vs actual',
  games: 'schedule/results incl. quarter scores', teams: 'team ids/abbreviations', players: 'player bio (team_id = CURRENT team)',
  player_game_stats: 'raw box scores', team_game_stats: 'raw team box scores', standings: 'official standings 2004+',
  adv_passing_stats: 'Next Gen passing (2018+, week 0 = season)', adv_rushing_stats: 'Next Gen rushing', adv_receiving_stats: 'Next Gen receiving',
  plays: 'play-by-play (no player_id; text has names; filter by game_id!)', injury_snapshots: 'daily injury report history',
  odds_snapshots: 'line history', prop_snapshots: 'prop line history',
};

/** OpenAI function definitions for the enabled tools. */
export function toolDefinitions(ctx: ToolContext) {
  return Object.entries(TOOLS)
    .filter(([, t]) => !('enabled' in t) || !t.enabled || t.enabled(ctx))
    .map(([name, t]) => {
      const params = z.toJSONSchema(t.schema as z.ZodTypeAny, { io: 'input' }) as Record<string, unknown>;
      delete params.$schema;
      return { type: 'function' as const, name, description: t.description, parameters: params };
    });
}

const MAX_ROWS_TO_MODEL = 200;
const MAX_CHARS_TO_MODEL = 40_000;

/** Execute a tool call from the model. Never throws: errors become {error} so the model can recover. */
export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ result: unknown; forModel: string; rows?: number }> {
  const t = (TOOLS as Record<string, ToolDef<z.ZodTypeAny>>)[name];
  if (!t) return wrap({ error: `unknown tool ${name}` });
  let args: unknown;
  try { args = JSON.parse(rawArgs || '{}'); } catch { return wrap({ error: 'arguments were not valid JSON' }); }
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) return wrap({ error: `invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` });
  try {
    return wrap(await t.run(parsed.data, ctx));
  } catch (e) {
    return wrap({ error: (e as Error).message });
  }
}

function wrap(result: unknown): { result: unknown; forModel: string; rows?: number } {
  const rows = Array.isArray(result) ? result.length : undefined;
  const trimmed = Array.isArray(result) && result.length > MAX_ROWS_TO_MODEL
    ? { rows: result.slice(0, MAX_ROWS_TO_MODEL), note: `truncated: showing ${MAX_ROWS_TO_MODEL} of ${result.length} rows` }
    : result;
  let forModel = JSON.stringify(trimmed, (_k, v) => (v instanceof Date ? v.toISOString().slice(0, 16) : v));
  if (forModel.length > MAX_CHARS_TO_MODEL) forModel = forModel.slice(0, MAX_CHARS_TO_MODEL) + '…[truncated — narrow the query]';
  return { result, forModel, rows };
}
