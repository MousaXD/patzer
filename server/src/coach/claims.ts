import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { createHash } from 'node:crypto';
import type { Language } from '../types.js';

// Internal coach-evidence contract, not a shared API response or engine score.
// A legal variation proves only that those moves *can* be played. It does NOT
// establish that either player is forced to follow it or wins material.
export const COACH_CLAIMS_VERSION = 1;
export type ClaimType =
  | 'legal_move' | 'legal_variation' | 'check' | 'checkmate'
  | 'capture' | 'reply_mate_in_one' | 'reply_capture'
  | 'fork_geometry' | 'absolute_pin' | 'piece_at_square'
  | 'forced_line' | 'hanging_piece' | 'material_win' | 'threat';
export type ProofStatus = 'verified' | 'contradicted' | 'insufficient_evidence';
export type Actor = 'white' | 'black';

export interface CoachClaimV1 {
  claim_id: string;
  source_fen: string;
  actor: Actor;
  played_san: string;
  evidence_type: ClaimType;
  variation_san?: string[];
  target_squares?: string[];
  piece?: PieceSymbol;
  piece_color?: Actor;
  position?: 'before' | 'after';
}

export interface CheckedCoachClaimV1 extends CoachClaimV1 {
  contract_version: 1;
  proof_status: ProofStatus;
  proof_method: 'legal_replay' | 'board_geometry' | 'none';
  verified_line_san: string[];
  reason: string;
}

const color = (actor: Actor): Color => actor === 'white' ? 'w' : 'b';
const opposite = (side: Color): Color => side === 'w' ? 'b' : 'w';
const square = (s: string): s is Square => /^[a-h][1-8]$/.test(s);

/** All SAN must be legal from the *given* FEN. No accepting a valid prefix of
 * an invalid line, silently switching turns or replaying after checkmate. */
export function replayLegalSan(fen: string, line: readonly string[]): Chess | null {
  try {
    const chess = new Chess(fen);
    if (!line.length || line.length > 40) return null;
    for (const san of line) {
      if (typeof san !== 'string' || san.length > 20 || !chess.moves().includes(san)) return null;
      chess.move(san);
    }
    return chess;
  } catch {
    return null;
  }
}

/** A geometric absolute pin: the moving side's rook/bishop/queen, one opposing
 * non-king piece on its ray, then the opposing king, with no other blockers.
 * This proves the alignment, not that material can be won. */
function pinTargets(chess: Chess, from: Square, own: Color): Set<string> {
  const piece = chess.get(from);
  if (!piece || piece.color !== own || !['q', 'r', 'b'].includes(piece.type)) return new Set();
  const out = new Set<string>();
  const file = from.charCodeAt(0) - 97;
  const rank = Number(from[1]) - 1;
  for (const df of [-1, 0, 1]) for (const dr of [-1, 0, 1]) {
    if (!df && !dr) continue;
    if (piece.type === 'b' && (!df || !dr)) continue;
    if (piece.type === 'r' && df && dr) continue;
    let blocker: string | null = null;
    for (let f = file + df, r = rank + dr; f >= 0 && f <= 7 && r >= 0 && r <= 7; f += df, r += dr) {
      const sq = `${String.fromCharCode(97 + f)}${r + 1}` as Square;
      const p = chess.get(sq);
      if (!p) continue;
      if (p.color === own) break;
      if (!blocker) {
        if (p.type === 'k') break;
        blocker = sq;
      } else {
        if (p.type === 'k') out.add(blocker);
        break;
      }
    }
  }
  return out;
}

