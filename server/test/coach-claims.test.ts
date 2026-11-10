import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  momentEvidence, replayLegalSan, screenCoachProse, screenHintProse, verifyCoachClaim,
  type ClaimType, type CoachClaimV1,
} from '../src/coach/claims.js';
import type { Language } from '../src/types.js';

const sch = new Chess();
for (const san of ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4']) sch.move(san);
const SCHOLAR = sch.fen(); // Black's 3...Nf6?? allows 4.Qxf7#
const scholar = momentEvidence(SCHOLAR, 'Nf6', 'g6', ['g6', 'Qf3']);

function claim(type: ClaimType, override: Partial<CoachClaimV1> = {}) {
  return verifyCoachClaim({
    claim_id: `case-${type}`, source_fen: SCHOLAR, actor: 'black',
    played_san: 'Nf6', evidence_type: type, ...override,
  });
}

describe('coach_claims_v1: independent legal proof, not plausible prose', () => {
  it('grounds the actor, legal played move and only the complete PV from the same FEN', () => {
    expect(scholar.status).toBe('verified');
    expect(scholar.actor).toBe('black');
    expect(scholar.legal_best_san).toBe('g6');
    expect(scholar.claims.find((c) => c.evidence_type === 'legal_variation')?.proof_status).toBe('verified');
    expect(claim('legal_move')).toMatchObject({ contract_version: 1, proof_status: 'verified', verified_line_san: ['Nf6'] });
    expect(claim('legal_move', { actor: 'white' }).reason).toBe('wrong_actor');
    expect(claim('legal_move', { played_san: 'Qxf7#' }).reason).toBe('illegal_played_move');
    expect(claim('legal_move', { source_fen: 'not-a-fen' }).reason).toBe('invalid_fen');
    expect(replayLegalSan(SCHOLAR, ['g6', 'Qf3'])).not.toBeNull();
    expect(replayLegalSan(SCHOLAR, ['g6', 'Qxf7#'])).toBeNull();
    expect(replayLegalSan(SCHOLAR, ['Nf6', 'Qxf7#', 'a6'])).toBeNull();
    expect(claim('legal_variation', { variation_san: ['g6', 'Qxf7#'] }).proof_status).toBe('contradicted');
    expect(claim('legal_variation', { variation_san: ['Nf6', 'Qxf7#'] }).proof_status).toBe('verified');
  });

  it('distinguishes a possible one-move mating reply from an inevitable forced mate', () => {
    const reply = claim('reply_mate_in_one', { variation_san: ['Qxf7#'] });
    expect(reply).toMatchObject({
      proof_status: 'verified', reason: 'opponent_can_choose_this_legal_reply_not_forced',
      verified_line_san: ['Nf6', 'Qxf7#'],
    });
    expect(claim('reply_mate_in_one', { variation_san: ['Qg4'] }).proof_status).toBe('contradicted');
    expect(claim('reply_mate_in_one').proof_status).toBe('insufficient_evidence');
    expect(claim('checkmate').proof_status).toBe('contradicted');
    expect(claim('forced_line', { variation_san: ['Nf6', 'Qxf7#'] }).proof_status).toBe('insufficient_evidence');
    expect(screenCoachProse('White can answer with Qxf7#, checkmate.', scholar, 'en').accepted).toBe(true);
    expect(screenCoachProse('White has a forced mate in 2.', scholar, 'en').reasons).toContain('unproved_forcing');
  });

  it('refuses invented fork, pin, hanging-piece, threat and material claims', () => {
    const cases = [
      ['The knight forks the queen and rook.', 'unproved_fork'],
      ['The bishop pins the knight to the king.', 'unproved_pin'],
      ['The queen is hanging.', 'unproved_hanging'],
      ['A threat wins the rook.', 'unproved_threat'],
      ['This wins material.', 'unproved_material_gain'],
      ['It is guaranteed to win.', 'unproved_forcing'],
      ['Your bishop on a3 attacks the king.', 'piece_on_wrong_square'],
    ];
    for (const [text, expected] of cases) {
      expect(screenCoachProse(text!, scholar, 'en').reasons, text).toContain(expected);
    }
    for (const type of ['threat', 'hanging_piece', 'material_win', 'forced_line'] as const) {
      expect(claim(type).proof_status).toBe('insufficient_evidence');
    }
  });

  it('does not mistake a legal capture for a guaranteed material profit', () => {
    const c = new Chess();
    c.move('e4'); c.move('d5');
    const fen = c.fen();
    const capture = verifyCoachClaim({ claim_id: 'capture', source_fen: fen, actor: 'white', played_san: 'exd5', evidence_type: 'capture' });
    const profit = verifyCoachClaim({ ...capture, claim_id: 'profit', evidence_type: 'material_win' });
    expect(capture).toMatchObject({ proof_status: 'verified', proof_method: 'legal_replay' });
    expect(profit).toMatchObject({ proof_status: 'insufficient_evidence' });
    expect(claim('capture').proof_status).toBe('contradicted');
    // Qxf7# really *is* a pawn capture; legal checks must not get rejected.
    expect(claim('reply_capture', { variation_san: ['Qxf7#'] }).proof_status).toBe('verified');
    expect(claim('reply_capture', { variation_san: ['Qg4'] }).proof_status).toBe('contradicted');
  });

  it('checks double-attack geometry without asserting a profitable fork', () => {
    const c = new Chess();
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6']) c.move(san);
    const fen = c.fen();
    const evidence = momentEvidence(fen, 'Nd5', null);
    expect(evidence.claims.find((e) => e.evidence_type === 'fork_geometry')?.target_squares).toEqual(expect.arrayContaining(['c7', 'f6']));
    expect(verifyCoachClaim({
      claim_id: 'knight-fork', source_fen: fen, played_san: 'Nd5',
      actor: 'white', evidence_type: 'fork_geometry', target_squares: ['c7', 'f6'],
    }).proof_status).toBe('verified');
    expect(verifyCoachClaim({
      claim_id: 'not-a-fork', source_fen: fen, played_san: 'Nd5',
      actor: 'white', evidence_type: 'fork_geometry', target_squares: ['d8', 'h8'],
    }).proof_status).toBe('contradicted');
    expect(screenCoachProse('The knight on d5 forks the pawn on c7 and knight on f6.', evidence, 'en').accepted).toBe(true);
    expect(screenCoachProse('The knight forks two pieces.', evidence, 'en').accepted).toBe(false);
    expect(screenCoachProse('The bishop forks two pieces: c7 f6.', evidence, 'en').accepted).toBe(false);
    expect(screenCoachProse('The knight on d5 forks the queen on c7 and rook on f6.', evidence, 'en').accepted).toBe(false);
    expect(screenCoachProse('The knight forks the pawn on c7 and knight on f6 and wins material.', evidence, 'en').accepted).toBe(false);
  });

  it('verifies only an absolute pin backed by the source position', () => {
    const fen = '4k3/4n3/8/8/8/8/8/4R1K1 w - - 0 1';
    const ev = momentEvidence(fen, 'Re2', null);
    expect(ev.claims.find((c) => c.evidence_type === 'absolute_pin')?.target_squares).toEqual(['e7']);
    expect(verifyCoachClaim({
      claim_id: 'pinned-knight', source_fen: fen, actor: 'white', played_san: 'Re2',
      evidence_type: 'absolute_pin', target_squares: ['e7'],
    }).proof_status).toBe('verified');
    expect(verifyCoachClaim({
      claim_id: 'imaginary-pin', source_fen: fen, actor: 'white', played_san: 'Re2',
      evidence_type: 'absolute_pin', target_squares: ['e6'],
    }).proof_status).toBe('contradicted');
    expect(screenCoachProse('The rook on e2 pins the knight on e7.', ev, 'en').accepted).toBe(true);
    expect(screenCoachProse('The rook pins the knight.', ev, 'en').accepted).toBe(false);
    expect(screenCoachProse('The rook pins the knight on e7 and must win it.', ev, 'en').accepted).toBe(false);
  });

  it('rejects five-language unsupported tactical claims and malformed contexts', () => {
    const samples: Record<Language, string> = {
      en: 'The bishop pins the knight.',
      bg: 'Офицерът прави вилица.',
      es: 'El alfil hace un tenedor.',
      de: 'Der Läufer spielt eine Gabel.',
      ru: 'Слон делает вилку.',
    };
    for (const [lang, prose] of Object.entries(samples) as [Language, string][]) {
      expect(screenCoachProse(prose, scholar, lang).accepted, lang).toBe(false);
    }
    expect(screenCoachProse('x', { ...scholar, status: 'contradicted' }, 'en').accepted).toBe(false);
    expect(screenCoachProse('x'.repeat(2100), scholar, 'en').accepted).toBe(false);
  });

  it('does not let a real checkmate elsewhere authorize invented SAN or the wrong player', () => {
    const supported = 'Black played Nf6. White could reply with Qxf7#, checkmate.';
    expect(screenCoachProse(supported, scholar, 'en').accepted).toBe(true);
    expect(screenCoachProse('Black played Nf6. White could checkmate with Qh4#.', scholar, 'en').accepted).toBe(false);
    expect(screenCoachProse('White played Nf6. Black could reply with Qxf7#, checkmate.', scholar, 'en').accepted).toBe(false);
    expect(screenCoachProse('Black played Nf6. White played Qxf7#, checkmate.', scholar, 'en').accepted).toBe(false); // possible reply is not proof of actual game move
    expect(screenCoachProse('Black played Qxf7#, checkmate.', scholar, 'en').accepted).toBe(false);
    expect(screenCoachProse('White could reply with Qxf7#, checkmate.', scholar, 'en').accepted).toBe(true);
    expect(screenCoachProse('Black played Nf6. Black can give checkmate with Qxf7#.', scholar, 'en').accepted).toBe(false);
    expect(screenCoachProse('Black\'s queen on h5 is exposed.', scholar, 'en').accepted).toBe(false);
    // SAN is shared notation across the five supported prose languages.
    for (const [lang, sentence] of [
      ['en', 'White could win by Qh4#.'],
      ['bg', 'Белите могат да играят Qh4# и дават мат.'],
      ['es', 'Las blancas juegan Qh4# y dan mate.'],
      ['de', 'Weiß könnte Qh4# spielen und mattsetzen.'],
      ['ru', 'Белые могут сыграть Qh4# и поставить мат.'],
    ] as const) {
      expect(screenCoachProse(sentence, scholar, lang).reasons, lang).toContain('unverified_named_move');
    }
  });

  it('does not turn a coaching hint into an implicit natural-language move spoiler', () => {
    const spoilers = {
      en: 'Move your pawn forward on the kingside.',
      bg: 'Премести пешката напред по царския фланг.',
      es: 'Mueve tu peón hacia adelante.',
      de: 'Zieh deinen Bauern nach vorne.',
      ru: 'Передвинь пешку вперёд.',
    } as const;
    for (const [lang, sentence] of Object.entries(spoilers) as [Language, string][]) {
      expect(screenHintProse(sentence, lang), `${lang}: ${sentence}`).toBe(false);
    }
    expect(screenHintProse('Before you move, compare checks and captures for both sides. What is your opponent threatening?', 'en')).toBe(false); // unverified threat
    expect(screenHintProse('Before moving, compare checks and captures for both sides. How might your opponent reply?', 'en')).toBe(true);
  });

  it('does not silently reverse the mover in non-English reviews', () => {
    for (const [lang, wrong, trueActor, unsupportedPast] of [
      ['bg', 'Белите изиграха Nf6.', 'Черните изиграха Nf6.', 'Белите изиграха Qxf7#.'],
      ['es', 'Las blancas jugaron Nf6.', 'Las negras jugaron Nf6.', 'Las blancas jugaron Qxf7#.'],
      ['de', 'Weiß spielte Nf6.', 'Schwarz spielte Nf6.', 'Weiß spielte Qxf7#.'],
      ['ru', 'Белые сыграли Nf6.', 'Чёрные сыграли Nf6.', 'Белые сыграли Qxf7#.'],
    ] as const) {
      expect(screenCoachProse(wrong, scholar, lang).accepted, `${lang} wrong actor`).toBe(false);
      expect(screenCoachProse(trueActor, scholar, lang).accepted, `${lang} correct actor`).toBe(true);
      expect(screenCoachProse(unsupportedPast, scholar, lang).accepted, `${lang} unproven played reply`).toBe(false);
    }
  });

  it('assigns stable distinct claim IDs when the opponent has multiple captures', () => {
    const fen = '4k3/8/8/8/2p1p3/3P4/8/4K3 w - - 0 1';
    const first = momentEvidence(fen, 'Ke2', null);
    const captureClaims = first.claims.filter((c) => c.evidence_type === 'reply_capture');
    expect(captureClaims.map((c) => c.variation_san?.[0])).toEqual(expect.arrayContaining(['cxd3+', 'exd3+']));
    expect(new Set(captureClaims.map((c) => c.claim_id)).size).toBe(captureClaims.length);
    expect(first.claims.map((c) => c.claim_id)).toEqual(momentEvidence(fen, 'Ke2', null).claims.map((c) => c.claim_id));
    expect(momentEvidence(fen, 'Kd2', null).claims[0]?.claim_id).not.toBe(first.claims[0]?.claim_id);
  });
});
