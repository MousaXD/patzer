import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { decodeStoredReviewJson, needsFreshReviewAnalysis } from './storedReview';

const move = {
  ply: 1, san: 'e4', uci: 'e2e4',
  fen_before: 'before', fen_after: 'after',
  classification: 'best', best_pv: ['e4'],
  eval_before_cp: null, eval_after_cp: 12,
  mate_before: null, mate_after: null,
  best_move_uci: 'e2e4', best_move_san: 'e4',
  centipawn_loss: 0,
};

const moment = {
  ply: 1, side: 'white', san: 'e4', fen_before: 'before',
  classification: 'best', cp_loss: 0, win_pct_delta: 0,
  best_san: 'e4', best_pv: ['e4'],
};

const phase = {
  from_ply: 1, to_ply: 1,
  accuracy_white: 100, accuracy_black: 100,
  acpl_white: 0, acpl_black: 0,
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

  it('rejects cached fields that could crash components or invent scores', () => {
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, classification: 'unrecognized' }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, centipawn_loss: null }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, eval_after_cp: '12' }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, moves_json: JSON.stringify([{ ...move, best_pv: [null] }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, key_moments_json: JSON.stringify([{ ...moment, classification: 'unrecognized' }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, key_moments_json: JSON.stringify([{ ...moment, win_pct_delta: null }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, key_moments_json: JSON.stringify([{ ...moment, ply: 2 }]) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, phase_split_json: JSON.stringify({ opening: { ...phase, accuracy_white: null } }) })).toBeNull();
    expect(decodeStoredReviewJson({ ...valid, phase_split_json: JSON.stringify({ opening: { ...phase, from_ply: 3, to_ply: 1 } }) })).toBeNull();
  });

  it('accepts sound key moments and phase boundaries', () => {
    const data = {
      ...valid,
      key_moments_json: JSON.stringify([moment]),
      phase_split_json: JSON.stringify({ opening: phase, middlegame: null, endgame: null }),
    };
    expect(decodeStoredReviewJson(data)).toEqual({
      moves: [move],
      key_moments: [moment],
      phase_split: { opening: phase, middlegame: null, endgame: null },
    });
  });

  it('rejects a cached Key Moment that contradicts its scored move or duplicates a ply', () => {
    const withMoment = (item: typeof moment | typeof moment[]) => ({
      ...valid, key_moments_json: JSON.stringify(Array.isArray(item) ? item : [item]),
    });
    expect(decodeStoredReviewJson(withMoment(moment))?.key_moments).toEqual([moment]);
    for (const altered of [
      { ...moment, classification: 'brilliant' },
      { ...moment, san: 'd4' },
      { ...moment, fen_before: 'other-source-fen' },
      { ...moment, cp_loss: 900 },
      { ...moment, best_san: 'Nf3' },
      { ...moment, best_pv: ['Nf3'] },
    ]) {
      expect(decodeStoredReviewJson(withMoment(altered), undefined), JSON.stringify(altered)).toBeNull();
    }
    // Legacy black-to-move FEN summaries may contain an old ply-parity side;
    // the actual side is read from the saved FEN when displaying Key Moments.
    expect(decodeStoredReviewJson(withMoment({ ...moment, side: 'black' }))?.key_moments)
      .toEqual([{ ...moment, side: 'black' }]);
    expect(decodeStoredReviewJson(withMoment([moment, moment]))).toBeNull();
  });

  it('accepts only analyses whose moves match the saved PGN, including valid partial analysis', () => {
    const expected = [{ fen: 'before' },
      { uci: 'e2e4', san: 'e4', fen: 'after' },
      { uci: 'e7e5', san: 'e5', fen: 'later' }];
    expect(decodeStoredReviewJson(valid, expected)?.moves).toEqual([move]);
    const mismatch = [{ fen: 'before' }, { uci: 'd2d4', san: 'd4', fen: 'after' }];
    expect(decodeStoredReviewJson(valid, mismatch)).toBeNull();
    expect(decodeStoredReviewJson(valid, [{}])).toBeNull();
    expect(needsFreshReviewAnalysis(valid, decodeStoredReviewJson(valid, mismatch))).toBe(true);
  });

  it('rejects a false Brilliant for the same UCI move from a different legal board position', () => {
    const mainline = new Chess();
    const expectedBefore = mainline.fen();
    mainline.move('e4');
    const expectedAfter = mainline.fen();
    const positions = [
      { fen: expectedBefore },
      { fen: expectedAfter, uci: 'e2e4', san: 'e4' },
    ];
    const legal = { ...move, fen_before: expectedBefore, fen_after: expectedAfter };
    const analysisFor = (m: typeof legal) => ({ ...valid, moves_json: JSON.stringify([m]) });
    expect(decodeStoredReviewJson(analysisFor(legal), positions)?.moves).toEqual([legal]);

    // This unrelated position still has a legal e2e4, but Black already has
    // a pawn on d5. The move can receive a different evaluation and label.
    const unrelated = new Chess();
    unrelated.move('Nf3');
    unrelated.move('d5');
    const unrelatedBefore = unrelated.fen();
    unrelated.move('e4');
    const unrelatedAfter = unrelated.fen();
    const falseBrilliant = { ...legal, fen_before: unrelatedBefore, fen_after: unrelatedAfter,
      classification: 'brilliant', eval_after_cp: 700 };
    expect(decodeStoredReviewJson(analysisFor(falseBrilliant), positions)).toBeNull();
    expect(decodeStoredReviewJson(analysisFor({ ...legal, fen_before: unrelatedBefore }), positions)).toBeNull();
    expect(decodeStoredReviewJson(analysisFor({ ...legal, fen_after: unrelatedAfter }), positions)).toBeNull();
    expect(decodeStoredReviewJson(analysisFor({ ...legal, san: 'd4' }), positions)).toBeNull();
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
    const malformed = { ...valid, moves_json: JSON.stringify([{ ...move, classification: 'bad' }]) };
    expect(needsFreshReviewAnalysis(malformed, decodeStoredReviewJson(malformed))).toBe(true);
  });
});
