import { describe, expect, it } from 'vitest';
import { displayableMate, formatReviewMate } from './reviewMateScore';

describe('source-bound Game Review mate labels', () => {
  it('prints the exact winning side and distance instead of a centipawn proxy', () => {
    expect(displayableMate(3)).toBe(3);
    expect(formatReviewMate(3)).toBe('M3');
    expect(displayableMate(-2)).toBe(-2);
    expect(formatReviewMate(-2)).toBe('−M2');
  });

  it('does not turn a terminal engine mate zero into a false Black mate', () => {
    // A checkmated side-to-move can be reported as mate 0 regardless of the
    // winning color. The signed white-perspective cp field is more truthful.
    expect(displayableMate(0)).toBeNull();
    expect(displayableMate(-0)).toBeNull();
    expect(formatReviewMate(0)).toBeNull();
  });

  it('rejects nonexistent, noninteger, and implausible mate annotations', () => {
    for (const value of [null, undefined, Infinity, NaN, 2.5, 2048, -2048]) {
      expect(displayableMate(value)).toBeNull();
      expect(formatReviewMate(value)).toBeNull();
    }
  });

  it('rejects cached mate counts that contradict their normalized white-perspective cp', () => {
    expect(displayableMate(3, 9970)).toBe(3);
    expect(displayableMate(-2, -9980)).toBe(-2);
    expect(displayableMate(3, -9970)).toBeNull();
    expect(displayableMate(3, 9980)).toBeNull();
    expect(displayableMate(-2, 9980)).toBeNull();
    expect(displayableMate(3, null)).toBe(3);
  });
});
