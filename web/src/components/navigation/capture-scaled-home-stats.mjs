// Agent B local-only Home stats zoom regression. Synthetic data only; no production access.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const origin='http://127.0.0.1:4186';
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,lang='en',theme='light',mode='typical',checked=0;
try{
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce',locale:'en-US'});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const profile={user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language:lang,site_theme:theme,audience:'intermediate'};
  const stats=mode==='typical'?{total:4,wins:1,losses:2,draws:1,avg_accuracy:75,streak:{kind:'win',count:2}}:{total:12345,wins:7801,losses:3210,draws:1334,avg_accuracy:99.8,streak:{kind:'win',count:157}};
  const responses={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':stats,'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responses[path]??{})});
 });
 for(mode of ['typical','experienced'])for(theme of ['light','dark'])for(lang of ['en','de','es','ru','bg'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});await page.goto(origin,{waitUntil:'domcontentloaded'});
  const hero=page.locator('main section').first();await hero.waitFor({state:'visible'});await hero.locator('[data-home-stat]').first().waitFor({state:'visible'});
  await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.addStyleTag({content:`html{font-size:${font}px!important}`});await page.evaluate(()=>document.fonts.ready);
  const result=await hero.evaluate(root=>{
   const rect=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
   const hero=root.getBoundingClientRect();const grid=root.querySelector('div.relative.grid');const summary=grid.querySelector('[data-home-stat]')?.parentElement;
   if(!summary)return{error:'no stats summary'};
   const visible=(el)=>{const text=el.firstChild;if(!text||text.nodeType!==3)return null;const b=el.getBoundingClientRect();let total=0,visible=0;for(let i=0;i<text.length;i++){if(!/\S/.test(text.textContent[i]))continue;total++;const rng=document.createRange();rng.setStart(text,i);rng.setEnd(text,i+1);const r=rng.getBoundingClientRect();if(r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1)visible++;}return{visible,total}};
   const items=[...summary.querySelectorAll('[data-home-stat]')].map(el=>{const [value,label]=el.children;return{rect:rect(el),value:{text:value.textContent,rect:rect(value),glyphs:visible(value)},label:{text:label.textContent,rect:rect(label),glyphs:visible(label)}}});
   const overs=[...root.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<hero.left-1||r.right>hero.right+1)}).slice(0,10).map(el=>({text:el.textContent?.trim().slice(0,35),...rect(el)}));
   return{hero:rect(root),summary:rect(summary),items,overhangs:overs,documentOverflow:document.documentElement.scrollWidth-innerWidth};
  });
  const invalid=result.error||result.documentOverflow>1||result.overhangs.length||
    result.items?.length!==4||result.items?.some(item=>
      item.rect.left<result.hero.left-1||item.rect.right>result.hero.right+1||
      !item.value.glyphs||item.value.glyphs.visible!==item.value.glyphs.total||
      !item.label.glyphs||item.label.glyphs.visible!==item.label.glyphs.total);
  if(invalid)throw Error(`Home stats ${mode}/${theme}/${lang}/${width}px/font${font}: ${JSON.stringify(result)}`);
  if(mode==='experienced'&&width===320&&font===32&&lang==='de'){
    const play=hero.locator('a[href="/play"]');let focused=false;
    for(let i=0;i<25;i++){
      await page.keyboard.press('Tab');
      if(await play.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible'))){focused=true;break;}
    }
    if(!focused)throw Error(`Home hero Play not keyboard-reachable ${theme}`);
  }
  checked++;
  if(width===320&&font===32&&lang==='de')await hero.screenshot({path:resolve(root,`artifacts/agent-02/zoom-stats-verified-${mode}-${theme}-320-font32.png`)});
 }
 console.log(`Agent B Home stats zoom: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
