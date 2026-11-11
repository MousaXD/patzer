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
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync, readdirSync } from 'node:fs';
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
const rows = (db, table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
const snapshot = (db) => Object.fromEntries(db.prepare(`SELECT name FROM sqlite_master
  WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
  .map(({ name }) => [name, rows(db, '"' + name.replaceAll('"', '""') + '"')]));
const reopenSchema = () => execFileSync(process.execPath, ['--input-type=module', '-e',
  "const {db}=await import('./server/dist/db.js');db.close();"],
  { cwd: root, env: { ...process.env, DB_PATH: target }, timeout: 30_000 });
let source;
try {
  source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  source.pragma('busy_timeout = 15000');
  const beforeBrokenFk = integrity(source);
  const before = summary(source);
  const beforeRows = snapshot(source);
  const beforeIndexes = source.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`).all();
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
    for (const [table, records] of Object.entries(beforeRows)) {
      // Existing fields in every table must survive additive startup migration.
      // Session activity is intentionally initialized by older startup migrations.
      if (table === 'sessions') continue;
      const migrated = rows(db, '"' + table.replaceAll('"', '""') + '"');
      assert.equal(migrated.length, records.length, `${table} row count changed`);
      records.forEach((record, i) => {
        for (const [key, value] of Object.entries(record))
          assert(isDeepStrictEqual(migrated[i][key], value), `${table}.${key} changed`);
      });
    }
    for (const { name } of beforeIndexes)
      assert(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name=?`).get(name));
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    // Exercise all tracked scoring fields and harmless metadata without leaving
    // fixture mutations behind. Rollback also verifies transactional triggers.
    db.exec('BEGIN');
    try {
      const game = db.prepare('SELECT id,source_revision FROM games LIMIT 1').get();
      if (game) {
        db.prepare('UPDATE games SET notes=?,bookmarked=1 WHERE id=?').run('rehearsal only', game.id);
        assert.equal(db.prepare('SELECT source_revision AS r FROM games WHERE id=?').get(game.id).r, game.source_revision);
        for (const [column, value] of [['pgn', '1. d4 *'], ['start_fen', 'synthetic-trigger-only'],
          ['user_color', 'black'], ['result', 'draw'], ['opponent_rating_before', 1901], ['user_rd_before', 81]]) {
          const old = db.prepare(`SELECT ${column} AS v,source_revision AS r FROM games WHERE id=?`).get(game.id);
          const next = old.v === value ? null : value;
          db.prepare(`UPDATE games SET ${column}=? WHERE id=?`).run(next, game.id);
          assert.equal(db.prepare('SELECT source_revision AS r FROM games WHERE id=?').get(game.id).r, old.r + 1);
        }
      }
    } finally { db.exec('ROLLBACK'); }
  } finally { db.close(); }

  const runAccuracy = (mode) => execFileSync(process.execPath,
    ['scripts/recalculate-accuracy.mjs', `--db=${target}`, mode],
    { cwd: root, timeout: 120_000, encoding: 'utf8', maxBuffer: 3_000_000 });
  copy = new Database(target, { readonly: true });
  const preApply = snapshot(copy); copy.close();
  runAccuracy('--dry-run');
  copy = new Database(target, { readonly: true });
  assert(isDeepStrictEqual(snapshot(copy), preApply), 'Dry run changed the snapshot'); copy.close();
  runAccuracy('--apply');

  copy = new Database(target, { readonly: true, fileMustExist: true });
  let postApply;
  try {
    assert.equal(integrity(copy), beforeBrokenFk, 'Accuracy migration broke foreign keys');
    const after = summary(copy);
    assert.equal(after.gameCount, before.gameCount);
    assert.equal(after.analysisCount, before.analysisCount);
    assert.equal(after.unchangedContents, before.unchangedContents,
      'Accuracy migration changed a game PGN or saved move history');
    assert.equal(after.old, 0, 'Some v9 rows were not migrated');
    assert.equal(after.v10, before.v10 + before.old, 'Unexpected scoring-version row changes');
    postApply = snapshot(copy);
    for (const [table, records] of Object.entries(preApply)) {
      if (table !== 'analyses') assert(isDeepStrictEqual(postApply[table], records), `Backfill changed ${table}`);
    }
    for (let i = 0; i < preApply.analyses.length; i++) {
      const old = preApply.analyses[i], current = postApply.analyses[i];
      if (old.prose_json) {
        const expected = JSON.parse(old.prose_json);
        if (old.scoring_version === 9 && expected && typeof expected === 'object' && !Array.isArray(expected))
          expected.accuracy_model_version = 9;
        assert(isDeepStrictEqual(JSON.parse(current.prose_json), expected), 'Review history lost');
      }
      if (old.source_hash == null) {
        assert.equal(current.source_hash, null);
        assert.equal(current.source_revision, null);
        assert.equal(current.analysis_generation, 0);
      }
      if (old.scoring_version === 9) {
        const moves = JSON.parse(old.moves_json);
        for (const [side, color] of [['w', 'white'], ['b', 'black']]) {
          const eligible = moves.some((m) => m.fen_before.split(' ')[1] === side
            && m.classification !== 'book' && m.classification !== 'forced');
          if (!eligible) {
            assert.equal(current[`estimated_elo_${color}`], null, 'Zero-evidence Elo must be unavailable');
            assert.equal(current[`performance_${color}`], null, 'Zero-evidence performance must be unavailable');
          }
        }
      }
    }
    console.log(`REHEARSAL PASS: ${before.gameCount} games, ${before.analysisCount} analyses, `
      + `${before.old} v9 scores reaggregated, PGNs and move histories unchanged, `
      + `foreign-key violations unchanged (${beforeBrokenFk}).`);
  } finally { copy.close(); }

  // Second invocation should find no v9 work. This also checks idempotency.
  runAccuracy('--apply');
  reopenSchema();
  reopenSchema();
  copy = new Database(target, { readonly: true });
  try {
    assert.equal(integrity(copy), beforeBrokenFk);
    assert.equal(summary(copy).unchangedContents, before.unchangedContents);
    assert.equal(summary(copy).old, 0);
    assert(isDeepStrictEqual(snapshot(copy), postApply), 'Restart or repeated migration changed stored rows');
  } finally { copy.close(); }
  if (before.old > 0) {
    const backups = readdirSync(join(scratch, 'backups')).filter((name) => name.endsWith('.db'));
    assert.equal(backups.length, 1, 'Idempotent rerun should not create a second backup');
    const backup = new Database(join(scratch, 'backups', backups[0]), { readonly: true });
    const restored = join(scratch, 'restored.db');
    try {
      assert.equal(integrity(backup), beforeBrokenFk);
      assert(isDeepStrictEqual(snapshot(backup), preApply), 'Rollback backup must retain every pre-backfill row');
      await backup.backup(restored);
    } finally { backup.close(); }
    const recovered = new Database(restored, { readonly: true });
    try { assert(isDeepStrictEqual(snapshot(recovered), preApply), 'Restoration changed stored rows'); } finally { recovered.close(); }
    console.log('PASS: verified pre-backfill backup restores all original rows.');
  }
  source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  assert(isDeepStrictEqual(snapshot(source), beforeRows), 'Read-only source was changed');
  console.log('PASS: v10 scoring migration is idempotent on the disposable snapshot.');
} finally {
  try { source?.close(); } catch { /* prior open failed */ }
  rmSync(scratch, { recursive: true, force: true });
}
