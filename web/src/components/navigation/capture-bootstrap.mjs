// Authenticated/anonymous app bootstrap verification with local API fixtures.
// This harness never connects to real Patzer accounts or database services.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4196';
const output = resolve(root, 'artifacts/agent-02');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let server;
let browser;
let failure = 'setup';
let delaySetup = 0;

async function noOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth,
  }));
  if (widths.body > widths.viewport + 1 || widths.html > widths.viewport + 1) {
    throw new Error(label + ': horizontal overflow ' + JSON.stringify(widths));
  }
}

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4196', '--strictPort'], {
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
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/setup/status') {
      if (delaySetup) await sleep(delaySetup);
      if (failure === 'setup') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"setup_required":false}' });
    }
    if (path === '/api/auth/me') {
      if (failure === 'session') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unavailable"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":null}' });
    }
    if (path === '/api/auth/config') {
      const config = { signup_enabled: true, signup_mode: 'open', email_enabled: true,
        oidc_enabled: false, oidc_only: false, oidc_button_text: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(config) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  for (const color of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: color });
    for (const width of [1440, 390, 320]) {
      for (const brokenEndpoint of ['setup', 'session']) {
        failure = brokenEndpoint;
        delaySetup = 0;
        await page.setViewportSize({ width, height: width > 1000 ? 900 : 700 });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.getByRole('alert', { name: /server|connection|unavailable/i }).waitFor();
        await noOverflow(page, `bootstrap ${color} ${width} ${brokenEndpoint}`);
        await page.screenshot({ path: resolve(output, `bootstrap-${color}-${width}-${brokenEndpoint}.png`) });
        const retry = page.getByRole('button', { name: /try again|retry/i });
        await retry.waitFor();
        failure = 'none';
        await retry.click();
        await page.getByRole('textbox', { name: 'Username' }).waitFor();
        if (new URL(page.url()).pathname !== '/login') throw new Error('Healthy retry did not reach login');
      }
    }
  }
  failure = 'none';
  delaySetup = 500;
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('status', { name: /starting|loading/i }).waitFor();
  await page.screenshot({ path: resolve(output, 'bootstrap-loading.png') });
  await page.getByRole('textbox', { name: 'Username' }).waitFor();
  console.log('Agent B bootstrap availability, loading and retry: Chromium checks passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
