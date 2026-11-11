# Patzer game accuracy — scoring correction (v10)

## Why it differs from Chess.com

Chess.com Game Review uses **CAPS2**, a proprietary calculation. Its public
help center explains the overall meaning and typical distribution but does not
publish the full weighting model or engine settings. Exact matching is not a
promise Patzer can make. Patzer uses Stockfish centipawn evaluations and the
**public Lichess per-move win-chance formula** plus a transparent game-level
aggregation. Chess.com and Patzer can still differ even on the same PGN.

Documentation:
- https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined
- https://lichess.org/page/accuracy

## Root cause in the previous model (v9)

A relative third-worst accuracy floor replaced a genuine ~58%-accurate move
with ~96% accuracy inside the game's harmonic mean. The volatility measure also
only compared one player's successive **after-move** win chances, which can
miss the actual collapse caused by that player. Finally, a positive shift was
added to every nonperfect result. All three factors could make Patzer
systematically higher than Chess.com and could produce >97% games with a real
mistake.

## Corrected v10 model

1. Keep the already-tested per-move Lichess formula unchanged.
2. In the volatility weights, include each move's own change from its before
   to after evaluation (not just after-move positions). Cap volatility weight
   at 4 to avoid overreacting to one horizon effect.
3. Blend the volatility-weighted and harmonic means equally.
4. Never replace a bad move with the game's third-worst move. The denominator
   uses only a small, **absolute 10% protection** for near-zero moves; it does
   not forgive actual 40–60% mistakes.
5. Remove the undocumented positive score shift.

This is **Patzer accuracy**, not a cloned Chess.com CAPS2 score. The same
Stockfish evaluations can be rescored without recomputing any engine lines.

## Two real-game comparisons (Chess.com from November 11 screenshot)

| Game/color | Chess.com | Patzer v9 | Patzer v10 | Difference after fix |
| --- | ---: | ---: | ---: | ---: |
| Lorerolol White | 87.5 | 97.8 | 90.8 | +3.3 |
| Lorerolol Black | 62.5 | 70.4 | 67.9 | +5.4 |
| zacharypollock White | 76.8 | 80.8 | 76.6 | -0.2 |
| zacharypollock Black | 66.3 | 77.5 | 74.8 | +8.5 |

The discrepancy is reduced but remains in some games, since Chess.com doesn't
publish CAPS2's exact weights and the engines/depths may differ. Do not make a
new undocumented constant adjustment just to force these four samples to match.

## Safe one-time backfill from saved move evaluations

**Important:** Bumping `SCORING_VERSION` to 10 makes existing v9 analyses
appear stale until the following migration is applied. Do not deploy source
without also running this one-time backfill (or accepting that older games need
reanalysis on demand).

After building the corrected server, run:

```bash
node scripts/recalculate-accuracy.mjs --db=/absolute/path/to/chess.db --dry-run
node scripts/recalculate-accuracy.mjs --db=/absolute/path/to/chess.db --apply
```

The script refuses missing/relative paths, skips all non-v9 rows, requires a
**fully verified online SQLite backup** before editing, computes all new
summary accuracy/estimated-strength/phase scores from cached `moves_json`, and
commits the full batch in one transaction. It **never launches Stockfish** or
changes game PGNs, move histories, depth or classifications. It marks legacy
cached AI report prose (without deleting it); the Review page warns that
existing text may contain old values and offers a one-game regeneration action.
No bulk LLM generation is triggered by the migration.

### Source provenance in the combined November 11 release

The combined release also adds a monotonic game source revision and engine
analysis generation. Existing analyses have NULL provenance and generation 0.
Reaggregating their v9 scores to v10 does **not** establish provenance: they
remain unavailable as current engine evidence or AI-report inputs until a new
engine analysis. Their saved PGNs, move history and report text remain stored.
Library/insights/profile accuracy excludes this unverified evidence.

Opening such a legacy game does not automatically reanalyze it. The page
explains that the explicit **Run engine analysis** action replaces its cached
analysis and report. Back up any historical cache that must be retained before
choosing this action; the application cache is not an archival history store.
No mass engine or AI-report regeneration is part of deployment.

See [the migration and rollout report](review-excellence/FINAL-MIGRATION-SAFETY-20261111.md)
for verified rehearsals, deployment hold and rollback instructions.

**Release verification:** check game/analysis counts and SQLite quick_check,
verify known sample games, check no original saved move or review has been
lost, and verify that the local MCP service still connects. The live database
must not be copied bytewise while SQLite WAL writes are active; use the online
backup implemented by the migration script.
