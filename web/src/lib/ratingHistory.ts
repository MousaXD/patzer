/** Historical ratings from the server, not estimated Elo or model output. */
export interface RatingPoint { t: string; r: number }
export const RATING_TIME_CLASSES = ['rapid', 'blitz', 'bullet', 'daily'] as const;
export type RatingTimeClass = typeof RATING_TIME_CLASSES[number];

export interface RatingSeries {
  key: RatingTimeClass;
  points: RatingPoint[];
  first: RatingPoint;
  last: RatingPoint;
  /** Null for a single recorded rating: a one-point chart has no trend. */
  change: number | null;
}

/** Maximum individual SVG points per time-control line; summaries stay complete. */
export const RATING_PLOT_POINT_LIMIT = 320;

/**
 * Keep the original endpoints plus the minimum and maximum recorded values in
 * each consecutive time bucket. This reduces large SVG DOMs without changing
 * historical first/last values or hiding the recorded rating extremes.
 * Points are always returned in their original chronological order.
 */
export function condenseRatingHistory(points: RatingPoint[], limit = RATING_PLOT_POINT_LIMIT): RatingPoint[] {
  const cap = Math.max(4, Math.floor(limit));
  if (points.length <= cap) return points;
  const result: RatingPoint[] = [points[0]!];
  const interior = points.length - 2;
  const bucketCount = Math.floor((cap - 2) / 2);
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor((bucket * interior) / bucketCount);
    const end = 1 + Math.floor(((bucket + 1) * interior) / bucketCount);
    if (start >= end) continue;
    let low = start;
    let high = start;
    for (let i = start + 1; i < end; i++) {
      if (points[i]!.r < points[low]!.r) low = i;
      if (points[i]!.r > points[high]!.r) high = i;
    }
    result.push(points[Math.min(low, high)]!);
    if (low !== high) result.push(points[Math.max(low, high)]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

/** Ignore unusable records; keep every actual rating update, ordered by date. */
export function ratingHistorySeries(history: Record<string, RatingPoint[]>): RatingSeries[] {
  return RATING_TIME_CLASSES.flatMap((key) => {
    const points = (history[key] ?? [])
      .filter((p) => p && Number.isFinite(p.r) && Number.isFinite(Date.parse(p.t)))
      .slice()
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    if (!points.length) return [];
    const first = points[0]!;
    const last = points[points.length - 1]!;
    return [{ key, points, first, last, change: points.length > 1 ? last.r - first.r : null }];
  });
}
