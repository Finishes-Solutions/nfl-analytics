#!/usr/bin/env bash
# =============================================================================
# provision.sh — one-shot Azure provisioning for the NFL Analytics Warehouse.
# Creates: resource group, Azure SQL (serverless), App Service (MCP server),
# Function App (ingestion), Azure OpenAI + embedding deployment, and the Entra
# app registration (Claude + Copilot OAuth). Prints every value your .env
# files and connector setups need, plus the T-SQL you must run yourself.
#
# Usage guide: infra/README.md   ·   Portal alternative: docs/12-azure-clickthrough.md
#
# Idempotent-ish: safe to re-run; `az ... create` calls update-or-skip existing
# resources. The Entra secret is NEW on every run (old ones stay valid).
# =============================================================================
set -euo pipefail

# ---- EDIT THESE ------------------------------------------------------------
LOCATION="${LOCATION:-southcentralus}"        # Texas-adjacent; OpenAI availability is region-dependent
SUFFIX="${SUFFIX:-}"                          # REQUIRED: short unique string, e.g. "msin01" (global name uniqueness)
SQL_ADMIN_USER="${SQL_ADMIN_USER:-sqladmin}"
SQL_ADMIN_PASSWORD="${SQL_ADMIN_PASSWORD:-}"  # REQUIRED: strong password, exported before running
# ----------------------------------------------------------------------------

[[ -z "$SUFFIX" ]] && { echo "ERROR: export SUFFIX=<short-unique-string> first (e.g. your initials + 2 digits)"; exit 1; }
[[ -z "$SQL_ADMIN_PASSWORD" ]] && { echo "ERROR: export SQL_ADMIN_PASSWORD='<strong password>' first"; exit 1; }

RG="rg-nfl-analytics"
SQL_SERVER="sql-nfl-${SUFFIX}"                # global-unique
SQL_DB="nfl_analytics"
PLAN="asp-nfl-${SUFFIX}"
MCP_APP="app-nfl-mcp-${SUFFIX}"               # global-unique → https://${MCP_APP}.azurewebsites.net
FUNC_APP="func-nfl-ingest-${SUFFIX}"          # global-unique
STORAGE="stnfl${SUFFIX}"                      # lowercase alphanumeric only, 3-24 chars
OPENAI="oai-nfl-${SUFFIX}"
EMBED_DEPLOYMENT="text-embedding-3-small"
ENTRA_APP_NAME="NFL Analyst MCP"

echo "== Provisioning to resource group $RG in $LOCATION (suffix: $SUFFIX) =="
az account show --query "{subscription:name, tenant:tenantId}" -o table

# ---- 1. Resource group ------------------------------------------------------
az group create -n "$RG" -l "$LOCATION" -o none
echo "[1/7] resource group ready"

# ---- 2. Azure SQL: server + serverless DB + firewall ------------------------
az sql server create -g "$RG" -n "$SQL_SERVER" -l "$LOCATION" \
  --admin-user "$SQL_ADMIN_USER" --admin-password "$SQL_ADMIN_PASSWORD" -o none
az sql db create -g "$RG" -s "$SQL_SERVER" -n "$SQL_DB" \
  --edition GeneralPurpose --family Gen5 --capacity 2 \
  --compute-model Serverless --auto-pause-delay 60 --max-size 16GB -o none
# Allow Azure services (Functions/App Service) + your current IP
az sql server firewall-rule create -g "$RG" -s "$SQL_SERVER" -n AllowAzureServices \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none
MYIP="$(curl -s https://ifconfig.me || true)"
[[ -n "$MYIP" ]] && az sql server firewall-rule create -g "$RG" -s "$SQL_SERVER" -n dev-client-ip \
  --start-ip-address "$MYIP" --end-ip-address "$MYIP" -o none
echo "[2/7] SQL ready: ${SQL_SERVER}.database.windows.net / $SQL_DB (serverless, auto-pause 60m)"

# ---- 3. App Service plan + MCP web app -------------------------------------
az appservice plan create -g "$RG" -n "$PLAN" --sku B1 --is-linux -o none
az webapp create -g "$RG" -p "$PLAN" -n "$MCP_APP" --runtime "NODE:20-lts" -o none
az webapp config set -g "$RG" -n "$MCP_APP" --always-on true -o none
echo "[3/7] MCP app ready: https://${MCP_APP}.azurewebsites.net"

# ---- 4. Storage + Function App (ingestion timers) ---------------------------
az storage account create -g "$RG" -n "$STORAGE" -l "$LOCATION" --sku Standard_LRS -o none
az functionapp create -g "$RG" -n "$FUNC_APP" -s "$STORAGE" \
  --consumption-plan-location "$LOCATION" --runtime node --runtime-version 20 \
  --functions-version 4 --os-type Linux -o none
echo "[4/7] Function app ready: $FUNC_APP (consumption)"

# ---- 5. Azure OpenAI + embedding deployment ---------------------------------
# NOTE: subscription must have Azure OpenAI access; model availability varies by region.
az cognitiveservices account create -g "$RG" -n "$OPENAI" -l "$LOCATION" \
  --kind OpenAI --sku S0 --custom-domain "$OPENAI" -o none || \
  echo "  ! OpenAI account create failed — check regional availability/quota, or create in-portal and re-run"
az cognitiveservices account deployment create -g "$RG" -n "$OPENAI" \
  --deployment-name "$EMBED_DEPLOYMENT" --model-name text-embedding-3-small \
  --model-version "1" --model-format OpenAI --sku-name Standard --sku-capacity 50 -o none || \
  echo "  ! Embedding deployment failed — deploy '$EMBED_DEPLOYMENT' in Azure AI Foundry portal instead"
