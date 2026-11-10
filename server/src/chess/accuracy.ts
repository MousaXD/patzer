/** Game-level Stockfish accuracy (independent of Chess.com's proprietary CAPS2).
 *
 * Per-move accuracies follow Lichess's published win-chance loss formula.
 * The game-level score blends a volatility-weighted mean and a harmonic mean.
 *
 * Previous Patzer v9 had two upward biases:
 *  - It floored *every* bad move at the third-worst move's accuracy when taking
 *    the harmonic mean. A single 58%-accurate mistake among good moves became
 *    a 96%-accurate move, almost disappearing from the final score.
 *  - Volatility only used positions AFTER each of the player's turns. That
 *    could skip the exact win-chance collapse caused by the player's mistake
 *    (positions on either side of that move weren't included together).
 *  - It also added an arbitrary positive distribution shift.
 *
 * No one can claim numeric parity with Chess.com, whose CAPS2 weights/engine
 * settings are unpublished. This is a deterministic, openly explainable
 * measure of the supplied Stockfish evaluations.
 * https://lichess.org/page/accuracy
 */

export interface MoveAccPoint {
  acc: number;            // per-move accuracy [0, 100]
  winPctBefore: number;   // player's win chance just BEFORE the move [0, 100]
  winPct: number;         // player's win chance just AFTER the move [0, 100]
  isBook: boolean;        // exclude book and forced moves from the aggregate
}

function stdev(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / xs.length);
}

/** Returns zero only when there are no eligible moves to score. */
export function gameAccuracy(points: readonly MoveAccPoint[]): number {
  const moves = points.filter((p) => !p.isBook);
  if (!moves.length) return 0;
  const accuracies = moves.map((m) => Math.max(0, Math.min(100, m.acc)));
  const afterWin = moves.map((m) => m.winPct);
  const size = Math.max(2, Math.min(8, Math.ceil(moves.length / 10)));
  const weights = moves.map((move, i) => {
    const first = Math.max(0, i - Math.floor(size / 2));
    const window = afterWin.slice(first, Math.min(moves.length, first + size));
    // Include this move's own change, rather than looking only at consecutive
    // same-color after-move positions. A sharp blunder must not weigh less than
    // a quiet best move just because subsequent positions were stable.
    const ownLoss = Math.max(0, move.winPctBefore - move.winPct);
    return Math.max(0.5, Math.min(4, Math.max(stdev(window), ownLoss / 2)));
  });
  const sumWeights = weights.reduce((sum, x) => sum + x, 0);
  const weighted = accuracies.reduce((sum, x, i) => sum + x * weights[i]!, 0) / sumWeights;

  // Do not substitute the third-worst move's accuracy for a genuine mistake.
  // A modest absolute 10% denominator floor limits an isolated literal 0%
  // move from completely dominating the harmonic mean in short games. Unlike
  // the old *relative* third-worst floor, this never promotes an actual 58%
  // mistake to 96%, and adding more bad moves always lowers the result.
  const harmonic = moves.length / accuracies.reduce((sum, x) => sum + 1 / Math.max(10, x), 0);
  return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
}
