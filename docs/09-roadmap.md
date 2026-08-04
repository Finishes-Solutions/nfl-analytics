# 09 — Roadmap (what's next, in order)

## Now: first live contact
Provision → run SQL → backfill → probe → full load → validate leaderboards
(docs/02–03). Start game-day snapshots immediately — the props archive begins
the day you do.

## Next: trend views (002b)
Rolling 3/6-game fp vs season baseline · usage share (target/carry share from
team context) · season-over-season deltas · regression flags (Pythagorean wins,
turnover-differential reversion, one-score-game records). All views, zero
ingestion changes.

## Then: MCP server
- **Stage 1 (a day):** generic SQL MCP over the views as `nfl_readonly`, row
  limits + statement timeout. Learn your real question patterns.
- **Stage 2:** custom server with curated tools —
  `get_player_trends`, `compare_players`, `get_matchup_analysis`,
  `get_fantasy_leaders`, `semantic_search`. Curated tools beat raw text-to-SQL
  on reliability (no hallucinated joins). Same server works for Claude and
  Copilot Studio (MCP support).
- Auth: server holds the readonly credential; never expose SQL directly to a model.

## Then: dashboard
Next.js on **Azure App Service** (not Vercel, by choice). API routes with
whitelisted sort columns; v1 polls own API 10–20 s; v2 SignalR push keyed by
game. Prototype the views in Power BI first to learn which comparisons matter —
cheap insurance before UI work.

## Red zone: projections (in-house, by scope decision)
Features: trend views + `v_fantasy_points_allowed` + advanced deltas + injury
timeline. Benchmark: the archived Vegas prop lines — professional projections
with money behind them, which most hobby models never have. Start simple
(regression on trailing usage + matchup), measure vs props, iterate.

## Deliberately out of scope
League integrations (Sleeper/ESPN/Yahoo), paid projection feeds, ADP imports.
Revisit only if a concrete question needs them.
