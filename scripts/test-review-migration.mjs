#!/usr/bin/env node
// Synthetic fresh/legacy migration, restart, backup and failed-backfill rehearsal.
// No application instance, production path, network or engine is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Chess } from 'chess.js';

const root = resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(join(tmpdir(), 'patzer-schema-test-'));
const run = (args, env = {}) => execFileSync(process.execPath, args, {
  cwd: root, env: { ...process.env, SESSION_SECRET: 'synthetic-migration-only',
    OIDC_ISSUER: '', OIDC_CLIENT_ID: '', ...env }, timeout: 120_000, encoding: 'utf8',
});
function seed(file) {
  run(['--input-type=module', '-e', "const {db}=await import('./server/dist/db.js');db.close();"], { DB_PATH: file });
  const db = new Database(file);
  db.pragma('foreign_keys=ON');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(1,'synthetic','unused','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES(1,'Synthetic')").run();
  for (let id = 1; id <= 4; id++) {
    const blackFirst = id === 2;
    const chess = new Chess(blackFirst ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1' : undefined);
    const moves = [];
    for (const san of blackFirst ? ['e5'] : ['e4', 'e5', 'Nf3', 'Nc6']) {
      const before = chess.fen(), m = chess.move(san), ply = moves.length + 1;
      moves.push({ ply, san: m.san, uci: m.from + m.to, fen_before: before, fen_after: chess.fen(),
        eval_before_cp: 0, eval_after_cp: ply * 60, mate_before: null, mate_after: null,
        best_move_uci: m.from + m.to, best_move_san: m.san, best_pv: [], centipawn_loss: 60,
        classification: id === 1 ? 'book' : id === 2 || (id === 3 && m.color === 'w') ? 'forced' : 'mistake' });
    }
    db.prepare(`INSERT INTO games(id,user_id,source,external_id,pgn,result,user_color,notes,bookmarked)
      VALUES(?,1,'imported',?,?,'win','white','retained note',1)`).run(id, `synthetic-${id}`, chess.pgn());
    db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,scoring_version,accuracy_white,accuracy_black,
      prose_json,prose_version,prose_lang,prose_audience) VALUES(?,8,?,9,99,99,?,4,'en','beginner')`)
      .run(id, JSON.stringify(moves), JSON.stringify({ summary: `Retained original report ${id}`, accuracy_model_version: 9 }));
    db.prepare(`INSERT INTO rating_history(game_id,user_id,time_class,rating_before,rating_after,rd_before,rd_after)
      VALUES(?,1,'blitz',1200,1210,350,340)`).run(id);
    db.prepare(`INSERT INTO puzzle_attempts(user_id,game_id,ply,fen,solution_uci,solved)
      VALUES(1,?,1,?,?,0)`).run(id, moves[0].fen_before, moves[0].uci);
  }
  db.close();
}
try {
  for (const legacy of [false, true]) {
    const file = join(scratch, legacy ? 'legacy.db' : 'fresh.db');
    seed(file);
    if (legacy) {
      const db = new Database(file);
      db.pragma('foreign_keys=OFF');
      db.exec('DROP TRIGGER trg_games_source_revision');
      for (const [table, column] of [['games', 'source_revision'], ['analyses', 'source_hash'],
        ['analyses', 'source_revision'], ['analyses', 'analysis_generation']]) db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='games'").get().sql;
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='games' AND sql IS NOT NULL").all();
      db.transaction(() => {
        db.exec(sql.replace(/^CREATE TABLE "?games"?/, 'CREATE TABLE games_legacy').replace("'chesscom','lichess',", "'chesscom',"));
        db.exec('INSERT INTO games_legacy SELECT * FROM games');
        db.exec('DROP TABLE games');
        db.exec('ALTER TABLE games_legacy RENAME TO games');
        for (const { sql } of indexes) db.exec(sql);
      })();
      assert.equal(db.pragma('foreign_key_check').length, 0);
      db.close();
    }
    console.log(run(['scripts/rehearse-review-migration.mjs', `--source=${file}`]));
    console.log(`PASS: ${legacy ? 'legacy constraint rebuild + provenance upgrade' : 'fresh schema'} rehearsal`);
  }
  const malformed = join(scratch, 'malformed.db');
  seed(malformed);
  let db = new Database(malformed);
  db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=4').run('[{"invalid":"no evaluation"}]');
  const before = db.prepare('SELECT * FROM analyses ORDER BY game_id').all(); db.close();
  assert.throws(() => run(['scripts/recalculate-accuracy.mjs', `--db=${malformed}`, '--apply']),
    'A malformed final row must refuse the whole batch');
  db = new Database(malformed);
  assert.deepEqual(db.prepare('SELECT * FROM analyses ORDER BY game_id').all(), before);
  db.close();
  console.log('PASS: malformed historical analysis refuses backfill without partial changes');
  const interrupted = join(scratch, 'transaction-failure.db');
  seed(interrupted);
  db = new Database(interrupted);
  db.exec(`CREATE TRIGGER synthetic_interrupt BEFORE UPDATE ON analyses
    WHEN OLD.game_id=4 BEGIN SELECT RAISE(ABORT,'synthetic interrupted migration'); END;`);
  const original = db.prepare('SELECT * FROM analyses ORDER BY game_id').all(); db.close();
  assert.throws(() => run(['scripts/recalculate-accuracy.mjs', `--db=${interrupted}`, '--apply']));
  db = new Database(interrupted);
  assert.deepEqual(db.prepare('SELECT * FROM analyses ORDER BY game_id').all(), original);
  db.exec('DROP TRIGGER synthetic_interrupt'); db.close();
  console.log(run(['scripts/recalculate-accuracy.mjs', `--db=${interrupted}`, '--apply']));
  console.log('PASS: mid-transaction interruption rolls back all rows and a clean retry succeeds');
} finally { rmSync(scratch, { recursive: true, force: true }); }
