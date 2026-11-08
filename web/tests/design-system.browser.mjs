import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({headless:true});
const url=process.env.PATZER_PREVIEW_URL || 'http://127.0.0.1:4173';
function luminance(value) {
  const match=value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  assert.ok(match,'Unexpected color '+value);
  const a=match.slice(1,4).map(Number).map(x=>{
    const n=x/255; return n<=0.04045 ? n/12.92 : ((n+.055)/1.055)**2.4;
  });
  return .2126*a[0]+.7152*a[1]+.0722*a[2];
}
function contrast(fg,bg) {
  const a=[luminance(fg),luminance(bg)].sort((x,y)=>y-x);
  return (a[0]+.05)/(a[1]+.05);
}
async function check(os,stored,wantDark) {
  const ctx=await browser.newContext({colorScheme:os});
  const page=await ctx.newPage();
  await page.addInitScript(value=>{
    try {
      localStorage.removeItem('patzer-site-theme');
      if(value) localStorage.setItem('patzer-site-theme',value);
    } catch { /* private mode */ }
  },stored);
  // Keep built CSS and synchronous head script, suppress user-profile loading.
  await page.route(/\/assets\/[^/]+\.js(?:\?|$)/,route=>route.abort());
  await page.goto(url,{waitUntil:'domcontentloaded'});
  const initial=await page.evaluate(()=>({
    dark:document.documentElement.classList.contains('dark'),
    theme:document.documentElement.dataset.theme,
    scheme:getComputedStyle(document.documentElement).colorScheme,
  }));
  assert.equal(initial.dark,wantDark,'OS '+os+' stored '+stored);
  assert.equal(initial.theme,wantDark?'dark':'light');
  assert.equal(initial.scheme,wantDark?'dark':'light');
  await page.evaluate(()=>{
    const target=document.createElement('main');
    target.innerHTML=[
      '<button type="button" id="focus">Focusable</button>',
      '<input id="text" aria-label="Text" placeholder="Enter text" />',
      '<select id="select" aria-label="Options"><option>One</option></select>',
      '<textarea id="textarea" aria-label="Long text"></textarea>',
      '<input type="checkbox" id="check" aria-label="Checkbox" />',
      '<input type="radio" id="radio" name="example" aria-label="Radio" />',
      '<input type="range" id="range" aria-label="Range" />',
      '<input id="error" aria-invalid="true" aria-label="Invalid" />',
      '<div id="muted" style="color:var(--ui-foreground-muted);background:var(--ui-surface)">Muted</div>',
    ].join('');
    document.body.append(target);
  });
  const state=await page.evaluate(async()=>{
    await document.fonts.load('400 14px "Patzer Sans"');
    await document.fonts.load('600 14px "Patzer Sans"');
    await document.fonts.load('400 14px "Patzer Mono"');
    const style=s=>getComputedStyle(document.querySelector(s));
    return {
      body:style('body').backgroundColor, foreground:style('body').color,
      family:style('body').fontFamily,
      fonts:[...document.fonts].filter(f=>f.family.startsWith('Patzer'))
        .map(f=>({family:f.family,status:f.status})),
      textBorder:style('#text').borderStyle,
      textBackground:style('#text').backgroundColor,
      selectAppearance:style('#select').appearance,
      selectImage:style('#select').backgroundImage,
      checkboxAppearance:style('#check').appearance,
      mutedForeground:style('#muted').color,mutedBackground:style('#muted').backgroundColor,
    };
  });
  assert.match(state.family,/Patzer Sans/);
  for(const family of ['Patzer Sans','Patzer Mono'])
    assert.ok(state.fonts.some(f=>f.family===family&&f.status==='loaded'),family+' failed to load');
  assert.equal(state.textBorder,'solid');
  assert.notEqual(state.textBackground,'rgba(0, 0, 0, 0)');
  assert.equal(state.selectAppearance,'none');
  assert.match(state.selectImage,/url\(/);
  assert.equal(state.checkboxAppearance,'none');
  assert.ok(contrast(state.foreground,state.body)>=7,'Body contrast insufficient');
  assert.ok(contrast(state.mutedForeground,state.mutedBackground)>=4.5,'Muted contrast insufficient');
  await page.locator('#focus').focus();
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>{
    const style=getComputedStyle(document.activeElement);
    return {outline:style.outlineStyle,width:style.outlineWidth};
  });
  assert.notEqual(focus.outline,'none');
  assert.notEqual(focus.width,'0px');
  const before=await page.locator('#check').evaluate(el=>getComputedStyle(el).backgroundColor);
  await page.locator('#check').check();
  // The control deliberately animates to its checked color. Wait until it
  // reaches the actual semantic token, not the transient first animation frame.
  await page.waitForFunction(() => {
    const checkbox=document.querySelector('#check');
    const probe=document.createElement('span');
    probe.style.backgroundColor='var(--ui-primary)';
    document.body.append(probe);
    const target=getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(checkbox).backgroundColor===target;
  },null,{timeout:2000});
  const after=await page.locator('#check').evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.notEqual(before,after,'Checkbox lacks styled checked state');
  console.log('PASS OS='+os+' stored='+(stored??'none')+' theme='+(wantDark?'dark':'light'));
  await ctx.close();
}
try {
  for(const os of ['light','dark']) await check(os,null,false);
  await check('light','dark',true);
  await check('dark','light',false);
  await check('dark','auto',true);
  await check('light','auto',false);
  const ctx=await browser.newContext({reducedMotion:'reduce'});
  const page=await ctx.newPage();
  await page.route(/\/assets\/[^/]+\.js(?:\?|$)/,route=>route.abort());
  await page.goto(url,{waitUntil:'domcontentloaded'});
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement)
    .getPropertyValue('--ui-duration').trim()),'0ms');
  await ctx.close();
} finally { await browser.close(); }
