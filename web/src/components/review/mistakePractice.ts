import { Chess } from 'chess.js';
import { CLASS_STYLE, type VariationMoveQuality } from '../../lib/classification';
import { legalAnalysisMove } from '../../lib/analysisVariations';

export interface PracticeAttempt {
  uci: string;
  san: string;
  fenBefore: string;
  fenAfter: string;
}

/** An attempt is always a fresh legal move from the original mistake position. */
export function createPracticeAttempt(fenBefore: string, uci: string): PracticeAttempt | null {
  const move = legalAnalysisMove(fenBefore, uci);
  if (!move) return null;
  const chess = new Chess(fenBefore);
  const played = chess.move({ from: move.from, to: move.to, promotion: move.promotion });
  if (!played) return null;
  return { uci: move.uci, san: played.san, fenBefore, fenAfter: chess.fen() };
}

/** Reject responses from a different position, attempt or malformed engine payload. */
export function verifiedPracticeQuality(quality: VariationMoveQuality | null | undefined, attempt: PracticeAttempt): VariationMoveQuality | null {
  if (!quality || quality.source !== 'variation' || quality.fen_before !== attempt.fenBefore
    || quality.fen_after !== attempt.fenAfter || quality.uci !== attempt.uci
    || !Number.isFinite(quality.centipawn_loss) || !Number.isFinite(quality.win_pct_drop)
    || !Number.isFinite(quality.depth_before) || quality.depth_before < 1
    || !Number.isSafeInteger(quality.scoring_version) || quality.scoring_version < 1
    || !Number.isFinite(quality.eval_before_cp) || !Number.isFinite(quality.eval_after_cp)
    || !Object.prototype.hasOwnProperty.call(CLASS_STYLE, quality.classification)
    || (quality.best_move_san !== null && typeof quality.best_move_san !== 'string')
    || !Array.isArray(quality.best_pv) || !quality.best_pv.every((san) => typeof san === 'string')
    || typeof quality.is_best !== 'boolean') return null;
  return quality;
}
