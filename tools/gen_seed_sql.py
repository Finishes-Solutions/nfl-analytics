"""Generate sql/000_seed_sample_data.sql from the same generator that built the
sample workbook — identical fake data in Excel and in the dev database."""
import importlib.util, json
spec = importlib.util.spec_from_file_location("bx", "/home/claude/build_sample_xlsx.py")
bx = importlib.util.module_from_spec(spec); spec.loader.exec_module(bx)  # side effect: rebuilds xlsx, fine
rows, SPECS = bx.rows, bx.SPECS

def lit(v):
    if v is None: return "NULL"
    if isinstance(v, bool): return "1" if v else "0"
    if isinstance(v, (int, float)): return str(v)
    return "N'" + str(v).replace("'", "''") + "'"

out = ["""/* =============================================================================
   000_seed_sample_data.sql — FAKE sample data for Stage-A testing (no API key).
   Same seeded-random dataset as samples/nfl-schema-sample.xlsx, so what you see
   in Excel is what the views/MCP/agent return. DEV DATABASES ONLY.
   Idempotent: clears sample rows first. Run AFTER 001/002/003.
============================================================================= */
SET NOCOUNT ON;
"""]
order = ["teams","players","games","player_game_stats","team_game_stats","player_season_stats",
         "team_season_stats","standings","adv_passing_stats","adv_rushing_stats","adv_receiving_stats",
         "plays","injury_snapshots","roster_snapshots","odds_snapshots","odds_opening",
         "prop_snapshots","prop_opening","coverage_map","sync_state"]
for t in order:
    data = rows[t]
    if not data: continue
    spec_t = SPECS[t]
    cols = [c["name"] for c in spec_t["columns"]]
    if spec_t["appendOnly"]:
        cols = [c for c in cols]  # captured_at already in effective? our JSON has it appended
    # our dumped specs include captured_at/raw_json via effectiveColumns; drop snapshot_id (identity)
    cols = [c for c in cols if c != "snapshot_id"]
    out.append(f"DELETE FROM dbo.[{t}];")
    for i in range(0, len(data), 500):
        chunk = data[i:i+500]
        vals = ",\n".join("(" + ", ".join(lit(r.get(c)) for c in cols) + ")" for r in chunk)
        out.append(f"INSERT INTO dbo.[{t}] ({', '.join('['+c+']' for c in cols)}) VALUES\n{vals};")
    out.append(f"PRINT '{t}: {len(data)} sample rows';")
out.append("PRINT 'Sample seed complete — Stage A ready.';")
open("/home/claude/nfl-analytics/sql/000_seed_sample_data.sql","w").write("\n".join(out))
print("seed written", sum(len(v) for v in rows.values()), "rows total")
