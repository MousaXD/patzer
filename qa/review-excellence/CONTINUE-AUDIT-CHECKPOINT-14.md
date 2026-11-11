# Agent D — Checkpoint 14: React Game Report accepts stale profile metadata

**Agent D branch:** `agent/review-benchmark-20261111`. **Previous verified HEAD:** `cc33a7a0ffda977fe37edc078594e8ccf397a8c8`. **Agent C read-only candidate:** `ee4b61168ce61ac615e8efa77bc5ae56698ac5cf`.

**Context:** Checkpoints 12 and 13 independently proved that Agent B's real Game Review SSE can deliver a completed report based on an older profile language or learner audience when those settings change mid-generation. This checkpoint challenges the **real React Game Report consumer**, not the backend source. Its independent tests run against Agent C's `web/src/components/GameReportPanel.tsx`, in a new detached QA worktree. Agent C files, live app, production SQLite, real user data, browser profiles and deployment configuration remain unchanged.

## Verified frontend behavior (controlled React DOM, not full browser E2E)

The QA test mounts the **actual GameReportPanel component** under a deliberately mocked **Spanish UI locale** and sends a well-formed local `event: done` SSE review payload. The component's `isCompleteReviewPayload` validator verifies structural shape but does not compare the received review's `language`/`audience` to an active profile or generation context.

| Independent test | Observed real React behavior | Finding |
| --- | --- | --- |
| `language=en`, `audience=beginner` in Spanish UI mock | **Displays** the old-English beginner summary; calls `onGenerated` with old metadata | **Stale provenance accepted** |
| `language=es`, `audience=advanced` | **Displays** valid Spanish/advanced summary; calls `onGenerated` | **Positive control passes** |
| Syntactically valid `done` event with malformed `phases=null` | **Rejects** the report, alerts, does not call `onGenerated` | **Structural validation already works** |

**Independent Agent D test verdict:** **3/3 passed**. **Agent C's own GameReportPanel stream suite:** **6/6 passed** on exactly the same frozen candidate. All tests use in-process fake fetch/SSE and happy-dom; there is **no external model, authenticated account, actual Chrome/Brave browser navigation or production network**.

### Important boundaries and causality

- This does **not** prove that the complete Patzer page actively has a changed profile at the moment the mocked response arrives. The test controls i18n locale only; the `GameReportPanel` props do **not** include an audience or active-profile identity for the component to check.
- It **does** prove the real consumer will display and propagate a structurally valid SSE `done` review even when it bears old `language=en, audience=beginner` metadata under a controlled Spanish-locale context, rather than guarding against profile mismatch.
- The **real server-side integration risk** is independently established in Checkpoints 12 and 13, where a profile is changed in disposable SQLite while the final real LLM response is held and the completed old-profile review is delivered. This UI test explains why the frontend cannot be relied on as a second profile-provenance gate.
- The malformed response rejection is verified, so the audit does not mischaracterize all payload validation as absent.

## Hostile evidence integrity

Three Agent D-owned QA additions plus supporting config:

- `scripts/review-benchmark-client-stale-profile.test.tsx` — **real** Agent C React component with controlled stale/fresh/malformed input and `onGenerated` assertions, `happy-dom`.
- `qa/review-excellence/vitest.qa.config.mts` — isolated Vitest test-only config; does **not** change Patzer's regular Vitest selection.
- `scripts/review-benchmark-client-profile-proof.mjs` — pins the candidate and exact source/test/config hashes, re-reads the verbose QA log for all three named tests, requires **6/6** in Agent C's existing suite, and refuses any product/release certification claim. Writes `certification-summary-checkpoint14.json`.
- `scripts/review-benchmark-client-profile-negatives.mjs` — accepts the verified scoped QA packet and rejects **16/16 deliberately corrupted evidence packets** (wrong candidate/source, missing test, fabricated coverage, fake authenticated E2E, hidden stale acceptance, false release approval, etc.).

All raw console logs are ignored under `qa/review-excellence/results/`. The summary and source scripts can be reviewed without accessing a customer game or credential.

## Exact reproduction

The `worktree-product-latest` directory is a detached QA snapshot at `ee4b61168ce61ac615e8efa77bc5ae56698ac5cf`, created **without disturbing** the previous `worktree-product`, which had untracked development dependency artifacts. With dependencies installed:

```sh
APP="$(pwd)/qa/review-excellence/results/worktree-product-latest"
node_modules/.bin/vitest run --config qa/review-excellence/vitest.qa.config.mts \
  --reporter=verbose >qa/review-excellence/results/client-stale-profile-ui.log 2>&1

"$APP/node_modules/.bin/vitest" run \
  "$APP/web/src/components/GameReportPanel.stream.test.tsx" --root "$APP" \
  >qa/review-excellence/results/client-product-existing-stream-tests.log 2>&1

node scripts/review-benchmark-client-profile-proof.mjs
node scripts/review-benchmark-client-profile-negatives.mjs
```

**Frozen provenance:** Agent C `ee4b61168ce61ac615e8efa77bc5ae56698ac5cf`; component SHA256 `c3c033be05df83ef230b85542c906ae6321d88fa5169705cd00e8eaeceb49ddb`; QA React test SHA256 `c9ee2d03310e5a7bd04cdab00106795c479e6db24942bab95d690fcb66a78199`; QA Vitest config SHA256 `b28a2b77e42b113ed02e897429d354d19aa28969b8976a091e7363214783346b`.

## Integrator recommendation and next continuation

This finding spans **Agent B's backend profile provenance**, **Agent C's consumer validation** and integration. The primary fix should prevent the backend from completing or caching a report against a stale user language/audience; a frontend guard against mismatched response metadata would be useful defense in depth if the active profile is available and can be tied to request identity. Do not silently change the UI, coach or scorer from Agent D. Preserve valid report rendering, malformed payload rejection, abort-on-navigation, tenant isolation and conditional cache writes.

**Next independent audit:** Re-run the exact adversarial fixtures against the owners' next corrected commits; then add a real browser navigation/profile-update test before claiming whole-app display safety. Full release certification remains blocked by prior stale-cache, coach factuality, incomplete model termination, independent sealed holdout, real-model and multi-user workload gaps.

**Decision:** QA evidence reproducible; **structurally valid stale-profile metadata is accepted by this React consumer**. This is not authenticated E2E certification or a product release recommendation.
