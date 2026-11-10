import { describe, expect, it } from 'vitest';
import { buildMovePairs, moveListStart, pairIndexForPly } from './moveHistoryModel';

const moves = [{ ply: 1, san: 'Nf6' }, { ply: 2, san: 'd4' }, { ply: 3, san: 'g6' }];

describe('Review FEN-aware move numbering', () => {
  it('uses normal white-first pairing for an ordinary imported game', () => {
    const pairs = buildMovePairs(moves);
    expect(pairs[0]).toMatchObject({ num: 1, white: moves[0], black: moves[1] });
    expect(pairs[1]).toMatchObject({ num: 2, white: moves[2] });
    expect(pairIndexForPly(3)).toBe(2);
  });

  it('does not label Black’s first move as White for an alternate-start game', () => {
    const fen = '8/8/8/8/8/8/8/K6k b - - 0 12';
    const pairs = buildMovePairs(moves, fen);
    expect(moveListStart(fen)).toEqual({ startsBlack: true, fullmove: 12 });
    expect(pairs[0]).toMatchObject({ num: 12, black: moves[0] });
    expect(pairs[0].white).toBeUndefined();
    expect(pairs[1]).toMatchObject({ num: 13, white: moves[1], black: moves[2] });
    expect(pairIndexForPly(2, fen)).toBe(2);
  });

  it('falls back safely for absent or malformed FEN metadata', () => {
    expect(moveListStart('bad input')).toEqual({ startsBlack: false, fullmove: 1 });
    expect(buildMovePairs([], 'bad input')).toEqual([]);
  });
});
