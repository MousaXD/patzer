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

## Adversarial continuation checkpoint (after Batch 2)

See `CONTINUE-AUDIT-CHECKPOINT-3.md` and `certification-summary-checkpoint3.json`. The hardened application adapter now **fails** the main baseline on an independently legal forced-only test game that previously yielded an unjustified **2880 estimated Elo**. Agent A's updated branch returns null for zero-eligible rated choices; the other branches/PR #17 do not yet contain that fix. The benchmark does **not** edit any scorer.

The reference engine is now controlled by **benchmark-owned UCI code**, not the candidate's engine wrapper. A further hostile negative control proves that an illegal *second* raw UCI PV move can be truncated into a green app DTO. For raw proof use the **test-only UCI proxy** and `scripts/review-benchmark-uci-trace.mjs`; eight raw-trace mutations are rejected by `scripts/review-benchmark-uci-trace-negative-controls.mjs`. The plain analyzer runner remains DTO-only unless run with the proxy. Read the explicit runbook in the checkpoint before describing an analyzed game as upstream-PV certified.

Historical Batch 2 evidence is intentionally unchanged. To regenerate that legacy packet, run `scripts/review-benchmark-engine-fault-controls.mjs --controls=3 --reference="$ENGINE"` to reproduce the original three-control input to `scripts/review-benchmark-report.mjs`; afterwards run the default four-control suite again for the newer checkpoint. Never report all-green on the current `main` for zero-evidence ratings.

## Single-command raw UCI gate (checkpoint 4)

Use `scripts/review-benchmark-gated-smoke.mjs` as the **preferred bounded real-system smoke** instead of invoking the application and raw UCI auditor separately. It always requires a pinned engine SHA256, approved synthetic game IDs, and a disposable Agent D/candidate worktree; it runs the raw trace audit automatically and fails closed on missing PV evidence. Two *test-only* negative controls are `--fault=drop-trace` and `--fault=corrupt-raw-pv`: both **must** fail even when the application's serialized review succeeds. See `GATED-RAW-UCI-CHECKPOINT-4.md` for complete commands and limitations.

A green `scope_passed` only means the sampled synthetic analyzer and raw UCI legality controls passed. It is **not** full engine-quality, AI truth, accessibility, holdout, migration or deployment certification.

The more hostile checkpoint-4 gate now verifies the **exact multiset of raw-searched FENs**, not just search counts. Use `--fault=extra-legal-search` to test that a self-consistent but unrelated raw search is blocked, and `--fault=force-analysis-timeout` to test disposable process-group termination/incomplete-evidence handling. A test-only fault is successful only when it produces a **nonzero** exit for the appropriate failure reason. The frozen evidence compiler `scripts/review-benchmark-gate-proof.mjs` validates the documented test logs; its reference candidate SHA is intentionally fixed, and it must not be used to attest a different candidate without re-running a newly frozen protocol. See `certification-summary-checkpoint4.json`.

## Adversarial classification and cohort coverage checkpoint 5

The independent adapter now catches a **best-engine-move falsely labeled as a mistake** on a real synthetic Patzer analysis output. Required negative controls run on the **first applicable fixture anywhere in the bounded cohort**, instead of being overfitted to the first PGN. The gate explicitly refuses to certify a cohort where required controls cannot be exercised. The wrong-side evaluation attack also accepts either a verified centipawn-sign contradiction or a verified mate-side contradiction, without accepting pre-existing failures as successful mutation detection. See `CONTINUE-AUDIT-CHECKPOINT-5.md`, `scripts/review-benchmark-classification-proof.mjs`, and `certification-summary-checkpoint5.json` for exact results, versioned source hashes and remaining limitations. The benchmark adapter/runner were intentionally hardened; the production scorer, frozen earlier result files and fixture manifests were not changed.

## Checkpoint 6 — real written-review factuality escape

`CONTINUE-AUDIT-CHECKPOINT-6.md` and `certification-summary-checkpoint6.json` document a **real `buildGameReview` consumer test** using a wholly local fake LLM and an approved synthetic Fool's Mate game. On Agent B's frozen branch, a false winner and a false White-king square survived the application's own prose screen; an independent Agent D consumer caught both. The checker's 18 negative/positive controls include deliberate unknown-language and unrecognized-phrase abstentions. All generated evidence is English-only and limited to explicitly checkable result/piece facts; a pass does **not** certify all coach text, a particular LLM, learning outcomes or the full release. See the checkpoint before interpreting harness exit 0 as application success.

