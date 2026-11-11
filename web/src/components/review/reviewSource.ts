/** A report is evidence about a specific game and engine generation, not just
 * the PGN or number of plies. The revision handles A -> B -> A changes even
 * when the reanalyzed chess facts are byte-for-byte identical. Harmless notes
 * and bookmarks must not invalidate the source. */
export interface ReportAnalysisSource {
  source_revision?: number | null;
  analysis_generation?: number | null;
  source_hash?: string | null;
  scoring_version?: number | null;
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
  depth: number;
  accuracy_white: number;
  accuracy_black: number;
}

export function reviewSourceKey(gameId: number, pgn: string | undefined,
  analysis: ReportAnalysisSource | null | undefined, analysisStale?: boolean,
  gameSourceRevision?: number | null): string | null {
  if (!pgn || !analysis || analysisStale) return null;
  // Agent A's authoritative source fields are delivered on GET /api/games/:id.
  // Reject any partial/mismatched provenance rather than treating it as a
  // legacy record. A genuine new engine run advances analysis_generation.
  const hasProvenance = gameSourceRevision !== undefined || analysis.source_revision !== undefined
    || analysis.analysis_generation !== undefined || analysis.source_hash !== undefined;
  if (hasProvenance && (!Number.isSafeInteger(gameSourceRevision) || gameSourceRevision! < 0
    || !Number.isSafeInteger(analysis.source_revision)
    || analysis.source_revision !== gameSourceRevision
    || !Number.isSafeInteger(analysis.analysis_generation) || analysis.analysis_generation! < 1
    || typeof analysis.source_hash !== 'string'
    || !/^[0-9a-f]{64}$/.test(analysis.source_hash))) return null;
  return JSON.stringify([gameId, pgn, analysis.moves_json, analysis.key_moments_json,
    analysis.phase_split_json, analysis.depth, analysis.accuracy_white, analysis.accuracy_black,
    analysis.scoring_version ?? null,
    hasProvenance ? [gameSourceRevision, analysis.source_revision, analysis.analysis_generation,
      analysis.source_hash] : null]);
}
