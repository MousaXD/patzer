import type { AnalyzedMove } from '../../types';
import type { EvalSample } from './evalGraphModel';
import type { ReplayPosition } from './reviewGamePositions';

interface TimelineMove {
  ply: number;
  san: string;
  classification?: string;
}

/** The saved PGN, not the number of evaluated moves, defines the full review.
 * Long or interrupted analyses can contain only a prefix of the real game.
 * Keep every legal move navigable, with genuinely missing scores left unknown.
 */
export function buildSavedReviewTimeline(
  positions: readonly ReplayPosition[],
  analyzed: readonly AnalyzedMove[] = [],
): { moves: TimelineMove[]; evals: EvalSample[] } {
  const moves: TimelineMove[] = [];
  const evals: EvalSample[] = [];
  for (let ply = 1; ply < positions.length; ply++) {
    const position = positions[ply]!;
    const match = analyzed[ply - 1];
    const scored = match?.ply === ply && match.uci === position.uci;
    moves.push({
      ply,
      san: position.san ?? '',
      ...(scored ? { classification: match.classification } : {}),
    });
    evals.push({
      ply,
      cp: scored ? (match.eval_after_cp ?? null) : null,
      // Mate provenance has the same ply/uci requirements as the evaluation.
      ...(scored && match?.mate_after != null ? { mate: match.mate_after } : {}),
    });
  }
  return { moves, evals };
}
