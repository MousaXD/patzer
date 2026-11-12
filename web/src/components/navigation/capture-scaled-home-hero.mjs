// Local-only Chromium regression for the first-use Home hero across tablet widths
// and enlarged text. Synthetic accounts only; no production requests.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../../', import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,theme='light',lang='en',displayName='Sample Player',checked=0;
try{
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:768,height:1024},locale:'en-US',reducedMotion:'reduce'});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const profile={user_id:1,display_name:displayName,avatar_emoji:'♟',language:lang,audience:'intermediate',site_theme:theme};const fixtures={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:0,wins:0,losses:0,draws:0,avg_accuracy:null,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixtures[path]??{})});});
 for(theme of ['light','dark'])for(lang of ['en','de','ru'])for(const width of [768,1024])for(const font of [16,24,32])for(displayName of ['Sample Player','International Long Name']) {
  await page.setViewportSize({width,height:width===768?1024:768});await page.goto(origin,{waitUntil:'domcontentloaded'});const heading=page.locator('h1[title]');await heading.waitFor({state:'visible'});await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.addStyleTag({content:`html {font-size:${font}px!important;}`});await page.evaluate(()=>document.fonts.ready);
  const state=await heading.evaluate(h=>{const hero=h.closest('section');const bounds=el=>{const b=el.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};const hBox=h.getBoundingClientRect();const text=h.firstChild;let visibleChars=0,significant=0,visibleSignificant=0;for(let i=0;i<text.length;i++){const c=text.textContent[i];if(!/\s/.test(c))significant++;const r=new Range();r.setStart(text,i);r.setEnd(text,i+1);const b=r.getBoundingClientRect();const visible=b.width>0&&b.height>0&&b.left>=hBox.left-1&&b.right<=hBox.right+1&&b.top>=hBox.top-1&&b.bottom<=hBox.bottom+1;if(visible){visibleChars++;if(!/\s/.test(c))visibleSignificant++}}const style=getComputedStyle(h);const actions=[...hero.querySelectorAll('a[href="/play"],a[href="/review"]')].map(a=>({href:a.getAttribute('href'),...bounds(a)}));const avatar=hero.querySelector('[data-home-hero-avatar]');return{title:h.textContent,heading:bounds(h),headingStyle:{fontSize:style.fontSize,lineHeight:style.lineHeight,display:style.display,webkitLineClamp:style.webkitLineClamp},visibleChars,significant,visibleSignificant,hero:bounds(hero),avatar:bounds(avatar),actions,overflow:document.documentElement.scrollWidth-window.innerWidth};});
  const visibleRatio=state.visibleSignificant/state.significant;
  // The tablet stack should keep the whole realistic name; desktop's
  // existing two-line clamp may abbreviate unusually long names.
  if(state.heading.width<55||visibleRatio<(width===768?1:0.75)||state.actions.length!==2||
    state.actions.some(action=>action.width<44||action.height<44)||state.overflow>1||
    (width===768&&state.actions[0].top<state.heading.bottom)||
    await page.evaluate(()=>document.documentElement.lang)!==lang){
    throw Error(`Home hero ${theme}/${lang}/${width}px/font${font}/${displayName}: ${JSON.stringify(state)}`);
  }
  if(font===32&&width===768&&lang==='de'){
    const play=page.locator('a[href="/play"]').first();
    await play.focus();
    if(!await play.evaluate(el=>document.activeElement===el&&el.matches(':focus-visible'))){
      throw Error(`Home Play action not keyboard-focusable: ${theme}/${displayName}`);
    }
  }
  checked++;
  if(lang==='de'&&width===768&&font===32)await page.screenshot({path:resolve(root,`artifacts/agent-02/home-hero-verified-${theme}-${displayName==='Sample Player'?'short':'long'}-768-font32.png`)});
 }
 console.log(`Agent B scaled Home hero: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
