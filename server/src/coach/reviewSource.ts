import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { SCORING_VERSION } from '../chess/classifier.js';
import { analysisMatchesGame } from '../chess/analysisSource.js';

/** Coach-owned cache attestation, NOT a replacement for the engine's future
 * canonical PGN/analysis source ID. Uses existing columns; no DB migration. */
// v2 binds the report to the engine's monotonic game revision and analysis
// generation. A -> B -> A must not resurrect prose from the first A.
const CACHE_SOURCE_SCHEME = 'coach-evidence-v2';
const MAX_PGN_LENGTH = 256_000;
const MAX_PLIES = 2048;

export interface ReviewEvidenceGame {
  pgn: string;
  user_id: number;
  user_color: 'white' | 'black' | null;
  result?: string | null;
  start_fen?: string | null;
  opponent_rating_before?: number | null;
  user_rd_before?: number | null;
  current_source_revision?: number;
}

export interface ReviewEvidenceAnalysis {
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
}

export type ReviewSourceIssue =
  | 'analysis_scoring_stale'
  | 'analysis_source_stale'
  | 'analysis_game_mismatch'
  | 'analysis_malformed';

/** Replay the *whole* source, including SetUp/FEN, rather than comparing just
 * move counts or the last FEN. This is an admission gate, not engine grading. */
export function checkReviewAnalysisSource(
  game: ReviewEvidenceGame,
  analysis: ReviewEvidenceAnalysis,
): ReviewSourceIssue | null {
  if (analysis.scoring_version !== SCORING_VERSION) return 'analysis_scoring_stale';
  // The legal PGN replay below cannot detect a source that changed A -> B -> A.
  // Use Agent A's authoritative source/hash/revision instead of trusting the
  // present move sequence alone; legacy NULL provenance is never fresh.
  if (typeof game.current_source_revision !== 'number'
    || game.start_fen === undefined || game.opponent_rating_before === undefined
    || game.user_rd_before === undefined
    || !Number.isSafeInteger(analysis.analysis_generation)
    || (analysis.analysis_generation ?? 0) < 1
    || !analysisMatchesGame({
      pgn: game.pgn, start_fen: game.start_fen,
      user_color: game.user_color, result: game.result ?? null,
      opponent_rating_before: game.opponent_rating_before,
      user_rd_before: game.user_rd_before,
      source_revision: game.current_source_revision,
    }, {
      source_hash: analysis.source_hash ?? null,
      source_revision: analysis.source_revision ?? null,
      moves_json: analysis.moves_json,
    })) return 'analysis_source_stale';
  if (!game.pgn || game.pgn.length > MAX_PGN_LENGTH || analysis.moves_json.length > 4_000_000) {
    return 'analysis_malformed';
  }
  try {
    const chess = new Chess();
    chess.loadPgn(game.pgn, { strict: false });
    const history = chess.history({ verbose: true });
    if (history.length > MAX_PLIES) return 'analysis_malformed';
    const moves: unknown = JSON.parse(analysis.moves_json);
    if (!Array.isArray(moves) || moves.length !== history.length) return 'analysis_game_mismatch';
    for (let i = 0; i < history.length; i++) {
      const actual = history[i]!;
      const saved: unknown = moves[i];
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return 'analysis_malformed';
      const m = saved as Record<string, unknown>;
      if (m.ply !== i + 1 || m.san !== actual.san
        || m.uci !== `${actual.from}${actual.to}${actual.promotion ?? ''}`
        || m.fen_before !== actual.before || m.fen_after !== actual.after) {
        return 'analysis_game_mismatch';
      }
    }

    // Key moments must also belong to the same analyzed timeline. A row with
    // new moves but old key moments is not safe evidence for natural prose.
    const moments: unknown = analysis.key_moments_json ? JSON.parse(analysis.key_moments_json) : [];
    if (!Array.isArray(moments) || moments.length > MAX_PLIES) return 'analysis_malformed';
    for (const item of moments) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return 'analysis_malformed';
      const moment = item as Record<string, unknown>;
      if (typeof moment.ply !== 'number' || !Number.isInteger(moment.ply)) return 'analysis_malformed';
      const current = history[moment.ply - 1];
      const saved = moves[moment.ply - 1] as Record<string, unknown> | undefined;
      if (!current || !saved || moment.san !== current.san
        || moment.fen_before !== current.before
        || moment.side !== (current.before.split(' ')[1] === 'w' ? 'white' : 'black')
        || moment.classification !== saved.classification) return 'analysis_game_mismatch';
    }
    if (analysis.phase_split_json && !JSON.parse(analysis.phase_split_json)) return 'analysis_malformed';
    return null;
  } catch {
    return 'analysis_malformed';
  }
}

/** Compatibility for the existing Agent B route and QA tests while the
 * integrator settles the shared analysis-source contract with Agent A. */
export function analysisMatchesPgn(pgn: string, movesJson: string): boolean {
  // Compatibility helper for *timeline-only* callers and unit fixtures. It
  // MUST NOT be used to decide whether a persisted analysis/report is fresh.
  try {
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
    const history = chess.history({ verbose: true });
    const moves: unknown = JSON.parse(movesJson);
    return Array.isArray(moves) && moves.length === history.length && history.every((actual, i) => {
      const m = moves[i];
      return m && m.ply === i + 1 && m.san === actual.san
        && m.uci === `${actual.from}${actual.to}${actual.promotion ?? ''}`
        && m.fen_before === actual.before && m.fen_after === actual.after;
    });
  } catch { return false; }
}

export function reviewSourceDigest(
  game: ReviewEvidenceGame,
  source: ReviewEvidenceAnalysis & { prose_json?: string | null },
  gameId?: number,
): string {
  const evidence = [
    CACHE_SOURCE_SCHEME, gameId ?? null, game.user_id, game.pgn, game.user_color,
    'result' in game ? game.result : null,
    game.current_source_revision ?? null,
    game.start_fen ?? null, game.opponent_rating_before ?? null, game.user_rd_before ?? null,
    source.source_hash ?? null, source.source_revision ?? null,
    source.analysis_generation ?? null,
    source.created_at ?? null,
    source.depth, source.scoring_version, source.moves_json,
    source.key_moments_json, source.phase_split_json,
    source.accuracy_white, source.accuracy_black,
    source.estimated_elo_white, source.estimated_elo_black,
    source.performance_white, source.performance_black,
    source.opening_eco, source.opening_name,
  ];
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
