import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSql } from '../server/assistant/sqlguard.ts';

const ok = (s: string) => assert.equal(checkSql(s).ok, true, `should allow: ${s} → ${JSON.stringify(checkSql(s))}`);
const no = (s: string, re?: RegExp) => {
  const r = checkSql(s);
  assert.equal(r.ok, false, `should block: ${s}`);
  if (re && !r.ok) assert.match(r.error, re);
};

test('allows read-only analysis over views and allowed tables', () => {
  ok('SELECT TOP 10 * FROM dbo.v_player_fantasy_season WHERE season = 2025 ORDER BY fp_ppr_total DESC');
  ok('select pos, avg(fp_ppr_pg) from v_player_fantasy_season group by pos;');
  ok(`WITH x AS (SELECT player_id, SUM(fp_ppr) AS t FROM dbo.v_player_fantasy_game GROUP BY player_id)
      SELECT TOP 5 p.last_name, x.t FROM x JOIN dbo.players p ON p.id = x.player_id ORDER BY x.t DESC`);
  ok("SELECT * FROM dbo.games g JOIN dbo.teams t ON t.id = g.home_team_id WHERE t.abbreviation = 'KC'");
  ok("SELECT text FROM dbo.plays WHERE game_id = 1 AND text LIKE '%delete%'");  // keyword inside a string is fine
  ok('SELECT updated_at, offset_x FROM dbo.games');                              // identifiers containing keywords
});

test('blocks writes, multiple statements, and escapes', () => {
  no('DELETE FROM dbo.games', /SELECT or WITH/);
  no('SELECT 1; DROP TABLE dbo.games', /one statement/);
  no('SELECT * INTO #t FROM dbo.games', /INTO/);
  no("SELECT * FROM OPENROWSET('x','y','z')", /OPENROWSET/);
  no('WITH x AS (SELECT 1 AS a) UPDATE dbo.games SET week = 1', /UPDATE|SET/);
  no('SELECT 1 /* ; DROP */ ; EXEC sp_who', /one statement|EXEC/);
  no('SELECT * FROM dbo.games WAITFOR DELAY 1', /WAITFOR/);
  no('SELECT * FROM sys.objects', /system catalogs/);
  no('SELECT * FROM INFORMATION_SCHEMA.TABLES', /system catalogs/);
  no('SELECT * FROM dbo.semantic_documents', /semantic_documents/);
  no('SELECT * FROM dbo.sync_state', /not queryable/);
  no('SELECT * FROM otherdb.dbo.games', /only dbo/);
  no('SELECT * FROM [dbo].[games]', /brackets/);
  no('/* unterminated SELECT 1', /SELECT or WITH|unterminated/);
  no('', /empty/);
});
