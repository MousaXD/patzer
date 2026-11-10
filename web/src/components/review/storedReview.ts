import type { AnalyzedMove, KeyMomentSummary, PhaseSplit } from '../../types';

/** Decode cached game analysis defensively. Storage may contain a partial or
 * legacy record; bad data must not crash the review and must never be rendered
 * as a real chess move or a fabricated evaluation. */
export interface StoredReviewJson {
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
}

export interface DecodedReviewJson {
  moves: AnalyzedMove[];
  key_moments: KeyMomentSummary[];
  phase_split: PhaseSplit | null;
}

/** A broken cache must not be served again by a normal cached analysis call. */
export function needsFreshReviewAnalysis(
  cached: StoredReviewJson | null | undefined,
  decoded: DecodedReviewJson | null,
): boolean {
  return cached != null && decoded === null;
}

export function decodeStoredReviewJson(data: StoredReviewJson): DecodedReviewJson | null {
  try {
    const moves: unknown = JSON.parse(data.moves_json);
    const moments: unknown = data.key_moments_json ? JSON.parse(data.key_moments_json) : [];
    const phases: unknown = data.phase_split_json ? JSON.parse(data.phase_split_json) : null;
    if (!Array.isArray(moves) || !Array.isArray(moments)) return null;
    if (phases !== null && (typeof phases !== 'object' || Array.isArray(phases))) return null;

    if (!moves.every((m: unknown, index: number) => {
      if (!m || typeof m !== 'object') return false;
      const value = m as Record<string, unknown>;
      return value.ply === index + 1
        && typeof value.san === 'string'
        && typeof value.uci === 'string'
        && typeof value.fen_before === 'string'
        && typeof value.fen_after === 'string'
        && typeof value.classification === 'string'
        && Array.isArray(value.best_pv)
        && (value.eval_before_cp === null || typeof value.eval_before_cp === 'number')
        && (value.eval_after_cp === null || typeof value.eval_after_cp === 'number');
    })) return null;
    if (!moments.every((m: unknown) => m !== null && typeof m === 'object'
      && Number.isInteger((m as Record<string, unknown>).ply))) return null;

    return {
      moves: moves as AnalyzedMove[],
      key_moments: moments as KeyMomentSummary[],
      phase_split: phases as PhaseSplit | null,
    };
  } catch {
    return null;
  }
}
