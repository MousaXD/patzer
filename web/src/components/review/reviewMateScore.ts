/** A mate zero identifies a terminal/checkmated side-to-move, not the
 * winning color. Its sign is lost, so it must not be interpreted as Black's
 * mate. Preserve the already normalized white-perspective cp fallback. */
export function displayableMate(mate: number | null | undefined, cp?: number | null): number | null {
  if (typeof mate !== 'number' || !Number.isSafeInteger(mate)
    || mate === 0 || Math.abs(mate) > 999) return null;
  // The current server writes its normalized cp proxy alongside the mate
  // count. If a cached report disagrees, don't publish a precise mate claim
  // from contradictory evidence (but keep the existing cp-only fallback).
  const equivalentCp = mate > 0 ? 10000 - mate * 10 : -10000 - mate * 10;
  if (cp != null && (!Number.isFinite(cp) || cp !== equivalentCp)) return null;
  return mate;
}

/** White-perspective mate notation for the Game Review score header. The
 * matching EvalBar exposes the mating side and count in its accessible name. */
export function formatReviewMate(mate: number | null | undefined): string | null {
  const score = displayableMate(mate);
  if (score === null) return null;
  return score > 0 ? `M${score}` : `−M${-score}`;
}
