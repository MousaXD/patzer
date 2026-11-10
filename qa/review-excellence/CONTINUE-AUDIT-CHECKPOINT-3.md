# Agent D — Adversarial continuation checkpoint 3 (2026-11-11)

**Scope:** Only `qa/review-excellence/*`, `scripts/review-benchmark-*` and their ignored local results. Branch `agent/review-benchmark-20261111`, resumed from verified prior SHA `4f2b2756e1026cc369681816d6e7f19bc7344b9d`. No product scorer, AI coach, UI, auth, live SQLite, credentials, updater, deployments or main branch altered.

## New reproduced finding: a false-green baseline

The initial deterministic/real-app benchmarks failed to catch a **numerical rating produced from zero eligible moves**. The independently verified custom-FEN synthetic fixture `SYN-GAME-FORCED-REPLY` has exactly one Black move and exactly one legal option (`...Kf8`). On `main`, its Black result is `classification=forced`, `accuracy_black=0`, **`estimated_elo_black=2880` and `performance_black=2880`**. Both estimated ratings should be unavailable, not strong-player measurements. This is a genuine source defect exposed on test-only data, not an attempt to adjust the scoring formula.

The hardened adapter derives the eligible count independently from verified PGN turns and classifications, validates single-option replies against legal move enumeration, and rejects `rating_without_eligible_moves_black` and `performance_without_eligible_moves_black`. It also rejects all-null evaluation evidence, inconsistent mate-result signs and false forced labels. Deliberately inflating ratings on an otherwise clean forced-only analysis is a new negative control.

Read-only candidate comparison, **same 2 games / 4 plies / pinned Stockfish 16 depth 8 / independent UCI client**:

| Source | Source SHA | Model | Zero-evidence Elo/performance | Independent gate | Mutant controls |
|---|---|---|---|---|---|
| `main` | `51df1d8` | v9 | 2880 / 2880 | **2 findings** | 9/9 rejected |
| Agent A `review-engine` | `edc1b2e` | v9 | null / null | **0 findings** | 11/11 rejected |
| Agent B `review-coach` | `47b571c` | v9 | 2880 / 2880 | **2 findings** | 9/9 rejected |
| Agent C `review-product` | `366bb0d` | v9 | 2880 / 2880 | **2 findings** | 9/9 rejected |
| Unmerged PR #17 `fix/accuracy-aggregation-bias` | `02bfe98` | v10 | 2880 / 2880 | **2 findings** | 9/9 rejected |

The v10 formula change does **not** solve the zero-eligible problem by itself. Agent A's separate correction **does** solve the known example. This does not imply that all of Agent A's other engine/scoring changes are correct. The other agents should not edit their own scoring paths; the integrator must resolve the shared provenance contract and ordering.

## New hostile proof: a corrupted raw PV was sanitized into a green DTO

A deliberately malformed engine sent a **legal first UCI move followed by an illegal second UCI move**. Patzer's app-side SAN conversion truncated the second move. The serialized `AnalysisResult` **passed the earlier consumer-only adapter** despite the actual engine evidence being illegal. That is an independently reproduced false green.

A fourth fake-UCI test now validates the raw lines and **rejects `illegal_raw_uci_pv`**, even while recording that the application DTO itself passed. The other three fake-engine controls—wrong score perspective, wholly illegal best/PV and invented mate-in-one—remain detected, now without conflating a known-bad base output with separate mutated-output controls.

The benchmark-owned UCI proxy is a transparent subprocess relay and recorder, used **only** with disposable synthetic PGNs. Its independent raw replay auditor checks complete PV legality, best moves, FEN/search correlation, missing responses and incomplete nonterminal search evidence.

In a positive run of real Agent A analyzer using pinned Stockfish 16 and a separate referee binary:

- **6 actual engine searches** across two completed fixtures; **6 bestmove responses**.
- **112 / 112 raw principal variation lines legal**, including continuations hidden by app DTO formatting.
- 3 trace files (two analyzer processes plus a separate handshake), with no failures.
- Raw-trace auditor's separate positive test was accepted; **8/8 deliberately broken traces were rejected**.
- Agent A application output and its 11 boundary mutants remained correctly validated.

**Important distinction:** The stand-alone real-app runner does not automatically enable the test-only proxy. A release-certification run must invoke *both* the raw proxy and its auditor; a green DTO-only result cannot prove no upstream PV was truncated.

## Reference independence and provenance

A self-audit found the prior independent-looking referee instantiated `StockfishEngine` **from the candidate application branch**. A candidate wrapper defect could therefore taint both analyzer and referee. It has been replaced by `scripts/review-benchmark-reference-uci.mjs`, a separate UCI client that imports no Patzer chess logic, scoring, caches or SQLite. It handles UCI startup, fixed options, fresh searches, bounded waits and teardown.

