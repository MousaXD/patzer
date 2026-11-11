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
function impossibleSourceStartReason(startFen){
 // chess.js validates FEN *syntax*, not all one-ply reachability invariants.
 // In particular it permits adjacent kings, an attacked king belonging to
 // the player who just moved, missing rooks despite castling rights, and
 // >8 pawns or >16 pieces of one color. Never let such a position create a
 // positive or contradictory factuality verdict for a supposedly legal PGN.
 const source=new Chess(startFen);
 const [placement,turn,castling,enPassant]=startFen.split(' ');
 if(!placement||!['w','b'].includes(turn)||!castling||!enPassant)
  return 'missing_source_fen_fields';
 const board=source.board().flat().filter(Boolean);
 for(const color of ['w','b']){
  const pieces=board.filter(p=>p.color===color);
  if(pieces.length>16)return 'more_than_sixteen_pieces_per_side';
  if(pieces.filter(p=>p.type==='p').length>8)return 'more_than_eight_pawns_per_side';
 }
 for(const [right,kingSquare,rookSquare,color] of [
  ['K','e1','h1','w'],['Q','e1','a1','w'],
  ['k','e8','h8','b'],['q','e8','a8','b']]){
  if(!castling.includes(right))continue;
  const king=source.get(kingSquare),rook=source.get(rookSquare);
  if(king?.type!=='k'||king.color!==color||rook?.type!=='r'||rook.color!==color)
   return 'castling_rights_without_home_king_and_rook';
 }
 if(enPassant!=='-'){
  // An EP target need not be legally capturable: traditional FEN can include
  // the square after a double pawn push even without a neighboring pawn.
  // But the pawn which supposedly just double-moved *must exist* on the
  // corresponding rank, and its departure/landing squares must be empty.
  const file=enPassant[0];
  const rank=turn==='w'?'6':'3';
  const movedColor=turn==='w'?'b':'w';
  const pawnRank=turn==='w'?'5':'4';
  const originRank=turn==='w'?'7':'2';
  const pawn=source.get(file+pawnRank);
  if(enPassant[1]!==rank||pawn?.type!=='p'||pawn.color!==movedColor||
   source.get(file+originRank)||source.get(enPassant))
   return 'en_passant_target_without_previous_double_pawn_push';
 }
 // In any legal standard-chess position, only the player whose turn it is
 // may be in check. Invert the turn (not the pieces) and clear EP, which is
 // side-to-move-specific, to test the non-moving king's attack status.
 const switched=startFen.split(' ');
 switched[1]=turn==='w'?'b':'w';
 switched[3]='-';
 if(new Chess(switched.join(' ')).isCheck())
  return 'king_of_side_not_to_move_in_check';
 return null;
}
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
function positionIdentityFromFen(fen){
 // FIDE 9.2.3: position equality depends on side, piece locations and legal
 // castling/en-passant possibilities, not move clocks. An uncapturable ep
 // target has no effect on legal moves and must not split one position.
 const fields=fen.split(' ');
 if(fields.length<6)return null;
 if(fields[3]!=='-'){
  const board=new Chess(fen);
  if(!board.moves({verbose:true}).some(move=>move.flags.includes('e')))
   fields[3]='-';
 }
 return fields.slice(0,4).join(' ');
}
function sourceDrawEvidence(game,recorded){
 const boardDraw=game.isStalemate()||game.isInsufficientMaterial();
 // Independently replay every recorded position: chess.js isDraw() alone
 // conflates *claimable* threefold/50-move draws with automatic endings.
 const seen=new Map();
 const positions=recorded.length?
  [recorded[0].before,...recorded.map(move=>move.after)]:[game.fen()];
 let maxPositionOccurrences=0;
 let reversibleStreak=0,maximumSourceStreak=0;
 let prematureAutomaticEnding=null;
 for(const [ply,fen] of positions.entries()){
  if(ply>0){
   const move=recorded[ply-1];
   reversibleStreak=move.piece==='p'||move.captured?0:reversibleStreak+1;
   maximumSourceStreak=Math.max(maximumSourceStreak,reversibleStreak);
  }
  const identity=positionIdentityFromFen(fen);
  if(!identity)continue;
  const count=(seen.get(identity)||0)+1;
  seen.set(identity,count);
  maxPositionOccurrences=Math.max(maxPositionOccurrences,count);
  // FIDE 5.1, 5.2 and 9.6 end a game *immediately*. chess.js's PGN
  // replay may still accept additional legal SAN after fivefold, 75 moves,
  // or a dead position. A later checkmate is not a legal game winner. Do not
  // certify a source that already ended BEFORE one of its recorded moves.
  // Claimable threefold/50-move draws are deliberately NOT included here.
  if(ply<recorded.length&&!prematureAutomaticEnding){
   const board=new Chess(fen);
   const reason=board.isCheckmate()?'checkmate':
    board.isStalemate()?'stalemate':
    board.isInsufficientMaterial()?'dead_position':
    count>=5?'fivefold_repetition':
    reversibleStreak>=150?'seventy_five_move_rule':null;
   if(reason)prematureAutomaticEnding={first_ending_ply:ply,
    ending_kind:reason,later_moves:recorded.length-ply};
  }
 }
 // A custom FEN's halfmove clock is an assertion about *unseen* history, not
 // independently replayed evidence of 75 moves by each side. Count source
 // moves since a pawn move/capture, ignoring the imported clock completely.
 const automaticFivefold=maxPositionOccurrences>=5;
 const automaticSeventyFive=maximumSourceStreak>=150;
 const sourceProvenDraw=boardDraw||automaticFivefold||automaticSeventyFive;
 const claimableOnly=!sourceProvenDraw&&
  (game.isThreefoldRepetition()||game.isDrawByFiftyMoves());
 return {boardDraw,sourceProvenDraw,claimableOnly,automaticFivefold,
  prematureAutomaticEnding,
  automaticSeventyFive,maxPositionOccurrences,maximumSourceStreak};
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
function isQuotedOrDisavowed(text,claimStart){
 // This verifier is a *literal-claim* checker, not a quotation/negation
 // parser. Abstain on specific recognizable meta-language instead of
 // misclassifying a quoted or explicitly denied sentence as an assertion.
 const prefix=text.slice(0,claimStart);
 const before=prefix.trimEnd();
 if(/[“‘«]$/.test(before))return true; // directional OPEN quote
 // Straight ASCII quotes can also be CLOSING quotes. A quote directly before
 // the next, independently asserted sentence must not suppress that claim.
 if(before.endsWith('"')&&(before.match(/"/g)||[]).length%2===1)return true;
 if(before.endsWith("'")&&(before.match(/'/g)||[]).length%2===1)return true;
 const boundaries=[...prefix.matchAll(/[.!?]\s+|\n/g)];
 const last=boundaries.at(-1);
 const at=last?last.index+last[0].length:0;
 // Ignore only non-word-leading ornamentation (e.g. a leading emoji or
 // bullet), not words that may change the statement's actual semantics.
 const context=prefix.slice(at).replace(/^[^\p{L}\p{N}]+/u,'').trimStart();
 return /^(?:(?:It\s+(?:is|was)\s+(?:false|wrong|incorrect)\s+that)|(?:It\s+would\s+be\s+(?:false|wrong|incorrect)\s+to\s+say(?:\s+that)?)|(?:Do\s+not\s+(?:say|claim|write)(?:\s+that)?)|(?:Never\s+(?:say|claim)(?:\s+that)?))\s*$/i.test(context);
}
function isHypotheticalOrConditional(text,claimStart,claimEnd){
 // An explicitly conditional/questioned chess claim is not an assertion
 // about the played PGN. This is a *conservative abstention* from a handful
 // of lexical forms, not natural-language entailment or modal parsing.
 // Constrain the scan to the current sentence: a prior hypothetical should
 // never shield a separate later direct contradiction.
 const before=text.slice(0,claimStart);
 const boundaries=[...before.matchAll(/[.!?]\s+|\n/g)];
 const preceding=boundaries.at(-1);
 const start=preceding?preceding.index+preceding[0].length:0;
 const currentPrefix=text.slice(start,claimStart);
 const rest=text.slice(claimEnd);
 const ending=rest.search(/[.!?](?:\s|$)|\n/);
 const currentSuffix=ending<0?rest:rest.slice(0,ending);
 // Exact immediate antecedent, including clause-introducing parentheses.
 if(/(?:^|[\s,(])(?:if|what\s+if|suppose|imagine|assume|assuming|pretend|hypothetically|provided|consider|maybe|perhaps|possibly|allegedly)\s+(?:that\s+)?$/i.test(currentPrefix))return true;
 if(/(?:^|[\s,(])were\s+it\s+true\s+that\s+$/i.test(currentPrefix))return true;
 // If a question, hypothetical, or conditional prefix governs this whole
 // sentence, even a second literal in that sentence is not proven asserted.
 if(/^\s*(?:if|what\s+if|suppose|imagine|assume|pretend|assuming|hypothetically|maybe|perhaps|possibly|allegedly)\b/i.test(currentPrefix))return true;
 if(/^\s*(?:[,;:—–-]\s*|\(\s*)?(?:if|only\s+if|even\s+if|unless|provided\s+that|assuming\s+that)\b/i.test(currentSuffix))return true;
 if(/^\s*\?/.test(rest))return true;
 return false;
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
 let impossibleStart;
 try{
  impossibleStart=impossibleSourceStartReason(
   game.header().SetUp==='1'&&game.header().FEN?
    game.header().FEN:(recorded[0]?.before||game.fen()));
 }catch{
  impossibleStart='source_initial_fen_not_replayable';
 }
 if(impossibleStart)return {status:'invalid_input',
  findings:[{reason:'source_start_position_impossible',detail:impossibleStart}],
  verified,unassessed,full_factuality_certified:false};
 const drawEvidence=sourceDrawEvidence(game,recorded);
 if(drawEvidence.prematureAutomaticEnding)return {status:'invalid_input',
  findings:[{reason:'source_continues_after_automatic_game_end',
   ...drawEvidence.prematureAutomaticEnding}],verified,unassessed,
  full_factuality_certified:false};
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
 const provenDraw=!forcedWinner&&drawEvidence.sourceProvenDraw;
 // A missing or '*' PGN Result tag is not an affirmative result claim.
 // Chess-law replay is still sufficient to verify a checkmated winner; only
 // an explicitly conflicting declared result merits a source contradiction.
 if(forcedWinner&&['1-0','0-1','1/2-1/2'].includes(headerResult)
  &&winnerFromResult(headerResult)!==forcedWinner)
  findings.push({reason:'pgn_result_conflicts_with_mate',field:'pgn',header_result:headerResult});
 // '*' means unknown/unfinished metadata, not an asserted wrong winner.
 // Only an explicitly *decisive* PGN tag contradicts a proven drawn board.
 if(provenDraw&&['1-0','0-1'].includes(headerResult))findings.push({reason:'pgn_result_conflicts_with_terminal_draw',field:'pgn',header_result:headerResult});
 const winner=forcedWinner; // independent terminal replay, not metadata alone
 // Resignations, time forfeits, draw claims and agreements are not derivable
 // from the PGN move list. In particular, THREE repetitions and FIFTY moves
 // by each side require a claim; FIVE repetitions and SEVENTY-FIVE moves by
 // each side are automatic under FIDE 9.6. Never use chess.js isDraw() alone
 // as proof: it includes claimable draws (real QA false rejection).
 if(!winner&&!provenDraw)unassessed.push({reason:'nonterminal_result_not_independently_verified'});
 if(!winner&&drawEvidence.claimableOnly)
  unassessed.push({reason:'claimable_draw_not_automatic_without_recorded_claim'});
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
  const checkedSpans=[];
  const register=(m)=>checkedSpans.push([m.index,m.index+m[0].length]);
  // Post-game, unambiguous claims of which side won or lost.
  // Does not accept all paraphrases: unidentified claims stay *unassessed*.
  const actorPhrases=[...text.matchAll(/\b(White|Black)\s+(won|lost)\s+(?:the|this)\s+game\b/gi)];
  for(const m of actorPhrases) {
   register(m);
   if(isHypotheticalOrConditional(text,m.index,m.index+m[0].length)){
    unassessed.push({field:part,reason:'hypothetical_or_conditional_result_not_assessed',claim:m[0]});
    continue;
   }
   if(isQuotedOrDisavowed(text,m.index)){
    unassessed.push({field:part,reason:'quoted_or_disavowed_result_not_assessed',claim:m[0]});
    continue;
   }
   const color=m[1].toLowerCase();
   const assertedWinner=m[2].toLowerCase()==='won'?color:(color==='white'?'black':'white');
   if(provenDraw){findings.push({reason:'contradicted_terminal_draw_winner',field:part,claim:m[0],verified_result:'1/2-1/2'});continue;}
   if(!winner){unassessed.push({reason:'winner_not_independently_proven_from_nonterminal_pgn',field:part,claim:m[0]});continue;}
   if(assertedWinner!==winner)findings.push({reason:'contradicted_game_winner',field:part,claim:m[0],verified_winner:winner});
   else verified.push({field:part,type:'game_result',proof:'replay_checkmate'});
  }
  const userPhrases=[...text.matchAll(/\b(You|Your opponent)\s+(won|lost)\s+(?:the|this)\s+game\b/gi)];
  for(const m of userPhrases){
   register(m);
   if(isHypotheticalOrConditional(text,m.index,m.index+m[0].length)){
    unassessed.push({field:part,reason:'hypothetical_or_conditional_result_not_assessed',claim:m[0]});
    continue;
   }
   if(isQuotedOrDisavowed(text,m.index)){
    unassessed.push({field:part,reason:'quoted_or_disavowed_result_not_assessed',claim:m[0]});
    continue;
   }
   const owner=m[1].toLowerCase()==='you'?userColor:(userColor==='white'?'black':'white');
   const assertedWinner=m[2].toLowerCase()==='won'?owner:(owner==='white'?'black':'white');
   if(provenDraw){findings.push({reason:'contradicted_terminal_draw_winner',field:part,claim:m[0],verified_result:'1/2-1/2'});continue;}
   if(!winner){unassessed.push({reason:'winner_not_independently_proven_from_nonterminal_pgn',field:part,claim:m[0]});continue;}
   if(assertedWinner!==winner)findings.push({reason:'contradicted_game_winner',field:part,claim:m[0],verified_winner:winner});
   else verified.push({field:part,type:'game_result',proof:'replay_checkmate'});
  }
  // Strictly limited to explicitly named, localized board-state assertions.
  // A recognized "Before/After the move" prefix binds to the correct PGN
  // board. Without that prefix both pre- and post-move remain admissible:
  // this favors avoiding accusations over guessing temporal semantics.
  const pieceStatements=[...text.matchAll(/\b(White|Black)(?:['’]s)?\s+(king|queen|rook|bishop|knight|pawn)\s+(?:(?:is|was|stands|stood|sits|sat|remains|remained|currently|still|located|positioned)\s+){0,4}(?:on|at)\s+([a-h][1-8])\b/gi)];
  for(const m of pieceStatements) {
   register(m);
   if(isHypotheticalOrConditional(text,m.index,m.index+m[0].length)){
    unassessed.push({field:part,reason:'hypothetical_or_conditional_piece_not_assessed',claim:m[0]});
    continue;
   }
   if(isQuotedOrDisavowed(text,m.index)){
    unassessed.push({field:part,reason:'quoted_or_disavowed_piece_not_assessed',claim:m[0]});
    continue;
   }
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
  // Checked spans are the *only* text the finite lexical adapter assessed.
  // An unrelated sentence or an unsupported paraphrase in the same review
  // must not vanish from its uncertainty report merely because a different
  // literal claim was true. Record uncertainty even for unsupported sections
  // (including skill assessment and pedagogical explanations).
  // RegExp match indices are UTF-16 code-unit offsets. split('') deliberately
  // uses the same coordinate system; [...text] counts astral Unicode scalars
  // and would erase the wrong spans after emoji or other surrogate pairs.
  const unchecked=text.split('');
  for(const [start,end] of checkedSpans)unchecked.fill(' ',start,end);
  const remainder=unchecked.join('');
  if(/[\p{L}\p{N}]/u.test(remainder))
   unassessed.push({field:part,reason:'unchecked_prose_remainder',
    remaining_character_count:[...remainder.trim()].length});
 }
 if(!findings.length && !verified.length)unassessed.push({reason:'no_recognized_checkable_claims'});
 return {status:findings.length?'rejected':verified.length?
  (unassessed.length?'partial_claims_verified':'limited_claims_passed'):'not_evaluated',
  findings,verified,unassessed,
   scope:'English literal result and explicit owner-piece-square claims with recognized Before/After the move anchors only, bound to legal source PGN replay. PGN metadata alone cannot prove resignation, clock loss or claimed draws. FIDE automatic fivefold/75-move endings differ from claimable threefold/50-move draws. Quoted, denied, hypothetical and conditional contexts are not evaluated. Partial/unrecognized prose is NOT certified.',
   result_proven_by_mate:!!forcedWinner,
   draw_proven_by_board:!forcedWinner&&drawEvidence.boardDraw,
   automatic_draw_proven_from_source:provenDraw,
   draw_claimable_only:!forcedWinner&&drawEvidence.claimableOnly,
   automatic_fivefold_replay:drawEvidence.automaticFivefold,
   automatic_seventy_five_replay:drawEvidence.automaticSeventyFive,
   max_source_position_occurrences:drawEvidence.maxPositionOccurrences,
   max_source_reversible_halfmoves:drawEvidence.maximumSourceStreak,
   full_factuality_certified:false};
}
