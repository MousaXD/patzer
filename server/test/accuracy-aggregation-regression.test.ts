import { describe, expect, it } from 'vitest';
import { gameAccuracy, type MoveAccPoint } from '../src/chess/accuracy.js';
import { recalculateAnalysisFromMoves } from '../src/chess/accuracyBackfill.js';
import { cpToWinPct, moveAccuracy } from '../src/chess/classifier.js';
import type { AnalyzedMove } from '../src/types.js';

const point = (acc: number, before = 50, after = 50, isBook = false): MoveAccPoint => ({
  acc, winPctBefore: before, winPct: after, isBook,
});

function evaluatedMove(ply: number, from: number, to: number, classification: AnalyzedMove['classification']): AnalyzedMove {
  return {
    ply, san: 'e4', uci: 'e2e4',
    fen_before: `8/8/8/8/8/8/8/8 ${ply % 2 ? 'w' : 'b'} - - 0 1`,
    fen_after: '8/8/8/8/8/8/8/8 w - - 0 1',
    eval_before_cp: from, eval_after_cp: to,
    mate_before: null, mate_after: null,
    best_move_uci: null, best_move_san: null, best_pv: [],
    centipawn_loss: Math.abs(to - from), classification,
  };
}

describe('Patzer accuracy (not proprietary Chess.com CAPS2)', () => {
  it('does not erase one 58%-accurate mistake among seven near-perfect moves', () => {
    const moves = [point(94.8, 55, 53), point(99.2), point(58, 68, 56), point(98),
      point(100), point(100), point(96.3), point(99.2)];
    // The old third-worst-floor code produced a misleading score around 98.
    expect(gameAccuracy(moves)).toBeLessThan(94);
    expect(gameAccuracy(moves)).toBeGreaterThan(80);
  });

  it('must decrease when an additional bad move replaces a good move', () => {
    const good = Array.from({ length: 10 }, () => point(97, 60, 60));
    const one = [...good]; one[4] = point(40, 60, 40);
    const two = [...one]; two[5] = point(30, 60, 30);
    const three = [...two]; three[6] = point(20, 60, 20);
    const four = [...three]; four[7] = point(10, 60, 10);
    expect(gameAccuracy(good)).toBeGreaterThan(gameAccuracy(one));
    expect(gameAccuracy(one)).toBeGreaterThan(gameAccuracy(two));
    expect(gameAccuracy(two)).toBeGreaterThan(gameAccuracy(three));
    expect(gameAccuracy(three)).toBeGreaterThan(gameAccuracy(four));
  });

  it('excludes book moves, returns 0 without eligible moves, and respects 0–100 bounds', () => {
    const good = [point(85, 60, 57), point(76, 57, 50)];
    expect(gameAccuracy([...good, point(0, 100, 0, true)])).toBeCloseTo(gameAccuracy(good), 8);
    expect(gameAccuracy([point(0, 100, 0, true)])).toBe(0);
    expect(gameAccuracy([point(100), point(100)])).toBe(100);
    expect(gameAccuracy([point(0, 60, 0), point(0, 60, 0)])).toBeGreaterThanOrEqual(0);
  });

  it('recomputes a historical cached analysis and phase scores without Stockfish', () => {
    const moves = [
      evaluatedMove(1, 20, 23, 'book'),
      evaluatedMove(2, 23, 24, 'book'),
      evaluatedMove(3, 32, 30, 'best'),
      evaluatedMove(4, 30, 140, 'mistake'),
      evaluatedMove(5, 140, 75, 'mistake'),
      evaluatedMove(6, 75, 240, 'blunder'),
      evaluatedMove(7, 240, 235, 'best'),
      evaluatedMove(8, 235, 255, 'good'),
    ];
    const original = JSON.stringify(moves);
    const phase = { opening: { from_ply: 1, to_ply: 8, accuracy_white: 100,
      accuracy_black: 100, acpl_white: 0, acpl_black: 0 }, middlegame: null, endgame: null };
    const r = recalculateAnalysisFromMoves(moves, { userColor: 'black', result: 'loss', opponentRating: null }, phase);
    expect(r.accuracyWhite).toBeLessThan(100);
    expect(r.accuracyBlack).toBeLessThan(100);
    expect(r.phaseSplit?.opening?.accuracy_white).toBe(r.accuracyWhite);
    expect(r.phaseSplit?.opening?.accuracy_black).toBe(r.accuracyBlack);
    expect(r.estimatedEloBlack).toBeTypeOf('number');
    expect(r.performanceBlack).toBeTypeOf('number');
    expect(JSON.stringify(moves)).toBe(original);
    expect(phase.opening.accuracy_white).toBe(100); // caller's objects untouched
    expect(moveAccuracy(cpToWinPct(30), cpToWinPct(140))).toBeGreaterThan(0);
  });

  it('rejects invalid/null cached evaluations before they can be persisted', () => {
    const moves = [evaluatedMove(1, 20, 0, 'good')];
    moves[0]!.eval_before_cp = null;
    expect(() => recalculateAnalysisFromMoves(moves, { userColor: 'white', result: 'win', opponentRating: null }, null))
      .toThrow('invalid_eval_in_cached_analysis');
  });

  it('never fabricates Elo or performance from an all-book/forced v9 analysis', () => {
    const moves = [
      evaluatedMove(1, 0, 0, 'book'),
      evaluatedMove(2, 0, 0, 'book'),
      evaluatedMove(3, 0, 0, 'forced'),
      evaluatedMove(4, 0, 0, 'forced'),
    ];
    const phase = { opening: { from_ply: 1, to_ply: 4, accuracy_white: 100,
      accuracy_black: 100, acpl_white: 333, acpl_black: 333 }, middlegame: null, endgame: null };
    const result = recalculateAnalysisFromMoves(moves,
      { userColor: 'white', result: 'win', opponentRating: 1750 }, phase);
    expect(result.estimatedEloWhite).toBeNull();
    expect(result.estimatedEloBlack).toBeNull();
    expect(result.performanceWhite).toBeNull();
    expect(result.performanceBlack).toBeNull();
    expect(result.phaseSplit?.opening?.acpl_white).toBe(0);
    expect(result.phaseSplit?.opening?.acpl_black).toBe(0);
  });

  it('keeps unavailable scores null for a Black-first forced-only history', () => {
    const reply = evaluatedMove(1, 0, 0, 'forced');
    reply.fen_before = '4k3/8/8/8/8/8/8/4K3 b - - 0 1';
    const r = recalculateAnalysisFromMoves([reply],
      { userColor: 'black', result: 'loss', opponentRating: 2000 }, null);
    expect(r.estimatedEloBlack).toBeNull();
    expect(r.performanceBlack).toBeNull();
    expect(r.estimatedEloWhite).toBeNull();
  });

  it('keeps one side null when only the other side has scored decisions', () => {
    const r = recalculateAnalysisFromMoves([
      evaluatedMove(1, 0, 0, 'book'),
      evaluatedMove(2, 0, -30, 'good'),
    ], { userColor: 'white', result: 'draw', opponentRating: 1550 }, null);
    expect(r.estimatedEloWhite).toBeNull();
    expect(r.performanceWhite).toBeNull();
    expect(r.estimatedEloBlack).toBeTypeOf('number');
    expect(r.performanceBlack).toBeTypeOf('number');
  });
});
