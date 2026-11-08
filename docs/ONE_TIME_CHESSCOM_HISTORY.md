# One-time Chess.com history catch-up (all available monthly archives)

This is an **explicit, manually invoked, resumable import**, not a recurring job.
It does **not** modify or replace Patzer's normal sync. `server/src/autoImport.ts`
still checks the latest **20** games approximately every **15 minutes**, and
continues to analyze only a small number of new games per sync tick.

## Import once

Run from the checked-out Patzer repository, after building the server:

```bash
npm run build -w server
node scripts/import-chesscom-history.mjs \
  --db=/ABSOLUTE/PATH/TO/chess.db \
  --username=YOUR_CHESSCOM_USERNAME
```

Use the **actual live SQLite DB path**, not an empty `data/chess.db` in a new
checkout. If unsure, inspect the Patzer service `DB_PATH` before importing.
The username must already be linked to one of the database's profiles in
Settings. The script refuses to create a new DB or import into an unrelated
profile, and uses no password or private Chess.com authentication.

Before writing any games it creates a timestamped **online SQLite backup** in
`<database-folder>/backups/` and checks the backup for integrity. An online
backup is important because the running server uses SQLite WAL mode.

The script requests Chess.com's public monthly archives from oldest to newest,
fetching each one sequentially with retry/backoff for transient errors. Each
month is committed atomically. Games are deduplicated by the existing
`(user_id, source, external_id)` unique key; existing PGNs and analyses are
preserved, and imported games are marked `rated=0` in Patzer's local pool.
Standard games with valid PGN and a matching account are imported, including
opening ECO metadata where Chess.com provides it. Unsupported variants are
excluded because Patzer's normal-chess engine cannot analyze their moves.

Progress is printed after every monthly archive and is checkpointed to the
private file `<database-folder>/.chesscom-history-<userId>.json` (mode 0600).
If an archive fetch or insertion fails, the command exits with an error;
already committed months stay saved. **Run the exact same command again to
resume**, without clearing the checkpoint. The newest standard games continue
to be handled by the unchanged recurring sync. No importer daemon or timer is
installed. The command starts **no bulk Stockfish analysis**.

## After import: statistics and game list

The Review page still loads **the latest 100 games** by default, to avoid
rendering thousands of game cards. It also reports the **real total number of
saved games**, rather than incorrectly presenting the visible 100 as the total.

The Insights page deliberately separates all-game aggregates from
Stockfish-dependent aggregates:

| Metric | Population |
| --- | --- |
| Saved game count, wins/draws/losses by time class | **All** matching stored games |
| Opening repertoire frequencies and win/draw/loss | **All** stored games with an ECO opening tag, analyzed or not |
| Average move accuracy, mistake taxonomy, move quality, phase accuracy | **All games with current-version Stockfish analysis**; unanalysed games cannot have truthful accuracy/quality yet |
| Activity heatmap | All stored games **from the last 365 days** |
| Accuracy trend chart | The **50 most recent analyzed** games (deliberate trend view) |
| Brilliant-move list and openings table | Recent 10 notable moves, top 10 openings, based on **all eligible** records |

Older Insights routes also iterate every current-version analyzed game, not an
arbitrary 50/200-game slice. Analysis-dependent statistics grow as games are
analyzed in the existing workflow; the one-time import does not enqueue a
thousand CPU-heavy Stockfish jobs.

## Verification and safety

The implementation has tests for all-archive traversal, standard-only import,
case-insensitive account matching, `ON CONFLICT` dedupe, resume checkpoint
behavior, temporary API errors, URL validation, and aggregate statistics over
more than 200 analyzed games and 260 saved games. The script and the statistics
change can be reviewed independently of auto sync.
