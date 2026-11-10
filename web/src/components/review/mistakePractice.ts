import { Chess } from 'chess.js';
import { CLASS_STYLE, type VariationMoveQuality } from '../../lib/classification';
import { legalAnalysisMove } from '../../lib/analysisVariations';

export interface PracticeAttempt {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
}

export interface PracticeSquareMove {
  from: string;
  to: string;
  piece: string;
  promotion?: string;
}

/** Only the squares, piece type and promotion choice are disclosed. Showing
 * full SAN before an attempt leaks checks (+) and even forced mates (#).
 * These choices are unranked and use chess.js legality, not engine evidence. */
export function legalPracticeSquareMoves(fenBefore: string): PracticeSquareMove[] {
  try {
    const chess = new Chess(fenBefore);
    return chess.moves({ verbose: true }).map((move) => ({
      from: move.from,
      to: move.to,
      piece: move.piece,
      ...(move.promotion ? { promotion: move.promotion } : {}),
    }));
  } catch { return []; }
}

/** An attempt is always a fresh legal move from the original mistake position. */
export function createPracticeAttempt(fenBefore: string, notation: string): PracticeAttempt | null {
  const input = notation.trim();
  try {
    const chess = new Chess(fenBefore);
    const coordinate = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(input);
    const legal = coordinate ? legalAnalysisMove(fenBefore, input) : null;
    const played = coordinate
      ? legal && chess.move({ from: legal.from, to: legal.to, promotion: legal.promotion })
      : chess.move(input);
    if (!played) return null;
    return { uci: played.from + played.to + (played.promotion ?? ''),
      san: played.san, fenBefore, fenAfter: chess.fen() };
  } catch { return null; }
}

/** Reject responses from a different position, attempt or malformed engine payload. */
export function verifiedPracticeQuality(quality: VariationMoveQuality | null | undefined, attempt: PracticeAttempt): VariationMoveQuality | null {
  if (!quality || quality.source !== 'variation' || quality.fen_before !== attempt.fenBefore
    || quality.fen_after !== attempt.fenAfter || quality.uci !== attempt.uci
    || quality.san !== attempt.san || quality.from !== attempt.uci.slice(0, 2)
    || quality.to !== attempt.uci.slice(2, 4)
    || !Number.isFinite(quality.centipawn_loss) || !Number.isFinite(quality.win_pct_drop)
    || quality.win_pct_drop < 0 || quality.win_pct_drop > 100
    || !Number.isSafeInteger(quality.depth_before) || quality.depth_before < 1
    || !Number.isSafeInteger(quality.scoring_version) || quality.scoring_version < 1
    || !Number.isFinite(quality.eval_before_cp) || !Number.isFinite(quality.eval_after_cp)
    || !Object.prototype.hasOwnProperty.call(CLASS_STYLE, quality.classification)
    || (quality.best_move_san !== null && typeof quality.best_move_san !== 'string')
    || !Array.isArray(quality.best_pv) || !quality.best_pv.every((san) => typeof san === 'string')
    || typeof quality.is_best !== 'boolean'
    || (quality.is_best && quality.best_move_uci !== attempt.uci)) return null;
  // A coherent FEN alone is not sufficient: never reveal a purported best
  // move or engine line that is illegal or mismatched on this position.
  const best = legalAnalysisMove(attempt.fenBefore, quality.best_move_uci ?? '');
  if (!best || (quality.best_move_san !== null && quality.best_move_san !== best.san)) return null;
  try {
    const chess = new Chess(attempt.fenBefore);
    for (const san of quality.best_pv) chess.move(san, { strict: true });
    if (quality.best_pv.length > 0 && quality.best_pv[0] !== best.san) return null;
  } catch { return null; }
  return quality;
}
