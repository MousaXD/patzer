/** Defensive decoding of persisted engine metrics for analytics routes.
 * Corrupt or obsolete cached JSON must not turn the entire Insights API into a 500.
 */
import type { AnalyzedMove, Classification, GamePhase, PhaseSplit } from '../types.js';

const CLASSIFICATIONS = new Set<Classification>([
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced',
  'inaccuracy', 'mistake', 'blunder', 'miss',
]);

export function readAnalysisMoves(raw: string): AnalyzedMove[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((candidate): candidate is AnalyzedMove => {
      if (!candidate || typeof candidate !== 'object') return false;
      const move = candidate as Record<string, unknown>;
      return Number.isSafeInteger(move.ply) && Number(move.ply) > 0 &&
        typeof move.san === 'string' && typeof move.fen_after === 'string' &&
        typeof move.classification === 'string' &&
        CLASSIFICATIONS.has(move.classification as Classification) &&
        typeof move.centipawn_loss === 'number' && Number.isFinite(move.centipawn_loss);
    });
  } catch { return []; }
}

export function readPhaseSplit(raw: string | null): PhaseSplit | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const parts = value as Record<string, unknown>;
    const parsed: PhaseSplit = { opening: null, middlegame: null, endgame: null };
    for (const phase of ['opening', 'middlegame', 'endgame'] as GamePhase[]) {
      const item = parts[phase];
      if (item == null) continue;
      if (typeof item !== 'object' || Array.isArray(item)) continue;
      const data = item as Record<string, unknown>;
      if (!Number.isSafeInteger(data.from_ply) || !Number.isSafeInteger(data.to_ply) ||
          Number(data.from_ply) < 1 || Number(data.to_ply) < Number(data.from_ply) ||
          typeof data.accuracy_white !== 'number' || !Number.isFinite(data.accuracy_white) ||
          typeof data.accuracy_black !== 'number' || !Number.isFinite(data.accuracy_black)) continue;
      // Phase-specific optional metrics are untouched; this route reads
      // only boundaries and accuracy fields.
      parsed[phase] = item as NonNullable<PhaseSplit[typeof phase]>;
    }
    return parsed;
  } catch { return null; }
}
