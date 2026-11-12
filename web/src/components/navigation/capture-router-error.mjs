// Independent browser smoke for the top-level React Router error fallback.
// Intentionally malformed local session fixtures reproduce an uncaught render
// error without editing any real feature component or production data.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(root, 'artifacts/agent-02');
const origin = 'http://127.0.0.1:4202';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let server;
let browser;
let broken = true;

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4202', '--strictPort'], {
    cwd: resolve(root, 'web'), stdio: 'inherit', env: { ...process.env, CI: '1' },
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Local Vite server exited');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* loading */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Local Vite server failed to start');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const payload = pathname === '/api/setup/status' ? { setup_required: false }
      : pathname === '/api/auth/me' ? broken
        ? { user: { id: 1, username: 'untrusted-bad-fixture', profile: null } }
        : { user: null }
      : pathname === '/api/auth/config'
        ? { signup_enabled: true, signup_mode: 'open', email_enabled: true, oidc_enabled: false,
          oidc_only: false, oidc_button_text: null } : {};
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  for (const color of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: color });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      broken = true;
      await page.setViewportSize(viewport);
      await page.goto(origin + '/review', { waitUntil: 'domcontentloaded' });
      const error = page.getByRole('alert', { name: 'Page unavailable' });
      try {
        await error.waitFor();
      } catch (failure) {
        console.error('Unbranded error fallback preview:', (await page.locator('body').innerText()).slice(0, 500));
        throw failure;
      }
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth, html: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      if (Math.max(metrics.html, metrics.body) > metrics.viewport + 1) {
        throw new Error('Error fallback overflow: ' + JSON.stringify(metrics));
      }
      const body = await page.locator('body').innerText();
      if (body.includes('TypeError') || body.includes('ErrorBoundary') || body.includes('Unexpected Application Error')) {
        throw new Error('Runtime error details were exposed to the end user');
      }
      await page.screenshot({ path: resolve(output, `router-error-${color}-${viewport.width}.png`), fullPage: true });
      broken = false;
      await page.getByRole('button', { name: 'Reload page' }).click();
      await page.getByRole('textbox', { name: 'Username' }).waitFor();
    }
  }
  console.log('Agent B global React Router error fallback: Chromium checks passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
