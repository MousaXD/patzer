/** White-perspective display for FEN-verified live engine lines. Both supported
 * engine adapters return cp/mate from the side-to-move perspective, while
 * the rest of Game Review uses White's. The FEN used for verification tells
 * us whether to invert the line score; board orientation never changes it.
 * Mate zero is an unsigned terminal marker, not a Black mating win. */
export function formatReviewEngineLineScore({ cp, mate }: {
  cp: number | null;
  mate: number | null;
}, sideToMove: 'w' | 'b' = 'w'): string {
  if (mate === 0) return '—';
  const signToWhite = sideToMove === 'b' ? -1 : 1;
  if (mate != null && Number.isSafeInteger(mate) && Math.abs(mate) <= 999) {
    const whiteMate = mate * signToWhite;
    return whiteMate > 0 ? `#${whiteMate}` : `-#${-whiteMate}`;
  }
  if (cp === null || !Number.isFinite(cp)) return '—';
  const whiteCp = cp * signToWhite;
  if (whiteCp >= 9000) return '#';
  if (whiteCp <= -9000) return '-#';
  const sign = whiteCp > 0 ? '+' : whiteCp < 0 ? '−' : '';
  return `${sign}${(Math.abs(whiteCp) / 100).toFixed(2)}`;
}
