import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'patzer-full-history-'));
process.env.DB_PATH = join(dir, 'history.db');
let db: typeof import('../src/db.js')['db'];
let route: { request: (url: string, options?: RequestInit) => Response | Promise<Response> };
let auth: { Cookie: string; 'Content-Type': string };
const username = 'historyuser';

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  route = (await import('../src/routes/games.js')).default;
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (41,'history-tester','x','user')").run();
  db.prepare('INSERT INTO profiles (user_id, display_name, chesscom_username, lichess_username) VALUES (41,?,?,?)')
    .run('History Tester', username, username);
  auth = { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(41))}`, 'Content-Type': 'application/json' };
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.prepare('DELETE FROM games WHERE user_id = 41').run();
  db.prepare('UPDATE profiles SET chesscom_username=?,lichess_username=? WHERE user_id=41').run(username,username);
});
afterAll(() => { db?.close(); rmSync(dir, {recursive:true,force:true}); });

async function status(source: 'chesscom' | 'lichess') {
  const response = await route.request(`/import/history/${source}`, { headers: auth });
  expect(response.status).toBe(200);
  return response.json() as Promise<{state:string;fetched:number;imported:number;duplicates:number;skipped:number;completed:number;total:number|null;error?:string}>;
}
async function start(source: 'chesscom' | 'lichess') {
  const response = await route.request(`/import/history/${source}`, {
    method: 'POST', headers: auth, body:'{}',
  });
  expect(response.status).toBe(202);
  return response.json() as Promise<{state:string}>;
}
async function finished(source: 'chesscom' | 'lichess') {
  for (let attempt=0; attempt<250; attempt++) {
    const current = await status(source);
    if (current.state === 'complete' || current.state === 'error') return current;
    await new Promise(resolve=>setTimeout(resolve, 25));
  }
  throw new Error(`history-import-timeout:${source}`);
}

const pgn = '[Event "History"]\n[White "historyuser"]\n[Black "opponent"]\n[Result "1-0"]\n\n1. e4 e5 1-0';
const chessGame = (id:number) => ({
  url:`https://www.chess.com/game/live/${id}`, pgn, rules:'chess',time_control:'600',
  end_time:1760000000+id,rated:true,time_class:'rapid',
  white:{username,rating:1234,result:'win'}, black:{username:'opponent',rating:1200,result:'checkmated'},
});
const lichessGame = (id:number) => ({
  id:`history_${id}`, rated:true, variant:'standard', speed:'blitz',
  createdAt:1760000000000 + id*1000, lastMoveAt:1760000002000 + id*1000,
  status:'mate',winner:'white',
  players:{white:{user:{id:username,name:username}},black:{user:{id:'opponent',name:'opponent'}}},
  clock:{initial:300,increment:0}, pgn,
});

