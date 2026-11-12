// Local-only Chromium regression: skip-to-content and sticky mobile navigation
// on a long first-use Home page at 100%-200% text zoom. Synthetic API data only.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,lang='en',theme='light',checked=0;
try {
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite exited');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce',locale:'en-US'});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const profile={user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language:lang,site_theme:theme,audience:'intermediate'};const responses={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:0,wins:0,losses:0,draws:0,avg_accuracy:null,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responses[path]??{})});});
 const snapshot=()=>page.evaluate(()=>{const header=document.querySelector('[data-workspace-header]'),main=document.querySelector('#patzer-main'),hero=main?.querySelector('section'),title=header?.querySelector('[data-current-section]'),search=header?.querySelector('button[title]'),menu=header?.querySelector('button[aria-controls="patzer-mobile-drawer"]');const box=el=>{const b=el?.getBoundingClientRect();return b?{top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}:null};return{scrollY:window.scrollY,docScrollHeight:document.documentElement.scrollHeight,header:box(header),main:box(main),hero:box(hero),title:box(title),titleVisible:title?.scrollWidth<=title?.clientWidth+1,search:box(search),menu:box(menu),focus:document.activeElement?.id,docOverflow:document.documentElement.scrollWidth-innerWidth};});
 for(theme of ['light','dark'])for(lang of ['en','de','es','ru','bg'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});await page.goto(origin,{waitUntil:'domcontentloaded'});const header=page.locator('[data-workspace-header]');await header.waitFor();await page.locator('#patzer-main section').first().waitFor({state:'visible'});await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.waitForFunction(d=>document.documentElement.classList.contains('dark')===d,theme==='dark');
  await page.addStyleTag({content:`html{font-size:${font}px!important;}`});await page.evaluate(()=>document.fonts.ready);
  const before=await snapshot();if(before.docScrollHeight<width*2)throw Error(`Not a long page ${theme}/${lang}/${width}/font${font}`);
  await page.keyboard.press('Tab');const skip=page.locator('a[href="#patzer-main"]');if(!await skip.evaluate(el=>document.activeElement===el&&el.matches(':focus-visible')))throw Error(`Skip link inaccessible ${theme}/${lang}/${width}/font${font}`);
  await page.keyboard.press('Enter');const skipped=await snapshot();if(skipped.focus!=='patzer-main'||skipped.main.top<skipped.header.bottom-1||skipped.hero.top<skipped.header.bottom-1||skipped.docOverflow>1)throw Error(`Skip target hidden by header ${theme}/${lang}/${width}/font${font}: ${JSON.stringify(skipped)}`);
  const maxScroll=skipped.docScrollHeight-(width===320?700:844);await page.evaluate(top=>scrollTo({top,behavior:'instant'}),Math.min(500,maxScroll));const scrolled=await snapshot();if(scrolled.scrollY<100||Math.abs(scrolled.header.top)>1||scrolled.header.bottom!==56||scrolled.docOverflow>1||!scrolled.titleVisible||scrolled.title.width<30||scrolled.search.width<44||scrolled.menu.width<44||scrolled.search.right>width+1||scrolled.menu.right>width+1)throw Error(`Sticky header failed while scrolling ${theme}/${lang}/${width}/font${font}: ${JSON.stringify(scrolled)}`);
  const search=header.locator('button[title]').first();await search.click();const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});if(!await search.evaluate(el=>el===document.activeElement))throw Error(`Palette focus did not return ${theme}/${lang}/${width}/font${font}`);
  const menu=header.locator('button[aria-controls="patzer-mobile-drawer"]');await menu.click();await page.locator('#patzer-mobile-drawer').waitFor({state:'visible'});await page.keyboard.press('Escape');await page.locator('#patzer-mobile-drawer').waitFor({state:'detached'});if(!await menu.evaluate(el=>el===document.activeElement))throw Error(`Mobile menu focus did not return ${theme}/${lang}/${width}/font${font}`);
  const restored=await snapshot();if(Math.abs(restored.scrollY-scrolled.scrollY)>2||restored.docOverflow>1)throw Error(`Header actions changed scroll position ${theme}/${lang}/${width}/font${font}: ${JSON.stringify({scrolled,restored})}`);
  if(width===320&&font===32&&lang==='de')await page.screenshot({path:resolve(root,`artifacts/agent-02/mobile-sticky-scroll-verified-${theme}-320-font32.png`)});
  checked++;
 }
 console.log(`Agent B sticky scroll/skip: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
