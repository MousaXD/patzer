# Agent D — Checkpoint 15: fail-closed cohort selection and artifact path containment

**Own branch:** `agent/review-benchmark-20261111`. **Previous pushed HEAD:** `389b9b5b2a539bb6be7f6e041786ba0bc953a99d`. All changes are limited to **Agent D's offline benchmark runner, QA scripts and QA reports**. Neither candidate application scoring, frontend, coach, user data, credentials, live service, updater nor `main` were modified.

## Why this audit was necessary

The original offline benchmark filtered cases by `--split` but did not require at least one selected fixture. Because **no independently curated/sealed holdout exists**, a `--split=holdout` call would return exit code 0 and an empty list of failures: a false-green certification signal with **zero evidence**. An arbitrary/valueless split behaved similarly. Existing `--out` checks validated only the lexical filename beneath `qa/review-excellence/results`, not its filesystem target, so an output symlink could redirect an ordinary successful benchmark write to a different file.

Agent D reproduced the latter vulnerability using an exclusively created **synthetic temporary canary** outside results: before the patch, a symlink-looking-contained output returned **exit 0 and overwrote the canary**. No real, private, active or production file was used. The runner was then hardened and challenged again.

## Corrections in benchmark infrastructure only

1. `--split` now must be `all`, `dev`, `stress` or `holdout`. **Zero selected fixtures fail with `empty_requested_split`**, and an unsupported value fails with `invalid_requested_split`. Passing a bare `--split` fails. The `checks_passed` metric never becomes negative from cohort-level errors.
2. Every declared fixture must resolve **physically inside** the curated QA fixture root, not merely have a lexically safe path. A symlink to a self-authored PGN outside that root is rejected with `unsafe_fixture_path`. The verified resolved target is opened, reducing symlink-retargeting hazards.
3. Report outputs now validate the physical parent directory, reject symlink file/directory targets escaping the results folder, and **write to an exclusive temporary file followed by atomic rename**. An existing hard link at the requested output path is replaced without truncating its external original. Existing nested result directories still work. All security controls use disposable canaries and clean them after execution.

These changes do not produce a sealed holdout, a human truth label or evidence that the product's chess predictions are accurate; they make false **benchmark green** signals harder to obtain.

## Actual bounded CLI results

| Independent positive/negative control | Exit | Evidence |
| --- | ---: | --- |
| Empty holdout split | 1 | `empty_requested_split`, 0 fixtures and 0 passes |
| Unknown split value | 1 | `invalid_requested_split`, zero passes |
| Bare `--split` without value | 1 | `invalid_requested_split`, zero passes |
| Valid development cohort | 0 | **15/15 fixtures passed** |
| Valid stress cohort | 0 | **10/10 fixtures passed** |
| Valid full cohort | 0 | **25/25 fixtures passed** |
| Legitimate nested results output | 0 | **15/15 fixtures**, output identical to stdout |
| Approved-looking fixture symlink escaping corpus | 1 | `unsafe_fixture_path`, 0 passes |
| Output symlink to an external canary file | 2 | `unsafe_output_path`, canary unchanged |
| Output **directory** symlink escaping results | 2 | `unsafe_output_path`, no external report created |
| Existing hard link at the output filename | 0 | 15/15 fixtures, external original canary unchanged |

Thus **five positive CLI paths** succeeded and **six independent invalid inputs** were rejected. An additional 23/23 deliberately forged evidence packets were rejected by an independent report verifier, while one genuine scoped packet was accepted. Test success means the **benchmark** correctly handles these controls, **not** that Patzer is releasable.

No Stockfish or LLM jobs were run for this checkpoint. Fixture-manifest v2 is unchanged, and the full 25-fixture results are merely deterministic chess input/validation contracts, not human educational quality measurements. This checkpoint does not rewrite any earlier checkpoint reports.

## Reproduction and frozen source identity

From the checked-out Agent D branch with Node dependencies installed:

```sh
node --check scripts/review-benchmark.mjs
node scripts/review-benchmark-selection-negative-controls.mjs
node scripts/review-benchmark-selection-proof-negatives.mjs
node scripts/review-benchmark-selection-proof.mjs
node scripts/review-benchmark-negative-controls.mjs
node --import tsx scripts/review-benchmark-app-contract.mjs
```

`selection-negative-controls.mjs` calls the **actual offline CLI** as bounded subprocesses and creates temporary synthetic-only canary paths inside the QA fixtures/results directories (with external comparison canaries in disposable temporary space). All paths are unlinked in `finally`. The raw CLI observations reside in ignored `qa/review-excellence/results/selection-negative-controls.json`; the checked-in report is `qa/review-excellence/certification-summary-checkpoint15.json`.

**SHA256 provenance:**

- Fixture manifest v2: `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`
- Hardened `scripts/review-benchmark.mjs`: `505a242879aac2453164cbbadd20bbd924bf94c0056663fd2773135334793cbd`
- CLI negative suite: `f5a33599ec92b9040c8b62298bf967b85b66f10726a823268e6b756a16cc4a40`
- Independent proof compiler: `e6a11e0f4dc2fb76df226f02f5c98945db2e32734978d04acc8e0ff8aacaec42`
- Proof mutations: `5831325b3fd6d72f4ae9eea90d923d998b0688b3f50d3e43d5a8038db76e3d27`

The source files are QA-owned and have no corresponding production release configuration change. The proof compiler binds these observations to the frozen **pre-checkpoint** Agent D commit `389b9b5b2a539bb6be7f6e041786ba0bc953a99d`. It refuses unsupported full-release or holdout certification flags.

## Hostile follow-up questions and unresolved scope

- The checks assert file-system symlink and hard-link behavior in the test environment, not malicious concurrent directory-swapping by another process. Such races may require OS-specific secure-open primitives.
- This CLI benchmark is **not** an independent sealed holdout, a Stockfish 17 parity run, a real-model truth experiment or a real browser workflow. Those are still external release gates.
- The 15 dev and 10 stress fixtures are public development fixtures, not 25 statistically independent blinded examples. Report no calibrated chess accuracy confidence interval from them.
- The previous application findings remain unresolved on frozen Agent B source: reanalysis cache provenance, in-flight profile language/audience, unverified coaching text, missing non-streaming completion validation and duplicate model generation. Agent C's React consumer provenance also remains a separate issue.

**Next continuation:** Independently exercise overlapping reviews owned by **two separate synthetic users** with reversed provider completion order, differing languages/audiences and opposite colors. Confirm actual authenticated GET/POST ownership, model prompt perspective and cache isolation. Do not re-run already frozen single-owner overlap without evidence of a source change. Coordinate any remediation of product source with its owner; Agent D must never merge to `main`.

**Decision:** The **QA runner's fail-closed selection/output containment checkpoint is reviewable** after the independent controls. **No sealed holdout or overall product release certification is granted.**
