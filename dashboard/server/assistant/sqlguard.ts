/**
 * sqlguard.ts — checks model-written SQL before it reaches the warehouse.
 *
 * Defense in depth, NOT the only line: the dashboard must connect as the
 * read-only login (nfl_readonly), which is what actually prevents writes.
 * This guard keeps the assistant to single SELECT statements over the
 * analytics surface, and the executor caps rows and time.
 */

/** Objects the assistant may read: every dbo.v_* view plus these tables. */
export const ALLOWED_TABLES = new Set([
  'games', 'teams', 'players', 'player_game_stats', 'team_game_stats', 'standings',
  'adv_passing_stats', 'adv_rushing_stats', 'adv_receiving_stats', 'plays',
  'odds_snapshots', 'odds_opening', 'prop_snapshots', 'prop_opening',
  'injury_snapshots', 'roster_snapshots', 'coverage_map', 'team_season_stats',
]);

const FORBIDDEN = [
  'insert', 'update', 'delete', 'merge', 'drop', 'alter', 'create', 'truncate', 'exec', 'execute',
  'grant', 'revoke', 'deny', 'into', 'openrowset', 'openquery', 'opendatasource', 'openjson',
  'bulk', 'waitfor', 'shutdown', 'kill', 'dbcc', 'reconfigure', 'backup', 'restore', 'use',
  'declare', 'set', 'begin', 'commit', 'rollback', 'transaction', 'cursor', 'xp_', 'sp_',
];

export interface GuardResult { ok: true; sql: string }
export interface GuardError { ok: false; error: string }

/** Remove comments and string literals so keyword checks can't be fooled by either. */
function scrub(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, "''");
}

export function checkSql(input: string): GuardResult | GuardError {
  let sql = input.trim().replace(/;\s*$/, '');
  if (!sql) return { ok: false, error: 'empty query' };
  if (sql.length > 8000) return { ok: false, error: 'query too long (8000 characters max)' };
  if (/\/\*/.test(sql) && !/\*\//.test(sql)) return { ok: false, error: 'unterminated comment' };

  const s = scrub(sql).toLowerCase();
  if (s.includes(';')) return { ok: false, error: 'one statement only (no semicolons)' };
  if (!/^\s*(select|with)\b/.test(s)) return { ok: false, error: 'query must start with SELECT or WITH' };
  for (const kw of FORBIDDEN) {
    const re = kw.endsWith('_') ? new RegExp(`\\b${kw}`) : new RegExp(`\\b${kw}\\b`);
    if (re.test(s)) return { ok: false, error: `"${kw.toUpperCase()}" is not allowed — read-only SELECT queries only` };
  }
  if (/\b(sys|information_schema)\s*\./.test(s) || /\bsemantic_documents\b/.test(s)) {
    return { ok: false, error: 'system catalogs and semantic_documents are off limits — use describe_schema / semantic_search' };
  }
  if (/\[|"/.test(s)) return { ok: false, error: 'use plain identifiers (no [brackets] or "quoted" names)' };

  // every FROM/JOIN/APPLY target must be an allowed object (CTE names are fine)
  const ctes = new Set([...s.matchAll(/(?:\bwith\b|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/g)].map((m) => m[1]));
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/g)) {
    const name = m[1];
    if (ctes.has(name)) continue;
    const bare = name.replace(/^dbo\./, '');
    if (bare.includes('.')) return { ok: false, error: `only dbo objects may be queried (got ${name})` };
    if (bare.startsWith('v_') || ALLOWED_TABLES.has(bare)) continue;
    return { ok: false, error: `${name} is not queryable — call describe_schema for what is` };
  }
  return { ok: true, sql };
}
