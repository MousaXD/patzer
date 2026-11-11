import { legalAnalysisMove } from '../../lib/analysisVariations';

/** Review-only presentation rules. Never suggest a move evaluated on a
 * different FEN, or reuse the saved mainline during a free variation. */
export interface SuggestedMove { best_move_uci?: string | null }

/** Offer an interactive best-move preview only when the cached suggestion is
 *  a legal, correctly named alternative in the original pre-move position.
 *  A raw UCI or SAN by itself is not sufficient evidence for a CTA. */
export function verifiedBestAlternative(
  move: { uci: string; fen_before: string; best_move_uci?: string | null; best_move_san?: string | null },
  precedingFen: string | undefined,
): { uci: string; san: string } | null {
  if (!precedingFen || move.fen_before !== precedingFen
    || !move.best_move_uci || !move.best_move_san) return null;
  const legal = legalAnalysisMove(precedingFen, move.best_move_uci);
  return legal && legal.uci !== move.uci && legal.san === move.best_move_san
    ? { uci: legal.uci, san: legal.san } : null;
}

/** Stockfish's scorer derives absolute ply from FEN (fullmove and turn).
 * Do not submit a relative replay cursor: a setup game starting at Black's
 * move 12 would otherwise be classified as ply 1. */
export function reviewVariationScoringRequest(move: { fenBefore: string; uci: string }) {
  return { fen_before: move.fenBefore, move_uci: move.uci, depth: 12 };
}

/** The FEN includes turn/fullmove, but the game ID prevents one player's
 * exploratory score being reused from a different saved game. */
export function reviewVariationScoringKey(gameId: number, move: { fenBefore: string; uci: string }): string {
  return JSON.stringify([gameId, move.fenBefore, move.uci]);
}

export function visibleEngineLines<T>(lines: T[], resultFen: string, displayedFen: string): T[] {
  return resultFen === displayedFen ? lines : [];
}

/** Reject a mismatched or malformed engine response before presenting arrows.
 * A late result claiming another FEN must not be labelled as the current one.
 */
export function verifiedPositionEngineLines<T>(
  payload: { fen?: unknown; lines?: unknown },
  requestedFen: string,
): T[] | null {
  if (!requestedFen || payload.fen !== requestedFen || !Array.isArray(payload.lines)) return null;
  if (!payload.lines.every((line: unknown) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    const record = line as Record<string, unknown>;
    return typeof record.uci === 'string'
      && legalAnalysisMove(requestedFen, record.uci) !== null
      && typeof record.san === 'string'
      && Array.isArray(record.pv_san)
      && record.pv_san.every((san: unknown) => typeof san === 'string')
      && (record.cp === null || (typeof record.cp === 'number' && Number.isFinite(record.cp)))
      && (record.mate === null || (typeof record.mate === 'number' && Number.isFinite(record.mate)))
      && (record.cp !== null || record.mate !== null)
      && Number.isSafeInteger(record.multipv) && (record.multipv as number) >= 1;
  })) return null;
  return payload.lines as T[];
}

export function bestMoveForDisplayedBoard(args: {
  ply: number;
  isVariation: boolean;
  mainline?: readonly SuggestedMove[];
  liveLines?: readonly { uci: string }[];
  liveReady: boolean;
}): string | undefined {
  if (args.liveReady && args.liveLines?.length) return args.liveLines[0]!.uci;
  // Move N is evaluated from the position before move N, so the displayed
  // position after ply P can only use move P+1's saved suggestion.
  if (args.isVariation) return undefined;
  return args.mainline?.[args.ply]?.best_move_uci ?? undefined;
}
