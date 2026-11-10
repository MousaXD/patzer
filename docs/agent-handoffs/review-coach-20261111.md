# Agent B — Review Coach truth and offline fallback (2026-11-11)

**Branch:** `agent/review-coach-20261111` (based on `main` at `51df1d852296e5f0644127a81b5ec31109c8e6c1`)

## Confirmed findings / reproductions

1. **Unknown evaluation fabricated as 50%:** `server/src/coach/review.ts` previously converted nullable before/after CP scores to `0`, causing unsupported `win_pct_before/after`, turning points and misleading narrative evidence. A synthetic seven-move example with both CP values set to null now asserts null win percentages and no invented turning point.
2. **Custom-FEN Black-first ownership:** the written summary used odd/even `ply` rather than the recorded `fen_before` side-to-move. A Black-to-move FEN with `ply: 1` was attributed to White. The evidence path now follows the FEN's turn (retaining parity fallback for malformed legacy data); phase selection and summary are consistent.
3. **Review blocked without an LLM:** `/api/:id/review` rejected `llm_not_configured` before reaching existing localized deterministic fallbacks. It now generates a review without contacting a model. An offline regression checks German prose, moment ownership and progress events.
4. **Fallback falsely asserted the game turned and used CP loss as pawn material:** all five localized key-moment fallbacks now avoid both unsupported statements. They provide the move verdict and a modest general next-step prompt instead.
5. **Critical mate claims accepted without local proof:** review prose had no gate for invented checkmates or exact mate-in-N. Key moments now reject explicitly quantified mate claims and unverified checkmate references, falling back to localized deterministic text. A legal short line ending in mate can justify the existence of mate in that line but not an assertion that it was forced. Adversarial tests include fabricated English, German and Russian claims, a genuine legal `Qxf7#`, and invalid mate-in-2 even when a real mate follows.

## Evidence and limits

- The guard is an **initial narrow negative control**, not a natural-language proof system. It does not establish that claims about forks, pins, threats, piece locations, win probability or forcedness are correct. Earlier `contradiction()` only checks verdict sentiment; it now also filters own-move key-moment prose, conservatively using fallback on contradiction.
- The best-PV mate check replays SAN legally (up to eight plies); it is not a forcedness proof or a complete chess engine search. Future versions should validate every claim against a versioned evidence contract (source FEN, actor, legal PV, eval POV, engine budget, mate score, confidence).
- No personal PGN was copied into source control, no external LLM generation was requested, no database migration or active SQLite access took place. All fixtures are synthetic.
- This wave does not rewrite scoring, frontend review interactions, LLM provider logic or protected runtime/deployment code. Agent A owns evaluation semantics and mate-depth metadata. Agent C owns how confidence and fallback provenance are displayed. Agent D should curate 20+ adjudicated claims and sealed holdout cases for independent certification.
- Prose cache version increased from `4` to `5` to avoid retaining pre-fix generated prose. This means prior reviews need regenerated prose on request; no bulk re-generation is authorized. A previous cache may remain in the database but is treated as stale by the API.

## Validation protocol

Run from the clean branch checkout with Node 22 and local built `better-sqlite3`:

```
npm ci --no-audit --no-fund
npm run typecheck
npx vitest run server/test/review-perspective.test.ts server/test/coach-coaching.test.ts server/test/coach-german.test.ts server/test/coach-russian.test.ts
npx vitest run
git diff --check
```

Exact results and commit SHA belong in the final handoff after last validation.

## Next targeted improvement

Introduce a structured `coach_claims_v1` DTO before attempting full-position fact verification: `claim_id`, `fen`, `actor`, `claim_type`, `evidence_pv_uci`, `score_pov`, `engine_budget`, `proof_status`, and `fallback_reason`. Add a strict evidence validator that fails closed on illegal PVs or unsupported forcing claims; let the model *phrase* confirmed claim templates, not invent tactical facts. Request approval of shared DTO changes from integrator and A/C first. Do not train prompts on sealed holdout answers.
