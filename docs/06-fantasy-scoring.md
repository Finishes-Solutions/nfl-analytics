# 06 — Fantasy Scoring Layer

Fully self-contained: computed in SQL views from stats already in the warehouse.
No external fantasy service exists anywhere in the system. Change a rule in
`002_views_fantasy.sql` and 24 seasons rescore instantly.

## The five views

| View | Grain | Purpose |
|---|---|---|
| `v_player_fantasy_game` | player / game | std, half-PPR, PPR side by side + 10 component columns (the "why") |
| `v_player_fantasy_season` | player / season / type | totals, per-game, **stdev / floor / ceiling** (boom-bust profile) |
| `v_dst_fantasy_game` | team / game | DST scoring via the opponent-row trick |
| `v_dst_fantasy_season` | team / season / type | DST aggregates |
| `v_fantasy_points_allowed` | defense / position / season | matchup difficulty — first feature of any projection model |

## Scoring rules (defaults)

Passing 0.04/yd, 4/TD, −2/INT · Rushing 0.1/yd, 6/TD · Receiving 0.1/yd, 6/TD,
receptions 0 / 0.5 / 1 by format · Fumbles lost −2 · Return + off. fumble-rec
TDs 6 · FG 3 flat, XP 1 · DST: sack 1, INT 2, fumble rec 2, def TD 6, plus
points-allowed brackets 10 / 7 / 4 / 1 / 0 / −1 / −4.

**Custom leagues:** the formulas live in exactly one place per format. 6-pt
passing TDs = edit one multiplier and `CREATE OR ALTER` — historical data
rescores on the next query.

## The DST opponent-row trick

`team_game_stats.sacks` is offensive perspective (this team's QB sacked), so a
defense's stat line **is the opponent's row**: their INTs thrown = your picks,
their fumbles lost = your recoveries, their score (from `games`) = your points
allowed. One self-join, no extra ingestion.

## Known gaps (~95% fidelity)

| Gap | Impact | Future fix |
|---|---|---|
| FG distance bonuses (40+/50+) | kickers only, ~1–2 pts/wk | parse `plays.text` |
| Two-point conversions | rare, ~2 pts each | parse `plays.text` |
| DST safeties / blocked kicks | rare | parse `plays.text` |

All three are recoverable because the warehouse already captures full
play-by-play. None move rankings meaningfully in practice.
