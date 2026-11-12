import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { bestMoveForDisplayedBoard, visibleEngineLines, verifiedPositionEngineLines, reviewVariationScoringRequest, reviewVariationScoringKey, verifiedBestAlternative } from './reviewPosition';

const savedMoves = [
  { best_move_uci: 'e2e4' },
  { best_move_uci: 'e7e5' },
  { best_move_uci: 'g1f3' },
];

describe('review position-safe suggestions', () => {
  it('only permits a legal, correctly named alternative from the same analyzed pre-move FEN', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 12';
    const scored = { uci: 'e7e5', fen_before: fen, best_move_uci: 'c7c5', best_move_san: 'c5' };
    expect(verifiedBestAlternative(scored, fen)).toEqual({ uci: 'c7c5', san: 'c5' });
    expect(verifiedBestAlternative(scored, new Chess().fen())).toBeNull();
    expect(verifiedBestAlternative({ ...scored, best_move_san: 'd5' }, fen)).toBeNull();
    expect(verifiedBestAlternative({ ...scored, best_move_uci: 'c2c4' }, fen)).toBeNull();
    expect(verifiedBestAlternative({ ...scored, best_move_uci: 'e7e5', best_move_san: 'e5' }, fen)).toBeNull();
    expect(verifiedBestAlternative({ ...scored, best_move_uci: null }, fen)).toBeNull();
  });
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

  it('never substitutes relative PGN ply for absolute FEN-based scoring in custom setups', () => {
    const move = { fenBefore: '8/8/8/8/8/8/8/K6k b - - 0 12', uci: 'h1h2' };
    expect(reviewVariationScoringRequest(move)).toEqual({
      fen_before: move.fenBefore, move_uci: move.uci, depth: 12,
    });
    expect(reviewVariationScoringRequest(move)).not.toHaveProperty('ply');
    expect(reviewVariationScoringKey(1, move)).not.toBe(reviewVariationScoringKey(2, move));
    expect(reviewVariationScoringKey(1, move)).not.toBe(reviewVariationScoringKey(1, { ...move, uci: 'h1g1' }));
  });

  it('rejects an engine response tagged for a different FEN or with illegal arrows', () => {
    const fen = new Chess().fen();
    const good = { uci: 'e2e4', san: 'e4', pv_san: ['e4'], cp: 45, mate: null, multipv: 1 };
    expect(verifiedPositionEngineLines({ fen, lines: [good] }, fen)).toEqual([good]);
    expect(verifiedPositionEngineLines({ fen: 'unrelated', lines: [good] }, fen)).toBeNull();
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, uci: 'e7e5' }] }, fen)).toBeNull();
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, cp: Number.NaN }] }, fen)).toBeNull();
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, cp: null, mate: null }] }, fen)).toBeNull();
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, san: null }] }, fen)).toBeNull();
  });

  it('refuses a live engine line whose legal UCI is mislabeled or whose continuation is not legal', () => {
    const fen = new Chess().fen();
    const good = { uci: 'e2e4', san: 'e4', pv_san: ['e4', 'e5', 'Nf3'], cp: 45, mate: null, multipv: 1 };
    expect(verifiedPositionEngineLines({ fen, lines: [good] }, fen)).toEqual([good]);
    // A truthful FEN and legal e2e4 arrow are not enough to authenticate
    // a different visible move label or fabricated coaching continuation.
    for (const changes of [
      { san: 'd4', pv_san: ['d4'] },
      { pv_san: ['d4'] },
      { pv_san: [] },
      { pv_san: ['e4', 'e4'] },
      { pv_san: ['e4', 'not a move'] },
    ]) {
      expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, ...changes }] }, fen), JSON.stringify(changes)).toBeNull();
    }
  });
});
