# Agent D — Checkpoint 8: five-language real-coach falsification

**Own branch:** `agent/review-benchmark-20261111`. **Parent checkpoint:** `4f45aa25306de22f628f97d31105b058a175a941`. **Candidate B tested:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

## Why this test was necessary

Checkpoint 6 proved that the real Game Review consumer accepted a deliberately wrong game winner and king square in English. Agent B supports five languages. Its structured claim validator verifies legal board facts, but the free-text review can still contain unverified statements that do not match the narrow lexical patterns. Rather than guessing that translation solves the problem, Agent D exercised the **actual application `buildGameReview()` and real `llm.ts` transport** for every supported language with a pinned legal synthetic chess game and a deliberately dishonest loopback-only mock provider.

**No live Patzer server, real LLM, user game, credentials, external network API, production database, holdout fixture, other agent source edit, merge or release action.** The test fixture is the same self-authored four-ply Fool's Mate where Black demonstrably wins and White's king remains at e1; the false texts instead claim White won and place that king on e2.

## Real-system results

| Language | False winner accepted in `summary` | False White-king location accepted in key moment |
| --- | --- | --- |
| English (`en`) | **Yes** | **Yes** |
| Spanish (`es`) | **Yes** | **Yes** |
| German (`de`) | **Yes** | **Yes** |
| Bulgarian (`bg`) | **Yes** | **Yes** |
| Russian (`ru`) | **Yes** | **Yes** |
| **Total** | **5/5** | **5/5** |

The consumer also accepted ten **truthful equivalent control assertions** (one winner and one king-square assertion per language). There were 30 bounded HTTP JSON requests to the test-only vLLM-compatible server listening on `127.0.0.1`: 5 languages × (1 truthful + 1 deliberately false review) × 3 calls (opening, key moment, summary). No requests were sent to commercial LLM providers.

The ordinary candidate screens `screenUnanchoredProse` and `screenCoachProse` accepted all ten corrupt short sentences; they then appeared in the actual generated `GameReview` returned from the real application's prose pipeline. The separate QA proof independently replays the underlying PGN with `chess.js` and confirms the actual winner and king square, without accepting any model-provided truth labels.

**Important limits:** These are 10 *deliberately injected* falsities, not observed natural-model hallucinations. The translations were manually authored for QA and **have not been independently adjudicated by native-speaking reviewers**. The test does not show a statistical error rate, exhaustive paraphrase coverage, nuanced tactical truth or a difference in learning outcomes. The chess proof is independently replayed from source PGN, but uses the same licensed `chess.js` rules library as Patzer rather than a newly developed chess engine. All five factuality gates therefore remain **uncertified** for free-form prose.

## Independent negative controls

Added three Agent D-only scripts:

1. `scripts/review-benchmark-coach-i18n-faults.mjs`: pins the input synthetic fixture and executable Stockfish SHA; runs the real analyzer once, the real Game Review prose consumer twice in each of five languages, and records exact actual generated text. Disposable SQLite and localhost mock only. A successful *attack-reproduction* process exit is never called product certification.
2. `scripts/review-benchmark-coach-i18n-proof.mjs`: a separately authored checker with independently listed expected false sentences and explicit chess ground truth. Refuses unapproved candidate SHA, engine, fixture, missing calls, missing/duplicated languages, output drift, and false certification claims. Emits machine-readable `certification-summary-checkpoint8.json`.
3. `scripts/review-benchmark-coach-i18n-negative-controls.mjs`: **one positive** evidence packet accepted, **10/10 intentionally corrupted evidence packets rejected** (wrong source/engine, altered text, missing language, wrong source truth, concealed escaping claim, missing request, and an unsupported green verdict).

### Reproduce on disposable checkout

Use Node dependencies and a **detached, read-only** Agent B worktree at the exact verified candidate SHA. Set `ENGINE` to an absolute local Stockfish binary path independently validated as SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`. Do not substitute an unpinned Stockfish version without creating a new evidence packet.

```sh
node --import tsx scripts/review-benchmark-coach-i18n-faults.mjs \
  --app-root="$(pwd)/qa/review-excellence/results/worktree-coach" \
  --engine="$ENGINE" \
  --engine-sha256=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node scripts/review-benchmark-coach-i18n-negative-controls.mjs
node scripts/review-benchmark-coach-i18n-proof.mjs
```

The local engine was Stockfish **16** (one thread, 16 MiB hash, depth 8), not an asserted equivalent to deployed Stockfish 17. Manifest v2 remains exactly SHA256 `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`; no fixtures were changed or opened from holdout. All raw local request evidence lives under ignored `qa/review-excellence/results/`.

## Integration recommendation

The independent benchmark-only increment is ready for QA review. The **product's free-form written review factuality is not certified** in any of the five supported languages on the tested SHA. Agent B and the integrator should decide how to attach verifiable claims to rendered prose, preserve honest uncertainty, and coordinate prose cache versioning with the scoring and source-provenance repairs from Checkpoint 7. Do not silently reimplement Agent B's coach or Agent A's scorer in Agent D's branch.

**Next continuation:** After a genuine Agent B/integrator implementation change, rerun both the English and multilingual hostile injection tests on the new frozen SHA, with a fresh unexposed adjudicated holdout where appropriate. Challenge subtle incorrect causal language, direct tactical replies, stale game switching, and canceled/partial LLM responses without fabricating a complete semantic verifier. The remaining release gates include sealed independent human truth adjudication, learning outcomes, browser keyboard/assistive testing, concurrency/tenant isolation and Stockfish 17 reference parity.

**Decision:** Product certification **blocked** by observed false free-text acceptance. Green existing unit tests and a successful *attack* harness are not a release approval. The user/integrator alone controls merging, migrations and deployment.
