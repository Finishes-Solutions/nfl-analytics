/**
 * db.ts — Azure SQL access layer.
 * Generic set-based upsert: rows -> JSON -> OPENJSON WITH (typed shred) -> MERGE.
 * Column names/types come from tables.ts, so DDL and upserts can never diverge.
 */
import sql from 'mssql';
import { config } from './config';
import { TableSpec, ColumnSpec, SqlType, effectiveColumns } from './tables';

let pool: sql.ConnectionPool | undefined;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) return pool;
  pool = await new sql.ConnectionPool({
    server: config.sql.server,
    database: config.sql.database,
    user: config.sql.user,
    password: config.sql.password,
    // SQL_TRUST_CERT=true only for a local Docker SQL Server (self-signed cert)
    options: { encrypt: true, trustServerCertificate: process.env.SQL_TRUST_CERT === 'true' },
    pool: { max: 4 },
    requestTimeout: 120_000,
  }).connect();
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.close();
  pool = undefined;
}

function sqlTypeDdl(t: SqlType): string {
  switch (t.kind) {
    case 'int': return 'INT';
    case 'bigint': return 'BIGINT';
    case 'tinyint': return 'TINYINT';
    case 'float': return 'FLOAT';
    case 'bit': return 'BIT';
    case 'datetime2': return 'DATETIME2(3)';
    case 'nvarchar': return `NVARCHAR(${t.len === 'max' ? 'MAX' : t.len})`;
  }
}

function withClause(cols: ColumnSpec[]): string {
  return cols.map((c) => `[${c.name}] ${sqlTypeDdl(c.type)} '$.${c.name}'`).join(', ');
}

const CHUNK = 500;

/** MERGE-upsert rows into a keyed table. Row property names must match column names. */
export async function upsertRows(t: TableSpec, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  if (t.appendOnly) throw new Error(`${t.name} is append-only; use insertRows`);
  const cols = effectiveColumns(t);
  const keys = cols.filter((c) => c.pk).map((c) => c.name);
  if (!keys.length) throw new Error(`${t.name} has no PK columns`);
  const nonKeys = cols.filter((c) => !c.pk).map((c) => c.name);

  const stmt = `
MERGE dbo.[${t.name}] WITH (HOLDLOCK) AS target
USING (SELECT * FROM OPENJSON(@json) WITH (${withClause(cols)})) AS src
ON ${keys.map((k) => `target.[${k}] = src.[${k}]`).join(' AND ')}
WHEN MATCHED THEN UPDATE SET
  ${nonKeys.map((c) => `target.[${c}] = src.[${c}]`).join(', ')},
  target.[updated_at] = SYSUTCDATETIME()
WHEN NOT MATCHED BY TARGET THEN
  INSERT (${cols.map((c) => `[${c.name}]`).join(', ')})
  VALUES (${cols.map((c) => `src.[${c.name}]`).join(', ')});`;

  const p = await getPool();
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await p
      .request()
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(chunk))
      .query(stmt);
    total += r.rowsAffected.reduce((a, b) => a + b, 0);
  }
  return total;
}

export interface InsertOptions {
  /**
   * Column whose value (when non-null) becomes captured_at instead of the shared
   * timestamp. Used by historical backfills: odds pulled in 2026 for a 2025 game
   * must be stamped with the vendor's updated_at, or line-movement history is
   * collapsed onto the backfill date.
   */
  capturedAtFrom?: string;
  /**
   * Only insert rows that differ from the latest stored snapshot for the same
   * key. Game-day sync runs every few minutes; without this every unchanged line
   * is re-appended each cycle. NULL-safe comparison via INTERSECT.
   */
  dedupe?: { keys: string[]; compare: string[] };
}

/** Append rows into a snapshot table with a shared captured_at. */
export async function insertRows(
  t: TableSpec,
  rows: Record<string, unknown>[],
  capturedAt = new Date(),
  opts: InsertOptions = {}
): Promise<number> {
  if (!rows.length) return 0;
  const cols = effectiveColumns(t).filter((c) => c.name !== 'captured_at');
  const colNames = new Set(cols.map((c) => c.name));
  for (const c of [opts.capturedAtFrom, ...(opts.dedupe?.keys ?? []), ...(opts.dedupe?.compare ?? [])]) {
    if (c && !colNames.has(c)) throw new Error(`${t.name}: unknown column '${c}' in insert options`);
  }
  const ts = toSqlDate(capturedAt.toISOString());
  const capturedExpr = opts.capturedAtFrom
    ? `COALESCE(src.[${opts.capturedAtFrom}], CAST(@captured_at AS DATETIME2(3)))`
    : '@captured_at';
  const dedupe = opts.dedupe
    ? `
WHERE NOT EXISTS (
  SELECT 1 FROM (
    SELECT TOP 1 ${opts.dedupe.compare.map((c) => `l.[${c}]`).join(', ')}
    FROM dbo.[${t.name}] l
    WHERE ${opts.dedupe.keys.map((k) => `l.[${k}] = src.[${k}]`).join(' AND ')}
    ORDER BY l.captured_at DESC
  ) latest
  WHERE EXISTS (SELECT ${opts.dedupe.compare.map((c) => `latest.[${c}]`).join(', ')}
                INTERSECT
                SELECT ${opts.dedupe.compare.map((c) => `src.[${c}]`).join(', ')}))`
    : '';

  const stmt = `
INSERT INTO dbo.[${t.name}] (${cols.map((c) => `[${c.name}]`).join(', ')}, [captured_at])
SELECT ${cols.map((c) => `src.[${c.name}]`).join(', ')}, ${capturedExpr}
FROM OPENJSON(@json) WITH (${withClause(cols)}) AS src${dedupe};`;

  const p = await getPool();
  let total = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const r = await p
      .request()
      .input('json', sql.NVarChar(sql.MAX), JSON.stringify(chunk))
      .input('captured_at', sql.NVarChar(32), ts)
      .query(stmt);
    total += r.rowsAffected.reduce((a, b) => a + b, 0);
  }
  return total;
}

/** Change-only snapshot settings shared by sync (game day) and backfill. */
export const ODDS_DEDUPE: InsertOptions['dedupe'] = {
  keys: ['game_id', 'vendor'],
  compare: ['spread_home_value', 'spread_home_odds', 'spread_away_value', 'spread_away_odds',
    'moneyline_home_odds', 'moneyline_away_odds', 'total_value', 'total_over_odds', 'total_under_odds'],
};
export const PROPS_DEDUPE: InsertOptions['dedupe'] = {
  keys: ['game_id', 'player_id', 'vendor', 'prop_type', 'market_type'],
  compare: ['line_value', 'over_odds', 'under_odds', 'milestone_odds'],
};

export async function query<T = Record<string, unknown>>(text: string): Promise<T[]> {
  const p = await getPool();
  const r = await p.request().query(text);
  return r.recordset as T[];
}

/** ISO 8601 (with Z) -> 'YYYY-MM-DD HH:mm:ss.SSS' UTC, which DATETIME2 parses reliably. */
export function toSqlDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').replace('Z', '');
}