export function verifyCoachClaim(claim: CoachClaimV1): CheckedCoachClaimV1 {
  const check = (proof_status: ProofStatus, reason: string, proof_method: CheckedCoachClaimV1['proof_method'] = 'none',
    verified_line_san: string[] = []): CheckedCoachClaimV1 =>
    ({ ...claim, contract_version: 1, proof_status, proof_method, verified_line_san, reason });
  let before: Chess;
  try { before = new Chess(claim.source_fen); }
  catch { return check('contradicted', 'invalid_fen'); }
  if (before.turn() !== color(claim.actor)) return check('contradicted', 'wrong_actor');
  if (!before.moves().includes(claim.played_san)) return check('contradicted', 'illegal_played_move');
  const after = new Chess(before.fen());
  const played = after.move(claim.played_san);

  // Deliberate refusal: a tactic, threat or engine-preferred line is not
  // automatically forced, winning, or even profitable after a recapture.
  if (['forced_line', 'hanging_piece', 'material_win', 'threat'].includes(claim.evidence_type)) {
    return check('insufficient_evidence', 'requires_counterfactual_or_engine_proof');
  }
  if (claim.evidence_type === 'legal_move') return check('verified', 'legal_played_move', 'legal_replay', [played.san]);
  if (claim.evidence_type === 'legal_variation') {
    const pv = claim.variation_san;
    if (!Array.isArray(pv) || !pv.length) return check('insufficient_evidence', 'missing_variation');
    const end = replayLegalSan(claim.source_fen, pv);
    return end ? check('verified', 'line_is_legal_not_forced', 'legal_replay', pv)
      : check('contradicted', 'illegal_variation');
  }
  if (claim.evidence_type === 'check') return after.inCheck()
    ? check('verified', 'played_move_gives_check', 'legal_replay', [played.san])
    : check('contradicted', 'move_does_not_check');
  if (claim.evidence_type === 'checkmate') return after.isCheckmate()
    ? check('verified', 'played_move_is_checkmate', 'legal_replay', [played.san])
    : check('contradicted', 'move_is_not_checkmate');
  if (claim.evidence_type === 'capture') return played.captured
    ? check('verified', 'played_move_captures_piece_not_net_material', 'legal_replay', [played.san])
    : check('contradicted', 'move_did_not_capture');
  if (claim.evidence_type === 'reply_mate_in_one' || claim.evidence_type === 'reply_capture') {
    const reply = claim.variation_san?.[0];
    if (!reply) return check('insufficient_evidence', 'missing_reply');
    if (!after.moves().includes(reply)) return check('contradicted', 'illegal_opponent_reply');
    const response = new Chess(after.fen());
    const move = response.move(reply);
    const applies = claim.evidence_type === 'reply_mate_in_one' ? response.isCheckmate() : !!move.captured;
    return applies
      ? check('verified', 'opponent_can_choose_this_legal_reply_not_forced', 'legal_replay', [played.san, move.san])
      : check('contradicted', 'reply_does_not_have_claimed_effect');
  }
  if (claim.evidence_type === 'piece_at_square') {
    const [target] = claim.target_squares ?? [];
    if (!target || !square(target) || !claim.piece || !claim.piece_color)
      return check('insufficient_evidence', 'missing_piece_or_square');
    const board = claim.position === 'before' ? before : after;
    const piece = board.get(target);
    return piece?.type === claim.piece && piece.color === color(claim.piece_color)
      ? check('verified', 'piece_matches_board', 'board_geometry')
      : check('contradicted', 'piece_not_on_square');
  }
  if (claim.evidence_type === 'fork_geometry') {
    const targets = claim.target_squares;
    if (!targets || targets.length < 2 || targets.length > 7 || targets.some((s) => !square(s)) || new Set(targets).size !== targets.length)
      return check('insufficient_evidence', 'two_distinct_target_squares_required');
    // Attack geometry only; cannot conclude a won piece (the opponent moves).
    const allAttacked = targets.every((s) => {
      const target = after.get(s as Square);
      return target && target.color === opposite(color(claim.actor))
        && after.attackers(s as Square, color(claim.actor)).includes(played.to);
    });
    return allAttacked ? check('verified', 'two_pieces_attacked_not_a_forced_win', 'board_geometry')
      : check('contradicted', 'no_double_attack_by_moved_piece');
  }
  if (claim.evidence_type === 'absolute_pin') {
    const [target] = claim.target_squares ?? [];
    if (!target || !square(target)) return check('insufficient_evidence', 'missing_pinned_square');
    return pinTargets(after, played.to, color(claim.actor)).has(target)
      ? check('verified', 'absolute_king_pin_geometry_only', 'board_geometry')
      : check('contradicted', 'not_a_pin_to_king');
  }
  return check('insufficient_evidence', 'unknown_claim_type');
}

