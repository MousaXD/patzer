/**
 * Agent D's *independent* finite truth checker for actual written GameReview.
 *
 * It accepts the product's produced prose but does not import its coach,
 * lexicons, prompts, scoring, or chess-claim implementation. Every positive
 * verdict is about a narrow literal claim, not an entire fluent paragraph.
 */
import { Chess } from 'chess.js';

const pieceType={king:'k',queen:'q',rook:'r',bishop:'b',knight:'n',pawn:'p'};
const ownerColor={white:'w',black:'b'};
const bounded=(v)=>typeof v==='string'&&v.length<=10000;
const labelPart=(part,kind)=>({part,kind});
const winnerFromResult=result=>result==='1-0'?'white':result==='0-1'?'black':null;
function boardFromRecordedMove(move) {
 // Only the PGN supplies positions. A report-provided FEN could be a valid
 // but unrelated chess position specifically constructed to make false prose
 // appear truthful (verified QA bypass, checkpoint 24).
 if(!move?.before||!move?.after)return null;
 try {
  const before=new Chess(move.before);
  const after=new Chess(move.after);
  return [before,after];
 }catch{return null;}
}
function explicitMoveTime(text,claimStart){
 // Only a literal leading "Before/After the|this|that [played] move" clause
 // counts as a temporal assertion. No inferred adverbs, grammar translation,
 // imagined tense or loose paragraph-wide temporal resolution is allowed.
 const prefix=text.slice(0,claimStart);
 const match=prefix.match(/(?:^|[.!?]\s+|\n)\s*(Before|After)\s+(?:the|this|that)\s+(?:played\s+)?move\s*[:,]\s*$/i);
 if(match)return match[1].toLowerCase();
 // A more complex temporal phrase ("Before 2.g4", "After the capture")
 // must not silently fall back to *either* board and gain a positive proof.
 // Its semantics remain explicitly unassessed by this finite checker.
 if(/(?:^|[.!?]\s+|\n)\s*(?:Before|After)\b/i.test(prefix))return 'unresolved';
 return null;
}
export function validateWrittenGameReview({pgn, review, userColor='white'}){
 const findings=[],verified=[],unassessed=[];
 if(!bounded(pgn)||!review||!['white','black'].includes(userColor))return {status:'invalid_input',findings:[{reason:'invalid_review_input'}],verified,unassessed,full_factuality_certified:false};
 if(!Array.isArray(review.key_moments))return {status:'invalid_input',findings:[{reason:'missing_or_invalid_key_moments'}],verified,unassessed,full_factuality_certified:false};
 if(review.language!=='en')return {status:'not_evaluated',findings,verified,
  unassessed:[{reason:'language_not_supported_by_independent_checker',language:review.language??null}],
  full_factuality_certified:false,scope:'English-only finite claim checker'};
 let game;
 try{game=new Chess();game.loadPgn(pgn,{strict:true});}catch{return {status:'invalid_input',findings:[{reason:'source_pgn_invalid'}],verified,unassessed,full_factuality_certified:false};}
 const recorded=game.history({verbose:true});
 const momentBoards=new Map();
 for(const [index,moment] of review.key_moments.entries()){
  const field='moment:'+index;
  // Provenance is a required output condition, not a language interpretation.
  // Refuse unknown plies instead of accepting a fabricated but legal FEN/SAN.
  if(!Number.isSafeInteger(moment?.ply)||moment.ply<1||moment.ply>recorded.length){
   findings.push({reason:'moment_ply_out_of_source_range',field,claimed_ply:moment?.ply??null});
   continue;
  }
  const sourceMove=recorded[moment.ply-1];
  const sourceSide=sourceMove.color==='w'?'white':'black';
  if(moment.side!==sourceSide){
   findings.push({reason:'moment_side_conflicts_with_source_pgn',field,source_side:sourceSide,claimed_side:moment.side??null});
   continue;
  }
  if(moment.san!==sourceMove.san){
   findings.push({reason:'moment_move_conflicts_with_source_pgn',field,source_san:sourceMove.san,claimed_san:moment.san??null});
   continue;
  }
  if(moment.fen_before!==sourceMove.before){
   findings.push({reason:'moment_board_conflicts_with_source_pgn',field,source_fen:sourceMove.before,claimed_fen:moment.fen_before??null});
   continue;
  }
  const boards=boardFromRecordedMove(sourceMove);
  if(!boards){findings.push({reason:'source_move_not_replayable',field});continue;}
  momentBoards.set(index,boards);
 }
 const headerResult=game.header().Result||null;
 const forcedWinner=game.isCheckmate()?(game.turn()==='w'?'black':'white'):null;
 if(forcedWinner && winnerFromResult(headerResult)!==forcedWinner)findings.push({reason:'pgn_result_conflicts_with_mate',field:'pgn'});
 const winner=forcedWinner; // independent terminal replay, not metadata alone
 if(!winner)unassessed.push({reason:'nonterminal_result_not_independently_verified'});
 const sections=[
  labelPart('summary',review.summary),
  labelPart('skill_assessment',review.skill_assessment),
  labelPart('opening',review.opening?.prose),
  labelPart('phase:opening',review.phases?.opening?.prose),
  labelPart('phase:middlegame',review.phases?.middlegame?.prose),
  labelPart('phase:endgame',review.phases?.endgame?.prose),
 ];
 for(const [i,m] of (review.key_moments||[]).entries())sections.push(labelPart('moment:'+i,m?.prose));
 for(const {part,kind:text} of sections){
  if(!text)continue;
  if(!bounded(text)){findings.push({reason:'invalid_prose',field:part});continue;}
  // Post-game, unambiguous claims of which side won or lost.
  // Does not accept all paraphrases: unidentified claims stay *unassessed*.
  const actorPhrases=[...text.matchAll(/\b(White|Black)\s+(won|lost)\s+(?:the|this)\s+game\b/gi)];
  for(const m of actorPhrases) {
   const color=m[1].toLowerCase();
   const assertedWinner=m[2].toLowerCase()==='won'?color:(color==='white'?'black':'white');
   if(!winner){findings.push({reason:'result_claim_without_terminal_proof',field:part,claim:m[0]});continue;}
   if(assertedWinner!==winner)findings.push({reason:'contradicted_game_winner',field:part,claim:m[0],verified_winner:winner});
   else verified.push({field:part,type:'game_result',proof:'replay_checkmate'});
  }
  const userPhrases=[...text.matchAll(/\b(You|Your opponent)\s+(won|lost)\s+(?:the|this)\s+game\b/gi)];
  for(const m of userPhrases){
   const owner=m[1].toLowerCase()==='you'?userColor:(userColor==='white'?'black':'white');
   const assertedWinner=m[2].toLowerCase()==='won'?owner:(owner==='white'?'black':'white');
   if(!winner){findings.push({reason:'result_claim_without_terminal_proof',field:part,claim:m[0]});continue;}
   if(assertedWinner!==winner)findings.push({reason:'contradicted_game_winner',field:part,claim:m[0],verified_winner:winner});
   else verified.push({field:part,type:'game_result',proof:'replay_checkmate'});
  }
  // Strictly limited to explicitly named, localized board-state assertions.
  // A recognized "Before/After the move" prefix binds to the correct PGN
  // board. Without that prefix both pre- and post-move remain admissible:
  // this favors avoiding accusations over guessing temporal semantics.
  const pieceStatements=[...text.matchAll(/\b(White|Black)(?:['’]s)?\s+(king|queen|rook|bishop|knight|pawn)\s+(?:(?:is|was|stands|stood|sits|sat|remains|remained|currently|still|located|positioned)\s+){0,4}(?:on|at)\s+([a-h][1-8])\b/gi)];
  for(const m of pieceStatements) {
   const owner=m[1].toLowerCase(),piece=pieceType[m[2].toLowerCase()],square=m[3];
   const mindex=Number(part.split(':')[1]);
   const boards=part.startsWith('moment:')?momentBoards.get(mindex):null;
   if(!boards){unassessed.push({field:part,reason:'no_source_pgn_anchored_moment_board',claim:m[0]});continue;}
   const time=explicitMoveTime(text,m.index);
   if(time==='unresolved'){
    unassessed.push({field:part,reason:'unsupported_temporal_piece_reference',claim:m[0]});
    continue;
   }
   const possibleBoards=time==='before'?[boards[0]]:time==='after'?[boards[1]]:boards;
   if(!possibleBoards.some(b=>{const p=b.get(square);return p?.color===ownerColor[owner]&&p.type===piece;}))
    findings.push({reason:time?'contradicted_temporal_piece_location':'contradicted_piece_location',
     field:part,claim:m[0],source_ply:review.key_moments[mindex].ply,temporal_anchor:time});
   else verified.push({field:part,type:'piece_location',
    proof:time?'independent_source_pgn_'+time+'_move':'independent_source_pgn_move_replay'});
  }
 }
 if(!findings.length && !verified.length)unassessed.push({reason:'no_recognized_checkable_claims'});
 return {status:findings.length?'rejected':verified.length?'limited_claims_passed':'not_evaluated',findings,verified,unassessed,
   scope:'English literal result and explicit owner-piece-square claims with recognized Before/After the move anchors only, bound to legal source PGN replay. Unexamined prose is NOT certified.',
   result_proven_by_mate:!!forcedWinner,full_factuality_certified:false};
}
