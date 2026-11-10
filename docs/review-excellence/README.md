# Patzer Review Excellence — planning pack

**Created:** 2026-11-11 (Asia/Dubai). **State:** comprehensive planning documentation only; **no development agents have been launched, no existing feature PR has been merged, no production app or personal chess data have been changed** by this pack.

## Start here

1. **[MASTER_PLAN.md](MASTER_PLAN.md)** — executive strategy, codebase facts, the product-quality bar, explicit assumptions/non-assumptions, review architecture, accuracy policy, verified vs hypothetical claims, risk register, staged roadmap, acceptance criteria, owner decisions and release/rollback guardrails.
2. **[BENCHMARK_SPEC.md](BENCHMARK_SPEC.md)** — exactly what evidence to gather, legal data sources, dataset size/splits, JSONL manifest contract, engine trace fields, difficult chess cases, human-label rubric, statistics, learning trial design, thresholds and reproducibility.
3. **[AGENT_BRIEFS.md](AGENT_BRIEFS.md)** — four independent lane briefs (Chess Engine, Coach & Pedagogy, Review UX, Benchmark & Platform), file ownership, dependencies, handshake/change-request format, audit-only kickoff prompts, branch conventions and integrator runbook.

## Executive summary

**Win condition:** Patzer helps someone understand an error, identify a better move and solve a similar previously unseen position **while telling the chess truth**. First establish reproducible benchmark evidence; then build smaller independently validated improvements. Don't clone Chess.com's proprietary CAPS2 or mistake grading distribution for chess truth.

**Known system at snapshot:** self-hosted Patzer with Stockfish 17, chess.js, human-facing AI Game Review, variations, personalized practice, strong existing QA and a local GitHub update workflow. Scoring `main` v9 was still live. **Accuracy correction PR #17 was open, all six checks green, not merged**. Re-verify these as they may change.

**Proposed agent order:** Benchmark/data baseline → independently audit engine + coach + UX → freeze shared evidence DTO → implement one verified vertical slice → integrate exact remote heads → local/CI certification → owner-approved release.

**Explicit non-actions:** No scraping of authenticated Chess.com APIs, premium bypass, imported user data commits, mass Stockfish/LLM processing, unapproved migrations, automatic agent launches, merges or deployment.

## Using this pack

- **Owner/brainstormer:** Read `MASTER_PLAN.md` sections 1–5, 12–17. Approve specific decisions/milestones rather than all work indiscriminately.
- **Agents:** Read all three docs, especially your lane in `AGENT_BRIEFS.md`, fetch the actual current `origin/main` and PR #17, then await a separate assignment to perform Phase 0.
- **Integrator:** Keep the master plan and locked benchmark contract versioned; reject unsupported claims, resolve file/API conflicts and run the exact-head combined test gate.
- **External/public readers:** This pack contains no PGNs, authentication tokens or private database snapshots; the numeric local-state observations in the master plan are timestamped and may change.

**Other relevant repo docs:** [`../../ROADMAP.md`](../../ROADMAP.md) (broad original roadmap), [`../agent-handoffs/integration-20261111.md`](../agent-handoffs/integration-20261111.md) (previous four-agent merge), [`../audits/frontend-2026-11-09/IMPLEMENTATION_WAVE_1.md`](../audits/frontend-2026-11-09/IMPLEMENTATION_WAVE_1.md) (verified frontend audit), [`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md) (licenses).
