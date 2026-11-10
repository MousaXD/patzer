# Review Excellence Benchmark — dataset, evidence and reproducibility contract

**Status:** specification for future work. No new fixtures, data extraction, benchmark runner or user-data exports are performed by this documentation commit.
**Read first:** [MASTER_PLAN.md](MASTER_PLAN.md) (mission, gates, scoring policy) and [AGENT_BRIEFS.md](AGENT_BRIEFS.md) (file owners).
**Primary owner:** Agent D (platform/benchmark); **gold-label disputes:** chess engine owner + independent human chess reviewer; **holdout access:** integrator only.

## A. Definition of evidence

A review benchmark is **not** a collection of favorable screenshots or a game-accuracy number. It must evaluate four separate questions:

1. **Chess state truth:** Is a position legal? Are player, color, side to move, SAN/UCI, variant, outcome, check/mate/draw and every displayed PV correct?
2. **Engine-backed claim:** Given an explicit engine/build and search budget, is the suggested move and classification justified? Can the claimed tactic/forced line be demonstrated?
3. **Communication correctness:** Does text match the position, reflect verified evidence, distinguish facts from hypotheses, avoid fabricated threats and let a person understand why?
4. **Player learning:** Can a player identify or solve analogous mistakes **without hints** after using the feature, compared with a control experience?

No dataset can prove all four by itself. Report each separately with its own source of truth and uncertainty.

## B. Dataset plan and splits

### B1. Proposed seed population (targets, not data already obtained)

| Set | Goal | Required strata | Notes |
| --- | ---: | --- | --- |
| `GAMES_DEV` | 150 completed games | length, rating buckets if available, time class, result, opening, decisive vs balanced, mate/timeout/resignation | Can begin with licensed public PGNs and synthetics; no need to collect CAPS2 |
| `GAMES_TEST` | 50 held-out games | same as above | Keep whole-game, player and exact-position leakage out when feasible |
| `POSITIONS_DEV` | 75 adversarial positions | rule edges, mate, forced alternatives, tactical and positional themes, tablebase endings | Expert labels and reproducible engine references |
| `POSITIONS_TEST` | 25 sealed positions | balanced themes | Never tune model/prompt after seeing test labels |
| `EXPLANATIONS_GOLD` | 50 assessed claims | piece/square, tactic, cause, consequence, alternative, helpfulness | Requires human annotation; no blind faith in LLM |
| `EDGE_GAMES` | 30 long/invalid/unusual scenarios | 250+ plies, FEN starts, promotion/EP/castle, incomplete/aborted PGN, timeout, disconnection | Can overlap development, never test |

The 200-game total is **not** 400 independent observations because each game contributes correlated White and Black scores; cluster uncertainty by game, preferably also player. If a held-out game shares identical late opening positions with training games, note the overlap and avoid treating exact FEN matches as independent evidence.

### B2. Stratification

Reserve planned buckets instead of conveniently picking accessible perfect games:

- **Length:** short (<20 full moves), medium (20–50), long (>50); very long stress cases (>=125 full moves) tested separately. Boundaries may be revised before split freeze, not after observing test outcomes.
- **Outcome:** White win, Black win, draw; checkmate, resignation, timeout/flag, agreement and unfinished/error flows separately where meaningful.
- **Starting state:** standard start, legal arbitrary starting FEN, castling rights, en passant availability, promotion possibilities, partial histories.
- **Position:** balanced, already won/lost, high volatility, multiple equivalent candidates, highly forced, endgame/tablebase eligible, zugzwang, repetition, mate score.
- **Player ability:** at least beginner/intermediate/advanced rating strata if data legally available, with missing-rating as its own category. Don't infer a rating from CAPS2/accuracy.
- **Time class:** bullet/blitz/rapid/classical where available; when metadata absent, **unknown**, never guessed.
- **Opening:** varied ECO families; explicit transposition and book exit, no single opening dominating.

Document target and achieved counts; sparse strata must be labeled rather than silently filled with duplicates.

## C. Data rights, consent and privacy

