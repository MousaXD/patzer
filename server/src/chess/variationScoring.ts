import { Chess } from 'chess.js';
import {
  classifyByWpDrop, cpLossForPly, cpToWinPct, mateToCp,
  normalizeEval, refineClassification, SCORING_VERSION, winDropForPly,
} from './classifier.js';
import type { AnalysisEngine } from './engine.js';
import type { EngineMultiEval } from './stockfish.js';
import type { Classification } from '../types.js';

export interface VariationMoveRequest {
  fen_before: string;
  move_uci: string;
  depth: number;
  /** 1-based absolute ply. Defaults to the ply encoded by the FEN move number. */
  ply?: number;
}

export interface VariationMoveQuality {
  source: 'variation';
  scoring_version: number;
  fen_before: string;
  fen_after: string;
  ply: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  classification: Classification;
  centipawn_loss: number;
  win_pct_drop: number;
  eval_before_cp: number;
  eval_after_cp: number;
  mate_before: number | null;
  mate_after: number | null;
  best_move_uci: string;
  best_move_san: string | null;
  best_pv: string[];
  is_best: boolean;
  legal_move_count: number;
  depth_before: number;
  depth_after: number | null;
  candidate_count: number;
  terminal: 'checkmate' | 'draw' | null;
}

export type VariationErrorCode =
  | 'invalid_fen' | 'invalid_move' | 'terminal_position'
  | 'engine_error' | 'engine_timeout';

export class VariationScoringError extends Error {
  constructor(public readonly code: VariationErrorCode) {
    super(code);
    this.name = 'VariationScoringError';
  }
}

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function validScore(e: EngineMultiEval): boolean {
  // normalizeEval prefers mate when present. Reject non-finite mate values
  // instead of accidentally propagating NaN through its score conversion.
  return e.mate !== null
    ? Number.isFinite(e.mate)
    : (e.cp !== null && Number.isFinite(e.cp));
}

/** Convert a PV to SAN only while each move remains legal. */
function sanPv(fen: string, pv: readonly string[], limit: number): string[] {
  const board = new Chess(fen);
  const result: string[] = [];
  for (const uci of pv.slice(0, limit)) {
    if (!UCI.test(uci)) break;
    try {
      const move = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4) || undefined });
      if (!move) break;
      result.push(move.san);
    } catch { break; }
  }
  return result;
}

function inferredPly(fen: string): number {
  const parts = fen.split(/\s+/);
  const n = Number(parts[5]);
  if (!Number.isInteger(n) || n < 1) throw new VariationScoringError('invalid_fen');
  return (n - 1) * 2 + (parts[1] === 'b' ? 2 : 1);
}

/**
 * Evaluate one exploratory move, without importing any database module or
 * persisting changes. The only classification policy is the existing server
 * classifier; in particular, no opening-book label is inferred for a variation.
 *
 * The engine is factory-injected so the route uses the configured engine, and
 * tests exercise Stockfish-compatible PV/evaluation contracts without binaries.
 */
