/** Display-only move grouping. Ply remains relative to this imported game,
 * while FEN controls the real move number and starting side. */
export interface ReviewMove { ply: number; san: string; classification?: string }
export interface ReviewMovePair<T extends ReviewMove> {
  num: number;
  pairIndex: number;
  white?: T;
  black?: T;
}

export function moveListStart(startFen?: string): { startsBlack: boolean; fullmove: number } {
  const parts = startFen?.trim().split(/\s+/) ?? [];
  const parsed = Number(parts[5]);
  return {
    startsBlack: parts[1] === 'b',
    fullmove: Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1,
  };
}

/** Side and fullmove number of a game-relative ply, including SetUp/FEN games. */
export function moveSideForPly(ply: number, startFen?: string): 'white' | 'black' {
  const { startsBlack } = moveListStart(startFen);
  return ((Math.max(1, Math.trunc(ply)) - 1 + (startsBlack ? 1 : 0)) % 2 === 0) ? 'white' : 'black';
}

export function moveNumberForPly(ply: number, startFen?: string): number {
  const { startsBlack, fullmove } = moveListStart(startFen);
  return fullmove + Math.floor((Math.max(1, Math.trunc(ply)) - 1 + (startsBlack ? 1 : 0)) / 2);
}

export function buildMovePairs<T extends ReviewMove>(moves: readonly T[], startFen?: string): ReviewMovePair<T>[] {
  const { startsBlack, fullmove } = moveListStart(startFen);
  const pairs: ReviewMovePair<T>[] = [];
  for (let index = 0; index < moves.length; index++) {
    const shifted = index + (startsBlack ? 1 : 0);
    const pairIndex = Math.floor(shifted / 2);
    const row = pairs[pairIndex] ?? (pairs[pairIndex] = { num: fullmove + pairIndex, pairIndex: pairIndex + 1 });
    if (shifted % 2 === 0) row.white = moves[index];
    else row.black = moves[index];
  }
  return pairs;
}

/** Given game-relative ply N, which displayed pair contains that position? */
export function pairIndexForPly(ply: number, startFen?: string): number {
  return Math.floor((Math.max(1, ply) - 1 + (moveListStart(startFen).startsBlack ? 1 : 0)) / 2) + 1;
}
