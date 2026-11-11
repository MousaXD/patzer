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
function boardFromMoment(moment) {
 if(!moment?.fen_before||!moment?.san)return null;
 try {
  const before=new Chess(moment.fen_before);
  const after=new Chess(moment.fen_before);
  if(!after.move(moment.san))return null;
  return [before,after];
 }catch{return null;}
}
export function validateWrittenGameReview({pgn, review, userColor='white'}){
 const findings=[],verified=[],unassessed=[];
 if(!bounded(pgn)||!review||!['white','black'].includes(userColor))return {status:'invalid_input',findings:[{reason:'invalid_review_input'}],verified,unassessed};
 if(!Array.isArray(review.key_moments))return {status:'invalid_input',findings:[{reason:'missing_or_invalid_key_moments'}],verified,unassessed};
 if(review.language!=='en')return {status:'not_evaluated',findings,verified,
  unassessed:[{reason:'language_not_supported_by_independent_checker',language:review.language??null}],
  full_factuality_certified:false,scope:'English-only finite claim checker'};
 let game;
 try{game=new Chess();game.loadPgn(pgn,{strict:true});}catch{return {status:'invalid_input',findings:[{reason:'source_pgn_invalid'}],verified,unassessed};}
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
 for(const [i,m] of (review.key_moments||[]).entries())sections.push(labelPart('moment:'+i,m.prose));
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
  // Accept either pre- or post-move occupant if no temporal anchor is named;
  // this favors avoiding false accusations at the cost of missed temporal lies.
  const pieceStatements=[...text.matchAll(/\b(White|Black)(?:['’]s)?\s+(king|queen|rook|bishop|knight|pawn)\s+(?:(?:is|was|stands|stood|sits|sat|remains|remained|currently|still|located|positioned)\s+){0,4}(?:on|at)\s+([a-h][1-8])\b/gi)];
  for(const m of pieceStatements) {
   const owner=m[1].toLowerCase(),piece=pieceType[m[2].toLowerCase()],square=m[3];
   const mindex=Number(part.split(':')[1]);
   const moment=part.startsWith('moment:')?review.key_moments[mindex]:null;
   const boards=boardFromMoment(moment);
   if(!boards){unassessed.push({field:part,reason:'no_anchored_moment_board',claim:m[0]});continue;}
   if(!boards.some(b=>{const p=b.get(square);return p?.color===ownerColor[owner]&&p.type===piece;}))
    findings.push({reason:'contradicted_piece_location',field:part,claim:m[0],fen:moment.fen_before,move:moment.san});
   else verified.push({field:part,type:'piece_location',proof:'independent_fen_replay'});
  }
 }
 if(!findings.length && !verified.length)unassessed.push({reason:'no_recognized_checkable_claims'});
 return {status:findings.length?'rejected':verified.length?'limited_claims_passed':'not_evaluated',findings,verified,unassessed,
   scope:'English literal result and explicit owner-piece-square claims only. Unexamined prose is NOT certified.',
   result_proven_by_mate:!!forcedWinner,full_factuality_certified:false};
}
