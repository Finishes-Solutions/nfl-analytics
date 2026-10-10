import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { splitBatches } from '../src/sql-batches';

process.env.BDL_API_KEY ??= 'test';
process.env.SQL_SERVER ??= 'x'; process.env.SQL_DATABASE ??= 'x';
process.env.SQL_USER ??= 'x'; process.env.SQL_PASSWORD ??= 'x';

test('parseHeightInches / parseWeightLbs', async () => {
  const X = await import('../src/transform');
  assert.equal(X.parseHeightInches(`6' 2"`), 74);
  assert.equal(X.parseHeightInches('5\'11"'), 71);
  assert.equal(X.parseHeightInches(null), null);
  assert.equal(X.parseWeightLbs('205 lbs'), 205);
  assert.equal(X.parseWeightLbs(''), null);
});

test('odds rows parse lines and keep vendor timestamp', async () => {
  const X = await import('../src/transform');
  const r = X.oddsSnapshotRow({ id: 1, game_id: 2, vendor: 'dk', spread_home_value: '-6.5', spread_away_value: '6.5',
    total_value: 'pk', updated_at: '2025-11-02T17:00:00.000Z' });
  assert.equal(r.spread_home, -6.5);
  assert.equal(r.total_points, null, 'non-numeric line -> NULL, raw string kept');
  assert.equal(r.total_value, 'pk');
  assert.equal(r.api_updated_at, '2025-11-02 17:00:00.000');
});

test('splitBatches splits on GO and drops comment-only batches', () => {
  const b = splitBatches('/* header */\nGO\nSELECT 1\ngo\n  GO ;\nSELECT 2 -- trailing\nGO\n-- only a comment\n');
  assert.deepEqual(b, ['SELECT 1', 'SELECT 2 -- trailing']);
});

test('every repo SQL file splits into non-empty batches', () => {
  for (const f of ['001_schema', '002_views_fantasy', '003_semantic', '004_analytics_views']) {
    const batches = splitBatches(readFileSync(`${__dirname}/../../sql/${f}.sql`, 'utf8'));
    assert.ok(batches.length > 3, f);
  }
});

test('generated DDL is in sync with tables.ts', async () => {
  const { execFileSync } = await import('node:child_process');
  const before = readFileSync(`${__dirname}/../../sql/001_schema.sql`, 'utf8');
  execFileSync('npx', ['tsx', 'src/generate-ddl.ts'], { cwd: `${__dirname}/..`, stdio: 'pipe' });
  const after = readFileSync(`${__dirname}/../../sql/001_schema.sql`, 'utf8');
  const strip = (s: string) => s.replace(/Generated from ingestion\/src\/tables\.ts on \S+/, '');
  assert.equal(strip(after), strip(before), 'sql/001_schema.sql is stale — run npm run ddl and commit');
});
