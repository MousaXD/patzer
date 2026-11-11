import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { VariationMoveQuality } from '../../lib/classification';
import { createPracticeAttempt, describePracticePosition, legalPracticeSquareMoves, verifiedPracticeQuality } from './mistakePractice';

const start = new Chess().fen();
const attempt = createPracticeAttempt(start, 'e2e4')!;
const quality = {
  source: 'variation', fen_before: start, fen_after: attempt.fenAfter, uci: 'e2e4',
  san: 'e4', from: 'e2', to: 'e4', best_move_uci: 'e2e4',
  centipawn_loss: 0, win_pct_drop: 0, eval_before_cp: 10, eval_after_cp: 20,
  depth_before: 12, scoring_version: 9, classification: 'good',
  best_move_san: 'e4', best_pv: ['e4'], is_best: true,
} as VariationMoveQuality;

describe('blind practice attempt boundary', () => {
  it('describes all visible pieces and turn from FEN, without revealing future moves', () => {
    const initial = describePracticePosition(start);
    expect(initial?.toMove).toBe('White');
    expect(initial?.inCheck).toBe(false);
    expect(initial?.white).toHaveLength(16);
    expect(initial?.black).toHaveLength(16);
    expect(initial?.white).toContainEqual({ type: 'k', square: 'e1' });
    expect(initial?.black).toContainEqual({ type: 'q', square: 'd8' });
    const game = new Chess();
    for (const san of ['f3', 'e5', 'g4']) game.move(san);
    const beforeMate = describePracticePosition(game.fen());
    expect(beforeMate?.toMove).toBe('Black');
    expect(beforeMate?.white).toContainEqual({ type: 'p', square: 'g4' });
    expect(beforeMate?.black).toContainEqual({ type: 'q', square: 'd8' });
    expect(JSON.stringify(beforeMate)).not.toMatch(/Qh4#|best_move|win_pct/);
    expect(describePracticePosition('invalid')).toBeNull();
  });
  it('does not expose SAN mate/check annotations before a blind attempt', () => {
    const game = new Chess();
    for (const san of ['f3', 'e5', 'g4']) game.move(san);
    const moves = legalPracticeSquareMoves(game.fen());
    expect(moves).toContainEqual({ from: 'd8', to: 'h4', piece: 'q' });
    expect(JSON.stringify(moves)).not.toContain('Qh4#');
    expect(JSON.stringify(moves)).not.toMatch(/[+#]/);
    expect(createPracticeAttempt(game.fen(), 'd8h4')?.san).toBe('Qh4#');
  });
  it('supports four explicit promotion choices, including underpromotions', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(legalPracticeSquareMoves(fen).filter((move) => move.from === 'a7' && move.to === 'a8')
      .map((move) => move.promotion).sort()).toEqual(['b', 'n', 'q', 'r']);
    expect(createPracticeAttempt(fen, 'a7a8n')?.san).toContain('a8=N');
  });
  it('accepts only legal moves from the exact puzzle FEN, without changing it', () => {
    expect(createPracticeAttempt(start, 'e2e5')).toBeNull();
    expect(createPracticeAttempt(start, 'e7e5')).toBeNull();
    expect(attempt.san).toBe('e4');
    expect(createPracticeAttempt(start, 'e4')).toEqual(attempt);
    expect(createPracticeAttempt(start, 'Nf3')?.uci).toBe('g1f3');
    expect(attempt.fenBefore).toBe(start);
    expect(start).toBe(new Chess().fen());
    expect(createPracticeAttempt('8/8/8/8/8/8/8/K6k b - - 0 12', 'h1h2')?.san).toBe('Kh2');
  });
  it('rejects stale FEN, stale move, and malformed evaluation rather than calling them scored', () => {
    expect(verifiedPracticeQuality(quality, attempt)).toEqual(quality);
    expect(verifiedPracticeQuality({ ...quality, fen_before: attempt.fenAfter }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, fen_after: start }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, uci: 'd2d4' }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, win_pct_drop: NaN }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, san: 'd4' }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, best_move_uci: 'e7e5' }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, best_move_san: 'Qh5' }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, best_pv: ['e4', 'Qh5'] }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, best_move_uci: 'd2d4', best_move_san: 'd4' }, attempt)).toBeNull();
    expect(verifiedPracticeQuality({ ...quality, depth_before: 2.5 }, attempt)).toBeNull();
    expect(verifiedPracticeQuality(null, attempt)).toBeNull();
  });
});
