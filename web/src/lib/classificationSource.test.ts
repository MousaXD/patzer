import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { qualityMatchesPosition, qualityMatchesVariationMove, type VariationMoveQuality } from './classification';

const chess = new Chess();
const fenBefore = chess.fen();
const played = chess.move('d4');
if (!played) throw new Error('Invalid variation identity test setup');
const move = {
  fenBefore, fenAfter: chess.fen(), uci: 'd2d4', san: 'd4', from: 'd2', to: 'd4',
};
const quality: VariationMoveQuality = {
  source: 'variation', scoring_version: 1,
  fen_before: move.fenBefore, fen_after: move.fenAfter,
  ply: 1, san: move.san, uci: move.uci, from: move.from, to: move.to,
  classification: 'best', centipawn_loss: 0, win_pct_drop: 0,
  eval_before_cp: 0, eval_after_cp: 22, mate_before: null, mate_after: null,
  best_move_uci: 'd2d4', best_move_san: 'd4', best_pv: [],
  is_best: true, legal_move_count: 20, depth_before: 12, depth_after: 12,
  candidate_count: 20, terminal: null,
};

describe('source-safe variation classifications', () => {
  it('accepts a complete, same-move engine result without altering the classification', () => {
    expect(qualityMatchesVariationMove(quality, move)).toBe(true);
    expect(qualityMatchesVariationMove({ ...quality, classification: 'brilliant' }, move)).toBe(true);
    expect(qualityMatchesVariationMove(null, move)).toBe(false);
    expect(qualityMatchesVariationMove(quality, null)).toBe(false);
  });

  it('rejects the right ending FEN when the engine identifies another move', () => {
    const wrongMove = { ...quality, fen_before: 'stale game', uci: 'e2e4', san: 'e4', from: 'e2', to: 'e4', classification: 'brilliant' as const };
    expect(qualityMatchesPosition(wrongMove, move.fenAfter)).toBe(true);
    expect(qualityMatchesVariationMove(wrongMove, move)).toBe(false);
    for (const changed of [
      { fen_before: 'other starting FEN' },
      { fen_after: 'other ending FEN' },
      { uci: 'e2e4' },
      { san: 'e4' },
      { from: 'e2' },
      { to: 'e4' },
      { source: 'mainline' as VariationMoveQuality['source'] },
      { classification: 'not-a-classification' as VariationMoveQuality['classification'] },
      { eval_before_cp: Number.NaN },
      { eval_after_cp: Infinity },
      { centipawn_loss: Number.NaN },
      { win_pct_drop: Infinity },
    ]) {
      expect(qualityMatchesVariationMove({ ...quality, ...changed }, move),JSON.stringify(changed)).toBe(false);
    }
  });
});
