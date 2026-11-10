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

## Batch 2 — real analyzer, independent engine and hostile controls

Batch 2 adds the original application analyzer **without starting an HTTP server**. Imports happen only after the runner sets a fresh absolute `DB_PATH`, synthetic session secret, `ENGINE_BACKEND=local`, bounded Stockfish settings and disposable storage in ignored `qa/review-excellence/results/`. It does not import real user records, sign into Chess.com, invoke hosted engine APIs, or call an LLM. The actual `analyzePgn()` implementation is used from each snapshot; no app source edits are necessary.

Install packages normally on a clean checkout (`npm ci`). If using `--ignore-scripts`, native `better-sqlite3` may require `npm rebuild better-sqlite3`. You must provide a local **trusted** Stockfish binary separately; do not use any production live-service binary by default. The 2026-11-11 local proof used publicly packaged *Ubuntu noble Stockfish 16-1build1* unpacked into the ignored results directory, **not** the deployed Stockfish 17. Binary SHA256:

```text
00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca
```

Use an existing licensed binary or independently obtain that packaged version and verify the digest. Do **not** commit engine binaries or private data. Set the shell variable `ENGINE` to an absolute path to the independently verified executable, then run:

```sh
sha256sum "$ENGINE"
node scripts/review-benchmark.mjs --manifest=qa/review-excellence/manifests/manifest-v2.jsonl --split=all
node scripts/review-benchmark-negative-controls.mjs
node --import tsx scripts/review-benchmark-app-contract.mjs
node --import tsx scripts/review-benchmark-real-app.mjs --engine="$ENGINE" --reference-engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca --ids=SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY,SYN-GAME-UNDERPROMOTION,SYN-GAME-FOOLS-MATE,SYN-GAME-SCHOLARS-MATE --games=5 --depth=8 --out=qa/review-excellence/results/compare-v2-main.json
node scripts/review-benchmark-engine-fault-controls.mjs --reference="$ENGINE"
node scripts/review-benchmark-uci.mjs --engine="$ENGINE" --sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca --depth=12 --trials=3
node --import tsx scripts/review-benchmark-lifecycle.mjs --engine="$ENGINE" --sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca
```

The full comparison runner additionally accepts `--app-root=ABSOLUTE_DETACHED_WORKTREE`, `--reference-engine=PATH`, `--manifest=PATH`, `--ids=comma,separated,fixture,ids`, `--games=N`, and `--reference-plies=0..4`. The engine under test can be a disposable faulty UCI executable while the **separately pinned reference** stays trustworthy. Never use the same unverified fake executable for both sides. Negative controls deliberately cause **non-zero** exit codes on broken application output. `scripts/review-benchmark-report.mjs` combines **existing local results** into the committed synthetic-only `certification-summary-batch2.json`; it refuses mismatched manifest, engine hashes, negative-control results or incomplete candidates. Running it on an unprepared clean checkout will fail until the specified candidate snapshots are benchmarked.

The benchmark's main direct analyzer path does **not** authenticate, persist analyses, or exercise React. The lifecycle suite directly tests cancellation, crash paths, one-engine busy rejection and synthetic SQLite pagination—*not* HTTP admission control. A 96-ply stress fixture is intentionally repetitive rather than representative real-world chess; its elapsed time is not a latency SLO. Direct UCI measurements record nodes, depth, best move, engine process CPU ticks and peak RSS; process CPU tick precision is limited at short search durations.

### Results, privacy and frozen labels

Only source-authored fixtures and summary evidence are committed. Raw engine reports, files unpacked from public packages, worktrees, local SQLite, fake UCI files and machine-specific logs stay under the ignored `results/`. `manifest-v1.jsonl` remains untouched; `manifest-v2.jsonl` extends it by 11 source-authored records (25 total). The `seed-v2` authoring script is **not** part of routine test execution and refuses to overwrite divergent frozen artifacts.

`HOLDOUT_PROTOCOL.md` defines a possible sealed assessment; **none exists or was evaluated**. Non-zero human-utility or teaching-safety evidence remains absent. The public fixture suite tests rules and adapter correctness, not game-accuracy calibration or natural-language explanation quality. For details see `BATCH-2-CERTIFICATION.md` and `certification-summary-batch2.json`.
