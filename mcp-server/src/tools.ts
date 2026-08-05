/**
 * tools.ts — the nine curated tools. Design rules (docs/10):
 * - Descriptions state when to use AND when not to (Copilot routes on these).
 * - Flat inputs, enums, defaults. All SQL parameterized; sort/metric columns
 *   come from allowlists, never from user strings.
 * - Row caps everywhere; every response includes the IDs needed for follow-ups.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { q, embed, config } from './config';

const seasonType = z.number().int().min(1).max(3).default(2)
  .describe('1=preseason, 2=regular season (default), 3=postseason');
const fmt = z.enum(['standard', 'half_ppr', 'ppr']).default('ppr');
const FMT_COL: Record<string, string> = {
  standard: 'fp_standard_total', half_ppr: 'fp_half_ppr_total', ppr: 'fp_ppr_total',
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
                s.passing_touchdowns, s.passing_interceptions, s.passing_completion_pct,
                s.qb_rating, s.qbr,
                s.rushing_attempts, s.rushing_yards, s.rushing_touchdowns,
                s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns
         FROM dbo.v_player_fantasy_season f
         LEFT JOIN dbo.player_season_stats s
           ON s.player_id=f.player_id AND s.season=f.season AND s.season_type=f.season_type
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
      season: z.number().int().min(2002), season_type: seasonType,
    },
    async ({ player_ids, season, season_type }) => {
      const params: Record<string, number> = { season, st: season_type };
      player_ids.forEach((id, i) => (params[`p${i}`] = id));
      const inList = player_ids.map((_, i) => `@p${i}`).join(',');
      const rows = await q(
        `SELECT * FROM dbo.v_player_fantasy_season
         WHERE player_id IN (${inList}) AND season=@season AND season_type=@st
         ORDER BY fp_ppr_total DESC`, params
      );
      return rows.length >= 2 ? json(rows) : jerr('Fewer than 2 of those players have data for that season.');
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
      const col = FMT_COL[format]; // allowlist — never user text
      const rows = await q(
        `SELECT TOP (@n) player_id, first_name, last_name, pos, games,
                ${col} AS fantasy_points, fp_ppr_pg, fp_ppr_stdev
         FROM dbo.v_player_fantasy_season
         WHERE season=@season AND season_type=@st AND (@pos IS NULL OR pos=@pos)
         ORDER BY ${col} DESC`,
        { n: top_n, season, st: season_type, pos: position ?? null }
      );
      return json({ format, rows });
    }
  );

  server.tool(
    'get_matchup_analysis',
    'Fantasy points ALLOWED by defenses to a position (matchup difficulty). Use for "best/worst matchup" questions. PPR basis.',
    {
      position: z.string().max(4), season: z.number().int().min(2002),
      defense_team_id: z.number().int().optional(), season_type: seasonType,
    },
    async ({ position, season, defense_team_id, season_type }) => {
      const rows = await q(
        `SELECT defense_team_id, defense, pos, games, fp_ppr_allowed_pg, fp_ppr_allowed_total
         FROM dbo.v_fantasy_points_allowed
         WHERE season=@season AND season_type=@st AND pos=@pos
           AND (@def IS NULL OR defense_team_id=@def)
         ORDER BY fp_ppr_allowed_pg DESC`,
        { season, st: season_type, pos: position, def: defense_team_id ?? null }
      );
      return rows.length ? json(rows) : jerr('No matchup data for that position/season.');
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
                home_team_id, home_team_score, visitor_team_id, visitor_team_score
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

  server.tool(
    'semantic_search',
    'Conceptual/similarity/memory search over play descriptions, player profile cards, and injury notes ("games where...", "plays like...", "backs similar to..."). NOT for numeric lookups — returned player_id/game_id keys should be joined back via the stats tools before answering.',
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
