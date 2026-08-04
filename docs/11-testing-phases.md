# 11 — Testing Phases (build everything before paying)

Four stages, cheapest first. Stages A–C cost $0; the $40 GOAT subscription is
the LAST step and buys exactly one thing you can't test: sustained 600 req/min
for the full historical rip.

## Stage A — $0, no API key: the downstream stack on sample data

Goal: prove the schema, views, semantic layer, MCP server, OAuth, and agent
behavior — where all the real engineering risk lives.

1. Provision Azure SQL (docs/02) and run, in order:
   `001_schema.sql` → `002_views_fantasy.sql` → `003_semantic.sql` →
   **`000_seed_sample_data.sql`** (224 fake rows — same data as
   samples/nfl-schema-sample.xlsx, so Excel is your expected-results sheet).
2. View checks (all should return rows; cross-check numbers against the workbook):
   ```sql
   SELECT * FROM v_player_fantasy_season WHERE season=2025 ORDER BY fp_ppr_total DESC;
   SELECT * FROM v_dst_fantasy_game ORDER BY fp_dst DESC;
   SELECT * FROM v_fantasy_points_allowed WHERE season=2025 AND pos='QB';
   ```
3. MCP server locally (mcp-server/README): `AUTH_DISABLED=true`, point at the
   dev DB, `npm run dev`, then MCP Inspector → 9 tools listed →
   `search_players {"name":"jackson"}` → `get_player_gamelog` → `compare_players`.
4. Semantic layer (optional in A — needs an Azure OpenAI deployment):
   `npx tsx src/embed.ts --phase player_cards` against sample data, then the
   `semantic_search` tool ("boom bust quarterback") should return Jackson/Mahomes cards.
5. OAuth without paying anything: deploy to App Service free/basic tier, do the
   Entra registration (docs/10 build order step 1), connect Claude with the
   URL + client ID/secret, run the agent test suite on sample data.
6. Ingestion machinery offline: `npx tsx src/mock-api.ts`, then
   `BDL_BASE_URL=http://localhost:8090 BDL_API_KEY=mock npm run backfill -- --phase all --from 2024 --to 2024`
   — exercises pagination, MERGE upserts, checkpoints, and the empty-endpoint
   path with zero external calls. Verify `sync_state` shows completed scopes.

**Stage A exit criteria:** 9 tools answer correctly in Claude against sample
data; mock backfill completes; view numbers match the workbook.

## Stage B — $0, free-tier key: real API, real data (3 tables)

Free tier = teams, players, games at 5 req/min.
```bash
# .env: real BDL_API_KEY, BDL_RATE_LIMIT_PER_MIN=4
npm run backfill -- --phase teams      # seconds
npm run backfill -- --phase players    # slow crawl — run overnight
npm run backfill -- --phase games
```
⚠ This OVERWRITES sample teams/players/games rows (same IDs won't collide —
sample IDs are real-shaped; MERGE reconciles). Cleanest: re-run
`000_seed` only in a separate dev DB, or accept mixed data in dev.
**Exit criteria:** 32 real teams; real 2002–2025 games; rate limiter holds at
4/min without 429s; checkpoint resume works (kill mid-players, re-run).

## Stage C — $0, 48-hour GOAT trial: schema validation, NOT the backfill

Trial fine print (verify on their pricing page before entering a card): 48
hours, card required, **5 req/min during trial** — so the full backfill
mathematically cannot fit. Don't try. Instead, validate every transform:

```bash
# one season, every gated endpoint — ~100 requests, ~25 min at 5/min
npm run backfill -- --phase player_stats --from 2024 --to 2024
npm run backfill -- --phase team_stats --from 2024 --to 2024
npm run backfill -- --phase season_stats --from 2024 --to 2024
npm run backfill -- --phase team_season_stats --from 2024 --to 2024
npm run backfill -- --phase standings --from 2024 --to 2024
npm run backfill -- --phase advanced --from 2024 --to 2024   # let it run partially
npm run backfill -- --phase injuries
npm run backfill -- --phase rosters
npm run probe        # the real coverage answer — save coverage_map output!
```
Then the diff that kills the #1 project risk (field-shape surprises):
```sql
-- any real field your typed columns missed shows up here
SELECT TOP 5 raw_json FROM player_game_stats WHERE season=2024;
SELECT TOP 3 raw_json FROM team_season_stats WHERE season=2024;
-- acceptance: does the leaderboard look like reality?
SELECT TOP 15 * FROM v_player_fantasy_season WHERE season=2024 AND season_type=2 ORDER BY fp_ppr_total DESC;
```
Fix any transform gaps (edit tables.ts → regen DDL → ALTER TABLE ADD for new
columns → patch transform.ts) while it's still free.
**Exit criteria:** 2024 fantasy leaderboard matches reality; coverage_map
recorded; zero unmapped fields you care about.

## Stage D — $40/mo: the full rip

Subscribe → `BDL_RATE_LIMIT_PER_MIN=550` → `npm run backfill -- --phase all`
(1–2 h) → re-run the Stage-C validation queries across multiple seasons →
start `sync:gameday` immediately (the props archive begins now) → deploy the
Function timers (docs/04). Month one is an evaluation of a working system,
not a bet.

## Component test matrix (quick reference)

| Component | Test | Stage |
|---|---|---|
| Schema/DDL | 001–003 run idempotently twice | A |
| Fantasy views | numbers match sample workbook | A |
| MCP tools | Inspector: 9 tools, happy + not-found paths | A |
| OAuth | Claude connect via client ID/secret; 401 without token; 403 non-allowlisted user | A |
| Agent | 10-prompt suite in docs/10 (esp. invented-stats hunt) | A, repeat D |
| Ingestion mechanics | mock-api full run; checkpoint kill/resume | A |
| Rate limiter | free tier at 4/min, zero 429s | B |
| Transforms | raw_json diff + real leaderboard | C |
| Coverage | probe output saved | C |
| Full pipeline + live | full backfill, gameday cycle during a real game | D |
