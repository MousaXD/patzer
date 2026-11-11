#!/usr/bin/env node
/**
 * Agent D disposable cross-process Hono worker. This is NOT Patzer's active
 * server: it mounts only the actual review and logout routes under a private
 * loopback listener, using an explicitly supplied synthetic SQLite file.
 */
import assert from 'node:assert/strict';
import {realpathSync,statSync} from 'node:fs';
import {resolve,join,sep,relative,isAbsolute} from 'node:path';
import {Hono} from 'hono';
import {serve} from '@hono/node-server';

const root=resolve(import.meta.dirname,'..');
const qaResults=realpathSync(join(root,'qa/review-excellence/results'));
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
 const i=arg.indexOf('=');return i<0?[arg.slice(2),true]:[arg.slice(2,i),arg.slice(i+1)];
}));
assert(args.candidate&&args['worker-id']&&args['worker-id'].length<=10);
assert(!args.fault||args.fault==='grant-revoked',
 'unknown test-only HTTP authorization fault');
assert(process.send,'cross-process QA worker must be started with IPC');
assert(process.env.DB_PATH,'explicit disposable SQLite DB_PATH is mandatory');
const database=realpathSync(process.env.DB_PATH);
const within=relative(qaResults,database);
assert(within&&!within.startsWith('..'+sep)&&within!=='..'&&!isAbsolute(within),
 'refuse to load SQLite outside QA results');
assert(statSync(database).isFile(),'disposable DB must already exist');
const candidate=realpathSync(args.candidate);
const candidateRel=relative(qaResults,candidate);
assert(candidateRel.startsWith('worktree-'),'read only a detached QA candidate');

const {db}=await import(join(candidate,'server/src/db.ts'));
const route=(await import(join(candidate,'server/src/routes/review.ts'))).default;
const auth=(await import(join(candidate,'server/src/routes/auth.ts'))).default;
const app=new Hono();
// ONLY when explicitly commanded by the adversarial QA runner, deliberately
// simulate a broken admission guard. This never edits Patzer's real middleware.
if(args.fault==='grant-revoked'){
 app.use('/api/games/*',async(c,next)=>{
  if(c.req.header('X-QA-Adversarial-Admission')==='grant-revoked'){
   return c.json({review:{summary:'QA TEST-ONLY REVOKED ACCESS ACCEPTED'}},200);
  }
  await next();
 });
}
app.route('/api/games',route);
app.route('/api/auth',auth);

const server=serve({fetch:app.fetch,port:0,hostname:'127.0.0.1'});
const send=event=>process.send?.({...event,worker_id:args['worker-id'],pid:process.pid});
server.once('listening',()=>{
 const address=server.address();
 assert(address&&typeof address==='object'&&address.address==='127.0.0.1');
 send({type:'ready',port:address.port});
});
server.on('error',error=>send({type:'worker_error',message:String(error)}));
let closing=false;
process.on('message',async message=>{
 if(message?.type!=='stop'||closing)return;
 closing=true;
 server.closeAllConnections();
 await new Promise(ok=>server.close(ok));
 db.close();
 send({type:'closed'});
 process.exit(0);
});
