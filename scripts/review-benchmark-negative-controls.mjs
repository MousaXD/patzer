import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { validateEvidence } from './review-benchmark.mjs';
const fen = new Chess().fen();
const black = new Chess(); black.move('e4');
const valid = { fen, request_fen: fen, request_id: 'req-1', response_request_id: 'req-1', actor: 'w', best_move: 'e2e4', pv: ['e2e4', 'e7e5'], eval_cp_white: 50, eval_cp_actor: 50, win_pct_drop: 12, cp_loss: 160, is_best: false, classification: 'mistake', claims: [{ type: 'piece_on_square', square: 'e2', piece: 'p', color: 'w' }] };
assert.deepEqual(validateEvidence(valid), [], 'positive control must pass');
const variants = [
  ['illegal principal variation', { ...valid, pv: ['e2e5'] }, 'illegal_pv'],
  ['reversed White/Black evaluation', { ...valid, fen: black.fen(), request_fen: black.fen(), actor: 'b', eval_cp_actor: 50 }, 'eval_perspective_mismatch'],
  ['invented forced mate', { ...valid, mate_claim: { winner: 'w' } }, 'unsupported_mate_claim'],
  ['stale analysis response', { ...valid, response_request_id: 'req-0' }, 'stale_analysis_request'],
  ['inconsistent move classification', { ...valid, classification: 'best' }, 'classification_evidence_mismatch'],
  ['wrong side', { ...valid, actor: 'b' }, 'wrong_actor'],
  ['fabricated piece', { ...valid, claims: [{ type: 'piece_on_square', square: 'e4', piece: 'q', color: 'w' }] }, 'false_piece_claim']
];
for (const [name, input, expected] of variants) {
  const actual = validateEvidence(input);
  assert(actual.includes(expected), name + ': expected ' + expected + ', got ' + actual);
  console.log('REJECTED:', name, '(' + expected + ')');
}
console.log('PASS: 1 valid control accepted; ' + variants.length + ' corrupt controls rejected');