## Checkpoint 7 — stale review after real reanalysis

See `CONTINUE-AUDIT-CHECKPOINT-7.md` and `certification-summary-checkpoint7.json`. The Agent D-only `scripts/review-benchmark-coach-cache-race.mjs` uses a disposable synthetic PGN, real `saveAnalysis` + real cache write + authenticated review GET and proves that **a completed reanalysis can leave old prose visible**. Its intentionally broken source verdict is **not** a passing product verdict. `--expect=reproduce` succeeds only if the defect is independently observed; `--expect=fixed` is a hostile negative control that correctly exits nonzero against the historical broken SHA. The test also separately certifies that cross-user access, stale async writes, language changes and marked score mismatches are **already** guarded. Do not treat the controlled scoring-version mutation as a deployed migration, and do not change a production scorer or cache from Agent D.

## Checkpoint 8 — multilingual real-coach false claims

See `CONTINUE-AUDIT-CHECKPOINT-8.md` and `certification-summary-checkpoint8.json`. A **bounded real written-review consumer test**, with a test-only loopback vLLM JSON provider and the same licensed synthetic checkmate, proved that deliberately false winner and piece-square assertions survive in **all five supported languages**. The independent proof checker derives the true result and king position from PGN replay, with 10/10 corrupted evidence packets rejected by adversarial QA controls. This is **not** evidence that actual deployed models hallucinate at any measured rate; the phrases were intentionally fabricated by QA and are not a multilingual human-adjudicated sealed holdout. Do not report a green QA attack-reproduction exit as a green product.

## Checkpoint 9 — non-streaming model completion proof

`CONTINUE-AUDIT-CHECKPOINT-9.md` and `certification-summary-checkpoint9.json` record a **real `buildGameReview()` experiment** in which the non-streaming vLLM-compatible JSON provider reports `finish_reason: length` or `content_filter` while returning syntactically valid JSON. Patzer **accepts** the content in the written summary and key moment, although the transport has not established a successful completion. Its streaming path already handles token-limit termination differently. The new independent QA self-test rejects **11/11 test-only corruptions** of this evidence. The mock content is harmless, truthful, test-only and loopback; this proves an input-validation gap, not a naturally observed hallucination rate or live-provider safety incident. A successful QA reproduction is **not** a passing product/release verdict.

## Checkpoint 10 — actual authenticated cancellation/recovery

`CONTINUE-AUDIT-CHECKPOINT-10.md` and `certification-summary-checkpoint10.json` record an **independent positive test** of an authenticated Game Review POST SSE request aborted while the local model stalls. The actual source route closed without a `done` event or stale cache write; a subsequent normal request completed and persisted. The Agent D verifier rejects **14/14 test-only corruptions**, including one that previously could have exploited an unread/unclosed SSE body. This is a narrow success, **not** a complete cancellation, reliability, factuality or release certificate; earlier negative findings remain open.

## Checkpoint 11 — two simultaneous real Game Reviews

`CONTINUE-AUDIT-CHECKPOINT-11.md` and `certification-summary-checkpoint11.json` independently exercise **two overlapping authenticated SSE Game Review requests** on one disposable synthetic game, with the second model response deliberately completing first. The real cache's conditional write correctly rejects the delayed request and preserves the newer result; real same-game model generation is *not coalesced*, so the two overlapping requests perform **six model calls for one retained report**. The Agent D benchmark itself was hostile-audited for an accidental sequential-await deadlock and corrected; **18/18 test-only evidence mutations are rejected**. This is neither an overall performance SLO nor a release certificate. Other coach/cache truth defects remain open.
## Checkpoint 12 — profile language changed during final AI response

`CONTINUE-AUDIT-CHECKPOINT-12.md` documents three real source-route scenarios at the last JSON provider response, using disposable synthetic data: a changed analysis correctly rejects stale cache; canceling the final model request correctly avoids persistence; **changing the user's profile language during generation still commits/streams an old-language review**, while later GET recognizes it as stale and the automatic queue omits its non-NULL cache row. The independent evidence verifier checks raw SSE events, and its adversarial QA checker rejected **21/21 fabricated bad evidence packets**. This is a scoped profile-provenance defect, not permission to edit Agent B's implementation or a full release certificate.

## Checkpoint 13 — audience preference changes during Game Review