1. **Fixture provenance required:** license, source URL or `generated`, author/consent basis, retrieval date, redistribution permission and attribution text where required.
2. Prefer **synthetic legal chess games and CC0/licensed puzzle material** in the public repository. Lichess offers publicly documented puzzle data; verify the exact dataset terms before import. Published game PGNs may have separate rights, account privacy or terms; do not assume anything online is redistributable.
3. **Never commit** active SQLite games, private PGN exports, usernames, Chess.com login state, cookies, HAR files with authorization headers, MCP tokens, `.env`, HTTP request bodies containing secrets or private ChatGPT transcripts.
4. For local reality checks, open the active SQLite **read-only** and create a disposable copy via SQLite Online Backup API. Use the copy in benchmarks. No direct `cp` of a live WAL database and no benchmark writes to live tables.
5. For optional Chess.com comparison, use already-reviewed scores **manually supplied or collected through explicitly permitted user actions**. Do not bypass premium allowances, replay browser cookies to undocumented endpoints, mass-scrape authenticated sessions, defeat Cloudflare, or create extra accounts to multiply quotas.
6. Preserve a consent/retention log for volunteered data and allow deletion. Anonymize display names and replace native game IDs with opaque fixture IDs in shared summaries.
7. If external model APIs are used for coach testing, send no identifiable private game data without explicit opt-in; prefer synthetic positions. Respect model/provider retention and quota policies.
8. Input PGNs and AI text are untrusted. A test runner must never evaluate PGN comments as code or instructions, render arbitrary HTML, or expose local engine/service secrets.

## D. Manifest and fixture schema (proposed, not a current API)

Use immutable, schema-checked **JSONL** for small, individually reviewable inputs and a versioned aggregate manifest. Store `sha256` of canonical input (PGN + starting FEN + source metadata) to detect accidental drift. JSON example is illustrative; no matching fixtures exist in this planning commit:

```json
{
  "schema_version": 1,
  "fixture_id": "SYN-LEGAL-0001",
  "kind": "completed_game",
  "split": "dev",
  "source_kind": "synthetic",
  "source_url": null,
  "license": "self-authored",
  "consent_reference": "not-applicable",
  "pgn_file": "games/syn-legal-0001.pgn",
  "pgn_sha256": "computed-from-canonical-fixture-before-freeze",
  "start_fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "variant": "standard",
  "result": "1-0",
  "white_rating_bucket": "unknown",
  "black_rating_bucket": "unknown",
  "time_class": "unknown",
  "tags": ["legal_replay", "san_roundtrip"],
  "annotations_file": "labels/syn-legal-0001.json",
  "created_at": "2026-11-11",
  "verified_by": ["automated_legal_replay"]
}
```

**Manifest rules:** `fixture_id` unique; `split` one of `dev|holdout|stress`; `kind` in `completed_game|position|explanation_case|malformed_input`; `variant` explicitly specified; outcome from PGN or tagged `unknown`; source rights available; a corresponding file exists and hashes match. `pgn_sha256` must contain an actual 64-character digest in a real manifest; the placeholder above is intentionally not a runnable fixture. Do not include unreviewed human ratings as reference truth.

### Position-label object

```json
{
  "schema_version": 1,
  "fixture_id": "SYN-LEGAL-0001:P001",
  "parent_fixture_id": "SYN-LEGAL-0001",
  "ply": 1,
  "fen_before": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "played_uci": "e2e4",
  "expected_legal": true,
  "mate_or_draw_reference": null,
  "candidate_moves": [],
  "engine_reference_id": "sf-pinned-benchmark-config-v1",
  "human_claims": [],
  "label_status": "unreviewed"
}
```

**Important:** Empty candidates are intentionally **not** evidence that a move is uniquely best. Human claims must have reviewer IDs and decision provenance before they are gold labels.

### Optional external accuracy comparison

```json
{
  "fixture_id": "CONSENTED-GAME-0001",
  "system": "chesscom-caps2",
  "white_accuracy": 76.8,
  "black_accuracy": 66.3,
  "reported_depth": null,
  "source_type": "user_supplied_review",
  "collected_at": "2026-11-11",
  "score_algorithm_version": "unknown",
  "consent_status": "explicit",
  "training_use_allowed": false
}
```

