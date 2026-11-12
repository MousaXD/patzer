// Tactic Trainer — extracts personalized puzzles from the user's own analyzed
// games. A puzzle is the FEN before a user blunder/miss where the engine had a
// strong best move; the user retries it and we record solved/failed. When the
// engine's line goes on with forcing moves, so does the puzzle, and one you
// don't solve at the first try comes back the next day (chess/gamePuzzles.ts).
//
// This is the killer differentiator over chess.com (whose Tactic Trainer is a
// generic puzzle dump): your puzzles are *your mistakes*. Every solve is
// retraining a real pattern you got wrong.

import { Hono } from 'hono';
import { z } from 'zod';
import { Chess } from 'chess.js';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { SCORING_VERSION, cpToWinPct, normalizeEval } from '../chess/classifier.js';
import { createAnalysisEngine } from '../chess/engine.js';
import { dayOf } from '../chess/openingTrainer.js';
import { afterTry, isDue, isPuzzleMove, positionAfter, puzzleLine, type QueueState } from '../chess/gamePuzzles.js';
import { readAnalysisMoves } from './analysisData.js';
import type { AnalyzedMove } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface PuzzleCandidate {
  game_id: number;
  user_color: 'white' | 'black';
  source_revision: number;
  analysis_generation: number;
  end_time: string | null;
  white: string;
  black: string;
  moves_json: string;
}

type AttemptRow = QueueState & { game_id: number; ply: number; fen: string; solution_uci: string };

// A game can be re-imported and reanalyzed at the same ply with a different
// board or best move. Such a position is a *new* puzzle, not an old review.
// The unique (user,game,ply) key in puzzle_attempts remains unchanged, so
// compare the stored position and answer before reusing its learning state.
function samePuzzle(attempt: AttemptRow, move: AnalyzedMove): boolean {
  return attempt.fen === move.fen_before
    && attempt.solution_uci.toLowerCase() === move.best_move_uci?.toLowerCase();
}

// The browser's calendar day (?today= or { today }), like the opening trainer.
const todayOf = (v: unknown) => dayOf(typeof v === 'string' ? v : null);

// Training must use the same current-source provenance gates as detailed
// analysis and Insights. A game edit invalidates its previous analysis, so
// neither a new puzzle nor an old queued attempt may use those obsolete moves.
const CURRENT_ANALYSIS_SQL = `a.scoring_version >= ? AND a.source_hash IS NOT NULL
  AND a.source_revision = g.source_revision AND a.analysis_generation > 0`;

const GAME_SQL = `
  SELECT g.id AS game_id, g.user_color, g.end_time, g.white, g.black,
         a.source_revision, a.analysis_generation, a.moves_json
  FROM analyses a JOIN games g ON g.id = a.game_id
  WHERE g.user_id = ? AND g.user_color IN ('white', 'black') AND (${CURRENT_ANALYSIS_SQL})`;

function safePuzzleLine(m: AnalyzedMove): ReturnType<typeof puzzleLine> | null {
  if (typeof m.fen_before !== 'string' || typeof m.best_move_uci !== 'string') return null;
  try {
    const line = puzzleLine(m.fen_before, m.best_move_uci,
      Array.isArray(m.best_pv) ? m.best_pv : []);
    return line.uci.length > 0 ? line : null;
  } catch {
    // A malformed cached FEN must not prevent the user's other valid
    // personal exercises from loading or make a saved attempt editable.
    return null;
  }
}

function toPuzzle(r: PuzzleCandidate, m: AnalyzedMove, review: boolean) {
  const line = safePuzzleLine(m);
  if (!line) return null;
  return {
    game_id: r.game_id,
    ply: m.ply,
    source_revision: r.source_revision,
    analysis_generation: r.analysis_generation,
    fen: m.fen_before,
    side_to_move: m.ply % 2 === 1 ? 'white' : 'black',
    played_san: m.san,
    played_uci: m.uci,
    best_san: m.best_move_san,
    best_uci: m.best_move_uci,
    best_pv: m.best_pv,
    // The whole solution: yours, theirs, yours … (UCI and SAN).
    line: line.uci,
    line_san: line.san,
    classification: m.classification,
    centipawn_loss: m.centipawn_loss,
    eval_before_cp: m.eval_before_cp,
    // For the coach's "why the engine's move beats yours" (as in Game Review).
    eval_after_cp: m.eval_after_cp,
    end_time: r.end_time,
    white: r.white,
    black: r.black,
    // A puzzle you got wrong before, back for review.
    review,
  };
}