`CONTINUE-AUDIT-CHECKPOINT-13.md` and `certification-summary-checkpoint13.json` document an independent, bounded **real SSE + cache** test for an in-flight profile `audience` change. The final response started under `beginner` but was delivered and persisted after the user switched to `advanced`; GET marks it stale, yet the null-only auto-review worklist skips it. Positive control and manual regeneration to `advanced` both worked. The QA evidence checker rejected **20/20 corrupted packets**. No other agents' implementation or production data was modified, and successful attack reproduction is not release approval.

## Checkpoint 14 — React consumer stale-profile SSE provenance

`CONTINUE-AUDIT-CHECKPOINT-14.md` and `certification-summary-checkpoint14.json` independently exercise Agent C's **real GameReportPanel React component** with a Spanish-locale test mock. The consumer accepts a structurally valid **English beginner** `done` payload and forwards it to `onGenerated`, also accepts a matching Spanish advanced payload, and **correctly rejects malformed JSON-shape data**. All **3/3** QA tests and Agent C's existing **6/6** stream tests pass; **16/16** altered QA evidence packets are rejected. This is a profile-provenance integration risk, not a full browser navigation or authenticated production test. It complements the real backend profile races demonstrated in Checkpoints 12 and 13 and does not authorize changes in Agent C's lane.

## Checkpoint 15 — selection false green and symlink/hardlink containment

`CONTINUE-AUDIT-CHECKPOINT-15.md` and `certification-summary-checkpoint15.json` harden the independent **offline QA runner itself**. Before the change, `--split=holdout` could exit green on **zero holdout fixtures**, and a symlinked report output could overwrite a synthetic canary outside the QA results directory. The runner now refuses empty/unknown cohorts, validates resolved fixture paths, rejects output symlinks and atomically renames report files instead of truncating external hard-link sources. **5 positive CLI paths passed; 6 intentionally invalid selections/paths were rejected; 23/23 forged QA evidence packets were rejected.** Existing 15 dev + 10 stress fixtures passed unchanged. This is not a sealed holdout or product-release certificate. See the runbook for exact hashes and cleanup behavior.

## Checkpoint 16 — cross-user concurrent Game Review isolation

`CONTINUE-AUDIT-CHECKPOINT-16.md` and `certification-summary-checkpoint16.json` independently test two **simultaneous real authenticated Game Review SSE requests** with separate synthetic game owners and profiles, opposite playing sides and deliberately reversed model completion. Both prompts, completed responses, saved caches and GET readbacks stay attached to the correct user (English beginner White loss versus Spanish advanced Black win). **401 unauthenticated / 404 cross-user denial** cases pass, all **6/6** loopback model requests close, and **23/23** corrupted QA evidence packets are rejected. This is one positive, bounded tenant-isolation experiment, not a product-wide security or release certificate; all previously demonstrated coach/cache correctness defects remain open.

## Checkpoint 17 — real model-response corruption must fail certification

`CONTINUE-AUDIT-CHECKPOINT-17.md` and `certification-summary-checkpoint17.json` challenge Checkpoint 16 **at the live application-to-benchmark boundary**. A test-only loopback provider swaps the English and Spanish recipients' synthetic text **before Patzer generates SSE**. The actual route emits `done` and persists both wrong-language summaries despite correct model prompt facts and owner authorization. The QA runner returns **nonzero**, and the independent proof also rejects **3/3** attempts to forge green flags or hide a real SSE/cache mismatch. Distinct run IDs prevent a stale raw packet from being mistaken for current evidence. This proves the model-content validation/benchmark gate is doing meaningful work; it **does not prove an authentication breach**, deployed-model error rate, sealed holdout or product release safety.

## Checkpoint 18 — real logout during a held Game Review

`CONTINUE-AUDIT-CHECKPOINT-18.md` and `certification-summary-checkpoint18.json` test the real authenticated logout route while a **pre-admitted synthetic Game Review** is waiting on its final local model response. Logout expires the cookie and deletes its session; **new GET/POST requests with the revoked cookie both return 401**. The previously admitted request nonetheless finishes and caches its report; a newly signed synthetic session can read it. This does **not** by itself prove an auth bypass because policy for in-flight work after logout has not been specified. **24/24** deliberately forged QA packets are rejected. Real browser cancellation, proxy behavior, multi-process revocation, sealed holdout and full release certification remain untested.

## Checkpoint 19 — two independent HTTP processes and session revocation

