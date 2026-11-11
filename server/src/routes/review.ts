import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { llmConfigured } from '../coach/llm.js';
import { buildGameReview, isMarkedReviewScoringStale, reviewCacheKey, type GameReview } from '../coach/review.js';
import { isReviewSourceUnchanged, saveReviewIfFresh, type ReviewCacheSource } from '../coach/reviewCache.js';
import { checkReviewAnalysisSource, reviewSourceDigest } from '../coach/reviewSource.js';
import type { AnalysisResult, AnalyzedMove, KeyMomentSummary, PhaseSplit } from '../types.js';

const router = new Hono();
router.use('*', requireAuth);

interface AnalysisRow extends ReviewCacheSource {
  accuracy_white: number;
  accuracy_black: number;
  prose_version: number;
  prose_lang: string | null;
  prose_audience: string | null;
}

interface GameRow {
  pgn: string;
  user_color: 'white' | 'black' | null;
  user_id: number;
  result: string | null;
}

interface JoinedRow extends GameRow, AnalysisRow { game_id: number | null }

// One SQLite statement observes the game and analysis in the SAME read
// snapshot, not a PGN from before a reanalysis and evidence from after it.
function loadReviewRow(id: number, userId: number): (GameRow & Partial<AnalysisRow> & { game_id: number | null }) | undefined {
  return db.prepare(`SELECT g.pgn, g.user_color, g.user_id, g.result, a.*
    FROM games g LEFT JOIN analyses a ON a.game_id = g.id
    WHERE g.id = ? AND g.user_id = ?`).get(id, userId) as JoinedRow | undefined;
}

const staleProse = (reason: string, action: 'reanalyze_game' | 'regenerate_report') => ({
  review: null, stale: true, error: 'review_source_stale', reason, action,
  message: action === 'reanalyze_game'
    ? 'The game or its analysis changed. Analyze the game again before writing a report.'
    : 'This written report no longer matches your game or settings. Generate a new report.',
});

function rowToAnalysis(row: AnalysisRow): AnalysisResult {
  return {
    depth: row.depth,
    accuracy_white: row.accuracy_white,
    accuracy_black: row.accuracy_black,
    estimated_elo_white: row.estimated_elo_white,
    estimated_elo_black: row.estimated_elo_black,
    performance_white: row.performance_white,
    performance_black: row.performance_black,
    opening_eco: row.opening_eco,
    opening_name: row.opening_name,
    key_moments: row.key_moments_json ? (JSON.parse(row.key_moments_json) as KeyMomentSummary[]) : [],
    phase_split: row.phase_split_json ? (JSON.parse(row.phase_split_json) as PhaseSplit) : null,
    moves: JSON.parse(row.moves_json) as AnalyzedMove[],
  };
}

router.get('/:id/review', (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = loadReviewRow(id, user.id);
  if (!game) return c.json({ error: 'not_found' }, 404);
  if (game.game_id === null) return c.json({ review: null });
  const row = game as JoinedRow;
  const issue = checkReviewAnalysisSource(game, row);
  if (issue) return c.json(staleProse(issue, 'reanalyze_game'));
  if (!row.prose_json) return c.json({ review: null });
  // Validate the cached prose was generated for the same lang+audience+version.
  const wantKey = reviewCacheKey({ language: user.profile.language, audience: user.profile.audience });
  const haveKey = `${row.prose_version}|${row.prose_lang ?? ''}|${row.prose_audience ?? ''}`;
  if (wantKey !== haveKey) return c.json(staleProse('profile_or_prose_version_changed', 'regenerate_report'));
  try {
    const review = JSON.parse(row.prose_json) as GameReview;
    const saved = review as GameReview & { source_integrity?: string; accuracy_model_version?: number };
    if (isMarkedReviewScoringStale(review, row.scoring_version)
      || saved.accuracy_model_version !== row.scoring_version
      || saved.version !== row.prose_version
      || saved.language !== user.profile.language || saved.audience !== user.profile.audience
      || saved.source_integrity !== reviewSourceDigest(game, row, id)) {
      return c.json(staleProse('unverifiable_or_changed_source', 'regenerate_report'));
    }
    return c.json({ review });
  } catch {
    return c.json(staleProse('malformed_cached_review', 'regenerate_report'));
  }
});

router.post('/:id/review', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const game = loadReviewRow(id, user.id);
  if (!game) return c.json({ error: 'not_found' }, 404);
  if (game.game_id === null) return c.json({ error: 'analysis_required', action: 'analyze_game' }, 409);
  const row = game as JoinedRow;
  const issue = checkReviewAnalysisSource(game, row);
  if (issue) {
    return c.json({ error: 'analysis_source_stale', stale: true, reason: issue,
      action: 'reanalyze_game', message: 'The saved engine analysis does not match this game. Analyze again first.' }, 409);
  }

  const analysis = rowToAnalysis(row);
  const userColor = game.user_color ?? 'white';
  const language = user.profile.language;
  const audience = user.profile.audience;

  return streamSSE(c, async (stream) => {
    const controller = new AbortController();
    const onRequestAbort = () => controller.abort();
    c.req.raw.signal.addEventListener('abort', onRequestAbort, { once: true });
    stream.onAbort(onRequestAbort);
    let obsolete = false;
    const assertStillCurrent = () => {
      if (controller.signal.aborted) return false;
      try {
        if (isReviewSourceUnchanged(db, id, row, game, language, audience)) return true;
      } catch { /* DB became unavailable: never continue on unverified evidence */ }
      obsolete = true;
      controller.abort('review_source_changed');
      return false;
    };
    // A long-running LLM call can otherwise burn minutes on an obsolete game.
    // Progress callbacks alone cannot interrupt one still-active model call.
    const watch = setInterval(() => { assertStillCurrent(); }, 750);
    watch.unref();
    try {
      const review = await buildGameReview({
        pgn: game.pgn, analysis, language, audience, userColor, userId: user.id,
        llmEnabled: llmConfigured(),
        signal: controller.signal,
        onProgress: async (ev) => {
          if (!assertStillCurrent()) throw new Error('review_source_changed');
          await stream.writeSSE({ event: 'progress', data: JSON.stringify(ev) });
        },
      });
      controller.signal.throwIfAborted();
      if (!assertStillCurrent()) throw new Error('review_source_changed');
      // A re-analysis, score migration, game update or newer report may have
      // arrived while the model was generating. Never overwrite its cache.
      if (!saveReviewIfFresh(db, id, row, game, review, language, audience, true)) {
        throw new Error('review_source_changed');
      }
      clearInterval(watch);
      // The streamed report must carry the same source key as its persisted
      // counterpart, so a mounted client can disregard an obsolete SSE done.
      const stamped = { ...review, accuracy_model_version: row.scoring_version,
        source_integrity: reviewSourceDigest(game, row, id) };
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ review: stamped }) });
    } catch (err) {
      if (obsolete || !controller.signal.aborted) {
        const changed = obsolete || (err instanceof Error && err.message === 'review_source_changed');
        try {
          await stream.writeSSE({ event: 'error', data: JSON.stringify({
            error: changed ? 'review_source_changed' : 'review_failed', stale: changed,
            action: changed ? 'reanalyze_game' : 'retry_report',
            message: changed ? 'The game or analysis changed while writing. Analyze the current game and try again.'
              : 'The report could not be completed. Please try again.',
          }) });
        } catch { /* Client disconnected; there is no subscriber to notify. */ }
      }
    } finally {
      clearInterval(watch);
      c.req.raw.signal.removeEventListener('abort', onRequestAbort);
    }
  });
});

export default router;
