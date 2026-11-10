import { describe, expect, it } from 'vitest';
import { buildEvalGraphPoints, evalPlyAtRatio, scoredEvalSegments } from './evalGraphModel';

describe('Game Review evaluation timeline', () => {
  const evals = [
    { ply: 1, cp: 35 },
    { ply: 2, cp: null },
    { ply: 3, cp: -120 },
    { ply: 4, cp: 10000 },
  ];

  it('treats the opening as ply zero, including clicks and keyboard endpoints', () => {
    expect(evalPlyAtRatio(evals, 0)).toBe(0);
    expect(evalPlyAtRatio(evals, 0.01)).toBe(0);
    expect(evalPlyAtRatio(evals, 0.25)).toBe(1);
    expect(evalPlyAtRatio(evals, 1)).toBe(4);
    expect(evalPlyAtRatio(evals, -2)).toBe(0);
    expect(evalPlyAtRatio(evals, Number.NaN)).toBe(0);
    expect(evalPlyAtRatio([], 1)).toBe(0);
  });

  it('does not fabricate a balanced eval for unscored moves', () => {
    const points = buildEvalGraphPoints(evals);
    expect(points[1]?.y).toBeNull();
    expect(points[0]?.x).toBe(25);
    expect(points[3]?.x).toBe(100);
    expect(scoredEvalSegments(points).map((segment) => segment.map((p) => p.ply)))
      .toEqual([[1], [3, 4]]);
  });

  it('uses each move’s actual ply even with sparse sample numbering', () => {
    expect(evalPlyAtRatio([{ ply: 6, cp: 0 }, { ply: 9, cp: 100 }], 1)).toBe(9);
  });
});
