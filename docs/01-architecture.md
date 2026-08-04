# 01 — Architecture

Open `system-play-sheet-v2.html` for the visual version. This is the prose version.

## Layers

```
BALLDONTLIE API  (only external dependency, GOAT tier, 600 req/min)
      │  yellow / write path
      ▼
INGESTION        Azure Functions (TypeScript) · one rate-limited client · 3 tempos
      ▼
LAYER 1: RAW     Azure SQL · 20 tables · every field typed + raw_json verbatim
      ▼  green / computed
LAYER 2: VIEWS   fantasy scoring · (next: trends, usage, regression flags)
      +
SEMANTIC         semantic_documents (native VECTOR) · sp_semantic_search
      │  blue / read path (nfl_readonly, DENY writes)
      ▼
CONSUMERS        MCP server (Claude / Copilot Studio) · Next.js dashboard (App Service)
```

## The three tempos

| Tempo | Trigger | Scope | Cost |
|---|---|---|---|
| Backfill | manual, once | 2002→now, all endpoints, all season types | ~1–2 h at 550/min |
| Nightly | timer | current season refresh + injury/roster snapshots | a few hundred req |
| Game day | 1–15 min | live-window games only (started <6h / starting <1h) | ~68 req per 9-game cycle |

## Non-negotiable rules

1. **Consumers read SQL, never the API.** A thousand dashboard tabs cost zero requests.
2. **Idempotent writes.** Keyed tables MERGE on API IDs; snapshots append with `captured_at`. Overlapping runs are safe.
3. **season_type is request context.** Payloads only carry `postseason`; 1/2/3 is stamped by the fetcher. Plays REQUIRE season_type=3 for playoff games.
4. **raw_json everywhere.** The upstream OpenAPI spec is stale; verbatim capture means schema gaps are patchable after the fact, never fatal.
5. **Snapshots are the moat.** Injuries, rosters, odds, and props are deleted upstream. The archive you build cannot be rebuilt by anyone who starts later.

## Live-data flow (dashboard)

Ingestion (gameday) → SQL → dashboard API (parameterized, whitelisted sort columns) → browser.
v1: client polls your API every 10–20 s. v2: ingestion publishes "game N updated" to Azure SignalR; clients refetch only that slice. Upstream refresh latency is the true floor — measure changed-row rate before tightening cadence.

## Identity & access

| Principal | Rights | Used by |
|---|---|---|
| nfl_ingest | db_datareader + db_datawriter | ingestion functions only |
| nfl_readonly | db_datareader, DENY INSERT/UPDATE/DELETE/EXECUTE* | MCP server, dashboard API |

\* Grant EXECUTE only on `sp_semantic_search` for the MCP user.
