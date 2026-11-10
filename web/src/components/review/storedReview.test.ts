import { describe, expect, it } from 'vitest';
import { decodeStoredReviewJson, needsFreshReviewAnalysis } from './storedReview';

const move = {
  ply: 1, san: 'e4', uci: 'e2e4',
  fen_before: 'before', fen_after: 'after',
  classification: 'best', best_pv: ['e4'],
  eval_before_cp: null, eval_after_cp: 12,
};

describe('cached review analysis decoder', () => {
  const valid = {
    moves_json: JSON.stringify([move]),
    key_moments_json: '[]',
    phase_split_json: 'null',
  };

  it('accepts one valid mainline without overwriting unknown evaluations', () => {
    expect(decodeStoredReviewJson(valid)).toEqual({
      moves: [move], key_moments: [], phase_split: null,
    });
  });

  it('rejects malformed or structurally inconsistent JSON rather than crashing', () => {
    expect(decodeStoredReviewJson({ ...valid, moves_json: '{' })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: '{}' })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, ply: 2 }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, best_pv: null }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, key_moments_json: '[' })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, phase_split_json: '[]' })).toBeNull();
  });

  it('handles cached records without optional moment/phase data', () => {
    const result = decodeStoredReviewJson({
      moves_json: JSON.stringify([move]),
      key_moments_json: null, phase_split_json: null,
    });
    expect(result?.key_moments).toEqual([]);
    expect(result?.phase_split).toBeNull();
  });
  it('forces a new Stockfish analysis only for a damaged cached record', () => {
    expect(needsFreshReviewAnalysis(null, null)).toBe(false);
    const decoded = decodeStoredReviewJson(valid);
    expect(decoded).not.toBeNull();
    expect(needsFreshReviewAnalysis(valid, decoded)).toBe(false);
    const corrupted = { ...valid, moves_json: 'broken json' };
    expect(needsFreshReviewAnalysis(corrupted, decodeStoredReviewJson(corrupted))).toBe(true);
  });

});