- Local pinned engine: Ubuntu Stockfish **16**, binary SHA256 **`00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`**.
- One thread, 16 MiB hash, MultiPV 3, depth 8 in the direct review comparisons. Reference UCI is a **separate process** and **separate implementation**. When using the same Stockfish binary it remains an *engine-opinion comparison*, not absolute chess truth.
- Original manifest v1 SHA256 **`79300b25e5602a72c6781bc0106bd43da73db1c4cfb1d119c8950d9649ac454b`**; v2 SHA256 **`2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`**. Neither manifest or fixture was edited during this checkpoint.
- Existing v2 corpus: 25 source-authored fixtures and 147 PGN plies; all 25 passed manifest/legality validation. **No sealed holdout**, human annotations, published claim-ground-truth or learning outcome measurements.
- Existing standalone depth-12 UCI samples and synthetic SQL/96-ply metrics remain separate from lightweight adapter timing.

## Reproduction and output boundaries

All commands run inside the isolated Agent D checkout with `npm ci` dependencies and a separately verified local engine binary. Set `ENGINE` to its **absolute** path. Never point `DB_PATH` to a running service: the benchmark sets a fresh DB automatically. Do not commit any results under ignored `qa/review-excellence/results/`.

```sh
node scripts/review-benchmark.mjs --manifest=qa/review-excellence/manifests/manifest-v2.jsonl --split=all
node scripts/review-benchmark-uci-trace-negative-controls.mjs
node --import tsx scripts/review-benchmark-real-app.mjs \
  --app-root=/ABS/PATH/TO/READONLY/AGENT-A-SNAPSHOT \
  --engine="$ENGINE" \
  --reference-engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca \
  --ids=SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY --games=2 --depth=8 \
  --out=qa/review-excellence/results/checkpoint3-engine.json
node scripts/review-benchmark-engine-fault-controls.mjs --reference="$ENGINE"
```

For **raw UCI** positive certification, separately:

```sh
export PATZER_BENCH_PROXY_TARGET="$ENGINE"
export PATZER_BENCH_PROXY_TRACE_DIR="$(mktemp -d "$(pwd)/qa/review-excellence/results/uci-proxy.XXXXXX")"
node --import tsx scripts/review-benchmark-real-app.mjs \
  --app-root=/ABS/PATH/TO/READONLY/AGENT-A-SNAPSHOT \
  --engine="$(pwd)/scripts/review-benchmark-uci-proxy.mjs" --reference-engine="$ENGINE" \
  --reference-engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca \
  --ids=SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY --games=2 --depth=8 \
  --out=qa/review-excellence/results/uci-proxy-app.json
node scripts/review-benchmark-uci-trace.mjs \
  --dir="$PATZER_BENCH_PROXY_TRACE_DIR" --min-searches=6 \
  --out=qa/review-excellence/results/uci-proxy-raw-audit-v2.json
node scripts/review-benchmark-checkpoint.mjs
```

The prior immutable **Batch 2** report is not rewritten. Its older report builder expects the **original three** fake engine mutations; reproduce it only with `node scripts/review-benchmark-engine-fault-controls.mjs --controls=3 --reference="$ENGINE"` before running `scripts/review-benchmark-report.mjs`. Re-run the default four-control suite before generating this newer checkpoint. Do not conflate historical and current verdicts.

## Known blockers and next independent audit

1. **No sealed holdout or independent human labels**. A 2-game forced-move gate proves a specific defect, not general superiority. Human-validated coach claims and end-user retention remain unmeasured.
2. **Raw UCI tracing is opt-in.** Next justified improvement: integrate tee+trace validation into a single orchestrated QA command that fails closed if the raw trace is absent, empty or corrupt; do not require human operators to remember both steps.
3. **Not yet certified:** HTTP auth/session/user isolation, browser retry/accessibility, LLM causal claim truth, multi-user concurrency, mate-in-N proof for N>1, tablebase endgames, hard MultiPV/horizon cases and local Stockfish 17 parity.
4. **Candidate source overlap:** Agent A's zero-evidence gate and PR #17's v10 formula/backfill affect related scoring behaviors. Integrator must arbitrate order, backfill and version changes. Agent D must not cherry-pick or rewrite either code path.
5. **Resource measurements:** Direct Stockfish UCI and SQLite microprobes are single-machine, bounded tests, not production latency guarantees. No live service, production SQLite or online provider used.

**Decision:** Agent D's benchmark-only increment is reviewable. The findings are evidence **against** declaring the current baseline and independently updated B/C/v10 branches fully certified. Agent A passes the newly proved no-evidence gate; this is not global certification. Owner/integrator still controls all integration, migration and deployment decisions.
