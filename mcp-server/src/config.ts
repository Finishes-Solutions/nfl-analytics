import 'dotenv/config';
import sql from 'mssql';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8080}`,
  authDisabled: process.env.AUTH_DISABLED === 'true', // LOCAL TESTING ONLY
  entra: {
    tenantId: process.env.ENTRA_TENANT_ID ?? '',
    audience: process.env.ENTRA_AUDIENCE ?? '', // api://<client-id>
    allowedObjectIds: (process.env.ALLOWED_OBJECT_IDS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean), // optional user pinning
  },
  sql: {
    server: req('SQL_SERVER'),
    database: req('SQL_DATABASE'),
    user: req('SQL_USER'),         // nfl_readonly — NEVER the ingest principal
    password: req('SQL_PASSWORD'),
  },
  aoai: {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    key: process.env.AZURE_OPENAI_KEY ?? '',
    deployment: process.env.AZURE_OPENAI_EMBED_DEPLOYMENT ?? 'text-embedding-3-small',
  },
  maxRows: 50,
};

let pool: sql.ConnectionPool | undefined;
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool({
    server: config.sql.server,
    database: config.sql.database,
    user: config.sql.user,
    password: config.sql.password,
    options: { encrypt: true },
    pool: { max: 4 },
    requestTimeout: 10_000, // guardrail: 10s statement ceiling
  }).connect();
  return pool;
}

export type Params = Record<string, string | number | null | undefined>;

/** Parameterized query helper. NEVER interpolate user input into `text`. */
export async function q<T = Record<string, unknown>>(text: string, params: Params = {}): Promise<T[]> {
  const p = await getPool();
  const r = p.request();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number') r.input(k, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else r.input(k, sql.NVarChar(sql.MAX), v ?? null);
  }
  const res = await r.query(text);
  return res.recordset as T[];
}

export async function embed(text: string): Promise<number[]> {
  if (!config.aoai.endpoint || !config.aoai.key) {
    throw new Error('semantic_search unavailable: AZURE_OPENAI_* not configured');
  }
  const res = await fetch(
    `${config.aoai.endpoint}/openai/deployments/${config.aoai.deployment}/embeddings?api-version=2024-10-21`,
    {
      method: 'POST',
      headers: { 'api-key': config.aoai.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: [text.slice(0, 8000)] }),
    }
  );
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}
