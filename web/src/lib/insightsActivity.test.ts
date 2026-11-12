import { describe, expect, it } from 'vitest';
import { buildActivityGrid } from './insightsActivity';

describe('activity heatmap calendar', () => {
  it('uses complete Sunday–Saturday columns and only the 365 dates returned by the server', () => {
    const now = new Date('2026-11-12T01:15:00.000Z'); // Thursday, UTC
    const grid = buildActivityGrid([
      { day: '2026-11-12', games: 3, wins: 2 },
      { day: '2026-11-11', games: 1, wins: 0 },
      { day: '2025-11-12', games: 99, wins: 99 }, // outside the API window
    ], now);

    expect(grid.cells).toHaveLength(371);
    expect(grid.cells[0].day).toBe(0);
    expect(grid.cells[6].day).toBe(6);
    expect(grid.cells[7].day).toBe(0);
    expect(grid.cells.filter((c) => c.inRange)).toHaveLength(365);
    expect(grid.cells.find((c) => c.date === '2025-11-12')?.inRange).toBe(false);
    expect(grid.cells.find((c) => c.date === '2026-11-12')).toMatchObject({ games: 3, wins: 2, inRange: true, day: 4 });
    expect(grid.cells.find((c) => c.date === '2026-11-13')?.inRange).toBe(false);
    expect(grid.max).toBe(3);
  });

  it('does not shift a server UTC day when the local machine has a different date', () => {
    const result = buildActivityGrid([{ day: '2026-01-01', games: 2, wins: 1 }], new Date('2026-01-01T00:15:00Z'));
    expect(result.cells.find((c) => c.date === '2026-01-01')?.games).toBe(2);
    expect(result.cells.find((c) => c.date === '2025-12-31')?.games).toBe(0);
  });
});
