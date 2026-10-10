# 13 — Dashboard, SQL access, and scheduled sync

Three things added in October 2026:

1. **Analytics views** (`sql/004_analytics_views.sql`): trends, usage share, team efficiency,
   betting results, and data health.
2. **The dashboard** (`dashboard/`): a single-user, desktop-first analytics app on its own App Service.
3. **Operations workflows**: run SQL against the warehouse from GitHub Actions, and an
   opt-in scheduled sync.

## 1. Analytics views (004)

| View | Grain | Answers |
|---|---|---|
| `v_game_results` | team / game | W/L/T, margin, opponent, home/away |
| `v_player_game_context` | player / game | game log with opponent and result, target/carry share, rolling 3/6-game and season-to-date averages in all three formats |
| `v_player_usage_season` | player / season | targets, carries, shares, catch rate, yards per target/carry, PPR per opportunity |
| `v_player_form` | player / season | last-3 vs season average: who is heating up or cooling off |
| `v_player_season_yoy` | player / season | change in points per game vs the previous season played |
| `v_team_game_efficiency` | team / game | offense from the team's row, defense from the opponent's row |
| `v_team_season_summary` | team / season | record, Pythagorean expected wins, luck, one-score record, YPP both ways, 3rd down, red zone, turnover differential, points per drive |
| `v_game_lines` | game / book | opening vs closing spread and total, move, ATS and over/under result |
| `v_game_lines_consensus` | game | the same, averaged across books |
| `v_prop_results` | prop / game | closing prop line vs actual stat (over/under/push, hit/miss) |
| `v_dh_season_coverage` | season | % of final games with box scores, team stats, plays, odds |
| `v_dh_season_stats_reconciliation` | season | how far `player_season_stats` disagrees with summed game logs |
| `v_dh_table_freshness` | table | row count and newest write |

All are `CREATE OR ALTER`, so re-running the file is safe. `002` also changed:
`v_fantasy_points_allowed` now has standard and half-PPR columns, and rows with an
unknown `team_id` are excluded instead of being credited to the home defense.

**Prop mapping is unverified against live data.** `v_prop_results` maps the prop types
seen in the sample data. Any other type shows `outcome = 'unmapped'`. The Data health page
and `sql/checks/data_health.sql` list every captured type, so extend the `CASE` when one
appears.

## 2. Dashboard

```
dashboard/
├── server/   Express API (read-only, parameterized, allowlisted sorts) + static hosting
│   ├── routes.ts   every endpoint; reads only views/tables
│   ├── auth.ts     App Service Authentication gate + email allowlist
│   └── db.ts       pool with serverless-resume retry + small TTL cache
├── src/      React SPA (hash routing, hand-built SVG charts, light/dark)
└── test/     endpoint + auth tests (run against a dev DB)
```

Pages: Overview · Players (sortable leaderboard with usage) · Player (weekly chart, game
log, career, Next Gen Stats, injuries, props) · Teams (efficiency scatter, luck) · Team ·
Matchups (heatmap of points allowed by defense × position) · Games · Game (win probability,
box score, line movement, scoring plays) · Betting (ATS, line moves, props) · Data health.

The global filters (season, regular/postseason, scoring format) apply to every page and are
remembered in the browser.

### Run locally

```bash
# SQL Server in Docker, loaded with synthetic data (no Azure needed)
docker run -d --name mssql -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='Local_Dev_Pass1!' -p 1433:1433 \
  mcr.microsoft.com/mssql/server:2022-latest
cd ingestion && npm ci
export SQL_SERVER=localhost SQL_USER=sa SQL_PASSWORD='Local_Dev_Pass1!' SQL_TRUST_CERT=true
echo "CREATE DATABASE nfl_dev" > /tmp/c.sql && SQL_DATABASE=master npx tsx src/run-sql.ts apply /tmp/c.sql
export SQL_DATABASE=nfl_dev
npx tsx src/run-sql.ts apply ../sql/001_schema.sql ../sql/002_views_fantasy.sql ../sql/004_analytics_views.sql
python3 ../tools/gen_dev_data.py > /tmp/dev.sql && npx tsx src/run-sql.ts apply /tmp/dev.sql

cd ../dashboard && npm ci
AUTH_DISABLED=true npm run dev        # API :8081 + Vite :5173 → open http://localhost:5173
```

