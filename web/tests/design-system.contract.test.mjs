import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = path => readFileSync(repo + '/' + path, 'utf8');
const css = read('web/src/index.css');
const tw = read('web/tailwind.config.js');
const html = read('web/index.html');
const boot = read('web/public/theme-init.js');
const ui = read('web/src/components/ui/index.tsx');

const colors = ['bg','surface','surface-raised','surface-muted','surface-hover','surface-pressed',
  'foreground','foreground-muted','foreground-subtle','border','border-strong',
  'primary','primary-hover','primary-pressed','on-primary','focus','focus-offset',
  'danger','danger-hover','danger-surface','success','warning','info','overlay',
  'scroll-thumb','shadow-soft','shadow-popover'];
const shared = ['radius-sm','radius-md','radius-lg','duration','ease','disabled-opacity'];

test('light and dark semantic color coverage is complete', () => {
  const light = css.match(/:root\s*\{([^}]*--ui-bg:[^}]*)\}/s)?.[1];
  const dark = css.match(/html\.dark\s*\{([^}]*--ui-bg:[^}]*)\}/s)?.[1];
  assert.ok(light && dark);
  for (const key of colors) {
    assert.match(light, new RegExp('--ui-' + key + '\\s*:'));
    assert.match(dark, new RegExp('--ui-' + key + '\\s*:'));
  }
  for (const key of shared) assert.match(light, new RegExp('--ui-' + key + '\\s*:'));
  assert.match(light, /color-scheme:\s*light/);
  assert.match(dark, /color-scheme:\s*dark/);
  assert.match(tw, /ui:\s*\{/);
  for (const category of ['bg','surface','raised','muted','hover','pressed','foreground','border','primary','focus','danger'])
    assert.ok(tw.includes(category + ':'), 'Tailwind semantic color ' + category);
});

test('local fonts, license notices, and no system font stacks', () => {
  for (const name of ['patzer-sans-regular','patzer-sans-semibold','patzer-sans-bold',
    'patzer-sans-italic','patzer-mono-regular']) {
    const file = path.join(repo,'web/public/fonts',name + '.woff2');
    assert.ok(existsSync(file),name + ' missing');
    assert.ok(statSync(file).size > 10000,name + ' empty');
    assert.equal(readFileSync(file).subarray(0,4).toString('ascii'),'wOF2');
    assert.ok(css.includes('/fonts/' + name + '.woff2'));
  }
  for (const notice of ['INTER-LICENSE.txt','JETBRAINS-MONO-LICENSE.txt'])
    assert.ok(existsSync(path.join(repo,'web/public/fonts',notice)),notice + ' missing');
  assert.doesNotMatch(css + tw, /system-ui|Segoe UI|Arial|ui-monospace|SFMono-Regular|Consolas|sans-serif|monospace/i);
  assert.match(css, /font-family:'Patzer Sans'/);
  assert.match(css, /font-family:'Patzer Mono'/);
  assert.match(tw, /Patzer Sans/);
  assert.match(tw, /Patzer Mono/);
});

test('early light bootstrap, persistent explicit legacy auto and meta sync', () => {
  assert.ok(html.indexOf('/theme-init.js') >= 0 && html.indexOf('/theme-init.js') < html.indexOf('/src/main.tsx'));
  assert.match(boot, /var choice = 'light'/);
  assert.match(boot, /stored === 'auto'/);
  assert.match(boot, /prefers-color-scheme: dark/);
  assert.match(boot, /document\.documentElement\.classList\.toggle\('dark'/);
  const app = read('web/src/App.tsx');
  assert.match(app, /user\?\.profile\?\.site_theme/);
  assert.match(app, /patzer-site-theme/);
  assert.match(app, /query\.addEventListener\('change'/);
  assert.match(app, /if \(loading\) return/);
});

test('native input affordances, focus, reduced motion, and forced colors', () => {
  for (const marker of ["input[type='checkbox']","input[type='radio']","input[type='range']",
    "input[type='file']",':where(select)',':focus-visible',
    '::-webkit-slider-thumb','::-moz-range-thumb', "[aria-invalid='true']",':where(dialog)::backdrop'])
    assert.ok(css.includes(marker),'Missing native control: ' + marker);
  assert.match(css, /@media \(forced-colors:\s*active\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.doesNotMatch(css, /\*\s*\{\s*appearance:\s*none/);
});

test('accessible primitive API and no visual emoji in owned UI controls', () => {
  for (const name of ['Button','Input','Select','Textarea','Dialog','Tabs','Tooltip','Popover','Menu',
    'Field','Card','Badge','Spinner','Skeleton']) assert.match(ui, new RegExp('(?:const|function) '+name+'\\b'));
  assert.match(ui, /aria-labelledby/);
  assert.match(ui, /role="tablist"/);
  assert.match(ui, /aria-haspopup="menu"/);
  assert.match(ui, /focus\(\)/);
  assert.doesNotMatch(ui, /[\u{1F300}-\u{1FAFF}]/u);
});
