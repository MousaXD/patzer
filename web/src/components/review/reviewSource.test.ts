import { describe, expect, it } from 'vitest';
import { reviewSourceKey } from './reviewSource';

const first = { moves_json: '[{"uci":"e2e4"},{"uci":"e7e5"}]', key_moments_json: '[]',
  phase_split_json: null, depth: 12, accuracy_white: 80, accuracy_black: 81 };
const pgn = '1. e4 e5 *';

describe('AI report source identity', () => {
  it('preserves a report through bookmark and notes updates', () => {
    expect(reviewSourceKey(1, pgn, first)).toBe(reviewSourceKey(1, pgn, { ...first }));
  });
  it('invalidates different PGNs even with the same ply count', () => {
    expect(reviewSourceKey(1, pgn, first)).not.toBe(reviewSourceKey(1, '1. d4 d5 *', first));
  });
  it('invalidates replaced analysis even with unchanged PGN and depth', () => {
    expect(reviewSourceKey(1, pgn, first)).not.toBe(reviewSourceKey(1, pgn,
      { ...first, moves_json: '[{"uci":"d2d4"},{"uci":"d7d5"}]' }));
    expect(reviewSourceKey(1, pgn, first)).not.toBe(reviewSourceKey(1, pgn,
      { ...first, accuracy_white: 79 }));
  });
  it('rejects stale or missing engine evidence and other games', () => {
    expect(reviewSourceKey(1, pgn, null)).toBeNull();
    expect(reviewSourceKey(1, pgn, first, true)).toBeNull();
    expect(reviewSourceKey(1, '', first)).toBeNull();
    expect(reviewSourceKey(1, pgn, first)).not.toBe(reviewSourceKey(2, pgn, first));
  });
  it('rejects A -> B -> A resurrection using authoritative revisions even with identical PGN and analysis contents', () => {
    const analyzedAtA = { ...first, scoring_version: 9, source_revision: 0,
      analysis_generation: 1, source_hash: 'a'.repeat(64) };
    const original = reviewSourceKey(1, pgn, analyzedAtA, false, 0);
    expect(original).not.toBeNull();
    expect(reviewSourceKey(1, pgn, analyzedAtA, false, 2)).toBeNull();
    const reanalyzedAtA = { ...analyzedAtA, source_revision: 2, analysis_generation: 2 };
    const updated = reviewSourceKey(1, pgn, reanalyzedAtA, false, 2);
    expect(updated).not.toBeNull();
    expect(updated).not.toBe(original);
  });
  it('distinguishes a recomputation of identical chess evidence without source changes', () => {
    const original = { ...first, source_revision: 4, analysis_generation: 7,
      source_hash: 'f'.repeat(64) };
    expect(reviewSourceKey(1, pgn, original, false, 4)).not.toBe(reviewSourceKey(1, pgn,
      { ...original, analysis_generation: 8 }, false, 4));
  });
  it('fails closed for missing, malformed or partially populated authoritative provenance', () => {
    const old = { ...first, source_revision: 0, analysis_generation: 1,
      source_hash: 'a'.repeat(64) };
    expect(reviewSourceKey(1, pgn, old, false, undefined)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...old, analysis_generation: null }, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...old, source_revision: null }, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...old, source_hash: null }, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...old, source_hash: 'invalid' }, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, old, true, 0)).toBeNull();
  });
});
