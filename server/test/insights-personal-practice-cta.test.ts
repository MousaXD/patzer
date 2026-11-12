import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-insights-practice-'));
process.env.DB_PATH = join(scratch, 'insights.db');
let db: typeof import('../src/db.js')['db'];
let route: typeof import('../src/routes/insightsV2.js')['default'];
let cookie: string;

const initial = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const mistake = {
  ply: 1, san: 'd4', uci: 'd2d4', classification: 'mistake', centipawn_loss: 200,
  eval_before_cp: 0, eval_after_cp: -200,
  fen_before: initial,
  fen_after: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1',
};

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  route = (await import('../src/routes/insightsV2.js')).default;
  const { SCORING_VERSION } = await import('../src/chess/classifier.js');
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES (1,'mine','x','user'),(2,'other','x','user')").run();
  db.prepare("INSERT INTO profiles(user_id,display_name) VALUES (1,'Mine'),(2,'Other')").run();
  cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  const addGame = db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,end_time,user_color)
    VALUES (?,?,'played','1. d4 d5','Mine','Bot','loss','2026-11-12T12:00:00Z','white')`);
  addGame.run(101,1);
  addGame.run(102,2);
  const addAnalysis = db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,scoring_version,
    source_hash,source_revision,analysis_generation) VALUES (?,16,?,?,'current-fixture',0,1)`);
  addAnalysis.run(101, JSON.stringify([mistake]), SCORING_VERSION);
  addAnalysis.run(102, JSON.stringify([{ ...mistake, best_move_uci: 'e2e4', best_move_san: 'e4', best_pv: ['e4'] }]), SCORING_VERSION);
});
afterAll(() => { try { db.close(); } catch { /* no-op */ } rmSync(scratch, {recursive:true, force:true}); });

async function coverage(): Promise<{ games_analyzed: number; personal_puzzle_positions: boolean }> {
  const response = await route.request('/', { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ games_analyzed: number; personal_puzzle_positions: boolean }>;
}

describe('Insights personalized training recommendation eligibility', () => {
  it('only recommends a playable personal position from the user’s current authoritative analysis', async () => {
    expect(await coverage()).toMatchObject({ games_analyzed: 1, personal_puzzle_positions: false });

    const valid = { ...mistake, best_move_uci: 'e2e4', best_move_san: 'e4', best_pv: ['e4'] };
    db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=101').run(JSON.stringify([valid]));
    expect(await coverage()).toMatchObject({ games_analyzed: 1, personal_puzzle_positions: true });

    // Analysis metadata alone is insufficient: a malformed or obsolete FEN
    // must never create a personal-puzzle CTA or crash the Insights response.
    db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=101')
      .run(JSON.stringify([{ ...valid, fen_before: 'invalid-fen' }]));
    expect(await coverage()).toMatchObject({ games_analyzed: 1, personal_puzzle_positions: false });
    db.prepare('UPDATE analyses SET moves_json=? WHERE game_id=101').run(JSON.stringify([valid]));

    // A source edit makes the old recommendation obsolete, just like Game Review.
    db.prepare("UPDATE games SET pgn='1. Nf3 d5' WHERE id=101").run();
    expect(await coverage()).toMatchObject({ games_analyzed: 0, personal_puzzle_positions: false });

    db.prepare(`UPDATE analyses SET source_revision=(SELECT source_revision FROM games WHERE id=101),
      analysis_generation=analysis_generation+1 WHERE game_id=101`).run();
    expect(await coverage()).toMatchObject({ games_analyzed: 1, personal_puzzle_positions: true });

    // Unknown player color cannot identify a position as the user's mistake.
    db.prepare('UPDATE games SET user_color=NULL WHERE id=101').run();
    db.prepare(`UPDATE analyses SET source_revision=(SELECT source_revision FROM games WHERE id=101),
      analysis_generation=analysis_generation+1 WHERE game_id=101`).run();
    expect(await coverage()).toMatchObject({ games_analyzed: 1, personal_puzzle_positions: false });
  });
});