Store these references **only with permission and verified provenance**, preferably outside the public repo. `reported_depth: null` and `score_algorithm_version: unknown` are honest if the user cannot verify settings; do not invent them. Chess.com comparison scores are metrics in an *optional* experiment, not ground truth in automated correctness tests.

## E. Reproducible engine reference contract

Each engine evaluation result must record:

| Field | Requirement |
| --- | --- |
| `engine_name`, `version`, `binary_sha256` | Exact binary identity, not just a marketing name |
| `threads`, `hash_mib`, `multipv` | Effective values, not only requested environment variables |
| `limit_type`, `limit_value`, `reached_depth`, `nodes`, `elapsed_ms` | Declared and observed budget; comparison must match workload constraints |
| `fen`, `variant`, `side_to_move` | Canonical legal position and variant assumptions |
| `score_cp`, `mate_plies` or `mate_moves`, `score_pov` | Disambiguate side-to-move vs White vs player; don't replace mate with fake enormous cp without documenting it |
| `best_uci`, `pv_uci[]`, `candidate_rank` | Legal principal variations and alternate moves; allow missing/partial output when engine fails |
| `model_version`, `scoring_version`, `cache_key` | Versioned interpretation and invalidation |
| `termination_reason` | Complete, timeout, cancelled, engine exit, invalid input, insufficient evidence |

Reference engine setup should use **a fixed, documented Threads/Hash/MultiPV and search budget**. For maximally stable reference cases, start with one thread and a fixed node or depth budget; repeat unstable positions and record variance rather than assuming byte-identical scores from all machines. Distinguish `MultiPV=1` precision from `MultiPV=3` quality and their separate search budgets. Include original Stockfish 17 local baseline, and test any proposed engine upgrade separately.

An engine evaluation can be labeled "strong reference" only after a documented verification criterion, such as an independently checked tablebase position or stable multi-budget outcome. An engine verdict on an ambiguous long-horizon position is **not absolute ground truth** even if deep.

## F. Adversarial chess fixture catalogue

Each category needs at least one minimal deterministic unit fixture, one game-level integration fixture where possible, and a recorded expected behavior. The items below are **requirements**, not claims already tested:

### F1. Game rules and state

- Standard start, legal custom starting FEN, Black to move first; castling both sides and lost castling rights.
- En passant (including EP exposing a king to check), promotion, underpromotion, pawn double push, rook move and captured-rook castling rights.
- Check, discovered check, double check, checkmate, stalemate, threefold/fivefold repetition, claimable 50-move/automatic 75-move, insufficient material, tablebase outcomes.
- SAN disambiguation (two knights/rooks), checking promotion, plus/hash notation; malformed PGN, illegal move, oversized PGN, incomplete PGN and mismatched result tag.
- Piece-color flip, alternative start position, odd/even ply, move number offset; variation attempts never change the saved original PGN hash.

### F2. Engine facts

- Evaluation sign and mate-number conversions on both player colors; `_before` and `_after` POV.
- Best move vs an equally strong alternative; best move delayed by low-depth horizon effect.
- Quiet best defense, defensive exchange, forced only legal reply, checkmate in 1/2/3, missed mating opportunity.
- Mate-to-mate transitions, drawn tablebase vs engine positive cp, an already-lost position, a trivially winning conversion.
- `MultiPV` 1 vs 3+ differences and interrupted/cancelled search; malformed/unparseable UCI output.
- Tactical motifs verified by **legal counterline**, not only single static piece attacks.

### F3. Calibration and classification

- Perfect/near-perfect known lines; one bad move in a short high-quality game; multiple blunders; no eligible moves after book exclusions.
- Wild game with several swings; equal game; lop-sided game with many harmless moves; extremely short game; long forced conversion.
- Score monotonicity investigations where one evaluation changes under **controlled identical inputs**; ensure genuine bad moves aren't forgiven by a relative score floor.
- Distinguish evidence for `best`, `excellent`, `good`, `inaccuracy`, `mistake`, `blunder`, `miss`, `great`, `brilliant`, `forced`, `book` and unknown/unscorable.
- Same fixture repeated across `SCORING_VERSION` and snapshot/backfill version transitions; historical score graphs must mark incomparable regimes.