`CONTINUE-AUDIT-CHECKPOINT-19.md`, `certification-summary-checkpoint19.json` and `certification-summary-checkpoint19-boundary.json` test **two separate Node processes with distinct localhost ports and independent connections to one disposable SQLite WAL database**. Logout on the second process revokes the signed session; all **four GET/POST attempts** with that cookie across both workers return `401`, as do two signature-tampering attempts. The previously admitted SSE still finishes, and a new signed session reads its cached review from both servers. A QA-only faulty worker deliberately grants a revoked-cookie request and the **real HTTP benchmark fails**, while **34/34 forged evidence packets are rejected**. These controls strengthen independent authorization evidence; they do not establish browser/proxy behavior, a forced in-flight cancellation policy or full product/release security certification.

## Checkpoint 20 — real Chrome navigation, manual cancel, logout and adversarial uncanceled fetch

`CONTINUE-AUDIT-CHECKPOINT-20.md`, `certification-summary-checkpoint20.json` and `certification-summary-checkpoint20-boundary.json` replace the prior source-only prediction with an actual isolated **Google Chrome 157** test of Agent C's React Game Review/UI and Agent B's real backend Hono routes. Navigation away, the explicit **Cancel generation** button, and real **Log out** each close the active model connection and prevent caching an incomplete report. The **QA-only Chrome-injected missing AbortSignal** counterexample retains the real model connection and causes a report to persist after navigation. A second **separate-process real-browser negative control** corrupts the normally passing navigation case; it produces a genuinely cached stale report, correctly exits **nonzero**, and is independently rejected despite forged green flags. Four browser scenarios per run, 12 local mock-model calls per run, no uncaught browser exceptions, and **42/42 forged QA evidence packets rejected**. Fresh UUIDs bind each run to its own raw evidence. Chrome uses a disposable profile and all chess/user data are synthetic; this is neither a production release certificate nor a sealed holdout.

## Checkpoint 21 — same-game Cancel → immediate Retry, both old/new completion orders

`CONTINUE-AUDIT-CHECKPOINT-21.md` and `certification-summary-checkpoint21.json` independently test **two real Chrome Game Review POSTs for one synthetic game**, clicking **Cancel generation** then **Write AI report** without waiting for the first model request to close. The genuine browser correctly closes the old response; the replacement saves and displays **SECOND GENERATION**. With an intentionally broken **QA-only** fetch AbortSignal, the canceled **old-first** writer instead caches **FIRST GENERATION** and the new writer reports `review_source_changed`; in the **old-last** order, the backend's atomic CAS prevents overwriting the newer cache. The benchmark expects exits **0 / 1 / 1**, rejects both faulty cases as green even when their eventual cache is correct, binds each test to a distinct UUID and rejects **129/129 forged QA packets**. All user/game data are synthetic, the candidate sources remain read-only and release certification remains blocked.

## Checkpoint 22 — cancellation during phase and key-moment model calls

`CONTINUE-AUDIT-CHECKPOINT-22.md` and `certification-summary-checkpoint22.json` use a **single disposable Chrome profile per run** to test real React Cancel → Retry while the initial model reply is held during **phase generation** or **key-moment explanation**. The normal browser closes each canceled stream and saves only the retry; an independently verified **QA-only suppression of the first report controller's actual `abort()` call** lets the obsolete generation continue and save/display a stale report, blocking the replacement with `review_source_changed`. The real-browser negative exits nonzero, not green. The first attempted negative control (dropping only the fetch signal) was correctly rejected as ineffective at these early stages; the stronger fault is independently evidenced. **116/116 forged QA evidence packets rejected**, with fresh run IDs and unchanged read-only candidate worktrees. Production SQLite, live sessions, private games and user browser profiles remain untouched; full release certification remains blocked.

## Checkpoint 23 — cross-session profile change during live Chrome Game Review

`CONTINUE-AUDIT-CHECKPOINT-23.md` and `certification-summary-checkpoint23.json` extend earlier backend/component profile-race evidence to the **actual Chrome/React + Hono + second signed Settings session**: changing an in-flight English/beginner report's preferred profile to Spanish/advanced permits stale English prose to reach the first browser and SQLite, while an authenticated fresh GET rejects it and the auto-regeneration queue does **not** schedule it. Manual Spanish/advanced regeneration succeeds. The Spanish UI independently retains root `<html lang="en">`, a potential screen-reader language problem for Agent C. A deliberate **QA-only wrong-profile HTTP-cache response** fails the new real-browser gate, **114/114** forged evidence packets are rejected, and a previously found Chrome QA timeout-loop leak was fixed and independently regression-tested. All test sessions/PGNs are synthetic and DB/browser profiles disposable; no owner-source changes, release approval or sealed holdout.

