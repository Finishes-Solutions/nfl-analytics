# NFL Analytics Warehouse

Full-capture BALLDONTLIE NFL → Azure SQL pipeline with a fantasy scoring layer,
a semantic vector layer, and a clear path to MCP (Claude / Copilot) and a live
dashboard. Historical backfill to 2002, nightly sync, game-day snapshot mode.

**Design principle #1: consumers never touch the API.** Ingestion is the only
component that calls BALLDONTLIE; everything else — MCP, dashboards, Copilot —
reads Azure SQL. Freshness is decoupled from the rate limit entirely.

## Package Map

```
├── README.md                     ← you are here
├── docs/
│   ├── 01-architecture.md        System design, layers, data flows
│   ├── 02-setup-guide.md         Azure provisioning → first query, step by step
│   ├── 03-backfill-runbook.md    The 2002→now historical load, exact commands
│   ├── 04-sync-operations.md     Nightly + game-day operations, deployment
│   ├── 05-schema-reference.md    Every table, every column (generated)
│   ├── 06-fantasy-scoring.md     Scoring rules, views, known gaps
│   ├── 07-semantic-layer.md      Vector search: what to embed, how to query
│   ├── 08-naming-conventions.md  Naming rules for everything in the system
│   ├── 09-roadmap.md             MCP server + dashboard phases
│   ├── 10-copilot-agent.md       Claude + Copilot agents: tools, instructions, guardrails
│   ├── 11-testing-phases.md      Build & test everything BEFORE the $40 subscription
│   ├── 12-azure-clickthrough.md  Azure portal setup, click by click
│   ├── system-play-sheet-v2.html Visual architecture (open in a browser)
│   └── system-play-sheet.html    v1, kept as design changelog
├── sql/
│   ├── 000_seed_sample_data.sql  Stage-A fake data (matches the Excel workbook)
│   ├── 001_schema.sql            20 tables + indexes + read-only user template
│   ├── 002_views_fantasy.sql     5 fantasy views (3 formats, DST, matchups)
│   └── 003_semantic.sql          Vector documents table + search procedure
├── ingestion/                    TypeScript · Node 20+ · mssql
│   └── src/
│       ├── tables.ts             ★ SINGLE SOURCE OF TRUTH for the schema
│       ├── generate-ddl.ts       tables.ts → sql/001_schema.sql
│       ├── api.ts                Rate-limited client (550/min), retries, pagination
│       ├── db.ts                 OPENJSON MERGE upserts + append-only inserts
│       ├── transform.ts          API payload → flat row mappers (+ raw_json)
│       ├── probe.ts              Coverage probe (run before bulk backfill)
│       ├── backfill.ts           Resumable historical load, 15 phases
│       ├── sync.ts               --mode nightly | gameday
│       ├── embed.ts              Semantic layer: player cards, plays, injuries
│       └── mock-api.ts           Offline BALLDONTLIE stub for pipeline testing
├── mcp-server/                   9-tool MCP server · Streamable HTTP · Entra OAuth
│   └── src/ index.ts · tools.ts · config.ts   (works for Claude AND Copilot)
├── samples/
│   ├── nfl-schema-sample.xlsx    Every table as a sortable tab, fake data
│   └── dashboard-preview.html    Sample dashboard interface (sortable, in-browser)
├── infra/
│   ├── provision.sh              One-shot Azure provisioning (az CLI)
│   └── README.md                 How to run it, costs, troubleshooting, teardown
└── tools/
    └── gen_schema_doc.py         Regenerates docs/05 from table specs
```

## Quickstart (details in docs/02)

```bash
# 1. Azure SQL provisioned → run sql/001_schema.sql, then 002, then 003
# 2. Configure
cd ingestion && npm install && cp .env.example .env   # fill in keys
# 3. Load history (order matters)
npm run backfill -- --phase teams
npm run backfill -- --phase players
npm run backfill -- --phase games
npm run probe                       # review dbo.coverage_map before continuing
npm run backfill -- --phase all
# 4. Keep current
npm run sync:nightly                # daily timer
npm run sync:gameday                # every 1–15 min in game windows
# 5. Semantic layer (needs Azure OpenAI embedding deployment)
npx tsx src/embed.ts --phase all
```

## Current Status

| Piece | State |
|---|---|
| Schema (20 tables) + DDL generation | ✅ Built, typechecked |
| Ingestion: backfill / nightly / game-day | ✅ Built, **not yet run against live API** |
| Fantasy views (3 formats, DST, matchups) | ✅ Built |
| Semantic layer (vector table, proc, embedder) | ✅ Built |
| MCP server (9 tools, OAuth, dual-client) | ✅ Built, typechecked |
| Stage-A test kit (seed SQL, mock API, dashboard preview) | ✅ Built |
| Azure provisioning (script + clickthrough guide) | ✅ Built — infra/provision.sh or docs/12 |
| Run provisioning + staged testing | ⬜ Next — **start at docs/11**, provision via infra/ |
| Trend views · production dashboard | ⬜ Roadmap — see docs/09 |

## Honest Caveats (read before first run)

1. **Nothing here has touched the live API yet.** Code compiles clean and the
   logic mirrors the documented API, but expect a field-shape surprise or two
   on first contact. `raw_json` on every row means nothing is lost while you
   patch a column.
2. **Historical depth is unverified** until `probe.ts` writes `coverage_map`.
   Advanced stats can't predate player tracking (~2016); plays and team stats
   likely have their own floors. The backfill respects the probe, not hope.
3. **Player props are unrecoverable upstream** — every game-day cycle you skip
   is archive lost forever. Start the snapshot job before you care.
4. **Fantasy scoring is ~95% fidelity** (flat FG distance, no 2-pt conversions,
   no DST safeties/blocks) — gaps documented in `002_views_fantasy.sql` and
   recoverable later from `plays.text`.
5. **The upstream OpenAPI spec is stale**; this schema is the union of spec +
   docs examples, with raw capture as the safety net.