/** The user's puzzle move at `ply` of `gameId`, if it still is one. */
function loadPuzzleMove(userId: number, gameId: number, ply: number): { game: PuzzleCandidate; move: AnalyzedMove } | null {
  const game = db.prepare(`${GAME_SQL} AND g.id = ?`).get(userId, SCORING_VERSION, gameId) as PuzzleCandidate | undefined;
  if (!game) return null;
  const move = readAnalysisMoves(game.moves_json).find((m) => m.ply === ply);
  if (!move || !isPuzzleMove(move, game.user_color) || !safePuzzleLine(move)) return null;
  return { game, move };
}

// A historical attempt remains in the database even if its source game
// changes. It counts as *current* practice only while its original board and
// answer still match an eligible move in the latest authoritative analysis.
// Both the due counter and practice progress use this exact eligibility gate.
const CURRENT_ATTEMPT_SQL = `g.user_color IN ('white', 'black') AND (${CURRENT_ANALYSIS_SQL})
  AND EXISTS (
    SELECT 1 FROM json_each(
      CASE WHEN json_valid(a.moves_json)
        THEN CASE WHEN json_type(a.moves_json) = 'array' THEN a.moves_json ELSE '[]' END
        ELSE '[]' END
    ) AS m
    WHERE m.type = 'object'
      AND json_extract(m.value, '$.ply') = p.ply
      AND json_extract(m.value, '$.fen_before') = p.fen
      AND lower(json_extract(m.value, '$.best_move_uci')) = lower(p.solution_uci)
      AND json_extract(m.value, '$.classification') IN ('blunder', 'miss', 'mistake')
      AND json_extract(m.value, '$.best_move_san') IS NOT NULL
      AND json_extract(m.value, '$.best_move_uci') <> json_extract(m.value, '$.uci')
      AND CASE WHEN p.ply % 2 = 1 THEN 'white' ELSE 'black' END = g.user_color
  )`;

function dueCount(userId: number, today: string): number {
  const r = db.prepare(`
    SELECT COUNT(*) AS n FROM puzzle_attempts p
    JOIN games g ON g.id = p.game_id AND g.user_id = p.user_id
    JOIN analyses a ON a.game_id = g.id
    WHERE p.user_id = ? AND p.solved = 0
      AND (p.due_on IS NULL OR p.due_on <= ?)
      AND (p.last_day IS NULL OR p.last_day < ?)
      AND (${CURRENT_ATTEMPT_SQL})
  `).get(userId, today, today, SCORING_VERSION) as { n: number };
  return r.n;
}