### F4. Coach text (factuality)

- Piece referred to on wrong square; player pronoun reversed; "forced mate" without a forced legal line; best move by opponent when it is player's turn.
- Overclaiming a fork/pin when a countercheck or capture refutes it; claiming a queen was hanging when it is defended.
- Key moment selected from the *opponent's* perspective; claims about material without board inventory; line displayed but illegal at user-selected FEN.
- Contradictory labels (praise a blunder; condemn best move); inventing chess notation; unsupported game rating claims.
- Fallback without configured LLM; stream closed mid-report; malformed structured LLM response; user-visible uncertainty.
- Translation-level semantic drift: a correct English claim becomes an incorrect other-language claim.

### F5. UI/data/performance

- Rapid switching between game A/B, analysis depth requests, navigating ply while engine response is pending; one user's analysis never visible to another.
- Keyboard Arrow/Home/End with text input focused, modal open, range slider, screen reader; no accidental selection/scroll.
- Mobile 390 px, tablet 768 px, desktop 1366/1440/1920 px; 125–200% zoom, dark/light, reduced motion.
- 2,000–10,000 **synthetic** indexed games, pagination, browser memory, long move list, 250+ ply table and graph performance.
- Offline, missing engine, engine killed, timeout, HTTP 429/503, request aborted, LLM unavailable, restart mid-review, stale scoring version.
- DB snapshot/migration failure and idempotency; no personal PGN or credential leakage in artifacts.

## G. Annotation rubric and adjudication protocol

### G1. Label dimensions

Each distinct natural-language **claim** (not just the whole report) gets:

| Field | Values | Principle |
| --- | --- | --- |
| `fact_status` | supported / contradicted / insufficient-evidence / not-chess-factual | A factual violation is not repaired by nice prose |
| `severity` | critical / major / minor / none | Critical: illegal line, wrong actor/result, invented forced mate, materially wrong consequence |
| `claim_type` | board-state / move-legality / material / tactical / strategic / forced / evaluation / pedagogical / other | Separate directly verifiable from explanatory interpretation |
| `evidence` | FEN + ply + legal line + engine ref or expert note | Cannot just cite model-generated text |
| `clarity` | 1–5 | Could a novice reasonably understand it? |
| `specificity` | 1–5 | Does it explain this game rather than generic principles? |
| `helpfulness` | 1–5 | Can player act on it? |
| `uncertainty_handled` | yes / no / not-applicable | Ambiguous positions must not be stated as certain |
| `annotator_id`, `adjudicated_by` | pseudonymous review IDs | Preserve disagreement and provenance |

No single "good/bad" label captures truth and teaching value. A fluent explanation can be clear yet false; report separately.

### G2. Human process

- Two independent reviewers for high-impact claims if feasible, blind to which model generated them; allow "insufficient evidence".
- Disagreements adjudicated by a third reviewer or an explicit legal/engine proof; keep initial labels and disagreement rate.
- Calibrate the rubric with a 10-example pilot before annotating all 50; publish examples of severity distinctions without private PGN.
- Reviewer expertise must be recorded (e.g. coach, advanced hobbyist); do not fabricate expert endorsements.
- Report inter-rater agreement and confidence intervals; avoid claiming universal learner comprehension from one reviewer.

## H. Statistical comparisons (predeclare before modifying model)

Minimum report fields:

- **Dataset:** sizes by split, rating/time/length/position buckets, exclusion counts/reasons, duplicate/leakage audit.
- **Accuracy fit:** MAE, median absolute error, p90 absolute error, signed mean bias, scatter and calibration plot versus any external reference; per side and by game-length/position-state strata.
- **Classification:** confusion matrix, per-class precision/recall, severity-weighted error, stability across increasing engine budgets, counts of mutually acceptable alternatives.
- **Explanation truth:** critical/major/minor false claims per 100 factual claims, supported/unsupported percentages, 95% intervals where meaningful, inter-rater disagreement.
- **Learning:** first-attempt correctness, hint levels, time-to-solve, unseen analogous task success, delayed retention and confidence intervals; participants and exclusions.
- **System:** p50/p95 runtime, peak RSS/CPU, simultaneous jobs admitted/rejected/cancelled, retries, data-integrity status.
- **Comparisons:** `main_baseline`, `candidate`, versioned settings, both engine hashes; paired case table of largest gains/losses, not only average score.

