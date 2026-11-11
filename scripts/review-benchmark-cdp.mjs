/**
 * Minimal bounded Chrome DevTools Protocol driver for QA-only browser tests.
 * Uses an isolated Chrome profile and a websocket tied to a freshly started
 * process. No Selenium/Playwright dependency or remote debugging of a user's
 * actual browser profile is required.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import WebSocket from 'ws';

export function within(promise,ms,label){
 let timer;
 return Promise.race([promise,new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(Error(label+'_timeout_'+ms)),ms);
 })]).finally(()=>clearTimeout(timer));
}
export async function until(check,label,ms=9000){
 // An unbounded poll wrapped in Promise.race keeps running even after the
 // timeout rejects. That leaks a timer/Chrome command loop and can hang the
 // entire QA subprocess after the top-level catch/cleanup. Bound the loop
 // itself instead: no polling task survives its own deadline.
 const deadline=Date.now()+ms;
 while(Date.now()<deadline){
  const remaining=deadline-Date.now();
  const value=await within(Promise.resolve().then(check),remaining,label+'_check');
  if(value)return value;
  if(Date.now()>=deadline)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(60,deadline-Date.now())));
 }
 throw Error(label+'_timeout_'+ms);
}

export async function launchBrowser({chromeBinary,profileDir}){
 assert(profileDir&&chromeBinary,'isolated test-only chrome profile required');
 const chrome=spawn(chromeBinary,[
  '--headless=new','--disable-gpu','--disable-dev-shm-usage',
  '--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--user-data-dir='+profileDir,
  '--window-size=1440,900','about:blank',
 ],{stdio:['ignore','ignore','pipe'],detached:true});
 const stderr=[];
 chrome.stderr.on('data',chunk=>{
  if(stderr.join('').length<9000)stderr.push(String(chunk).slice(0,1300));
 });
 try{
 const metadata=join(profileDir,'DevToolsActivePort');
 const port=await until(async()=>{
  if(chrome.exitCode!==null)throw Error('chrome_early_exit_'+chrome.exitCode+':'+stderr.join(''));
  if(!existsSync(metadata))return null;
  const found=readFileSync(metadata,'utf8').split('\n')[0];
  const num=Number(found);return num>0&&num<=65535?num:null;
 },'chrome_debug_port',9000);
 const response=await within(fetch('http://127.0.0.1:'+port+'/json/list'),2500,'chrome_page_list');
 assert.equal(response.status,200);
 const pages=await response.json();
 const page=pages.find(x=>x.type==='page'&&x.webSocketDebuggerUrl);
 assert(page?.webSocketDebuggerUrl,'Chrome did not expose isolated target');
 const ws=new WebSocket(page.webSocketDebuggerUrl,{perMessageDeflate:false});
 await within(new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail);}),3500,'cdp_ws_open');
 let next=1;
 const pending=new Map(),events=[];
 ws.on('message',data=>{
  let msg;
  try{msg=JSON.parse(String(data));}catch{return;}
  if(msg.id){
   const item=pending.get(msg.id);
   if(item){pending.delete(msg.id);
    if(msg.error)item.reject(Error('cdp_'+item.method+':'+JSON.stringify(msg.error)));
    else item.resolve(msg.result);
   }
  }else if(msg.method){
   if(events.length<20000)events.push({method:msg.method,params:msg.params});
  }
 });
 ws.on('close',()=>{
  for(const item of pending.values())item.reject(Error('CDP connection closed'));
  pending.clear();
 });
 const send=(method,params={})=>within(new Promise((resolve,reject)=>{
  const id=next++;
  pending.set(id,{resolve,reject,method});
  ws.send(JSON.stringify({id,method,params}),err=>{
   if(err){pending.delete(id);reject(err);}
  });
 }),7000,method);
 await send('Page.enable');
 await send('Runtime.enable');
 await send('Network.enable');
 const evalJs=async expression=>{
  const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(res.exceptionDetails)throw Error('browser JS exception: '+JSON.stringify(res.exceptionDetails).slice(0,1400));
  return res.result?.value;
 };
 const go=async url=>{
  const result=await send('Page.navigate',{url});
  assert(!result.errorText,'browser navigation failed: '+result.errorText);
 };
 const click=async selector=>{
  const clicked=await evalJs(`(() => {const x=document.querySelector(${JSON.stringify(selector)});if(!x)return false;x.click();return true;})()`);
  assert.equal(clicked,true,'selector not present for a real React click: '+selector);
 };
 const wait=async(expr,label,ms=9500)=>until(()=>evalJs(expr),label,ms);
 return {chrome,port,ws,send,evalJs,go,click,wait,events,stderr,
  async dispose(){
   try{ws.close();}catch{}
   if(chrome.exitCode===null){
    try{process.kill(-chrome.pid,'SIGTERM');}catch{chrome.kill('SIGTERM');}
    await within(new Promise(ok=>chrome.once('exit',ok)),1900,'chrome_shutdown').catch(()=>{
     try{process.kill(-chrome.pid,'SIGKILL');}catch{chrome.kill('SIGKILL');}
    });
   }
  }};
 }catch(error){
  // The caller only receives a handle after successful CDP startup. If Chrome
  // fails mid-launch, it must not leave an untracked debugger or browser alive.
  if(chrome.exitCode===null){
   try{process.kill(-chrome.pid,'SIGTERM');}catch{chrome.kill('SIGTERM');}
  }
  throw error;
 }
}
