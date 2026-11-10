import { describe, expect, it } from 'vitest';
import { AnalysisAdmission, AnalysisResultCache } from '../src/chess/analysisAgentWork.js';

describe('analysis-agent engine admission', () => {
  it('never exceeds the global slot count and releases exactly once', () => {
    const slots = new AnalysisAdmission(2);
    const first = slots.tryAcquire();
    const second = slots.tryAcquire();
    expect(first).toBeTypeOf('function');
    expect(second).toBeTypeOf('function');
    expect(slots.inUse).toBe(2);
    expect(slots.tryAcquire()).toBeNull();
    first!();
    first!(); // closing an aborted request twice cannot release another job
    expect(slots.inUse).toBe(1);
    const third = slots.tryAcquire();
    expect(third).not.toBeNull();
    second!();
    third!();
    expect(slots.inUse).toBe(0);
  });

  it('rejects invalid capacity configurations', () => {
    expect(() => new AnalysisAdmission(0)).toThrow(RangeError);
    expect(() => new AnalysisAdmission(1.5)).toThrow(RangeError);
  });
});

describe('analysis-agent result cache', () => {
  it('reuses exact keys, refreshes LRU, and evicts the least recent', () => {
    let now = 1000;
    const cache = new AnalysisResultCache<number>(2, 100, () => now);
    cache.set('fen|16|1', 1);
    cache.set('fen|16|3', 3);
    expect(cache.get('fen|16|1')).toBe(1);
    cache.set('fen|18|1', 18);
    expect(cache.get('fen|16|3')).toBeUndefined();
    expect(cache.get('fen|16|1')).toBe(1);
    expect(cache.get('fen|18|1')).toBe(18);
    now = 1100;
    expect(cache.get('fen|16|1')).toBeUndefined();
    expect(cache.get('fen|18|1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('does not extend TTL on reads, or allow unbounded entries', () => {
    let now = 0;
    const cache = new AnalysisResultCache<string>(3, 10, () => now);
    for (let i = 0; i < 100; i++) cache.set(String(i), String(i));
    expect(cache.size).toBe(3);
    now = 11;
    expect(cache.get('99')).toBeUndefined();
    expect(() => new AnalysisResultCache(0)).toThrow(RangeError);
  });
});
