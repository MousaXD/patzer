import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { bestMoveForDisplayedBoard, visibleEngineLines, verifiedPositionEngineLines, reviewVariationScoringRequest, reviewVariationScoringKey, verifiedBestAlternative, verifiedSavedBestMove, verifiedSavedBestContinuation } from './reviewPosition';

const chess = new Chess();
const savedMoves = ['e4','e5','Nf3'].map((san) => {
  const fen_before = chess.fen();
  const move = chess.move(san);
  return { fen_before, best_move_uci: move.from + move.to + (move.promotion || ''), best_move_san: move.san };
});

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
      ply: 1, displayedFen: savedMoves[1]!.fen_before, isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBe('e7e5');
    expect(bestMoveForDisplayedBoard({
      ply: 0, displayedFen: savedMoves[0]!.fen_before, isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBe('e2e4');
    expect(bestMoveForDisplayedBoard({
      ply: 3, displayedFen: chess.fen(), isVariation: false, mainline: savedMoves, liveReady: false,
    })).toBeUndefined();
  });

  it('never presents mislabeled or position-inconsistent cached best moves as board arrows or advice', () => {
    const initialFen = savedMoves[0]!.fen_before;
    const valid = { ...savedMoves[0], best_pv: ['e4', 'e5', 'Nf3'] };
    expect(verifiedSavedBestMove(valid, initialFen)).toEqual({ uci: 'e2e4', san: 'e4' });
    expect(verifiedSavedBestContinuation(valid, initialFen)).toEqual(['e4', 'e5', 'Nf3']);
    expect(verifiedSavedBestMove({ ...valid, best_move_san: 'Qh5' }, initialFen)).toBeNull();
    expect(verifiedSavedBestMove({ ...valid, best_move_uci: 'e7e5' }, initialFen)).toBeNull();
    expect(verifiedSavedBestMove(valid, savedMoves[1]!.fen_before)).toBeNull();
    expect(verifiedSavedBestContinuation({ ...valid, best_pv: ['Qh5','Qh4'] }, initialFen)).toEqual([]);
    expect(verifiedSavedBestContinuation({ ...valid, best_pv: ['e4','e4'] }, initialFen)).toEqual([]);
    expect(verifiedSavedBestContinuation({ ...valid, best_pv: ['d4','d5'] }, initialFen)).toEqual([]);
    expect(verifiedSavedBestContinuation({ ...valid, best_pv: [] }, initialFen)).toEqual([]);
    expect(bestMoveForDisplayedBoard({ ply: 0, displayedFen: initialFen, isVariation: false,
      mainline: [{ ...valid, best_move_san: 'Qh5' }], liveReady: false })).toBeUndefined();
  });

  it('does not leak saved-game arrows into hypothetical branches', () => {
    expect(bestMoveForDisplayedBoard({
      ply: 1, displayedFen: savedMoves[1]!.fen_before, isVariation: true, mainline: savedMoves, liveReady: false,
    })).toBeUndefined();
  });

  it('uses only verified live lines from the same board position', () => {
    const stale = [{ uci: 'e2e4' }];
    expect(visibleEngineLines(stale, 'old fen', 'new fen')).toEqual([]);
    const fresh = visibleEngineLines([{ uci: 'd2d4' }], 'current fen', 'current fen');
    expect(bestMoveForDisplayedBoard({
      ply: 0, displayedFen: 'current fen', isVariation: true, mainline: savedMoves, liveLines: fresh, liveReady: true,
    })).toBe('d2d4');
    expect(bestMoveForDisplayedBoard({
      ply: 0, displayedFen: 'current fen', isVariation: true, mainline: savedMoves, liveLines: fresh, liveReady: false,
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

  it('rejects duplicate, missing or reordered MultiPV ranks instead of claiming false best moves', () => {
    const fen = new Chess().fen();
    const e4 = { uci: 'e2e4', san: 'e4', pv_san: ['e4','e5'], cp: 45, mate: null, multipv: 1 };
    const d4 = { uci: 'd2d4', san: 'd4', pv_san: ['d4','d5'], cp: 30, mate: null, multipv: 2 };
    expect(verifiedPositionEngineLines({ fen, lines: [e4,d4] }, fen)).toEqual([e4,d4]);
    for (const lines of [
      [e4,{ ...d4, multipv: 1 }], // two competing rank-one best moves
      [e4,{ ...e4, multipv: 2 }], // same move with two conflicting ranks
      [{ ...d4, multipv: 2 }], // missing actual best-ranked line
      [e4,{ ...d4, multipv: 3 }], // an absent rank two must not imply rank three
      [d4,e4], // order mismatch changes the implied best recommendation
    ]) {
      expect(verifiedPositionEngineLines({ fen, lines }, fen), JSON.stringify(lines)).toBeNull();
    }
  });

  it('rejects a fabricated mate claim coexisting with incompatible live centipawn evidence', () => {
    const fen = new Chess().fen();
    const legal = { uci: 'e2e4', san: 'e4', pv_san: ['e4','e5'], cp: null, mate: 2, multipv: 1 };
    expect(verifiedPositionEngineLines({ fen, lines: [legal] }, fen)).toEqual([legal]);
    // Supported engines emit exactly one score type per analyzed PV. These
    // values otherwise would claim a definite mate despite incompatible cp.
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...legal, cp: -200 }] }, fen)).toBeNull();
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...legal, mate: -2, cp: 200 }] }, fen)).toBeNull();
  });

  it('accepts only bounded integer distances for a live mate verdict', () => {
    const fen = new Chess().fen();
    const good = { uci: 'e2e4', san: 'e4', pv_san: ['e4'], cp: null, mate: 2, multipv: 1 };
    expect(verifiedPositionEngineLines({ fen, lines: [good] }, fen)).toEqual([good]);
    expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, mate: -3 }] }, fen)).toEqual([{ ...good, mate: -3 }]);
    for (const mate of [1.5, -0.5, Number.MAX_SAFE_INTEGER + 1, 1000, -1000]) {
      expect(verifiedPositionEngineLines({ fen, lines: [{ ...good, mate }] }, fen), `mate ${mate}`).toBeNull();
    }
  });
});