Use paired bootstrap at the **game** level for score comparisons. For repeated participants in learning tests, cluster by user; report uncertainty rather than p-values without a valid sample. Exact test sample size is to be decided after Phase 0 variation estimates, **not** reverse-engineered from the outcome.

**Leakage policy:** training/dev can be adjusted; locked holdout cannot be repeatedly used to choose coefficients, scoring weights, prompt wording, example cases or UX copy. If exposed, retire that holdout and predeclare a new one before final evaluation.

## I. Runner layout and expected artifacts (future implementation)

Proposed files, NOT created in this documentation PR:

```
qa/review-excellence/
  README.md
  manifests/manifest-v1.jsonl
  fixtures/games/*.pgn
  fixtures/positions/*.json
  labels/*.json
  holdout/                 # only safely redistributable sealed inputs
  results/                 # generated; generally gitignored
scripts/review-benchmark.mjs
scripts/review-benchmark-report.mjs
```

**CLI proposal:** `node scripts/review-benchmark.mjs --manifest=... --split=dev --engine=... --out=... --max-jobs=1 --budget=...` with explicit absolute source/binary where needed. Do not invent command success; create an actual runner and tests in a later PR before publishing invocation as an executable procedure.

Every emitted report should contain `timestamp_utc`, `repo_sha`, `source_fixture_manifest_sha256`, `engine_sha256`, `engine_options`, `scoring_model_version`, `node_version`, `os_cpu_summary`, `fixture_count`, `skipped_count_and_reasons`, duration, metrics, confidence/uncertainty and linked failures.

The runner should **not** contact Chess.com, Lichess or any LLM by default; no network required for deterministic gold tests. It must have a max-jobs/CPU budget, process cleanup, dry-run/validation mode, and **never** start, stop or reconfigure the live Patzer service.

## J. Release gates by category

| Gate | Blocking? | Evidence |
| --- | --- | --- |
| Illegal suggestion / wrong side / corrupted PGN | **Yes, always** | Deterministic fixture and saved hash proof |
| Security/auth/CSRF/private data leak | **Yes, always** | Isolated integration and abuse tests |
| Unsupported forced mate / dangerous teaching hallucination | **Yes for critical cases on gold set** | Claim-level human + legal proof |
| Scoring-model improvement | **Yes for replacing existing scorer** | Dev improvement **and** sealed holdout nonregression with caveats |
| New UX/Practice control | **Yes for shipping user flow** | Keyboard/touch/ARIA and user-task smoke |
| Engine/runtime latency change | **Yes if unapproved resource regression** | Baseline-equivalent hardware and budget |
| External comparison to Chess.com | No | Optional descriptive evidence, no required account payment |
| New model or LLM provider | No unless part of proposed feature | Fallback, compatibility, cost and safety evidence |

**Acceptance packet:** actual SHA, manifest hash, engine config, changes, test commands/results, unexpected failures, worst counterexamples, CPU/memory, data-migration state, explicit signer. A reviewer should be able to reproduce the conclusion in a clean disposable checkout without access to the owner's personal games.

## K. References and versioned caveats

- [Lichess official accuracy equation and game aggregation](https://lichess.org/page/accuracy). The formula and its interpretation may change; record the exact methodology timestamp before implementation.
- [Chess.com official CAPS2 description](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis-determined). Proprietary grading comparator; not a gold label for truth.
- [Stockfish official documentation](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html) for engine setting decisions.
- [Lichess usage / licensing terms](https://lichess.org/terms-of-service), [Lichess public puzzle data](https://database.lichess.org/#puzzles), and repository `THIRD_PARTY_NOTICES.md`.
- Repo prior QA: `qa/agent07/frontend-overhaul-smoke.mjs` and `docs/agent-handoffs/integration-20261111.md`. No new benchmark runner is implied by their existence.

**Contract freeze rule:** schema changes require a documented version bump and migration path for existing fixtures/reports; never silently rewrite historical test labels after an engine change.
