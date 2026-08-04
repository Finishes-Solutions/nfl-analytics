# Provisioning Script Guide (infra/provision.sh)

One command creates every Azure resource the warehouse needs and prints every
value for your `.env` files and connector setups. Prefer the portal? The same
resources click-by-click: `docs/12-azure-clickthrough.md`.

## Prerequisites

1. **Azure CLI** installed (`az version` ≥ 2.60) and logged in:
   ```bash
   az login
   az account set --subscription "<your subscription name>"
   ```
2. **Bash** (macOS/Linux/WSL; on Windows use WSL or Git Bash) + `python3` on PATH.
3. Subscription notes:
   - **Azure OpenAI** access must be enabled on the subscription; the script
     tolerates failure there and tells you to create it in-portal instead.
   - You need rights to create **Entra app registrations** (any member of your
     own tenant usually can; org tenants may restrict this).

## Run it

```bash
cd infra
export SUFFIX="msin01"                       # short, unique — becomes part of global names
export SQL_ADMIN_PASSWORD='<strong password>' # 12+ chars, 3 character classes
# optional: export LOCATION="southcentralus"  (default; check OpenAI model availability)
bash provision.sh
```

Runtime: ~5–8 minutes. **Copy the summary block immediately** — the Entra
client secret is shown once and cannot be retrieved later (re-running the
script mints a new one, which is the recovery path).

## What it creates (and rough monthly cost)

| Resource | Name pattern | Cost note |
|---|---|---|
| Resource group | rg-nfl-analytics | free |
| SQL server + DB | sql-nfl-SUFFIX / nfl_analytics | serverless, auto-pause 60 min → cents–few $ idle, ~$10–25 active dev |
| App Service plan + MCP app | asp/app-nfl-mcp-SUFFIX | B1 ≈ $13/mo (Always On required for MCP) |
| Function app + storage | func-nfl-ingest-SUFFIX | consumption ≈ $0 at this volume |
| Azure OpenAI + embed deployment | oai-nfl-SUFFIX | pay-per-token; full corpus ≈ $1 one-time |
| Entra app registration | "NFL Analyst MCP" | free |

Ballpark total: **~$15–40/mo** during the build, dominated by App Service + SQL
activity. Auto-pause means an idle dev database costs almost nothing.

## What it deliberately does NOT do

- **SQL logins/users** (`nfl_ingest`, `nfl_readonly`) — T-SQL only, run per
  docs/02 step 2, then update the MCP app's `SQL_PASSWORD` setting (command is
  printed in the summary).
- **Schema/views/seed** — run `sql/000–003` yourself (docs/11 Stage A order).
- **Code deployment** — MCP server and Function timers deploy per docs/04 and
  mcp-server/README.
- **Client connections** — Claude/Copilot fill-ins are in docs/10, using the
  summary values.

## Re-running & idempotency

Safe to re-run: existing resources are updated/skipped, the Entra app is found
by display name and reused. Each run **appends a new client secret** (old ones
stay valid until expiry — prune in Entra → App registrations → Certificates &
secrets if they accumulate).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `SUFFIX` name conflict (409 / "already taken") | pick a more unique SUFFIX — SQL server, web app, storage names are global |
| OpenAI create fails | region lacks the model or subscription lacks access → create in portal (clickthrough §5), then re-run; script skips gracefully |
| `az ad app update --set api=...` permission error | your tenant restricts app management → do §6 of the clickthrough in-portal, or ask an admin |
| Firewall: can't connect from SSMS later | your IP changed → `az sql server firewall-rule create ... -n dev-client-ip-2 --start-ip-address <ip> --end-ip-address <ip>` |
| Serverless DB slow first query | auto-pause resume takes ~30–60 s; expected |

## Teardown

```bash
az group delete -n rg-nfl-analytics --yes   # everything in the group
az ad app delete --id <client-id>           # the Entra registration (outside the group)
```
