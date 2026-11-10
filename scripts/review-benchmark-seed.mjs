import { Chess } from 'chess.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../qa/review-excellence');
const sha = x => createHash('sha256').update(x).digest('hex');
const start = new Chess().fen();
const fixtures = [];
async function add(id, kind, split, file, content, tags) {
  const dir = join(root, 'fixtures', kind === 'completed_game' ? 'games' : 'positions');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), content);
  fixtures.push({
    schema_version: 1, fixture_id: id, kind, split,
    source_kind: 'synthetic', source_url: null, license: 'self-authored', consent_reference: 'not-applicable',
    pgn_file: (kind === 'completed_game' ? 'games/' : 'positions/') + file,
    pgn_sha256: sha(content), start_fen: start, variant: 'standard',
    result: kind === 'completed_game' ? '1-0' : 'unknown', white_rating_bucket: 'unknown', black_rating_bucket: 'unknown',
    time_class: 'unknown', tags, annotations_file: null,
    created_at: '2026-11-11', verified_by: ['automated_legal_replay']
  });
}
for (const [id, split, moves] of [
  ['SYN-GAME-FOOLS-MATE', 'dev', ['f3', 'e5', 'g4', 'Qh4#']],
  ['SYN-GAME-SCHOLARS-MATE', 'dev', ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']],
  ['SYN-GAME-CASTLING', 'dev', ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6', 'd3', 'O-O']],
  ['SYN-GAME-EN-PASSANT', 'stress', ['e4', 'a6', 'e5', 'd5', 'exd6']],
  ['SYN-GAME-REPETITION', 'stress', ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']],
  ['SYN-GAME-PIN', 'dev', ['d4','d5','Nc3','Nf6','Bg5','e6','e4','Bb4']]
]) {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  const result = chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : chess.isDraw() ? '1/2-1/2' : '*';
  chess.header('Event','Synthetic independently authored QA','White','WhiteFixture','Black','BlackFixture','Result',result);
  const text = chess.pgn() + '\n';
  await add(id,'completed_game',split,id.toLowerCase()+'.pgn',text,['strict_pgn','legal_replay']);
  fixtures[fixtures.length-1].result = result;
}
const positions = [
  ['SYN-POS-START','dev', { fen:start, best_move:'e2e4', pv:['e2e4','e7e5'], eval_cp_white:50, eval_cp_actor:50, classification:'mistake',win_pct_drop:12,cp_loss:130,is_best:false,claims:[{type:'piece_on_square',square:'e2',piece:'p',color:'w'}] }, ['start','perspective']],
  ['SYN-POS-BLACK','dev', { fen:(()=>{const c=new Chess();c.move('e4');return c.fen()})(), best_move:'e7e5',pv:['e7e5'],eval_cp_white:75,eval_cp_actor:-75,claims:[{type:'legal_move',uci:'e7e5'}]}, ['black_to_move']],
  ['SYN-POS-MATE','dev', {fen:(()=>{const c=new Chess(); for(const m of ['f3','e5','g4'])c.move(m); return c.fen()})(),pv:['d8h4'],mate_claim:{winner:'b'},claims:[{type:'legal_move',uci:'d8h4'}]},['forced_mate','mate_claim']],
  ['SYN-POS-CASTLE','dev',{fen:(()=>{const c=new Chess();for(const m of ['e4','e5','Nf3','Nc6','Bc4','Bc5']) c.move(m);return c.fen()})(),pv:['e1g1'],claims:[{type:'legal_move',uci:'e1g1'}]},['castling']],
  ['SYN-POS-EN-PASSANT','stress',{fen:(()=>{const c=new Chess();for(const m of ['e4','a6','e5','d5'])c.move(m);return c.fen()})(),pv:['e5d6'],claims:[{type:'legal_move',uci:'e5d6'}]},['en_passant']],
  ['SYN-POS-PROMOTION','stress',{fen:'7k/P7/8/8/8/8/8/K7 w - - 0 1',pv:['a7a8n'], claims:[{type:'legal_move',uci:'a7a8n'}]},['underpromotion']],
  ['SYN-POS-STALEMATE','stress',{fen:'7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', claims:[]},['stalemate']],
  ['SYN-POS-EQUIVALENT','dev',{fen:start,pv:['d2d4','d7d5'],claims:[{type:'legal_move',uci:'d2d4'}]},['alternative_legal_move','not_engine_best_label']]
];
for (const [id,split,payload,tags] of positions) await add(id,'position',split,id.toLowerCase()+'.json',JSON.stringify({request_id:id,response_request_id:id,request_fen:payload.fen,actor:payload.fen.split(' ')[1],...payload},null,2)+'\n',tags);
await mkdir(join(root,'manifests'),{recursive:true});
const manifest=fixtures.map(e=>JSON.stringify(e)).join('\n')+'\n';
await writeFile(join(root,'manifests/manifest-v1.jsonl'),manifest);
console.log(fixtures.length+' synthetic fixtures; manifest SHA256 '+sha(manifest));
