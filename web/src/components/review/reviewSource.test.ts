import { describe, expect, it } from 'vitest';
import { reviewSourceKey } from './reviewSource';

const first = { scoring_version: 10, source_hash: 'canonical-source-hash',
  source_revision: 0, analysis_generation: 1,
  moves_json: '[{"uci":"e2e4"},{"uci":"e7e5"}]', key_moments_json: '[]',
  phase_split_json: null, depth: 12, accuracy_white: 80, accuracy_black: 81 };
const pgn = '1. e4 e5 *';

describe('AI report source identity', () => {
  it('preserves a report through bookmark and notes updates', () => {
    expect(reviewSourceKey(1, pgn, first, false, 0)).toBe(reviewSourceKey(1, pgn, { ...first }, false, 0));
  });
  it('invalidates different PGNs even with the same ply count', () => {
    expect(reviewSourceKey(1, pgn, first, false, 0)).not.toBe(reviewSourceKey(1, '1. d4 d5 *', first, false, 0));
  });
  it('invalidates replaced analysis even with unchanged PGN and depth', () => {
    expect(reviewSourceKey(1, pgn, first, false, 0)).not.toBe(reviewSourceKey(1, pgn,
      { ...first, moves_json: '[{"uci":"d2d4"},{"uci":"d7d5"}]' }, false, 0));
    expect(reviewSourceKey(1, pgn, first, false, 0)).not.toBe(reviewSourceKey(1, pgn,
      { ...first, accuracy_white: 79 }, false, 0));
  });
  it('rejects stale or missing engine evidence and other games', () => {
    expect(reviewSourceKey(1, pgn, null, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, first, true, 0)).toBeNull();
    expect(reviewSourceKey(1, '', first, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, first, false, 0)).not.toBe(reviewSourceKey(2, pgn, first, false, 0));
    expect(reviewSourceKey(1, pgn, first)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...first, source_hash: null }, false, 0)).toBeNull();
    expect(reviewSourceKey(1, pgn, { ...first, analysis_generation: 0 }, false, 0)).toBeNull();
  });
  it('cannot resurrect old mounted prose after game source A -> B -> A', () => {
    const original = reviewSourceKey(1, pgn, first, false, 0);
    expect(original).not.toBeNull();
    expect(reviewSourceKey(1, pgn, first, true, 2)).toBeNull();
    const regenerated = { ...first, source_revision: 2, analysis_generation: 2 };
    const newKey = reviewSourceKey(1, pgn, regenerated, false, 2);
    expect(newKey).not.toBeNull();
    expect(newKey).not.toBe(original);
  });
  it('invalidates after force-reanalysis even with identical PGN and evaluations', () => {
    const original = reviewSourceKey(1, pgn, first, false, 0);
    const newer = reviewSourceKey(1, pgn, { ...first, analysis_generation: 2 }, false, 0);
    expect(newer).not.toBe(original);
    expect(reviewSourceKey(1, pgn, { ...first, source_revision: 2 }, false, 0)).toBeNull();
  });
});
