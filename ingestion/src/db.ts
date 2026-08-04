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
    options: { encrypt: true, trustServerCertificate: false },
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

/** Append rows into a snapshot table with a shared captured_at. */
export async function insertRows(
  t: TableSpec,
  rows: Record<string, unknown>[],
  capturedAt = new Date()
): Promise<number> {
  if (!rows.length) return 0;
  const cols = effectiveColumns(t).filter((c) => c.name !== 'captured_at');
  const ts = toSqlDate(capturedAt.toISOString());

  const stmt = `
INSERT INTO dbo.[${t.name}] (${cols.map((c) => `[${c.name}]`).join(', ')}, [captured_at])
SELECT ${cols.map((c) => `src.[${c.name}]`).join(', ')}, @captured_at
FROM OPENJSON(@json) WITH (${withClause(cols)}) AS src;`;

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
