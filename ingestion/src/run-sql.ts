/**
 * run-sql.ts — apply .sql files (split on GO) or run read-only check scripts.
 *
 * Usage:
 *   npx tsx src/run-sql.ts apply  ../sql/002_views_fantasy.sql ../sql/004_analytics_views.sql
 *   npx tsx src/run-sql.ts check  ../sql/checks/data_health.sql
 *
 * apply: runs every batch in order, stops at the first error.
 * check: runs every batch and prints each result set as a table (capped at
 *        200 rows). Used by the "SQL" GitHub workflow so results land in the
 *        job log where they can be read without database access.
 *
 * Env: SQL_SERVER, SQL_DATABASE, SQL_USER, SQL_PASSWORD
 *      SQL_TRUST_CERT=true for a local dev container with a self-signed cert.
 *
 * Deliberately standalone (no config.ts import) so it doesn't need BDL_API_KEY.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import sql from 'mssql';
import { splitBatches } from './sql-batches';

const [mode, ...files] = process.argv.slice(2);
if (!['apply', 'check'].includes(mode) || !files.length) {
  console.error('usage: run-sql.ts apply|check <file.sql> [...]');
  process.exit(2);
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function printTable(rows: Record<string, unknown>[]): void {
  if (!rows.length) { console.log('  (0 rows)'); return; }
  const shown = rows.slice(0, 200);
  const cols = Object.keys(shown[0]);
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return 'NULL';
    if (v instanceof Date) return v.toISOString().replace('T', ' ').slice(0, 19);
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '...' : s;
  };
  const widths = cols.map((c) => Math.max(c.length, ...shown.map((r) => fmt(r[c]).length)));
  const line = (vals: string[]) => '  ' + vals.map((v, i) => v.padEnd(widths[i])).join(' | ');
  console.log(line(cols));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('-+-'));
  for (const r of shown) console.log(line(cols.map((c) => fmt(r[c]))));
  if (rows.length > shown.length) console.log(`  ... ${rows.length - shown.length} more rows`);
}

async function main() {
  const pool = await new sql.ConnectionPool({
    server: env('SQL_SERVER'),
    database: env('SQL_DATABASE'),
    user: env('SQL_USER'),
    password: env('SQL_PASSWORD'),
    options: { encrypt: true, trustServerCertificate: process.env.SQL_TRUST_CERT === 'true' },
    connectionTimeout: 90_000, // serverless resume
    requestTimeout: 600_000,
  }).connect();

  try {
    for (const file of files) {
      const batches = splitBatches(readFileSync(file, 'utf8'));
      console.log(`\n=== ${file} (${batches.length} batches, mode=${mode}) ===`);
      for (const [i, batch] of batches.entries()) {
        const label = batch.match(/--\s*@check\s+(.+)$/m)?.[1]
          ?? batch.match(/CREATE\s+OR\s+ALTER\s+(?:VIEW|PROCEDURE|FUNCTION)\s+([\w.\[\]]+)/i)?.[1]
          ?? `batch ${i + 1}`;
        const started = Date.now();
        try {
          const r = await pool.request().query(batch);
          const ms = Date.now() - started;
          if (mode === 'check') {
            console.log(`\n-- ${label} (${ms} ms)`);
            for (const rs of r.recordsets as unknown as Record<string, unknown>[][]) printTable(rs);
          } else {
            console.log(`  ok  ${label} (${ms} ms)`);
          }
        } catch (e) {
          console.error(`  FAIL ${label}: ${(e as Error).message}`);
          if (mode === 'apply') throw e;
        }
      }
    }
  } finally {
    await pool.close();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
