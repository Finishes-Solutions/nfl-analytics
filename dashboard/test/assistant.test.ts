/**
 * Drives the real /api/ask agent loop against a mock OpenAI Responses API
 * (stream format: response.output_text.delta + response.completed), with real
 * tool execution against the dev database. No network, no API key.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';

const live = !!process.env.SQL_SERVER;
const requests: any[] = [];
let mock: http.Server;
let app: ChildProcess;
const BASE = 'http://localhost:18091';

function sse(res: http.ServerResponse, response: any, text = '') {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`event: response.created\ndata: ${JSON.stringify({ type: 'response.created', response: { id: response.id } })}\n\n`);
  for (const piece of text.match(/.{1,12}/gs) ?? []) {
    res.write(`event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: piece })}\n\n`);
  }
  res.write(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', usage: { total_tokens: 100 }, ...response } })}\n\n`);
  res.end();
}
const call = (call_id: string, name: string, args: unknown) => ({ type: 'function_call', call_id, name, arguments: JSON.stringify(args) });

before(async () => {
  if (!live) return;
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body);
      requests.push({ url: req.url, auth: req.headers.authorization, body: b });
      const userText = JSON.stringify(b.input);
      if (userText.includes('BLOCKED')) {
        if (!b.previous_response_id) return sse(res, { id: 'r_bad', output: [call('c9', 'run_sql', { query: 'DROP TABLE dbo.games', purpose: 'x' })] });
        return sse(res, { id: 'r_bad2', output: [] }, 'That query is not allowed.');
      }
      switch (b.previous_response_id) {
        case undefined:  // round 1: two parallel lookups
          return sse(res, { id: 'r1', output: [
            call('c1', 'leaderboard', { season: 2025, position: 'WR', format: 'ppr', limit: 3 }),
            call('c2', 'search_players', { name: 'zz-no-such-player' }),
          ] }, 'Checking the leaderboard. ');
        case 'r1':       // round 2: custom SQL + a chart
          return sse(res, { id: 'r2', output: [
            call('c3', 'run_sql', { query: 'SELECT TOP 3 pos, COUNT(*) AS n FROM dbo.v_player_fantasy_season WHERE season = 2025 GROUP BY pos ORDER BY n DESC', purpose: 'count by position' }),
            call('c4', 'render_chart', { type: 'bar', title: 'Test', x: ['A', 'B'], series: [{ name: 'pts', values: [1, 2] }] }),
          ] });
        default:         // round 3: final answer
          return sse(res, { id: 'r3', output: [{ type: 'message', role: 'assistant', content: [] }] }, '**Answer:** the top WR scored the most points.');
      }
    });
  });
  await new Promise<void>((r) => mock.listen(18090, r));
  app = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe',
    env: { ...process.env, PORT: '18091', AUTH_DISABLED: 'true', OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'mock-model', OPENAI_BASE_URL: 'http://localhost:18090/v1' },
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});
after(() => { app?.kill(); mock?.close(); });

async function ask(messages: { role: string; content: string }[]) {
  const r = await fetch(`${BASE}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }) });
  assert.equal(r.status, 200);
  const text = await r.text();
  return text.split('\n\n').filter((b) => b.startsWith('data: ')).map((b) => JSON.parse(b.slice(6)));
}

test('status reports configuration', { skip: !live }, async () => {
  const s = await (await fetch(`${BASE}/api/ask/status`)).json();
  assert.equal(s.enabled, true);
  assert.equal(s.model, 'mock-model');
  assert.ok(s.tools.includes('run_sql') && s.tools.includes('render_chart'));
  assert.ok(!s.tools.includes('semantic_search'), 'semantic_search needs OPENAI_EMBED_MODEL');
});

test('agent loop: parallel tools, SQL, chart, streamed answer', { skip: !live }, async () => {
  requests.length = 0;
  const ev = await ask([{ role: 'user', content: 'Who are the top WRs in 2025?' }]);
  const types = ev.map((e) => e.type);
  assert.deepEqual(types.filter((t) => t === 'tool_call').length, 4);
  const lb = ev.find((e) => e.type === 'tool_result' && e.name === 'leaderboard');
  assert.equal(lb.rows, 3);
  assert.ok(lb.preview[0].fp_total > 0);
  const sqlRes = ev.find((e) => e.type === 'tool_result' && e.name === 'run_sql');
  assert.ok(!sqlRes.error && sqlRes.rows === 3, JSON.stringify(sqlRes));
  assert.deepEqual(ev.find((e) => e.type === 'chart').chart.x, ['A', 'B']);
  const text = ev.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.ok(text.includes('Checking the leaderboard.') && text.includes('**Answer:**'));
  assert.equal(ev.at(-1).type, 'done');
  assert.equal(ev.at(-1).tokens, 300);

  // wire format sent to the model
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, '/v1/responses');
  assert.equal(requests[0].auth, 'Bearer sk-test');
  assert.equal(requests[0].body.model, 'mock-model');
  assert.equal(requests[0].body.stream, true);
  assert.match(requests[0].body.instructions, /never from memory/);
  assert.ok(requests[0].body.tools.some((t: any) => t.name === 'leaderboard' && t.parameters.properties.season));
  assert.equal(requests[1].body.previous_response_id, 'r1');
  assert.ok(requests[1].body.instructions, 'instructions re-sent every turn');
  const outputs = requests[1].body.input;
  assert.deepEqual(outputs.map((o: any) => o.call_id), ['c1', 'c2']);
  assert.ok(outputs.every((o: any) => o.type === 'function_call_output'));
  assert.ok(JSON.parse(outputs[0].output).length === 3, 'model receives the real rows');
});

test('guard: destructive SQL from the model is refused, not executed', { skip: !live }, async () => {
  const ev = await ask([{ role: 'user', content: 'BLOCKED test' }]);
  const r = ev.find((e) => e.type === 'tool_result' && e.name === 'run_sql');
  assert.match(r.error, /SELECT or WITH/);
  const games = await (await fetch(`${BASE}/api/meta`)).json();
  assert.ok(games.seasons.length > 0, 'games table still there');
});

test('request validation', { skip: !live }, async () => {
  const bad = await fetch(`${BASE}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }) });
  assert.equal(bad.status, 400);
  const lastAssistant = await fetch(`${BASE}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'assistant', content: 'hi' }] }) });
  assert.equal(lastAssistant.status, 400);
});

test('every curated tool runs against the warehouse', { skip: !live }, async () => {
  // direct executor calls (no model) so each tool's SQL is exercised, all sort options included
  const { runTool } = await import('../server/assistant/tools.ts');
  const ctx = { onChart: () => {} };
  const pid = (await import('../server/db.ts')).q;
  const [p] = await pid<{ player_id: number }>(`SELECT TOP 1 player_id FROM dbo.v_player_fantasy_season WHERE season=2025 AND pos='RB' ORDER BY fp_ppr_total DESC`);
  const [g] = await pid<{ id: number }>(`SELECT TOP 1 id FROM dbo.games WHERE season=2025 AND status LIKE 'Final%' AND id IN (SELECT game_id FROM dbo.plays)`);
  const calls: [string, unknown][] = [
    ['player_profile', { player_id: p.player_id }],
    ['player_game_log', { player_id: p.player_id, season: 2025, format: 'half_ppr' }],
    ['hot_and_cold', { season: 2025, direction: 'cold' }],
    ['team_summary', { team: 'KC', season: 2025 }],
    ['team_summary', { team: 'Chiefs', season: 2025 }],
    ['league_teams', { season: 2025 }],
    ['matchups', { season: 2025, position: 'TE', format: 'standard' }],
    ['games', { season: 2025, team: 'BUF' }],
    ['game_detail', { game_id: g.id }],
    ['betting_summary', { season: 2025 }],
    ['describe_schema', {}],
    ['describe_schema', { objects: ['v_team_season_summary'] }],
    ...['total', 'per_game', 'consistency', 'target_share', 'carry_share', 'opportunities', 'yards_per_target',
        'yards_per_carry', 'points_per_opportunity', 'yoy_change'].map((sort_by) => ['leaderboard', { season: 2025, sort_by, format: 'standard' }] as [string, unknown]),
  ];
  for (const [name, args] of calls) {
    const out = await runTool(name, JSON.stringify(args), ctx);
    const r = out.result as any;
    assert.ok(!(r && !Array.isArray(r) && r.error), `${name} ${JSON.stringify(args)} → ${JSON.stringify(r).slice(0, 200)}`);
    assert.ok(Array.isArray(r) ? r.length > 0 : Object.keys(r).length > 0, `${name} returned nothing`);
  }
  const unknown = await runTool('team_summary', JSON.stringify({ team: 'Nowhere', season: 2025 }), ctx);
  assert.match((unknown.result as any).error, /unknown team/);
  const badArgs = await runTool('leaderboard', JSON.stringify({ season: 'x' }), ctx);
  assert.match((badArgs.result as any).error, /invalid arguments/);
  await (await import('../server/db.ts')).closePool();
});
