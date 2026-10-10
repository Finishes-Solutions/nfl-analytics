/**
 * tools.ts — twelve curated tools. Design rules (docs/10):
 * - Descriptions state when to use AND when not to (Copilot routes on these).
 * - Flat inputs, enums, defaults. All SQL parameterized; sort/metric/table names
 *   come from allowlists, never from user strings.
 * - Row caps everywhere; every response includes the IDs needed for follow-ups.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { q, embed, config } from './config';

const seasonType = z.number().int().min(1).max(3).default(2)
  .describe('1=preseason, 2=regular season (default), 3=postseason');
const fmt = z.enum(['standard', 'half_ppr', 'ppr']).default('ppr');
// Every rate column must match the format of the total it sits next to —
// a standard leaderboard reporting PPR per-game/stdev is silently wrong.
const FMT_COLS: Record<string, { total: string; pg: string; stdev: string }> = {
  standard: { total: 'fp_standard_total', pg: 'fp_standard_pg', stdev: 'fp_standard_stdev' },
  half_ppr: { total: 'fp_half_ppr_total', pg: 'fp_half_ppr_pg', stdev: 'fp_half_ppr_stdev' },
  ppr:      { total: 'fp_ppr_total',      pg: 'fp_ppr_pg',      stdev: 'fp_ppr_stdev' },
};

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 1) }] });
const jerr = (msg: string) => ({ content: [{ type: 'text' as const, text: JSON.stringify({ error: msg }) }], isError: true });

export function registerTools(server: McpServer): void {
  server.tool(
    'search_players',
    'Find players by (partial) name to get their player_id. ALWAYS call this first before any per-player stats tool. Do not use for stats themselves.',
    {
      name: z.string().min(2).describe('Full or partial player name, e.g. "lamar" or "jackson"'),
      position: z.string().max(4).optional().describe('Position abbreviation filter, e.g. QB, RB, WR'),
      active_only: z.boolean().default(false),
    },
    async ({ name, position, active_only }) => {
      const rows = await q(
        `SELECT TOP 20 id AS player_id, first_name, last_name, position_abbreviation AS pos,
                team_id, height_inches, weight_lbs, college, is_active
         FROM dbo.players
         WHERE (first_name + ' ' + last_name) LIKE @name
           AND (@pos IS NULL OR position_abbreviation = @pos)
           AND (@active = 0 OR is_active = 1)
         ORDER BY is_active DESC, last_name`,
        { name: `%${name}%`, pos: position ?? null, active: active_only ? 1 : 0 }
      );
      return rows.length ? json(rows) : jerr(`No players match "${name}"`);
    }
  );

  server.tool(
    'get_player_season',
    'Full season stat line + fantasy points (all 3 formats) + consistency profile (stdev/floor/ceiling) for ONE player-season. Numeric questions only — for similarity or conceptual questions use semantic_search.',
    { player_id: z.number().int(), season: z.number().int().min(2002), season_type: seasonType },
    async ({ player_id, season, season_type }) => {
      const rows = await q(
        `SELECT f.*, s.passing_completions, s.passing_attempts, s.passing_yards,
                s.passing_touchdowns, s.passing_interceptions,
                CAST(100.0 * s.passing_completions / NULLIF(s.passing_attempts,0) AS DECIMAL(5,2)) AS passing_completion_pct,
                r.passer_rating, ss.qbr,
                s.rushing_attempts, s.rushing_yards, s.rushing_touchdowns,
                s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns
         FROM dbo.v_player_fantasy_season f
         LEFT JOIN dbo.v_player_season_from_games s
           ON s.player_id=f.player_id AND s.season=f.season AND s.season_type=f.season_type
         LEFT JOIN dbo.v_qb_passer_rating r
           ON r.player_id=f.player_id AND r.season=f.season AND r.season_type=f.season_type
         LEFT JOIN dbo.player_season_stats ss
           ON ss.player_id=f.player_id AND ss.season=f.season AND ss.season_type=f.season_type
         WHERE f.player_id=@pid AND f.season=@season AND f.season_type=@st`,
        { pid: player_id, season, st: season_type }
      );
      return rows.length ? json(rows[0]) : jerr('No data for that player/season — verify with search_players and check season coverage.');
    }
  );

  server.tool(
    'get_player_gamelog',
    'Per-game stat lines with fantasy points for one player in one season, most recent first. Use for "last N games" and week-by-week questions.',
    {
      player_id: z.number().int(), season: z.number().int().min(2002),
      season_type: seasonType, last_n: z.number().int().min(1).max(25).default(10),
    },
    async ({ player_id, season, season_type, last_n }) => {
      const rows = await q(
        `SELECT TOP (@n) game_id, week, fp_standard, fp_half_ppr, fp_ppr,
                pts_pass_yds, pts_pass_td, pts_rush_yds, pts_rush_td, pts_rec_yds, pts_rec_td, receptions
         FROM dbo.v_player_fantasy_game
         WHERE player_id=@pid AND season=@season AND season_type=@st
         ORDER BY week DESC`,
        { pid: player_id, season, st: season_type, n: last_n }
      );
      return rows.length ? json(rows) : jerr('No games found for that player/season.');
    }
  );

  server.tool(
    'compare_players',
    'Aligned season comparison for 2–4 players (fantasy + consistency). Resolve IDs with search_players first. For finding SIMILAR players, use semantic_search instead.',
    {
      player_ids: z.array(z.number().int()).min(2).max(4),
      season: z.number().int().min(2002), season_type: seasonType, format: fmt,
    },
    async ({ player_ids, season, season_type, format }) => {
      const params: Record<string, number> = { season, st: season_type };
      player_ids.forEach((id, i) => (params[`p${i}`] = id));
      const inList = player_ids.map((_, i) => `@p${i}`).join(',');
      const rows = await q(
        `SELECT * FROM dbo.v_player_fantasy_season
         WHERE player_id IN (${inList}) AND season=@season AND season_type=@st
         ORDER BY ${FMT_COLS[format].total} DESC`, params
      );
      return rows.length >= 2 ? json({ format, rows }) : jerr('Fewer than 2 of those players have data for that season.');
    }
  );

  server.tool(
    'get_fantasy_leaders',
    'Fantasy leaderboard for a season, optionally by position. States the scoring format. Not for one specific player (use get_player_season).',
    {
      season: z.number().int().min(2002), position: z.string().max(4).optional(),
      format: fmt, top_n: z.number().int().min(1).max(config.maxRows).default(15),
      season_type: seasonType,
    },
    async ({ season, position, format, top_n, season_type }) => {
      const c = FMT_COLS[format]; // allowlist — never user text
      const rows = await q(
        `SELECT TOP (@n) player_id, first_name, last_name, pos, games,
                ${c.total} AS fantasy_points, ${c.pg} AS fantasy_points_pg, ${c.stdev} AS fantasy_points_stdev
         FROM dbo.v_player_fantasy_season
         WHERE season=@season AND season_type=@st AND (@pos IS NULL OR pos=@pos)
         ORDER BY ${c.total} DESC`,
        { n: top_n, season, st: season_type, pos: position ?? null }
      );
      return json({ format, rows });
    }
  );

  server.tool(
    'get_matchup_analysis',
    'Fantasy points ALLOWED by defenses to a position (matchup difficulty), in the requested scoring format. Use for "best/worst matchup" questions.',
    {
      position: z.string().max(4), season: z.number().int().min(2002),
      defense_team_id: z.number().int().optional(), season_type: seasonType, format: fmt,
    },
    async ({ position, season, defense_team_id, season_type, format }) => {
      const pfx = { standard: 'fp_standard', half_ppr: 'fp_half_ppr', ppr: 'fp_ppr' }[format]; // allowlist
      const rows = await q(
        `SELECT defense_team_id, defense, pos, games,
                ${pfx}_allowed_pg AS fantasy_points_allowed_pg, ${pfx}_allowed_total AS fantasy_points_allowed_total
         FROM dbo.v_fantasy_points_allowed
         WHERE season=@season AND season_type=@st AND pos=@pos
           AND (@def IS NULL OR defense_team_id=@def)
         ORDER BY ${pfx}_allowed_pg DESC`,
        { season, st: season_type, pos: position, def: defense_team_id ?? null }
      );
      return rows.length ? json({ format, rows }) : jerr('No matchup data for that position/season.');
    }
  );

  server.tool(
    'get_team_season',
    'One team\'s season: record/standings + DST fantasy + core offense/defense splits. Use search via get_games or known team_id (teams are stable).',
    { team_id: z.number().int(), season: z.number().int().min(2002) },
    async ({ team_id, season }) => {
      const [standings, dst, tss] = await Promise.all([
        q(`SELECT * FROM dbo.standings WHERE team_id=@t AND season=@s`, { t: team_id, s: season }),
        q(`SELECT * FROM dbo.v_dst_fantasy_season WHERE team_id=@t AND season=@s AND season_type=2`, { t: team_id, s: season }),
        q(`SELECT team_id, season, total_points_per_game, total_offensive_yards_per_game,
                  opp_total_points_per_game, opp_total_offensive_yards_per_game,
                  misc_turnover_differential, misc_third_down_conv_pct
           FROM dbo.team_season_stats WHERE team_id=@t AND season=@s AND season_type=2`, { t: team_id, s: season }),
      ]);
      if (!standings.length && !tss.length) return jerr('No data for that team/season.');
      return json({ standings: standings[0] ?? null, dst_fantasy: dst[0] ?? null, team_stats: tss[0] ?? null });
    }
  );

  server.tool(
    'get_games',
    'Schedule and results (incl. quarter scores) for a season/week/team. Returns game_ids for follow-up calls.',
    {
      season: z.number().int().min(2002), week: z.number().int().min(1).max(22).optional(),
      team_id: z.number().int().optional(), season_type: seasonType,
    },
    async ({ season, week, team_id, season_type }) => {
      const rows = await q(
        `SELECT TOP (${config.maxRows}) id AS game_id, season, week, season_type, game_date, status, venue,
                home_team_id, home_team_score, home_team_q1, home_team_q2, home_team_q3, home_team_q4, home_team_ot,
                visitor_team_id, visitor_team_score, visitor_team_q1, visitor_team_q2, visitor_team_q3, visitor_team_q4, visitor_team_ot
         FROM dbo.games
         WHERE season=@season AND season_type=@st
           AND (@week IS NULL OR week=@week)
           AND (@team IS NULL OR home_team_id=@team OR visitor_team_id=@team)
         ORDER BY game_date`,
        { season, st: season_type, week: week ?? null, team: team_id ?? null }
      );
      return json(rows);
    }
  );

  /* ------------------------------------------------------------------------
     NEW: advanced (Next Gen Stats style) metrics.
     Coverage per coverage_map: regular season 2018+, postseason 2021+.
     week=0 rows are the full-season aggregate; weeks 1..22 are per-week.
  ------------------------------------------------------------------------ */
  server.tool(
    'get_advanced_stats',
    'Next Gen Stats style advanced metrics for ONE player-season: air yards, time to throw, completion pct above expectation (passing); yards over expected, time to line of scrimmage, eight-defender rate (rushing); separation, cushion, YAC above expectation (receiving). Coverage starts 2018 (regular season) / 2021 (postseason). For conventional box-score numbers use get_player_season instead.',
    {
      player_id: z.number().int(),
      season: z.number().int().min(2018),
      category: z.enum(['passing', 'rushing', 'receiving']),
      season_type: seasonType,
      week: z.number().int().min(0).max(22).default(0)
        .describe('0 = full-season aggregate (default); 1-22 = a specific week'),
    },
    async ({ player_id, season, category, season_type, week }) => {
      const TABLE: Record<string, string> = {  // allowlist — never user text
        passing: 'dbo.adv_passing_stats',
        rushing: 'dbo.adv_rushing_stats',
        receiving: 'dbo.adv_receiving_stats',
      };
      const rows = await q(
        `SELECT TOP (${config.maxRows}) *
         FROM ${TABLE[category]}
         WHERE player_id=@pid AND season=@season AND season_type=@st AND week=@wk`,
        { pid: player_id, season, st: season_type, wk: week }
      );
      return rows.length ? json({ category, rows })
        : jerr('No advanced stats for that player/season/week. Coverage starts 2018 (regular) / 2021 (postseason); week 0 is the season aggregate.');
    }
  );

  /* ------------------------------------------------------------------------
     NEW: league-wide standings. get_team_season covers ONE team; this covers
     the whole league, which is what "who had the best record" needs.
  ------------------------------------------------------------------------ */
  server.tool(
    'get_league_standings',
    'Full league standings for a season: wins, losses, ties, points for/against, point differential, playoff seed, and home/road/division records. Coverage 2004+. Use get_team_season for one team\'s full profile including DST fantasy.',
    {
      season: z.number().int().min(2004),
      conference: z.enum(['AFC', 'NFC']).optional(),
    },
    async ({ season, conference }) => {
      const rows = await q(
        `SELECT TOP (${config.maxRows}) s.team_id, t.abbreviation, t.full_name,
                t.conference, t.division,
                s.wins, s.losses, s.ties, s.overall_record, s.conference_record,
                s.division_record, s.home_record, s.road_record,
                s.points_for, s.points_against, s.point_differential,
                s.win_streak, s.playoff_seed
         FROM dbo.standings s
         JOIN dbo.teams t ON t.id = s.team_id
         WHERE s.season=@season AND (@conf IS NULL OR t.conference=@conf)
         ORDER BY s.wins DESC, s.point_differential DESC`,
        { season, conf: conference ?? null }
      );
      return rows.length ? json(rows) : jerr('No standings for that season. Coverage starts 2004.');
    }
  );

  /* ------------------------------------------------------------------------
     NEW: play-by-play search. 1.2M rows, so a game_id or season+week is
     REQUIRED to keep every call on an index.
     NOTE: dbo.plays has team_id but NO player_id — attribution lives in the
     text. Play descriptions are unreliable before ~2009 (2005 is effectively
     empty upstream).
  ------------------------------------------------------------------------ */
  server.tool(
    'search_plays',
    'Play-by-play rows for a specific game, or for a season+week, with optional filters for scoring plays, down, and play type. Each row carries play_no, a monotonic within-game index — use it for sequence questions ("three plays before X"): find the target play_no, then request offset = play_no - 4. Page a full game (~170 plays) with top_n and offset. Requires game_id OR season+week. Play text is sparse before 2009 and effectively missing for 2005. For conceptual searches ("plays like...") use semantic_search instead.',
    {
      game_id: z.number().int().optional().describe('From get_games. Preferred — most precise.'),
      season: z.number().int().min(2002).optional(),
      week: z.number().int().min(1).max(22).optional(),
      season_type: seasonType,
      team_id: z.number().int().optional(),
      scoring_only: z.boolean().default(false),
      down: z.number().int().min(1).max(4).optional(),
      type_text: z.string().max(64).optional()
        .describe('Exact play type, e.g. "Passing Touchdown", "Field Goal Good", "Sack"'),
      top_n: z.number().int().min(1).max(200).default(60),
      offset: z.number().int().min(0).default(0)
        .describe('Skip this many rows — use with top_n to page through a full game.'),
    },
    async ({ game_id, season, week, season_type, team_id, scoring_only, down, type_text, top_n, offset }) => {
      if (!game_id && !(season && week)) {
        return jerr('Provide game_id, or both season and week. The plays table is too large to scan without one of those.');
      }
      const rows = await q(
        `SELECT play_no, play_id, game_id, season, week, season_type, team_id,
                period, clock_display, wallclock, away_score, home_score, scoring_play,
                type_text, start_down, start_distance, start_yards_to_endzone,
                stat_yardage, home_win_probability, text
         FROM (
           SELECT CAST(ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY wallclock, id) AS INT) AS play_no,
                  id AS play_id, game_id, season, week, season_type, team_id,
                  period, clock_display, wallclock, away_score, home_score, scoring_play,
                  type_text, start_down, start_distance, start_yards_to_endzone,
                  stat_yardage, home_win_probability,
                  CASE WHEN text = 'null' THEN NULL ELSE text END AS text
           FROM dbo.plays
           WHERE (@gid IS NULL OR game_id=@gid)
             AND (@season IS NULL OR season=@season)
             AND (@week IS NULL OR week=@week)
             AND (@gid IS NOT NULL OR season_type=@st)
         ) p
         WHERE (@team IS NULL OR team_id=@team)
           AND (@scoring = 0 OR scoring_play = 1)
           AND (@down IS NULL OR start_down=@down)
           AND (@ptype IS NULL OR type_text=@ptype)
         ORDER BY game_id, play_no
         OFFSET @off ROWS FETCH NEXT @n ROWS ONLY`,
        {
          n: top_n, off: offset, gid: game_id ?? null, season: season ?? null, week: week ?? null,
          st: season_type, team: team_id ?? null, scoring: scoring_only ? 1 : 0,
          down: down ?? null, ptype: type_text ?? null,
        }
      );
      return rows.length ? json(rows) : jerr('No plays matched. Note: play text is sparse before 2009 and 2005 is effectively empty upstream.');
    }
  );
  
  server.tool(
    'semantic_search',
    'Conceptual/similarity/memory search over play descriptions, player profile cards, and injury notes ("games where...", "plays like...", "backs similar to..."). NOT for numeric lookups or counting — use search_plays or the stats tools for those. Returned player_id/game_id keys should be joined back via the stats tools before answering.',
    {
      question: z.string().min(3),
      doc_type: z.enum(['play', 'player_card', 'injury', 'game_summary']).optional(),
      season_from: z.number().int().optional(), season_to: z.number().int().optional(),
      player_id: z.number().int().optional(),
      top_n: z.number().int().min(1).max(20).default(8),
    },
    async ({ question, doc_type, season_from, season_to, player_id, top_n }) => {
      const vector = await embed(question);
      const rows = await q(
        `EXEC dbo.sp_semantic_search @query_vector=@qv, @doc_type=@dt,
              @season_from=@sf, @season_to=@st2, @player_id=@pid, @top_n=@n`,
        {
          qv: JSON.stringify(vector), dt: doc_type ?? null,
          sf: season_from ?? null, st2: season_to ?? null,
          pid: player_id ?? null, n: top_n,
        }
      );
      return rows.length ? json(rows) : jerr('No semantic matches — the embedding corpus may not cover that yet.');
    }
  );
}
