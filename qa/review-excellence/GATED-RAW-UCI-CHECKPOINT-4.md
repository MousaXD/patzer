# Agent D — Checkpoint 4: single-command fail-closed UCI review smoke

**Status:** independent QA infrastructure evidence, not Game Review release certification.

This checkpoint continues the signed Agent D history from `7e53145152593a5ef82878f6b63c45299450d951` on `agent/review-benchmark-20261111`. The prior adversarial checkpoint's immutable synthetic fixtures, SHA-256 manifest hashes, cross-agent labels and runtime findings are unchanged.

## Follow-up hostile audit — exact-position evidence and lifecycle

The initial single-command gate had one further **false-green** weakness: it required *at least* the expected number of search commands, but did not prove that those searches belonged to the actual PGN. A test-only injection of one **entirely legal, self-consistent, unrelated Stockfish search** passed its raw-PV legality and minimum-count checks. The fixed gate now reconstructs the FEN from each signed fixture's starting position and every move, then compares an **exact multiset of expected FENs** with all recorded raw `go` commands. It rejects any missing, repeated, unrelated, or extra position.

The second hostile audit also changed the bounded runner from synchronous process execution to an independently bounded subprocess group on POSIX. On timeout, it sends `SIGTERM` to the disposable group (including the UCI proxy and Stockfish children), with a subsequent `SIGKILL` fallback. It never attempts to signal the user's active server or any pre-existing process group. A **50 ms test-only forced-timeout** control confirmed that incomplete application output and raw evidence cannot be treated as a pass. No residual benchmark Stockfish/proxy process appeared in the subsequent local process check; this is not a general guarantee across all operating systems.

Finally, the gate pins the **intended candidate Git SHA before launch** and requires an app-produced result SHA to match. A killed analysis may legitimately have `candidate_sha=null` while retaining a verifiable `requested_candidate_sha` from the checked-out candidate. This prevents a stale result from accidentally attributing a green report to the wrong branch.

### Additional verified experiments

| Experiment | App output | Raw evidence | Complete gate |
| --- | --- | --- | --- |
| Agent A `7178e26`, ordinary two-game run | 0 errors, 11/11 output mutations rejected | 6/6 expected FENs and 112/112 legal PV lines | **Pass** |
| Add one unrelated but entirely legal UCI search to a valid transcript | Green | Raw legality green, **7 searches instead of 6** | **Fails on exact fixture-FEN match** |
| Force subprocess-group termination during analysis | Incomplete, timed out as requested | Missing/incomplete | **Fails** |
| Two parallel runs in isolated QA directories | Both green | Both 112/112 legal PV lines | **Both pass; different run directories** |
| `main` `51df1d8`, otherwise identical fixtures and engine | 2 known no-evidence Elo/performance failures | All 112 PVs legal | **Fails for real scoring evidence** |

The existing raw-transcript-deletion and deliberately illegal-PV controls were **rerun after changing process handling**; both still fail, and the actual normal run still passes. The evidence compiler `scripts/review-benchmark-gate-proof.mjs` independently verifies the expected positive/failure reasons, the exact candidate and baseline SHAs, fixture manifest and engine SHA, and concurrent temporary-directory separation. It writes the reproducible, source-hash-linked **`certification-summary-checkpoint4.json`**; this is an archived run against the explicitly frozen candidate, not a universal scoring certificate.

