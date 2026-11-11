#!/usr/bin/env node
/**
 * Disposable-only rehearsal of Batch 3 provenance schema plus PR #17 v9->v10.
 * Source is ALWAYS opened read-only and copied with SQLite's online backup.
 * All migrations run on a private temporary copy. Nothing is deployed.
 *
 * Usage: node scripts/rehearse-review-migration.mjs --source=/absolute/path/chess.db
 * Requires `npm run build` first.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import Database from 'better-sqlite3';

const root = resolve(import.meta.dirname, '..');
const arg = process.argv[2];
if (process.argv.length !== 3 || !arg?.startsWith('--source=')) {
  throw new Error('Usage: node scripts/rehearse-review-migration.mjs --source=/absolute/path/chess.db');
}
const sourcePath = arg.slice('--source='.length);
if (!isAbsolute(sourcePath) || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
  throw new Error('Source must be an existing absolute SQLite file; it is never modified');
}

const scratch = mkdtempSync(join(tmpdir(), 'patzer-review-migration-'));
const target = join(scratch, 'snapshot.db');
const integrity = (db) => {
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok', 'SQLite quick_check failed');
  return db.pragma('foreign_key_check').length;
};
const summary = (db) => {
  const hash = createHash('sha256');
  const games = db.prepare('SELECT id, pgn FROM games ORDER BY id').iterate();
  let gameCount = 0;
  for (const row of games) { hash.update(JSON.stringify([row.id, row.pgn])); gameCount++; }
  const analyses = db.prepare('SELECT game_id, moves_json FROM analyses ORDER BY game_id').iterate();
  let analysisCount = 0;
  for (const row of analyses) { hash.update(JSON.stringify([row.game_id, row.moves_json])); analysisCount++; }
  const old = db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE scoring_version = 9').get().n;
  const v10 = db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE scoring_version = 10').get().n;
  return { gameCount, analysisCount, unchangedContents: hash.digest('hex'), old, v10 };
};
let source;
try {
  source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  source.pragma('busy_timeout = 15000');
  const beforeBrokenFk = integrity(source);
  const before = summary(source);
  await source.backup(target);
  source.close(); source = undefined;

  let copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(summary(copy), before, 'Online backup is not a faithful snapshot');
    assert.equal(integrity(copy), beforeBrokenFk, 'Backup changed foreign keys');
  } finally { copy.close(); }

  // Run the app's idempotent SQLite migrations on the snapshot, NEVER source.
  process.env.DB_PATH = target;
  process.env.SESSION_SECRET = 'synthetic-review-migration-test-secret';
  process.env.OIDC_ISSUER = '';
  process.env.OIDC_CLIENT_ID = '';
  const { db } = await import('../server/dist/db.js');
  try {
    assert.equal(integrity(db), beforeBrokenFk, 'Schema migration broke foreign keys');
    assert.equal(summary(db).unchangedContents, before.unchangedContents,
      'Schema migration changed game PGNs or saved engine move history');
    for (const [table, column] of [
      ['games', 'source_revision'], ['analyses', 'source_hash'],
      ['analyses', 'source_revision'], ['analyses', 'analysis_generation'],
    ]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      assert(columns.some((x) => x.name === column), `Missing schema column ${table}.${column}`);
    }
    const trigger = db.prepare(`SELECT name FROM sqlite_master WHERE type='trigger'
      AND name='trg_games_source_revision'`).get();
    assert(trigger, 'Source-revision trigger did not survive the legacy table rebuild');
  } finally { db.close(); }

  const runAccuracy = (mode) => execFileSync(process.execPath,
    ['scripts/recalculate-accuracy.mjs', `--db=${target}`, mode],
    { cwd: root, timeout: 120_000, encoding: 'utf8', maxBuffer: 3_000_000 });
  runAccuracy('--dry-run');
  runAccuracy('--apply');

  copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    assert.equal(integrity(copy), beforeBrokenFk, 'Accuracy migration broke foreign keys');
    const after = summary(copy);
    assert.equal(after.gameCount, before.gameCount);
    assert.equal(after.analysisCount, before.analysisCount);
    assert.equal(after.unchangedContents, before.unchangedContents,
      'Accuracy migration changed a game PGN or saved move history');
    assert.equal(after.old, 0, 'Some v9 rows were not migrated');
    assert.equal(after.v10, before.v10 + before.old, 'Unexpected scoring-version row changes');
    console.log(`REHEARSAL PASS: ${before.gameCount} games, ${before.analysisCount} analyses, `
      + `${before.old} v9 scores reaggregated, PGNs and move histories unchanged, `
      + `foreign-key violations unchanged (${beforeBrokenFk}).`);
  } finally { copy.close(); }

  // Second invocation should find no v9 work. This also checks idempotency.
  runAccuracy('--apply');
  console.log('PASS: v10 scoring migration is idempotent on the disposable snapshot.');
} finally {
  try { source?.close(); } catch { /* prior open failed */ }
  rmSync(scratch, { recursive: true, force: true });
}
