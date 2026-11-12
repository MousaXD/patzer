import { CLASSIFICATIONS, type AnalyzedMove, type KeyMomentSummary, type PhaseSplit } from '../../types';

/** Decode cached game analysis defensively. Storage may contain a partial or
 * legacy record; bad data must not crash the review and must never be rendered
 * as a real chess move or a fabricated evaluation. */
export interface StoredReviewJson {
  moves_json: string;
  key_moments_json: string | null;
  phase_split_json: string | null;
}

export interface DecodedReviewJson {
  moves: AnalyzedMove[];
  key_moments: KeyMomentSummary[];
  phase_split: PhaseSplit | null;
}

/** A broken cache must not be served again by a normal cached analysis call. */
export function needsFreshReviewAnalysis(
  cached: StoredReviewJson | null | undefined,
  decoded: DecodedReviewJson | null,
): boolean {
  return cached != null && decoded === null;
}

const classes: ReadonlySet<string> = new Set(CLASSIFICATIONS);
const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
const nullableNumber = (x: unknown): boolean => x === null || finite(x);
const nullableString = (x: unknown): boolean => x === null || typeof x === 'string';
const stringArray = (x: unknown): x is string[] =>
  Array.isArray(x) && x.every((v: unknown) => typeof v === 'string');
const classification = (x: unknown): boolean =>
  typeof x === 'string' && classes.has(x);

/** Validate the values that the timeline, explanation and report actually
 * render. Checking only that the array exists can still cause a render-time
 * crash, e.g. unknown classifications or null centipawn_loss. */
function validMove(value: unknown, index: number): boolean {
  if (!isRecord(value)) return false;
  return value.ply === index + 1
    && typeof value.san === 'string'
    && typeof value.uci === 'string'
    && typeof value.fen_before === 'string'
    && typeof value.fen_after === 'string'
    && classification(value.classification)
    && stringArray(value.best_pv)
    && nullableNumber(value.eval_before_cp)
    && nullableNumber(value.eval_after_cp)
    && (value.mate_before === undefined || nullableNumber(value.mate_before))
    && (value.mate_after === undefined || nullableNumber(value.mate_after))
    && nullableString(value.best_move_uci)
    && nullableString(value.best_move_san)
    && finite(value.centipawn_loss);
}

function validMoment(value: unknown, totalMoves: number): boolean {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.ply)
    && (value.ply as number) >= 1
    && (value.ply as number) <= totalMoves
    && (value.side === 'white' || value.side === 'black')
    && typeof value.san === 'string'
    && typeof value.fen_before === 'string'
    && classification(value.classification)
    && finite(value.cp_loss)
    && finite(value.win_pct_delta)
    && nullableString(value.best_san)
    && stringArray(value.best_pv);
}

function validPhases(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (['opening', 'middlegame', 'endgame'] as const).every((name) => {
    const point = value[name];
    if (point == null) return true;
    if (!isRecord(point)) return false;
    return Number.isSafeInteger(point.from_ply)
      && Number.isSafeInteger(point.to_ply)
      && (point.from_ply as number) >= 1
      && (point.to_ply as number) >= (point.from_ply as number)
      && finite(point.accuracy_white)
      && finite(point.accuracy_black)
      && finite(point.acpl_white)
      && finite(point.acpl_black);
  });
}

/** Optional replay positions bind *each* cached score to its exact saved
 * board state. Identical UCI/SAN can occur from unrelated positions with
 * different evaluations; accepting only UCI can show a false Brilliant or
 * engine score even though the current PGN has a different source FEN. */
export function decodeStoredReviewJson(
  data: StoredReviewJson,
  replayPositions?: readonly { fen?: string; uci?: string; san?: string }[],
): DecodedReviewJson | null {
  try {
    const moves: unknown = JSON.parse(data.moves_json);
    const moments: unknown = data.key_moments_json ? JSON.parse(data.key_moments_json) : [];
    const phases: unknown = data.phase_split_json ? JSON.parse(data.phase_split_json) : null;
    if (!Array.isArray(moves) || !Array.isArray(moments)) return null;
    if (!moves.every(validMove)) return null;
    // Allow valid partial analyses of very long games, but never show a cached
    // evaluation alongside a move whose source, destination or notation does
    // not match the exact saved PGN replay. The engine's own source_hash and
    // revision are checked separately when accepting stored AI prose.
    if (replayPositions && (moves.length > replayPositions.length - 1
      || moves.some((move: AnalyzedMove, index: number) =>
        move.uci !== replayPositions[index + 1]?.uci
        || move.san !== replayPositions[index + 1]?.san
        || move.fen_before !== replayPositions[index]?.fen
        || move.fen_after !== replayPositions[index + 1]?.fen))) return null;
    if (!moments.every((m: unknown) => validMoment(m, moves.length))) return null;
    // Key Moments are independently serialized from the engine's scored
    // moves. Structural validity alone is unsafe: a cached summary could
    // claim Brilliant, a different SAN or a better move for the correct ply.
    // Only trust claims identical to their authoritative scored move. Some
    // historical FEN-start games have a stale `side` field; the review UI
    // derives the actual mover from FEN instead, so don't reject that legacy
    // metadata or use it as evidence for evaluation/classification.
    const scored = moves as AnalyzedMove[];
    const seenMomentPlies = new Set<number>();
    for (const moment of moments as KeyMomentSummary[]) {
      const source = scored[moment.ply - 1];
      if (!source || seenMomentPlies.has(moment.ply)
        || moment.san !== source.san
        || moment.fen_before !== source.fen_before
        || moment.classification !== source.classification
        || moment.cp_loss !== source.centipawn_loss
        || moment.best_san !== source.best_move_san
        || moment.best_pv.length !== source.best_pv.length
        || moment.best_pv.some((san, index) => san !== source.best_pv[index])
        || moment.win_pct_delta < 0 || moment.win_pct_delta > 100) return null;
      seenMomentPlies.add(moment.ply);
    }
    if (!validPhases(phases)) return null;

    return {
      moves: moves as AnalyzedMove[],
      key_moments: moments as KeyMomentSummary[],
      phase_split: phases as PhaseSplit | null,
    };
  } catch {
    return null;
  }
}
