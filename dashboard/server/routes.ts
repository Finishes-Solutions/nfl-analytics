/**
 * routes.ts — JSON API for the dashboard. Every endpoint is GET, validated by
 * zod, parameterized, and reads only views/tables (the login is read-only).
 * Column and sort names come from allowlists below, never from the request.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { q, cached } from './db.js';

export const router = Router();

/* ---------------------------------------------------------------- params */
const int = z.coerce.number().int();
const seasonType = int.min(1).max(3).default(2);
const format = z.enum(['standard', 'half_ppr', 'ppr']).default('ppr');
type Format = z.infer<typeof format>;

const FP: Record<Format, { prefix: string; total: string; pg: string; stdev: string; allowedPg: string }> = {
  standard: { prefix: 'fp_standard', total: 'fp_standard_total', pg: 'fp_standard_pg', stdev: 'fp_standard_stdev', allowedPg: 'fp_standard_allowed_pg' },
  half_ppr: { prefix: 'fp_half_ppr', total: 'fp_half_ppr_total', pg: 'fp_half_ppr_pg', stdev: 'fp_half_ppr_stdev', allowedPg: 'fp_half_ppr_allowed_pg' },
  ppr:      { prefix: 'fp_ppr',      total: 'fp_ppr_total',      pg: 'fp_ppr_pg',      stdev: 'fp_ppr_stdev',      allowedPg: 'fp_ppr_allowed_pg' },
};

const FANTASY_POS = ['QB', 'RB', 'WR', 'TE', 'PK'] as const;

