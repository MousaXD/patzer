// Agent B local-only Chromium regression for the intermediate 640-767px header.
// Synthetic fixtures; no production account/game changes.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,lang='en',theme='light',checked=0;
try{
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:640,height:820},locale:'en-US',reducedMotion:'reduce'});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;const profile={user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language:lang,audience:'intermediate',site_theme:theme};const responses={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:0,wins:0,losses:0,draws:0,avg_accuracy:null,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responses[path]??{})});});
 for(theme of ['light','dark'])for(lang of ['en','de','es','ru','bg'])for(const width of [640,767])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===640?820:900});await page.goto(origin,{waitUntil:'domcontentloaded'});
  const header=page.locator('[data-workspace-header]');await header.waitFor();await page.locator('#patzer-main section').first().waitFor({state:'visible'});await page.waitForFunction(l=>document.documentElement.lang===l,lang);await page.waitForFunction(d=>document.documentElement.classList.contains('dark')===d,theme==='dark');
  await page.addStyleTag({content:`html{font-size:${font}px!important}`});await page.evaluate(()=>document.fonts.ready);
  const geometry=await header.evaluate(h=>{const r=e=>{const x=e.getBoundingClientRect();return{left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};const title=h.querySelector('[data-current-section]');const controls=[h.querySelector('a[aria-label="Patzer"]'),h.querySelector('button[title]'),...h.querySelectorAll('button')].filter((e,i,a)=>e&&a.indexOf(e)===i&&e.getBoundingClientRect().width>0);const settings=h.querySelector('a[href="/settings"]');if(settings)controls.push(settings);const main=document.querySelector('#patzer-main');return{header:{...r(h),overflow:h.scrollWidth-h.clientWidth},title:{...r(title),text:title.textContent?.trim(),scrollWidth:title.scrollWidth,clientWidth:title.clientWidth},controls:controls.map(c=>({role:c.tagName,name:c.getAttribute('aria-label'),...r(c)})),scrollMargin:getComputedStyle(main).scrollMarginTop,overflow:document.documentElement.scrollWidth-innerWidth};});
  const invalid=geometry.header.height!==56||geometry.header.overflow>1||geometry.overflow>1||geometry.title.width<30||geometry.title.scrollWidth>geometry.title.clientWidth+1||geometry.controls.length!==5||geometry.controls.some(c=>c.width<44||c.height<44||c.left<0||c.right>width+1)||geometry.scrollMargin!=='56px';
  if(invalid)throw Error(`Intermediate header ${theme}/${lang}/${width}px/font${font}: ${JSON.stringify(geometry)}`);
  await page.keyboard.press('Tab');const skip=page.locator('a[href="#patzer-main"]');if(!await skip.evaluate(e=>e===document.activeElement&&e.matches(':focus-visible')))throw Error(`Intermediate skip link inaccessible ${theme}/${lang}/${width}px/font${font}`);
  await page.keyboard.press('Enter');const skipResult=await page.evaluate(()=>({mainTop:document.getElementById('patzer-main').getBoundingClientRect().top,headerBottom:document.querySelector('[data-workspace-header]').getBoundingClientRect().bottom,focus:document.activeElement?.id}));
  if(skipResult.focus!=='patzer-main'||skipResult.mainTop<skipResult.headerBottom-1)throw Error(`Intermediate skip hides content ${theme}/${lang}/${width}px/font${font}: ${JSON.stringify(skipResult)}`);
  if(font===32){const menu=header.locator('button[aria-controls="patzer-mobile-drawer"]');await menu.click();const drawer=page.locator('#patzer-mobile-drawer');await drawer.waitFor({state:'visible'});if(!await page.evaluate(()=>document.documentElement.style.overflow==='hidden'))throw Error(`Intermediate drawer not scroll locked ${theme}/${lang}/${width}`);await page.keyboard.press('Escape');await drawer.waitFor({state:'detached'});if(!await menu.evaluate(e=>e===document.activeElement))throw Error(`Intermediate drawer did not restore menu focus ${theme}/${lang}/${width}`);}
  if(lang==='de'&&width===640&&font===32)await page.screenshot({path:resolve(root,`artifacts/agent-02/mid-header-verified-${theme}-640-font32.png`)});
  checked++;
 }
 console.log(`Agent B 640-767px header: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