export interface MomentEvidenceV1 {
  version: 1;
  source_fen: string;
  actor: Actor | null;
  played_san: string;
  status: ProofStatus;
  claims: CheckedCoachClaimV1[];
  legal_best_san: string | null;
}

/** Derive a finite allowlist of direct chess facts from the position. */
export function momentEvidence(fen: string, playedSan: string, bestSan: string | null,
  variationSan: string[] = []): MomentEvidenceV1 {
  const base: MomentEvidenceV1 = {
    version: 1, source_fen: fen, actor: null, played_san: playedSan,
    status: 'contradicted', claims: [], legal_best_san: null,
  };
  let before: Chess;
  try { before = new Chess(fen); } catch { return base; }
  const actor: Actor = before.turn() === 'w' ? 'white' : 'black';
  base.actor = actor;
  const make = (kind: ClaimType, extra: Partial<CoachClaimV1> = {}) => {
    // A single moment may have multiple legal captures or pins. IDs must
    // distinguish each verified fact and also avoid collisions across games.
    // The hash covers only synthetic/position metadata; never model prose.
    const signature = JSON.stringify([
      COACH_CLAIMS_VERSION, fen, actor, playedSan, kind,
      extra.variation_san ?? [], extra.target_squares ?? [],
      extra.piece ?? null, extra.piece_color ?? null, extra.position ?? null,
    ]);
    const claim_id = `v1:${kind}:${createHash('sha256').update(signature).digest('hex').slice(0, 20)}`;
    return verifyCoachClaim({ claim_id, source_fen: fen, actor, played_san: playedSan, evidence_type: kind, ...extra });
  };
  const legal = make('legal_move');
  base.claims.push(legal);
  if (legal.proof_status !== 'verified') return base;
  base.status = 'verified';
  for (const kind of ['check', 'checkmate', 'capture'] as const) {
    const c = make(kind);
    if (c.proof_status === 'verified') base.claims.push(c);
  }
  const after = new Chess(fen);
  const move = after.move(playedSan);
  if (bestSan && before.moves().includes(bestSan)) base.legal_best_san = bestSan;
  if (variationSan.length) {
    const pv = make('legal_variation', { variation_san: variationSan });
    // Do not present a partial or unrelated PV as evidence for the best move.
    if (pv.proof_status === 'verified' && (!bestSan || variationSan[0] === bestSan)) base.claims.push(pv);
  }
  for (const reply of after.moves()) {
    if (!reply.endsWith('#')) continue;
    const c = make('reply_mate_in_one', { variation_san: [reply] });
    if (c.proof_status === 'verified') { base.claims.push(c); break; }
  }
  // An immediate capture is a *possibility*, not proof of a net gain.
  const captures = after.moves({ verbose: true }).filter((m) => !!m.captured).slice(0, 4);
  for (const reply of captures) base.claims.push(make('reply_capture', { variation_san: [reply.san] }));

  // Optional checkable geometry: does the MOVED piece attack multiple enemy
  // pieces / pin an enemy piece to its king right now?
  const targets = after.board().flat().filter((p) => p && p.color === after.turn()
    && after.attackers(p.square, color(actor)).includes(move.to)).map((p) => p!.square);
  if (targets.length >= 2) {
    const fork = make('fork_geometry', { target_squares: targets.slice(0, 7) });
    if (fork.proof_status === 'verified') base.claims.push(fork);
  }
  for (const target of pinTargets(after, move.to, color(actor))) {
    const pin = make('absolute_pin', { target_squares: [target] });
    if (pin.proof_status === 'verified') base.claims.push(pin);
  }
  return base;
}

