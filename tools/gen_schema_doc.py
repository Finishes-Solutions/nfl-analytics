import json
specs = json.load(open('table_specs.json'))
KIND = {'int':'INT','bigint':'BIGINT','tinyint':'TINYINT','float':'FLOAT','bit':'BIT','nvarchar':'NVARCHAR','datetime2':'DATETIME2'}
GROUPS = {
  'Dimensions':['teams','players','games'],
  'Game Facts':['player_game_stats','team_game_stats','plays'],
  'Season Facts':['player_season_stats','team_season_stats','standings'],
  'Advanced (Tracking-Era) Stats':['adv_passing_stats','adv_rushing_stats','adv_receiving_stats'],
  'Append-Only Snapshots':['injury_snapshots','roster_snapshots','odds_snapshots','odds_opening','prop_snapshots','prop_opening'],
  'Operations':['coverage_map','sync_state'],
}
NOTES = {
 'teams':'One row per franchise. Static.',
 'players':"All-time player dimension. `height_inches`/`weight_lbs` are parsed by ingestion; `age`, height, weight are **current snapshots**, not historical. `is_active` set by the active-player sweep.",
 'games':"All seasons, all season types. `season_type` (1=pre, 2=reg, 3=post) is stamped from request context — payloads only carry a `postseason` boolean.",
 'player_game_stats':"The core box-score fact table, ~25k rows/season. All seven stat families in typed columns.",
 'team_game_stats':"Two rows per game. Note: `sacks` here = this team's QB sacked (offensive perspective) — the DST view exploits this via the opponent-row join.",
 'plays':"Full play-by-play incl. `home_win_probability`. String PK from the API. Postseason requires `season_type=3` on fetch or the endpoint silently returns nothing.",
 'player_season_stats':"Season aggregates (reg + post only; no preseason upstream). Union of docs + spec fields.",
 'team_season_stats':"The 190-column table: every stat plus its `opp_` mirror. All stat fields FLOAT (the spec's integer typing is wrong).",
 'standings':'Per team-season records, streaks, seed, differential.',
 'adv_passing_stats':'Next Gen-style metrics. `week=0` = full-season aggregate row.',
 'adv_rushing_stats':'Same grain as adv_passing.',
 'adv_receiving_stats':'Same grain as adv_passing.',
 'injury_snapshots':'Daily append-only capture — builds the injury timeline the API deletes.',
 'roster_snapshots':'Daily depth-chart capture (2025+ upstream).',
 'odds_snapshots':'Per-poll capture per vendor/game. Line values stored raw (string) AND parsed (float).',
 'odds_opening':'Keyed on API odds id — one opening line per vendor/game.',
 'prop_snapshots':'Player props are LIVE-only upstream; this table is the archive. 36 prop types, over/under + milestone markets.',
 'prop_opening':'Opening props, append + dedupe (opening IDs not clearly globally unique).',
 'coverage_map':'Probe results: which endpoint/season/type combos actually have data. Backfill loops only over verified coverage.',
 'sync_state':'Watermark checkpoints. Scope format: `backfill:stats:2024:2`, `backfill:plays:<game_id>`.',
}
out = ['# Schema Reference — All 20 Tables + Semantic Layer\n',
'> Generated from `ingestion/src/tables.ts` (the single source of truth). Regenerate after editing specs (`python3 tools/gen_schema_doc.py`).\n',
'Conventions: PK columns marked **PK**. Every fact table carries `raw_json` (verbatim API row). Upsert tables carry `first_seen_at`/`updated_at`; append-only tables carry `snapshot_id` (IDENTITY) + `captured_at`.\n']
byname = {t['name']:t for t in specs}
for group, names in GROUPS.items():
    out.append(f'\n## {group}\n')
    for n in names:
        t = byname[n]
        out.append(f'### `{n}`\n')
        out.append(NOTES.get(n,'')+'\n')
        cols = t['columns']
        out.append('| Column | Type | Key |\n|---|---|---|')
        if n == 'team_season_stats':
            for c in [c for c in cols if c['pk']]:
                out.append(f"| {c['name']} | {KIND[c['kind']]} | **PK** |")
            out.append("| *…190 stat columns…* | FLOAT | see `TEAM_SEASON_STAT_FIELDS` in tables.ts |")
            out.append("| raw_json | NVARCHAR(MAX) | |")
        else:
            for c in cols:
                out.append(f"| {c['name']} | {KIND[c['kind']]} | {'**PK**' if c['pk'] else ''} |")
        out.append('')
out.append('\n## Semantic Layer (003_semantic.sql)\n')
out.append('### `semantic_documents`\nEmbeddings beside the stats (Azure SQL native VECTOR, 1536-dim). PK (`doc_type`,`doc_key`). Doc types: `play` (filtered corpus), `player_card` (`player_id:season`), `injury`, `game_summary`. Search entry point: `sp_semantic_search`.\n')
out.append('\n## Views (002_views_fantasy.sql)\n')
out.append('`v_player_fantasy_game` · `v_player_fantasy_season` · `v_dst_fantasy_game` · `v_dst_fantasy_season` · `v_fantasy_points_allowed` — see docs/06-fantasy-scoring.md.\n')
open('/home/claude/nfl-analytics/docs/05-schema-reference.md','w').write('\n'.join(out))
print('written', len('\n'.join(out)), 'chars')
