import { describe, expect, it } from 'vitest';
import { formatReviewEngineLineScore } from './reviewEngineLineScore';

describe('Game Review live engine-line score presentation', () => {
  it('preserves signed nonzero mate distances and ordinary White-perspective cp values', () => {
    expect(formatReviewEngineLineScore({ cp: null, mate: 3 })).toBe('#3');
    expect(formatReviewEngineLineScore({ cp: null, mate: -2 })).toBe('-#2');
    expect(formatReviewEngineLineScore({ cp: 45, mate: null })).toBe('+0.45');
    expect(formatReviewEngineLineScore({ cp: -125, mate: null })).toBe('−1.25');
    expect(formatReviewEngineLineScore({ cp: 0, mate: null })).toBe('0.00');
  });

  it('does not announce a Black mate from an unsigned terminal mate zero', () => {
    expect(formatReviewEngineLineScore({ cp: 0, mate: 0 })).toBe('—');
    expect(formatReviewEngineLineScore({ cp: null, mate: 0 })).toBe('—');
    expect(formatReviewEngineLineScore({ cp: null, mate: null })).toBe('—');
  });

  it('does not echo invalid fractional or infinite mate distances', () => {
    expect(formatReviewEngineLineScore({ cp: 30, mate: 1.5 })).toBe('+0.30');
    expect(formatReviewEngineLineScore({ cp: null, mate: Number.POSITIVE_INFINITY })).toBe('—');
  });

  it('normalizes side-to-move engine scores to the White-perspective Game Review convention', () => {
    expect(formatReviewEngineLineScore({ cp: 75, mate: null }, 'b')).toBe('−0.75');
    expect(formatReviewEngineLineScore({ cp: -80, mate: null }, 'b')).toBe('+0.80');
    expect(formatReviewEngineLineScore({ cp: null, mate: 2 }, 'b')).toBe('-#2');
    expect(formatReviewEngineLineScore({ cp: null, mate: -1 }, 'b')).toBe('#1');
    expect(formatReviewEngineLineScore({ cp: null, mate: 0 }, 'b')).toBe('—');
  });
});
