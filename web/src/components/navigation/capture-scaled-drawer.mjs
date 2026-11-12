// Local-only Chromium regression for 320px/390px mobile drawers at 100%/150%/200% text scaling.
// No production backend or customer data is accessed.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../', import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,theme='light',lang='en',checked=0;
try {
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite exited');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce',locale:'en-US'});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const profile={user_id:1,display_name:'International Long Name With Extra Words',avatar_emoji:'♟',language:lang,audience:'intermediate',chesscom_username:null,lichess_username:null,coach_behavior:'on_demand',tts_enabled:0,board_theme:'green',site_theme:theme};const fixtures={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'long-username-with-many-characters',role:'admin',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:0,wins:0,losses:0,draws:0,avg_accuracy:null,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixtures[path]??{})});});
 for(theme of ['light','dark'])for(lang of ['en','de','es','ru','bg'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});await page.goto(origin,{waitUntil:'domcontentloaded'});await page.locator('button[aria-controls="patzer-mobile-drawer"]').waitFor();
  await page.waitForFunction(l=>document.documentElement.lang===l,lang);
  await page.addStyleTag({content:`html { font-size:${font}px!important; }`});await page.evaluate(()=>document.fonts.ready);
  await page.locator('button[aria-controls="patzer-mobile-drawer"]').click();const drawer=page.locator('#patzer-mobile-drawer');await drawer.waitFor();
  const result=await drawer.evaluate(el=>{const d=el.getBoundingClientRect();const header=el.firstElementChild;const logo=header.firstElementChild.getBoundingClientRect(),close=header.querySelector('[data-close-menu]').getBoundingClientRect();const nav=[...el.querySelectorAll('nav a[href]')].map(a=>({text:a.textContent.trim().slice(0,40),w:a.getBoundingClientRect().width,h:a.getBoundingClientRect().height,r:a.getBoundingClientRect().right}));const bottom=[...el.querySelectorAll('button,select')].filter(x=>x.offsetWidth).map(b=>({text:b.textContent.trim().slice(0,38),w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height}));return{drawer:{width:d.width,left:d.left,right:d.right,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight},header:{logo:{left:logo.left,right:logo.right,width:logo.width},close:{left:close.left,right:close.right,width:close.width},overlap:logo.right>close.left+1,closeBeyond:close.right>d.right+1},navLinks:nav.length,smallLinks:nav.filter(x=>x.w<44||x.h<44),smallControls:bottom.filter(x=>x.w<44||x.h<44),globalOverflow:document.documentElement.scrollWidth-window.innerWidth,focused:document.activeElement?.getAttribute('data-close-menu')!==null,bodyLocked:document.body.style.overflow==='hidden'};});
  if(result.header.overlap||result.header.closeBeyond||
     result.drawer.scrollWidth>result.drawer.clientWidth+1||
     result.smallLinks.length||result.smallControls.length||result.globalOverflow>1||
     !result.focused||!result.bodyLocked||result.navLinks<14){
    throw Error(`Scaled mobile drawer ${theme}/${lang}/${width}px/font${font}: ${JSON.stringify(result)}`);
  }
  if(lang==='de'&&width===320&&[16,24,32].includes(font))await page.screenshot({path:resolve(root,`artifacts/agent-02/drawer-scaled-verified-${theme}-${lang}-${width}-font${font}.png`)});
  if(font===32){
    await page.keyboard.press('Escape');
    await drawer.waitFor({state:'detached'});
    const restored=await page.evaluate(()=>({
      focus:document.activeElement?.getAttribute('aria-controls')==='patzer-mobile-drawer',
      bodyUnlocked:document.body.style.overflow!=='hidden',
    }));
    if(!restored.focus||!restored.bodyUnlocked)throw Error(`Scaled drawer did not restore focus/scroll: ${theme}/${lang}/${width}px: ${JSON.stringify(restored)}`);
  }
  checked++;
 }
 console.log(`Agent B scaled mobile drawer: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
