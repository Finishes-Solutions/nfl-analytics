/**
 * index.ts — NFL Analyst MCP server.
 * Streamable HTTP (stateless mode) + OAuth 2.1 resource-server duties:
 *   - /.well-known/oauth-protected-resource  (RFC 9728 metadata → Entra)
 *   - 401 + WWW-Authenticate challenge for unauthenticated requests
 *   - JWT validation on every /mcp call (issuer, audience, JWKS, optional user pin)
 * Works for both Claude custom connectors and Copilot Studio MCP tools.
 *
 * LOCAL TESTING: AUTH_DISABLED=true bypasses OAuth (never set in Azure).
 */
import express, { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools';
import { config } from './config';

const app = express();
app.use(express.json({ limit: '1mb' }));

// ---- OAuth: protected resource metadata (Claude/Copilot discover Entra here)
const issuer = `https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`;
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  res.json({
    resource: `${config.publicUrl}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [`${config.entra.audience}/mcp.access`],
    bearer_methods_supported: ['header'],
  });
});

// ---- OAuth: token validation middleware
const jwks = config.entra.tenantId
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.entra.tenantId}/discovery/v2.0/keys`))
  : undefined;

async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (config.authDisabled) return next(); // local dev only
  const challenge = `Bearer resource_metadata="${config.publicUrl}/.well-known/oauth-protected-resource"`;
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ') || !jwks) {
    res.set('WWW-Authenticate', challenge).status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, {
      issuer,
      audience: [config.entra.audience, config.entra.audience.replace(/^api:\/\//, '')],
    });
    const oid = String(payload.oid ?? '');
    if (config.entra.allowedObjectIds.length && !config.entra.allowedObjectIds.includes(oid)) {
      res.status(403).json({ error: 'forbidden: user not allowlisted' });
      return;
    }
    next();
  } catch (e) {
    res.set('WWW-Authenticate', challenge).status(401).json({ error: 'invalid_token' });
  }
}

// ---- simple per-process rate limit (guardrail layer 2)
let windowStart = Date.now(); let count = 0;
function rateLimit(_req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; count = 0; }
  if (++count > 120) { res.status(429).json({ error: 'rate_limited' }); return; }
  next();
}

// ---- MCP endpoint: stateless — fresh server+transport per request
app.post('/mcp', requireAuth, rateLimit, async (req: Request, res: Response) => {
  const server = new McpServer({ name: 'nfl-analyst-warehouse', version: '1.0.0' });
  registerTools(server);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP request failed:', e);
    if (!res.headersSent) res.status(500).json({ error: 'internal' });
  }
});
// Stateless mode: no server-initiated streams or session teardown to support.
app.get('/mcp', requireAuth, (_req, res) => { res.status(405).set('Allow', 'POST').end(); });
app.delete('/mcp', requireAuth, (_req, res) => { res.status(405).set('Allow', 'POST').end(); });

app.get('/healthz', (_req, res) => { res.json({ ok: true }); });

app.listen(config.port, () => {
  console.log(`NFL Analyst MCP listening on :${config.port}  (auth ${config.authDisabled ? 'DISABLED — local only' : 'Entra OAuth'})`);
});
