# 04 — Sync Operations (keeping it current)

## Modes

```bash
npm run sync:nightly    # once daily
npm run sync:gameday    # every 1–15 min during game windows
```

**Nightly** refreshes the current season (games, box scores, aggregates,
standings, advanced), snapshots injuries + rosters (the daily archive tick),
and sweeps newly active players.

**Game day** touches only games in a live window (kickoff <6h ago or <1h out):
scores → box scores → plays tail → props snapshot per game, plus odds for the
active weeks. Off-hours invocations cost one DB query and zero API calls, so
an aggressive timer is harmless.

## Deployment (Azure Functions, matches your existing patterns)

- Node 20 Function App, two timer triggers calling the same code:
  - `nightly`: `0 0 6 * * *` (06:00 UTC)
  - `gameday`: `0 */5 * * * *` — the live-window check makes off-hours free.
- Config via App Settings (same names as `.env`). Consider Key Vault references
  for `BDL_API_KEY` and SQL credentials.
- Add Application Insights; the scripts log per-phase row counts, which becomes
  your data-freshness dashboard for free.
- Embeddings: run `embed.ts --phase player_cards` weekly and
  `--phase plays --from <current>` nightly in-season.

## Snapshot cadence guidance

| Data | Cadence | Why |
|---|---|---|
| odds | every cycle on game days, 1×/day otherwise | line movement is the dataset |
| props | every cycle on game days | LIVE-only upstream — unrecoverable |
| injuries | daily | builds the timeline the API deletes |
| rosters | daily in-season | depth-chart movement history |

## Monitoring the one metric that matters

Changed-rows per cycle. If three consecutive game-day cycles write zero changed
rows for a live game, your cadence is faster than upstream refresh — back off.

## Failure behavior

- 429 → wait retry-after (default 15 s) and continue; the global limiter makes this rare.
- 5xx → exponential backoff, 5 attempts, then the phase throws; next run resumes from checkpoints.
- Partial game-day run → safe; every write is idempotent.
