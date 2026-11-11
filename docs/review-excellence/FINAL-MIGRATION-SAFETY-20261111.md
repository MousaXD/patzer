# Final migration and rollout safety — November 11, 2026

The combined source migration and optional v9-to-v10 scoring migration pass
disposable rehearsals. **Deployment remains a separate, manual operation.**
The integration release does not modify the active database, restart Patzer,
change the updater, or run a production backfill.

## Evidence actually executed

`node scripts/test-review-migration.mjs` exercises fresh installation and a
synthetic legacy installation without provenance columns and without `lichess`
in the `games.source` CHECK. Both contain four games, four v9 analyses,
historical prose, notes/bookmarks, rating history and puzzle references.

Verified invariants:

- The source is opened read-only and copied with SQLite Online Backup. All
  migrations run on a private temporary database; every original source row
  remains unchanged. Temporary copies and their backups are removed afterward.
- Startup adds the source revision, source hash and analysis generation fields.
  The legacy games-table rebuild retains IDs, all existing fields, foreign
  references, indexes and uniqueness. Foreign keys remain enabled, with zero
  violations; SQLite quick checks pass.
- The source trigger is present after rebuild and repeated startup. PGN,
  starting FEN, player color, result, opponent rating and player RD each advance
  the revision. Notes/bookmarks do not. Trigger test writes are rolled back.
- Dry-run changes no rows. Backfill preserves every PGN, move history and
  non-analysis row. Original prose fields survive, with the v9 accuracy marker
  retained. All-book/forced and Black-first zero-evidence sides retain NULL
  estimated Elo/performance. One-sided scored evidence remains side-specific.
- A second backfill and two new startup processes change no stored rows and
  create no additional migration backup. Legacy provenance remains NULL and
  generation remains 0; a score recalculation cannot certify old engine evidence.
- The verified pre-backfill online backup restores every pre-backfill row.
  Malformed historical data stops the entire batch before writes. An injected
  failure on the fourth UPDATE rolls back the first three updates, and a clean
  retry succeeds. These are deliberate failures, not ignored migration errors.

After synthetic tests passed, the same rehearsal ran against a read-only
**existing pre-deployment backup**, never the active SQLite database. Its
temporary copy contained **1,830 games and 460 analyses**. All **460 v9 rows**
were reaggregated to v10; PGNs, saved move histories, review text and foreign
references survived. Restart, idempotency, restoration and unchanged-source
checks passed. Only aggregate results were retained; private rows and credentials
were not exported into the repository.

## User-visible legacy behavior

Older analyses remain stored but cannot be served as verified current evidence.
Their scores do not count in library/insights/profile aggregates, and their AI
prose cannot be presented or regenerated as current. Applying the optional v10
backfill does not remove this source-verification requirement.

Viewing a legacy game preserves its stored cache. The localized page offers an
explicit **Run engine analysis** action and explains that it replaces the cached
analysis and AI report. A real Chromium regression checks that simply opening
the game starts no analysis POST, displays no legacy prose and leaves the stored
historical prose byte-for-byte intact. Existing cache replacement after explicit
reanalysis remains intentional; a database backup retains the prior history.
There is no bulk engine/LLM job or background report refresh for unverified rows.

## Auto-updater disposition

The deployed marker inspected during certification is
`51df1d852296e5f0644127a81b5ec31109c8e6c1`. The local updater runs every 12 hours,
requires successful exact-main push CI, and refuses unattended deployment when
`server/src/db.ts` changes relative to that marker. This release changes that
file. Its actual `maybe_block_schema_change()` function was evaluated against
the deployed marker and candidate source using a read-only Git adapter: it
returned **true**. No updater preflight, service action or database open was
invoked by that check. The updater's deployment marker must not be advanced to
bypass this hold.

The source merge can therefore proceed after CI without automatically applying
the schema to this installation. Docker publishing additionally requires an
explicit repository-variable opt-in; tag publishing requires a version tag.
This integration creates no version tag or production deployment.

## Manual rollout and rollback procedure

1. Schedule maintenance and freeze writers. Build/test the exact certified
   revision outside the running checkout. Review the migration behavior above.
2. Create a fresh, restricted-permission SQLite Online Backup, verify its
   integrity and row counts, and retain the previous runtime/source revision.
   Rehearse this specific backup with `rehearse-review-migration.mjs` first.
3. Under separate deployment authorization, stop the service/writers and install
   the certified runtime. Startup applies only additive provenance/schema work;
   legacy cached histories remain stored and stale.
4. The scoring backfill is optional because provenance still requires per-game
   reanalysis. If authorized, dry-run it first, then apply while writers remain
   stopped. It creates another verified online backup and uses one transaction.
   Never use an active production database as a migration experiment.
5. Check integrity, foreign keys, counts and a small authorized sample before
   resuming writers. Monitor one explicit reanalysis/report and account access;
   do not trigger mass recalculation.
6. If startup or validation fails, stop writers and restore the prior runtime.
   For a full data rollback, restore the verified backup through SQLite into a
   fresh database and atomically install it with writers stopped; handle WAL/SHM
   sidecars as part of that maintenance operation. Never copy a live WAL file
   bytewise. A restore discards writes after the snapshot, which is why writers
   stay frozen until validation succeeds. Do not silently roll back user writes.

No step in this manual procedure was executed on production during integration.
