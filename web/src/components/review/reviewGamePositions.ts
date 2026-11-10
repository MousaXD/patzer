import { Chess } from 'chess.js';

export interface ReplayPosition {
  fen: string;
  san?: string;
  from?: string;
  to?: string;
  uci?: string;
}

/** Replay a saved game without modifying its PGN or trusting malformed input.
 * A null result is intentionally distinct from a legal game with zero moves. */
export function parseReviewGamePositions(pgn: string): ReplayPosition[] | null {
  try {
    const game = new Chess();
    game.loadPgn(pgn, { strict: false });
    const headers = game.getHeaders();
    const replay = new Chess(headers.SetUp === '1' && headers.FEN ? headers.FEN : undefined);
    const positions: ReplayPosition[] = [{ fen: replay.fen() }];
    for (const move of game.history({ verbose: true })) {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
      positions.push({
        fen: replay.fen(),
        san: move.san,
        from: move.from,
        to: move.to,
        uci: move.from + move.to + (move.promotion ?? ''),
      });
    }
    return positions;
  } catch {
    return null;
  }
}
