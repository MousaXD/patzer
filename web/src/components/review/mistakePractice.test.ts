import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { VariationMoveQuality } from '../../lib/classification';
import { createPracticeAttempt, verifiedPracticeQuality } from './mistakePractice';

const start = new Chess().fen();
const attempt = createPracticeAttempt(start, 'e2e4')!;
const quality = {
  source: 'variation', fen_before: start, fen_after: attempt.fenAfter, uci: 'e2e4',
  centipawn_loss: 0, win_pct_drop: 0, eval_before_cp: 10, eval_after_cp: 20,
  depth_before: 12, scoring_version: 9, classification: 'good',
  best_move_san: 'e4', best_pv: ['e4'], is_best: true,
} as VariationMoveQuality;

describe('blind practice attempt boundary', () => {
  it('accepts only legal moves from the exact puzzle FEN, without changing it', () => {
    expect(createPracticeAttempt(start, 'e2e5')).toBeNull();
    expect(createPracticeAttempt(start, 'e7e5')).toBeNull();
    expect(attempt.san).toBe('e4');
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
    expect(verifiedPracticeQuality(null, attempt)).toBeNull();
  });
});
