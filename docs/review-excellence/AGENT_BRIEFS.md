# Four-agent charter, branch fences, handoff contracts and ready-to-send briefs

**Status:** planning artifact only. **No agents are launched by this document**; no agent is approved to edit production, merge PRs or start implementation without a separate user instruction.
**Coordinator/integrator:** ChatGPT lead acting for the repository owner.
**Required reading:** [MASTER_PLAN.md](MASTER_PLAN.md), [BENCHMARK_SPEC.md](BENCHMARK_SPEC.md), this file and the relevant real source modules.
**Base at creation:** GitHub repository `MousaXD/patzer`, `main` SHA `60162725626fbc53e8760c6027b91bf6d8805fd1` as of 2026-11-11. **Fetch current remote SHA when starting.**
**Separate open change:** [accuracy fix PR #17](https://github.com/MousaXD/patzer/pull/17), green but *not merged* at authoring. It touches scoring backend and Review/report UI. **Do not cherry-pick/merge/deploy it as a side effect of research.**

## 1. Team charter and operating rules

**Purpose:** four independent, specialized agents audit, propose and (only after authorization) implement **measurable** improvements in chess truth, teaching, practice UX and benchmark certification. All are accountable to common frozen criteria, not their own passing tests alone.

**Operating invariants across all lanes:**

- Fetch `origin`, confirm branch, `git status`, remote `main` SHA and PR #17. Create **one isolated worktree/branch per lane**; do not edit owner/other-agent worktrees or stage unrelated files.
- Prefer reading code and running targeted local checks over guessing from older handoffs. Document findings with file:line, exact repro, severity, evidence and consequence.
- Never call an existing capability *absent* without searching for it (especially coach facts, legal variations, `/train`, review UI state, platform pagination and Stockfish cancellations).
- **No work on active SQLite** or credential files: no `cp` from WAL live DB, database mutation, `.env`/password reads unless an explicitly approved, narrowly scoped health check. Use synthetic fixtures or online read-only snapshot backups for testing. No mass engine reanalysis or LLM generations.
- Do not alter GitHub Actions release/publishing, the 12-hour automatic updater, user systemd service, MCP tunnel, account/security settings, or `server/src/autoImport.ts`.
- Respect no cheating: no engine assistance for a live rated online chess game; test completed games/offline practice only. Never bypass Chess.com membership quotas or undocumented API access controls.
- Keep a concise handoff at the end: head SHA, diff, tests and actual results, risk, known gaps, cross-agent interfaces, proposed next step, PR link if created. Do not claim green CI without its exact status.
- No blind global search-and-replace across shared modules. If a change must touch another lane's files, stop and use the **change request protocol** below.
- All new user-visible functionality needs accessible loading/error/cancellation/empty states and honest confidence. No invented accuracy, no speculative mate, no absent engine represented as 0.00.
- No claims like "perfect", "100% accurate", "reproduces CAPS2", "fully accessible" or "Chess.com best" without appropriate controlled evidence.

### Default branch/worktree allocation (proposals, create only when separately authorized)

| Lane | New branch | Suggested local worktree path | Owns |
| --- | --- | --- | --- |
| A | `agent/review-engine-20261111` | `patzer-review-engine-20261111` | Engine/scoring correctness |
| B | `agent/review-coach-20261111` | `patzer-review-coach-20261111` | AI coach truth/learning evidence |
| C | `agent/review-product-20261111` | `patzer-review-product-20261111` | Review and retry UX |
| D | `agent/review-benchmark-20261111` | `patzer-review-benchmark-20261111` | QA/data/benchmark/reliability |
| Integrator | `integration/review-excellence-<wave>` | Separate integration worktree | Contract resolution, merge certification |

Do not reuse the historical `agent/*-20261110` branches: those four were already integrated. If branch/worktree exists, compare its tracked SHA and use a distinct new name rather than resetting it.

### Source ownership and shared-contract rule

| File/path | Primary editing owner | Allowed collaboration |
| --- | --- | --- |
| `server/src/chess/{accuracy,classifier,stockfish,engine,analysisAgentWork,variationScoring,keyMoments,phases}.ts`, `routes/analyze.ts`, engine tests | A | B consumes structured evidence; D writes tests/fixtures outside A's source; integrator handles PR #17 conflicts |
| `server/src/coach/*`, `server/src/routes/{review,coach}.ts`, coach tests | B | A provides engine evidence contract; C consumes versioned coach DTO |
| `web/src/pages/{GameAnalyzer,Review,Train}.tsx`, `web/src/components/{GameReportPanel,GameReportCard,MoveExplanation,KeyMomentsList,EvalGraph,ChessBoard}.tsx`, `web/src/components/review/*`, adjacent UI tests | C | B creates structured content contract; A provides score metadata; do not edit backend without contract |
| `qa/review-excellence/*`, `scripts/review-benchmark*`, redistributable fixture manifests, benchmark reports, performance/security QA | D | A/B/C submit candidate cases; D does not change their formulas/components |
| `server/src/db.ts`, `dbMigrations.ts`, shared `server/src/types.ts`, `web/src/api.ts`, `web/src/types.ts`, `package.json`, lock file, `.github/workflows/*` | **Integrator-controlled shared** | Draft schema/change request first; no opportunistic edits |
| `server/src/autoImport.ts`, live data, secrets, MCP tunnel, systemd user service, upstream auto-update unit | **Protected; no agent** | Owner may authorize narrowly scoped separate work |
| `docs/review-excellence/*` (this planning package) | Integrator | Any agent proposes changes in PR; integrator maintains frozen version/decisions |

Not every path listed exists yet; `qa/review-excellence/*` and benchmark scripts are **planned** locations. Ownership is a coordination tool, not an excuse to hide needed cross-lane tests. For example, A can request tests that D authors, and D can inspect A's code read-only.

## 2. Interface contract before parallel implementation

Agents must submit an **interface request** before modifying shared data contracts:

```yaml
contract_change_id: CONTRACT-001
producer: agent-A
consumer: agent-B-and-C
purpose: "Explain one documented engine fact to the end user"
proposed_schema_version: 1
proposed_fields:
  - source_fen
  - actor_color
  - played_move_uci
  - best_candidates
  - score_perspective
  - reached_depth
  - evidence_confidence
nullable_fields:
  - mate_in
  - best_candidates
privacy_risk: "none expected on public fixture; reassess for user PGNs"
rollback_compatibility: "old response fields remain valid"
tests_required:
  - deterministic FEN/PV legal validator
  - old-client/new-backend compatibility
approvals:
  producer: pending
  consumer: pending
  integrator: pending
```

This is an **illustrative change-request format**, not an existing API/schema or permission to change `server/src/types.ts`.

**Requirements for proposed evidence DTOs:** normalized eval POV, exact FEN/ply/player, legal PV UCI + optional SAN, mate vs CP, engine identity/budget/termination, classified move and qualified alternatives, `scoring_version`, `evidence_status`. Consumers treat absent fields as unknown, not 0. Use additive versioning; no sudden rename of `accuracy_white` or `analysis.moves` in existing APIs without migration plan and tests.

## 3. Phase dependencies and agent communication

| Step | A — Engine | B — Coach | C — Product | D — Benchmark | Integrator |
| --- | --- | --- | --- | --- | --- |
| **0: inspect** | Map scoring/engine failure hypotheses | Map truth/LLM gaps | Map review/retry UX | Draft fixtures, labels and replay protocol | Freeze baseline, PR #17 decision |
| **1: benchmark freeze** | Review adversarial cases | Review annotation rubric | Add no UX-dependent labels | Lock dev/holdout manifest and runner proposal | Approve dataset/ownership |
| **2: narrow implementation** | Fix verified engine error | Harden facts claim validation | Build verified Retry slice with mocks | Add independent checks/perf | Freeze API and integrate incrementally |
| **3: integration** | Validate on combined head | Check content/accuracy alignment | Visual + accessibility certification | Run locked holdout, regressions | Resolve conflicts, approve or revert |
| **4: release** | Provide scoring model/migration notes | Review cache/prose compatibility | UX smoke on release | Consolidate evidence/monitoring | Owner decides merge/deploy |

**Handoff format:**

```
Agent/lane:
Base main SHA; own branch/remote HEAD:
User-visible problem and exact repro:
Changed files (or audit-only):
Test evidence (commands + counts + SHA):
Benchmark diff (dev/holdout + engine config + uncertainty):
Security/privacy/chess-correctness implications:
Conflicts/contract changes requested:
Known failures/nonclaims:
Suggested single next action:
```

## 4. First assignment — Agent A: chess engine and scorer

**Role:** Staff Chess Engine / chess rules correctness engineer, with a bias for proofs, hard-to-detect edge cases and stable performance.

**Read:** `MASTER_PLAN.md` sections 3, 6, 7, 11, 14; `BENCHMARK_SPEC.md`; `server/src/chess/{stockfish,engine,classifier,accuracy,analysisAgentWork,keyMoments,phases,variationScoring,startFen}.ts`; `server/src/routes/analyze.ts`; relevant engine tests; PR #17 **read-only** diff.

**Phase 0 task (audit/research only unless owner explicitly grants a specific implementation wave):**

1. Map what each evaluation field means—White vs side-to-move vs player POV; mate sign, best SAN/UCI, what depth means and whether scores can be stale.
2. Identify risk in `MultiPV=3` per ply: alternative uniqueness, cost, gaps, unstable horizon, forced replies and short game/timeouts. Contrast Stockfish 17 (verified current local) with any proposed engine upgrades without installing them on live system.
3. Build a **read-only finding table** for difficult FENs: custom start, Black-first, EP, promotions, repetition, mates, best-vs-equivalent moves, already lost positions, one big mistake in a good game. Refer D to fixtures to be added.
4. Analyze v9 baseline and PR #17 v10 hypotheses separately. Document why a correction may be appropriate and what would falsify it; **do not re-implement or merge PR #17**.
5. Propose a bounded algorithm-test plan with deterministic reference contracts. Identify where code can be changed with minimal impact on `routes/analyze` cache and historic scoring.

**Deliverable:** `A-ENGINE-AUDIT.md` in own branch/PR (once authorized), with exact file/line citations, severity, minimal reproductions, hypothesized root cause, proposed tests and candidate API contract. Do not commit raw user games. The first implementation must be a narrow, reproducible chess-correctness fix, not a multi-thousand-line scorer rewrite.

**Hard gates:** no illegal line, no wrong eval perspective, no data mutation, existing engine admission/cancel tests must pass; score changes carry model version and migration consequences.

**Do not edit:** `server/src/coach/*`, UI modules, database/migrations, benchmark truth labels, auto-sync, credentials, deployment scripts.

## 5. First assignment — Agent B: evidence-grounded coach and pedagogy

**Role:** Chess pedagogy specialist + senior backend AI reliability engineer; objective is correct *explanations* rather than fluent ungrounded prose.

**Read:** `MASTER_PLAN.md` sections 5, 8, 9; `BENCHMARK_SPEC.md` sections E–G; `server/src/coach/{review,explain,coaching,facts,facts-utils,tactics,memory,llm}.ts`; `/routes/review.ts`, `autoReview.ts`; current coach tests. Review A's proposed engine facts contract before requiring new fields.

**Phase 0 task (audit/research only):**

1. Trace how AI summary/key-moment explanations are constructed, streamed, cached and invalidated. Establish whether board-square/mate/causality assertions are individually validated, not just whether verdict sentiment is correct.
2. Curate at least **20 candidate claims for D's rubric** with examples from synthetic/public positions, tagged supported/false/uncertain under current code. Do not publish personal PGNs.
3. Design deterministic `claim_id`, evidence/source-FEN, forcedness proof and validation statuses; check safe fallback when LLM unconfigured or response incomplete.
4. Propose three player-facing levels: (a) concise why, (b) step-by-step refutation, (c) question/hint before answer; ensure consistency in existing languages.
5. Design one repeat-mistake learning record with privacy/retention thought through; do not modify tables or call an LLM in bulk.

**Deliverable:** `B-COACH-TRUTH-AUDIT.md` with an evidence rubric, 3–5 concrete claim-contract examples, hallucination modes, safe output templates, proposed evaluator and possible **one** implementation slice.

**Hard gates:** zero critical board/actor/forced-line errors on agreed gold fixtures; evidence absence results in qualified truth/fallback; no prompt injection or XSS from PGN/LLM; no unapproved model costs.

**Do not edit:** chess scoring internals, React UI (except through consumer contract requests), database or updater.

## 6. First assignment — Agent C: Game Review UX, retries and accessibility

**Role:** Principal Chess Product Designer + Staff React/Accessibility Engineer; benchmark the *learning path*, not visual decoration.

**Read:** `MASTER_PLAN.md` sections 2, 9, 10; `BENCHMARK_SPEC.md` F5 and J; `web/src/pages/{GameAnalyzer,Review,Train}.tsx`; `web/src/components/{ChessBoard,GameReportPanel,GameReportCard,MoveList,MoveExplanation,EvalGraph,KeyMomentsList}.tsx`; `web/src/components/review/*`; prior frontend audit and browser QA.

**Phase 0 task (audit/research only):**

1. Walk a complete user journey: open completed game → locate a mistake → discover why → retry blind → evaluate attempt → explain alternative → return to original game. Label which steps exist, which are confusing, and which are **not implemented**.
2. Inspect current Review UI and browser/state edges: arrow keys, edit controls, move list, graph, legal branch creation, modal, promotion, touch, slow engine, no LLM, stale analysis, game switch.
3. Propose one minimal **"Learn from this mistake"** vertical slice. First draft a dependency-light component state model with accessible blind mode; account for hidden answer leaks in graph, ARIA and PV.
4. Record objective accessibility/behavior defects with exact user action and fix strategy; don't conflate opinions with failures. Verify at tested viewports and zoom.
5. Define telemetry that measures independent first-attempt success, not screen time or button clicks. State how screenshots and browser smoke tests will prove legal FEN/PGN immutability.

**Deliverable:** `C-REVIEW-UX-AUDIT.md` with journey map, interaction/state machine, UI copy, responsive/focus checklist, API dependencies and 10 concrete acceptance tests. Mock data is allowed for design, not a license to invent backend behavior.

**Hard gates:** never mutate PGN from exploration; no stale cross-game state; keyboard/touch/screen reader access; every disabled/busy/unavailable state honest; answer cannot leak before attempt.

**Do not edit:** server engines, LLM, core auth, DB migrations, platform benchmark data.

## 7. First assignment — Agent D: reproducible benchmark, platform and data guardian

**Role:** Principal Test/QA Architect + Platform Reliability Engineer. Your job is to **falsify** optimistic claims from A/B/C and produce evidence that survives integration.

**Read:** all [BENCHMARK_SPEC.md](BENCHMARK_SPEC.md); `MASTER_PLAN.md` sections 3, 5, 11, 14, 15; `qa/agent07/frontend-overhaul-smoke.mjs`; `qa/product-ui/settings-navigation-smoke.mjs`; repository test/E2E scripts; database schemas and security routes; integration handoff.

**Phase 0 task (research + blueprint, implementation only if separately authorized):**

1. Create a reproducible plan for gold fixtures, licensing/consent provenance, JSONL manifest, dev/holdout split, engine binary/config recording and gold-label adjudication.
2. Identify where current QA provides real evidence vs merely checks smoke routes. Propose executable engine benchmark, claim validator harness and browser learning-flow smoke under a **fixed CPU/elapsed-budget**.
3. Define baseline metrics and artifact reports (n, MAE/bias, illegal PV, claim truth, latency, CPU/RAM, canceled jobs, PGN hash invariants) and how to account for paired game observations.
4. Design independent **negative controls**: an injected illegal PV, reversed eval sign, fabricated forced mate and stale game response must fail the harness; otherwise its green output cannot certify correctness.
5. Perform a read-only audit of migration/cache hazards and readiness of PR #17; no migration or auto-sync invocation. Identify exact privacy, performance and deployment risks.

**Deliverable:** `D-BENCHMARK-PLATFORM-AUDIT.md` with dataset manifest proposal, baseline execution script design, 10+ falsifiable fixtures, licensing table, performance plan, false-positive/negative cases and release gate. Never score other agents by reading their private test data without an agreed split/consent.

**Hard gates:** no private user data copied into repo, no live DB writes/service restart, deterministic reference configuration, negative controls detect injected errors, every missing/unknown status reported honestly.

**Do not edit:** A's source scorers, B's coach generator, C's UI, auth/migrations or updater without approved change contract.

## 8. Integrator role: what the manager must actually do

1. **Inventory:** confirm the four new branch heads are based on the intended `main`; fetch all remotes, PR #17 status and changed-file sets.
2. **Read all reports critically:** findings with no reproducible evidence remain hypotheses; reconcile contradictory results and demand minimal repros.
3. **Freeze evidence and interfaces:** approve/lock dataset version and test split, annotate contract versions, choose one wave, order merges to avoid type/API conflicts.
4. **Integration:** merge candidate remote heads (not stale local heads) into **separate integration worktree**, verify each is an ancestor. Run comprehensive local typecheck/unit/build/MCP/browser/e2e; perform independent negative-control checks.
5. **GitHub:** open one integration PR, wait for all exact combined-head required checks; don't merge if queued/failing. Report CI access blockers without inventing success.
6. **Release:** get owner approval for DB migration and deployment, back up/verify, monitor service and user-visible behavior, preserve rollback. A merge request alone is not consent to migrate data.
7. **Feedback:** update the decision ledger and benchmark regression trend; reject/roll back improvements that reduce teaching quality despite better cosmetic scores.

### Conflict resolution order

- No file overlap: merge code normally; still test cross-lane behavior.
- Same file touched with independent changes: assign one primary owner; the other supplies a small patch/contract request for that owner to apply.
- Semantic API conflict: write a versioned compatibility proposal; freeze producers/consumers; update both using integrator-owned mini-PR.
- Unknown data impact: **block** merge/deployment until assessed; never choose "tests pass" as a proxy for migration safety.
- PR #17 score changes: integrator resolves against current `main` before merging A or C, with old-prose and backfill safeguards preserved.

## 9. PR completion rubric and severity

### Findings priority

- **P0**: corrupt or leak private user data; wrong move legally shown as playable; cross-account auth leak; dangerous destructive migration; broken main deployment.
- **P1**: incorrect mate/actor/forced-line claim; repeated hanging review; critical stale analysis state; unusable keyboard/mobile study path; widespread inflated/meaningless scoring.
- **P2**: inconsistent classifications at bounded depth, non-blocking misleading copy, moderate UX/performance issue, non-critical accessibility violation.
- **P3**: minor visual polish, optional enhancements, nice-to-have architecture cleanup.

A genuine P0/P1 should get a narrowly scoped fix and tests before adding new features. Critical failures from current code require the owner to decide hotfix priority versus the benchmark initiative.

### Before an agent calls work "done"

- The report says **what actually ran** and its real output (counts, successes, failures, skipped), plus exact `git SHA`.
- The branch is clean, committed and pushed only to **its own** remote branch; never pushes directly to `main` unless expressly authorized for that specific task.
- New source behavior has negative tests, real edge tests and production build. Browser UI has a real Chromium interaction smoke on disposable data.
- A change touching scoring/prose has versioning, old data/score compatibility and a migration/non-migration plan.
- Conflicts with other lanes are disclosed, not hidden by rebasing their work into a local stale tree.
- Agent makes **no assertion of production deployment**, no request for a user to rerun already-run tests, and no vague "all good" certification.

## 10. Copy-and-send kickoff message for any of the four agents

> You are one of four Patzer Review Excellence agents. Repository: `https://github.com/MousaXD/patzer`. First read `docs/review-excellence/MASTER_PLAN.md`, `docs/review-excellence/BENCHMARK_SPEC.md` and your lane in `docs/review-excellence/AGENT_BRIEFS.md`. Fetch `origin/main`, inspect the latest HEAD and open PR #17, and create your **own isolated branch/worktree**—never work in the owner's live service checkout. Your first job is your lane's **Phase 0 evidence-first audit and proposal**. Do not implement product changes, merge another branch, migrate data, access secrets, run heavy analysis on the live database or restart the app unless the owner separately authorizes a specific wave. Find actual file/line root causes, reproducible edge cases, benchmarks/negative controls and a precise scope. Obey file ownership; send a proposed versioned interface change rather than touching another lane's files. Verify with bounded local tests when meaningful, write a detailed handoff, commit/push only your own report branch, and clearly distinguish verified facts from hypotheses, known gaps and future work. The owner/integrator will arbitrate next steps.

This common kickoff message becomes agent-specific by appending **"Your lane is A / B / C / D"**. The detailed briefs above are the full scope: no invented general-manager tasks and no unauthorized background work.

## 11. Approval and decision placeholders

| Approval | Needed before | Current state |
| --- | --- | --- |
| Owner approves starting the agents | Any tool/code/PR work beyond documentation | **Not granted by this report request** |
| Integrator freezes manifest/holdout | Tuning formulas, prompt samples or scoring thresholds | Pending |
| Owner decides PR #17 release order | Merging or deploying v10 score/migration | Pending; **open with green CI** at authoring |
| Owner approves data collection/share | User-game dataset exports, reviewer consent | Pending |
| Owner approves production migration/restart | DB migration, deployment, service restart | Pending |
| Owner approves any new license/API/provider costs | Installing or shipping new dependencies/LLM | Pending |

**Final principle:** parallel agents speed up finding issues; only a single coordinated evidence and integration gate makes the result trustworthy.
