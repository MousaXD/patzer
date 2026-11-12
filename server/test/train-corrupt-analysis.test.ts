import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-train-corrupt-analysis-'));
process.env.DB_PATH = join(scratch, 'train.db');
let db: typeof import('../src/db.js')['db'];
let train: typeof import('../src/routes/train.js')['default'];
let cookie: string;

const fen = '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 w - - 0 1';
const move = {
  ply: 1, san: 'Qd3', uci: 'd2d3', fen_before: fen, fen_after: fen,
  classification: 'miss', centipawn_loss: 900,
  best_move_uci: 'd2d8', best_move_san: 'Qxd8+', best_pv: ['Qxd8+', 'Qxd8', 'Rxd8#'],
  eval_before_cp: 2000, eval_after_cp: 0,
};

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  train = (await import('../src/routes/train.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'mine','x','user'),(2,'other','x','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES (1,'Mine'),(2,'Other')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const addGame = db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,end_time,user_color)
    VALUES (?,?,'played','fixture','Mine','Bot','loss',?,'white')`);
  addGame.run(101, 1, '2026-11-12T12:00:00Z'); // newest, invalid JSON
  addGame.run(102, 1, '2026-11-11T12:00:00Z'); // invalid board
  addGame.run(103, 1, '2026-11-10T12:00:00Z'); // valid older training
  addGame.run(104, 2, '2026-11-13T12:00:00Z'); // another account
  addGame.run(105, 1, '2026-11-14T12:00:00Z'); // valid JSON, invalid elements

  const addAnalysis = db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,scoring_version,source_hash,source_revision,analysis_generation)
    VALUES (?,14,?,?,'current-fixture',0,1)`);
  addAnalysis.run(101, '{invalid json', SCORING_VERSION);
  addAnalysis.run(102, JSON.stringify([{ ...move, fen_before: 'not-a-fen' }]), SCORING_VERSION);
  addAnalysis.run(103, JSON.stringify([move]), SCORING_VERSION);
  addAnalysis.run(104, JSON.stringify([move]), SCORING_VERSION);
  addAnalysis.run(105, JSON.stringify(['invalid element', 37, null, { not_a_move: true }]), SCORING_VERSION);

  // A due record from a corrupt analysis may be retained as honest history,
  // but it must not make the current due queue crash or claim a usable task.
  db.prepare(`INSERT INTO puzzle_attempts
    (user_id,game_id,ply,fen,solution_uci,solved,due_on,last_day)
    VALUES (1,101,1,?,'d2d8',0,'2026-11-11','2026-11-10')`).run(fen);
  db.prepare(`INSERT INTO puzzle_attempts
    (user_id,game_id,ply,fen,solution_uci,solved,due_on,last_day)
    VALUES (1,105,1,?,'d2d8',0,'2026-11-11','2026-11-10')`).run(fen);
});
afterAll(() => { try { db.close(); } catch { /* no-op */ } rmSync(scratch, {recursive:true, force:true}); });

interface Next { puzzle: { game_id: number; ply: number; line: string[] } | null; due: number }
interface Stats { total: number; current_total: number; due: number }

async function get<T>(path: string): Promise<T> {
  const response = await train.request(path, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}

describe('personal Training with damaged cached analyses', () => {
  it('never counts a due attempt for a source-current but unplayable board position', async () => {
    // SQL metadata matches game 102 exactly, yet the cached FEN is invalid.
    // A user must not see a due task which Chess.js would refuse to serve.
    db.prepare(`INSERT INTO puzzle_attempts
      (user_id,game_id,ply,fen,solution_uci,solved,due_on,last_day)
      VALUES (1,102,1,'not-a-fen','d2d8',0,'2026-11-11','2026-11-10')`).run();
    try {
      const next = await get<Next>('/next?today=2026-11-12');
      expect(next).toMatchObject({ puzzle: { game_id: 103 }, due: 0 });
      const stats = await get<Stats & { outdated_attempts: number }>('/stats?today=2026-11-12');
      expect(stats).toMatchObject({ total: 3, current_total: 0, due: 0, outdated_attempts: 3 });
      expect((db.prepare('SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id=1').get() as { n:number }).n).toBe(3);
    } finally {
      db.prepare('DELETE FROM puzzle_attempts WHERE user_id=1 AND game_id=102').run();
    }
  });

  it('skips unreadable/newer and illegal positions, then finds a valid older personalized puzzle', async () => {
    const data = await get<Next>('/next?today=2026-11-12');
    expect(data).toMatchObject({
      puzzle: { game_id: 103, ply: 1, line: ['d2d8', 'f6d8', 'd1d8'] }, due: 0,
    });
    const stats = await get<Stats>('/stats?today=2026-11-12');
    expect(stats).toMatchObject({ total: 2, current_total: 0, due: 0 });
    expect((db.prepare('SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id=1').get() as { n:number }).n).toBe(2);
  });

  it('does not throw, save an attempt or offer a solution for invalid game data', async () => {
    expect((await get<Next>('/next?game_id=101&today=2026-11-12')).puzzle).toBeNull();
    expect((await get<Next>('/next?game_id=102&today=2026-11-12')).puzzle).toBeNull();
    expect((await get<Next>('/next?game_id=105&today=2026-11-12')).puzzle).toBeNull();

    const reply = await train.request('/check', {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type':'application/json' },
      body: JSON.stringify({game_id:102,ply:1,step:0,uci:'d2d8',source_revision:0,analysis_generation:1}),
    });
    expect(reply.status).toBe(404);
    expect(await reply.json()).toMatchObject({error:'not_found'});
    expect((db.prepare('SELECT COUNT(*) AS n FROM puzzle_attempts WHERE user_id=1').get() as { n:number }).n).toBe(2);
  });
});