OPENAI_ENDPOINT="$(az cognitiveservices account show -g "$RG" -n "$OPENAI" --query properties.endpoint -o tsv 2>/dev/null || echo '<create manually>')"
OPENAI_KEY="$(az cognitiveservices account keys list -g "$RG" -n "$OPENAI" --query key1 -o tsv 2>/dev/null || echo '<create manually>')"
echo "[5/7] Azure OpenAI: $OPENAI_ENDPOINT"

# ---- 6. Entra app registration (Claude + Copilot OAuth) ---------------------
TENANT_ID="$(az account show --query tenantId -o tsv)"
APP_ID="$(az ad app list --display-name "$ENTRA_APP_NAME" --query "[0].appId" -o tsv)"
if [[ -z "$APP_ID" || "$APP_ID" == "null" ]]; then
  APP_ID="$(az ad app create --display-name "$ENTRA_APP_NAME" \
    --sign-in-audience AzureADMyOrg \
    --web-redirect-uris \
      "https://claude.ai/api/mcp/auth_callback" \
      "https://claude.com/api/mcp/auth_callback" \
      "https://global.consent.azure-apim.net/redirect" \
    --query appId -o tsv)"
fi
az ad app update --id "$APP_ID" --identifier-uris "api://${APP_ID}" -o none
# Expose the mcp.access scope (v2 tokens)
SCOPE_ID="$(python3 - <<'PY'
import uuid; print(uuid.uuid4())
PY
)"
EXISTING_SCOPES="$(az ad app show --id "$APP_ID" --query "api.oauth2PermissionScopes | length(@)" -o tsv)"
if [[ "$EXISTING_SCOPES" == "0" ]]; then
  az ad app update --id "$APP_ID" --set api="{
    \"requestedAccessTokenVersion\": 2,
    \"oauth2PermissionScopes\": [{
      \"id\": \"${SCOPE_ID}\",
      \"value\": \"mcp.access\",
      \"type\": \"User\",
      \"isEnabled\": true,
      \"adminConsentDisplayName\": \"Access NFL Analyst MCP\",
      \"adminConsentDescription\": \"Allows calling the NFL Analyst MCP server\",
      \"userConsentDisplayName\": \"Access NFL Analyst MCP\",
      \"userConsentDescription\": \"Allows calling the NFL Analyst MCP server\"
    }]}" -o none
fi
CLIENT_SECRET="$(az ad app credential reset --id "$APP_ID" --append \
  --display-name "mcp-$(date +%Y%m%d)" --years 1 --query password -o tsv)"
MY_OID="$(az ad signed-in-user show --query id -o tsv 2>/dev/null || echo '')"
echo "[6/7] Entra app ready: $APP_ID"

# ---- 7. Push MCP app settings ----------------------------------------------
az webapp config appsettings set -g "$RG" -n "$MCP_APP" -o none --settings \
  PUBLIC_URL="https://${MCP_APP}.azurewebsites.net" \
  ENTRA_TENANT_ID="$TENANT_ID" \
  ENTRA_AUDIENCE="api://${APP_ID}" \
  ALLOWED_OBJECT_IDS="$MY_OID" \
  SQL_SERVER="${SQL_SERVER}.database.windows.net" \
  SQL_DATABASE="$SQL_DB" \
  SQL_USER="nfl_readonly" \
  SQL_PASSWORD="SET-ME-AFTER-CREATING-LOGIN" \
  AZURE_OPENAI_ENDPOINT="$OPENAI_ENDPOINT" \
  AZURE_OPENAI_KEY="$OPENAI_KEY" \
  AZURE_OPENAI_EMBED_DEPLOYMENT="$EMBED_DEPLOYMENT"
echo "[7/7] MCP app settings pushed (SQL_PASSWORD placeholder — fix after step B below)"

# ---- Summary ----------------------------------------------------------------
cat <<SUMMARY

================================================================================
PROVISIONING COMPLETE — copy these values
================================================================================
Resource group        $RG
SQL server            ${SQL_SERVER}.database.windows.net
SQL database          $SQL_DB
SQL admin             $SQL_ADMIN_USER  (password: the one you exported)
MCP server URL        https://${MCP_APP}.azurewebsites.net/mcp
Function app          $FUNC_APP
Azure OpenAI endpoint $OPENAI_ENDPOINT
Embedding deployment  $EMBED_DEPLOYMENT
Entra tenant ID       $TENANT_ID
Entra client ID       $APP_ID
Entra client secret   $CLIENT_SECRET     <-- shown ONCE, store it now
Entra audience        api://${APP_ID}
Scope (Copilot)       api://${APP_ID}/mcp.access offline_access
Auth URL (Copilot)    https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize
Token URL (Copilot)   https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token
Your user object ID   ${MY_OID:-'(lookup in Entra > Users)'}

MANUAL STEPS THAT REMAIN (the script cannot do these):
A) Run sql/001 → 002 → 003 (→ 000 for Stage A) against the DB as $SQL_ADMIN_USER.
B) Create the two SQL principals (docs/02 step 2: nfl_ingest, nfl_readonly),
   then update the app setting: az webapp config appsettings set -g $RG \\
     -n $MCP_APP --settings SQL_PASSWORD='<nfl_readonly password>'
C) Deploy code: mcp-server -> $MCP_APP, ingestion timers -> $FUNC_APP (docs/04).
D) Connect Claude + Copilot using the values above (docs/10 fill-in tables).

Teardown (deletes EVERYTHING in the group):
  az group delete -n $RG --yes
  az ad app delete --id $APP_ID
================================================================================
SUMMARY
