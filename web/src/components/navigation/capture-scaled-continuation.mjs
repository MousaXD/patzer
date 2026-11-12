// Agent B: local-only Chromium regression for all four Home continuation tiles.
// Uses synthetic first-use/returning-player responses; never modifies user data.
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../../', import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser,language='en',theme='light',mode='empty',checked=0;
try{
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite stopped');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce',locale:'en-US'});
 await page.route('**/api/**',async route=>{const path=new URL(route.request().url()).pathname;
  const profile={user_id:1,display_name:'Sample Player',avatar_emoji:'♟',language,site_theme:theme,audience:'intermediate'};
  const goals=[{id:1,kind:'puzzles_solve',title:'Solve thirty tactics before Sunday',description:'Thirty tactics this week',target:30,progress:8,status:'active',icon:'target',created_at:'2026-11-10T00:00:00Z',completes_at:'2026-11-17T00:00:00Z',metadata:null}];
  const achievements=[{id:'first_game',title:'First Game',description:'Finish your first game',icon:'Award',category:'milestone',unlocked:true,unlocked_at:'2026-11-12T12:00:00Z',progress:1,target:1}];
  const responses={'/api/setup/status':{setup_required:false},'/api/auth/me':{user:{id:1,username:'sample-player',role:'user',created_at:'2026-01-01',profile}},'/api/meta':{version:'7.19.0'},'/api/meta/update':{enabled:false,updateAvailable:false},'/api/games':{games:[]},'/api/stats/me':{total:mode==='progress'?4:0,wins:1,losses:2,draws:1,avg_accuracy:75,streak:null},'/api/plan':{goals:mode==='progress'?goals:[]},'/api/achievements':{achievements:mode==='progress'?achievements:[]},'/api/tactics/daily':{puzzle:{id:'p1',rating:1400},done:null,streak:mode==='progress'?5:0},'/api/learn/progress':{lessons:[]}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(responses[path]??{})});});
 for(mode of ['empty','progress'])for(theme of ['light','dark'])for(language of ['en','de','es','ru','bg'])for(const width of [320,390])for(const font of [16,24,32]){
  await page.setViewportSize({width,height:width===320?700:844});await page.goto(origin,{waitUntil:'domcontentloaded'});
  const section=page.locator('main section:has(a[href="/plan"])').first();await section.waitFor({state:'visible'});
  await page.waitForFunction(code=>document.documentElement.lang===code,language);await page.addStyleTag({content:`html{font-size:${font}px!important;}`});await page.evaluate(()=>document.fonts.ready);
  const result=await section.evaluate(root=>{
   const box=el=>{const r=el.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
   const glyphFraction=el=>{if(!el)return null;const text=el.firstChild;if(!text||text.nodeType!==3)return null;const b=el.getBoundingClientRect();let total=0,visible=0;for(let i=0;i<text.length;i++){if(!/\S/.test(text.textContent[i]))continue;total++;const rg=new Range();rg.setStart(text,i);rg.setEnd(text,i+1);const r=rg.getBoundingClientRect();if(r.left>=b.left-1&&r.right<=b.right+1&&r.top>=b.top-1&&r.bottom<=b.bottom+1)visible++;}return{total,visible,ratio:total?visible/total:1}};
   const tiles=[...root.querySelectorAll('a.card-hover')].map(a=>{const children=[...a.children],content=a.querySelector('.min-w-0.flex-1'),title=content?.querySelector('[data-home-continue-title]'),sub=content?.querySelector('[data-home-continue-description]');const outer=a.getBoundingClientRect();const clipped=[...a.querySelectorAll('*')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&(r.left<outer.left-1||r.right>outer.right+1)}).slice(0,8).map(el=>({text:el.textContent?.trim().slice(0,35),...box(el)}));return{href:a.getAttribute('href'),box:box(a),icon:box(children[0]),content:box(content),arrow:box(children.at(-1)),title:{text:title?.textContent?.trim(),visible:glyphFraction(title)},sub:{text:sub?.textContent?.trim(),visible:glyphFraction(sub)},clipped}});
   return{box:box(root),tiles,overflow:document.documentElement.scrollWidth-innerWidth};
  });
  const required=['/train?tab=puzzles&daily=1','/plan','/insights#achievements'];
  const hrefs=result.tiles.map(tile=>tile.href);
  const invalid=result.overflow>1||result.tiles.length!==4||
    !hrefs.some(h=>h?.startsWith('/learn'))||required.some(h=>!hrefs.includes(h))||
    result.tiles.some(tile=>tile.content.width<160||tile.box.width<44||tile.box.height<44||
      tile.icon.width<44||tile.icon.height<44||tile.arrow.width<16||
      tile.clipped.length||!tile.title.visible||tile.title.visible.ratio<1||
      (tile.sub.visible&&tile.sub.visible.ratio<1)||
      (font===32&&width===320&&tile.box.height>550));
  if(invalid)throw Error(`Continue cards ${mode}/${theme}/${language}/${width}px/font${font}: ${JSON.stringify(result)}`);
  if(width===320&&font===32&&language==='de'){
    const play=section.locator('a[href^="/learn"]');
    let reached=false;
    for(let i=0;i<30;i++){
      await page.keyboard.press('Tab');
      if(await play.evaluate(el=>el===document.activeElement&&el.matches(':focus-visible'))){reached=true;break;}
    }
    if(!reached)throw Error(`Continue tile keyboard focus missing ${mode}/${theme}`);
  }
  checked++;
  if(width===320&&font===32&&language==='de')await page.screenshot({path:resolve(root,`artifacts/agent-02/continue-verified-${mode}-${theme}-320-font32.png`),fullPage:true});
 }
 console.log(`Agent B scaled continuation: ${checked} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
