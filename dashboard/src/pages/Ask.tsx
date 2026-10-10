import { useEffect, useRef, useState } from 'react';
import { FORMAT_LABEL, href, useApi, useFilters } from '../lib';
import { ColumnChart, GroupedColumns, LineChart, SERIES } from '../components/charts';
import { Markdown } from '../components/markdown';
import { Card } from '../components/ui';

interface ChartSpec { type: 'line' | 'bar'; title: string; x: string[]; series: { name: string; values: (number | null)[] }[]; y_label?: string }
interface ToolRun { id: string; name: string; args: Record<string, unknown>; done: boolean; rows?: number; error?: string; preview?: unknown }
interface Msg { role: 'user' | 'assistant'; content: string; tools?: ToolRun[]; charts?: ChartSpec[]; error?: string; tokens?: number }
interface Status { enabled: boolean; model: string | null; provider: string | null; tools: string[]; tokens_today: number; daily_token_limit: number }

const STORE = 'nfl-dash-ask';
const loadThread = (): Msg[] => { try { return JSON.parse(localStorage.getItem(STORE) ?? '[]'); } catch { return []; } };
const saveThread = (m: Msg[]) => { try { localStorage.setItem(STORE, JSON.stringify(m.slice(-40))); } catch { /* ignore */ } };

const TOOL_LABEL: Record<string, string> = {
  search_players: 'Searched players', player_profile: 'Player profile', player_game_log: 'Game log', leaderboard: 'Leaderboard',
  hot_and_cold: 'Form movers', team_summary: 'Team summary', league_teams: 'League teams', matchups: 'Matchups',
  games: 'Games', game_detail: 'Game detail', betting_summary: 'Betting summary', semantic_search: 'Semantic search',
  describe_schema: 'Read schema', run_sql: 'SQL query', render_chart: 'Chart',
};