function awaitingAnalysisCount(userId: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM games g
    LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.user_id = ? AND g.user_color IN ('white', 'black')
      AND g.result IS NOT NULL AND g.result <> '*'
      AND NOT COALESCE(a.scoring_version >= ? AND a.source_hash IS NOT NULL
        AND a.source_revision = g.source_revision AND a.analysis_generation > 0, 0)
  `).get(userId, SCORING_VERSION) as { n: number };
  return row.n;
}

// GET /api/train/next — the next puzzle: one due for review first, else the
// newest one from your games you haven't tried yet.
//   ?exclude_solved=1     skip puzzles already done or not due yet (default 1)
//   ?game_id=N            only puzzles from this game
//   ?today=YYYY-MM-DD     the browser's calendar day
//   ?skip=game:ply,...     client-only unsaved skips for this single request
router.get('/next', (c) => {
  const me = c.get('user');
  const today = todayOf(c.req.query('today'));
  const excludeSolved = c.req.query('exclude_solved') !== '0';
  const gameIdQ = c.req.query('game_id');
  const filterGameId = gameIdQ ? Number(gameIdQ) : null;
  const skipText = c.req.query('skip') ?? '';
  if (skipText.length > 4096) return c.json({ error: 'invalid_input' }, 400);
  const skipped = new Set<string>();
  if (skipText) {
    for (const key of skipText.split(',')) {
      const match = /^([1-9]\d*):([1-9]\d*)$/.exec(key);
      if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))
        || skipped.size >= 200) return c.json({ error: 'invalid_input' }, 400);
      skipped.add(key);
    }
  }
  const due = dueCount(me.id, today);

  const tried = new Map<string, AttemptRow>();
  for (const r of db.prepare(`SELECT game_id, ply, fen, solution_uci, solved, due_on, last_day FROM puzzle_attempts WHERE user_id = ?`).all(me.id) as AttemptRow[]) {
    tried.set(`${r.game_id}:${r.ply}`, r);
  }

  // Reviews first, oldest first — they may come from games older than the 60
  // scanned below.
  if (excludeSolved && filterGameId == null) {
    const dueRows = [...tried.values()]
      .filter((r) => isDue(r, today) && !skipped.has(`${r.game_id}:${r.ply}`))
      .sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? ''));
    for (const r of dueRows) {
      const found = loadPuzzleMove(me.id, r.game_id, r.ply);
      const puzzle = found && samePuzzle(r, found.move) && toPuzzle(found.game, found.move, true);
      if (puzzle) return c.json({ puzzle, due });
    }
  }

  // Search the full analyzed-game library, not just its first 60 games.
  // A lifelong learner can have hundreds of analyzed games: once the newest
  // batch is exhausted, older, untried mistakes must still be discoverable.
  // Keep each SQLite result page small rather than materializing all moves.
  const PAGE_SIZE = 60;
  const where = filterGameId != null ? 'AND g.id = ?' : '';
  const params: unknown[] = [me.id, SCORING_VERSION];
  if (filterGameId != null) params.push(filterGameId);
  const page = db.prepare(`${GAME_SQL} ${where} ORDER BY g.end_time DESC, g.id DESC LIMIT ? OFFSET ?`);

  // Newest first, but advance until a usable mistake is found or the user's
  // entire analyzed library has been scanned. LIMIT bounds memory per read.
  let offset = 0;
  while (true) {
    const rows = page.all(...params, PAGE_SIZE, offset) as PuzzleCandidate[];
    for (const r of rows) {
      const moves = readAnalysisMoves(r.moves_json);
      for (const m of moves) {
        if (skipped.has(`${r.game_id}:${m.ply}`)) continue;
        if (!isPuzzleMove(m, r.user_color)) continue;
        const previous = tried.get(`${r.game_id}:${m.ply}`);
        const before = previous && samePuzzle(previous, m) ? previous : null;
        if (excludeSolved && before && !isDue(before, today)) continue;
        const puzzle = toPuzzle(r, m, !!before && before.solved === 0);
        if (puzzle) return c.json({ puzzle, due });
      }
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return c.json({ puzzle: null, due, awaiting_analysis: awaitingAnalysisCount(me.id) });
});

const uciSchema = z.string().regex(/^[a-h][1-8][a-h][1-8][nbrq]?$/i);

// The client must attest to the analysis it actually displayed. Game/ply
// alone is not sufficient: an open tab can outlive a source edit and a fresh
// analysis, and submitting its old result could mark a new puzzle learned.
const snapshotSchema = {
  source_revision: z.number().int().nonnegative(),
  analysis_generation: z.number().int().positive(),
};
function matchesSnapshot(game: PuzzleCandidate, snapshot: { source_revision: number; analysis_generation: number }) {
  return game.source_revision === snapshot.source_revision
    && game.analysis_generation === snapshot.analysis_generation;
}

// POST /api/train/attempt — the first try at a puzzle: solved or not. The
// page checks the moves itself (it has the line); a second go the same day is
// practice and isn't sent.
const attemptSchema = z.object({
  game_id: z.number().int().positive(),
  ply: z.number().int().positive(),
  ...snapshotSchema,
  solved: z.boolean(),
  attempted_uci: uciSchema.optional(),
  today: z.string().max(10).optional(),
});

router.post('/attempt', async (c) => {
  const me = c.get('user');
  const parsed = attemptSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, ply, solved, attempted_uci } = parsed.data;
  const today = todayOf(parsed.data.today);

  const found = loadPuzzleMove(me.id, game_id, ply);
  if (!found) return c.json({ error: 'not_found' }, 404);
  const { game, move } = found;
  if (!matchesSnapshot(game, parsed.data)) return c.json({ error: 'stale_puzzle' }, 409);

  const before = db.prepare(`
    SELECT game_id, ply, fen, solution_uci, solved, due_on, last_day FROM puzzle_attempts WHERE user_id = ? AND game_id = ? AND ply = ?
  `).get(me.id, game_id, ply) as AttemptRow | undefined;
  const previous = before && samePuzzle(before, move) ? before : null;
  const next = afterTry(previous, solved, today);

  if (!before) {
    db.prepare(`
      INSERT INTO puzzle_attempts (user_id, game_id, ply, fen, solution_uci, attempted_uci, solved, due_on, last_day)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(me.id, game_id, ply, move.fen_before, move.best_move_uci!.toLowerCase(), attempted_uci?.toLowerCase() ?? null, next.solved, next.due_on, next.last_day);
  } else if (!previous) {
    // The old attempt was from another position at this ply. Replace its
    // identity and retry history atomically instead of inheriting a prior
    // failed/successful result or violating the unique game/ply constraint.
    db.prepare(`
      UPDATE puzzle_attempts
      SET fen = ?, solution_uci = ?, attempted_uci = ?, solved = ?, due_on = ?,
          last_day = ?, created_at = datetime('now')
      WHERE user_id = ? AND game_id = ? AND ply = ?
    `).run(move.fen_before, move.best_move_uci!.toLowerCase(), attempted_uci?.toLowerCase() ?? null,
      next.solved, next.due_on, next.last_day, me.id, game_id, ply);
  } else if (next.counts) {
    db.prepare(`
      UPDATE puzzle_attempts SET solved = ?, due_on = ?, last_day = ?, attempted_uci = ?, created_at = datetime('now')
      WHERE user_id = ? AND game_id = ? AND ply = ?
    `).run(next.solved, next.due_on, next.last_day, attempted_uci?.toLowerCase() ?? null, me.id, game_id, ply);
  }

  return c.json({ counted: next.counts, done: next.solved === 1, due_on: next.due_on });
});

