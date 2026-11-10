import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { AnalyzedMove } from '../../types';
import { parseReviewGamePositions } from './reviewGamePositions';
import { buildSavedReviewTimeline } from './reviewTimeline';

function replay(sans: string[], fen?: string) {
  const chess = new Chess(fen);
  for (const san of sans) chess.move(san);
  const positions = parseReviewGamePositions(chess.pgn());
  if (!positions) throw new Error('Invalid test fixture');
  return positions;
}

function scored(ply: number, uci: string, cp: number | null, classification = 'good') {
  return { ply, uci, eval_after_cp: cp, classification } as AnalyzedMove;
}

describe('saved game timeline with partial engine coverage', () => {
  it('keeps the complete PGN navigable when only its opening was scored', () => {
    const positions = replay(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    const timeline = buildSavedReviewTimeline(positions, [
      scored(1, 'e2e4', 25, 'book'),
      scored(2, 'e7e5', 18, 'best'),
    ]);
    expect(timeline.moves.map((move) => move.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    expect(timeline.moves.map((move) => move.ply)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(timeline.moves.map((move) => move.classification)).toEqual([
      'book', 'best', undefined, undefined, undefined, undefined,
    ]);
    expect(timeline.evals.map((sample) => sample.cp)).toEqual([25, 18, null, null, null, null]);
  });

  it('never attaches an unrelated engine score to a legal saved move', () => {
    const positions = replay(['e4', 'e5', 'Nf3']);
    const timeline = buildSavedReviewTimeline(positions, [
      scored(1, 'd2d4', 830, 'blunder'), scored(2, 'e7e5', 10),
    ]);
    expect(timeline.moves[0]?.classification).toBeUndefined();
    expect(timeline.evals[0]?.cp).toBeNull();
    expect(timeline.moves[1]?.classification).toBe('good');
    expect(timeline.evals[1]?.cp).toBe(10);
  });

  it('keeps Black-first PGNs and games with no engine analysis intact', () => {
    const positions = replay(['Kh2', 'Kb2'], '8/8/8/8/8/8/8/K6k b - - 0 12');
    expect(buildSavedReviewTimeline(positions)).toEqual({
      moves: [{ ply: 1, san: 'Kh2' }, { ply: 2, san: 'Kb2' }],
      evals: [{ ply: 1, cp: null }, { ply: 2, cp: null }],
    });
  });
});
