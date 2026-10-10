# 14 — AI assistant (Ask page)

Plain-English questions answered from the warehouse: "Who were the most consistent WRs
in 2025?", "Is this team's record sustainable?", "Compare these three QBs over three
seasons with a chart."

## How it works

```
Browser (Ask page) ──POST /api/ask──▶ dashboard server ──Responses API──▶ OpenAI / Azure OpenAI
       ▲   Server-Sent Events: text,        │  tool loop (≤ 8 rounds)
       │   tool calls/results, charts       ▼
       └──────────────────────────── read-only SQL (same pool as the dashboard)
```

- The **OpenAI key never reaches the browser.** The page only talks to the dashboard
  server, which sits behind App Service Authentication like every other endpoint.
- The model can't touch the database directly. It calls **tools** that the server runs:

| Tool | What it does |
|---|---|
| `search_players`, `player_profile`, `player_game_log` | find players, their career, and week-by-week games with usage and rolling form |
| `leaderboard`, `hot_and_cold` | ranked lists by points, consistency, target/carry share, efficiency, YoY change; form movers |
| `team_summary`, `league_teams`, `matchups` | team records, luck and efficiency; points allowed by position |
| `games`, `game_detail`, `betting_summary` | schedules and results with lines; one game in depth; ATS and props results |
| `semantic_search` | similarity search over plays, player cards, injuries and game recaps (only when `OPENAI_EMBED_MODEL` is set) |
| `describe_schema`, `run_sql` | custom analysis: one read-only `SELECT` over the `v_*` views and allowed tables, at most 500 rows, 20 s timeout |
| `render_chart` | adds a line or bar chart (up to 4 series) under the answer |

- **Every tool call is shown under the answer.** It's collapsible and includes the SQL and
  the returned rows, so you can check any number. The instructions tell the model that
  every number must come from a tool result.
- Each question carries the dashboard's season, season type and scoring format unless
  you say otherwise. The "✦ Ask about…" buttons on Player, Team and Game pages open
  the Ask page with a pre-written question.
- The conversation is kept in this browser (localStorage, last 40 messages). The server
  is stateless between questions.

## Turn it on

App Service → Settings → Environment variables (or `dashboard/.env` locally):

| Setting | OpenAI | Azure OpenAI |
|---|---|---|
| `OPENAI_API_KEY` | your API key | the resource key |
| `OPENAI_MODEL` | a model id | your **deployment name** |
| `OPENAI_BASE_URL` | leave unset | `https://<resource>.openai.azure.com/openai/v1` |
| `OPENAI_EMBED_MODEL` (optional) | `text-embedding-3-small` | your embedding deployment name |

Optional settings: `OPENAI_REASONING_EFFORT` (`low`/`medium`/`high`, reasoning models
only), `ASSISTANT_DAILY_TOKEN_LIMIT` (default 2,000,000; requests are refused with 429
once reached), and `ASSISTANT_MAX_TOOL_ROUNDS` (default 8).

**Azure is the natural fit here.** You already run Azure OpenAI for the embeddings, so
the key, billing and data stay in your tenant. Deploy a chat model next to
`text-embedding-3-small` and point the three settings at it.

**Choosing a model.** It needs function calling through the **Responses API**. Use a
current general model, not a "mini" tier, for `run_sql` work: writing correct SQL over
these views is the hardest thing the assistant does. The model id is deliberately not
hard-coded. Model names change faster than this repo, so set whatever your account
lists today.

**Semantic search** also needs `sql/003_semantic.sql` applied, the corpus embedded
(`cd ingestion && npx tsx src/embed.ts --phase all`) with the **same** embedding model,
and `GRANT EXECUTE ON dbo.sp_semantic_search TO nfl_readonly`.

## Safety and cost

- **The database login is the real guard.** The dashboard must use `nfl_readonly`.
  `run_sql` also passes through `server/assistant/sqlguard.ts`, which accepts only a
  single `SELECT`/`WITH` over `dbo.v_*` and an allowlist of tables. It rejects writes,
  `INTO`, `EXEC`, `OPENROWSET`, `WAITFOR`, system catalogs and multiple statements. A row
  cap (`SET ROWCOUNT 500`) and a 20 s cancel come on top of that.
- **What leaves your tenant:** the question, the instructions, and the tool results (rows
  of NFL statistics). Nothing else. Tool loops chain calls with `previous_response_id`,
  so the provider keeps response state under its normal retention policy. With Azure
  OpenAI, that state stays in your Azure resource.
- **Cost:** a typical question takes 2–4 model calls. Usage is counted per day (in
  memory, so it resets on restart) and shown on the page. The daily limit is a hard stop.

## What's tested, and what isn't

- `test/sqlguard.test.ts` covers the guard's allow and deny cases.
- `test/assistant.test.ts` runs the real `/api/ask` loop against a **mock** Responses API
  server: parallel tool calls, `run_sql`, the chart event, streamed text, the request
  format sent to the model, and destructive SQL being refused. It also runs every
  curated tool, with every leaderboard sort, against the dev database.
- **Not yet verified against live OpenAI or Azure OpenAI.** The wire format follows the
  documented Responses API: `response.output_text.delta`, `response.completed`,
  `function_call` / `function_call_output` items and `previous_response_id`. If the
  first real call shows a mismatch, the fix is contained in `server/assistant/llm.ts`.

## Ideas for next

- A **weekly briefing**: a scheduled job that asks a fixed set of questions after the
  nightly sync and saves the answers to a table the Overview page shows.
- **Saved answers**: pin an answer and its charts and re-run it after new data arrives.
- An **evaluation set**: 20–30 questions with known answers, run against the real model
  whenever the instructions or tools change, to catch regressions (invented numbers,
  wrong season or format).
- **Natural-language filters** on the Players page ("WRs with 25%+ target share and
  under 10 PPR/game").
