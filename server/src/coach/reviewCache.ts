import type Database from 'better-sqlite3';
import type { Audience, Language } from '../types.js';
import { REVIEW_PROSE_VERSION } from './review.js';
import { reviewSourceDigest } from './reviewSource.js';

/** Immutable source evidence captured before an asynchronous report begins.
 * The report must not be cached against a different analysis, score, game
 * record or newer independently generated review. No migrations are needed. */
export interface ReviewCacheSource {
  created_at?: string;
  source_hash?: string | null;
  source_revision?: number | null;
  analysis_generation?: number | null;
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
  prose_version: number;
  prose_lang: string | null;
  prose_audience: string | null;
}

export interface ReviewCacheGame {
  pgn: string;
  user_color: 'white' | 'black' | null;
  user_id: number;
  result?: string | null;
  start_fen?: string | null;
  opponent_rating_before?: number | null;
  user_rd_before?: number | null;
  current_source_revision?: number;
}

/** Read-only LLM watchdog. Checks the exact same evidence as the final CAS,
 * plus current profile settings. A bookmark/notes write does not abort work. */
export function isReviewSourceUnchanged(
  database: Database.Database,
  gameId: number,
  source: ReviewCacheSource,
  game: ReviewCacheGame,
  language: Language,
  audience: Audience,
): boolean {
  const current = database.prepare(`
    SELECT a.*, g.pgn, g.user_color, g.result, g.user_id,
           g.start_fen, g.opponent_rating_before, g.user_rd_before,
           g.source_revision AS current_source_revision,
           p.language, p.audience
      FROM analyses a JOIN games g ON g.id = a.game_id
      JOIN profiles p ON p.user_id = g.user_id
     WHERE g.id = ? AND g.user_id = ?
  `).get(gameId, game.user_id) as (ReviewCacheSource & ReviewCacheGame & {
    language: Language; audience: Audience;
  }) | undefined;
  return !!current && Boolean(source.source_hash)
    && Number.isSafeInteger(source.source_revision)
    && Number.isSafeInteger(source.analysis_generation)
    && (source.analysis_generation ?? 0) > 0
    && current.current_source_revision === game.current_source_revision
    && current.current_source_revision === source.source_revision
    && current.source_hash === source.source_hash
    && current.source_revision === source.source_revision
    && current.analysis_generation === source.analysis_generation
    && current.language === language && current.audience === audience
    && current.prose_json === source.prose_json && current.prose_version === source.prose_version
    && current.prose_lang === source.prose_lang && current.prose_audience === source.prose_audience
    && (source.created_at === undefined || current.created_at === source.created_at)
    && (!Object.hasOwn(game, 'result') || current.result === game.result)
    && reviewSourceDigest(current, current, gameId) === reviewSourceDigest(game, source, gameId);
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
  withProvenance = false,
): boolean {
  // Never allow a report write for legacy/unversioned analysis evidence. The
  // game-source revision and analysis generation must be nonzero/valid and
  // must agree with the snapshot captured before generating prose.
  if (!source.source_hash || !Number.isSafeInteger(source.source_revision)
    || !Number.isSafeInteger(source.analysis_generation)
    || (source.analysis_generation ?? 0) < 1
    || game.current_source_revision !== source.source_revision) return false;
  const payload = withProvenance && review && typeof review === 'object' && !Array.isArray(review)
    ? { ...review, accuracy_model_version: source.scoring_version,
      source_integrity: reviewSourceDigest(game, source, gameId) }
    : review;
  const changed = database.prepare(`
    UPDATE analyses
       SET prose_json = ?, prose_version = ?, prose_lang = ?, prose_audience = ?
     WHERE game_id = ?
       AND scoring_version = ? AND depth = ? AND moves_json = ?
       AND source_hash IS ? AND source_revision IS ? AND analysis_generation = ?
       AND key_moments_json IS ? AND phase_split_json IS ?
       AND accuracy_white IS ? AND accuracy_black IS ?
       AND estimated_elo_white IS ? AND estimated_elo_black IS ?
       AND performance_white IS ? AND performance_black IS ?
       AND opening_eco IS ? AND opening_name IS ?
       AND prose_json IS ? AND prose_version = ?
       AND prose_lang IS ? AND prose_audience IS ?
       AND (? = 0 OR created_at IS ?)
       AND EXISTS (
         SELECT 1 FROM games g
          WHERE g.id = analyses.game_id AND g.user_id = ?
            AND g.pgn IS ? AND g.user_color IS ?
            AND g.source_revision = ? AND g.start_fen IS ?
            AND g.opponent_rating_before IS ? AND g.user_rd_before IS ?
            AND (? = 0 OR g.result IS ?)
       )
       AND EXISTS (
         SELECT 1 FROM profiles p
          WHERE p.user_id = ? AND p.language = ? AND p.audience = ?
       )
  `).run(
    JSON.stringify(payload), REVIEW_PROSE_VERSION, language, audience,
    gameId, source.scoring_version, source.depth, source.moves_json,
    source.source_hash, source.source_revision, source.analysis_generation,
    source.key_moments_json, source.phase_split_json,
    source.accuracy_white, source.accuracy_black,
    source.estimated_elo_white, source.estimated_elo_black,
    source.performance_white, source.performance_black,
    source.opening_eco, source.opening_name,
    source.prose_json, source.prose_version,
    source.prose_lang, source.prose_audience,
    Number(source.created_at !== undefined), source.created_at ?? null,
    game.user_id, game.pgn, game.user_color,
    game.current_source_revision, game.start_fen ?? null,
    game.opponent_rating_before ?? null, game.user_rd_before ?? null,
    Number(Object.hasOwn(game, 'result')), game.result ?? null,
    game.user_id, language, audience,
  );
  return changed.changes === 1;
}
