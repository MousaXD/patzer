/** Review-only presentation rules. Never suggest a move evaluated on a
 * different FEN, or reuse the saved mainline during a free variation. */
export interface SuggestedMove { best_move_uci?: string | null }

export function visibleEngineLines<T>(lines: T[], resultFen: string, displayedFen: string): T[] {
  return resultFen === displayedFen ? lines : [];
}

export function bestMoveForDisplayedBoard(args: {
  ply: number;
  isVariation: boolean;
  mainline?: readonly SuggestedMove[];
  liveLines?: readonly { uci: string }[];
  liveReady: boolean;
}): string | undefined {
  if (args.liveReady && args.liveLines?.length) return args.liveLines[0]!.uci;
  // Move N is evaluated from the position before move N, so the displayed
  // position after ply P can only use move P+1's saved suggestion.
  if (args.isVariation) return undefined;
  return args.mainline?.[args.ply]?.best_move_uci ?? undefined;
}
