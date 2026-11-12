/** Score display for FEN-verified live engine lines. Unlike the stored-game
 * scorer, multi-PV scores are reported directly by the live engine; a mate 0
 * is a terminal marker with no reliable winning-side sign. Never render it
 * as Black's "mate in 0" or a fabricated draw. */
export function formatReviewEngineLineScore({ cp, mate }: {
  cp: number | null;
  mate: number | null;
}): string {
  if (mate === 0) return '—';
  if (mate != null && Number.isSafeInteger(mate) && Math.abs(mate) <= 999) {
    return mate > 0 ? `#${mate}` : `-#${-mate}`;
  }
  if (cp === null || !Number.isFinite(cp)) return '—';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}
