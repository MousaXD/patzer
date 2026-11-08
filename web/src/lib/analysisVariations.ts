import { Chess } from 'chess.js';

/** A saved game's immutable, sequential positions. Index 0 is the starting position. */
export interface OriginalGamePosition {
  fen: string;
  san?: string;
  uci?: string;
  from?: string;
  to?: string;
}

export interface AnalysisVariationMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion?: string;
  fenBefore: string;
  fenAfter: string;
}

/** A branch forks either from the original game or from a cursor in another branch. */
export interface AnalysisVariation {
  id: string;
  basePly: number;
  parentId: string | null;
  parentCursor: number | null;
  baseFen: string;
  moves: AnalysisVariationMove[];
}

export interface AnalysisVariationState {
  originalPly: number;
  activeVariationId: string | null;
  variationCursor: number;
  variations: AnalysisVariation[];
  nextVariationId: number;
  /** Last branch exited by undo, so redo can return to it rather than mainline. */
  redoVariationId: string | null;
  error: string | null;
}

export interface AnalysisVariationView {
  currentFen: string;
  /** Original saved-game position from which the active branch ultimately descends. */
  baseGameFen: string;
  basePly: number;
  /** FEN at this branch's immediate fork (may differ from baseGameFen). */
  variationBaseFen: string;
  /** Entire original-fork-to-active line, including ancestor prefixes and redo moves. */
  currentVariationMoves: AnalysisVariationMove[];
  /** Played prefix through the cursor; use when building a position-specific prompt. */
  playedVariationMoves: AnalysisVariationMove[];
  currentVariationSan: string[];
  currentVariationUci: string[];
  /** Cursor within the active leaf branch (not the flattened line). */
  variationCursor: number;
  lastMove: { from: string; to: string; san?: string; uci?: string } | null;
}

export function initialAnalysisVariationState(initialPly = 0): AnalysisVariationState {
  return {
    originalPly: Math.max(0, Math.trunc(Number.isFinite(initialPly) ? initialPly : 0)),
    activeVariationId: null,
    variationCursor: 0,
    variations: [],
    nextVariationId: 1,
    redoVariationId: null,
    error: null,
  };
}

function clampPly(ply: number, positions: readonly OriginalGamePosition[]): number {
  return Math.min(Math.max(0, Math.trunc(Number.isFinite(ply) ? ply : 0)), Math.max(0, positions.length - 1));
}

function currentBranch(state: AnalysisVariationState): AnalysisVariation | null {
  return state.variations.find((v) => v.id === state.activeVariationId) ?? null;
}

function originalMove(position: OriginalGamePosition | undefined): AnalysisVariationView['lastMove'] {
  if (!position?.from || !position?.to) return null;
  return { from: position.from, to: position.to, san: position.san, uci: position.uci };
}

/** Inherit each ancestor's played prefix, never its future/undone tail. */
function variationPrefix(branch: AnalysisVariation, variations: AnalysisVariation[]): AnalysisVariationMove[] {
  const segments: AnalysisVariationMove[][] = [];
  const seen = new Set<string>([branch.id]);
  let current = branch;
  while (current.parentId) {
    if (seen.has(current.parentId)) break;
    seen.add(current.parentId);
    const parent = variations.find((v) => v.id === current.parentId);
    if (!parent) break;
    segments.unshift(parent.moves.slice(0, current.parentCursor ?? 0));
    current = parent;
  }
  return segments.flat();
}

/** Always derive the board FEN from an immutable move record and the cursor. */
export function getAnalysisVariationView(
  state: AnalysisVariationState,
  positions: readonly OriginalGamePosition[],
): AnalysisVariationView {
  const branch = currentBranch(state);
  const originalPly = clampPly(state.originalPly, positions);
  const basePly = branch ? clampPly(branch.basePly, positions) : originalPly;
  const baseGameFen = positions[basePly]?.fen ?? '';
  if (!branch) {
    return {
      currentFen: baseGameFen,
      baseGameFen,
      basePly,
      variationBaseFen: baseGameFen,
      currentVariationMoves: [],
      playedVariationMoves: [],
      currentVariationSan: [],
      currentVariationUci: [],
      variationCursor: 0,
      lastMove: originalMove(positions[basePly]),
    };
  }

  const cursor = Math.min(Math.max(0, state.variationCursor), branch.moves.length);
  const prefix = variationPrefix(branch, state.variations);
  const played = branch.moves.slice(0, cursor);
  const fullLine = [...prefix, ...branch.moves];
  const previous = played[played.length - 1];
  const highlighted = previous ?? prefix[prefix.length - 1];
  const lastMove = highlighted
    ? { from: highlighted.from, to: highlighted.to, san: highlighted.san, uci: highlighted.uci }
    : originalMove(positions[basePly]);
  return {
    currentFen: previous?.fenAfter ?? branch.baseFen,
    baseGameFen,
    basePly,
    variationBaseFen: branch.baseFen,
    currentVariationMoves: fullLine,
    playedVariationMoves: [...prefix, ...played],
    currentVariationSan: fullLine.map((m) => m.san),
    currentVariationUci: fullLine.map((m) => m.uci),
    variationCursor: cursor,
    lastMove,
  };
}

