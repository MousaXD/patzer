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
    (3,'expired-player','x','user'), (4,'other-player','x','user'),
    (5,'late-activity','x','user'), (6,'late-completion','x','user'),
    (7,'streak-player','x','user'), (8,'unobserved-streak','x','user'),
    (9,'opening-player','x','user'), (10,'seed-source','x','user'),
    (11,'accuracy-source','x','user'), (12,'review-source','x','user')`).run();
  db.prepare(`INSERT INTO profiles (user_id,display_name) VALUES
    (1,'Practice Player'), (2,'Completed Player'),
    (3,'Expired Player'), (4,'Other Player'),
    (5,'Late Activity'), (6,'Late Completion'), (7,'Streak Player'),
    (8,'Unobserved Streak'), (9,'Opening Player'),
    (10,'Seed Source'), (11,'Accuracy Source'), (12,'Review Source')`).run();
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

  it('does not credit activity that happened after the weekly deadline to an expired goal', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (5,'puzzles_solve','Old goal','Last week',1,'active',
        datetime('now','-9 days'), datetime('now','-2 days'))`).run();
    const puzzle = tactics.allPuzzles()[5]!;
    expect(tactics.recordAttempt(5, puzzle.id, true)?.rated).toBe(true);
    const outcome = (await goals(5)).goals;
    const old = outcome.find((g) => g.target === 1 && g.kind === 'puzzles_solve');
    expect(old).toMatchObject({ kind: 'puzzles_solve', status: 'expired', progress: 0 });
    expect(outcome.some((g) => g.status === 'active')).toBe(true);
  });

  it('recognizes an achieved deadline-bound goal even if Plan was not opened that week', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (6,'puzzles_solve','A week ago','Achieved offline',1,'active',
        datetime('now','-9 days'),datetime('now','-2 days'))`).run();
    const puzzle = tactics.allPuzzles()[6]!;
    expect(tactics.recordAttempt(6, puzzle.id, true)?.rated).toBe(true);
    // The record was genuinely created during the old window; only the page
    // was opened after the deadline. Backdate data in this disposable DB.
    db.prepare(`UPDATE tactics_attempts SET created_at=datetime('now','-5 days')
      WHERE user_id=6 AND puzzle_id=?`).run(puzzle.id);
    const outcome = (await goals(6)).goals;
    const achieved = outcome.find((g) => g.target === 1);
    expect(achieved).toMatchObject({ kind: 'puzzles_solve', status: 'completed', progress: 1 });
    expect(outcome.some((g) => g.status === 'active')).toBe(true);
    expect(db.prepare(`SELECT status,completed_at FROM goals WHERE user_id=6 AND target=1`).get())
      .toMatchObject({ status: 'completed' });
  });

  it('keeps an earned win-streak goal completed after later games break the ongoing streak', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (7,'win_streak','Win one game','Goal',1,'active',
        datetime('now','-1 day'),datetime('now','+6 days'))`).run();
    db.prepare(`INSERT INTO games
      (id,user_id,source,pgn,white,black,result,end_time,user_color)
      VALUES (701,7,'played','','Streak Player','Bot','win',datetime('now','-30 minutes'),'white')`).run();
    expect((await goals(7)).goals).toMatchObject([{ kind: 'win_streak',status: 'completed',progress: 1 }]);
    db.prepare(`INSERT INTO games
      (id,user_id,source,pgn,white,black,result,end_time,user_color)
      VALUES (702,7,'played','','Streak Player','Bot','loss',datetime('now','-10 minutes'),'white')`).run();
    expect((await goals(7)).goals).toMatchObject([{ kind: 'win_streak',status: 'completed',progress: 1 }]);
  });

  it('recognizes a best streak achieved this week even when Plan was not opened before the next loss', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (8,'win_streak','Win two games in a row','Goal',2,'active',
        datetime('now','-1 day'),datetime('now','+6 days'))`).run();
    const insert = db.prepare(`INSERT INTO games
      (id,user_id,source,pgn,white,black,result,end_time,user_color)
      VALUES (?,8,'played','','Unobserved Streak','Bot',?,datetime('now',?),'white')`);
    insert.run(801,'win','-3 hours');
    insert.run(802,'win','-2 hours');
    insert.run(803,'loss','-1 hour');
    expect((await goals(8)).goals).toMatchObject([{ kind: 'win_streak',status: 'completed',progress: 2 }]);
  });

  it('does not reward importing old games as fresh opening practice', async () => {
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,metadata,status,created_at,completes_at)
      VALUES (9,'opening_play','Play the Italian Game','Practice the opening',2,
        '{"eco":"C50","color":"white"}','active',datetime('now','-1 day'),datetime('now','+6 days'))`).run();
    // Both rows are imported *during* this goal. Only the game actually
    // played in the goal's window should count toward "Play N games".
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color,eco,end_time)
      VALUES (901,9,'chesscom','','Opening Player','Bot','win','white','C50',datetime('now','-50 days'))`).run();
    expect((await goals(9)).goals).toMatchObject([{ kind: 'opening_play',progress: 0,status: 'active' }]);
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color,eco,end_time)
      VALUES (902,9,'played','','Opening Player','Bot','win','white','C50',datetime('now','-30 minutes'))`).run();
    expect((await goals(9)).goals).toMatchObject([{ kind: 'opening_play',progress: 1,status: 'active' }]);
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color,eco,end_time)
      VALUES (903,9,'lichess','','Opening Player','Bot','win','white','C50',datetime('now','+9 days'))`).run();
    expect((await goals(9)).goals).toMatchObject([{ kind: 'opening_play',progress: 1,status: 'active' }]);
  });

  it('does not suggest an accuracy goal until at least one analysis is current and attributable', async () => {
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color)
      VALUES (1001,10,'played','1. e4 e5','Seed Source','Bot','win','white')`).run();
    db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,accuracy_white,scoring_version,created_at)
      VALUES (1001,14,'[]',92,?,datetime('now','-1 hour'))`).run(SCORING_VERSION);
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color)
      VALUES (1002,10,'played','1. d4 d5','Unknown Player','Bot','win',NULL)`).run();
    db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,accuracy_white,scoring_version,
      source_hash,source_revision,analysis_generation,created_at)
      VALUES (1002,14,'[]',95,?,'valid-but-unattributed',0,1,datetime('now','-1 hour'))`).run(SCORING_VERSION);

    const initial = (await goals(10)).goals;
    expect(initial.some((g) => g.kind === 'accuracy')).toBe(false);

    db.prepare(`UPDATE analyses SET source_hash='fresh-fixture',source_revision=0,analysis_generation=1
      WHERE game_id=1001`).run();
    const regenerate = await plan.request('/regenerate', { method: 'POST', headers: { Cookie: cookie(10) } });
    expect(regenerate.status).toBe(200);
    const result = await regenerate.json() as { goals: { kind: string; status: string; progress: number }[] };
    expect(result.goals.some((g) => g.kind === 'accuracy' && g.status === 'active' && g.progress === 0)).toBe(true);
  });

  it('does not award high-accuracy progress from an obsolete analysis after a PGN edit', async () => {
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,metadata,status,created_at,completes_at)
      VALUES (11,'accuracy','Earn a high accuracy','Current game analysis',1,
        '{"min_accuracy":75}','active',datetime('now','-1 day'),datetime('now','+6 days'))`).run();
    db.prepare(`INSERT INTO games(id,user_id,source,pgn,white,black,result,user_color)
      VALUES (1101,11,'played','1. e4 e5','Accuracy Source','Bot','win','white')`).run();
    db.prepare(`INSERT INTO analyses(game_id,depth,moves_json,accuracy_white,scoring_version,
      source_hash,source_revision,analysis_generation)
      VALUES (1101,14,'[]',91,?,'old-fixture',0,1)`).run(SCORING_VERSION);
    db.prepare(`UPDATE games SET pgn='1. d4 d5' WHERE id=1101`).run();

    expect((await goals(11)).goals).toMatchObject([{ kind: 'accuracy',status: 'active',progress: 0 }]);
    db.prepare(`UPDATE analyses SET source_hash='current-fixture',
      source_revision=(SELECT source_revision FROM games WHERE id=1101),
      analysis_generation=analysis_generation+1 WHERE game_id=1101`).run();
    expect((await goals(11)).goals).toMatchObject([{ kind: 'accuracy',status: 'completed',progress: 1 }]);
  });

  it('does not count legacy or source-obsolete analyses as completed review work', async () => {
    const { SCORING_VERSION } = await import('../src/chess/classifier.js');
    db.prepare(`INSERT INTO goals
      (user_id,kind,title,description,target,status,created_at,completes_at)
      VALUES (12,'review_games','Analyze two games','Current engine analysis',2,'active',
        datetime('now','-1 day'),datetime('now','+6 days'))`).run();
    const addGame = db.prepare(`INSERT INTO games
      (id,user_id,source,pgn,white,black,result,user_color)
      VALUES (?,12,'played',?,'Review Source','Bot','win','white')`);
    addGame.run(1201,'1. e4 e5');
    addGame.run(1202,'1. d4 d5');
    const addAnalysis = db.prepare(`INSERT INTO analyses
      (game_id,depth,moves_json,scoring_version,source_hash,source_revision,analysis_generation)
      VALUES (?,14,'[]',?,?,0,?)`);
    addAnalysis.run(1201,SCORING_VERSION,null,0);  // Legacy/unverified
    addAnalysis.run(1202,SCORING_VERSION,'valid-current-source',1);

    expect((await goals(12)).goals).toMatchObject([{
      kind: 'review_games', progress: 1, status: 'active',
    }]);
    db.prepare(`UPDATE games SET pgn = '1. Nf3 d5' WHERE id=1202`).run();
    expect((await goals(12)).goals).toMatchObject([{
      kind: 'review_games', progress: 0, status: 'active',
    }]);

    db.prepare(`UPDATE analyses SET source_hash='reanalyzed-current-source',
      source_revision=(SELECT source_revision FROM games WHERE id=1202),
      analysis_generation=analysis_generation+1 WHERE game_id=1202`).run();
    expect((await goals(12)).goals).toMatchObject([{
      kind: 'review_games', progress: 1, status: 'active',
    }]);

    db.prepare(`UPDATE analyses SET source_hash='proven-current-source',
      source_revision=(SELECT source_revision FROM games WHERE id=1201),
      analysis_generation=1 WHERE game_id=1201`).run();
    expect((await goals(12)).goals).toMatchObject([{
      kind: 'review_games', progress: 2, status: 'completed',
    }]);
  });
});
