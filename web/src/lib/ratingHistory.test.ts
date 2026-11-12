import { describe, expect, it } from 'vitest';
import { condenseRatingHistory, ratingHistorySeries } from './ratingHistory';

describe('recorded rating history', () => {
  it('sorts actual recorded entries and computes change only from first to last', () => {
    const series = ratingHistorySeries({
      rapid: [
        { t: '2026-10-04T12:00:00Z', r: 1310 },
        { t: '2026-09-01T12:00:00Z', r: 1250 },
        { t: '2026-11-12T12:00:00Z', r: 1298 },
      ],
      bullet: [],
    });
    expect(series).toHaveLength(1);
    expect(series[0]?.points.map((p) => p.r)).toEqual([1250, 1310, 1298]);
    expect(series[0]?.change).toBe(48);
    expect(series[0]?.last.r).toBe(1298);
  });

  it('never claims a rating trend from one recorded entry', () => {
    const series = ratingHistorySeries({ blitz: [{ t: '2026-11-12T12:00:00Z', r: 1000 }] });
    expect(series[0]).toMatchObject({ key: 'blitz', change: null });
  });

  it('filters invalid dates and ratings rather than creating misleading lines', () => {
    const series = ratingHistorySeries({
      rapid: [{ t: 'bad-date', r: 1280 }, { t: '2026-11-12T12:00:00Z', r: NaN }],
      daily: [{ t: '2026-11-12T12:00:00Z', r: 1512 }],
    });
    expect(series.map((r) => r.key)).toEqual(['daily']);
    expect(series[0]?.change).toBeNull();
  });

  it('bounds large charts while preserving recorded endpoints, extremes and ordering', () => {
    const points = Array.from({ length: 6000 }, (_, i) => ({ t: new Date(Date.UTC(2010, 0, 1 + i)).toISOString(), r: 1200 + (i % 120) }));
    points[1321]!.r = 500;
    points[4499]!.r = 1900;
    const condensed = condenseRatingHistory(points);
    expect(condensed.length).toBeLessThanOrEqual(320);
    expect(condensed.length).toBeGreaterThan(30);
    expect(condensed[0]).toEqual(points[0]);
    expect(condensed.at(-1)).toEqual(points.at(-1));
    expect(condensed).toContainEqual(points[1321]);
    expect(condensed).toContainEqual(points[4499]);
    for (let i = 1; i < condensed.length; i++) {
      expect(Date.parse(condensed[i]!.t)).toBeGreaterThan(Date.parse(condensed[i - 1]!.t));
    }
    expect(points).toHaveLength(6000); // the source data was never modified
  });

  it('keeps small series intact without inserting artificial intermediate values', () => {
    const points = [{ t: '2026-01-01', r: 1000 }, { t: '2026-02-01', r: 1040 }];
    expect(condenseRatingHistory(points)).toBe(points);
  });
});
