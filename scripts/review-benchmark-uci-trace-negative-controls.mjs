#!/usr/bin/env node
// Fail-closed tests for the independent raw-UCI transcript auditor.
// No engine process, network or database required.
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { validateRawUciTrace } from './review-benchmark-uci-trace.mjs';

const fen=new Chess().fen();
const valid=[
 {direction:'command',sequence:0,fen,line:'position fen '+fen},
 {direction:'command',sequence:1,fen,line:'go depth 8'},
 {direction:'engine',sequence:1,fen,line:'info depth 8 multipv 1 score cp 20 pv e2e4 e7e5'},
 {direction:'engine',sequence:1,fen,line:'bestmove e2e4'}
];
const original=validateRawUciTrace(valid);
assert.deepEqual(original.findings,[], 'valid trace must be accepted');
assert.equal(original.metrics.legal_pv_lines,1);
const variants=[
 ['illegal second PV move',x=>x[2].line='info depth 8 multipv 1 score cp 20 pv e2e4 a1a8','illegal_raw_uci_pv'],
 ['illegal bestmove',x=>x[3].line='bestmove e2e5','illegal_raw_bestmove'],
 ['missing bestmove',x=>x.pop(),'search_missing_bestmove'],
 ['missing PV evidence',x=>x.splice(2,1),'search_missing_pv'],
 ['engine response FEN swapped',x=>x[2].fen='6k1/8/8/8/8/8/8/4K2Q w - - 0 1','uncorrelated_engine_response'],
 ['engine response stale sequence',x=>x[2].sequence=0,'uncorrelated_engine_response'],
 ['info without go',x=>{x.splice(1,1);x[1].sequence=0;x[2].sequence=0;},'pv_without_search'],
 ['bestmove without go',x=>{x.splice(1,2);x[1].sequence=0;},'bestmove_without_search']
];
for(const [name,mutate,expected] of variants){
 const bad=structuredClone(valid);mutate(bad);
 const out=validateRawUciTrace(bad);
 assert(out.findings.some(x=>x.reason===expected), name+': missing '+expected+' from '+JSON.stringify(out.findings));
 console.log('REJECTED:',name,'->',expected);
}
console.log(JSON.stringify({positive_accepted:1,corruptions_rejected:variants.length}));
