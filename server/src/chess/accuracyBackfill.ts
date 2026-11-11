/** Recompute game summary numbers from existing analyzed moves; NO engine work.
 *
 * Used only by the explicit v9 → v10 one-time migration CLI. The analyzer
 * already computes these same quantities as it visits every move, and this
 * implementation takes the archived eval_before/eval_after values instead.
 */
import { gameAccuracy, type MoveAccPoint } from './accuracy.js';
import {
  cpToWinPct, moveAccuracy, winDropForPly, cpLossForAcpl,
  estimateElo, estimateGamePerformance,
} from './classifier.js';
import type { AnalyzedMove, PhaseSplit } from '../types.js';

export interface StoredGameMetadata {
  userColor: 'white' | 'black' | null;
  result: string | null;
  opponentRating: number | null;
}

export interface RecalculatedAnalysis {
  accuracyWhite: number;
  accuracyBlack: number;
  estimatedEloWhite: number | null;
  estimatedEloBlack: number | null;
  performanceWhite: number | null;
  performanceBlack: number | null;
  phaseSplit: PhaseSplit | null;
}

function playerScore(result: string | null, color: 'white' | 'black'): 0 | 0.5 | 1 | null {
  if (result === 'win') return 1;
  if (result === 'loss') return 0;
  if (result === 'draw' || result === '1/2-1/2') return 0.5;
  if (result === '1-0') return color === 'white' ? 1 : 0;
  if (result === '0-1') return color === 'black' ? 1 : 0;
  return null;
}

function summarize(moves: readonly AnalyzedMove[]) {
  const white: MoveAccPoint[] = [], black: MoveAccPoint[] = [];
  let wCpl = 0, bCpl = 0, wN = 0, bN = 0;
  for (const move of moves) {
    const side = move.fen_before.split(' ')[1];
    if (side !== 'w' && side !== 'b') throw new Error('invalid_turn_in_cached_analysis');
    const isWhite = side === 'w';
    const before = move.eval_before_cp;
    const after = move.eval_after_cp;
    if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after)) {
      throw new Error('invalid_eval_in_cached_analysis');
    }
    const beforePlayer = isWhite ? before : -before;
    const afterPlayer = isWhite ? after : -after;
    const wpBefore = cpToWinPct(beforePlayer);
    const wpAfter = cpToWinPct(afterPlayer);
    const drop = winDropForPly(beforePlayer, afterPlayer, wpBefore, wpAfter);
    const acc = moveAccuracy(wpBefore, wpBefore - drop);
    const excluded = move.classification === 'book' || move.classification === 'forced';
    const point: MoveAccPoint = { acc, winPctBefore: wpBefore, winPct: wpAfter, isBook: excluded };
    if (isWhite) {
      white.push(point);
      if (!excluded) { wCpl += cpLossForAcpl(beforePlayer, afterPlayer); wN++; }
    } else {
      black.push(point);
      if (!excluded) { bCpl += cpLossForAcpl(beforePlayer, afterPlayer); bN++; }
    }
  }
  return {
    accuracyWhite: Math.round(gameAccuracy(white) * 10) / 10,
    accuracyBlack: Math.round(gameAccuracy(black) * 10) / 10,
    acplWhite: wN ? wCpl / wN : 0,
    acplBlack: bN ? bCpl / bN : 0,
    whiteCount: white.length,
    blackCount: black.length,
    // Only scored decisions, never book or forced moves, can support a
    // strength/performance estimate. A zero-evidence game is not 2880 Elo.
    eligibleWhiteCount: wN,
    eligibleBlackCount: bN,
  };
}

export function recalculateAnalysisFromMoves(
  moves: readonly AnalyzedMove[], game: StoredGameMetadata, phaseSplit: PhaseSplit | null,
): RecalculatedAnalysis {
  if (moves.length > 2048) throw new Error('too_many_plies_in_cached_analysis');
  const full = summarize(moves);
  const color = game.userColor ?? 'white';
  const score = playerScore(game.result, color);
  const estimatedEloWhite = full.eligibleWhiteCount ? estimateElo(full.accuracyWhite, full.acplWhite) : null;
  const estimatedEloBlack = full.eligibleBlackCount ? estimateElo(full.accuracyBlack, full.acplBlack) : null;
  let performanceWhite: number | null = null;
  let performanceBlack: number | null = null;
  const playerHasEvidence = color === 'white' ? full.eligibleWhiteCount > 0 : full.eligibleBlackCount > 0;
  if (score !== null && playerHasEvidence) {
    const perf = estimateGamePerformance({
      accuracy: color === 'white' ? full.accuracyWhite : full.accuracyBlack,
      acpl: color === 'white' ? full.acplWhite : full.acplBlack,
      opponentRating: game.opponentRating,
      opponentRd: null,
      score,
    });
    if (color === 'white') performanceWhite = perf;
    else performanceBlack = perf;
  }
  if (performanceWhite === null && full.eligibleWhiteCount) {
    performanceWhite = estimateGamePerformance({ accuracy: full.accuracyWhite, acpl: full.acplWhite,
      opponentRating: null, opponentRd: null, score: score ?? 0.5 });
  }
  if (performanceBlack === null && full.eligibleBlackCount) {
    performanceBlack = estimateGamePerformance({ accuracy: full.accuracyBlack, acpl: full.acplBlack,
      opponentRating: null, opponentRd: null, score: score ?? 0.5 });
  }
  const newPhases = phaseSplit ? structuredClone(phaseSplit) : null;
  if (newPhases) {
    for (const phase of ['opening', 'middlegame', 'endgame'] as const) {
      const previous = newPhases[phase];
      if (!previous) continue;
      const subset = moves.filter((m) => m.ply >= previous.from_ply && m.ply <= previous.to_ply);
      const sum = summarize(subset);
      previous.accuracy_white = sum.accuracyWhite;
      previous.accuracy_black = sum.accuracyBlack;
      previous.acpl_white = sum.eligibleWhiteCount ? Math.round(sum.acplWhite) : 0;
      previous.acpl_black = sum.eligibleBlackCount ? Math.round(sum.acplBlack) : 0;
    }
  }
  return {
    accuracyWhite: full.accuracyWhite, accuracyBlack: full.accuracyBlack,
    estimatedEloWhite, estimatedEloBlack,
    performanceWhite, performanceBlack, phaseSplit: newPhases,
  };
}
