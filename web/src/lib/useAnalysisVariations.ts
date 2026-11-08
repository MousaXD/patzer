import { useCallback, useMemo, useState } from 'react';
import {
  type AnalysisVariation, type AnalysisVariationMove, type AnalysisVariationState,
  type OriginalGamePosition, getAnalysisVariationView, initialAnalysisVariationState,
  legalAnalysisMove, restoreOriginalAnalysisGame, selectAnalysisVariation,
  selectOriginalAnalysisPly, stepAnalysisBackward, stepAnalysisForward,
  submitAnalysisVariationMove,
} from './analysisVariations';

export interface UseAnalysisVariationsOptions {
  positions: readonly OriginalGamePosition[];
  initialPly?: number;
  /** Game ID or PGN identity. A change resets all ephemeral branches. */
  gameKey?: string | number;
}

export interface AnalysisVariationController {
  currentFen: string;
  baseGameFen: string;
  variationBaseFen: string;
  basePly: number;
  originalPly: number;
  activeVariationId: string | null;
  variations: AnalysisVariation[];
  currentVariationMoves: AnalysisVariationMove[];
  playedVariationMoves: AnalysisVariationMove[];
  currentVariationSan: string[];
  currentVariationUci: string[];
  variationCursor: number;
  lastMove: { from: string; to: string; san?: string; uci?: string } | null;
  error: string | null;
  submitMove(uci: string): boolean;
  stepBackward(): void;
  stepForward(): void;
  undo(): void;
  redo(): void;
  selectOriginalPly(ply: number): void;
  selectVariation(id: string, cursor?: number): void;
  restoreOriginalGame(): void;
  clearError(): void;
}

/**
 * Local-only game analysis. Never persists a variation or changes the saved PGN.
 * The view is derived from the cursor on each render: no independently cached FEN.
 */
export function useAnalysisVariations({ positions, initialPly = 0, gameKey }: UseAnalysisVariationsOptions): AnalysisVariationController {
  // Including all FENs distinguishes separate games, including identical openings.
  const identity = useMemo(
    () => `${gameKey ?? ''}\u0000${positions.map((p) => p.fen).join('\u0000')}`,
    [gameKey, positions],
  );
  const [record, setRecord] = useState<{ identity: string; state: AnalysisVariationState }>(
    () => ({ identity, state: initialAnalysisVariationState(initialPly) }),
  );
  // A changed game is already reset at render time. No stale one-frame position.
  const state = record.identity === identity ? record.state : initialAnalysisVariationState(initialPly);
  const view = getAnalysisVariationView(state, positions);

  const transition = useCallback((fn: (prev: AnalysisVariationState) => AnalysisVariationState) => {
    setRecord((prev) => ({
      identity,
      state: fn(prev.identity === identity ? prev.state : initialAnalysisVariationState(initialPly)),
    }));
  }, [identity, initialPly]);

  const submitMove = useCallback((uci: string): boolean => {
    if (!legalAnalysisMove(view.currentFen, uci)) {
      transition((s) => ({ ...s, error: 'Illegal move for the displayed position' }));
      return false;
    }
    transition((s) => submitAnalysisVariationMove(s, positions, uci));
    return true;
  }, [view.currentFen, positions, transition]);

  const stepBackward = useCallback(() => transition((s) => stepAnalysisBackward(s, positions)), [transition, positions]);
  const stepForward = useCallback(() => transition((s) => stepAnalysisForward(s, positions)), [transition, positions]);
  const selectOriginalPly = useCallback((ply: number) => transition((s) => selectOriginalAnalysisPly(s, positions, ply)), [transition, positions]);
  const selectVariation = useCallback((id: string, cursor?: number) => transition((s) => selectAnalysisVariation(s, id, cursor)), [transition]);
  const restoreOriginalGame = useCallback(() => transition(restoreOriginalAnalysisGame), [transition]);
  const clearError = useCallback(() => transition((s) => ({ ...s, error: null })), [transition]);

  return {
    ...view,
    originalPly: state.originalPly,
    activeVariationId: state.activeVariationId,
    variations: state.variations,
    error: state.error,
    submitMove,
    stepBackward, stepForward,
    undo: stepBackward, redo: stepForward,
    selectOriginalPly, selectVariation, restoreOriginalGame, clearError,
  };
}
