# 07 — Semantic Layer (vector search)

**Rule of thumb: numbers → SQL, concepts → vectors.** "Most rushing yards in
2019" must never touch an embedding. "Fourth-quarter go-ahead TDs by backup
QBs" or "a late-round pass-catching back like prime Kamara" is what this layer
is for. Hybrid questions do both in one round trip because the vectors live in
the same database as the stats (Azure SQL native VECTOR, GA).

## What gets embedded (and what deliberately doesn't)

| doc_type | Source | Why |
|---|---|---|
| `player_card` | composed narrative per player-season from your own views | raw stat rows embed into noise; composed text embeds *meaning* |
| `play` | `plays.text`, **filtered**: scoring plays + 3rd/4th downs | routine plays are near-identical text that bloats the index |
| `injury` | latest comment per player | free text already |
| `game_summary` | (future) composed recap per game | narrative search over games |

Not embedded: any purely numeric table. That's what the SQL tools are for.

## Pipeline

1. `sql/003_semantic.sql` — `semantic_documents` (VECTOR(1536)) + `sp_semantic_search`.
2. `ingestion/src/embed.ts` — composes docs, batches to Azure OpenAI
   `text-embedding-3-small`, MERGEs with the vector cast inline. Idempotent;
   `--force` re-embeds.
3. Query: embed the user's question **with the same model**, call
   `sp_semantic_search @query_vector, @doc_type, @season_from, @season_to, @player_id, @top_n`.

Cost reality: the full filtered corpus is a one-time embed on the order of a
dollar; weekly incrementals are cents.

## How Copilot / Claude uses it

One MCP tool: `semantic_search(question, doc_type?, season_range?)` →
embed question → EXEC proc → return content + keys. The model routes naturally:
numeric questions to SQL tools, conceptual ones here, and the returned
`game_id`/`player_id` keys let a follow-up SQL call join semantic hits to exact
stats. That join-back is the pattern that makes answers feel smart.

## Constraints (honest)

- Approximate vector indexes (VECTOR_SEARCH / CREATE VECTOR INDEX) are still
  **preview**. This layer uses exact VECTOR_DISTANCE, recommended under ~50k
  candidates — the doc_type + season filters in the proc keep you there. If the
  filtered plays corpus outgrows that, either narrow filters or adopt the index
  when it GAs.
- Embed queries with the **same model** as documents or distances are garbage.
- Player cards regenerate weekly in-season (stats change); plays/injuries are
  append-only embeds.
