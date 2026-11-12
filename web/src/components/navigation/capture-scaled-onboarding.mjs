// Local Chromium regression for the first-use Home onboarding card at 100%-200% text zoom.
// Synthetic responses only; this fixture never starts a game or imports data.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../', import.meta.url));
const origin='http://127.0.0.1:4186', sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,language='en',theme='light',mode='onboarding',checked=0;
try{
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce',locale:'en-US'});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const games=[{id:103,white:'sample-player',black:'OpponentWithALongName',user_color:'white',result:'win',end_time:'2026-11-12T12:00:00Z',time_control:'600',analyzed:true,accuracy_white:81.4,accuracy_black:67.8},
   {id:104,white:'AnotherLongOpponent',black:'sample-player',user_color:'black',result:'loss',end_time:'2026-11-11T16:00:00Z',time_control:'300+2',analyzed:false}];
  const profile={user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language,site_theme:theme,audience:'intermediate'};
  const responses={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:mode==='recent'?games:[]},'/api/stats/me':{total:mode==='recent'?2:0,wins:1,losses:1,draws:0,avg_accuracy:75,streak:null},'/api/plan':{goals:[]},'/api/achievements':{achievements:[]}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responses[path]??{})});
 });
 for(mode of ['onboarding'])for(theme of ['light','dark'])for(language of ['en','de','ru'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});await page.goto(origin,{waitUntil:'domcontentloaded'});
  const card=mode==='recent'?page.locator('ul:has(a[href="/review/103"])'):page.locator('[data-home-onboarding]');await card.waitFor({state:'visible'});
  await page.waitForFunction(code=>document.documentElement.lang===code,language);await page.addStyleTag({content:`html{font-size:${font}px!important;}`});await page.evaluate(()=>document.fonts.ready);
  const result=await card.evaluate((root,mode)=>{
   const r=el=>{const b=el.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,height:b.height}};
   const outer=root.getBoundingClientRect();
   const textVisible=el=>{
    if(!el)return null;const text=el.firstChild;
    if(!text||text.nodeType!==3)return null;
    const bounds=el.getBoundingClientRect();let total=0,inElement=0,inCard=0;
    for(let i=0;i<text.length;i++){
      if(!/\S/.test(text.textContent[i]))continue;total++;
      const range=new Range();range.setStart(text,i);range.setEnd(text,i+1);
      const x=range.getBoundingClientRect();if(x.left>=bounds.left-1&&x.right<=bounds.right+1&&x.top>=bounds.top-1&&x.bottom<=bounds.bottom+1)inElement++;
      if(x.left>=outer.left-1&&x.right<=outer.right+1&&x.top>=outer.top-1&&x.bottom<=outer.bottom+1)inCard++;
    }return{total,inElement,inCard,...r(el)};
   };
   const all=[...root.querySelectorAll('*')].filter(el=>{const b=el.getBoundingClientRect();return b.width>0&&b.height>0});
   const overflow=all.filter(el=>{const b=el.getBoundingClientRect();return b.left<outer.left-1||b.right>outer.right+1}).slice(0,10).map(el=>({tag:el.tagName,text:el.textContent?.trim().slice(0,30),...r(el)}));
   if(mode==='onboarding'){
    const links=[...root.querySelectorAll('a[href="/play"],a[href="/review"]')];
    return {card:r(root),overflow,links:links.map(a=>({href:a.getAttribute('href'),rect:r(a),title:textVisible(a.querySelector('span span:first-child')),description:textVisible(a.querySelector('span span:nth-child(2)'))})),heading:textVisible(root.querySelector('h2')),
    docOverflow:document.documentElement.scrollWidth-innerWidth};
   }
   const links=[...root.querySelectorAll('li a[href]')];
   return {card:r(root),overflow,links:links.map(a=>({href:a.getAttribute('href'),rect:r(a),opponent:textVisible(a.querySelector('[data-home-recent-opponent]')),date:textVisible(a.querySelector('[data-home-recent-date]')),badge:r(a.querySelector('[role="img"]'))})),docOverflow:document.documentElement.scrollWidth-innerWidth};
  },mode);
  const invalid=result.docOverflow>1||result.overflow.length||result.links.length!==2||
    result.links.some(l=>!l.title||l.title.total<1||l.title.inElement<l.title.total||
      !l.description||l.description.inCard<l.description.total||
      l.rect.width<44||l.rect.height<44||l.rect.right>result.card.right+1)||
    (width===320&&font===32&&result.card.height>1800);
  if(invalid)throw Error(`Onboarding ${theme}/${language}/${width}px/font${font}: ${JSON.stringify(result)}`);
  if(width===320&&font===32&&language==='de'){
    const play=card.locator('a[data-home-onboarding-action][href="/play"]');
    let found=false;
    for(let i=0;i<30;i++){
      await page.keyboard.press('Tab');
      if(await play.evaluate(el=>document.activeElement===el&&el.matches(':focus-visible'))){found=true;break;}
    }
    if(!found)throw Error(`Onboarding Play link not reachable by keyboard: ${theme}`);
  }
  checked++;
  if(width===320&&font===32&&language==='de')await page.screenshot({path:resolve(root,`artifacts/agent-02/home-onboarding-verified-${theme}-320-font32.png`),fullPage:true});
 }
 console.log(`Agent B first-use onboarding: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
