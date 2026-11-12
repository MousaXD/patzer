// Local-only Chromium regression for Signup and first-owner Setup hit targets.
// All network responses are synthetic; no accounts are created.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../../', import.meta.url));
const origin='http://127.0.0.1:4186',sleep=ms=>new Promise(done=>setTimeout(done,ms));
const server=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4186','--strictPort'],{cwd:resolve(root,'web'),stdio:'ignore'});
let browser;
let checks=0;
try {
 let ready=false;for(let i=0;i<80;i++){if(server.exitCode!==null)throw Error('Vite exited');try{if((await fetch(origin)).ok){ready=true;break}}catch{}await sleep(250)}if(!ready)throw Error('Vite unavailable');
 browser=await chromium.launch({headless:true});
 for(const mode of ['signup-open','signup-closed','setup-step1','setup-step2'])for(const theme of ['light','dark'])for(const lang of ['en','de'])for(const [width,font] of [[320,16],[320,24],[1440,16]]) {
  const page=await browser.newPage({viewport:{width,height:width===1440?900:700},locale:'en-US',reducedMotion:'reduce'});
  await page.addInitScript(([mode,theme,lang])=>{localStorage.setItem('patzer-site-theme',theme);localStorage.setItem('lang',lang)},[mode,theme,lang]);
  await page.route('**/api/**',async request=>{const path=new URL(request.request().url()).pathname;const fixtures={'/api/setup/status':{setup_required:mode.startsWith('setup')},'/api/auth/me':{user:null},'/api/auth/config':{signup_enabled:mode!=='signup-closed',signup_mode:mode==='signup-closed'?'closed':'open',email_enabled:true,oidc_enabled:false,oidc_only:false,oidc_button_text:null}};await request.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixtures[path]??{})});});
  await page.goto(origin+(mode.startsWith('signup')?'/signup':'/setup'),{waitUntil:'domcontentloaded'});
  const first=page.locator(mode==='signup-open'?'#signup-username':mode==='signup-closed'?'a[href="/login"]':'#setup-username');await first.waitFor();
  if(mode==='setup-step2') {await page.locator('#setup-username').fill('test-owner');await page.locator('#setup-password').fill('strong-password-123');await page.getByRole('button',{name:/Next|Weiter/}).click();await page.locator('#setup-ollama-url').waitFor({state:'visible'});}
  await page.addStyleTag({content:`html {font-size:${font}px!important}`});await page.evaluate(()=>document.fonts.ready);
  const data=await page.evaluate(mode=>{let nodes;if(mode.startsWith('signup'))nodes=[...document.querySelectorAll('[data-auth-shell] .ui-card input,[data-auth-shell] .ui-card button,[data-auth-shell] .ui-card a[href]')];else nodes=[...document.querySelectorAll('#setup-username,#setup-display-name,#setup-password,#setup-ollama-url,#setup-ollama-model,button:not([data-testid])')].filter(el=>el.closest('.card'));return{controls:nodes.map(el=>{const r=el.getBoundingClientRect();return{label:el.id||el.getAttribute('aria-label')||el.textContent?.trim().slice(0,45),tag:el.tagName,href:el.getAttribute('href'),height:r.height,width:r.width}}),overflow:document.documentElement.scrollWidth-innerWidth,body:document.querySelector('main')?.textContent?.trim().slice(0,110)}} ,mode);
  const wrong=data.controls.filter(c=>c.width<44||c.height<44);
  if(wrong.length||data.overflow>1||!data.controls.length) {
    throw Error(`Public onboarding ${mode}/${theme}/${lang}/${width}px/font${font}: ${JSON.stringify({wrong,overflow:data.overflow})}`);
  }
  if(await page.evaluate(()=>document.documentElement.lang)!==lang) {
    throw Error(`Public onboarding ${mode}/${theme}/${lang}/${width}px/font${font}: wrong HTML language`);
  }
  if(width===320&&font===16&&lang==='en')await page.screenshot({path:`artifacts/agent-02/signup-setup-verified-${mode}-${theme}.png`});
  checks++;
  await page.close();
 }
  console.log(`Agent B Signup/Setup: ${checks} Chromium cases passed.`);
}finally{await browser?.close();server.kill('SIGTERM')}
