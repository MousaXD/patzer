# Agent D — Checkpoint 13: in-flight learner-audience cache provenance

**Own branch:** `agent/review-benchmark-20261111`. **Parent checkpoint:** `132b462cede69982f0a520cc051e62eb4212a0da`. **Read-only candidate:** Agent B `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`.

This builds on the independently verified **language-change** race from Checkpoint 12. It does not repeat that experiment; it tests a distinct profile field, `audience`, plus the manual regeneration recovery path. It uses two synthetic game rows and one fake user in a brand-new disposable SQLite file, the authorized real Hono Game Review route and source cache writer, a SHA-pinned local Stockfish 16 binary, and a loopback-only mock vLLM JSON provider. No live app, customer game, authenticated external service, production DB or other agent source was modified.

## Real-SSE observations

The test holds the **final JSON summary** response of the real Game Review producer and exercises three bounded three-call cases:

| Scenario | Real SSE / database outcome | Assessment |
| --- | --- | --- |
| No profile change; `beginner` throughout | `done`, `audience=beginner`, cache and authenticated GET agree | **Pass** |
| Change `beginner` → `advanced` while summary awaits the provider | `done` still contains `audience=beginner`; old prose saved with `prose_audience=beginner` | **Defect** |
| Manually POST the same game again, now `advanced` | `done`, cache and GET show `audience=advanced` | **Recovery works** |

In the defective middle case, an authenticated GET immediately after completion **correctly returns `review:null, stale:true`**, but the automatic regeneration queue only includes `analyses.prose_json IS NULL`, so the stale-but-present row is **not queued** (count 0).

This is the same missing **profile provenance** condition identified for language, confirmed for the separately supported audience field. The conditional cache upsert checks source analysis/game evidence, but not whether the requesting user's `profiles.audience` still matches the value captured at generation start. Existing GET freshness checking is not enough: the just-finished SSE delivered the old audience, and auto regeneration skips it. The test only changed profile values in disposable SQLite and does not estimate how often real users change settings mid-review.

All **9 loopback JSON calls closed**, with exact ordered phase → moment → summary steps for each case. No external model or paid API was invoked.

## Independent hostile benchmark verification

Added only Agent D-owned QA scripts:

- `scripts/review-benchmark-audience-race.mjs` — actual authenticated Game Review SSE + real source cache; deterministic held summary response; stable normal, adversarial and recovery cases. All raw SSE evidence remains under ignored `qa/review-excellence/results/`.
- `scripts/review-benchmark-audience-proof.mjs` — independently verifies the chess result from approved PGN, pinned SHA and fixture hash, real parsed `done` event JSON, `language/audience` metadata, DB/GET outcomes, complete model stages and bounded elapsed time. It writes `certification-summary-checkpoint13.json`.
- `scripts/review-benchmark-audience-negatives.mjs` — one genuine limited evidence packet accepted; **20/20 intentionally corrupted packets rejected**. Corruptions cover identity/source changes, fake product/release approval, missing model calls, altered SSE audience, fake stale GET, no manual recovery, and missing real completion.

The independent proof deliberately reports **`release_approved:false` and `product_releasable:false`** even though the QA experiment itself passes. A successful test verifies a **defect reproduction**, not a successful product.

### Reproduce safely

From Agent D's checkout, with dependencies installed, a detached read-only candidate Agent B worktree at the pinned SHA, and `ENGINE` set to the absolute location of the verified Stockfish binary:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-coach"
PIN=00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca

node --import tsx scripts/review-benchmark-audience-race.mjs \
  --app-root="$APP" --engine="$ENGINE" --engine-sha256="$PIN"
node scripts/review-benchmark-audience-negatives.mjs
node scripts/review-benchmark-audience-proof.mjs
```

- **Pinned app SHA:** `19c359ec3feb8e3c10c33415c403eaf5ab3d6c87`
- **Stockfish SHA256:** `00628bd9c9855c1b7ff93d7f8d51b413586cdc6336fe637f9a14a61531a05aca` (Stockfish **16**, depth 8, one thread, hash 16 MiB)
- **Fixture-manifest v2 SHA256:** `2978e6962ca6cbd07184a5e5f3a078aa1bac32df8c4948c06f6afc5ea7077b44` (unchanged self-authored PGN)
- **Holdout opened:** none. **No Stockfish 17 parity**, human-adjudicated educational gain, or deployment certification claimed.

## Integration responsibility

The fix belongs to Agent B / the integrator. The minimum desired contract is: generation should not persist/announce stale profile-specific prose as current after audience/language changes, and stale cached rows should be discoverable for bounded regeneration. Preserve the existing atomic analysis/game source CAS, owner authorization, and cancellation protections. Do not silently overwrite their source from Agent D.

**Next test:** After an owner fix, pin its exact commit and rerun both the existing language (Checkpoint 12) and audience (Checkpoint 13) hostile cases. Separately audit whether the **frontend Game Report component** displays a completed stale profile/locale response without checking its provenance. Any UI finding must be supported by a real React consumer test, not inferred from a server response alone.

**Verdict:** Agent D QA increment is reviewable. Frozen Agent B source still has a demonstrated in-flight audience cache defect. Full integration/release certification remains blocked by existing language/cache/LLM factuality and completion concerns plus a missing sealed holdout.
