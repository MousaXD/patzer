import type { AnalyzedMove } from '../../types';
import type { ReplayPosition } from './reviewGamePositions';
import { moveNumberForPly, moveSideForPly } from './moveHistoryModel';

export interface PracticeCandidate {
  ply: number;
  side: 'white' | 'black';
  moveNumber: number;
}

const practiceErrors = new Set(['blunder', 'mistake', 'inaccuracy', 'miss']);

/** A spoiler-free list. Do not include played SAN, best move, score or PV in
 * labels, and never offer a partial/stale analysis from another PGN. */
export function practiceCandidates(
  positions: readonly ReplayPosition[],
  analysisMoves: readonly AnalyzedMove[] | undefined,
): PracticeCandidate[] {
  if (!analysisMoves?.length || !positions[0]) return [];
  const result: PracticeCandidate[] = [];
  for (const move of analysisMoves) {
    if (!practiceErrors.has(move.classification)
      || !Number.isSafeInteger(move.ply) || move.ply < 1
      || positions[move.ply - 1]?.fen !== move.fen_before
      || positions[move.ply]?.fen !== move.fen_after
      || positions[move.ply]?.uci !== move.uci) continue;
    result.push({ ply: move.ply, side: moveSideForPly(move.ply, positions[0].fen),
      moveNumber: moveNumberForPly(move.ply, positions[0].fen) });
  }
  return result;
}
