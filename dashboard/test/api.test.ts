/**
 * Spins up the real server (tsx) and exercises every endpoint plus the auth
 * gate. Needs SQL_* env pointing at a dev database loaded with gen_dev_data.py.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';

const live = !!process.env.SQL_SERVER;
const procs: ChildProcess[] = [];

async function start(port: number, env: Record<string, string>): Promise<string> {
  // spawn node itself (not npx) so kill() reaches the server process
  const p = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), ...env }, stdio: 'pipe',
  });
  procs.push(p);
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server on ${port} did not start`);
}

let base = '';
before(async () => { if (live) base = await start(18081, { AUTH_DISABLED: 'true' }); });
after(() => { for (const p of procs) p.kill(); });

const get = async (path: string, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}/api/${path}`, { headers });
  return { status: r.status, body: await r.json() as any };
};

test('every endpoint returns 200 with data', { skip: !live }, async () => {
  const meta = await get('meta');
  assert.equal(meta.status, 200);
  assert.ok(meta.body.seasons.length && meta.body.teams.length === 32);
  const season = 2025;
  const leaders = await get(`players/leaders?season=${season}&format=standard&pos=RB&sort=fp_pg&dir=desc`);
  assert.equal(leaders.status, 200);
  const rows = leaders.body.rows;
  assert.ok(rows.length > 10 && rows.every((r: any) => r.pos === 'RB'));
  assert.ok(rows[0].fp_pg >= rows[1].fp_pg, 'server-side sort');
  const pid = rows[0].player_id;
  const team = (await get(`teams?season=${season}`)).body[0].team_id;
  const games = await get(`games?season=${season}&week=10`);
  assert.equal(games.body.week, 10);
  const gid = games.body.games[0].game_id;
  for (const path of [
    `overview?season=${season}`, `players/search?q=${encodeURIComponent(rows[0].last_name.slice(0, 4))}`,
    `players/${pid}`, `players/${pid}/season?season=${season}`, `teams/${team}?season=${season}`,
    `matchups?season=${season}&format=half_ppr`, `games/${gid}`, `betting?season=${season}`, 'health',
  ]) {
    const r = await get(path);
    assert.equal(r.status, 200, `${path}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const g = (await get(`games/${gid}`)).body;
  assert.ok(g.plays.length > 50 && typeof g.plays[0].play_no === 'number', 'play_no is a number, not a BIGINT string');
});

test('bad input → 400, unknown ids → 404, unknown sort rejected', { skip: !live }, async () => {
  assert.equal((await get('players/leaders?season=abc')).status, 400);
  assert.equal((await get('players/leaders?season=2025&sort=passing_yards;DROP')).status, 400);
  assert.equal((await get('players/999999999')).status, 404);
  assert.equal((await get('games/1')).status, 404);
  assert.equal((await get('nope')).status, 404);
});

test('auth gate: refuses without App Service Authentication, enforces allowlist', { skip: !live }, async () => {
  const off = await start(18082, { AUTH_DISABLED: 'false', WEBSITE_AUTH_ENABLED: '', ALLOWED_EMAILS: 'me@example.com' });
  assert.equal((await fetch(`${off}/api/meta`, { headers: { 'x-ms-client-principal-name': 'me@example.com' } })).status, 503,
    'a forged header must not work when Easy Auth is off');
  const on = await start(18083, { AUTH_DISABLED: 'false', WEBSITE_AUTH_ENABLED: 'True', ALLOWED_EMAILS: 'me@example.com' });
  assert.equal((await fetch(`${on}/api/meta`)).status, 401);
  assert.equal((await fetch(`${on}/api/meta`, { headers: { 'x-ms-client-principal-name': 'someone@else.com' } })).status, 403);
  assert.equal((await fetch(`${on}/api/meta`, { headers: { 'x-ms-client-principal-name': 'Me@Example.com' } })).status, 200);
  assert.equal((await fetch(`${on}/healthz`)).status, 200, 'health probe stays open');
});
