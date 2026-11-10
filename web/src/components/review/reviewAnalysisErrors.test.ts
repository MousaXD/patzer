import { describe, expect, it } from 'vitest';
import { reviewAnalysisErrorMessage } from './reviewAnalysisErrors';

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

describe('Game Review engine error recovery guidance', () => {
  it('does not suggest endless retries for a PGN that exceeds server limits', () => {
    expect(reviewAnalysisErrorMessage(httpError(413, 'pgn_too_large')))
      .toContain('2,048 half-moves');
  });
  it('distinguishes malformed PGNs from temporarily busy engines', () => {
    expect(reviewAnalysisErrorMessage(httpError(400, 'invalid_pgn'))).toContain('invalid chess notation');
    expect(reviewAnalysisErrorMessage(httpError(429, 'engine_busy'))).toContain('engine slot');
  });
  it('keeps unexpected failures recoverable without exposing server internals', () => {
    expect(reviewAnalysisErrorMessage(httpError(503, 'internal path /tmp/secrets')))
      .toBe('Engine analysis could not finish. Retry when Stockfish is available.');
  });
});
