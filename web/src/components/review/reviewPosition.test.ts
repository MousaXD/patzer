import { describe, expect, it } from 'vitest';
import { bestMoveForDisplayedBoard, visibleEngineLines } from './reviewPosition';

const savedMoves = [
  { best_move_uci: 'e2e4' },
  { best_move_uci: 'e7e5' },
  { best_move_uci: 'g1f3' },
];

describe('review position-safe suggestions', () => {
  it('uses the next move, never a hint evaluated before the displayed move', () => {
    expect(bestMoveForDisplayedBoard({
      ply: 1, isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBe('e7e5');
    expect(bestMoveForDisplayedBoard({
      ply: 0, isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBe('e2e4');
    expect(bestMoveForDisplayedBoard({
      ply: 3, isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBeUndefined();
  });

  it('does not leak saved-game arrows into hypothetical branches', () => {
    expect(bestMoveForDisplayedBoard({
      ply: 1, isVariation: true, mainline: savedMoves, liveReady: false,
    })).toBeUndefined();
  });

  it('uses only verified live lines from the same board position', () => {
    const stale = [{ uci: 'e2e4' }];
    expect(visibleEngineLines(stale, 'old fen', 'new fen')).toEqual([]);
    const fresh = visibleEngineLines([{ uci: 'd2d4' }], 'current fen', 'current fen');
    expect(bestMoveForDisplayedBoard({
      ply: 0, isVariation: true, mainline: savedMoves, liveLines: fresh, liveReady: true,
    })).toBe('d2d4');
    expect(bestMoveForDisplayedBoard({
      ply: 0, isVariation: true, mainline: savedMoves, liveLines: fresh, liveReady: false,
    })).toBeUndefined();
  });
});
