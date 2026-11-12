import { describe, expect, it } from 'vitest';
import { ratingHistorySeries } from './ratingHistory';

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
});
