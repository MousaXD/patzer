// First-run setup journey in real Chromium, using a local mocked server only.
// No real admin account, AI connection, game data or production mutation.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4204';
const output = resolve(root, 'artifacts/agent-02');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let server;
let browser;

async function checkViewport(page, label, checkLanguages = true) {
  const result = await page.evaluate(() => ({
    body: document.body.scrollWidth, html: document.documentElement.scrollWidth,
    viewport: innerWidth,
    languageButtons: [...document.querySelectorAll('[data-setup-languages] button')].map((node) => ({
      right: node.getBoundingClientRect().right,
      left: node.getBoundingClientRect().left,
      height: node.getBoundingClientRect().height,
    })),
  }));
  if (Math.max(result.body, result.html) > result.viewport + 1) {
    throw new Error(label + ': page overflow: ' + JSON.stringify(result));
  }
  if (checkLanguages && (result.languageButtons.length !== 5 || result.languageButtons.some((b) => b.left < -1 || b.right > result.viewport + 1 || b.height < 44))) {
    throw new Error(label + ': languages clipped or too small: ' + JSON.stringify(result));
  }
}

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4204', '--strictPort'], {
    cwd: resolve(root, 'web'), stdio: 'inherit', env: { ...process.env, CI: '1' },
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Vite exited');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Vite did not start');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6500);
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const payload = pathname === '/api/setup/status' ? { setup_required: true }
      : pathname === '/api/setup/test-ollama' ? { ok: false, error: 'unreachable' } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  for (const color of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: color });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport);
      await page.goto(origin + '/setup', { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Welcome to Patzer' }).waitFor();
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
      await page.screenshot({ path: resolve(output, `setup-step1-${color}-${viewport.width}.png`), fullPage: true });
      const langs = page.getByRole('group', { name: 'Language' });
      await langs.waitFor();
      if ((await langs.getByRole('button', { pressed: true }).count()) !== 1) {
        throw new Error('Setup language selection lacks a unique accessible selected state');
      }
      await checkViewport(page, `setup ${color} ${viewport.width}`);
      await page.getByRole('textbox', { name: 'Username' }).fill('admin-example');
      await page.getByRole('textbox', { name: 'Display name' }).fill('Example Admin');
      await page.getByLabel('Password').fill('fixture-password-123');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('heading', { name: /Connect Ollama/ }).waitFor();
      await page.getByRole('textbox', { name: 'Ollama URL' }).waitFor();
      await page.screenshot({ path: resolve(output, `setup-step2-${color}-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Test connection' }).click();
      await page.getByRole('alert').waitFor();
      await checkViewport(page, `setup step2 ${color} ${viewport.width}`, false);
      await page.getByRole('button', { name: 'Back' }).click();
      await page.getByRole('textbox', { name: 'Username' }).waitFor();
      if ((await page.getByRole('textbox', { name: 'Username' }).inputValue()) !== 'admin-example') {
        throw new Error('Setup wizard lost account details when returning from step 2');
      }
    }
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin + '/setup', { waitUntil: 'domcontentloaded' });
  await page.getByRole('group', { name: 'Language' }).waitFor();
  for (const selected of [
    { button: 'Deutsch', label: 'Sprache' },
    { button: 'Русский', label: 'Язык' },
  ]) {
    await page.getByRole('button', { name: selected.button }).click();
    const group = page.getByRole('group', { name: selected.label });
    await group.waitFor();
    if ((await group.getByRole('button', { pressed: true }).count()) !== 1) {
      throw new Error(`No unique selected language at 320px: ${selected.label}`);
    }
    await checkViewport(page, `setup 320px ${selected.label}`);
    await page.screenshot({ path: resolve(output, `setup-320-${selected.label === 'Sprache' ? 'de' : 'ru'}.png`), fullPage: true });
  }
  console.log('Agent B first-run setup: responsive Chromium flow passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
