/** A report is evidence about a specific saved game and engine run, not just a
 * game ID. Avoid timestamps/notes/bookmarks: they do not change chess facts.
 * The whole PGN (not its length) and saved analysis contents are compared.
 * A future backend source token should supersede this local comparison at the
 * API boundary, since a prose-only GET cannot prove its own provenance. */
export function reviewSourceKey(gameId: number, pgn: string | undefined, analysis: {
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
  depth: number;
  accuracy_white: number;
  accuracy_black: number;
} | null | undefined, analysisStale?: boolean): string | null {
  if (!pgn || !analysis || analysisStale) return null;
  return JSON.stringify([gameId, pgn, analysis.moves_json, analysis.key_moments_json,
    analysis.phase_split_json, analysis.depth, analysis.accuracy_white, analysis.accuracy_black]);
}