`gen_dev_data.py` writes four seasons of **made-up** data (invented players, real team
names). It refuses to run unless the database name ends in `_dev`.

### Deploy (Azure App Service)

1. Create a **Linux App Service, Node 22**, on the same plan as the MCP server or a B1.
   The startup command is the default (`npm start`).
2. **App settings:** `SQL_SERVER`, `SQL_DATABASE`, `SQL_USER=nfl_readonly`, `SQL_PASSWORD`,
   `ALLOWED_EMAILS=<your sign-in email>`. Leave `AUTH_DISABLED` unset.
3. **Authentication → Add identity provider → Microsoft.** Pick "Require authentication"
   and "HTTP 302 redirect". This is the only login the app has. The server returns
   503 unless App Service sets `WEBSITE_AUTH_ENABLED`, so a forged
   `X-MS-CLIENT-PRINCIPAL-NAME` header can't get in if auth is ever switched off.
4. **GitHub:** set repo variable `DASHBOARD_APP_NAME` and secret
   `AZURE_DASHBOARD_PUBLISH_PROFILE` (App Service → Overview → Download publish profile).
   `Deploy dashboard` then runs on every push to `main` that touches `dashboard/`. It is
   skipped until the variable exists.
5. **Networking:** the dashboard connects to SQL the same way the MCP server does, so
   "Allow Azure services" on the SQL server is enough.

A purely static host (Static Web Apps without an API, or blob storage) isn't enough. The
browser can't talk to SQL, so something has to run `server/`. One App Service hosting both
the API and the built SPA is the simplest option.

## 3. Giving Claude SQL access (`SQL (apply / check)` workflow)

This avoids pasting credentials into a chat or opening the firewall to the world. The
workflow runs in GitHub Actions with your secrets. It opens a firewall rule for the
runner's IP only, runs `.sql` files from the repo, and **always** deletes the rule. Claude
triggers it and reads the job log. Nothing leaves GitHub except what the queries print.

- `action=check` runs files under `sql/checks/` as the **read-only** login.
  `data_health.sql` is the full warehouse report.
- `action=apply` runs files under `sql/` (schema and views) as the **admin** login.
  `000_seed_*` is refused.

One-time setup (GitHub → Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| Variable | `AZURE_SQL_RESOURCE_GROUP` | resource group of the SQL server |
| Variable | `AZURE_SQL_SERVER_NAME` | server name **without** `.database.windows.net` |
| Variable | `AZURE_SQL_DATABASE` | database name |
| Secret | `SQL_READONLY_USER` / `SQL_READONLY_PASSWORD` | `nfl_readonly` login |
| Secret | `SQL_ADMIN_USER` / `SQL_ADMIN_PASSWORD` | server admin (or a `db_ddladmin` login) |

Azure login reuses the App Service deploy's service principal (the
`AZUREAPPSERVICE_*` secrets that already exist) unless you add `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`. **That principal needs permission to edit
the SQL server's firewall.** In the portal, open the SQL **server** → Access control (IAM)
→ Add role assignment → **SQL Server Contributor** → assign it to the same app
registration the deploy workflow uses.

The first run Claude does after setup: `check` with `sql/checks/data_health.sql`, then
`apply` with `sql/002_views_fantasy.sql sql/004_analytics_views.sql`, then `check` with
`sql/checks/analytics_smoke.sql`.

## 4. Scheduled sync (`Warehouse sync` workflow, opt-in)

If ingestion isn't running anywhere yet, this workflow runs it from GitHub:

- nightly at 09:17 UTC (`sync.ts --mode nightly`)
- every 15 minutes during Thursday, Sunday and Monday game windows (`--mode gameday`)

To turn it on, add secrets `BDL_API_KEY`, `SQL_INGEST_USER` and `SQL_INGEST_PASSWORD`
(the `nfl_ingest` login), plus the three `AZURE_SQL_*` variables above. Then set
variable `ENABLE_SCHEDULED_SYNC=true`. It does nothing until that variable is set, so it
can't double-write next to an Azure Functions deployment.

Caveats: GitHub cron is best-effort (runs can start several minutes late), and GitHub
pauses scheduled workflows after 60 days without repository activity. For the props and
odds archive, a 15-minute cadence with some jitter is fine, because snapshots now store
only changed lines. For guaranteed timing, use the Azure Functions route in docs/04.