/** Legal move parsing is centralized; never trust a drag event or a bare UCI string. */
export function legalAnalysisMove(fen: string, uci: string): AnalysisVariationMove | null {
  const normalized = uci.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(normalized)) return null;
  try {
    const chess = new Chess(fen);
    const played = chess.move({
      from: normalized.slice(0, 2),
      to: normalized.slice(2, 4),
      ...(normalized.length === 5 ? { promotion: normalized[4] } : {}),
    });
    if (!played || (normalized.length === 5) !== !!played.promotion) return null;
    return {
      san: played.san,
      uci: played.from + played.to + (played.promotion ?? ''),
      from: played.from,
      to: played.to,
      ...(played.promotion ? { promotion: played.promotion } : {}),
      fenBefore: fen,
      fenAfter: chess.fen(),
    };
  } catch {
    return null;
  }
}

/** Pure transition, suitable for UI events, reducers, and direct regression tests. */
export function submitAnalysisVariationMove(
  state: AnalysisVariationState,
  positions: readonly OriginalGamePosition[],
  uci: string,
): AnalysisVariationState {
  const view = getAnalysisVariationView(state, positions);
  const move = legalAnalysisMove(view.currentFen, uci);
  if (!move) return { ...state, error: 'Illegal move for the displayed position' };
  state = { ...state, redoVariationId: null };

  const branch = currentBranch(state);
  if (!branch) {
    const originalPly = clampPly(state.originalPly, positions);
    const following = positions[originalPly + 1];
    const nextUci = following?.uci ?? (following?.from && following?.to
      ? following.from + following.to : null);
    // Replaying an existing saved move stays on the original mainline.
    if (nextUci === move.uci) {
      return { ...state, originalPly: originalPly + 1, error: null };
    }
  } else {
    const next = branch.moves[state.variationCursor];
    // An already recorded continuation is replayed rather than duplicated.
    if (next?.uci === move.uci) {
      return { ...state, variationCursor: state.variationCursor + 1, error: null };
    }
    if (state.variationCursor >= branch.moves.length) {
      return {
        ...state,
        variations: state.variations.map((v) => v.id === branch.id ? { ...v, moves: [...v.moves, move] } : v),
        variationCursor: branch.moves.length + 1,
        error: null,
      };
    }
    // A deviation inside an existing branch creates a child, retaining the old tail.
    const id = `v${state.nextVariationId}`;
    return {
      ...state,
      variations: [...state.variations, {
        id, basePly: branch.basePly, parentId: branch.id,
        parentCursor: state.variationCursor, baseFen: view.currentFen, moves: [move],
      }],
      activeVariationId: id,
      variationCursor: 1,
      nextVariationId: state.nextVariationId + 1,
      error: null,
    };
  }

  const id = `v${state.nextVariationId}`;
  return {
    ...state,
    variations: [...state.variations, {
      id, basePly: view.basePly, parentId: null, parentCursor: null,
      baseFen: view.currentFen, moves: [move],
    }],
    activeVariationId: id,
    variationCursor: 1,
    nextVariationId: state.nextVariationId + 1,
    error: null,
  };
}

export function selectOriginalAnalysisPly(
  state: AnalysisVariationState,
  positions: readonly OriginalGamePosition[],
  ply: number,
): AnalysisVariationState {
  return { ...state, originalPly: clampPly(ply, positions), activeVariationId: null, variationCursor: 0, redoVariationId: null, error: null };
}

export function selectAnalysisVariation(
  state: AnalysisVariationState,
  id: string,
  cursor?: number,
): AnalysisVariationState {
  const branch = state.variations.find((v) => v.id === id);
  if (!branch) return { ...state, error: `Unknown variation: ${id}` };
  return {
    ...state,
    activeVariationId: id,
    variationCursor: cursor === undefined ? branch.moves.length
      : Math.min(Math.max(0, Math.trunc(Number.isFinite(cursor) ? cursor : 0)), branch.moves.length),
    redoVariationId: null,
    error: null,
  };
}

export function restoreOriginalAnalysisGame(state: AnalysisVariationState): AnalysisVariationState {
  const branch = currentBranch(state);
  return {
    ...state,
    originalPly: branch?.basePly ?? state.originalPly,
    activeVariationId: null,
    variationCursor: 0,
    redoVariationId: null,
    error: null,
  };
}

export function stepAnalysisBackward(state: AnalysisVariationState, positions: readonly OriginalGamePosition[]): AnalysisVariationState {
  const branch = currentBranch(state);
  if (!branch) return {
    ...state, originalPly: clampPly(state.originalPly - 1, positions), redoVariationId: null, error: null,
  };
  if (state.variationCursor > 0) return {
    ...state, variationCursor: state.variationCursor - 1, redoVariationId: null, error: null,
  };
  // Retain which branch Undo just left, so Redo restores that exact continuation.
  if (branch.parentId) return {
    ...state,
    activeVariationId: branch.parentId,
    variationCursor: branch.parentCursor ?? 0,
    redoVariationId: branch.id,
    error: null,
  };
  return { ...restoreOriginalAnalysisGame(state), redoVariationId: branch.id };
}

export function stepAnalysisForward(state: AnalysisVariationState, positions: readonly OriginalGamePosition[]): AnalysisVariationState {
  const branch = currentBranch(state);
  const redoChild = state.variations.find((v) => v.id === state.redoVariationId);
  if (redoChild && (branch
    ? redoChild.parentId === branch.id && redoChild.parentCursor === state.variationCursor
    : redoChild.parentId === null && redoChild.basePly === clampPly(state.originalPly, positions))) {
    return { ...state, activeVariationId: redoChild.id, variationCursor: 0, redoVariationId: null, error: null };
  }
  if (!branch) return {
    ...state, originalPly: clampPly(state.originalPly + 1, positions), redoVariationId: null, error: null,
  };
  return {
    ...state, variationCursor: Math.min(branch.moves.length, state.variationCursor + 1),
    redoVariationId: null, error: null,
  };
}
