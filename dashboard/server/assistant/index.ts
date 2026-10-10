/**
 * Assistant API.
 *   GET  /api/ask/status   → whether a model is configured, which tools are on, today's token use
 *   POST /api/ask          → Server-Sent Events: text deltas, tool calls/results, charts, done
 *
 * The browser never sees the OpenAI key; it talks only to this server, which
 * runs the tool loop against the read-only warehouse connection.
 */
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { createResponse, embed, functionCalls, llmConfig, type LlmConfig } from './llm.js';
import { runTool, toolDefinitions, type ChartSpec, type ToolContext } from './tools.js';

export const assistantRouter = Router();
assistantRouter.use(express.json({ limit: '256kb' }));

const MAX_ROUNDS = Number(process.env.ASSISTANT_MAX_TOOL_ROUNDS ?? 8);
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_TOKEN_LIMIT ?? 2_000_000);

/* ---- daily token budget (single user, single process — memory is enough) */
let usageDay = '';
let usageTokens = 0;
function usage(add = 0): number {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== usageDay) { usageDay = today; usageTokens = 0; }
  usageTokens += add;
  return usageTokens;
}

function context(cfg: LlmConfig | null, onChart: (c: ChartSpec) => void, signal?: AbortSignal): ToolContext {
  return { onChart, embed: cfg?.embedModel ? (t) => embed(cfg, t, signal) : undefined };
}

assistantRouter.get('/status', (_req, res) => {
  const cfg = llmConfig();
  res.json({
    enabled: !!cfg,
    model: cfg?.model ?? null,
    provider: cfg ? (/\.azure\.com/i.test(cfg.baseUrl) ? 'Azure OpenAI' : new URL(cfg.baseUrl).host) : null,
    tools: cfg ? toolDefinitions(context(cfg, () => {})).map((t) => t.name) : [],
    tokens_today: usage(),
    daily_token_limit: DAILY_LIMIT,
  });
});

async function instructions(): Promise<string> {
  const latest = await q<{ season: number; season_type: number; week: number }>(`
    SELECT TOP 1 season, season_type, week FROM dbo.games WHERE status LIKE '%Final%' ORDER BY game_date DESC`);
  const range = await q<{ lo: number; hi: number }>(`SELECT MIN(season) AS lo, MAX(season) AS hi FROM dbo.games`);
  const l = latest[0];
  return `You are the analyst inside a private NFL analytics dashboard. You answer from the user's own data warehouse through tools — never from memory.

Today is ${new Date().toISOString().slice(0, 10)}. Seasons in the warehouse: ${range[0]?.lo}–${range[0]?.hi}. Most recent completed game: ${l ? `${l.season} ${l.season_type === 3 ? 'postseason' : 'regular season'} week ${l.week}` : 'none'}. When the user doesn't name a season, use the most recent one with games.

Rules
- Every number you state must come from a tool result in this conversation. If the data doesn't cover something, say so plainly. Never estimate stats or fill gaps from general football knowledge; you may add clearly-labelled football context, but not numbers.
- Prefer the specific tools. Use run_sql for analysis they can't do (custom aggregations, multi-season comparisons, splits); call describe_schema first if you're unsure of columns. Read the v_* views, which already correct known source defects (season totals come from game logs, not player_season_stats).
- Resolve names with search_players or the team argument before per-entity tools. If a name is ambiguous, pick the most likely active player and say who you chose.
- season_type: 2 = regular season (default), 3 = postseason. Fantasy formats: standard, half_ppr, ppr; state which one you used.
- Data limits: Next Gen (advanced) stats 2018+; odds/props from 2025 week 8; plays have no player_id (names are in the text); injuries and odds are snapshot archives that start when collection began.
- When a trend or comparison is clearer as a picture, call render_chart once with numbers from your tool results (line for weeks/seasons, bar for categories, at most 4 series).

Answer style: lead with the direct answer in one or two sentences, then the supporting numbers (a compact markdown table when comparing several rows), then caveats if any. Be concise. Don't describe your tool calls — the interface shows them.`;
}

const askBody = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(12_000) })).min(1).max(30),
});

assistantRouter.post('/', async (req: Request, res: Response) => {
  const cfg = llmConfig();
  if (!cfg) { res.status(503).json({ error: 'Assistant not configured: set OPENAI_API_KEY and OPENAI_MODEL (see docs/14).' }); return; }
  const parsed = askBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'invalid request' }); return; }
  if (parsed.data.messages.at(-1)!.role !== 'user') { res.status(400).json({ error: 'last message must be from the user' }); return; }
  if (usage() >= DAILY_LIMIT) { res.status(429).json({ error: `Daily token limit (${DAILY_LIMIT.toLocaleString()}) reached. Raise ASSISTANT_DAILY_TOKEN_LIMIT to continue today.` }); return; }

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (ev: Record<string, unknown>) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);

  try {
    const ctx = context(cfg, (chart) => send({ type: 'chart', chart }), abort.signal);
    const tools = toolDefinitions(ctx);
    const system = await instructions();
    let input: unknown[] = parsed.data.messages.map((m) => ({ role: m.role, content: m.content }));
    let previous: string | undefined;
    let tokens = 0;

    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS;
      const r = await createResponse(cfg, {
        instructions: last ? `${system}\n\nTool budget exhausted: answer now with what you have.` : system,
        input, tools: last ? [] : tools, previousResponseId: previous,
        onText: (delta) => send({ type: 'delta', text: delta }), signal: abort.signal,
      });
      tokens += r.usage?.total_tokens ?? 0;
      const calls = functionCalls(r);
      if (!calls.length) break;
      previous = r.id;
      input = [];
      // run this round's calls in parallel; the model may batch independent lookups
      const results = await Promise.all(calls.map(async (c) => {
        let args: unknown = {};
        try { args = JSON.parse(c.arguments || '{}'); } catch { /* reported by runTool */ }
        send({ type: 'tool_call', id: c.call_id, name: c.name, args });
        const out = await runTool(c.name, c.arguments, ctx);
        const isErr = !!out.result && typeof out.result === 'object' && !Array.isArray(out.result) && 'error' in (out.result as object);
        send({
          type: 'tool_result', id: c.call_id, name: c.name, rows: out.rows,
          error: isErr ? (out.result as { error: string }).error : undefined,
          preview: c.name === 'render_chart' ? undefined : preview(out.result),
        });
        return { type: 'function_call_output', call_id: c.call_id, output: out.forModel };
      }));
      input.push(...results);
    }
    usage(tokens);
    send({ type: 'done', tokens, tokens_today: usage() });
  } catch (e) {
    if (!abort.signal.aborted) {
      console.error('assistant failed:', e);
      send({ type: 'error', message: (e as Error).message });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

/** What the UI shows for a tool result: first rows of a table, or a trimmed object. */
function preview(result: unknown): unknown {
  if (Array.isArray(result)) return result.slice(0, 25);
  if (result && typeof result === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(result)) o[k] = Array.isArray(v) ? v.slice(0, 25) : v;
    return o;
  }
  return result;
}
