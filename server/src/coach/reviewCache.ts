import type Database from 'better-sqlite3';
import type { Audience, Language } from '../types.js';
import { REVIEW_PROSE_VERSION } from './review.js';

/** Immutable source evidence captured before an asynchronous report begins.
 * The report must not be cached against a different analysis, score, game
 * record or newer independently generated review. No migrations are needed. */
export interface ReviewCacheSource {
  depth: number;
  scoring_version: number;
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
  accuracy_white: number | null;
  accuracy_black: number | null;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  prose_json: string | null;
}

export interface ReviewCacheGame {
  pgn: string;
  user_color: 'white' | 'black' | null;
  user_id: number;
}

/** A single SQLite statement is an atomic compare-and-swap, including under
 * multiple app processes. The JSON is never persisted if its evidence moved.
 * An empty result is an expected stale-generation outcome, not a DB error. */
export function saveReviewIfFresh(
  database: Database.Database,
  gameId: number,
  source: ReviewCacheSource,
  game: ReviewCacheGame,
  review: unknown,
  language: Language,
  audience: Audience,
): boolean {
  const changed = database.prepare(`
    UPDATE analyses
       SET prose_json = ?, prose_version = ?, prose_lang = ?, prose_audience = ?
     WHERE game_id = ?
       AND scoring_version = ? AND depth = ? AND moves_json = ?
       AND key_moments_json IS ? AND phase_split_json IS ?
       AND accuracy_white IS ? AND accuracy_black IS ?
       AND estimated_elo_white IS ? AND estimated_elo_black IS ?
       AND performance_white IS ? AND performance_black IS ?
       AND opening_eco IS ? AND opening_name IS ?
       AND prose_json IS ?
       AND EXISTS (
         SELECT 1 FROM games g
          WHERE g.id = analyses.game_id AND g.user_id = ?
            AND g.pgn IS ? AND g.user_color IS ?
       )
  `).run(
    JSON.stringify(review), REVIEW_PROSE_VERSION, language, audience,
    gameId, source.scoring_version, source.depth, source.moves_json,
    source.key_moments_json, source.phase_split_json,
    source.accuracy_white, source.accuracy_black,
    source.estimated_elo_white, source.estimated_elo_black,
    source.performance_white, source.performance_black,
    source.opening_eco, source.opening_name,
    source.prose_json,
    game.user_id, game.pgn, game.user_color,
  );
  return changed.changes === 1;
}
