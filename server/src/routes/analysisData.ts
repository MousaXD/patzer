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
    const seenPly = new Set<number>();
    const valid: AnalyzedMove[] = [];
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
      const move = candidate as Record<string, unknown>;
      if (!Number.isSafeInteger(move.ply) || Number(move.ply) <= 0 ||
          seenPly.has(move.ply as number) ||
          typeof move.san !== 'string' || typeof move.fen_after !== 'string' ||
          typeof move.classification !== 'string' ||
          !CLASSIFICATIONS.has(move.classification as Classification) ||
          typeof move.centipawn_loss !== 'number' || !Number.isFinite(move.centipawn_loss) ||
          move.centipawn_loss < 0) continue;
      seenPly.add(move.ply as number);
      // Optional evaluations can be missing in older caches. Corrupt strings
      // must not be coerced into misleading numeric mistake classifications.
      const before = typeof move.eval_before_cp === 'number' && Number.isFinite(move.eval_before_cp)
        ? move.eval_before_cp : null;
      const after = typeof move.eval_after_cp === 'number' && Number.isFinite(move.eval_after_cp)
        ? move.eval_after_cp : null;
      valid.push(before === move.eval_before_cp && after === move.eval_after_cp
        ? candidate as AnalyzedMove
        : { ...candidate, eval_before_cp: before, eval_after_cp: after } as AnalyzedMove);
    }
    return valid;
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
          data.accuracy_white < 0 || data.accuracy_white > 100 ||
          typeof data.accuracy_black !== 'number' || !Number.isFinite(data.accuracy_black) ||
          data.accuracy_black < 0 || data.accuracy_black > 100) continue;
      // Phase-specific optional metrics are untouched; this route reads
      // only boundaries and accuracy fields.
      parsed[phase] = item as NonNullable<PhaseSplit[typeof phase]>;
    }
    return parsed;
  } catch { return null; }
}
