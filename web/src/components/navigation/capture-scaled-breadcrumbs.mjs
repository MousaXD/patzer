// Local-only Chromium regression for nested Review and Player breadcrumbs.
// Fixture data is synthetic; no production game or player state is changed.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4186';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4186', '--strictPort'], {cwd:resolve(root, 'web'), stdio:'ignore'});
let browser, theme='light', language='en', checked=0;
try {
 let ready = false; for (let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}
 if(!ready) throw Error('Vite did not start');
 browser = await chromium.launch({headless:true});
 const page = await browser.newPage({viewport:{width:320,height:700},locale:'en-US',reducedMotion:'reduce'});
 await page.route('**/api/**', async route=>{
  const path = new URL(route.request().url()).pathname;
  const profile = {user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language,audience:'intermediate',site_theme:theme};
  const responses = {'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:0,wins:0,losses:0,draws:0,avg_accuracy:null,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]},
   '/api/players/42':{player:{id:42,username:'opponent42',display_name:'Opponent Forty Two',avatar_emoji:'♟',created_at:'2026-01-01',online:false,is_me:false},stats:{total:0,wins:0,losses:0,draws:0,win_rate:null,avg_accuracy:null,streak:null},ratings:{},recent_games:[],head_to_head:null}};
  const missingGame = path === '/api/games/103';
  await route.fulfill({status:missingGame ? 404 : 200,contentType:'application/json',body:JSON.stringify(missingGame ? {error:'Not found'} : (responses[path]??{}))});
 });
 for(const [path,parent] of [['/review/103','/review'],['/players/42','/players']])for(theme of ['light','dark'])for(language of ['en','de','es','ru','bg'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});
  await page.goto(origin+path,{waitUntil:'domcontentloaded'});
  const crumb = page.locator('[data-workspace-header] [data-current-section]');await crumb.waitFor();
  await page.waitForFunction(l=>document.documentElement.lang===l,language);
  await page.addStyleTag({content:`html { font-size:${font}px!important; }`}); await page.evaluate(()=>document.fonts.ready);
  const result=await crumb.evaluate((el,parent)=>{const rect=(e)=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};const link=el.querySelector(`a[href="${parent}"]`),title=el.querySelector('span[aria-current="page"]');return{nav:rect(el),back:rect(link),backHref:link.getAttribute('href'),title:{...rect(title),text:title.textContent?.trim(),scrollWidth:title.scrollWidth,clientWidth:title.clientWidth},overflow:document.documentElement.scrollWidth-window.innerWidth,headerOverflow:el.closest('header').scrollWidth-el.closest('header').clientWidth}},parent);
  if (result.backHref !== parent || result.back.width < 44 || result.back.height < 44 ||
      result.title.width < 40 || result.overflow > 1 || result.headerOverflow > 1 ||
      await page.evaluate(() => document.documentElement.lang) !== language) {
    throw new Error(`Nested breadcrumb ${path}/${theme}/${language}/${width}px/font${font}: ${JSON.stringify(result)}`);
  }
  if (width === 320 && font === 32 && (language === 'en' || language === 'de')) {
    const back = crumb.locator(`a[href="${parent}"]`);
    let tabbed = false;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      if (await back.evaluate(node => node === document.activeElement)) { tabbed = true; break; }
    }
    if (!tabbed || !await back.evaluate(node => node.matches(':focus-visible'))) {
      throw new Error(`Nested breadcrumb back link not reachable by keyboard: ${path}/${theme}/${language}`);
    }
    await page.keyboard.press('Enter');
    await page.waitForURL(origin + parent);
  }
  checked++;
  if(width===320&&language==='de'&&font===16)await page.screenshot({path:resolve(root,`artifacts/agent-02/nested-header-verified-${parent.slice(1)}-${theme}-${font}.png`)});
 }
 console.log(`Agent B nested breadcrumbs: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
