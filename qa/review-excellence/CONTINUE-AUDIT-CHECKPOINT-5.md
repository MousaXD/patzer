# Agent D — Checkpoint 5: misclassification falsification and coverage completeness

**Date:** 2026-11-11. **Branch:** `agent/review-benchmark-20261111`. **Parent checkpoint:** `bb10992feb14d8105b9d443f81b2979f6342dee0`. All work is restricted to the benchmark adapter, disposable runner, gate and QA evidence. No changes to production scoring, coach, Game Review UI, databases, credentials, updater, release settings or other agents' branches.

## A real false green: a best move falsely labeled a mistake

In the **real Patzer analyzer output** for the self-authored
`SYN-GAME-BLACK-FIRST` PGN, the first played move is `g7g6`, the analyzer's `best_move_uci` is also `g7g6`, and the sampled centipawn loss is 17. The original classification was `best`. Deliberately changing **only** that label to `mistake` returned **no findings** from Agent D's existing adapter. That was a reproduced **benchmark false green**, not a claim that Stockfish's move is universally correct.

The adapter now raises `played_best_move_labeled_error` for a move the analysis itself identifies as best if it is also labeled `inaccuracy`, `mistake`, `blunder` or `miss`. This is an **internal evidence-consistency invariant**, not an independent human accuracy calibration threshold. A new corruption of an actual analyzer DTO proves that the exact false-green mutation is now rejected. The source scoring/classifier implementation remains unchanged.

## Another hostile finding: first-fixture-only mutation coverage

The original real-app harness tried its required output mutations against **only the first game** in the cohort. On an en-passant/underpromotion combination, that first game lacked a suitable best-move label and decisively asymmetric independent reference. The harness incorrectly left **two controls unverified** even though the next fixture contained suitable evidence. We changed the runner to exercise each required corruption against the **first applicable fixture anywhere in the bounded cohort**, recording which fixture supplied the proof. A failure is not erased by attempting the same control on a later game.

For the separate forced-move-only fixture, three controls are genuinely impossible to exercise: `reversed_single_eval` (no next move to compare), `false_classification` (only one legal response), and `best_move_marked_mistake` (no actual best-labeled move). The gate **correctly refuses certification** with `unverified_boundary_negative_control`, while reporting **zero actual application correctness defects**. Lack of evidence is not silently turned into green.

The audit also caught an overly narrow expected-error string. In a forced-mate reference position, a reversed evaluation was detected as `reference_mate_side_mismatch`, while the test demanded only `reference_evaluation_side_mismatch`. The checker had found the error, but the negative control incorrectly reported an escape. Both independent forms of perspective evidence are now accepted **only for that corruption**, while a baseline error alone cannot count as successful detection.

## Reproducible results (all pinned and disposable)

| Cohort | Agent A analyzer | Mutations rejected | Raw UCI | Gate |
| --- | --- | --- | --- | --- |
| Black-first + forced reply | 0 app errors | 12/12, no skipped controls | 112/112 legal PVs | **Pass** |
| Underpromotion + en passant | 0 app errors | 10/10, no skipped controls | 240/240 legal PVs | **Pass** |
| Fool's Mate + Scholar's Mate | 0 app errors | 10/10, no skipped controls | 264/264 legal PVs | **Pass** |
| Forced reply alone | 0 app errors | 9 rejected, 3 untestable | 32/32 legal PVs | **Correctly withheld** |
| Extra legal unrelated search | 0 app errors | 12/12 | Additional raw search is legal | **Rejected on FEN provenance** |
| Illegal raw continuation | 0 app errors | 12/12 | 1 illegal raw PV | **Rejected** |
| Baseline `main` on black-first + forced | **2 zero-evidence rating defects** | 10 rejected | 112/112 legal PVs | **Rejected** |

After changes, the four **fake UCI engine** corruptions still fail the independent reference: wrong evaluation, illegal PV/best move, fictitious mate-in-one, and a legal-first/illegal-second continuation hidden in the app DTO. The earlier eight raw-trace adversarial tests and original PGN/manifest checks still pass. The existing 25 synthetic fixtures cover 147 PGN plies; no holdout has been opened.

### Frozen identities

- Baseline: `main` at **`51df1d852296e5f0644127a81b5ec31109c8e6c1`**, v9.
- Agent A measured: **`7178e2624fb9a9a35bd84bc2dcb796a46e0f1c1e`**, v9.
- Agents B and C were inspected read-only at **`610503917dd48580f5c9472136da50e6ab604dfc`** and **`ae833cc1f1f6c8f1b5b6fd7796019e8ac9f048fe`**, respectively. Both still exhibited the previously verified zero-evidence rating defect because their separate branches do not include Agent A's scoring correction. This is a shared integration dependency, not a request to modify their lanes.
- Engine: local **Stockfish 16** binary SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`; depth 8, 1 thread, hash 16 MiB, MultiPV 3, independent benchmark-owned UCI client. No Stockfish 17 equivalence is asserted.
- Fixture manifest v1 SHA256 `79300b25e5602a72c6781bc0106bd43da73db1c4cfb1d119c8950d9649ac454b`; v2 SHA256 **`2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`**; neither changed.
- Benchmark adapter SHA256 `1dc10b7d29d11b3af2912c04907d23b380cd82b70fcc99c6f11d7418d9fb5566`; real-app runner SHA256 `8d91f8d08475551564f5dcdb678450f71047ff6628e454d042bca3628818de82`; gate SHA256 `5a1820e31d5b61826f2f401bcbf6ae04714321ceff04e13a9d21e29bfb7d87f3`.

## How to reproduce and resume

See `GATED-RAW-UCI-CHECKPOINT-4.md` for engine verification, the isolated read-only worktree and the full gate command. Run the gate with one of these small groups using `--ids=` and a strict `--engine-sha256=`: `SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY`; `SYN-GAME-UNDERPROMOTION,SYN-GAME-EN-PASSANT`; `SYN-GAME-FOOLS-MATE,SYN-GAME-SCHOLARS-MATE`. Under the ignored `results/` directory the input/output examples from this audit are `gated7-default.log`, `gated7-special.log`, `gated7-mates.log`, `gated7-forced.log`, `gated7-extra.log`, `gated7-illegal.log`, `gated7-main.log`. From those pinned logs, `node scripts/review-benchmark-classification-proof.mjs` refuses false greens and writes **`certification-summary-checkpoint5.json`**.

**Decision:** The Agent D QA-only changes are reviewable. The candidate is **not certified as a better learning product**, nor is its full analysis correctness proved. Important pending gates: a truly independent and sealed holdout with human adjudication; structured proof of real coach claims and unsupported causal advice; end-to-end browser mistake practice/accessibility; authenticated HTTP/tenant behavior; Stockfish 17 reference parity; realistic long-game and concurrency performance distributions. The integrator controls source arbitration (Agent A vs PR #17 v10), merging, migration and deployment. Agent D must not merge or deploy any branch.

**Next continuation:** Inspect other agents' newest remote commits read-only, then try another candidate failure that can be hidden by internally coherent application output. Prefer benchmark-level negative controls and observed defects over speculative scoring changes; preserve this checkpoint and its hashes.
