import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  getAnalysisVariationView, initialAnalysisVariationState, legalAnalysisMove,
  restoreOriginalAnalysisGame, selectAnalysisVariation, selectOriginalAnalysisPly,
  stepAnalysisBackward, stepAnalysisForward, submitAnalysisVariationMove, analysisVariationPreview,
  type OriginalGamePosition,
} from './analysisVariations';

function game(...san: string[]): OriginalGamePosition[] {
  const chess = new Chess();
  const positions: OriginalGamePosition[] = [{ fen: chess.fen() }];
  for (const notation of san) {
    const move = chess.move(notation);
    positions.push({
      fen: chess.fen(), san: move.san, from: move.from, to: move.to,
      uci: move.from + move.to + (move.promotion ?? ''),
    });
  }
  return positions;
}

const history = game('e4', 'e5', 'Nf3', 'Nc6');

describe('local analysis variations', () => {
  it('replays the saved mainline without branching or changing the PGN positions', () => {
    const snapshot = JSON.stringify(history);
    let state = initialAnalysisVariationState();
    state = submitAnalysisVariationMove(state, history, 'e2e4');
    state = submitAnalysisVariationMove(state, history, 'e7e5');
    expect(state.originalPly).toBe(2);
    expect(state.variations).toEqual([]);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(history[2]!.fen);
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it('creates a multi-move Sicilian alternative from an arbitrary saved-game ply', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = submitAnalysisVariationMove(state, history, 'd7d6');
    const view = getAnalysisVariationView(state, history);
    expect(state.variations).toHaveLength(1);
    expect(view.basePly).toBe(1);
    expect(view.baseGameFen).toBe(history[1]!.fen);
    expect(view.variationBaseFen).toBe(history[1]!.fen);
    expect(view.currentVariationSan).toEqual(['c5', 'Nf3', 'd6']);
    expect(view.currentVariationUci).toEqual(['c7c5', 'g1f3', 'd7d6']);
    expect(view.variationCursor).toBe(3);
    expect(view.lastMove?.to).toBe('d6');
    expect(new Chess(view.currentFen).turn()).toBe('w');
    expect(history[2]!.san).toBe('e5');
  });

  it('undoes, redoes and returns to the original game without losing variations', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    const finalFen = getAnalysisVariationView(state, history).currentFen;
    state = stepAnalysisBackward(state, history);
    expect(getAnalysisVariationView(state, history).playedVariationMoves.map((m) => m.san)).toEqual(['c5']);
    expect(getAnalysisVariationView(state, history).currentVariationSan).toEqual(['c5', 'Nf3']);
    state = stepAnalysisForward(state, history);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(finalFen);
    state = restoreOriginalAnalysisGame(state);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(history[1]!.fen);
    expect(state.variations).toHaveLength(1);
    state = selectAnalysisVariation(state, 'v1', 2);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(finalFen);
  });

  it('branches inside a variation, preserves the parent tail and restores correct FEN when switching', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    const originalBranchFen = getAnalysisVariationView(state, history).currentFen;
    state = stepAnalysisBackward(state, history);
    state = submitAnalysisVariationMove(state, history, 'd2d4');
    const childFen = getAnalysisVariationView(state, history).currentFen;
    expect(state.activeVariationId).toBe('v2');
    expect(state.variations).toHaveLength(2);
    expect(state.variations[0]!.moves.map((m) => m.san)).toEqual(['c5', 'Nf3']);
    expect(state.variations[1]!.parentId).toBe('v1');
    expect(state.variations[1]!.parentCursor).toBe(1);
    state = selectAnalysisVariation(state, 'v1');
    expect(state.variationCursor).toBe(1);
    expect(getAnalysisVariationView(state, history).lastMove?.san).toBe('c5');
    state = selectAnalysisVariation(state, 'v1', 2);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(originalBranchFen);
    state = selectAnalysisVariation(state, 'v2');
    expect(getAnalysisVariationView(state, history).currentFen).toBe(childFen);
    state = stepAnalysisBackward(state, history);
    state = stepAnalysisBackward(state, history);
    expect(state.activeVariationId).toBe('v1');
    expect(state.variationCursor).toBe(1);
    expect(getAnalysisVariationView(state, history).playedVariationMoves.map((m) => m.san)).toEqual(['c5']);
  });

  it('includes ancestor prefixes and correct last-move highlighting in nested variation', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = stepAnalysisBackward(state, history);
    state = submitAnalysisVariationMove(state, history, 'd2d4');
    let view = getAnalysisVariationView(state, history);
    expect(view.currentVariationSan).toEqual(['c5', 'd4']);
    expect(view.currentVariationUci).toEqual(['c7c5', 'd2d4']);
    expect(view.playedVariationMoves.map((m) => m.san)).toEqual(['c5', 'd4']);
    state = stepAnalysisBackward(state, history);
    view = getAnalysisVariationView(state, history);
    expect(view.playedVariationMoves.map((m) => m.san)).toEqual(['c5']);
    expect(view.lastMove?.san).toBe('c5');
    expect(view.currentFen).toBe(state.variations[1]!.baseFen);
  });

  it('remembers an independent cursor and last-move highlight per parent and nested branch', () => {
    const original = JSON.stringify(history);
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = stepAnalysisBackward(state, history); // Parent at c5; Nf3 is still its tail.
    const parentFen = getAnalysisVariationView(state, history).currentFen;
    state = submitAnalysisVariationMove(state, history, 'd2d4'); // Fork a child after c5.
    const childFen = getAnalysisVariationView(state, history).currentFen;
    expect(state.activeVariationId).toBe('v2');
    state = selectAnalysisVariation(state, 'v1');
    expect(state.variationCursor).toBe(1);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(parentFen);
    expect(getAnalysisVariationView(state, history).lastMove?.san).toBe('c5');
    expect(getAnalysisVariationView(state, history).playedVariationMoves.map(m => m.san)).toEqual(['c5']);
    state = selectAnalysisVariation(state, 'v2');
    expect(state.variationCursor).toBe(1);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(childFen);
    state = stepAnalysisBackward(state, history); // Child at its exact fork.
    state = selectAnalysisVariation(state, 'v1');
    state = selectAnalysisVariation(state, 'v2');
    expect(state.variationCursor).toBe(0);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(parentFen);
    expect(getAnalysisVariationView(state, history).lastMove?.san).toBe('c5');
    expect(getAnalysisVariationView(state, history).playedVariationMoves.map(m => m.san)).toEqual(['c5']);
    state = restoreOriginalAnalysisGame(state);
    state = selectAnalysisVariation(state, 'v2');
    expect(state.variationCursor).toBe(0);
    expect(JSON.stringify(history)).toBe(original);
  });

  it('shows move evidence and ancestor context in branch-picker previews', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = stepAnalysisBackward(state, history);
    state = submitAnalysisVariationMove(state, history, 'd2d4');
    expect(analysisVariationPreview(state.variations[0]!, state.variations))
      .toBe('c5 Nf3');
    expect(analysisVariationPreview(state.variations[1]!, state.variations))
      .toBe('c5 d4');
    state = submitAnalysisVariationMove(state, history, 'e7e6');
    expect(analysisVariationPreview(state.variations[1]!, state.variations))
      .toBe('c5 d4 e6');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = submitAnalysisVariationMove(state, history, 'g8f6');
    expect(analysisVariationPreview(state.variations[1]!, state.variations))
      .toBe('… d4 e6 Nf3 Nf6');
  });

  it('redo restores the original variation after undo crosses to saved game', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    const fen = getAnalysisVariationView(state, history).currentFen;
    state = stepAnalysisBackward(state, history);
    state = stepAnalysisBackward(state, history);
    expect(state.activeVariationId).toBeNull();
    state = stepAnalysisForward(state, history);
    expect(state.activeVariationId).toBe('v1');
    expect(state.variationCursor).toBe(0);
    state = stepAnalysisForward(state, history);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(fen);
  });

  it('redo restores the nested child after undo crosses to parent', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = stepAnalysisBackward(state, history);
    state = submitAnalysisVariationMove(state, history, 'd2d4');
    const fen = getAnalysisVariationView(state, history).currentFen;
    state = stepAnalysisBackward(state, history);
    state = stepAnalysisBackward(state, history);
    expect(state.activeVariationId).toBe('v1');
    expect(state.variationCursor).toBe(1);
    state = stepAnalysisForward(state, history);
    expect(state.activeVariationId).toBe('v2');
    state = stepAnalysisForward(state, history);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(fen);
  });

  it('creates independent alternatives from the same original ply', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = restoreOriginalAnalysisGame(state);
    state = submitAnalysisVariationMove(state, history, 'e7e6');
    expect(state.variations).toHaveLength(2);
    expect(state.variations[0]!.moves[0]!.san).toBe('c5');
    expect(state.variations[1]!.moves[0]!.san).toBe('e6');
    state = selectAnalysisVariation(state, 'v1');
    expect(getAnalysisVariationView(state, history).currentVariationSan).toEqual(['c5']);
    state = selectAnalysisVariation(state, 'v2');
    expect(getAnalysisVariationView(state, history).currentVariationSan).toEqual(['e6']);
  });

  it('replays an existing branch continuation instead of duplicating it', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 1);
    state = submitAnalysisVariationMove(state, history, 'c7c5');
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    state = stepAnalysisBackward(state, history);
    state = submitAnalysisVariationMove(state, history, 'g1f3');
    expect(state.variations).toHaveLength(1);
    expect(state.variations[0]!.moves).toHaveLength(2);
    expect(state.variationCursor).toBe(2);
  });

  it('rejects illegal coordinates, wrong colors and moves that ignore check', () => {
    const start = initialAnalysisVariationState();
    const bad = submitAnalysisVariationMove(start, history, 'e2e5');
    expect(bad.variations).toHaveLength(0);
    expect(bad.error).toMatch(/Illegal move/);
    expect(submitAnalysisVariationMove(start, history, 'e7e5').error).toBeTruthy();
    expect(legalAnalysisMove('4k3/8/8/8/8/8/4r3/4KR2 w - - 0 1', 'f1f2')).toBeNull();
    expect(legalAnalysisMove('bogus', 'e2e4')).toBeNull();
    expect(legalAnalysisMove(history[0]!.fen, 'e2e4q')).toBeNull();
  });

  it('supports legal castling on both sides and refuses an attacked castle', () => {
    const open = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(legalAnalysisMove(open, 'e1g1')?.san).toBe('O-O');
    expect(legalAnalysisMove(open, 'e1c1')?.san).toBe('O-O-O');
    const black = legalAnalysisMove(open, 'e1g1')!;
    expect(legalAnalysisMove(black.fenAfter, 'e8c8')?.san).toBe('O-O-O');
    expect(legalAnalysisMove('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1', 'e1g1')).toBeNull();
  });

  it('handles en passant, capture, checks and exact promotion choice', () => {
    const ep = legalAnalysisMove('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6');
    expect(ep?.san).toBe('exd6');
    expect(new Chess(ep!.fenAfter).get('d5')).toBeUndefined();
    expect(legalAnalysisMove('4k3/8/8/8/8/8/4q3/4K3 w - - 0 1', 'e1e2')?.san).toContain('Kxe2');
    const promotionFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    expect(legalAnalysisMove(promotionFen, 'a7a8')).toBeNull();
    expect(legalAnalysisMove(promotionFen, 'a7a8q')?.san).toContain('=Q');
    expect(legalAnalysisMove(promotionFen, 'a7a8n')?.san).toContain('=N');
  });

  it('clamps navigation and handles bad variations without losing the board', () => {
    let state = selectOriginalAnalysisPly(initialAnalysisVariationState(), history, 999);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(history[4]!.fen);
    state = stepAnalysisForward(state, history);
    expect(state.originalPly).toBe(4);
    state = selectAnalysisVariation(state, 'missing');
    expect(state.error).toMatch(/Unknown variation/);
    expect(getAnalysisVariationView(state, history).currentFen).toBe(history[4]!.fen);
  });
});