// POST /api/train/check — is a move that isn't the line's just as good? The
// engine compares the position after it with the position after the line's
// move; within ALT_MAX_DROP win-chance points (Patzer calls that "excellent")
// it counts as solved, so nobody is told a good move is wrong. Your own move
// from the game never counts.
const ALT_MAX_DROP = 2;
const CHECK_DEPTH = 14;
const checkInflight = new Set<number>();

const checkSchema = z.object({
  game_id: z.number().int().positive(),
  ply: z.number().int().positive(),
  ...snapshotSchema,
  step: z.number().int().min(0).max(8),
  uci: uciSchema,
});

router.post('/check', async (c) => {
  const me = c.get('user');
  const parsed = checkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);
  const { game_id, ply, step } = parsed.data;
  const uci = parsed.data.uci.toLowerCase();

  const found = loadPuzzleMove(me.id, game_id, ply);
  if (!found) return c.json({ error: 'not_found' }, 404);
  const { game, move } = found;
  if (!matchesSnapshot(game, parsed.data)) return c.json({ error: 'stale_puzzle' }, 409);
  const line = puzzleLine(move.fen_before, move.best_move_uci!, move.best_pv ?? []).uci;
  if (step % 2 !== 0 || step >= line.length) return c.json({ error: 'invalid_input' }, 400);

  const fen = positionAfter(move.fen_before, line, step);
  if (!fen) return c.json({ error: 'not_found' }, 404);
  const expected = line[step]!;
  if (uci === expected || (expected.length === 5 && uci === expected.slice(0, 4) && expected.endsWith('q'))) return c.json({ ok: true });
  if (step === 0 && uci === move.uci.toLowerCase()) return c.json({ ok: false });

  const after = (u: string): Chess | null => {
    const chess = new Chess(fen);
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.slice(4, 5) || undefined });
      return chess;
    } catch {
      return null;
    }
  };
  const alt = after(uci);
  const want = after(expected);
  if (!alt || !want) return c.json({ ok: false });
  if (alt.isCheckmate()) return c.json({ ok: true });
  if (want.isCheckmate() || alt.isGameOver()) return c.json({ ok: false });

  if (checkInflight.has(me.id)) return c.json({ error: 'already_analyzing' }, 429);
  checkInflight.add(me.id);
  const engine = createAnalysisEngine();
  try {
    await engine.start();
    await engine.setOption('Threads', '2');
    await engine.setOption('Hash', '64');
    const mover = new Chess(fen).turn();
    // Win chance for the side that moved, from the engine's view of the
    // position after the move (where the other side is to move).
    const winFor = async (chess: Chess) => {
      const e = await engine.evaluateMulti(chess.fen(), CHECK_DEPTH, 1);
      const white = normalizeEval(e.cp, e.mate, chess.turn());
      return cpToWinPct(mover === 'w' ? white : -white);
    };
    const wantWin = await winFor(want);
    const altWin = await winFor(alt);
    // An engine check can take seconds. Do not validate an alternative for a
    // puzzle that became obsolete while Stockfish was evaluating it.
    const current = loadPuzzleMove(me.id, game_id, ply);
    if (!current || !matchesSnapshot(current.game, parsed.data)) return c.json({ error: 'stale_puzzle' }, 409);
    return c.json({ ok: wantWin - altWin < ALT_MAX_DROP });
  } catch {
    // No engine: the line's move is the only one we can vouch for.
    return c.json({ ok: false, engine: false });
  } finally {
    checkInflight.delete(me.id);
    await engine.quit().catch(() => {});
  }
});

