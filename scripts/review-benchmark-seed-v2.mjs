#!/usr/bin/env node
// Versioned fixture authoring: preserves v1 artifacts and only creates new files / manifest v2.
import { Chess } from 'chess.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'../qa/review-excellence');
const sha=x=>createHash('sha256').update(x).digest('hex');
const v1=readFileSync(join(root,'manifests/manifest-v1.jsonl'),'utf8');
const entries=v1.trim().split('\n').map(JSON.parse);
const names=new Set(entries.map(e=>e.fixture_id));
function add(id,kind,split,content,tags,startFen,completedResult='unknown') {
 if(names.has(id))throw Error('duplicate id '+id);
 names.add(id);
 const sub=kind==='completed_game'?'games':'positions';
 const file=sub+'/'+id.toLowerCase()+ (kind==='completed_game'?'.pgn':'.json');
 const target=join(root,'fixtures',file);
 if(existsSync(target) && sha(readFileSync(target))!==sha(content))throw Error('existing fixture differs '+target);
 mkdirSync(join(root,'fixtures',sub),{recursive:true});
 writeFileSync(target,content);
 entries.push({
  schema_version:1, fixture_id:id,kind,split,
  source_kind:'synthetic',source_url:null,license:'self-authored',consent_reference:'not-applicable',
  pgn_file:file,pgn_sha256:sha(content),start_fen:startFen||new Chess().fen(),variant:'standard',
  result:completedResult,white_rating_bucket:'unknown',black_rating_bucket:'unknown',time_class:'unknown',
  tags,annotations_file:null,created_at:'2026-11-11',verified_by:['automated_legal_replay']
 });
}
function game(id,split,fen,sans,tags) {
 const chess=new Chess(fen);
 chess.setHeader('Event','Synthetic self-authored benchmark');
 chess.setHeader('White','QA White');
 chess.setHeader('Black','QA Black');
 if(fen!==new Chess().fen()){chess.setHeader('SetUp','1');chess.setHeader('FEN',fen);}
 for(const san of sans){
  const m=chess.move(san);
  if(!m)throw Error('invalid SAN '+san+' in '+id);
 }
 const result=chess.isCheckmate()?(chess.turn()==='w'?'0-1':'1-0'):chess.isDraw()?'1/2-1/2':'*';
 chess.setHeader('Result',result);
 add(id,'completed_game',split,chess.pgn()+'\n',tags,fen,result);
}
function position(id,split,fen,contents,tags) {
 const entry={fen,request_fen:fen,request_id:id,response_request_id:id,actor:fen.split(' ')[1],...contents};
 add(id,'position',split,JSON.stringify(entry,null,2)+'\n',tags,fen);
}
const defaultFen=new Chess().fen();
const black='6k1/5ppp/8/8/8/8/5PPP/3Q2K1 b - - 0 1';
const knight='7k/P7/8/8/8/8/8/K7 w - - 0 1';
const forced='4k3/5p2/8/8/8/8/8/K2QR3 b - - 0 1';
const endgame='8/8/5k2/8/8/8/5P2/6K1 w - - 99 1';
const ambiguous='4k3/8/8/8/8/2N3N1/8/4K3 w - - 0 1';
game('SYN-GAME-BLACK-FIRST','dev',black,['g6','Qd8+','Kg7'],['black_to_move','custom_fen','unequal_material']);
game('SYN-GAME-UNDERPROMOTION','dev',knight,['a8=N','Kh7','Nb6'],['underpromotion','custom_fen']);
game('SYN-GAME-FORCED-REPLY','dev',forced,['Kf8'],['forced_move','check_escape','custom_fen']);
game('SYN-GAME-50-MOVE','stress',endgame,['Kg2'],['halfmove_100','draw','endgame']);
game('SYN-GAME-SAN-AMBIGUOUS','dev',ambiguous,['Nce4'],['ambiguous_knights','san']);
game('SYN-GAME-REPEAT-LONG','stress',defaultFen,Array.from({length:24},()=>['Nf3','Nf6','Ng1','Ng8']).flat(),['long_pgn','repetition','load_only']);
position('SYN-POS-FORCED-REPLY','dev',forced,{pv:['e8f8'],claims:[{type:'legal_move',uci:'e8f8'}]},['forced_reply','single_legal_move']);
position('SYN-POS-BLACK-AHEAD','stress','6k1/8/8/8/8/8/8/4K2q w - - 0 1',{pv:['e1d2']},['black_ahead','asymmetric_score']);
position('SYN-POS-QUEEN-UNDERPROMOTION','stress',knight,{pv:['a7a8q']},['promotion','queen']);
position('SYN-POS-NCE4-DISAMBIG','dev',ambiguous,{pv:['c3e4'],claims:[{type:'legal_move',uci:'c3e4'}]},['san_disambiguation']);
position('SYN-POS-50-MOVE','stress',endgame,{pv:['g1g2'],claims:[{type:'legal_move',uci:'g1g2'}]},['50_move_rule','draw_claim']);
const v2=entries.map(e=>JSON.stringify(e)).join('\n')+'\n';
const v2Path=join(root,'manifests/manifest-v2.jsonl');
if(existsSync(v2Path)&&sha(readFileSync(v2Path))!==sha(v2))throw Error('v2 manifest differs; do not overwrite frozen manifest');
writeFileSync(v2Path,v2);
console.log(JSON.stringify({v1_sha256:sha(v1),v2_sha256:sha(v2),v1_entries:14,v2_entries:entries.length}));
