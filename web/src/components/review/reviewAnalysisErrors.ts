/** Give actionable feedback for the chess backend's analysis error contract.
 * The size limit is permanent, unlike 429/503 engine-capacity failures. */
export type ReviewAnalysisErrorKind = 'tooLarge' | 'invalidPgn' | 'busy' | 'unavailable';

/** Stable identity lets the UI translate an error without exposing arbitrary
 * backend messages, and without changing its retry/source semantics. */
export function reviewAnalysisErrorKind(error: unknown): ReviewAnalysisErrorKind {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  const code = error instanceof Error ? error.message : '';
  if (status === 413 || code === 'pgn_too_large') return 'tooLarge';
  if (status === 400 && code === 'invalid_pgn') return 'invalidPgn';
  if (status === 429) return 'busy';
  return 'unavailable';
}

/** Existing English helper retained for non-UI callers and regression tests. */
export function reviewAnalysisErrorMessage(error: unknown): string {
  const messages: Record<ReviewAnalysisErrorKind, string> = {
    tooLarge: 'This saved PGN exceeds the engine analysis limit (2,048 half-moves or 256 KB). You can still replay the game.',
    invalidPgn: 'The saved PGN contains invalid chess notation, so the engine cannot analyze it.',
    busy: 'Stockfish is busy with other analysis requests. Retry when an engine slot is free.',
    unavailable: 'Engine analysis could not finish. Retry when Stockfish is available.',
  };
  return messages[reviewAnalysisErrorKind(error)];
}
