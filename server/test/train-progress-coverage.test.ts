import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A throwaway database: never inspect or mutate production game history.
const temp = mkdtempSync(join(tmpdir(), 'patzer-train-progress-'));
process.env.DB_PATH = join(temp, 'progress.db');

let db: typeof import('../src/db.js')['db'];
let router: typeof import('../src/routes/train.js')['default'];
let cookie: string;

const sample = {
  ply: 1, san: 'Qd3', uci: 'd2d3',
  fen_before: '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 1',
  fen_after: '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 1',
  best_move_uci: 'd2d8', best_move_san: 'Qxd8+', best_pv: ['Qxd8+', 'Qxd8', 'Rxd8#'],
  classification: 'miss', centipawn_loss: 800,
};

async function get(path: string) {
  const response = await router.request(path, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return response.json();
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  router = (await import('../src/routes/train.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');

  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'me','x','user'),(2,'another','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Me'),(2,'Another')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const game = db.prepare(`INSERT INTO games
    (id,user_id,source,pgn,white,black,result,end_time,user_color)
    VALUES (?, ?, 'chesscom', ?, 'Me','Opponent','loss','2026-11-12','white')`);
  game.run(1, 1, '1. e4 e5');
  game.run(2, 1, '1. d4 d5');
  game.run(3, 1, '1. Nf3 d5');
  game.run(4, 2, '1. c4 c5');

  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,scoring_version,source_hash,source_revision,analysis_generation)
    VALUES (1,14,?,?, 'original-game',0,1)`).run(JSON.stringify([sample]), SCORING_VERSION);
  db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,scoring_version,source_hash,source_revision,analysis_generation)
    VALUES (3,14,'[]',?, 'analyzed-empty',0,1)`).run(SCORING_VERSION);
  // A real historical solve. A subsequent source edit makes it obsolete.
  db.prepare(`INSERT INTO puzzle_attempts
    (user_id,game_id,ply,fen,solution_uci,solved,due_on,last_day)
    VALUES (1,1,1,?,'d2d8',1,NULL,'2026-11-10')`).run(sample.fen_before);
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(temp, { recursive: true, force: true });
});

describe('personal training progress and analysis coverage', () => {
  it('reports currently solved puzzles separately from historical effort', async () => {
    const initial = await get('/stats?today=2026-11-12');
    expect(initial).toMatchObject({
      total: 1, solved: 1, accuracy: 100,
      current_total: 1, current_solved: 1, current_accuracy: 100,
      outdated_attempts: 0,
    });

    db.prepare("UPDATE games SET pgn='1. e4 c5' WHERE id=1").run();
    const stale = await get('/stats?today=2026-11-12');
    expect(stale).toMatchObject({
      total: 1, solved: 1, accuracy: 100,
      current_total: 0, current_solved: 0, current_accuracy: null,
      outdated_attempts: 1, due: 0,
    });
    expect(db.prepare('SELECT solved FROM puzzle_attempts WHERE user_id=1 AND game_id=1').get())
      .toEqual({ solved: 1 });
  });

  it('distinguishes an empty training queue from games awaiting analysis', async () => {
    // Game 1 has a source-obsolete analysis; game 2 has no analysis;
    // game 3 is current but contains no eligible mistake; game 4 is another user.
    const next = await get('/next?today=2026-11-12');
    expect(next).toMatchObject({ puzzle: null, due: 0, awaiting_analysis: 2 });
  });
});