describe('full-history import API', () => {
  it('imports all Chess.com archives, not just 200 games, and deduplicates on retry', async () => {
    const january = `https://api.chess.com/pub/player/${username}/games/2026/01`;
    const february = `https://api.chess.com/pub/player/${username}/games/2026/02`;
    const fake = vi.fn(async (input: string | URL | Request) => {
      const url=String(input);
      if (url===`https://api.chess.com/pub/player/${username}`) return Response.json({username});
      if (url.endsWith('/games/archives')) return Response.json({archives:[january,february]});
      if (url===january) return Response.json({games:Array.from({length:120},(_,i)=>chessGame(i+1))});
      if (url===february) return Response.json({games:Array.from({length:120},(_,i)=>chessGame(i+121))});
      throw new Error(`unexpected-fetch:${url}`);
    });
    vi.stubGlobal('fetch',fake);
    await start('chesscom');
    const concurrent = await start('chesscom');
    expect(concurrent.state).toBe('running');
    const first = await finished('chesscom');
    expect(first).toMatchObject({state:'complete', fetched:240, imported:240, completed:2,total:2});
    expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id=41 AND source='chesscom'").get()).toEqual({n:240});
    await start('chesscom');
    const again=await finished('chesscom');
    expect(again).toMatchObject({state:'complete', fetched:240, imported:0, duplicates:240});
    expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id=41').get()).toEqual({n:240});
    expect(fake).toHaveBeenCalledTimes(8);
  });

  it('streams all Lichess NDJSON without max=200 and saves in bounded batches', async () => {
    const rows=Array.from({length:255},(_,i)=>lichessGame(i+1));
    const payload=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
    const bytes=new TextEncoder().encode(payload);
    const chunks: Uint8Array[]=[];
    for(let i=0;i<bytes.length;i+=777) chunks.push(bytes.subarray(i,i+777));
    const fake=vi.fn(async (input:string|URL|Request)=>new Response(new ReadableStream({
      pull(controller) { const chunk=chunks.shift(); if(chunk) controller.enqueue(chunk); else controller.close(); },
    }),{status:200,headers:{'Content-Type':'application/x-ndjson'}}));
    vi.stubGlobal('fetch',fake);
    await start('lichess');
    const result=await finished('lichess');
    expect(result).toMatchObject({state:'complete',fetched:255,imported:255,completed:3,total:255});
    expect(db.prepare("SELECT count(*) AS n FROM games WHERE user_id=41 AND source='lichess'").get()).toEqual({n:255});
    const requested=new URL(String(fake.mock.calls[0]?.[0]));
    expect(requested.pathname).toBe(`/api/games/user/${username}`);
    expect(requested.searchParams.has('max')).toBe(false);
    expect(requested.searchParams.get('pgnInJson')).toBe('true');
  });

  it('keeps completed Lichess batches after a truncated response and resumes safely on retry', async () => {
    const rows=Array.from({length:220},(_,i)=>lichessGame(i+1));
    let truncated=true;
    const fake=vi.fn(async ()=>new Response(
      truncated ? rows.slice(0,115).map(row=>JSON.stringify(row)).join('\n')+'\n{"id":' :
        rows.map(row=>JSON.stringify(row)).join('\n')+'\n',
      {status:200},
    ));
    vi.stubGlobal('fetch',fake);
    await start('lichess');
    const partial=await finished('lichess');
    expect(partial).toMatchObject({state:'error', fetched:100,imported:100});
    expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id=41').get()).toEqual({n:100});
    truncated=false;
    await start('lichess');
    const complete=await finished('lichess');
    expect(complete).toMatchObject({state:'complete', fetched:220,imported:120,duplicates:100});
    expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id=41').get()).toEqual({n:220});
  });

  it('refuses to store archived games if the linked Chess.com account changed mid-download', async () => {
    const month=`https://api.chess.com/pub/player/${username}/games/2026/01`;
    let release!: ()=>void;
    let entered!: ()=>void;
    const pause=new Promise<void>(r=>{release=r;});
    const started=new Promise<void>(r=>{entered=r;});
    vi.stubGlobal('fetch',vi.fn(async (input: string|URL|Request)=>{
      const url=String(input);
      if (url===`https://api.chess.com/pub/player/${username}`) return Response.json({username});
      if (url.endsWith('/games/archives')) return Response.json({archives:[month]});
      if (url===month) {entered(); await pause; return Response.json({games:[chessGame(999999)]});}
      throw new Error(`unexpected-fetch:${url}`);
    }));
    try {
      await start('chesscom');
      await started;
      db.prepare("UPDATE profiles SET chesscom_username='different' WHERE user_id=41").run();
      release();
      // The account-specific status endpoint no longer returns the old job.
      // Check the original job's state using its original linked identity.
      const {getHistoryStatus}=await import('../src/chess/historyImportJobs.js');
      for(let i=0;i<100;i++) {
        if(getHistoryStatus(41,'chesscom',username).state==='error') break;
        await new Promise(r=>setTimeout(r,10));
      }
      expect(getHistoryStatus(41,'chesscom',username)).toMatchObject({state:'error',imported:0,error:'linked_account_changed'});
      expect(db.prepare('SELECT count(*) AS n FROM games WHERE user_id=41').get()).toEqual({n:0});
    } finally { release(); }
  });
});
