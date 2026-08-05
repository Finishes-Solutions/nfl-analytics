/**
 * embed.ts — populates dbo.semantic_documents.
 *
 * Usage:
 *   npx tsx src/embed.ts --phase player_cards
 *   npx tsx src/embed.ts --phase plays --from 2016 --to 2025
 *   npx tsx src/embed.ts --phase injuries
 *   npx tsx src/embed.ts --phase all
 *
 * Env (add to .env):
 *   AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
 *   AZURE_OPENAI_KEY=...
 *   AZURE_OPENAI_EMBED_DEPLOYMENT=text-embedding-3-small
 *
 * Design notes:
 * - Player cards are COMPOSED text (narrative from your own stats), because
 *   raw numeric rows embed into noise. Cards are what make "find me a
 *   late-round pass-catching back" style questions work.
 * - Plays corpus is FILTERED: scoring plays + 3rd/4th downs. Routine 1st-down
 *   runs are near-identical text that only bloats the index.
 * - Idempotent: MERGE on (doc_type, doc_key); re-runs re-embed only missing
 *   docs unless --force.
 */
import sql from 'mssql';
import { getPool, closePool, query } from './db';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1] ?? 'true');
const PHASE = args.get('phase') ?? 'all';
const FROM = Number(args.get('from') ?? 2002);
const TO = Number(args.get('to') ?? new Date().getFullYear());
const FORCE = args.get('force') === 'true';
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

const AOAI = {
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  key: process.env.AZURE_OPENAI_KEY!,
  deployment: process.env.AZURE_OPENAI_EMBED_DEPLOYMENT ?? 'text-embedding-3-small',
};
if (!AOAI.endpoint || !AOAI.key) throw new Error('Set AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY');

interface Doc {
  doc_type: string; doc_key: string;
  player_id?: number | null; game_id?: number | null; team_id?: number | null;
  season?: number | null; content: string;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `${AOAI.endpoint}/openai/deployments/${AOAI.deployment}/embeddings?api-version=2024-10-21`,
    {
      method: 'POST',
      headers: { 'api-key': AOAI.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: texts }),
    }
  );
  if (!res.ok) throw new Error(`AOAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

async function saveDocs(docs: Doc[]): Promise<void> {
  const pool = await getPool();
  const BATCH = 64; // AOAI input batch
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const vectors = await embedBatch(chunk.map((d) => d.content.slice(0, 8000)));
    for (let j = 0; j < chunk.length; j++) {
      const d = chunk[j];
      await pool.request()
        .input('doc_type', sql.NVarChar(24), d.doc_type)
        .input('doc_key', sql.NVarChar(64), d.doc_key)
        .input('player_id', sql.Int, d.player_id ?? null)
        .input('game_id', sql.Int, d.game_id ?? null)
        .input('team_id', sql.Int, d.team_id ?? null)
        .input('season', sql.Int, d.season ?? null)
        .input('content', sql.NVarChar(sql.MAX), d.content)
        .input('vec', sql.NVarChar(sql.MAX), JSON.stringify(vectors[j]))
        .query(`
MERGE dbo.semantic_documents AS t
USING (SELECT @doc_type AS doc_type, @doc_key AS doc_key) AS s
ON t.doc_type = s.doc_type AND t.doc_key = s.doc_key
WHEN MATCHED THEN UPDATE SET content=@content, embedding=CAST(@vec AS VECTOR(1536)),
  player_id=@player_id, game_id=@game_id, team_id=@team_id, season=@season, created_at=SYSUTCDATETIME()
WHEN NOT MATCHED THEN INSERT (doc_type, doc_key, player_id, game_id, team_id, season, content, embedding)
VALUES (@doc_type, @doc_key, @player_id, @game_id, @team_id, @season, @content, CAST(@vec AS VECTOR(1536)));`);
    }
    log(`embedded ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }
}

const existsFilter = FORCE ? '' : `AND NOT EXISTS (
  SELECT 1 FROM dbo.semantic_documents sd
  WHERE sd.doc_type = @@TYPE@@ AND sd.doc_key = @@KEY@@)`;

/* ---- player cards ---------------------------------------------------------
   One narrative doc per player-season with >= 4 games of fantasy relevance. */