export async function scoreVariationMove(
  request: VariationMoveRequest,
  makeEngine: () => AnalysisEngine,
  timeoutMs = 30_000,
): Promise<VariationMoveQuality> {
  let before: Chess;
  try { before = new Chess(request.fen_before); }
  catch { throw new VariationScoringError('invalid_fen'); }
  if (before.isGameOver()) throw new VariationScoringError('terminal_position');
  if (!UCI.test(request.move_uci)) throw new VariationScoringError('invalid_move');

  const sideToMove = before.turn() === 'w' ? 'white' : 'black';
  const legalMoveCount = before.moves().length;
  const ply = request.ply ?? inferredPly(before.fen());
  if (!Number.isInteger(ply) || ply < 1 || ply > 1024) throw new VariationScoringError('invalid_move');

  const after = new Chess(before.fen());
  let played: ReturnType<Chess['move']>;
  try {
    played = after.move({
      from: request.move_uci.slice(0, 2),
      to: request.move_uci.slice(2, 4),
      promotion: request.move_uci.slice(4) || undefined,
    });
  } catch { throw new VariationScoringError('invalid_move'); }
  if (!played) throw new VariationScoringError('invalid_move');
  // chess.js can implicitly promote to a queen; never silently score a
  // different move than the UCI the caller actually submitted.
  if (Boolean(played.promotion) !== (request.move_uci.length === 5)) {
    throw new VariationScoringError('invalid_move');
  }
  const fenBefore = before.fen();
  const fenAfter = after.fen();
  const terminal = after.isCheckmate() ? 'checkmate' : after.isDraw() ? 'draw' : null;

  const engine = makeEngine();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async (): Promise<VariationMoveQuality> => {
    await engine.start();
    await engine.setOption('Threads', '2');
    await engine.setOption('Hash', '64');
    await engine.newGame();
    const pre = await engine.evaluateMulti(fenBefore, request.depth, 3);
    if (!validScore(pre) || !pre.bestMoveUci || !UCI.test(pre.bestMoveUci)) {
      throw new VariationScoringError('engine_error');
    }

    // A checkmated player has a mate score of zero FROM THEIR perspective;
    // a drawn terminal position is zero centipawns. No second engine search
    // is necessary or reliable once no legal continuation exists.
    const post: EngineMultiEval = terminal
      ? { cp: terminal === 'draw' ? 0 : null, mate: terminal === 'checkmate' ? 0 : null,
          bestMoveUci: null, pv: [], depth: 0, candidates: [] }
      : await engine.evaluateMulti(fenAfter, request.depth, 1);
    if (!validScore(post)) throw new VariationScoringError('engine_error');

    const whiteBefore = normalizeEval(pre.cp, pre.mate, before.turn());
    const whiteAfter = normalizeEval(post.cp, post.mate, after.turn());
    const playerBefore = sideToMove === 'white' ? whiteBefore : -whiteBefore;
    const playerAfter = sideToMove === 'white' ? whiteAfter : -whiteAfter;
    const playerWinBefore = sideToMove === 'white' ? cpToWinPct(whiteBefore) : 100 - cpToWinPct(whiteBefore);
    const playerWinAfter = sideToMove === 'white' ? cpToWinPct(whiteAfter) : 100 - cpToWinPct(whiteAfter);
    const winDrop = winDropForPly(playerBefore, playerAfter, playerWinBefore, playerWinAfter);
    const cpLoss = cpLossForPly(playerBefore, playerAfter);
    const isBest = pre.bestMoveUci === request.move_uci;
    const base = classifyByWpDrop(winDrop, cpLoss, isBest);

    // Before-position MultiPV scores use the mover's perspective, regardless
    // of whether it is White or Black to move. A mate always dominates cp.
    const candidates = [...pre.candidates]
      .sort((a, b) => a.multipv - b.multipv)
      .filter((cand) => (cand.mate !== null && Number.isFinite(cand.mate))
        || (cand.cp !== null && Number.isFinite(cand.cp)));
    // No fabricated #1-versus-#2 gap if the engine omitted a PV rank.
    const first = candidates.find((cand) => cand.multipv === 1);
    const second = candidates.find((cand) => cand.multipv === 2);
    const rankOneMatchesBest = first?.pv[0] === pre.bestMoveUci;
    const ranked = rankOneMatchesBest && first ? (second ? [first, second] : [first]) : [];
    const candidatePlayerCps = ranked.map((cand) => cand.mate !== null && Number.isFinite(cand.mate)
      ? mateToCp(cand.mate)
      : cand.cp!);

    const classification = refineClassification({
      base,
      isBest,
      cpLoss,
      fenBefore,
      fenAfter,
      sideToMove,
      playerEvalBeforeCp: playerBefore,
      playerEvalAfterCp: playerAfter,
      ply,
      legalMoveCount,
      candidatePlayerCps,
      pvAfterPlayed: post.pv,
      // Do not falsely stamp user-created exploratory moves as opening book.
      inBook: false,
    });

    const firstSan = sanPv(fenBefore, [pre.bestMoveUci], 1)[0] ?? null;
    if (!firstSan) throw new VariationScoringError('engine_error');
    return {
      source: 'variation',
      scoring_version: SCORING_VERSION,
      fen_before: fenBefore,
      fen_after: fenAfter,
      ply,
      san: played.san,
      uci: request.move_uci,
      from: played.from,
      to: played.to,
      classification,
      centipawn_loss: cpLoss,
      win_pct_drop: winDrop,
      eval_before_cp: whiteBefore,
      eval_after_cp: whiteAfter,
      mate_before: pre.mate === null ? null : (sideToMove === 'white' ? pre.mate : -pre.mate),
      mate_after: post.mate === null ? null : (sideToMove === 'white' ? -post.mate : post.mate),
      best_move_uci: pre.bestMoveUci,
      best_move_san: firstSan,
      best_pv: sanPv(fenBefore, pre.pv, 8),
      is_best: isBest,
      legal_move_count: legalMoveCount,
      depth_before: pre.depth,
      depth_after: terminal ? null : post.depth,
      candidate_count: candidates.length,
      terminal,
    };
  })();

  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new VariationScoringError('engine_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // Local Stockfish.quit sends stop/quit and force-kills after 250ms;
    // rejections of outstanding work are consumed by Promise.race.
    try { await engine.quit(); } catch { /* preserve original error */ }
  }
}