export function Ask({ initial }: { initial?: string }) {
  const f = useFilters();
  const status = useApi<Status>('ask/status');
  const [thread, setThread] = useState<Msg[]>(loadThread);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const sentInitial = useRef(false);
  const [tokensToday, setTokensToday] = useState<number | null>(null);

  useEffect(() => { saveThread(thread); bottom.current?.scrollIntoView({ block: 'end' }); }, [thread]);
  useEffect(() => {
    if (initial && status.data?.enabled && !sentInitial.current) {
      sentInitial.current = true;
      window.history.replaceState(null, '', href('ask'));
      void send(initial);
    }
  }, [initial, status.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchLast = (fn: (m: Msg) => Msg) => setThread((t) => [...t.slice(0, -1), fn(t[t.length - 1])]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const ctxNote = `\n\n(Dashboard context: season ${f.season}, ${f.seasonType === 3 ? 'postseason' : 'regular season'}, ${FORMAT_LABEL[f.format]} scoring — use these unless I say otherwise.)`;
    const history = [...thread, { role: 'user' as const, content: q }];
    setThread([...history, { role: 'assistant', content: '', tools: [], charts: [] }]);
    setText('');
    setBusy(true);
    abort.current = new AbortController();
    try {
      const messages = history.slice(-20).map((m, i, arr) => ({
        role: m.role, content: (i === arr.length - 1 ? m.content + ctxNote : m.content) || '(no answer)',
      }));
      const res = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal: abort.current.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          if (!block.startsWith('data: ')) continue;
          const ev = JSON.parse(block.slice(6));
          if (ev.type === 'delta') patchLast((m) => ({ ...m, content: m.content + ev.text }));
          else if (ev.type === 'tool_call') patchLast((m) => ({ ...m, tools: [...(m.tools ?? []), { id: ev.id, name: ev.name, args: ev.args, done: false }] }));
          else if (ev.type === 'tool_result') patchLast((m) => ({ ...m, tools: (m.tools ?? []).map((t) => t.id === ev.id ? { ...t, done: true, rows: ev.rows, error: ev.error, preview: ev.preview } : t) }));
          else if (ev.type === 'chart') patchLast((m) => ({ ...m, charts: [...(m.charts ?? []), ev.chart] }));
          else if (ev.type === 'error') patchLast((m) => ({ ...m, error: ev.message }));
          else if (ev.type === 'done') { patchLast((m) => ({ ...m, tokens: ev.tokens })); setTokensToday(ev.tokens_today); }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patchLast((m) => ({ ...m, error: (e as Error).message }));
      else patchLast((m) => ({ ...m, error: 'Stopped.' }));
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  if (status.data && !status.data.enabled) return <Setup />;

  const s = f.season;
  const suggestions = [
    `Who were the most consistent WRs in ${s}? Show their week-to-week volatility.`,
    `Which running backs gained the most target share in the last month of ${s}?`,
    `Which teams outperformed their point differential in ${s}, and who is due to regress?`,
    `Compare the top 3 QBs' fantasy points per game across the last three seasons with a chart.`,
    `What's the toughest defense against tight ends in ${s}, and how big is the gap to average?`,
    `How have favorites done against the spread this season, and which teams cover most often?`,
  ];

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>Ask</h1>
        <span className="muted" style={{ fontSize: 12 }}>
          {status.data ? `${status.data.provider} · ${status.data.model} · ${(tokensToday ?? status.data.tokens_today).toLocaleString()} tokens today` : ''}
          {thread.length > 0 && <> · <button className="linkbtn" onClick={() => !busy && setThread([])}>New conversation</button></>}
        </span>
      </div>
      <p className="sub">Questions in plain English, answered from your warehouse. Every number comes from a query you can inspect below the answer.</p>

      {thread.length === 0 && (
        <div className="grid g2 section">
          {suggestions.map((q) => <button key={q} className="card suggest" onClick={() => send(q)}>{q}</button>)}
        </div>
      )}

      {thread.map((m, i) => m.role === 'user'
        ? <div key={i} className="ask-user">{m.content}</div>
        : (
          <Card key={i} className="ask-answer section">
            {(m.tools?.length ?? 0) > 0 && <ToolTrace tools={m.tools!} />}
            {m.content ? <Markdown text={m.content} /> : (!m.error && <p className="muted">{busy && i === thread.length - 1 ? 'Thinking…' : ''}</p>)}
            {m.charts?.map((c, j) => <AnswerChart key={j} spec={c} />)}
            {m.error && <div className="error" style={{ marginTop: 10 }}>{m.error}</div>}
          </Card>
        ))}
      <div ref={bottom} />

      <div className="ask-box">
        <textarea value={text} rows={2} placeholder="Ask about players, teams, matchups, games, betting…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        {busy
          ? <button className="primary" onClick={() => abort.current?.abort()}>Stop</button>
          : <button className="primary" disabled={!text.trim()} onClick={() => send(text)}>Ask</button>}
      </div>
      <p className="note">Enter to send · Shift+Enter for a new line · uses the season and scoring format selected above unless you say otherwise.</p>
    </div>
  );
}

function argSummary(t: ToolRun): string {
  if (t.name === 'run_sql') return String(t.args.purpose ?? '');
  if (t.name === 'render_chart') return String(t.args.title ?? '');
  return Object.entries(t.args).filter(([, v]) => v !== undefined && typeof v !== 'object').map(([k, v]) => `${k}=${v}`).join(' · ');
}

function ToolTrace({ tools }: { tools: ToolRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="trace">
      {tools.map((t) => (
        <div key={t.id}>
          <button className="trace-row" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
            <span className={`dot ${!t.done ? 'run' : t.error ? 'err' : 'ok'}`} aria-hidden />
            <b>{TOOL_LABEL[t.name] ?? t.name}</b>
            <span className="muted">{argSummary(t)}</span>
            <span className="grow" />
            <span className="muted">{!t.done ? 'running…' : t.error ? 'error' : t.rows !== undefined ? `${t.rows} rows` : 'done'}</span>
          </button>
          {open === t.id && (
            <div className="trace-detail">
              {t.name === 'run_sql' && <pre className="md-code"><code>{String(t.args.query ?? '')}</code></pre>}
              {t.error ? <div className="down">{t.error}</div> : <Preview data={t.preview} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Preview({ data }: { data: unknown }) {
  if (Array.isArray(data)) return <RowsTable rows={data as Record<string, unknown>[]} />;
  if (data && typeof data === 'object') {
    return <>{Object.entries(data as Record<string, unknown>).map(([k, v]) => (
      <div key={k} style={{ marginBottom: 8 }}>
        <div className="muted" style={{ fontSize: 12 }}>{k}</div>
        {Array.isArray(v) ? <RowsTable rows={v as Record<string, unknown>[]} /> : v && typeof v === 'object' ? <RowsTable rows={[v as Record<string, unknown>]} /> : <span>{String(v)}</span>}
      </div>
    ))}</>;
  }
  return <span className="muted">{String(data ?? '')}</span>;
}

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <span className="muted">No rows.</span>;
  const cols = Object.keys(rows[0]).slice(0, 14);
  const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(3)) : String(v).slice(0, 80));
  return (
    <div className="scroll" style={{ maxHeight: 280 }}>
      <table className="dt"><thead><tr>{cols.map((c) => <th key={c} className="l">{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className={typeof r[c] === 'number' ? '' : 'l'}>{fmt(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {rows.length === 25 && <p className="note">First 25 rows shown.</p>}
    </div>
  );
}

function AnswerChart({ spec }: { spec: ChartSpec }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h2>{spec.title}{spec.y_label && <span className="muted" style={{ fontWeight: 400 }}> · {spec.y_label}</span>}</h2>
      {spec.type === 'line'
        ? <LineChart x={spec.x} series={spec.series.map((s, i) => ({ name: s.name, color: SERIES[i], values: s.values, dots: spec.x.length <= 20 }))} />
        : spec.series.length === 1
          ? <ColumnChart data={spec.x.map((label, i) => ({ label, value: spec.series[0].values[i] }))} showValues={spec.x.length <= 12} />
          : <GroupedColumns x={spec.x} series={spec.series} />}
    </div>
  );
}

function Setup() {
  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Ask</h1>
      <p className="sub">The assistant isn't configured yet.</p>
      <Card title="Turn it on">
        <p>Add these App Service settings (or <code>dashboard/.env</code> locally), then restart:</p>
        <pre className="md-code"><code>{`OPENAI_API_KEY=...            # OpenAI key, or your Azure OpenAI key
OPENAI_MODEL=...              # model id, or your Azure deployment name
# Azure OpenAI only:
OPENAI_BASE_URL=https://<resource>.openai.azure.com/openai/v1
# optional — enables semantic search (must match the corpus model):
OPENAI_EMBED_MODEL=text-embedding-3-small`}</code></pre>
        <p className="muted">Details: docs/14-ai-assistant.md. The key stays on the server; the browser only talks to this dashboard.</p>
      </Card>
    </div>
  );
}