/** Wrap a handler: validate query with `schema`, cache by URL, map errors to JSON. */
function get<S extends z.ZodTypeAny>(
  path: string, schema: S, ttlMs: number,
  fn: (p: z.infer<S>, req: Request) => Promise<unknown>,
): void {
  router.get(path, async (req: Request, res: Response) => {
    const parsed = schema.safeParse({ ...req.query, ...req.params });
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid parameters', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
      return;
    }
    try {
      const data = await cached(req.originalUrl, ttlMs, () => fn(parsed.data, req));
      if (data === null) { res.status(404).json({ error: 'not found' }); return; }
      res.json(data);
    } catch (e) {
      console.error(`${req.originalUrl} failed:`, e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}

const MIN = 60_000;

/* ---------------------------------------------------------------- meta */
get('/meta', z.object({}), 5 * MIN, async () => {
  const [seasons, teams, latest] = await Promise.all([
    q<{ season: number; season_type: number; games: number; final_games: number; max_week: number | null }>(`
      SELECT season, season_type, COUNT(*) AS games,
             SUM(CASE WHEN status LIKE '%Final%' THEN 1 ELSE 0 END) AS final_games,
             MAX(CASE WHEN status LIKE '%Final%' THEN week END) AS max_week
      FROM dbo.games GROUP BY season, season_type ORDER BY season DESC, season_type`),
    q(`SELECT id, abbreviation, full_name, conference, division FROM dbo.teams ORDER BY abbreviation`),
    q<{ season: number; season_type: number; week: number }>(`
      SELECT TOP 1 season, season_type, week FROM dbo.games
      WHERE status LIKE '%Final%' AND season_type IN (2,3) ORDER BY game_date DESC`),
  ]);
  return { seasons, teams, latest: latest[0] ?? null };
});

/* ---------------------------------------------------------------- overview */
get('/overview', z.object({ season: int, season_type: seasonType, format }), 2 * MIN, async ({ season, season_type, format }) => {
  const c = FP[format];
  const p = { season, st: season_type };
  // biggest movers: last-3 average vs season average, regulars only
  const form = (dir: 'ASC' | 'DESC') => q(`
    SELECT TOP 8 f.player_id, f.first_name, f.last_name, f.pos, t.abbreviation AS team, f.games,
           f.${c.prefix}_roll3 AS roll3, f.${c.prefix}_season_avg AS season_avg, f.${c.prefix}_form_delta AS delta
    FROM dbo.v_player_form f LEFT JOIN dbo.teams t ON t.id = f.team_id
    WHERE f.season=@season AND f.season_type=@st AND f.games >= 4 AND f.pos IN ('QB','RB','WR','TE')
      AND f.${c.prefix}_season_avg >= 8
    ORDER BY delta ${dir}`, p);
  const [leaders, hot, cold, teams, recent, health] = await Promise.all([
    q(`SELECT * FROM (
         SELECT player_id, first_name, last_name, pos, games, ${c.total} AS fp_total, ${c.pg} AS fp_pg,
                ROW_NUMBER() OVER (PARTITION BY pos ORDER BY ${c.total} DESC) AS rk
         FROM dbo.v_player_fantasy_season
         WHERE season=@season AND season_type=@st AND pos IN ('QB','RB','WR','TE')) x
       WHERE rk <= 5 ORDER BY pos, rk`, p),
    form('DESC'),
    form('ASC'),
    q(`SELECT team_id, team, wins, losses, ties, point_differential, pythag_wins, luck_wins,
              yards_per_play, yards_per_play_allowed, turnover_differential
       FROM dbo.v_team_season_summary WHERE season=@season AND season_type=@st`, p),
    q(`SELECT TOP 16 g.id AS game_id, g.week, g.season_type, g.game_date, g.status,
              ht.abbreviation AS home, g.home_team_score AS home_score,
              vt.abbreviation AS visitor, g.visitor_team_score AS visitor_score
       FROM dbo.games g JOIN dbo.teams ht ON ht.id=g.home_team_id JOIN dbo.teams vt ON vt.id=g.visitor_team_id
       WHERE g.season=@season AND g.season_type=@st AND g.status LIKE '%Final%'
       ORDER BY g.game_date DESC`, p),
    q(`SELECT table_name, row_count, last_write, hours_since_write FROM dbo.v_dh_table_freshness
       WHERE table_name IN ('games','player_game_stats','injury_snapshots','odds_snapshots','sync_state')`),
  ]);
  return { leaders, hot, cold, teams, recent, health };
});

/* ---------------------------------------------------------------- players */
const PLAYER_SORT: Record<string, string> = {
  fp_total: 'fp_total', fp_pg: 'fp_pg', fp_stdev: 'fp_stdev', games: 'games',
  floor: 'floor', ceiling: 'ceiling', target_share: 'target_share', carry_share: 'carry_share',
  opportunities: 'opportunities', targets_pg: 'targets_pg', yards_per_target: 'yards_per_target',
  yards_per_carry: 'yards_per_carry', fp_per_opp: 'fp_per_opp', delta: 'delta', last_name: 'last_name',
};

get('/players/leaders', z.object({
  season: int, season_type: seasonType, format,
  pos: z.enum(['ALL', ...FANTASY_POS]).default('ALL'),
  sort: z.enum(Object.keys(PLAYER_SORT) as [string, ...string[]]).default('fp_total'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  min_games: int.min(0).max(20).default(1),
  q: z.string().max(40).optional(),
  limit: int.min(1).max(500).default(150),
}), 2 * MIN, async ({ season, season_type, format, pos, sort, dir, min_games, q: search, limit }) => {
  const c = FP[format];
  const rows = await q(`
    SELECT TOP (@limit)
           f.player_id, f.first_name, f.last_name, f.pos, tm.abbreviation AS team, f.games,
           f.${c.total} AS fp_total, f.${c.pg} AS fp_pg, f.${c.stdev} AS fp_stdev,
           f.fp_ppr_floor AS floor, f.fp_ppr_ceiling AS ceiling,
           u.targets, u.carries, u.opportunities, u.targets_pg, u.target_share, u.carry_share,
           u.yards_per_target, u.yards_per_carry, u.fp_ppr_per_opportunity AS fp_per_opp,
           y.${c.prefix}_pg_delta AS delta
    FROM dbo.v_player_fantasy_season f
    LEFT JOIN dbo.v_player_usage_season u
      ON u.player_id=f.player_id AND u.season=f.season AND u.season_type=f.season_type
    LEFT JOIN dbo.v_player_season_yoy y
      ON y.player_id=f.player_id AND y.season=f.season AND y.season_type=f.season_type
    OUTER APPLY (SELECT TOP 1 s.team_id FROM dbo.player_game_stats s
                 WHERE s.player_id=f.player_id AND s.season=f.season AND s.season_type=f.season_type
                 ORDER BY s.week DESC) lt
    LEFT JOIN dbo.teams tm ON tm.id = lt.team_id
    WHERE f.season=@season AND f.season_type=@st AND f.games >= @min_games
      AND (@pos = 'ALL' OR f.pos = @pos)
      AND (@pos <> 'ALL' OR f.pos IN ('QB','RB','WR','TE','PK'))
      AND (@q IS NULL OR CONCAT(f.first_name, ' ', f.last_name) LIKE @q)
    ORDER BY ${PLAYER_SORT[sort]} ${dir === 'asc' ? 'ASC' : 'DESC'}, f.player_id`,
    { season, st: season_type, pos, min_games, limit, q: search ? `%${search}%` : null });
  return { format, rows };
});

get('/players/search', z.object({ q: z.string().min(2).max(40) }), MIN, async ({ q: search }) => q(`
  SELECT TOP 15 p.id AS player_id, p.first_name, p.last_name, p.position_abbreviation AS pos,
         t.abbreviation AS team, p.is_active
  FROM dbo.players p LEFT JOIN dbo.teams t ON t.id = p.team_id
  WHERE CONCAT(p.first_name, ' ', p.last_name) LIKE @q
  ORDER BY CASE WHEN p.is_active = 1 THEN 0 ELSE 1 END, p.last_name`, { q: `%${search}%` }));

get('/players/:id', z.object({ id: int }), 2 * MIN, async ({ id }) => {
  const [bio, seasons] = await Promise.all([
    q(`SELECT p.id AS player_id, p.first_name, p.last_name, p.position, p.position_abbreviation AS pos,
              p.height, p.weight, p.college, p.experience, p.age, p.jersey_number, p.is_active,
              t.abbreviation AS team, t.full_name AS team_name
       FROM dbo.players p LEFT JOIN dbo.teams t ON t.id = p.team_id WHERE p.id=@id`, { id }),
    q(`SELECT y.season, y.season_type, y.games, f.fp_standard_total, f.fp_half_ppr_total, f.fp_ppr_total,
              f.fp_standard_pg, f.fp_half_ppr_pg, f.fp_ppr_pg, f.fp_ppr_stdev,
              s.passing_yards, s.passing_touchdowns, s.passing_interceptions, s.rushing_yards, s.rushing_touchdowns,
              s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns,
              u.target_share, u.carry_share, r.passer_rating
       FROM dbo.v_player_season_yoy y
       JOIN dbo.v_player_fantasy_season f ON f.player_id=y.player_id AND f.season=y.season AND f.season_type=y.season_type
       LEFT JOIN dbo.v_player_season_from_games s ON s.player_id=y.player_id AND s.season=y.season AND s.season_type=y.season_type
       LEFT JOIN dbo.v_player_usage_season u ON u.player_id=y.player_id AND u.season=y.season AND u.season_type=y.season_type
       LEFT JOIN dbo.v_qb_passer_rating r ON r.player_id=y.player_id AND r.season=y.season AND r.season_type=y.season_type
       WHERE y.player_id=@id ORDER BY y.season DESC, y.season_type`, { id }),
  ]);
  if (!bio.length) return null;
  return { bio: bio[0], seasons };
});

get('/players/:id/season', z.object({ id: int, season: int, season_type: seasonType }), 2 * MIN,
  async ({ id, season, season_type }) => {
    const p = { id, season, st: season_type };
    const [games, adv, injuries, props] = await Promise.all([
      q(`SELECT game_id, week, game_date, opponent, is_home, result, team_points, opponent_points,
                passing_completions, passing_attempts, passing_yards, passing_touchdowns, passing_interceptions,
                rushing_attempts, rushing_yards, rushing_touchdowns,
                receptions, receiving_targets, receiving_yards, receiving_touchdowns, fumbles_lost,
                target_share, carry_share, fp_standard, fp_half_ppr, fp_ppr,
                fp_standard_roll3, fp_half_ppr_roll3, fp_ppr_roll3,
                fp_standard_season_to_date, fp_half_ppr_season_to_date, fp_ppr_season_to_date
         FROM dbo.v_player_game_context
         WHERE player_id=@id AND season=@season AND season_type=@st ORDER BY game_date`, p),
      Promise.all([
        q(`SELECT 'passing' AS category, * FROM dbo.adv_passing_stats WHERE player_id=@id AND season=@season AND season_type=@st AND week=0`, p),
        q(`SELECT 'rushing' AS category, * FROM dbo.adv_rushing_stats WHERE player_id=@id AND season=@season AND season_type=@st AND week=0`, p),
        q(`SELECT 'receiving' AS category, * FROM dbo.adv_receiving_stats WHERE player_id=@id AND season=@season AND season_type=@st AND week=0`, p),
      ]).then((r) => r.flat().map(({ raw_json, first_seen_at, updated_at, ...rest }: Record<string, unknown>) => rest)),
      q(`SELECT TOP 10 status, comment, injury_date, captured_at FROM dbo.injury_snapshots
         WHERE player_id=@id ORDER BY captured_at DESC`, p),
      q(`SELECT game_id, week, prop_type, market_type, vendor, line, actual, outcome
         FROM dbo.v_prop_results WHERE player_id=@id AND season=@season AND season_type=@st
         ORDER BY game_date DESC, prop_type, vendor`, p),
    ]);
    return { games, advanced: adv, injuries, props };
  });

/* ---------------------------------------------------------------- teams */
get('/teams', z.object({ season: int, season_type: seasonType }), 2 * MIN, async ({ season, season_type }) => q(`
  SELECT s.*, st.playoff_seed, st.division_record, st.conference_record, st.home_record, st.road_record, st.win_streak,
         d.fp_dst_pg
  FROM dbo.v_team_season_summary s
  LEFT JOIN dbo.standings st ON st.team_id=s.team_id AND st.season=s.season
  LEFT JOIN dbo.v_dst_fantasy_season d ON d.team_id=s.team_id AND d.season=s.season AND d.season_type=s.season_type
  WHERE s.season=@season AND s.season_type=@st
  ORDER BY s.conference, s.division, s.wins DESC, s.point_differential DESC`, { season, st: season_type }));

get('/teams/:id', z.object({ id: int, season: int, season_type: seasonType, format }), 2 * MIN,
  async ({ id, season, season_type, format }) => {
    const p = { id, season, st: season_type };
    const c = FP[format];
    const [team, summary, games, players, allowed] = await Promise.all([
      q(`SELECT id, abbreviation, full_name, conference, division FROM dbo.teams WHERE id=@id`, p),
      q(`SELECT * FROM dbo.v_team_season_summary WHERE team_id=@id AND season=@season AND season_type=@st`, p),
      q(`SELECT e.game_id, e.week, e.game_date, e.is_home, e.result, e.points_for, e.points_against, e.margin,
                ot.abbreviation AS opponent, e.yards_per_play, e.yards_per_play_allowed, e.turnovers, e.takeaways,
                e.total_yards, e.yards_allowed
         FROM dbo.v_team_game_efficiency e JOIN dbo.teams ot ON ot.id = e.opponent_team_id
         WHERE e.team_id=@id AND e.season=@season AND e.season_type=@st ORDER BY e.game_date`, p),
      q(`SELECT TOP 15 c.player_id, MAX(c.first_name) AS first_name, MAX(c.last_name) AS last_name, MAX(c.pos) AS pos,
                COUNT(*) AS games, CAST(SUM(c.${c.prefix}) AS DECIMAL(9,2)) AS fp_total,
                CAST(AVG(c.${c.prefix}) AS DECIMAL(8,2)) AS fp_pg,
                CAST(1.0*SUM(ISNULL(c.receiving_targets,0))/NULLIF(SUM(c.team_targets),0) AS DECIMAL(5,3)) AS target_share,
                CAST(1.0*SUM(ISNULL(c.rushing_attempts,0))/NULLIF(SUM(c.team_carries),0) AS DECIMAL(5,3)) AS carry_share
         FROM dbo.v_player_game_context c
         WHERE c.team_id=@id AND c.season=@season AND c.season_type=@st
         GROUP BY c.player_id ORDER BY fp_total DESC`, p),
      q(`SELECT pos, games, ${c.allowedPg} AS fp_allowed_pg FROM dbo.v_fantasy_points_allowed
         WHERE defense_team_id=@id AND season=@season AND season_type=@st AND pos IN ('QB','RB','WR','TE')`, p),
    ]);
    if (!team.length) return null;
    return { team: team[0], summary: summary[0] ?? null, games, players, allowed };
  });

/* ---------------------------------------------------------------- matchups */
get('/matchups', z.object({ season: int, season_type: seasonType, format }), 5 * MIN, async ({ season, season_type, format }) => {
  const c = FP[format];
  const rows = await q(`
    SELECT defense_team_id, defense, pos, games, ${c.allowedPg} AS fp_allowed_pg
    FROM dbo.v_fantasy_points_allowed
    WHERE season=@season AND season_type=@st AND pos IN ('QB','RB','WR','TE','PK')`, { season, st: season_type });
  const league = await q(`
    SELECT pos, CAST(AVG(${c.allowedPg}) AS DECIMAL(8,2)) AS league_avg
    FROM dbo.v_fantasy_points_allowed
    WHERE season=@season AND season_type=@st AND pos IN ('QB','RB','WR','TE','PK') GROUP BY pos`, { season, st: season_type });
  return { format, rows, league };
});

/* ---------------------------------------------------------------- games */
get('/games', z.object({ season: int, season_type: seasonType, week: int.min(1).max(22).optional() }), MIN,
  async ({ season, season_type, week }) => {
    const weeks = await q<{ week: number }>(`SELECT DISTINCT week FROM dbo.games WHERE season=@season AND season_type=@st AND week IS NOT NULL ORDER BY week`,
      { season, st: season_type });
    const wk = week ?? (await q<{ week: number }>(`
      SELECT TOP 1 week FROM dbo.games WHERE season=@season AND season_type=@st
      ORDER BY CASE WHEN status LIKE '%Final%' THEN 0 ELSE 1 END, game_date DESC`, { season, st: season_type }))[0]?.week ?? 1;
    const games = await q(`
      SELECT g.id AS game_id, g.week, g.game_date, g.status, g.venue,
             g.home_team_id, ht.abbreviation AS home, g.home_team_score AS home_score,
             g.visitor_team_id, vt.abbreviation AS visitor, g.visitor_team_score AS visitor_score,
             l.close_spread_home, l.close_total, l.ats_winner, l.total_result
      FROM dbo.games g
      JOIN dbo.teams ht ON ht.id=g.home_team_id JOIN dbo.teams vt ON vt.id=g.visitor_team_id
      LEFT JOIN dbo.v_game_lines_consensus l ON l.game_id = g.id
      WHERE g.season=@season AND g.season_type=@st AND g.week=@wk ORDER BY g.game_date, g.id`,
      { season, st: season_type, wk });
    return { week: wk, weeks: weeks.map((w) => w.week), games };
  });

get('/games/:id', z.object({ id: int }), MIN, async ({ id }) => {
  const p = { id };
  const [game, teamStats, players, plays, lines, movement] = await Promise.all([
    q(`SELECT g.id AS game_id, g.season, g.week, g.season_type, g.game_date, g.status, g.venue,
              g.home_team_id, ht.abbreviation AS home, ht.full_name AS home_name,
              g.visitor_team_id, vt.abbreviation AS visitor, vt.full_name AS visitor_name,
              g.home_team_score, g.home_team_q1, g.home_team_q2, g.home_team_q3, g.home_team_q4, g.home_team_ot,
              g.visitor_team_score, g.visitor_team_q1, g.visitor_team_q2, g.visitor_team_q3, g.visitor_team_q4, g.visitor_team_ot
       FROM dbo.games g JOIN dbo.teams ht ON ht.id=g.home_team_id JOIN dbo.teams vt ON vt.id=g.visitor_team_id
       WHERE g.id=@id`, p),
    q(`SELECT t.team_id, tm.abbreviation AS team, t.first_downs, t.total_yards, t.yards_per_play, t.total_offensive_plays,
              t.net_passing_yards, t.rushing_yards, t.rushing_attempts, t.third_down_efficiency, t.fourth_down_efficiency,
              t.red_zone_scores, t.red_zone_attempts, t.turnovers, t.sacks, t.penalties, t.penalty_yards, t.possession_time
       FROM dbo.team_game_stats t JOIN dbo.teams tm ON tm.id=t.team_id WHERE t.game_id=@id`, p),
    q(`SELECT c.player_id, c.first_name, c.last_name, c.pos, c.team_id,
              c.passing_completions, c.passing_attempts, c.passing_yards, c.passing_touchdowns, c.passing_interceptions,
              c.rushing_attempts, c.rushing_yards, c.rushing_touchdowns,
              c.receptions, c.receiving_targets, c.receiving_yards, c.receiving_touchdowns,
              c.fp_standard, c.fp_half_ppr, c.fp_ppr
       FROM dbo.v_player_game_context c WHERE c.game_id=@id AND c.pos IN ('QB','RB','WR','TE','PK')
       ORDER BY c.fp_ppr DESC`, p),
    q(`SELECT CAST(ROW_NUMBER() OVER (ORDER BY wallclock, id) AS INT) AS play_no, period, clock_display, team_id,
              type_text, CASE WHEN text='null' THEN NULL ELSE text END AS text, scoring_play,
              away_score, home_score, start_down, start_distance, start_yards_to_endzone, stat_yardage,
              home_win_probability
       FROM dbo.plays WHERE game_id=@id ORDER BY play_no`, p),
    q(`SELECT vendor, open_spread_home, close_spread_home, spread_move, open_total, close_total, total_move,
              close_ml_home, close_ml_away, snapshots, ats_winner, total_result
       FROM dbo.v_game_lines WHERE game_id=@id ORDER BY vendor`, p),
    q(`SELECT captured_at, vendor, spread_home, total_points FROM dbo.odds_snapshots
       WHERE game_id=@id ORDER BY captured_at`, p),
  ]);
  if (!game.length) return null;
  return { game: game[0], teamStats, players, plays, lines, movement };
});

/* ---------------------------------------------------------------- betting */
get('/betting', z.object({ season: int, season_type: seasonType }), 5 * MIN, async ({ season, season_type }) => {
  const p = { season, st: season_type };
  const [summary, ats, moves, props] = await Promise.all([
    q(`SELECT COUNT(*) AS games,
              SUM(CASE WHEN ats_winner='home' THEN 1 ELSE 0 END) AS home_covers,
              SUM(CASE WHEN ats_winner='away' THEN 1 ELSE 0 END) AS away_covers,
              SUM(CASE WHEN ats_winner='push' THEN 1 ELSE 0 END) AS ats_pushes,
              SUM(CASE WHEN total_result='over' THEN 1 ELSE 0 END) AS overs,
              SUM(CASE WHEN total_result='under' THEN 1 ELSE 0 END) AS unders,
              SUM(CASE WHEN (close_spread_home < 0 AND ats_winner='home') OR (close_spread_home > 0 AND ats_winner='away') THEN 1 ELSE 0 END) AS favorite_covers,
              SUM(CASE WHEN close_spread_home <> 0 AND ats_winner IN ('home','away') THEN 1 ELSE 0 END) AS favorite_decided,
              CAST(AVG(ABS(1.0*home_margin + close_spread_home)) AS DECIMAL(5,2)) AS avg_spread_miss,
              CAST(AVG(ABS(1.0*total_scored - close_total)) AS DECIMAL(5,2)) AS avg_total_miss
       FROM dbo.v_game_lines_consensus WHERE season=@season AND season_type=@st AND ats_winner IS NOT NULL`, p),
    q(`SELECT x.team_id, t.abbreviation AS team,
              SUM(CASE WHEN x.covered=1 THEN 1 ELSE 0 END) AS covers,
              SUM(CASE WHEN x.covered=0 THEN 1 ELSE 0 END) AS non_covers,
              SUM(CASE WHEN x.covered IS NULL THEN 1 ELSE 0 END) AS pushes,
              SUM(CASE WHEN x.ou='over' THEN 1 ELSE 0 END) AS overs,
              SUM(CASE WHEN x.ou='under' THEN 1 ELSE 0 END) AS unders,
              CAST(AVG(x.cover_margin) AS DECIMAL(5,2)) AS avg_cover_margin
       FROM (
         SELECT home_team_id AS team_id,
                CASE ats_winner WHEN 'home' THEN 1 WHEN 'away' THEN 0 END AS covered,
                total_result AS ou, 1.0*home_margin + close_spread_home AS cover_margin
         FROM dbo.v_game_lines_consensus WHERE season=@season AND season_type=@st AND ats_winner IS NOT NULL
         UNION ALL
         SELECT visitor_team_id,
                CASE ats_winner WHEN 'away' THEN 1 WHEN 'home' THEN 0 END,
                total_result, -(1.0*home_margin + close_spread_home)
         FROM dbo.v_game_lines_consensus WHERE season=@season AND season_type=@st AND ats_winner IS NOT NULL
       ) x JOIN dbo.teams t ON t.id = x.team_id
       GROUP BY x.team_id, t.abbreviation ORDER BY covers DESC, avg_cover_margin DESC`, p),
    q(`SELECT TOP 12 game_id, week, home, visitor, open_spread_home, close_spread_home,
              CAST(close_spread_home - open_spread_home AS DECIMAL(5,1)) AS spread_move,
              open_total, close_total, ats_winner, total_result
       FROM dbo.v_game_lines_consensus WHERE season=@season AND season_type=@st AND open_spread_home IS NOT NULL
       ORDER BY ABS(close_spread_home - open_spread_home) DESC`, p),
    q(`SELECT prop_type, market_type, COUNT(*) AS props,
              SUM(CASE WHEN outcome IN ('over','hit') THEN 1 ELSE 0 END) AS overs_or_hits,
              SUM(CASE WHEN outcome IN ('under','miss') THEN 1 ELSE 0 END) AS unders_or_misses,
              SUM(CASE WHEN outcome='push' THEN 1 ELSE 0 END) AS pushes,
              SUM(CASE WHEN outcome='no_action' THEN 1 ELSE 0 END) AS no_action,
              SUM(CASE WHEN outcome='unmapped' THEN 1 ELSE 0 END) AS unmapped,
              CAST(AVG(CASE WHEN outcome IN ('over','under','push') THEN 1.0*actual - line END) AS DECIMAL(7,2)) AS avg_actual_minus_line
       FROM dbo.v_prop_results WHERE season=@season AND season_type=@st AND outcome <> 'pending'
       GROUP BY prop_type, market_type ORDER BY props DESC`, p),
  ]);
  return { summary: summary[0] ?? null, ats, moves, props };
});

/* ---------------------------------------------------------------- data health */
get('/health', z.object({}), MIN, async () => {
  const [freshness, coverage, reconciliation, sync, coverageMap, propTypes] = await Promise.all([
    q(`SELECT * FROM dbo.v_dh_table_freshness ORDER BY table_name`),
    q(`SELECT * FROM dbo.v_dh_season_coverage ORDER BY season DESC, season_type`),
    q(`SELECT * FROM dbo.v_dh_season_stats_reconciliation ORDER BY season DESC, season_type`),
    q(`SELECT TOP 25 scope, watermark, last_run, note FROM dbo.sync_state
       WHERE scope NOT LIKE 'backfill:plays:%' AND scope NOT LIKE 'backfill:opening_props:%'
       ORDER BY last_run DESC`),
    q(`SELECT endpoint, MIN(CASE WHEN has_data=1 THEN season END) AS first_season,
              MAX(CASE WHEN has_data=1 THEN season END) AS last_season,
              SUM(CASE WHEN has_data=1 THEN 1 ELSE 0 END) AS seasons_with_data, MAX(checked_at) AS checked_at
       FROM dbo.coverage_map GROUP BY endpoint ORDER BY endpoint`),
    q(`SELECT prop_type, market_type, COUNT(*) AS snapshots FROM dbo.prop_snapshots GROUP BY prop_type, market_type ORDER BY snapshots DESC`),
  ]);
  return { freshness, coverage, reconciliation, sync, coverageMap, propTypes };
});
