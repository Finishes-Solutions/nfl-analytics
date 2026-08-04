/**
 * mock-api.ts — offline stand-in for api.balldontlie.io (Stage A/B testing).
 * Serves docs-shaped payloads so the FULL ingestion pipeline (auth header,
 * pagination, MERGE upserts, checkpoints) runs with zero subscription.
 *
 * Usage:
 *   npx tsx src/mock-api.ts                       # listens on :8090
 *   # in another shell:
 *   BDL_BASE_URL=http://localhost:8090 BDL_API_KEY=mock \
 *     npx tsx src/backfill.ts --phase teams --from 2024 --to 2024
 *
 * Coverage: teams, players(+active), games, stats, team_stats, standings,
 * season_stats, player_injuries. Advanced/plays/odds/props return empty pages
 * (valid shape) so those phases complete as no-ops — exercising the
 * "endpoint has no data" path, which mirrors real pre-coverage seasons.
 */
import http from 'node:http';

const TEAMS = [
  [6,'AFC','NORTH','Baltimore','Ravens','Baltimore Ravens','BAL'],
  [14,'AFC','WEST','Kansas City','Chiefs','Kansas City Chiefs','KC'],
  [18,'NFC','EAST','Philadelphia','Eagles','Philadelphia Eagles','PHI'],
  [25,'NFC','NORTH','Detroit','Lions','Detroit Lions','DET'],
].map(([id,conference,division,location,name,full_name,abbreviation]) =>
  ({ id, conference, division, location, name, full_name, abbreviation }));

const PLAYERS = [
  { id:33, first_name:'Lamar', last_name:'Jackson', position:'Quarterback', position_abbreviation:'QB',
    height:`6' 2"`, weight:'205 lbs', jersey_number:'8', college:'Louisville', experience:'9th Season', age:29, team:TEAMS[0] },
  { id:15, first_name:'Patrick', last_name:'Mahomes', position:'Quarterback', position_abbreviation:'QB',
    height:`6' 2"`, weight:'225 lbs', jersey_number:'15', college:'Texas Tech', experience:'10th Season', age:30, team:TEAMS[1] },
  { id:204, first_name:'Amon-Ra', last_name:'St. Brown', position:'Wide Receiver', position_abbreviation:'WR',
    height:`6' 0"`, weight:'202 lbs', jersey_number:'14', college:'USC', experience:'6th Season', age:26, team:TEAMS[3] },
];

const mkGame = (id: number, week: number, home: any, visitor: any) => ({
  id, visitor_team: visitor, home_team: home, home_team_score: 27, visitor_team_score: 20,
  home_team_q1: 7, home_team_q2: 10, home_team_q3: 3, home_team_q4: 7, home_team_ot: null,
  visitor_team_q1: 3, visitor_team_q2: 7, visitor_team_q3: 7, visitor_team_q4: 3, visitor_team_ot: null,
  season: 2024, week, postseason: false, date: `2024-09-${String(5 + week).padStart(2, '0')}T17:00:00.000Z`,
  status: 'Final', venue: 'Mock Stadium', summary: null,
});
const GAMES = [mkGame(9001, 1, TEAMS[1], TEAMS[0]), mkGame(9002, 2, TEAMS[2], TEAMS[3])];

const mkStat = (player: any, game: any) => ({
  player, team: player.team, game,
  passing_completions: 24, passing_attempts: 37, passing_yards: 289, yards_per_pass_attempt: 7.8,
  passing_touchdowns: 2, passing_interceptions: 1, sacks: 2, sacks_loss: 13, qbr: 71.2, qb_rating: 102.4,
  rushing_attempts: 8, rushing_yards: 54, yards_per_rush_attempt: 6.8, rushing_touchdowns: 1, long_rushing: 21,
  receptions: null, receiving_yards: null, fumbles: 0, fumbles_lost: 0,
});
const STATS = [mkStat(PLAYERS[0], GAMES[0]), mkStat(PLAYERS[1], GAMES[0])];

const TEAM_STATS = GAMES.flatMap((g) => [
  { team: g.home_team, game: g, home_away: 'home', first_downs: 22, third_down_conversions: 6, third_down_attempts: 12,
    third_down_efficiency: '6-12', total_yards: 388, yards_per_play: 5.9, rushing_yards: 132, rushing_attempts: 27,
    net_passing_yards: 256, passing_completions: 24, passing_attempts: 35, turnovers: 1, fumbles_lost: 0,
    interceptions_thrown: 1, penalties: 5, penalty_yards: 40, possession_time: '31:12', possession_time_seconds: 1872 },
  { team: g.visitor_team, game: g, home_away: 'away', first_downs: 18, third_down_conversions: 4, third_down_attempts: 11,
    third_down_efficiency: '4-11', total_yards: 322, yards_per_play: 5.1, rushing_yards: 98, rushing_attempts: 22,
    net_passing_yards: 224, passing_completions: 21, passing_attempts: 33, turnovers: 2, fumbles_lost: 1,
    interceptions_thrown: 1, penalties: 7, penalty_yards: 58, possession_time: '28:48', possession_time_seconds: 1728 },
]);

const STANDINGS = TEAMS.map((t, i) => ({
  team: t, season: 2024, win_streak: 2, points_for: 420 - i * 10, points_against: 350 + i * 10,
  playoff_seed: i + 1, point_differential: 70 - i * 20, overall_record: '11-6', conference_record: '8-4',
  division_record: '4-2', wins: 11, losses: 6, ties: 0, home_record: '6-2', road_record: '5-4',
}));

const SEASON_STATS = PLAYERS.map((p) => ({
  player: p, games_played: 17, postseason: false,
  passing_yards: 3955, passing_touchdowns: 41, passing_interceptions: 4,
  rushing_attempts: 139, rushing_yards: 915, rushing_touchdowns: 4,
  receptions: null, receiving_yards: null,
}));

const INJURIES = [{ player: PLAYERS[2], status: 'Questionable', comment: 'Ankle — limited in practice Wednesday.', date: '2024-11-20T18:00:00.000Z' }];

const page = (data: unknown[]) => JSON.stringify({ data, meta: { next_cursor: null, per_page: 100 } });
const one = (data: unknown) => JSON.stringify({ data });

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  res.setHeader('Content-Type', 'application/json');
  if (!req.headers.authorization) { res.statusCode = 401; res.end(JSON.stringify({ error: 'no key' })); return; }

  let body: string;
  if (p === '/nfl/v1/teams') body = page(TEAMS);
  else if (p.match(/^\/nfl\/v1\/teams\/\d+\/roster$/)) body = page([]);
  else if (p === '/nfl/v1/players' || p === '/nfl/v1/players/active') body = page(PLAYERS);
  else if (p === '/nfl/v1/games') body = page(url.searchParams.get('season_type') === '2' || !url.searchParams.get('season_type') ? GAMES : []);
  else if (p === '/nfl/v1/stats') body = page(url.searchParams.get('season_type') === '2' ? STATS : []);
  else if (p === '/nfl/v1/team_stats') body = page(url.searchParams.get('season_type') === '2' ? TEAM_STATS : []);
  else if (p === '/nfl/v1/standings') body = page(STANDINGS);
  else if (p === '/nfl/v1/season_stats') body = page(url.searchParams.get('season_type') === '2' ? SEASON_STATS : []);
  else if (p === '/nfl/v1/player_injuries') body = page(INJURIES);
  else body = page([]); // advanced, plays, odds, props → valid empty pages

  res.end(body);
});

server.listen(8090, () => console.log('Mock BALLDONTLIE on http://localhost:8090  (any Authorization header accepted)'));
