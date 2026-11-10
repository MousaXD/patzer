# Independent Patzer Review Certification (Agent D)

This first wave is **not** a claim that Patzer produces correct engine judgments or better teaching than another product. It is a reproducible offline deterministic evidence gate with independent synthetic fixtures. It neither reads the app's database nor makes API calls.

## Reproduce

From the repository root with Node >=20 and dependencies installed using `npm ci`:

```sh
node scripts/review-benchmark.mjs --split=all --out=qa/review-excellence/results/baseline-all.json
node scripts/review-benchmark.mjs --split=dev
node scripts/review-benchmark.mjs --split=stress
node scripts/review-benchmark-negative-controls.mjs
node --import tsx scripts/review-benchmark-app-contract.mjs
sha256sum qa/review-excellence/manifests/manifest-v1.jsonl
```

Exit code 0 means passed; 1 means evidence failures; 2 means runner errors. Results are excluded from Git. Do not regenerate fixtures casually: the generation script is a reviewed authoring tool; any change to gold inputs requires re-review and a manifest version bump. `node scripts/review-benchmark-seed.mjs` rewrites existing files: use **only** when intentionally creating a new version and reviewing a diff.

The manifest is JSONL; each record names a redistributable, self-authored fixture, SHA-256 hash, split, and provenance. Production records, credentials, paid-service requests and unapproved private archives must never be added. The currently published `dev` and `stress` splits are **public** and not a locked holdout. A holdout must be independently curated and sealed by the integrator before candidate tuning.

## Scope and evidence

- Verified legal chess replay and PGN result using chess.js strict PGN parser.
- FEN/actor and response identity checks, PV move legality, promotion, castling, en passant.
- Forced-mate claims checked against the terminal replay state, not invented engine scores.
- White-oriented vs actor-oriented centipawn sign consistency.
- Classified move labels checked against the **documented v9 threshold contract**, which is not a claim that those thresholds are objectively ideal.
- Structured factual assertions of legal moves, square occupancy and checkmate.
- 7 intentionally corrupt controls (illegal PV, reversed sign, fake mate, stale response, wrong classification, wrong actor, false piece location).
- Black-box metamorphic checks of the actual main scoring helpers; these are distinct from declaring the app's own scores ground truth.
- Basic resource telemetry (wall time, process CPU, peak RSS). No heavy Stockfish process is launched.

## Not certified yet

Actual analyzed-game DTOs are **not** piped into this first-wave validator; there is no engine/reference binary pinned and no blind holdout. An app might return wrong DTOs yet this gate stays green. This is a **known release blocker** for correctness certification, not a passing verdict. Nor do synthetic fixtures measure coach helpfulness, mate-depth search uncertainty, realistic long-game workloads, concurrency, cancellation, privacy/security, or review UX. Those require separately approved experiments and integrations.

Gold classification labels here are contract checks only; they do not prove independent calibration. Nothing here compares game accuracy to Chess.com or attempts to access paid review traffic.

For classification or coach contract changes, the integrator should version the adapter and keep previous reference outputs intact. Avoid modifying the independent fixture labels to match candidate behavior.
