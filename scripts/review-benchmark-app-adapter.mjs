// Independent consumer of Patzer's *actual* AnalysisResult shape.
// This code never imports an app scoring/classification implementation.
import { Chess } from 'chess.js';

const cls = new Set(['brilliant','great','best','excellent','good','book','forced','inaccuracy','mistake','blunder','miss']);
const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const winner = turn => turn === 'w' ? 'b' : 'w';

function moveUci(board, raw) {
  if (!uci.test(raw || '')) return null;
  try { return board.move({ from:raw.slice(0,2),to:raw.slice(2,4), ...(raw.length === 5 ? {promotion:raw[4]} : {}) }); } catch { return null; }
}
export function validateAppAnalysis(pgn, output, { fixtureId='unnamed', reference=null } = {}) {
  const failures=[];
  const add = (reason, ply=null) => failures.push({fixture_id:fixtureId,ply,reason});
  const source = new Chess();
  try { source.loadPgn(pgn, {strict:true}); } catch { return [{fixture_id:fixtureId,ply:null,reason:'source_pgn_invalid'}]; }
  const history = source.history({verbose:true});
  if (!output || !Array.isArray(output.moves)) return [{fixture_id:fixtureId,ply:null,reason:'missing_analysis_moves'}];
  if (output.moves.length !== history.length) add('move_count_mismatch');
  if (!Number.isInteger(output.depth) || output.depth < 0) add('missing_or_invalid_depth');
  for (const prop of ['accuracy_white','accuracy_black']) if (!finite(output[prop]) || output[prop]<0 || output[prop]>100) add('accuracy_out_of_range');
  const startFen = source.header().FEN || new Chess().fen();
  const replay = new Chess(startFen);
  const outputMoves = output.moves;
  for (let i=0; i<history.length; i++) {
    const raw = outputMoves[i], expected = history[i], before = replay.fen(), ply=i+1;
    if (!raw || !expected) { add('move_missing',ply); break; }
    if (raw.ply!==ply) add('wrong_ply',ply);
    if (raw.fen_before!==before) add('stale_fen_before',ply);
    if (raw.san!==expected.san) add('wrong_move_san',ply);
    if (raw.uci!==expected.from+expected.to+(expected.promotion||'')) add('wrong_move_uci',ply);
    const referenceBest=reference?.byPly?.[ply];
    if (raw.best_move_uci !== null && raw.best_move_uci !== undefined) {
      const probe=new Chess(before);
      const bm=moveUci(probe, raw.best_move_uci);
      if (!bm) add('illegal_best_uci',ply);
      else if (raw.best_move_san!==bm.san) add('best_uci_san_disagree',ply);
    } else if (raw.best_move_san) add('best_san_without_uci',ply);
    if (referenceBest?.best_move && !raw.best_move_uci && !new Chess(before).isGameOver()) add('missing_best_move_with_reference',ply);
    if (!Array.isArray(raw.best_pv)) add('missing_pv_list',ply);
    else {
      const line = new Chess(before);
      for (const san of raw.best_pv) {
        let next;
        try { next=line.move(san); } catch { next=null; }
        if (!next) { add('illegal_pv_san',ply); break; }
      }
      if (raw.best_pv.length>0 && raw.best_move_san && raw.best_pv[0] !== raw.best_move_san) add('pv_best_mismatch',ply);
    }
    const m=moveUci(replay, expected.from+expected.to+(expected.promotion||''));
    if (!m) {add('gold_pgn_replay_failure',ply);break;}
    if (raw.fen_after!==replay.fen()) add('stale_fen_after',ply);
    for (const score of ['eval_before_cp','eval_after_cp']) if (raw[score]!==null && !finite(raw[score])) add('bad_eval_cp',ply);
    for (const mate of ['mate_before','mate_after']) if (raw[mate]!==null && (!Number.isInteger(raw[mate])||Math.abs(raw[mate])>1000)) add('bad_mate',ply);
    if (!finite(raw.centipawn_loss)||raw.centipawn_loss<0) add('bad_centipawn_loss',ply);
    if (!cls.has(raw.classification)) add('unknown_classification',ply);
    if (raw.classification==='best' && raw.best_move_uci && raw.best_move_uci !== raw.uci) add('false_best_classification',ply);
    if (['great','brilliant'].includes(raw.classification) && raw.best_move_uci && raw.best_move_uci !== raw.uci) add('false_top_move_award',ply);
    if (raw.classification==='forced' && new Chess(before).moves().length!==1) add('false_forced_classification',ply);
    if (raw.classification==='best' && raw.centipawn_loss>300) add('best_with_extreme_loss',ply);
    if (raw.classification==='blunder' && raw.centipawn_loss===0 && raw.eval_before_cp===raw.eval_after_cp) add('false_blunder_classification',ply);
    if (i+1<outputMoves.length && outputMoves[i+1]?.eval_before_cp !==raw.eval_after_cp) add('eval_chain_break',ply);
    if (i+1<outputMoves.length && outputMoves[i+1]?.mate_before !==raw.mate_after) add('mate_chain_break',ply);
    // A claimed mate-in-one can be proved by legal move enumeration without any engine.
    // Mate-in-n for n>1 cannot be proved this way; requires separate bounded search.
    if (raw.mate_before!==null && Math.abs(raw.mate_before)===1) {
      const turn=before.split(' ')[1];
      if (Math.sign(raw.mate_before)===(turn==='w'?1:-1)) {
        const mateBoard=new Chess(before);
        const hasMateInOne=mateBoard.moves({verbose:true}).some(move=>{
          const copy=new Chess(before);
          copy.move(move);
          return copy.isCheckmate();
        });
        if (!hasMateInOne) add('false_mate_in_one',ply);
      }
    }
    if (referenceBest) {
      const score=raw.eval_before_cp;
      if (referenceBest.mate !== null && referenceBest.mate !== undefined) {
        const sign=referenceBest.mate * (before.split(' ')[1]==='w'?1:-1);
        if (sign && score !== null && score !== undefined && Math.sign(score)!==Math.sign(sign)) add('reference_mate_side_mismatch',ply);
      } else if (finite(referenceBest.cp) && Math.abs(referenceBest.cp)>=80 && finite(score)) {
        if (Math.sign(score)!==Math.sign(referenceBest.cp) && Math.abs(score)>=50) add('reference_evaluation_side_mismatch',ply);
      }
    }
  }
  if (Array.isArray(output.coach_claims)) {
    for (const claim of output.coach_claims) {
      const ply=claim.ply;
      const row=outputMoves[ply-1];
      if (!row || !['supported','not_supported'].includes(claim.status)) { add('unsupported_coach_claim_schema',ply); continue; }
      let board;
      try {board=new Chess(row.fen_before);} catch {add('coach_claim_invalid_fen',ply);continue;}
      if (claim.type==='piece_on_square') {
        const p=board.get(claim.square);
        if (!p || p.color!==claim.color || p.type!==claim.piece) add('unsupported_piece_claim',ply);
      } else if (claim.type==='legal_move') {
        if (!moveUci(board, claim.uci)) add('unsupported_legal_move_claim',ply);
      } else if (claim.type==='forced_mate') {
        if (!Array.isArray(claim.pv_uci)||!claim.pv_uci.length) {add('unsupported_forced_mate_claim',ply);continue;}
        for (const mv of claim.pv_uci) if (!moveUci(board,mv)){add('illegal_coach_pv',ply);break;}
        if (!board.isCheckmate()||winner(board.turn())!==claim.winner) add('unsupported_forced_mate_claim',ply);
      } else { add('unverifiable_coach_claim_type',ply); }
      if (claim.status!=='supported') add('coach_evidence_not_supported',ply);
    }
  }
  return failures;
}
