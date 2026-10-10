/**
 * db.ts — read-only SQL access for the dashboard API.
 * Same rules as the MCP server: parameterized queries only, identifiers from
 * allowlists, a statement timeout, and a retry for serverless auto-resume.
 */
import 'dotenv/config';
import sql from 'mssql';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see dashboard/.env.example)`);
  return v;
}

let pool: sql.ConnectionPool | undefined;
let connecting: Promise<sql.ConnectionPool> | undefined;

async function connect(): Promise<sql.ConnectionPool> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const p = await new sql.ConnectionPool({
        server: req('SQL_SERVER'),
        database: req('SQL_DATABASE'),
        user: req('SQL_USER'),
        password: req('SQL_PASSWORD'),
        options: { encrypt: true, trustServerCertificate: process.env.SQL_TRUST_CERT === 'true' },
        pool: { max: 6 },
        connectionTimeout: 60_000, // serverless resume can take 30-60s
        requestTimeout: 30_000,
      }).connect();
      return p;
    } catch (e) {
      lastErr = e;
      console.error(`SQL connect attempt ${attempt} failed: ${(e as Error).message}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 3_000 * attempt));
    }
  }
  throw new Error(`Warehouse unavailable: ${(lastErr as Error).message}`);
}

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  connecting ??= connect().finally(() => { connecting = undefined; });
  pool = await connecting;
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.close();
  pool = undefined;
}

export type Params = Record<string, string | number | boolean | null | undefined>;

/** Parameterized query. NEVER interpolate request input into `text`. */
export async function q<T = Record<string, unknown>>(text: string, params: Params = {}): Promise<T[]> {
  const r = (await getPool()).request();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'number') r.input(k, Number.isInteger(v) ? sql.Int : sql.Float, v);
    else if (typeof v === 'boolean') r.input(k, sql.Bit, v);
    else r.input(k, sql.NVarChar(4000), v ?? null);
  }
  const res = await r.query(text);
  return res.recordset as T[];
}

/* ---- tiny TTL cache: one user, a serverless DB — don't re-run heavy views on every click */
const cache = new Map<string, { at: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}
export function clearCache(): void { cache.clear(); }
