# 02 — Setup Guide (zero → first query)

## 1. Provision Azure SQL

- **Azure SQL Database**, General Purpose **Serverless** (auto-pause is fine pre-launch), 2 vCores, ~10 GB max size. The full dataset is single-digit GB.
- Networking: allow your IP + "Allow Azure services" (for Functions later).
- Native VECTOR support is GA — nothing to enable for the semantic layer.

## 2. Create principals

In `master`:
```sql
CREATE LOGIN nfl_ingest   WITH PASSWORD = '<strong>';
CREATE LOGIN nfl_readonly WITH PASSWORD = '<strong>';
```
In the app database:
```sql
CREATE USER nfl_ingest FOR LOGIN nfl_ingest;
ALTER ROLE db_datareader ADD MEMBER nfl_ingest;
ALTER ROLE db_datawriter ADD MEMBER nfl_ingest;

CREATE USER nfl_readonly FOR LOGIN nfl_readonly;
ALTER ROLE db_datareader ADD MEMBER nfl_readonly;
DENY INSERT, UPDATE, DELETE TO nfl_readonly;
GRANT EXECUTE ON dbo.sp_semantic_search TO nfl_readonly;  -- after 003
```

## 3. Run the SQL, in order

`sql/001_schema.sql` → `sql/002_views_fantasy.sql` → `sql/003_semantic.sql`
All idempotent; re-running is safe. (Views will exist but return nothing until backfill.)

## 4. Configure ingestion

```bash
cd ingestion
npm install
cp .env.example .env
```
Fill in: `BDL_API_KEY` (GOAT), `SQL_SERVER/DATABASE/USER/PASSWORD` (nfl_ingest), and later `AZURE_OPENAI_*` for embeddings. Keep `BDL_RATE_LIMIT_PER_MIN=550` — headroom under the 600 cap matters when a game-day job overlaps a manual run.

## 5. Smoke test

```bash
npm run backfill -- --phase teams     # 1 request, 32 rows
```
`SELECT * FROM dbo.teams;` — 32 rows means API auth, SQL auth, and the MERGE path all work.

## 6. Continue to the backfill runbook (docs/03)

## Azure OpenAI (for the semantic layer, can wait)

- Create an Azure OpenAI resource, deploy `text-embedding-3-small` (1536 dims).
- Full corpus embed cost is on the order of **a dollar**, not a budget item.