router.get('/stats', (c) => {
  const me = c.get('user');
  const today = todayOf(c.req.query('today'));
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN solved = 1 THEN 1 ELSE 0 END) AS solved,
      SUM(CASE WHEN solved = 0 THEN 1 ELSE 0 END) AS failed
    FROM puzzle_attempts WHERE user_id = ?
  `).get(me.id) as { total: number; solved: number; failed: number };
  const current = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN p.solved = 1 THEN 1 ELSE 0 END) AS solved
    FROM puzzle_attempts p
    JOIN games g ON g.id = p.game_id AND g.user_id = p.user_id
    JOIN analyses a ON a.game_id = g.id
    WHERE p.user_id = ? AND (${CURRENT_ATTEMPT_SQL})
  `).get(me.id, SCORING_VERSION) as { total: number; solved: number | null };
  // Recent attempt stream
  const recent = db.prepare(`
    SELECT game_id, ply, solved, attempted_uci, solution_uci, created_at
    FROM puzzle_attempts
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(me.id);
  return c.json({
    total: stats.total ?? 0,
    solved: stats.solved ?? 0,
    failed: stats.failed ?? 0,
    accuracy: stats.total > 0 ? Math.round(((stats.solved ?? 0) / stats.total) * 100) : 0,
    // Keep historical attempts intact; these fields describe practice whose
    // position still exists in the current game's analysis.
    current_total: current.total,
    current_solved: current.solved ?? 0,
    current_accuracy: current.total > 0 ? Math.round(((current.solved ?? 0) / current.total) * 100) : null,
    outdated_attempts: (stats.total ?? 0) - current.total,
    due: dueCount(me.id, today),
    recent,
  });
});

export default router;
