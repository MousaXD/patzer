# Final integration certification — November 11, 2026

Local release gates pass. Remote exact-head CI and the merge result are recorded
on the integration PR; they remain mandatory gates, not inferred from this file.
Production deployment is held for manual schema review as described in the
[migration report](FINAL-MIGRATION-SAFETY-20261111.md).

## Source manifest and recovery

The preserved starting worktree is
`/home/mousa/projects/my-creations/game/.patzer-cert-pr17-20261111`, originally at
`f23385d0e8d885d7e4b280800c129b83a8604d3d`, with 24 intentional modified tracked
files and three untracked integration documents/scripts. The original patch
was saved before changes; its source corrections were committed as `94cb810`.
No files were reset or discarded. Work proceeds on
`integration/patzer-final-20261111`; the live main checkout is untouched.

Included specialist heads:

| Lane | Commit |
| --- | --- |
| Engine A | `fb6f39bc52f2952506b1393a1864c66ce460459a` |
| Coach B | `50ba0fe49787b8102db35e959b30a88d62256b0c` |
| Frontend C, including latest provenance tests | `22e2b71ec5e8e35a5fe413d8245373383ecec94a` |
| Independent QA D, including checkpoint 36 | `0404a029196b9c60f14e8a8ef04302bb0f385386` |
| PR #17 v10 scoring | `02bfe983c14bf521e05ec4f463f5e4c70ef3f7bd` |

PR #17 is a single ancestor commit, merged once in the starting candidate. Its
v10 formula is preserved. The integration fixes zero-eligible-move historical
Elo/performance eligibility without introducing a replacement accuracy formula.
Frontend merge conflicts were resolved to require complete provenance (including
a 64-character source hash); the standalone legacy fallback was not admitted.

## Correctness result

Review admission uses the canonical engine source check. Prose identity and
watchdog/CAS snapshots include source revision and analysis generation. Legacy
NULL evidence fails closed. An A → B → A game remains stale until a genuine new
engine analysis; identical fresh runs still advance generation. Aggregate routes
exclude unverified or revision-mismatched evidence, while detailed review routes
perform full source/move validation. Bookmarks and notes preserve valid reports.

Mounted frontend state is bound to the same source tokens. Source refreshes
invalidate completed prose and cancel obsolete SSE/model work. Cold reloads
read only backend-validated reports. Blind practice continues to hide solutions,
cancel work on navigation, support keyboard/touch and leave the saved PGN intact.
Truncated analysis is rejected; its old partial-practice fixture was replaced by
an explicit rejection check plus a separate complete-game switching assertion.

## Executed evidence

- TypeScript and production build pass. Full Vitest: **927 passed, zero skips**,
  across 104 files, with an explicitly configured real engine. The initial
  sandbox-only attempt failed on blocked localhost/subprocess operations; the
  unrestricted isolated rerun passed. No product assertion was relaxed for the
  sandbox failures.
- Focused source/CAS/scoring regressions pass. The final script also runs full
  real-engine lifecycle suites; Stockfish 16 and the installed Stockfish 17
  binary have both been exercised. Stockfish 17 SHA256:
  `4c22bce76bb3b08b20d761e5c268b802df2d52bdbbd98494d558e880bd6beceb`.
  Searches are bounded, single-threaded with 16 MiB hash; no mass reanalysis.
- MCP protocol/fake-server suite: **7/7 passed**.
- Real Chromium Game Review/practice suite: **22 scenarios passed**, covering
  mounted report invalidation, hostile late SSE, A → B → A, cancellation, blind
  practice, keyboard/focus, mobile touch, all supported languages and responsive
  light/dark layouts. One early fixture expectation for partial analysis failed
  correctly and was replaced with stronger complete-evidence assertions.
- Separate integration-authored Chromium test passes through real combined
  HTTP/SSE, SQLite and two bounded engine analyses. It verifies legacy-history
  preservation, cold cache reads, harmless bookmarks, completed-report source
  refresh/reload, and closure of a held real local-model HTTP connection after
  source refresh, without transport interception or product-function stubs.
- Agent D's unchanged original A → B → A runner passes on corrected source.
  Its newer fixed-behavior runner passes **14 assertions**, including recovery,
  same-byte-length PGNs, account isolation, legacy NULL provenance and
  same-second generation races. The integration adds a successful complete-
  snapshot CAS control before the generation race, so rejection cannot pass
  trivially because required source fields were omitted.
- The adapted independent concurrent-review experiment passes: B finishes first
  and remains cached/readable; obsolete A emits no `done`, cannot overwrite B,
  and stops after its first phase. Four local-model requests close cleanly
  (one obsolete phase plus B's three stages). Initial overlapping work is not
  coalesced; this is a bounded existing efficiency limitation, not a stale write.
- Fresh/legacy schema, scoring, restart, interrupted transaction, idempotency and
  rollback rehearsals pass. A read-only prior deployment backup containing
  **1,830 games / 460 analyses** also passes on a temporary copy. See migration
  report for exact preservation guarantees and operator procedure.

## Negative controls

The historical `f23385d` candidate was recreated in an isolated detached worktree.
The original independent A → B → A runner exits **1**, with game revision 0 → 2,
engine stale=true and report resurrected=true. The fixed-behavior runner exits
**1**, rejecting four genuine defects: resurrected GET prose, admitted stale
POST, stale library flags and old-generation CAS acceptance. Corrected source
rejects those same behaviors. Historical owner/QA sources and proof packets were
not rewritten.

Agent D's original checkpoint 32–35 evidence validators also pass their hostile
controls: **71 + 92 + 100 + 109 = 372 forged packets rejected**. These validate
historical proof sensitivity; they are not substituted for fresh candidate tests.

## Bounded read-path comparison

Separate synthetic databases hold 20,000 games and 5,000 aggregate-only analysis
fixtures. Five warmups precede 60 measured authenticated requests per endpoint.
These provenance strings never enter report generation. On this host:

| Endpoint | Old candidate p95 | Corrected candidate p95 |
| --- | ---: | ---: |
| Analyzed library page | 5.96 ms | 5.47 ms |
| Full-history insights | 66.51 ms | 47.89 ms |

An initial 9.44 ms library result exposed a COALESCE wrapper that hid positive
predicates from SQLite's join planner. Preserving the direct positive predicates
removed that overhead; the 20,000-game correctness regressions still pass.
These are local synthetic measurements, not a production SLO or a learning/
accuracy comparison against Chess.com.

## Release scope and remaining operational work

No known P0/P1 source-integrity defect remains in the exercised cases. GitHub CI
must pass on the exact PR head before merge, and main drift must be rechecked.
No version tag, production service action, production migration, active database
test, updater modification or force push is part of this integration. The
production migration/rollout hold is deliberate. Broader model quality, physical
device/screen-reader usability and comparative learning outcomes remain outside
this correctness certification; no Chess.com superiority claim is made.
