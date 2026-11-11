# Agent D — Checkpoint 16: concurrent cross-user Game Review isolation

**Assigned branch:** `agent/review-benchmark-20261111`. **Previous pushed checkpoint:** `710381f2c6ec047a0947cc999825c53afd6ddb16`. **Backend candidate tested read-only:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

This checkpoint tests whether concurrent real Game Reviews for **different user owners**, each with a distinct session and separately owned game, keep authentication, AI prompts, cached prose, player perspective, and generated SSE responses isolated. It extends Checkpoint 11, which tested overlapping requests from **the same owner for the same game**; it does not duplicate that stale-write experiment. All code is added under Agent D's benchmark infrastructure. No production database, authenticated external service, other agent files, updater or `main` were modified.

## Real application coverage and controlled schedule

The independent harness imports the real Hono `POST /api/games/:id/review` and GET routes, the actual `analyzePgn` and `saveAnalysis` implementation, the real synthetic-user session logic, the source Game Review producer, and its LLM JSON transport. It runs against a **fresh disposable SQLite** file and a loopback-only vLLM-compatible mock provider.

Both users play the **same self-authored legal Fool's Mate** PGN, but the owned game rows and profile context are different:

| Fact | User 1 (English) | User 2 (Spanish) |
| --- | --- | --- |
| User/game row | 1 / 1 | 2 / 2 |
| Language/audience | `en` / `beginner` | `es` / `advanced` |
| Player perspective | **White (loser)** | **Black (winner)** |
| Model summary FACTS.result | **you lost** | **ganaste** |
| Synthetic game accuracy in prompts | **31.8% White** | **97.2% Black** |
| White's `g4` key moment `by_user` | **true** | **false** |
| Authenticated report | English, beginner | Spanish, advanced |

The benchmark starts **English first**, stalls its first model request, then starts **Spanish second** and stalls its first model request. It releases the entire Spanish review (phase, moment, summary) before the English review, checking that English cache remains NULL while Spanish persists. This is deliberate **out-of-order completion** rather than two sequential requests that merely happen to share a name.

### Verified results

- Unauthenticated review POST returned **401**. Cross-user GET and POST both returned **404**, in both directions (four denial checks).
- Both source routes generated a real `done` SSE event and the correct per-user language/audience metadata; neither returned an `error` event.
- All **six** local mock-model calls closed, and their independently parsed FACTS included the expected player-relative winner, language, audience, opening accuracy and move ownership.
- Both cached rows and both subsequent authenticated GETs returned exactly their **own** summaries and perspectives. No cross-user data swap was observed under this controlled schedule.
- The single bounded local experiment completed in about **1 second**. That is a synthetic latency observation, **not** a production response-time claim or model-performance SLO.

**Result:** This particular real-route, two-user ownership isolation scenario **passes**. The test makes no claim that *all* tenant endpoints, sessions, proxies or application authorization paths are secure.

## Hostile benchmark self-audit

1. `scripts/review-benchmark-tenant-concurrency.mjs` — real application handlers under disposable SQLite and a fake local model. It stores raw request FACTS and SSE frames only in ignored local results, never collecting authenticated Chess.com traffic or external LLM data.
2. `scripts/review-benchmark-tenant-proof.mjs` — separately replays the approved PGN to establish that Black won, reads actual SSE `done` JSON and source-fact snapshots, checks distinct game owners, status codes, exact provider response order, cached report rows, prompt actor/result perspective and provider request counts. Emits `certification-summary-checkpoint16.json`.
3. `scripts/review-benchmark-tenant-negatives.mjs` — **23/23 deliberately corrupted evidence packets rejected**, including swapped SSE reports, falsified game winner, cross-tenant read access, wrong player attribution, wrong prompt accuracy, lost responses, hidden provider errors and fake full product approval. One genuine bounded result packet was accepted.

Test-only variations are separate local JSON objects; no corruptions are introduced to candidate source, live data, persisted fixtures, credentials or other agents' branches. A passing QA check only demonstrates that this limited attacker schedule was handled; it is not a full security certificate.

## Reproduction with pinned source and binary

From the Agent D checkout, with a detached candidate worktree at the exact verified SHA and local Node dependencies installed:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
ENGINE="$(pwd)/qa/review-excellence/results/engine/unpacked/usr/games/stockfish"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-tenant-concurrency.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"
node scripts/review-benchmark-tenant-negatives.mjs
node scripts/review-benchmark-tenant-proof.mjs
```

**Fixed provenance:** Candidate B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`, publicly packaged local Stockfish **16** executable SHA256 `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca`, 1 thread, 16 MiB hash, analysis depth 8. The self-authored fixture-manifest v2 SHA256 remains `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44`. **No sealed holdout** or production-equivalent Stockfish 17 parity was used.

**New QA source hashes (SHA256):**

- Real-route harness: `552ec96bbb87aae3ab55a633931e0d8bcc5dcd13391f0c498b73e21034158b97`
- Independent proof: `2b730771ddbe307d316310fa8a256c62eb152afc842808b88bf678541d7a64de`
- Mutant evidence controls: `a86e9e86ef478b1d60c9b6f6873a272cbc1699ecb735070879c7775c73c19909`

## Integration dependencies and unresolved risks

The measured cross-user isolation is **positive** evidence for Agent B's owner-based route and cache checks. It does not remediate the independently reproduced **same-owner stale reanalysis cache, in-flight language/audience profile races, incomplete non-streaming LLM responses or unsupported coaching claims**. Agent C's actual React consumer still accepts structurally valid stale-profile SSE payloads under the controlled test context.

The next bounded test should vary the **timing of session revocation and profile change during a live review** without pretending a completed request can be retroactively deauthenticated. For stronger security certification, real HTTP admission control, separate processes, concurrent session changes, per-tenant resource fairness, user/game migrations, browser navigation and policy review are still needed. Never confuse this in-process mock test with a real production load or privacy audit.

**Release decision:** The two-user, two-game, opposing-perspective isolated experiment passes; **overall product security and integration/release certification remain unapproved**. Agent D must only change QA-owned files and never merge to `main`.