async function phasePlayerCards() {
  const rowsQ = await query<any>(`
    SELECT f.player_id, f.first_name, f.last_name, f.pos, f.season,
           f.games, f.fp_ppr_total, f.fp_ppr_pg, f.fp_ppr_stdev, f.fp_ppr_floor, f.fp_ppr_ceiling,
           s.passing_yards, s.passing_touchdowns, s.passing_interceptions,
           s.rushing_attempts, s.rushing_yards, s.rushing_touchdowns,
           s.receptions, s.receiving_targets, s.receiving_yards, s.receiving_touchdowns,
           t.full_name AS team_name
    FROM dbo.v_player_fantasy_season f
    JOIN dbo.v_player_season_from_games s
      ON s.player_id=f.player_id AND s.season=f.season AND s.season_type=f.season_type
    LEFT JOIN dbo.players p ON p.id=f.player_id
    LEFT JOIN dbo.teams t ON t.id=p.team_id
    WHERE f.season_type=2 AND f.games>=1 AND f.fp_ppr_total>0
      AND f.season BETWEEN ${FROM} AND ${TO}
      ${FORCE ? '' : `AND NOT EXISTS (SELECT 1 FROM dbo.semantic_documents sd
        WHERE sd.doc_type='player_card' AND sd.doc_key=CONCAT(f.player_id,':',f.season))`}`);
  const docs: Doc[] = rowsQ.map((r) => {
    const bits: string[] = [
      `${r.season} season: ${r.first_name} ${r.last_name}, ${r.pos}${r.team_name ? `, ${r.team_name}` : ''}.`,
      `${r.games} games, ${r.fp_ppr_total} PPR points (${r.fp_ppr_pg}/game), ` +
      `consistency stdev ${r.fp_ppr_stdev}, floor ${r.fp_ppr_floor}, ceiling ${r.fp_ppr_ceiling}.`,
    ];
    if (r.passing_yards) bits.push(`Passing: ${r.passing_yards} yards, ${r.passing_touchdowns} TD, ${r.passing_interceptions} INT.`);
    if (r.rushing_yards) bits.push(`Rushing: ${r.rushing_attempts} carries for ${r.rushing_yards} yards, ${r.rushing_touchdowns} TD.`);
    if (r.receiving_yards) bits.push(`Receiving: ${r.receptions} catches on ${r.receiving_targets ?? '?'} targets for ${r.receiving_yards} yards, ${r.receiving_touchdowns} TD.`);
    const profile =
      r.fp_ppr_stdev > 9 ? 'Boom-bust profile with big spike weeks.' :
      r.fp_ppr_stdev < 5 ? 'Steady, high-floor weekly producer.' : 'Moderate week-to-week variance.';
    bits.push(profile);
    return {
      doc_type: 'player_card', doc_key: `${r.player_id}:${r.season}`,
      player_id: r.player_id, season: r.season, content: bits.join(' '),
    };
  });
  log(`player_cards: ${docs.length} to embed`);
  await saveDocs(docs);
}

/* ---- plays (filtered corpus) --------------------------------------------- */
async function phasePlays() {
  const rowsQ = await query<any>(`
    SELECT p.id, p.game_id, p.team_id, p.season, p.text, p.type_text, p.period,
           p.clock_display, p.home_score, p.away_score
    FROM dbo.plays p
    WHERE p.season BETWEEN ${FROM} AND ${TO}
      AND (p.scoring_play=1 OR p.start_down IN (3,4))
      AND p.text IS NOT NULL AND LEN(p.text) > 15
      ${FORCE ? '' : `AND NOT EXISTS (SELECT 1 FROM dbo.semantic_documents sd
        WHERE sd.doc_type='play' AND sd.doc_key=p.id)`}`);
  const docs: Doc[] = rowsQ.map((r) => ({
    doc_type: 'play', doc_key: String(r.id),
    game_id: r.game_id, team_id: r.team_id, season: r.season,
    content: `[${r.season} Q${r.period} ${r.clock_display}, ${r.away_score}-${r.home_score}] ${r.type_text}: ${r.text}`,
  }));
  log(`plays: ${docs.length} to embed (filtered corpus)`);
  await saveDocs(docs);
}

/* ---- injuries (latest capture per player) --------------------------------- */
async function phaseInjuries() {
  const rowsQ = await query<any>(`
    WITH latest AS (
      SELECT snapshot_id, player_id, team_id, status, comment, captured_at,
             ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY captured_at DESC) rn
      FROM dbo.injury_snapshots WHERE comment IS NOT NULL)
    SELECT l.snapshot_id, l.player_id, l.team_id, l.status, l.comment,
           p.first_name, p.last_name, p.position_abbreviation
    FROM latest l LEFT JOIN dbo.players p ON p.id=l.player_id
    WHERE l.rn=1
      ${FORCE ? '' : `AND NOT EXISTS (SELECT 1 FROM dbo.semantic_documents sd
        WHERE sd.doc_type='injury' AND sd.doc_key=CAST(l.snapshot_id AS NVARCHAR(64)))`}`);
  const docs: Doc[] = rowsQ.map((r) => ({
    doc_type: 'injury', doc_key: String(r.snapshot_id),
    player_id: r.player_id, team_id: r.team_id,
    content: `${r.first_name ?? ''} ${r.last_name ?? ''} (${r.position_abbreviation ?? '?'}) — ${r.status}: ${r.comment}`,
  }));
  log(`injuries: ${docs.length} to embed`);
  await saveDocs(docs);
}

const PHASES: Record<string, () => Promise<void>> = {
  player_cards: phasePlayerCards,
  plays: phasePlays,
  injuries: phaseInjuries,
};

async function main() {
  const toRun = PHASE === 'all' ? Object.keys(PHASES) : [PHASE];
  for (const p of toRun) {
    if (!PHASES[p]) throw new Error(`unknown phase '${p}'`);
    log(`=== embed phase: ${p} ===`);
    await PHASES[p]();
  }
  await closePool();
  log('embedding complete');
}

main().catch(async (e) => { console.error(e); await closePool().catch(() => {}); process.exit(1); });
