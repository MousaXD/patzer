import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise Plan's real Hono handlers and chess activity against an isolated DB.
const scratch = mkdtempSync(join(tmpdir(), 'patzer-agent-d-plan-'));
process.env.DB_PATH = join(scratch, 'plan.db');

let db: typeof import('../src/db.js')['db'];
let plan: typeof import('../src/routes/plan.js')['default'];
let tactics: typeof import('../src/chess/tactics.js');
let cookie: (userId: number) => string;

async function goals(userId: number): Promise<{ goals: {
  id: number; kind: string; status: string; target: number; progress: number;
}[] }> {
  const response = await plan.request('/', { headers: { Cookie: cookie(userId) } });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ goals: {
    id: number; kind: string; status: string; target: number; progress: number;
  }[] }>;
}

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  plan = (await import('../src/routes/plan.js')).default;
  tactics = await import('../src/chess/tactics.js');
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  cookie = (userId) => `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(userId))}`;
  db.prepare(`INSERT INTO users (id,username,password_hash,role) VALUES
    (1,'practice-player','x','user'), (2,'completed-player','x','user'),
    (3,'expired-player','x','user'), (4,'other-player','x','user')`).run();
  db.prepare(`INSERT INTO profiles (user_id,display_name) VALUES
    (1,'Practice Player'), (2,'Completed Player'),
    (3,'Expired Player'), (4,'Other Player')`).run();
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(scratch, { recursive: true, force: true });
});

describe('weekly Plan uses real play and training progress', () => {
  it('credits one solved Lichess tactic plus one solved personal puzzle without double counting', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (1,'puzzles_solve','Solve 2 puzzles','Training goal',2,'active',
        datetime('now','-1 day'), datetime('now','+6 days'))`).run();
    const puzzle = tactics.allPuzzles().find((p) => p.rating >= 1150 && p.rating <= 1250)!;
    const solved = tactics.recordAttempt(1, puzzle.id, true)!;
    expect(solved.rated).toBe(true);
    const other = tactics.recordAttempt(4, tactics.allPuzzles()[1]!.id, true)!;
    expect(other.rated).toBe(true);

    let planGoals = (await goals(1)).goals;
    expect(planGoals).toHaveLength(1);
    expect(planGoals[0]).toMatchObject({ kind: 'puzzles_solve', target: 2, progress: 1, status: 'active' });

    db.prepare("INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color) VALUES (101,1,'played','','Practice Player','Bot','win','white')").run();
    db.prepare(`INSERT INTO puzzle_attempts
      (user_id,game_id,ply,fen,solution_uci,solved,last_day)
      VALUES (1,101,1,'8/8/8/8/8/8/8/8 w - - 0 1','e2e4',1,'2026-11-12')`).run();

    planGoals = (await goals(1)).goals;
    expect(planGoals).toHaveLength(1);
    expect(planGoals[0]).toMatchObject({ progress: 2, target: 2, status: 'completed' });
    expect(tactics.recordAttempt(1, puzzle.id, true)?.rated).toBe(false);
    expect((await goals(1)).goals).toHaveLength(1);
  });

  it('does not invent another set of goals after the current week is fully completed', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at,completed_at)
      VALUES (2,'review_games','Reviewed','Completed week',1,'completed',
        datetime('now','-1 day'),datetime('now','+6 days'),datetime('now'))`).run();
    const first = await goals(2);
    expect(first.goals).toHaveLength(1);
    expect(first.goals[0].status).toBe('completed');
    expect((await goals(2)).goals).toHaveLength(1);
  });

  it('expires an unfinished week and seeds the next, retaining the old goal as history', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (3,'puzzles_solve','Old goal','Last week',10,'active',
        datetime('now','-9 days'),datetime('now','-2 days'))`).run();
    const results = await goals(3);
    expect(results.goals.find((g) => g.kind === 'puzzles_solve' && g.status === 'expired')).toBeTruthy();
    expect(results.goals.filter((g) => g.status === 'active').length).toBeGreaterThanOrEqual(3);
    expect((await goals(3)).goals.length).toBe(results.goals.length);
  });
});
