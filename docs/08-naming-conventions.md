# 08 — Naming Conventions

The rules that keep the system predictable. `tables.ts` is the enforcement
point for schema names; this doc covers everything else too.

## Database

| Thing | Rule | Examples |
|---|---|---|
| Tables | `snake_case`, plural for entities, API-verbatim column names | `players`, `player_game_stats` |
| Columns | exactly the API field name; derived columns get honest suffixes | `height` (raw) + `height_inches` (parsed) |
| Advanced stat tables | `adv_` prefix | `adv_passing_stats` |
| Snapshot tables | `_snapshots` suffix (append-only) or `_opening` | `odds_snapshots`, `prop_opening` |
| Views | `v_` prefix, domain-first | `v_player_fantasy_game`, `v_fantasy_points_allowed` |
| Procedures | `sp_` prefix | `sp_semantic_search` |
| Primary keys | API IDs verbatim; composites in grain order | `(game_id, player_id)` |
| Indexes | `IX_<table-abbrev>_<purpose>` | `IX_pgs_player_season` |
| Defaults | `DF_<table>_<col>` | `DF_games_updated` |
| Ops columns | `raw_json`, `first_seen_at`, `updated_at`, `snapshot_id`, `captured_at` — same names on every table | |

## Semantics encoded in values

| Field | Meaning |
|---|---|
| `season_type` | 1 = preseason, 2 = regular, 3 = postseason (from request context) |
| advanced `week` | 0 = full-season aggregate, 1–22 = weekly |
| `sync_state.scope` | `backfill:<phase>:<season>:<type>` or `backfill:plays:<game_id>` |
| `doc_type` / `doc_key` | `player_card` → `player_id:season`; `play` → play id; `injury` → snapshot_id |
| Fantasy columns | `fp_<format>` totals, `pts_<component>` parts |

## Files & code

| Thing | Rule | Examples |
|---|---|---|
| SQL migrations | `NNN_purpose.sql`, ordered, idempotent | `001_schema.sql`, `003_semantic.sql` |
| TS modules | one responsibility per file, lowercase | `api.ts`, `transform.ts`, `embed.ts` |
| npm scripts | verb or `verb:mode` | `backfill`, `sync:gameday` |
| CLI args | `--phase --from --to --mode --force` everywhere | |
| Env vars | `BDL_*`, `SQL_*`, `AZURE_OPENAI_*`, `BACKFILL_*` | |
| Docs | `NN-topic.md`, ordered like the build | `03-backfill-runbook.md` |

## Azure resources (suggested)

`rg-nfl-analytics` · `sql-nfl-analytics` (server) / `nfl_analytics` (db) ·
`func-nfl-ingest` · `app-nfl-dashboard` · `oai-nfl-embed` · logins
`nfl_ingest` / `nfl_readonly`.

## The one rule that overrides the rest

When the API and these conventions conflict, **the API name wins** in raw
tables (greppability against upstream docs beats aesthetics), and the
*conventional* name goes in views. Views are your naming layer.
