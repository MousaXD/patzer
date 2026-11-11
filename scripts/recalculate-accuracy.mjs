#!/usr/bin/env node
/** Offline evaluation-only backfill for accuracy model v9 → v10.
 * Usage:
 *   node scripts/recalculate-accuracy.mjs --db=/abs/path/chess.db --dry-run
 *   node scripts/recalculate-accuracy.mjs --db=/abs/path/chess.db --apply
 *
 * No PGNs/moves are changed, no Stockfish spawned. Full online SQLite backup,
 * preflight validations, one transaction, and only existing v9 rows upgraded.
 */
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { recalculateAnalysisFromMoves } from '../server/dist/chess/accuracyBackfill.js';
import { SCORING_VERSION } from '../server/dist/chess/classifier.js';

function options(argv) {
  if (argv.length !== 2 || !argv[0].startsWith('--db=') || !['--apply', '--dry-run'].includes(argv[1])) {
    throw new Error('Usage: node scripts/recalculate-accuracy.mjs --db=/absolute/path/chess.db --dry-run|--apply');
  }
  const file = argv[0].slice(5);
  if (!file || !isAbsolute(file) || !existsSync(file)) throw new Error('Existing absolute SQLite database path required');
  return { path: resolve(file), apply: argv[1] === '--apply' };
}

async function run(argv) {
  const { path, apply } = options(argv);
  if (SCORING_VERSION !== 10) throw new Error('This migration only supports scoring version 10');
  const db = new Database(path, { fileMustExist: true, readonly: !apply });
  db.pragma('busy_timeout = 15000');
  try {
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Database integrity check failed');
    const oldTotal = db.prepare('SELECT count(*) AS n FROM games').get().n;
    const analyses = db.prepare('SELECT count(*) AS n FROM analyses').get().n;
    const rows = db.prepare(`
      SELECT a.game_id, a.scoring_version, a.moves_json, a.phase_split_json,
             a.prose_json, a.accuracy_white, a.accuracy_black,
             g.user_color, g.result, g.opponent_rating_before
      FROM analyses a JOIN games g ON g.id = a.game_id
      WHERE a.scoring_version = 9
      ORDER BY a.game_id
    `).all();
    const updated = [];
    const deltas = [];
    for (const r of rows) {
      const moves = JSON.parse(r.moves_json);
      const phases = r.phase_split_json ? JSON.parse(r.phase_split_json) : null;
      const values = recalculateAnalysisFromMoves(moves, {
        userColor: r.user_color, result: r.result, opponentRating: r.opponent_rating_before,
      }, phases);
      // Keep every existing AI report. It may mention the old accuracy number,
      // so flag it for an explicit per-game refresh in the UI instead of
      // deleting hundreds of reports and triggering mass LLM regeneration.
      let cachedReport = r.prose_json;
      if (cachedReport) {
        const parsed = JSON.parse(cachedReport);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          parsed.accuracy_model_version = 9;
          cachedReport = JSON.stringify(parsed);
        }
      }
      updated.push({ id: r.game_id, cachedReport, ...values });
      deltas.push({ id: r.game_id, whiteOld: r.accuracy_white, whiteNew: values.accuracyWhite,
        blackOld: r.accuracy_black, blackNew: values.accuracyBlack });
    }
    const count = updated.length;
    console.log(`Checked ${analyses} stored analyses, ${count} legacy v9 scores to recalculate; ${oldTotal} games unchanged.`);
    for (const id of [5665, 5685]) {
      const x = deltas.find((d) => d.id === id);
      if (x) console.log(`Sample ${id}: White ${x.whiteOld} → ${x.whiteNew}; Black ${x.blackOld} → ${x.blackNew}`);
    }
    if (!apply) { console.log('DRY RUN: no database changes made'); return; }
    if (!count) { console.log('No legacy analyses to migrate.'); return; }
    const backupDir = join(dirname(path), 'backups');
    mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = join(backupDir, `chess-before-accuracy-fix-${stamp}.db`);
    await db.backup(backup);
    chmodSync(backup, 0o600);
    const saved = new Database(backup, { readonly: true, fileMustExist: true });
    try {
      if (saved.pragma('integrity_check', { simple: true }) !== 'ok'
          || saved.prepare('SELECT count(*) AS n FROM games').get().n !== oldTotal
          || saved.prepare('SELECT count(*) AS n FROM analyses').get().n !== analyses) {
        throw new Error('Accuracy migration snapshot failed verification');
      }
    } finally { saved.close(); }
    console.log('Verified online SQLite backup:', backup);
    const update = db.prepare(`
      UPDATE analyses
      SET accuracy_white = ?, accuracy_black = ?,
          estimated_elo_white = ?, estimated_elo_black = ?,
          performance_white = ?, performance_black = ?,
          phase_split_json = ?, scoring_version = 10,
          prose_json = ?
      WHERE game_id = ? AND scoring_version = 9
    `);
    db.transaction(() => {
      for (const r of updated) {
        const changed = update.run(
          r.accuracyWhite, r.accuracyBlack, r.estimatedEloWhite, r.estimatedEloBlack,
          r.performanceWhite, r.performanceBlack,
          r.phaseSplit ? JSON.stringify(r.phaseSplit) : null, r.cachedReport, r.id,
        );
        if (changed.changes !== 1) throw new Error('Legacy row changed concurrently or disappeared: ' + r.id);
      }
    }).immediate();
    if (db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Post-migration integrity check failed');
    if (db.prepare('SELECT count(*) AS n FROM games').get().n !== oldTotal) throw new Error('Game count changed unexpectedly');
    if (db.prepare('SELECT count(*) AS n FROM analyses').get().n !== analyses) throw new Error('Analysis count changed unexpectedly');
    console.log(`COMPLETE: ${count} cached summaries recalculated without Stockfish; ${oldTotal} games and ${analyses} analyses preserved. Old AI report text retained and marked for optional refresh.`);
  } finally { db.close(); }
}

run(process.argv.slice(2)).catch((e) => { console.error('Accuracy migration stopped:', e.message); process.exitCode = 1; });
