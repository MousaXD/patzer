# Patzer Review Excellence — proposed sealed holdout protocol (NOT collected)

**State: NOT CREATED.** This document does not contain private matches, hidden solutions, human labels or source credentials. No one may describe the public dev/stress manifest as independent holdout evidence.

## Selection and provenance

- Integrator appoints an independent curator who has not tuned the scorer, coach prompt or UX. Curator controls encrypted off-repository fixture/label storage and access logs.
- Target (subject to recruitment and quality audit): **at least 50 independent completed games and 25 positions**, stratified across opening/middle/endgame, mate/draw, played sides, time class and skill range. Unknown ratings stay unknown. Include near-equal alternatives and unstable positions, not just easy blunders.
- Use fully self-authored, demonstrably permitted public-domain/redistributable fixtures, or explicitly consented volunteered games kept private. Track original location, license, permitted redistribution, SHA, extraction method, date, opt-out/revocation instructions and independent reviewer identities. Never assume Chess.com public PGNs are automatically licensed for redistribution.
- Group before splitting by source event, game, players, known near-duplicate board states and transpositions; no game from a review match can occur in both dev and holdout. Deduplicate at normalized FEN (including legal move rights) and chess-motif levels. Document exceptions and leakage audits.
- Preserve raw adjudicator disagreement and rejected examples. Do not quietly replace hard cases because a candidate fails.

## Truth sources

- Chess legality, checkmate and immediate forced-move claims: legal move enumeration, independent implementation and—where available—tablebase proof.
- Engine preferences/evaluation: independently pinned engine, reached depth and node budget, cross-budget repetition, competing lines, and uncertainty tags; engine agreement does not prove unique truth. Tablebase-exact endgames should be labeled separately.
- Move classification and numerical accuracy: independent human adjudication policy and/or transparent, agreed baseline objectives, not a copy of Patzer v9/v10 or Chess.com CAPS2.
- Coach explanations: 2 independent reviewers rate actor, concrete piece facts, forcing line, uncertainty wording, causal explanation and learning utility. Adjudicate conflicts with a third reviewer, keep reviewer IDs, and separate unsupported from provably false claims.
- Accessibility/user learning: separate participant protocol with consent, task success and delayed retention; not inferred from chess engine fixture scores.

## Sealing, commitments and access

1. Before candidates see holdout data, curator writes a versioned canonical manifest, signed hash commitment, annotation rubric and frozen release gates. Keep raw label file **off GitHub** and the compiler's worktrees. Publish only aggregate counts, license categories and a commitment digest if it does not reveal identities.
2. Require integrator and owner authorization for holdout execution. Run the pinned candidate hashes once at the declared release gate. Keep runner and labels independent; disclose excluded/missing cases with exact reasons.
3. Report paired per-game delta, confidence ranges via game-cluster bootstrap (if meaningful sample size), exact hard-gate failures, abstention rate and precision/recall by critical motif. Do not alter metrics or thresholds after seeing results.
4. If a case is exposed during debugging, retire that case from holdout for future tuning. Repeated holdout optimization requires a genuinely new independent set—not retesting the same labels until a green metric appears.
5. Preserve immutable reports and reviewer disagreement for audit. Apply consent revocation to private source retention with an explicitly documented tradeoff for historical reproducibility.

**Current integration status:** blocked for scoring calibration and coach learning claims until the owner and integrator create and approve the real holdout and independent reviewers. Never claim it has been scored.
