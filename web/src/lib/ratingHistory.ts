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
