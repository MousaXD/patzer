import { Chess } from 'chess.js';
import { legalAnalysisMove } from '../../lib/analysisVariations';

/** Review-only presentation rules. Never suggest a move evaluated on a
 * different FEN, or reuse the saved mainline during a free variation. */
export interface SuggestedMove { best_move_uci?: string | null }

export interface SavedBestAdvice extends SuggestedMove {
  fen_before: string;
  best_move_san?: string | null;
  best_pv?: readonly string[];
}

/** Cached engine advice is descriptive data, not a license to draw arbitrary
 * arrows or tell a learner an impossible move was best. The current FEN,
 * legal UCI and canonical SAN must all match before it is presented. */
export function verifiedSavedBestMove(
  move: SavedBestAdvice | null | undefined,
  precedingFen: string | undefined,
): { uci: string; san: string } | null {
  if (!move || !precedingFen || move.fen_before !== precedingFen
    || !move.best_move_uci || !move.best_move_san) return null;
  const legal = legalAnalysisMove(precedingFen, move.best_move_uci);
  return legal && legal.san === move.best_move_san
    ? { uci: legal.uci, san: legal.san } : null;
}

/** The engine may offer a sound best move alongside a corrupted or truncated
 * PV. Keep the legally verified move visible, but do not invent or echo a
 * continuation unless every SAN can be replayed from that exact position. */
export function verifiedSavedBestContinuation(
  move: SavedBestAdvice | null | undefined,
  precedingFen: string | undefined,
): string[] {
  const best = verifiedSavedBestMove(move, precedingFen);
  if (!best || !Array.isArray(move?.best_pv) || move.best_pv.length === 0
    || move.best_pv[0] !== best.san) return [];
  try {
    const replay = new Chess(precedingFen);
    for (const san of move.best_pv) {
      if (typeof san !== 'string') return [];
      const played = replay.move(san, { strict: true });
      if (!played || played.san !== san) return [];
    }
    return [...move.best_pv];
  } catch {
    return [];
  }
}

/** Offer an interactive best-move preview only when the cached suggestion is
 *  a legal, correctly named alternative in the original pre-move position.
 *  A raw UCI or SAN by itself is not sufficient evidence for a CTA. */
export function verifiedBestAlternative(
  move: { uci: string; fen_before: string; best_move_uci?: string | null; best_move_san?: string | null },
  precedingFen: string | undefined,
): { uci: string; san: string } | null {
  const best = verifiedSavedBestMove(move, precedingFen);
  return best && best.uci !== move.uci ? best : null;
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
 * A matching position and legal UCI are not enough: the visible SAN and PV
 * must also describe that exact move and a legal continuation. Otherwise the
 * analysis panel could invite the player to try e4 while claiming it is d4.
 */
export function verifiedPositionEngineLines<T>(
  payload: { fen?: unknown; lines?: unknown },
  requestedFen: string,
): T[] | null {
  if (!requestedFen || payload.fen !== requestedFen || !Array.isArray(payload.lines)) return null;
  const seenFirstMoves = new Set<string>();
  if (!payload.lines.every((line: unknown, index: number) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    const record = line as Record<string, unknown>;
    const first = typeof record.uci === 'string' ? legalAnalysisMove(requestedFen, record.uci) : null;
    if (!first || record.san !== first.san
      || !Array.isArray(record.pv_san) || record.pv_san.length === 0 || record.pv_san.length > 8
      || !record.pv_san.every((san: unknown) => typeof san === 'string')
      || (record.cp !== null && (typeof record.cp !== 'number' || !Number.isFinite(record.cp)))
      || (record.mate !== null && (typeof record.mate !== 'number' || !Number.isFinite(record.mate)))
      || (record.cp === null && record.mate === null)
      // Stockfish UCI and the hosted engine return one scored verdict per
      // line, not a nonzero mate *and* cp. Do not promote contradictory
      // evidence to a definite mate or a best-move claim. The separate
      // unsigned mate-zero sentinel remains a neutral/unknown display.
      || (record.mate !== null && record.mate !== 0 && record.cp !== null)
      || !Number.isSafeInteger(record.multipv) || record.multipv !== index + 1
      || seenFirstMoves.has(first.uci)) return false;
    try {
      const replay = new Chess(requestedFen);
      for (const [index, san] of record.pv_san.entries()) {
        const actual = replay.move(san);
        if (!actual || actual.san !== san) return false;
        if (index === 0 && actual.from + actual.to + (actual.promotion || '') !== first.uci) return false;
      }
      seenFirstMoves.add(first.uci);
      return true;
    } catch {
      return false;
    }
  })) return null;
  return payload.lines as T[];
}

export function bestMoveForDisplayedBoard(args: {
  ply: number;
  displayedFen: string;
  isVariation: boolean;
  mainline?: readonly SavedBestAdvice[];
  liveLines?: readonly { uci: string }[];
  liveReady: boolean;
}): string | undefined {
  if (args.liveReady && args.liveLines?.length) return args.liveLines[0]!.uci;
  // Move N is evaluated from the position before move N, so the displayed
  // position after ply P can only use move P+1's saved suggestion.
  if (args.isVariation) return undefined;
  return verifiedSavedBestMove(args.mainline?.[args.ply], args.displayedFen)?.uci;
}