## Checkpoint 24 — independently falsified coach-verifier legal-board and temporal false greens

`CONTINUE-AUDIT-CHECKPOINT-24.md` and `certification-summary-checkpoint24.json` close **two genuine QA checker false greens**: a report-injected but **legal unrelated FEN** incorrectly verified a false king square, and contradictory **before/after** pawn locations were accepted against either adjacent position. The independent checker now binds moment **ply/side/SAN/FEN** to actual source-PGN legal replay, never to the model's claimed board, and narrowly anchors recognized "Before/After the move" assertions. Ambiguous grammar continues to abstain; `full_factuality_certified` stays **false**, including on invalid input. The new **58/58** source/temporal controls, original **18/18** controls and **38/38** forged real-pipeline evidence packets pass; a fresh UUID-linked execution of Agent B's actual review builder still reproduces **both** deliberately false synthetic model claims despite **27/27** passing upstream targeted tests. This is a stronger **blocked** product gate, not approval of factuality or release.

## Checkpoint 25 — honest partial coverage and five-language abstention

`CONTINUE-AUDIT-CHECKPOINT-25.md` and `certification-summary-checkpoint25.json` fix a misleading **QA partial pass** in which a correct literal masked unsupported, false implicit prose, and a **QA false rejection** of expressly quoted/denied assertions. The claim adapter now reports `partial_claims_verified` with an explicit ledger of unchecked prose spans and disavowed quotations, separately from a narrowly verified literal result. A 59-case independently checked scope/abstention matrix yields **6** limited verified literal cases, **11** direct contradictions rejected, **27** partial results with visible unknowns and **15** not evaluated. Its five-language evidence comes from previously pinned real Agent B output with a QA-authored local model, not new real-world model calls or human translations. **48/48** forged-scope evidence packets are rejected and a UUID-bound fresh subprocess challenges false green claims. The QA checker still does **not** certify full prose or any non-English content; Agent B's previously reproduced false model claims, all historical release blockers and `main` remain unchanged.

## Checkpoint 26 — conditional and imagined chess claims are not played-game assertions

`CONTINUE-AUDIT-CHECKPOINT-26.md` and `certification-summary-checkpoint26.json` reproduce and fix a **QA false rejection** of hypothetical claims (`If White won the game`, `Suppose White's king is on e2`) and a **QA false-positive proof** of true conditional antecedents (`If Black won the game`). The independent checker now abstains on deliberately bounded English conditionals, questions and speculative lexical forms, preserving direct false-winner and false-piece rejection in separate sentences. **68/68** synthetic checks: **51** not evaluated, **7** partially verified with explicit uncertainties, **6** direct contradictions rejected, **4** narrow literal truths verified; **44** independently enumerated gold cases and **48/48** forged-evidence controls. Self-audit also caught an aggregate-preserving swapped result that initially escaped the verifier; the independent proof now SHA256-pins every test input and individual outcome. Previous 18/58/59-case checks, the real coach-output attack, fixtures, and app contracts remain green. No human-sealed holdout, production model, owner source or mainline deployment is certified.

## Checkpoint 27 — do not call unproved resignation claims factual contradictions

`CONTINUE-AUDIT-CHECKPOINT-27.md` and `certification-summary-checkpoint27.json` independently reproduce and fix a **QA false rejection** of any winner statement from a nonterminal PGN (including real-world-like resignation, timeout, agreement and unspecified Result metadata). A Result header alone cannot prove a terminal event. Conversely the legal board independently establishes checkmate or forced draw; a wrongly declared decisive result is then a genuine contradiction, whereas `*` is not an incorrect tag. **15** legal synthetic games, **67/67** result/position cases (**37** not evaluated, **4** partially verified, **24** rejected, **2** narrowly verified), **32** hand-checked gold cases and **48/48** forged-result evidence controls demonstrate the distinction. The original QA regression was also corrected: its former 2-ply unfinished sample incorrectly paired with a ply-3 moment, masking the real outcome test. No deployed model, production user, owner source, PR #17 or mainline mutation; release approval remains blocked.
