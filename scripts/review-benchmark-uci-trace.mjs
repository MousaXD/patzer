#!/usr/bin/env node
/**
 * Independently validate actual raw Stockfish/hostile UCI info and bestmove
 * responses captured by the disposable, byte-preserving benchmark proxy.
 * Never reads application-scored DTO fields as evidence of raw PV legality.
 */
import { readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Chess } from 'chess.js';

const root=resolve(import.meta.dirname,'..');
const results=join(root,'qa/review-excellence/results');
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return i<0?[x.slice(2),true]:[x.slice(2,i),x.slice(i+1)];}));
const match=/^[a-h][1-8][a-h][1-8][qrbn]?$/;
function legalUci(board,uci) {
 if(!match.test(uci))return false;
 try{return Boolean(board.move({from:uci.slice(0,2),to:uci.slice(2,4),...(uci.length===5?{promotion:uci[4]}:{})}));}
 catch{return false;}
}
export function validateRawUciTrace(rows) {
 const findings=[],metrics={traces:1,engine_info:0,pv_lines:0,legal_pv_lines:0,bestmove:0,search_commands:0};
 let fen=null,sequence=0;
 const searches=new Map();
 for(const row of rows) {
  if(row.direction==='command') {
   if(row.line.startsWith('go ')) {
    metrics.search_commands++;
    sequence=row.sequence;
    if(!fen) findings.push({reason:'search_without_position',sequence:row.sequence});
    if(searches.has(row.sequence)) findings.push({reason:'duplicate_search_sequence',sequence:row.sequence});
    searches.set(row.sequence,{fen,hasPv:false,hasBestmove:false});
   }
   if(row.line.startsWith('position ')) {
    fen=row.fen;sequence=row.sequence;
    try{new Chess(fen);}catch{findings.push({reason:'invalid_command_fen',sequence});}
   }
   continue;
  }
  if(row.direction!=='engine')continue;
  if(row.line.startsWith('id name '))continue;
  if(row.sequence!==sequence || row.fen!==fen) {
   findings.push({reason:'uncorrelated_engine_response',sequence:row.sequence});
   continue;
  }
  if(!row.fen||typeof row.fen!=='string') {
   findings.push({reason:'engine_response_without_fen',sequence:row.sequence});continue;
  }
  let game;
  try{game=new Chess(row.fen);}catch{findings.push({reason:'invalid_response_fen',sequence:row.sequence});continue;}
  if(row.line.startsWith('info ')) {
   metrics.engine_info++;
   const pv=row.line.match(/\bpv (.+)$/)?.[1];
   if(!pv)continue;
   metrics.pv_lines++;
   const active=searches.get(row.sequence);
   if(!active) findings.push({reason:'pv_without_search',sequence:row.sequence});
   else active.hasPv=true;
   let good=true;
   for(const move of pv.trim().split(/\s+/)) {
    if(!legalUci(game,move)) {
     findings.push({reason:'illegal_raw_uci_pv',sequence:row.sequence,move,fen:row.fen});
     good=false;break;
    }
   }
   if(good)metrics.legal_pv_lines++;
  } else if(row.line.startsWith('bestmove ')) {
   metrics.bestmove++;
   const active=searches.get(row.sequence);
   if(!active) findings.push({reason:'bestmove_without_search',sequence:row.sequence});
   else active.hasBestmove=true;
   const uci=row.line.slice('bestmove '.length).trim().split(' ')[0];
   if(uci==='(none)') {
    if(game.moves().length) findings.push({reason:'missing_legal_bestmove',sequence:row.sequence,fen:row.fen});
   } else if(!legalUci(game,uci)) findings.push({reason:'illegal_raw_bestmove',sequence:row.sequence,move:uci,fen:row.fen});
  }
 }
 for(const [seq,search] of searches) {
  if(!search.hasBestmove) findings.push({reason:'search_missing_bestmove',sequence:seq});
  if(search.fen) {
   let hasLegalMoves=true;
   try {hasLegalMoves=Boolean(new Chess(search.fen).moves().length);}catch{}
   if(hasLegalMoves&&!search.hasPv) findings.push({reason:'search_missing_pv',sequence:seq});
  }
 }
 return {metrics,findings};
}
if(process.argv[1] && resolve(process.argv[1])===resolve(import.meta.filename)) {
 const traceDir=realpathSync(args.dir||join(results,'proxy-trace'));
 if(!traceDir.startsWith(results+'/'))throw Error('trace-dir outside ignored results');
 const files=readdirSync(traceDir).filter(x=>x.endsWith('.jsonl')).sort();
 if(!files.length)throw Error('no UCI traces');
 const aggregate={files:files.length,engine_info:0,pv_lines:0,legal_pv_lines:0,bestmove:0,search_commands:0};
 const errors=[];
 for(const file of files) {
  const rows=readFileSync(join(traceDir,file),'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const {metrics,findings}=validateRawUciTrace(rows);
  for(const key of Object.keys(aggregate))if(key!=='files')aggregate[key]+=metrics[key]||0;
  errors.push(...findings.map(f=>({trace:file,...f})));
 }
 if(aggregate.search_commands < Number(args['min-searches']||1))errors.push({reason:'search_count_below_minimum'});
 if(!aggregate.pv_lines)errors.push({reason:'no_pv_evidence'});
 const result={schema_version:1,summary:aggregate,failures:errors,trace_source:'QA UCI raw subprocess output; no production data',engine_reference:'provided by QA runner, not inferred'};
 const out=resolve(args.out||join(results,'uci-raw-audit.json'));
 if(!out.startsWith(results+'/'))throw Error('report destination outside results');
 writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
 if(errors.length)process.exitCode=1;
}
