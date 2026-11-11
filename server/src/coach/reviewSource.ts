import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { SCORING_VERSION } from '../chess/classifier.js';

/** Coach-owned cache attestation, NOT a replacement for the engine's future
 * canonical PGN/analysis source ID. Uses existing columns; no DB migration. */
const CACHE_SOURCE_SCHEME = 'coach-evidence-v1';
const MAX_PGN_LENGTH = 256_000;
const MAX_PLIES = 2048;

export interface ReviewEvidenceGame {
  pgn: string;
  user_id: number;
  user_color: 'white' | 'black' | null;
  result?: string | null;
}

export interface ReviewEvidenceAnalysis {
  created_at?: string;
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
  | 'analysis_game_mismatch'
  | 'analysis_malformed';

/** Replay the *whole* source, including SetUp/FEN, rather than comparing just
 * move counts or the last FEN. This is an admission gate, not engine grading. */
export function checkReviewAnalysisSource(
  game: Pick<ReviewEvidenceGame, 'pgn'>,
  analysis: ReviewEvidenceAnalysis,
): ReviewSourceIssue | null {
  if (analysis.scoring_version !== SCORING_VERSION) return 'analysis_scoring_stale';
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
  return checkReviewAnalysisSource({ pgn }, {
    scoring_version: SCORING_VERSION, depth: 0,
    moves_json: movesJson, key_moments_json: null, phase_split_json: null,
    accuracy_white: null, accuracy_black: null,
    estimated_elo_white: null, estimated_elo_black: null,
    performance_white: null, performance_black: null,
    opening_eco: null, opening_name: null,
  }) === null;
}

export function reviewSourceDigest(
  game: Pick<ReviewEvidenceGame, 'pgn' | 'user_color' | 'user_id'>,
  source: ReviewEvidenceAnalysis & { prose_json?: string | null },
  gameId?: number,
): string {
  const evidence = [
    CACHE_SOURCE_SCHEME, gameId ?? null, game.user_id, game.pgn, game.user_color,
    'result' in game ? game.result : null,
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
