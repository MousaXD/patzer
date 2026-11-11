import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { Chess } from 'chess.js';
import { startFenOf } from './startFen.js';
import type { AnalysisResult, AnalyzedMove } from '../types.js';

/** Database snapshot of every game field that can affect chess evidence or the
 * player-relative performance estimate. Bookmark, notes and clock changes do
 * not belong here. The revision is incremented by a SQLite trigger, including
 * when the PGN goes A -> B -> A during an in-flight analysis. */
export interface AnalysisGameSource {
  pgn: string;
  start_fen: string | null;
  user_color: 'white' | 'black' | null;
  result: string | null;
  opponent_rating_before: number | null;
  user_rd_before: number | null;
  source_revision: number;
}

export interface AnalysisProvenance {
  source_hash: string | null;
  source_revision: number | null;
}

/** A reproducible, metadata-independent source fingerprint. The starting FEN
 * (including side-to-move and move counters), entire legal UCI line and all
 * scoring inputs are part of the key. A different seven-ply line cannot match
 * another seven-ply line. Do NOT incorporate the revision into the digest:
 * store it separately, so the ABA safety check cannot be bypassed by a match. */
export function analysisSourceHash(source: AnalysisGameSource): string | null {
  try {
    if (source.pgn.length > 256_000 ||
        !Number.isSafeInteger(source.source_revision) || source.source_revision < 0) return null;
    const chess = new Chess();
    chess.loadPgn(source.pgn, { strict: false });
    const start = new Chess(startFenOf(chess)).fen();
    if (source.start_fen !== null && new Chess(source.start_fen).fen() !== start) return null;
    const line = chess.history({ verbose: true });
    if (line.length > 2048) return null;
    const uci = line.map((m) => m.from + m.to + (m.promotion ?? ''));
    // A draw claim/result marker can change the engine's terminal evaluation
    // even when no move changes. Preserve it, but ignore unrelated headers.
    const pgnResult = chess.getHeaders().Result ?? null;
    return createHash('sha256').update(JSON.stringify([
      'patzer-analysis-source-v1', start, uci, pgnResult, source.user_color,
      source.result, source.opponent_rating_before, source.user_rd_before,
    ])).digest('hex');
  } catch {
    return null;
  }
}

/** Defend against a corrupt or unrelated moves_json/result even if its stored
 * provenance was accidentally copied. Also supports zero-ply and Black-first
 * PGNs, because the mover comes from FEN rather than ply parity. */
export function analysisMovesMatchPgn(pgn: string, moves: readonly AnalyzedMove[]): boolean {
  try {
    const chess = new Chess();
    chess.loadPgn(pgn, { strict: false });
    const history = chess.history({ verbose: true });
    if (!Array.isArray(moves) || history.length !== moves.length) return false;
    const replay = new Chess(startFenOf(chess));
    for (let i = 0; i < history.length; i++) {
      const move = moves[i];
      const actual = history[i]!;
      if (!move || move.ply !== i + 1 || move.san !== actual.san ||
          move.uci !== actual.from + actual.to + (actual.promotion ?? '') ||
          move.fen_before !== replay.fen()) return false;
      replay.move(actual.san);
      if (move.fen_after !== replay.fen()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function analysisMatchesGame(
  game: AnalysisGameSource,
  analysis: AnalysisProvenance & { moves_json: string },
): boolean {
  const hash = analysisSourceHash(game);
  if (!hash || !analysis.source_hash || analysis.source_hash !== hash ||
      analysis.source_revision !== game.source_revision) return false;
  try {
    return analysisMovesMatchPgn(game.pgn, JSON.parse(analysis.moves_json) as AnalyzedMove[]);
  } catch {
    return false;
  }
}

export function loadAnalysisGameSource(database: Database.Database, gameId: number): AnalysisGameSource | undefined {
  return database.prepare(`SELECT pgn, start_fen, user_color, result,
    opponent_rating_before, user_rd_before, source_revision FROM games WHERE id = ?`)
    .get(gameId) as AnalysisGameSource | undefined;
}

/** One atomic SQLite INSERT..SELECT/UPSERT; never persist an engine result if
 * another process changed the game after we captured its source. Using only a
 * preflight SELECT would introduce a TOCTOU race. The trigger revision handles
 * A -> B -> A changes; source fields are checked again as a defensive CAS. */
export function persistAnalysisIfFresh(
  database: Database.Database,
  gameId: number,
  result: AnalysisResult,
  source: AnalysisGameSource,
  scoringVersion: number,
): boolean {
  const hash = analysisSourceHash(source);
  if (!hash || !analysisMovesMatchPgn(source.pgn, result.moves)) return false;
  const updated = database.prepare(`
    INSERT INTO analyses (game_id, depth, accuracy_white, accuracy_black,
      estimated_elo_white, estimated_elo_black,
      performance_white, performance_black, opening_eco, opening_name,
      key_moments_json, phase_split_json, moves_json, scoring_version,
      source_hash, source_revision, analysis_generation)
    SELECT g.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
      FROM games g
     WHERE g.id = ? AND g.source_revision = ?
       AND g.pgn IS ? AND g.start_fen IS ? AND g.user_color IS ?
       AND g.result IS ? AND g.opponent_rating_before IS ? AND g.user_rd_before IS ?
    ON CONFLICT(game_id) DO UPDATE SET
      depth = excluded.depth,
      accuracy_white = excluded.accuracy_white, accuracy_black = excluded.accuracy_black,
      estimated_elo_white = excluded.estimated_elo_white, estimated_elo_black = excluded.estimated_elo_black,
      performance_white = excluded.performance_white, performance_black = excluded.performance_black,
      opening_eco = excluded.opening_eco, opening_name = excluded.opening_name,
      key_moments_json = excluded.key_moments_json, phase_split_json = excluded.phase_split_json,
      moves_json = excluded.moves_json, scoring_version = excluded.scoring_version,
      source_hash = excluded.source_hash, source_revision = excluded.source_revision,
      analysis_generation = analyses.analysis_generation + 1,
      prose_json = NULL, prose_version = 0, prose_lang = NULL, prose_audience = NULL,
      created_at = datetime('now')
  `).run(
    result.depth, result.accuracy_white, result.accuracy_black,
    result.estimated_elo_white, result.estimated_elo_black,
    result.performance_white, result.performance_black,
    result.opening_eco, result.opening_name,
    JSON.stringify(result.key_moments),
    result.phase_split ? JSON.stringify(result.phase_split) : null,
    JSON.stringify(result.moves), scoringVersion, hash, source.source_revision,
    gameId, source.source_revision, source.pgn, source.start_fen,
    source.user_color, source.result, source.opponent_rating_before, source.user_rd_before,
  );
  if (updated.changes !== 1) return false;
  // Opening fields in games are display metadata, never inputs to source_hash.
  if (result.opening_eco || result.opening_name) {
    database.prepare('UPDATE games SET eco = ?, opening_name = ? WHERE id = ?')
      .run(result.opening_eco, result.opening_name, gameId);
  }
  return true;
}
