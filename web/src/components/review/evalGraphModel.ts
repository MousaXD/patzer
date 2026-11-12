/** Pure Game Review graph geometry. The initial position is ply 0 and is
 * navigable, but it must never be assigned an invented 0.00 evaluation. */
export interface EvalSample {
  ply: number;
  cp: number | null;
  /** Source-matched, White-perspective mate distance. Never infer one from cp. */
  mate?: number | null;
}
export interface EvalPoint extends EvalSample { x: number; y: number | null }

function winShare(cp: number): number {
  if (cp >= 9000) return 1;
  if (cp <= -9000) return 0;
  const value = 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
  return Math.max(0.03, Math.min(0.97, 0.5 + 0.5 * value));
}

export function buildEvalGraphPoints(evals: readonly EvalSample[]): EvalPoint[] {
  return evals.map((sample, index) => ({
    ...sample,
    x: ((index + 1) / evals.length) * 100,
    y: sample.cp == null ? null : (1 - winShare(sample.cp)) * 100,
  }));
}

/** Missing evaluations are gaps, not balanced positions or interpolated data. */
export function scoredEvalSegments(points: readonly EvalPoint[]): EvalPoint[][] {
  const segments: EvalPoint[][] = [];
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    if (point.y === null) continue;
    if (segments.length === 0 || index === 0 || points[index - 1]!.y === null) {
      segments.push([]);
    }
    segments[segments.length - 1]!.push(point);
  }
  return segments;
}

/** Graph click/touch/keyboard navigation supports ply zero. */
export function evalPlyAtRatio(evals: readonly EvalSample[], ratio: number): number {
  if (!evals.length) return 0;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const index = Math.round(clamped * evals.length);
  return index === 0 ? 0 : evals[index - 1]!.ply;
}
