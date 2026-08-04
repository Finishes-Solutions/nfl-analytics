# 12 — Azure Portal Click-by-Click

Every resource from `infra/provision.sh`, created by hand in the portal.
Use this if you prefer clicking or your tenant blocks CLI app management.
⚠ Portal blades get renamed periodically; names below are as of Aug 2026 —
if a label moved, the search bar at the top of the portal finds everything.

Pick one **SUFFIX** (e.g. `msin01`) and one **region** (e.g. South Central US)
and use them everywhere below. Names marked 🌐 must be globally unique.

---

## §1 Resource group

1. portal.azure.com → search **Resource groups** → **+ Create**.
2. Subscription: yours · Name: `rg-nfl-analytics` · Region: South Central US.
3. **Review + create** → **Create**.

## §2 Azure SQL (server + serverless database)

1. Search **SQL databases** → **+ Create**.
2. Basics: Resource group `rg-nfl-analytics` · Database name `nfl_analytics`.
3. Server → **Create new**: name 🌐 `sql-nfl-SUFFIX` · location = same region ·
   Authentication: **Use SQL authentication** · admin login `sqladmin` +
   strong password (record it).
4. **Compute + storage → Configure**: Service tier **General Purpose** ·
   Compute tier **Serverless** · Max vCores **2** · Min **0.5** ·
   **Auto-pause: 1 hour** · Data max size **16 GB** → Apply.
5. Networking tab: Connectivity **Public endpoint** ·
   **Allow Azure services… = Yes** · **Add current client IP = Yes**.
6. Review + create → Create (~3 min).
7. After deploy: open the database → **Query editor** (login as sqladmin) →
   run `sql/001` → `002` → `003` (→ `000` for Stage A), then the two-principal
   T-SQL from docs/02 §2. Record the `nfl_readonly` password.

## §3 App Service (MCP server)

1. Search **App Services** → **+ Create → Web App**.
2. Basics: RG `rg-nfl-analytics` · Name 🌐 `app-nfl-mcp-SUFFIX` ·
   Publish **Code** · Runtime **Node 20 LTS** · OS **Linux** · same region.
3. Pricing plan → **Create new** `asp-nfl-SUFFIX` → **Basic B1**.
4. Review + create → Create.
5. After deploy: app → **Settings → Configuration → General settings** →
   **Always On = On** → Save.
6. **Settings → Environment variables**: add every key from
   `mcp-server/.env.example` EXCEPT `AUTH_DISABLED` (values come from §2, §5,
   §6; `PUBLIC_URL` = `https://app-nfl-mcp-SUFFIX.azurewebsites.net`) → Apply.

## §4 Function App (ingestion timers) + storage

1. Search **Storage accounts** → **+ Create**: RG `rg-nfl-analytics` ·
   Name 🌐 `stnflSUFFIX` (lowercase, no dashes) · Standard LRS → Create.
2. Search **Function App** → **+ Create** → hosting **Consumption**.
3. Basics: Name 🌐 `func-nfl-ingest-SUFFIX` · Runtime **Node.js 20** ·
   OS **Linux** · same region · Storage: pick `stnflSUFFIX`.
4. Review + create → Create.
5. After deploy: **Environment variables** → add the `ingestion/.env.example`
   keys (BDL_*, SQL_* as **nfl_ingest**, AZURE_OPENAI_*).

## §5 Azure OpenAI + embedding deployment

1. Search **Azure OpenAI** → **+ Create**: RG `rg-nfl-analytics` ·
   Region: one offering `text-embedding-3-small` (South Central US does as of
   writing) · Name `oai-nfl-SUFFIX` · Pricing **Standard S0** → Create.
   (If the create is blocked, your subscription needs Azure OpenAI access —
   follow the request link on that blade.)
2. Open the resource → **Go to Azure AI Foundry portal** → **Deployments** →
   **+ Deploy model → Deploy base model** → `text-embedding-3-small` →
   deployment name exactly `text-embedding-3-small` → Standard → Deploy.
3. Back in the portal resource → **Keys and Endpoint**: record **Endpoint**
   and **Key 1**.

## §6 Entra app registration (Claude + Copilot OAuth)

1. Search **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. Name `NFL Analyst MCP` · Supported accounts: **this organizational
   directory only** · Redirect URI: platform **Web**, value
   `https://claude.ai/api/mcp/auth_callback` → **Register**.
3. Overview page: record **Application (client) ID** and **Directory (tenant) ID**.
4. **Authentication** → under Web → **Add URI** twice:
   `https://claude.com/api/mcp/auth_callback` and
   `https://global.consent.azure-apim.net/redirect` → Save.
5. **Certificates & secrets** → **+ New client secret** → 12 months → Add →
   **copy the Value column NOW** (shown once).
6. **Expose an API** → **Add** next to Application ID URI (accept
   `api://<client-id>`) → **+ Add a scope**: Scope name `mcp.access` ·
   Who can consent **Admins and users** · fill display/description fields →
   **Add scope**.
7. **Manifest** → find `"requestedAccessTokenVersion"` → set to `2` → Save.
   (Skipping this yields v1 tokens whose issuer won't match the server's check.)
8. Optional user pinning: Entra ID → **Users** → yourself → copy **Object ID**
   → put it in the MCP app's `ALLOWED_OBJECT_IDS` setting (§3.6).

## §7 Wire-up checklist

- [ ] §2.7 T-SQL done; `nfl_readonly` password set in §3.6 settings
- [ ] MCP server deployed to §3 app (mcp-server/README) → `https://…/healthz` returns `{"ok":true}`
- [ ] Ingestion deployed to §4 (docs/04) or run locally against §2 for Stages A–C
- [ ] Claude connected: URL + client ID + secret (docs/10 fill-in table)
- [ ] Copilot connected: URL + OAuth fields incl. scope `api://<client-id>/mcp.access offline_access`
- [ ] Stage-A tests green (docs/11) before any subscription money

Total hands-on time: ~45–60 minutes. The script (`infra/provision.sh`) does
§1–§6 minus the SQL scripts in about 6 minutes — this doc and the script
produce identical environments, so mixing is fine (e.g. script for
infrastructure, portal for the Entra app if CLI is blocked).