const MOTIFS: Record<Language, Record<'fork' | 'pin' | 'hang' | 'threat' | 'material' | 'forced' | 'mate', RegExp>> = {
  en: {
    fork: /\b(?:forks?|forked|forking|double attack)\b/i,
    pin: /\b(?:pins?|pinned|pinning|absolute pin)\b/i,
    hang: /\b(?:hanging|undefended|unprotected|loose piece)\b/i,
    threat: /\b(?:threats?|threatens?|threatening)\b/i,
    material: /\b(?:wins? material|loses? material|wins? (?:a |the )?(?:queen|rook|bishop|knight|pawn)|drops? (?:a |the )?(?:queen|rook|bishop|knight))\b/i,
    forced: /\b(?:forced|forcing|guaranteed|inevitable|unavoidable|cannot avoid|must (?:lose|win))\b/i,
    mate: /\b(?:checkmate|mate|mates|mated)\b/i,
  },
  bg: {
    fork: /вилиц|двойн.{0,8}атак/i, pin: /свърз|закова|пин/i,
    hang: /незащит|увиснал|без защит/i, threat: /заплах|заплаш/i,
    material: /печел.{0,12}материал|губ.{0,12}материал|губ.{0,8}ферз/i,
    forced: /форсиран|неизбеж|гарантиран/i, mate: /мат(?![а-я])/i,
  },
  es: {
    fork: /tenedor|doble ataque/i, pin: /clavadur|clavad[oa]/i,
    hang: /indefens|sin protecci[oó]n|colgand/i, threat: /amenaz/i,
    material: /gan[ao].{0,8}material|pierde material|gana (?:la |una )?(?:dama|torre|pieza)/i,
    forced: /forzad|inevitable|garantizad/i, mate: /jaque mate|\bmate\b/i,
  },
  de: {
    fork: /gabel|doppelangriff/i, pin: /fessel|gefesselt/i,
    hang: /ungedeckt|hängend|ungeschützt/i, threat: /droh/i,
    material: /materialgewinn|materialverlust|gewinnt (?:die |einen? )?(?:dame|turm|figur)/i,
    forced: /erzwungen|forcier|unvermeid|garantiert/i, mate: /schachmatt|\bmatt\b/i,
  },
  ru: {
    fork: /вилк|двойн.{0,8}удар/i, pin: /связк|связан/i,
    hang: /незащищ|под боем|без защит/i, threat: /угроз|угрож/i,
    material: /выигр.{0,15}материал|теря.{0,15}материал|выигр.{0,8}ферз/i,
    forced: /форсирован|неизбеж|гарантирован/i, mate: /мат(?![а-яё])/i,
  },
};

