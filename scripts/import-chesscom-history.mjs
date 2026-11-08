#!/usr/bin/env node
/** One-time, explicitly invoked historical Chess.com catch-up.
 * Auto-sync (latest 20 games/15 min) is intentionally unchanged.
 *
 * Usage: node scripts/import-chesscom-history.mjs \
 *   --db=/absolute/path/to/chess.db --username=YOUR_CHESSCOM_HANDLE
 *
 * The script only matches an existing local profile, makes an integrity-checked
 * online backup before editing, and checkpoints each monthly archive. Re-running
 * an interrupted job is safe; imported games are deduplicated by their URL.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { importChessComHistory } from '../server/dist/chess/chesscomHistory.js';

function usage() {
  return 'Usage: node scripts/import-chesscom-history.mjs --db=/absolute/path/chess.db --username=chesscom_username';
}
function parseOptions(args) {
  const allowed = new Set(['db', 'username']);
  const options = {};
  for (const arg of args) {
    const parsed = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!parsed || !allowed.has(parsed[1]) || options[parsed[1]]) throw new Error(usage());
    options[parsed[1]] = parsed[2];
  }
  if (!options.db || !options.username || !isAbsolute(options.db) || !/^[A-Za-z0-9_-]{2,40}$/.test(options.username)) {
    throw new Error(usage());
  }
  return { path: resolve(options.db), username: options.username };
}

function saveCheckpoint(path, data) {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    chmodSync(temp, 0o600);
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export async function runHistoryCli(args) {
  const { path, username } = parseOptions(args);
  if (!existsSync(path)) throw new Error(`Existing Patzer database not found: ${path}`);
  const db = new Database(path, { fileMustExist: true });
  db.pragma('busy_timeout = 15000');
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed; refusing import');
    const profile = db.prepare(`SELECT p.user_id AS id, p.chesscom_username AS username
      FROM profiles p WHERE lower(p.chesscom_username) = lower(?)`).get(username);
    if (!profile || profile.username?.toLowerCase() !== username.toLowerCase()) {
      throw new Error(`No existing Patzer profile is connected to Chess.com account @${username}. Refusing to write unrelated games.`);
    }
    const checkpointPath = join(dirname(path), `.chesscom-history-${profile.id}.json`);
    let completed = new Set();
    if (existsSync(checkpointPath)) {
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (checkpoint.version !== 1 || checkpoint.userId !== profile.id || checkpoint.username.toLowerCase() !== username.toLowerCase() || checkpoint.db !== path || !Array.isArray(checkpoint.months)) {
        throw new Error('An incompatible checkpoint exists; refusing to skip archived data');
      }
      completed = new Set(checkpoint.months);
    }
    const before = db.prepare('SELECT count(*) AS n FROM games WHERE user_id = ? AND source = ?').get(profile.id, 'chesscom').n;
    // SQLite's online backup correctly includes committed WAL records while
    // the Patzer server remains online; a bytewise cp of the DB would not.
    const backupDir = join(dirname(path), 'backups');
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    chmodSync(backupDir, 0o700);
    const label = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(backupDir, `chess-before-history-import-${label}.db`);
    await db.backup(backupPath);
    chmodSync(backupPath, 0o600);
    const check = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup failed integrity validation');
      const savedCount = check.prepare('SELECT count(*) AS n FROM games WHERE user_id = ? AND source = ?').get(profile.id, 'chesscom').n;
      if (savedCount !== before) throw new Error('Backup count mismatch');
    } finally { check.close(); }
    console.log(`Patzer history import for @${username} — ${before} Chess.com games already saved`);
    console.log(`Verified online database backup: ${backupPath}`);
    if (completed.size) console.log(`Resuming after ${completed.size} completed monthly archives.`);
    const result = await importChessComHistory(db, profile.id, username, {
      alreadyCompleted: completed,
      onMonth: ({ archive, archives, fetched, added, duplicates, skipped }) => {
        completed.add(archive);
        saveCheckpoint(checkpointPath, { version: 1, userId: profile.id, username, db: path, months: [...completed] });
        const month = archive.split('/').slice(-2).join('-');
        console.log(`[${completed.size}/${archives}] ${month}: fetched ${fetched}, saved ${added}, existing ${duplicates}, excluded ${skipped}`);
      },
    });
    const after = db.prepare('SELECT count(*) AS n FROM games WHERE user_id = ? AND source = ?').get(profile.id, 'chesscom').n;
    if (after < before || after - before < result.imported) throw new Error('Post-import counts do not match inserted records');
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Post-import integrity check failed');
    console.log(`COMPLETE: ${completed.size}/${result.archives} monthly archives; ${before} → ${after} saved Chess.com games (+${result.imported}).`);
    console.log(`Nonstandard/invalid skipped this run: ${result.skippedNonStandardOrInvalid}. No full-history Stockfish analysis was started.`);
    console.log('The existing 20-game automatic sync and 15-minute cadence were not modified.');
    return { before, after, ...result };
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runHistoryCli(process.argv.slice(2)).catch((error) => {
    console.error('One-time history import stopped:', error instanceof Error ? error.message : String(error));
    console.error('Previously committed monthly archives remain saved. Run the same command to resume.');
    process.exitCode = 1;
  });
}
