import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This test intentionally uses disposable analysis rows to prove the category
// is governed by detected chess phases, not by a fixed move number.
const scratch = mkdtempSync(join(tmpdir(), 'patzer-insights-opening-phase-'));
process.env.DB_PATH = join(scratch, 'insights.db');
let db: typeof import('../src/db.js')['db'];
let route: typeof import('../src/routes/insightsV2.js')['default'];
let cookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  route = (await import('../src/routes/insightsV2.js')).default;
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'me','x','user'),(2,'other','x','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES (1,'Me'),(2,'Other')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;

  const addGame = db.prepare(`INSERT INTO games
    (id,user_id,source,pgn,white,black,result,end_time,user_color)
    VALUES (?,?,'played','fixture','Me','Bot','loss','2026-11-12T12:00:00Z','white')`);
  addGame.run(1, 1);
  addGame.run(2, 1);
  addGame.run(3, 2);

  const lateMove = {
    ply: 29, san: 'e4', uci: 'e2e4', classification: 'mistake', centipawn_loss: 90,
    eval_before_cp: 10, eval_after_cp: -80,
    fen_before: '8/8/8/8/8/8/8/8 w - - 0 1',
    fen_after: '8/8/8/8/8/8/8/8 b - - 0 1',
  };
  const longOpening = JSON.stringify({
    opening: { from_ply: 1, to_ply: 31, accuracy_white: 76, accuracy_black: 75 },
    middlegame: null, endgame: null,
  });
  const addAnalysis = db.prepare(`INSERT INTO analyses
    (game_id,depth,moves_json,scoring_version,phase_split_json,source_hash,source_revision,analysis_generation)
    VALUES (?,16,?,?,?,'current-fixture',0,1)`);
  addAnalysis.run(1, JSON.stringify([lateMove]), SCORING_VERSION, longOpening);
  addAnalysis.run(2, JSON.stringify([lateMove]), SCORING_VERSION, null);
  addAnalysis.run(3, JSON.stringify([lateMove]), SCORING_VERSION, longOpening);
});

afterAll(() => {
  try { db.close(); } catch { /* no-op */ }
  rmSync(scratch, { recursive: true, force: true });
});

describe('Insights opening mistake phase attribution', () => {
  it('counts a later move if the stored opening phase includes it, but not by an invented move-15 cutoff', async () => {
    const response = await route.request('/', { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      games_analyzed: number;
      mistake_taxonomy: { opening_pitfalls: number };
      move_quality: { counts: { mistake: number } };
    };
    // Two mistakes in the account's two analyzed games. Only game 1 has a
    // proven opening phase extending through ply 29 (~move 15 for White).
    expect(payload.games_analyzed).toBe(2);
    expect(payload.move_quality.counts.mistake).toBe(2);
    expect(payload.mistake_taxonomy.opening_pitfalls).toBe(1);
  });
});
