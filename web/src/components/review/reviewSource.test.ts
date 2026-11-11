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
});