The gate script SHA-256 for this verification is `d56301d6e164221fae68e9427a7457eecbdab479b44a93775d0f3356d412b104`. As before, the exact Stockfish binary SHA-256 is `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, and the manifest v2 SHA-256 is `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`.

To deliberately challenge the gate, run the same two-game command below with `--fault=extra-legal-search` or `--fault=force-analysis-timeout` as well as the two original corruptions. **Each negative control must exit nonzero for the expected reason.** After reproducing the archived logs under `qa/review-excellence/results/gated5-*.log`, execute `node scripts/review-benchmark-gate-proof.mjs` to verify the fixed checkpoint. Do not silently relabel a run against a new branch as evidence about frozen Agent A `7178e26`.

## Why this additional gate exists

The previous benchmark could show a green app-DTO review despite a **hidden illegal engine continuation**. The UCI raw auditor could detect it, but it was a separate command a reviewer might forget. Now `scripts/review-benchmark-gated-smoke.mjs` runs the app's **real analysis function** under a **test-only raw UCI proxy**, invokes the independent raw replay auditor automatically, and fails if **either** component is missing, incomplete, or incorrect.

This is a **bounded synthetic smoke** on at most 4 licensed/self-authored completed games and 60 total plies, at depth 8–12, using a caller-pinned local Stockfish binary. It creates a fresh disposable SQLite DB within ignored `qa/review-excellence/results`. It never starts or reconfigures the active Patzer server, reads private games, calls hosted LLM/Chess.com endpoints, or touches the production database.

The runner guarantees:

- Local chess fixture paths, SHA256s, provenance and source licensing are validated before engine launch.
- The candidate application is imported from an explicit **isolated benchmark checkout or detached QA worktree**, never from an arbitrary system path.
- Engine SHA256 must be provided and match **before** a subprocess is launched.
- Application outputs use the real analyzer, an independent benchmark-owned reference UCI process, and all normal DTO negative controls.
- Raw UCI traces are generated from the **same** application analysis run, not an unrelated prior report. Required search count is at least total PGN plies plus the one initial search per game.
- Every emitted raw PV is replayed legally; bestmove response count and PV availability cannot be faked by a good-looking serialized DTO. A missing or corrupt trace blocks the gate.
- An explicit `scope_passed` field is **never** labeled as full product/release approval; `release_approved` is always false.

## Verified positive/negative experiments (same settings)

Reference binary: local package Stockfish **16**, SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`; 1 thread / 16 MiB hash / MultiPV 3 / depth 8. Inputs: self-authored `SYN-GAME-BLACK-FIRST` and `SYN-GAME-FORCED-REPLY`. This is **not** an equivalence claim about deployed Stockfish 17.

| Injection/subject | Application DTO | Raw UCI gate | Total gate exit |
| --- | --- | --- | --- |
| Agent A `edc1b2e`, unmodified engine and source | 0 errors, 11/11 output mutants rejected | 112/112 legal PV lines, 6/6 bestmove responses | **0 (scope pass)** |
| Deliberately delete all UCI transcripts after otherwise successful app run | App remains good | **No evidence**, raw audit cannot execute | **1 (correctly blocked)** |
| Corrupt an existing *actual* info PV with an illegal continuation, after otherwise successful app run | App remains good | **111/112 valid PV lines, 1 illegal raw PV** | **1 (correctly blocked)** |
| Baseline `main` `51df1d8`, same source fixtures and engine | **2 zero-evidence Elo/performance findings** | 112/112 legal PV lines | **1 (correctly blocked)** |
| Provide deliberately wrong engine SHA256 | No app launched | No raw search started | **1 (identity check blocked)** |

The first attempt to inject a corrupted transcript accidentally selected a handshake-only file, so no corruption occurred and the green outcome was falsely reassuring. The injector now **asserts that an actual UCI info PV was changed**. That attack was rerun and correctly triggered `illegal_raw_uci_pv`. This is recorded as a **benchmark defect found and fixed**, not suppressed.

## Exact bounded reproducer

From Agent D's isolated checkout with Node dependencies installed, provide `ENGINE` as an **absolute, independently verified** trusted binary path and use detached Agent A snapshot under `qa/review-excellence/results/worktree-engine`:

```sh
node scripts/review-benchmark-gated-smoke.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-engine" \
  --engine="$ENGINE" \
  --engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca \
  --ids=SYN-GAME-BLACK-FIRST,SYN-GAME-FORCED-REPLY \
  --depth=8 --fault=none
```

For independent hostile controls, repeat with `--fault=drop-trace` or `--fault=corrupt-raw-pv`. Those modes edit **only temporary synthetic raw traces under the ignored results directory**. They are deliberately broken and must exit nonzero. The command writes a fresh `raw-gate-*/gate-result.json` with exact candidate hash, manifest hash, engine hash, explicit failure reasons, search counts and test-only injection mode.

Do **not** pass an unknown binary or a path outside the separate benchmark checkout; the script rejects unapproved fixture types and unpinned engines. Do not interpret a passing scoped protocol gate as proof of the AI coach's instructional value, UI accessibility or sealed-holdout nonregression.

## Integration decision / next work

**QA code review is appropriate; release certification remains blocked.** Main, Agent B, Agent C and independently proposed v10 still have the previously verified zero-evidence rating defect on the forced-only fixture. Agent A `edc1b2e` fixed that specific issue, not necessarily all engine corner cases. The integrator must arbitrate A vs PR #17 scoring version/backfill, then run a unified branch and separately certify natural-language coach claims, keyboard/mobile retry journey, multi-user HTTP behavior and sealed-holdout calibration.

Next useful audit: challenge the UCI proxy under engine death, SIGKILL/timeout and simultaneous game switches; ensure the gate cannot leak a fake success from partially written traces or orphaned children. Keep all evidence disposable and bounded.