// The lexicon rejects a narrow set of *unsafe factual commitments*, not all
// possible natural-language hallucinations. An absent term is not proof that
// the rest of a paragraph is true.
export function screenCoachProse(text: string, evidence: MomentEvidenceV1, language: Language):
  { accepted: boolean; reasons: string[] } {
  const fail: string[] = [];
  if (!text || text.length > 1800 || evidence.status !== 'verified') return { accepted: false, reasons: ['invalid_or_unverified_context'] };
  const rules = MOTIFS[language] ?? MOTIFS.en;
  const has = (type: ClaimType) => evidence.claims.some((c) => c.evidence_type === type && c.proof_status === 'verified');
  if (rules.forced.test(text) || /\bmate\s+in\s+\d+|\bmatt?\s+(?:en|in)\s+\d+|мат\s+(?:в|за)\s+\d+/i.test(text)) fail.push('unproved_forcing');
  if (rules.mate.test(text) && !has('checkmate') && !has('reply_mate_in_one')) fail.push('unproved_mate');
  if (rules.hang.test(text)) fail.push('unproved_hanging');
  if (rules.threat.test(text)) fail.push('unproved_threat');
  if (rules.material.test(text)) fail.push('unproved_material_gain');

  // A verified mate somewhere in this position does not prove *any other*
  // move quoted by the model. Restrict SAN references to the exact played
  // move, legal recommendation and independently verified local variations.
  // Do not use a merely legal, unscored SAN to substantiate a tactic.
  const canonicalSan = (s: string) => s.replace(/[+#?!]+$/u, '');
  const quotedSan = /(?<![\p{L}\p{N}])(?:[KQRBN](?:[a-h1-8])?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][18]=[QRBN])[+#]?(?![\p{L}\p{N}])/gu;
  const provenSan = new Set([
    evidence.played_san,
    evidence.legal_best_san,
    ...evidence.claims.filter((c) => c.proof_status === 'verified').flatMap((c) => c.verified_line_san),
  ].filter((s): s is string => typeof s === 'string').map(canonicalSan));
  for (const match of text.matchAll(quotedSan)) {
    if (!provenSan.has(canonicalSan(match[0]))) fail.push('unverified_named_move');
  }

  // High-confidence actor checks for statements that directly assign an
  // explicit SAN or mating move to White/Black. Longer implicit phrasing is
  // NOT certified by this lexical screen and remains a known limitation.
  const actorName = evidence.actor === 'white' ? 'White' : 'Black';
  const oppositeName = evidence.actor === 'white' ? 'Black' : 'White';
  const namedMove = String.raw`(?:[KQRBN](?:[a-h1-8])?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?`;
  const assertedPlayed = new RegExp(String.raw`\b(White|Black|you)\s+(?:played|plays|chose|made)\s+(${namedMove})(?=$|[^\p{L}\p{N}])`, 'giu');
  for (const m of text.matchAll(assertedPlayed)) {
    if (canonicalSan(m[2]!) !== canonicalSan(evidence.played_san)) {
      // A possible mating reply or engine recommendation is not evidence
      // that the move occurred in the real game.
      fail.push('unverified_past_move');
    } else if (m[1]!.toLowerCase() === oppositeName.toLowerCase()) {
      fail.push('wrong_played_move_actor');
    }
  }
  const mateActor = has('checkmate') ? actorName : has('reply_mate_in_one') ? oppositeName : null;
  if (mateActor) {
    const wrongMateActor = mateActor === 'White' ? 'Black' : 'White';
    if (new RegExp(`\\b${wrongMateActor}\\s+(?:(?:can|could|would|will)\\s+)?(?:give|deliver|achieve|play|reply with|respond with|answer with)\\s+[^.!?]{0,65}\\b(?:checkmate|mate)\\b`, 'i').test(text)) {
      fail.push('wrong_mating_actor');
    }
  }

  // Refuse concrete piece/square claims unless the piece exists either just
  // before or just after the move. Does not license tactical consequences.
  const names: Record<Language, Record<string, PieceSymbol>> = {
    en: { king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p' },
    bg: { цар: 'k', царица: 'q', дама: 'q', топ: 'r', офицер: 'b', кон: 'n', пешка: 'p' },
    es: { rey: 'k', dama: 'q', torre: 'r', alfil: 'b', caballo: 'n', peón: 'p', peon: 'p' },
    de: { könig: 'k', dame: 'q', turm: 'r', läufer: 'b', springer: 'n', bauer: 'p' },
    ru: { король: 'k', ферзь: 'q', ладья: 'r', слон: 'b', конь: 'n', пешка: 'p' },
  };
  const lookup = names[language] ?? names.en;
  const pattern = new RegExp(`(?:^|[^\\p{L}])(${Object.keys(lookup).join('|')})\\s+(?:on|at|на|en|auf)\\s+([a-h][1-8])(?=$|[^a-z0-9])`, 'giu');
  let before: Chess | null = null;
  let after: Chess | null = null;
  let movedTo: Square;
  try { before = new Chess(evidence.source_fen); after = new Chess(evidence.source_fen); movedTo = after.move(evidence.played_san).to; }
  catch { return { accepted: false, reasons: ['invalid_context'] }; }
  const mentioned: { type: PieceSymbol; square: Square }[] = [];
  for (const m of text.matchAll(pattern)) {
    const type = lookup[m[1]!.toLowerCase()];
    const sq = m[2] as Square;
    if (type) {
      mentioned.push({ type, square: sq });
      if (before.get(sq)?.type !== type && after.get(sq)?.type !== type) fail.push('piece_on_wrong_square');
    }
  }
  // 'Black's queen on h5' was previously accepted if WHITE owned the queen
  // there. Check the explicitly asserted owner, not only piece geometry.
  if (language === 'en') {
    const owners = /\b(white|black)(?:['’]s)?\s+(king|queen|rook|bishop|knight|pawn)\s+(?:on|at)\s+([a-h][1-8])\b/gi;
    for (const m of text.matchAll(owners)) {
      const expected = m[1]!.toLowerCase() === 'white' ? 'w' : 'b';
      const type = lookup[m[2]!.toLowerCase()];
      const sq = m[3] as Square;
      const actual = [before.get(sq), after.get(sq)];
      if (!actual.some((p) => p?.type === type && p.color === expected)) fail.push('piece_owner_wrong');
    }
  }
  // A true *somewhere* fork/pin cannot validate a sentence about an
  // unrelated attacker or targets. Require exact piece+square references
  // for the moved attacker and every verified target (all five languages).
  for (const [motif, kind, reason] of [
    [rules.fork, 'fork_geometry', 'unproved_fork'],
    [rules.pin, 'absolute_pin', 'unproved_pin'],
  ] as const) {
    if (!motif.test(text)) continue;
    const movingPiece = after.get(movedTo);
    const attackerNamed = mentioned.some((p) => p.square === movedTo && p.type === movingPiece?.type);
    const proven = evidence.claims.filter((c) => c.evidence_type === kind && c.proof_status === 'verified');
    const targetsNamed = proven.some((c) => c.target_squares?.every((sq) => {
      const piece = after.get(sq as Square);
      return mentioned.some((p) => p.square === sq && p.type === piece?.type);
    }));
    if (!attackerNamed || !targetsNamed) fail.push(reason);
  }
  return { accepted: fail.length === 0, reasons: [...new Set(fail)] };
}

/** A phase or whole-game summary has no single evidentiary FEN; never promote
 *  its generated tactical claims to facts merely because the JSON parsed.
 *  General game-story prose is still allowed, with no false certification. */
export function screenUnanchoredProse(text: unknown, language: Language): boolean {
  if (typeof text !== 'string' || !text.trim() || text.length > 1800) return false;
  const motifs = MOTIFS[language] ?? MOTIFS.en;
  if (Object.values(motifs).some((r) => r.test(text))) return false;
  // Board-square claims also require a specific FEN not held by the summary.
  return !/(?:[\p{L}]{2,20})\s+(?:on|at|на|en|auf)\s+[a-h][1-8](?=$|[^a-z0-9])/iu.test(text);
}

/** Hints must not disclose a move or square before the student has tried.
 * This is intentionally stricter than reviewing completed mistakes: a
 * claim about tactics cannot be independently verified without a proposed
 * move. Stream consumers must call this BEFORE releasing any model text. */
export function screenHintProse(text: unknown, language: Language): boolean {
  if (!screenUnanchoredProse(text, language)) return false;
  // All SAN and UCI move notation contains a destination square. Reject even
  // a bare coordinate: telling the student 'look at g6' may spoil a retry.
  if (/(?:^|[^a-z0-9])[a-h][1-8](?:[a-h][1-8])?[nbrq]?(?=$|[^a-z0-9])/i.test(text as string)) return false;
  if (/(?:^|[^a-z0-9])(?:O-O(?:-O)?|0-0(?:-0)?)(?=$|[^a-z0-9])/i.test(text as string)) return false;
  // Exact squares are not the only spoiler: a model can give a disguised
  // instruction such as "Move your pawn forward". Reject clear imperative
  // piece moves in the five supported prose languages. This is a conservative
  // negative screen, not a complete semantic spoiler detector.
  const directMove: Record<Language, RegExp> = {
    en: /\b(?:move|play|push|advance|develop|castle|capture|take|sacrifice|trade)\s+(?:(?:your|the|a|an)\s+)?(?:king|queen|rook|bishop|knight|pawn)\b/i,
    bg: /(?:премести|изиграй|движи|вземи|пожертвай)\s+(?:(?:своя|своята|този|тази|една|един)\s+)?(?:пешк|кон|офицер|топ|дам|цар)[\p{L}]*/iu,
    es: /\b(?:mueve|juega|avanza|captura|sacrifica)\s+(?:(?:tu|el|la|un|una)\s+)?(?:rey|reina|dama|torre|alfil|caballo|pe[oó]n)\b/iu,
    de: /\b(?:zieh|spiele|bewege|schlage|opfere)\s+(?:(?:deinen?|deine|den|die|einen?|eine)\s+)?(?:k[oö]nig|dame|turm|l[aä]ufer|springer|bauer[n]?)\b/iu,
    ru: /(?:передвинь|двинь|сыграй|выведи|возьми|атакуй|пожертвуй)\s+(?:(?:свою|своего|своей|эту|этого)\s+)?(?:пешк|кон|слон|ладь|ферз|корол)[\p{L}]*/iu,
  };
  if (directMove[language].test(text as string)) return false;
  return true;
}
