/**
 * generate-ddl.ts — emits sql/001_schema.sql (Azure SQL / T-SQL) from tables.ts.
 * Run: npx tsx src/generate-ddl.ts
 * Idempotent: every CREATE is guarded, safe to re-run against an existing DB.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { ALL_TABLES, TableSpec, ColumnSpec, SqlType, effectiveColumns } from './tables';

function sqlType(t: SqlType): string {
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

function columnDdl(c: ColumnSpec): string {
  const nullable = c.nullable === false || c.pk ? 'NOT NULL' : 'NULL';
  return `  [${c.name}] ${sqlType(c.type)} ${nullable}`;
}

function tableDdl(t: TableSpec): string {
  const cols = effectiveColumns(t);
  const lines: string[] = [];

  if (t.appendOnly) {
    lines.push(`  [snapshot_id] BIGINT IDENTITY(1,1) NOT NULL`);
  }
  for (const c of cols) lines.push(columnDdl(c));
  if (!t.appendOnly && t.trackUpdated !== false) {
    lines.push(`  [first_seen_at] DATETIME2(3) NOT NULL CONSTRAINT DF_${t.name}_first_seen DEFAULT SYSUTCDATETIME()`);
    lines.push(`  [updated_at] DATETIME2(3) NOT NULL CONSTRAINT DF_${t.name}_updated DEFAULT SYSUTCDATETIME()`);
  }

  const pkCols = t.appendOnly ? ['snapshot_id'] : cols.filter((c) => c.pk).map((c) => c.name);
  if (pkCols.length) {
    lines.push(`  CONSTRAINT [PK_${t.name}] PRIMARY KEY CLUSTERED (${pkCols.map((c) => `[${c}]`).join(', ')})`);
  }

  const idx = (t.indexes ?? [])
    .map(
      (ix) =>
        `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${ix.name}' AND object_id = OBJECT_ID('dbo.${t.name}'))\n` +
        `  CREATE NONCLUSTERED INDEX [${ix.name}] ON dbo.[${t.name}] (${ix.cols.map((c) => `[${c}]`).join(', ')});`
    )
    .join('\n');

  return (
    `IF OBJECT_ID('dbo.${t.name}', 'U') IS NULL\n` +
    `CREATE TABLE dbo.[${t.name}] (\n${lines.join(',\n')}\n);\nGO\n` +
    (idx ? idx + '\nGO\n' : '')
  );
}

const header = `/* =============================================================================
   BALLDONTLIE NFL Analytics Warehouse — Azure SQL schema
   Generated from ingestion/src/tables.ts on ${new Date().toISOString().slice(0, 10)}
   Do not edit by hand; edit tables.ts and re-run: npx tsx src/generate-ddl.ts

   Conventions:
   - API IDs are used as primary keys; all upserts MERGE on those keys.
   - Every fact table stores raw_json (verbatim API row) so undocumented
     fields are never lost. Spec/docs disagree; raw capture is the safety net.
   - Snapshot tables (injuries, rosters, odds, props) are APPEND-ONLY with an
     IDENTITY snapshot_id + captured_at; they build history the API discards.
   - season_type: 1 = preseason, 2 = regular, 3 = postseason (from request
     context — the API payloads only carry a boolean 'postseason').
   - Rate stats are FLOAT even where the OpenAPI spec says integer (the spec
     is wrong: QBR, yards-per-attempt etc. are fractional in real payloads).
============================================================================= */
`;

const body = ALL_TABLES.map(tableDdl).join('\n');

const readOnlyUser = `
/* ----------------------------------------------------------------------------
   Read-only principal for the MCP server / dashboard API.
   1) In master:   CREATE LOGIN nfl_readonly WITH PASSWORD = '<strong-password>';
   2) In this DB:  run the block below.
---------------------------------------------------------------------------- */
/*
CREATE USER nfl_readonly FOR LOGIN nfl_readonly;
ALTER ROLE db_datareader ADD MEMBER nfl_readonly;
DENY INSERT, UPDATE, DELETE, EXECUTE TO nfl_readonly;
*/
`;

const out = header + '\n' + body + readOnlyUser;
const target = resolve(__dirname, '../../sql/001_schema.sql');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, out);
console.log(`Wrote ${target} (${out.length.toLocaleString()} bytes, ${ALL_TABLES.length} tables)`);
