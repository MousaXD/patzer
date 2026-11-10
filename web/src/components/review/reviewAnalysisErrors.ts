/** Give actionable feedback for the chess backend's analysis error contract.
 * The size limit is permanent, unlike 429/503 engine-capacity failures. */
export function reviewAnalysisErrorMessage(error: unknown): string {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  const code = error instanceof Error ? error.message : '';
  if (status === 413 || code === 'pgn_too_large') {
    return 'This saved PGN exceeds the engine analysis limit (2,048 half-moves or 256 KB). You can still replay the game.';
  }
  if (status === 400 && code === 'invalid_pgn') {
    return 'The saved PGN contains invalid chess notation, so the engine cannot analyze it.';
  }
  if (status === 429) {
    return 'Stockfish is busy with other analysis requests. Retry when an engine slot is free.';
  }
  return 'Engine analysis could not finish. Retry when Stockfish is available.';
}
