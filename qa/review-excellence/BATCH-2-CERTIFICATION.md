# Agent D — Batch 2 real-system certification handoff

**Result:** QA infrastructure increment **ready for code review**; full scoring, coach and UI integration **NOT certified**. No production DB, active service, credentials, authenticated game traffic or updater touched.

## Locked identities and provenance

- Test checkout was based on `main` **51df1d852296e5f0644127a81b5ec31109c8e6c1**, with Agent D prior commit `45445d3e4c136db66f678091667f0c646676be59`.
- Manifest v1 (unchanged): SHA256 **79300b25e5602a72c6781bc0106bd43da73db1c4cfb1d119c8950d9649ac454b**.
- Manifest v2 (additive, self-authored): SHA256 **2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44**; 25 fixtures (original 14 + 11), 147 PGN plies. No sealed holdout/human-reviewed labels. New custom-FEN games cover White material advantage with Black to move, underpromotion, single forced reply, fifty-move draw, SAN disambiguation and a 96-ply synthetic repetition sequence.
- Local engine experiment: **Stockfish 16-1build1** (Ubuntu noble package, unpacked to ignored results), executable SHA256 **00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca**. It is not the Stockfish 17 claimed by the live instance. One thread, 16 MiB hash, MultiPV=3, depth 8 direct analyzer, depth 12 separate UCI microbenchmark. Engine files not committed.

## Independent outcomes actually observed

| Evidence | Observation |
| --- | --- |
| Deterministic manifest v2 | 25 / 25 passed; 0 failures |
| Real `analyzePgn()`, initial 2 games | 11 plies, zero adapter failures, 7 / 7 app-output negative controls rejected |
| Real `analyzePgn()`, 5-game paired cohort | 18 plies, no adapter failures, 8 / 8 output corruptions rejected across main, A, B, C and proposed v10 |
| Deliberately broken **UCI engine** piped through actual analyzer | 3 / 3 rejected: wrong eval sign vs trusted reference, illegal best/PV salvaged by app, fabricated mate-in-one disproved by legal chess |
| Long synthetic 96-ply repetition fixture | Actual `analyzePgn()` 681 ms at depth 8, no adapter issues; one run only |
| Lifecycle | Aborted-before-start, active abort (~68 ms), one-engine busy rejection, nonexistent executable, engine crash: pass |
| Disposable SQLite library microprobe | 2,000 rows: 50-row last-page query 0.608 ms; 10,000 rows: 3.682 ms; **not** HTTP/UI performance |
| Direct UCI depth 12 (3 positions × 3 repeats) | 9/9 reached depth 12, no illegal PV; top score range 0 within each tested position; Black-to-move material advantage 68,845 nodes, 24–28 ms per trial |
| UCI engine resources | Same sample engine peak RSS ~155–156 MB; CPU tick count around 20–30 ms for materially longer searches, near-zero for fast forced positions; Linux /proc process measurement |
| Supplemental candidate-owned unit tests | A (latest) 50 passed, 4 Stockfish-real tests skipped; B 8 passed; C 4 passed; proposed v10 5 passed. **Not independent certification** |

Standalone app wall time for five-game + sampled reference comparison: main 2,210 ms; A 2,368 ms; B 2,063 ms; C 1,943 ms; v10 1,978 ms. Differences are noise-prone single-machine samples, no performance winner established. Node peak RSS in short app sample ~153–175 MB; **engine** RSS is measured separately in the direct UCI run.

## Candidate snapshots and rule against false "improvement" claims

| Candidate | SHA | Scoring | Result |
| --- | --- | --- | --- |
| `origin/main` | `51df1d8` | v9 | 5 / 5 cases, 8 / 8 mutations |
| Agent A, chess engine | `edc1b2e` | v9 | 5 / 5, 8 / 8 |
| Agent B, coach | `6fde1ea` | v9 | 5 / 5, 8 / 8 |
| Agent C, review product | `326e825` | v9 | 5 / 5, 8 / 8 |
| PR #17's proposed scorer (unmerged) | `02bfe98` | v10 | 5 / 5, 8 / 8 |

The v9 candidates' per-game accuracy matched main exactly on this cohort. The v10 underpromotion example changed White accuracy from **38.8** (v9) to **17.6** (v10); a measurement, **not** correctness proof. All v10 comparisons remain separate from v9 for historic statistics. No v10 backfill/migration was executed.

**Agent A:** the latest commit adds zero-evidence-rating gates and engine provenance to earlier PV validation and hosted-engine legality work; candidate analyzer passed, but four Stockfish-real tests skipped in the supplemental run. The 50 other targeted tests passed. Independent engine-16 adversarial checks are useful but cannot certify Stockfish-17 parity or all MultiPV pathological cases.

**Agent B:** the code adds offline evidence fallback and perspective tests; direct analyzer did not exercise generated natural-language coach output or LLM failures. The test-only structured claims in this benchmark are a *proposed evidence boundary*, not real emitted coach DTOs. **Teaching factuality remains uncertified.**

**Agent C:** the code adds a spoiler-free mistake retry component; its 4 targeted tests passed. We did not run an independent real browser study/task/keyboard/ARIA audit of the full Game Review workflow. **Product learning improvement remains uncertified.**

## Falsification findings and limits

1. Earlier harness falsely failed a correct case after mutating the validation board; fixed in Batch 1.
2. A coherent, whole-game evaluation sign reversal *can pass mere FEN continuity*. New cross-process independent engine reference detects it on an asymmetric Black-first fixture.
3. Patzer can truncate an illegal engine PV to an empty SAN line. A benchmark inspecting only serialized legal SAN can erroneously report green. The injected fake UCI engine demonstrated that path; the updated checker requires best-move evidence when the independently reached reference has a best move.
4. A fabricated mate-in-one can be represented as a numerically plausible score. The updated checker enumerates legal replies for a proven mate-in-one claim and rejects a false one. **Mate-in-N for N > 1 is not yet proven.**
5. Reference engine and application engine must be **separate binary options**. Testing a broken app with the same broken executable as referee is circular; the fake-engine controls deliberately supply distinct binaries.
6. All fixture labels are public to candidates; current branch comparisons do not measure unknown-game generalization. No release should be approved on these dev results alone.

## Outstanding blockers and decision

- **P0 release gate:** sealed non-leaking holdout with human adjudication and independent calibration still absent. `HOLDOUT_PROTOCOL.md` is a **proposal**, not an executed study.
- **P1:** first-class engine-evidence DTO from app to coach; validate actual unstructured AI text, refusal/abstention and unsupported causal claims. A structured claim sidecar attached only during benchmark is insufficient.
- **P1:** independent Game Review browser journey, accessibility and retry answer-leak task battery needed.
- **P1:** HTTP admission/auth/CSRF isolation and real multi-user contention, worker crash and large-catalog end-to-end limits not yet exercised.
- **P1:** pinned Stockfish 17 (or approved alternative) and broader node/depth/MultiPV stability, mate tablebases and genuinely hard drawn positions not assessed.
- **P2:** repeated trials/latency distribution and CI portability. Current statistics describe one machine and small synthetic cases.

**Recommendation:** open Agent D QA-only PR for review. Do not merge A/B/C or PR #17 *on the assertion of a certified improvement* until their distinct human-learning, engine/factuality and UI gates have evidence. No auto-merge/deploy of any branch. The immutable candidate and runtime summary is in `certification-summary-batch2.json`.
