/**
 * Integration test: every curated tool against a real SQL Server loaded with
 * the synthetic dev dataset (tools/gen_dev_data.py). Requires SQL_* env.
 * semantic_search is skipped — it needs Azure OpenAI + SQL's VECTOR type.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools';
import { q, getPool } from '../src/config';

async function connect() {
  const server = new McpServer({ name: 'test', version: '0' });
  registerTools(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { type: string; text: string }[])[0].text;
  return { isError: !!r.isError, body: JSON.parse(text) };
}

after(async () => { (await getPool()).close(); });

test('all tools: happy paths return data', async () => {
  const client = await connect();
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.equal(tools.length, 12, `expected 12 tools, got ${tools.join(',')}`);

  const [p] = await q<{ player_id: number; first_name: string; season: number }>(
    `SELECT TOP 1 f.player_id, f.first_name, f.season FROM dbo.v_player_fantasy_season f
     WHERE f.pos='WR' AND f.season_type=2 AND f.season=2025 ORDER BY f.fp_ppr_total DESC`);
  const [g] = await q<{ id: number; home_team_id: number }>(
    `SELECT TOP 1 id, home_team_id FROM dbo.games WHERE season=2025 AND season_type=2 AND status LIKE 'Final%' ORDER BY id`);

  const search = await call(client, 'search_players', { name: p.first_name });
  assert.ok(!search.isError && search.body.length > 0);

  const season = await call(client, 'get_player_season', { player_id: p.player_id, season: 2025 });
  assert.ok(!season.isError && season.body.fp_ppr_total > 0);

  const log = await call(client, 'get_player_gamelog', { player_id: p.player_id, season: 2025, last_n: 5 });
  assert.equal(log.body.length, 5);

  const leaders = await call(client, 'get_matchup_analysis', { position: 'WR', season: 2025, format: 'half_ppr' });
  assert.equal(leaders.body.format, 'half_ppr');
  assert.ok(leaders.body.rows[0].fantasy_points_allowed_pg >= leaders.body.rows.at(-1).fantasy_points_allowed_pg);

  const team = await call(client, 'get_team_season', { team_id: g.home_team_id, season: 2025 });
  assert.ok(!team.isError && team.body.standings);

  const games = await call(client, 'get_games', { season: 2025, week: 3 });
  assert.ok(games.body.length > 0);

  const adv = await call(client, 'get_advanced_stats', { player_id: p.player_id, season: 2025, category: 'receiving' });
  assert.ok(!adv.isError, JSON.stringify(adv.body));

  const st = await call(client, 'get_league_standings', { season: 2025, conference: 'AFC' });
  assert.equal(st.body.length, 16);

  const plays = await call(client, 'search_plays', { game_id: g.id, top_n: 10, offset: 5 });
  assert.equal(plays.body[0].play_no, 6, 'offset should page by play_no');

  const noFilter = await call(client, 'search_plays', {});
  assert.ok(noFilter.isError, 'plays without game_id or season+week must be refused');
});

test('get_fantasy_leaders: rate columns match the requested format', async () => {
  const client = await connect();
  for (const format of ['standard', 'half_ppr', 'ppr'] as const) {
    const r = await call(client, 'get_fantasy_leaders', { season: 2025, position: 'WR', format, top_n: 3 });
    const top = r.body.rows[0];
    const col = { standard: 'fp_standard', half_ppr: 'fp_half_ppr', ppr: 'fp_ppr' }[format];
    const [v] = await q<Record<string, number>>(
      `SELECT ${col}_pg AS pg, ${col}_stdev AS sd FROM dbo.v_player_fantasy_season
       WHERE player_id=@p AND season=2025 AND season_type=2`, { p: top.player_id });
    assert.equal(top.fantasy_points_pg, v.pg, `${format} per-game must come from ${col}_pg`);
    assert.equal(top.fantasy_points_stdev, v.sd, `${format} stdev must come from ${col}_stdev`);
  }
});

test('compare_players sorts by the requested format', async () => {
  const client = await connect();
  const ids = (await q<{ player_id: number }>(
    `SELECT TOP 4 player_id FROM dbo.v_player_fantasy_season WHERE season=2025 AND season_type=2 AND pos IN ('RB','WR') ORDER BY NEWID()`))
    .map((r) => r.player_id);
  const r = await call(client, 'compare_players', { player_ids: ids, season: 2025, format: 'standard' });
  const totals = r.body.rows.map((x: { fp_standard_total: number }) => x.fp_standard_total);
  assert.deepEqual(totals, [...totals].sort((a: number, b: number) => b - a));
});
