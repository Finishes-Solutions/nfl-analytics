# NFL Analyst MCP Server

Twelve curated tools over the warehouse (read-only), Streamable HTTP transport,
Entra OAuth. One server for Claude custom connectors AND Copilot Studio.
Full agent guide + fill-in connection values: `../docs/10-copilot-agent.md`.

## Local test (Stage A, no OAuth, sample data)
```bash
npm install && cp .env.example .env
# set SQL_* to your dev DB (seeded via sql/000_seed_sample_data.sql)
# set AUTH_DISABLED=true
npm run dev
npx @modelcontextprotocol/inspector http://localhost:8080/mcp
```
In the Inspector: list tools (expect 12), then try
`get_fantasy_leaders {"season":2025}` and
`search_players {"name":"jackson"}` → `get_player_gamelog`.
`semantic_search` needs AZURE_OPENAI_* + an embedded corpus; all others work
on sample data alone.

## Tests
`npm test` runs every tool (except `semantic_search`) through an in-memory MCP
client against a SQL Server loaded with `tools/gen_dev_data.py` (set `SQL_*`,
plus `SQL_TRUST_CERT=true` for a local Docker instance). CI does this on every push.

## Deploy (App Service, Node 20)
`npm run build` → deploy `dist` + node_modules; App Settings = .env values
with AUTH_DISABLED absent. Health: `/healthz`. Then connect clients per docs/10.
