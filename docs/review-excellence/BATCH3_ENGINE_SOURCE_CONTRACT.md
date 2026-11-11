# Batch 3: engine-source provenance — integration contract

**Agent A worktree:** `agent/review-engine-20261111`. Baseline HEAD `7178e26`.

This is an isolated branch change, **not** a release-accepted migration. The
owner must authorize schema integration separately. Do not deploy it directly.

## Proposed durable source identity

Game source is `games.source_revision INTEGER NOT NULL DEFAULT 0` plus a
`sha256` source digest, stored as `analyses.source_revision` and
`analyses.source_hash`. The digest is `patzer-analysis-source-v1` over
normalized starting FEN, full legal UCI move sequence, PGN result header,
player color, database game result, opponent pregame rating and own pregame
rating deviation. Comments and display headers are excluded. Game identity
is the `analyses.game_id` foreign key, not part of the hash.

An SQLite trigger increments `source_revision` whenever a scoring-relevant
game field changes. This is necessary for A -> B -> A during an in-flight
search; matching source content without an increasing revision cannot protect
the write. Notes, bookmarks, clock times, ECO and opening display labels do
not change the revision. A per-analysis `source_hash` without matching
`source_revision` is not valid.

An analysis is current **iff** all these checks pass:

1. Saved `source_hash` is non-null and equals the canonical current source
   digest. Legacy NULL never counts as current.
2. Saved `source_revision` equals the current game's `source_revision`.
3. Saved `moves_json` exactly replays the current PGN at every ply, including
   UCI, SAN, FEN before/after, and move index.
4. Saved `scoring_version` is current and depth meets the requesting endpoint's
   budget, where applicable.

`analyses.analysis_generation INTEGER NOT NULL DEFAULT 0` advances by one on
**every** successful saved engine run (initial 1), including forced
reanalyzes with byte-identical results. AI report writes and reads must bind
to this generation to prevent an ABA-equivalent reanalysis from accepting
older prose. Legacy generation 0 is never trusted as a new analysis.

The `POST /api/analyze` job snapshots the relevant DB fields before starting
Stockfish, then uses a single SQLite `INSERT ... SELECT ... ON CONFLICT` with
revision, source input and game ID checks after the search. A stale job returns
`409 { "error": "analysis_source_changed", "stale": true }`; it must never
overwrite newer engine evidence. A successful reanalysis clears existing prose
and its metadata. `GET /api/games/:id` returns `analysis: null` with
`analysis_stale: true` for source-mismatched rows.

## Required Agent B follow-through

- Import `analysisMatchesGame` from `chess/analysisSource` after integration
  or use **exactly equivalent** canonical source/revision semantics; do not
  invent an independent PGN-only authority.
- Before manual **or automatic** review starts, require current analysis and
  scoring version. A valid move timeline alone is insufficient for stale
  scoring/performance context or for source A -> B -> A.
- On GET, reject legacy prose and reports whose attested analysis generation,
  language, audience, perspective or engine source differs from present DB
  provenance. Keep the existing `saveReviewIfFresh` atomic CAS, additionally
  matching `source_hash`, `source_revision` and `analysis_generation`.
- The background `server/src/autoReview.ts` is currently a known risk: it reads
  unverified analyses and does an unconditional prose UPDATE after awaiting an
  LLM. Replace the write with the same CAS and source checks as manual review.
- In SSE, admit a report only after a valid analysis; propagate structured
  `analysis_source_stale` / `review_source_changed` errors to Agent C.
- When the underlying engine analysis changes, cached prose must become stale
  even if the PGN is unchanged. Never reuse old prose just because its own
  scoring version equals the new scoring version.

## Schema/migration boundary

The code adds four columns and one trigger during normal `db.ts` initialization.
**Do not deploy** this schema change without an owner-approved migration plan
and a disposable SQLite rehearsal of fresh and upgraded DBs (including the
`widenGamesSourceCheck` rebuild). Existing rows have NULL provenance and
must be reanalyzed on demand. No historical backfills are performed.

## Verification and outstanding integration

- Full `npm run typecheck` and `npm run build` succeeded.
- Full original Vitest suite: **771 passed, 5 skipped**. Focused source tests
  after adding generation: **17 passed** including seven authenticated Hono
  route tests with bounded real local Stockfish depth 8, and 10 SQLite tests.
- Verified: same-source hit, edited PGN, same-ply alternative PGN, Black-first
  FEN, legacy NULL provenance, ABA, harmless bookmark/notes changes, forced
  reanalysis generation advancement, source updates during actual Stockfish.
- Existing hosted-adapter parser tests passed in the full suite; no live
  hosted request was made (permission not assumed).
- **Still necessary:** migration rehearsal across fresh/upgraded databases,
  cross-process SQLite writer tests, scoring PR #17 rebase/merge validation,
  stale-provenance gates on aggregated list/stats/insights reads, Agent B/C
  integration, rerun benchmark checkpoints 32–35 after integration, and
  independent negative control. Agent B's separate review attestation must
  incorporate this branch's authoritative source hash/revision/generation.

**Status:** isolated engine-source fix tested, but not release certified.
