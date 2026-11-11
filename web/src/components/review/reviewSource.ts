/** A report must be tied to one engine generation and one monotonic game
 * source revision, not merely the PGN/move bytes. A -> B -> A followed by a
 * byte-identical reanalysis still invalidates all previously mounted prose.
 * Bookmarks, notes and clocks do not advance the game source revision. */
export function reviewSourceKey(gameId: number, pgn: string | undefined, analysis: {
  scoring_version?: number;
  source_hash?: string | null;
  source_revision?: number | null;
  analysis_generation?: number;
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
  depth: number;
  accuracy_white: number;
  accuracy_black: number;
} | null | undefined, analysisStale?: boolean, currentGameRevision?: number): string | null {
  if (!pgn || !analysis || analysisStale || !analysis.source_hash
    || !Number.isSafeInteger(currentGameRevision)
    || !Number.isSafeInteger(analysis.source_revision)
    || currentGameRevision !== analysis.source_revision
    || !Number.isSafeInteger(analysis.analysis_generation)
    || (analysis.analysis_generation ?? 0) < 1
    || !Number.isSafeInteger(analysis.scoring_version)) return null;
  return JSON.stringify([gameId, currentGameRevision, analysis.source_hash,
    analysis.source_revision, analysis.analysis_generation, analysis.scoring_version,
    pgn, analysis.moves_json, analysis.key_moments_json,
    analysis.phase_split_json, analysis.depth, analysis.accuracy_white, analysis.accuracy_black]);
}
