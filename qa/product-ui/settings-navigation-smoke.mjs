/**
 * Browser regression for Settings draft protection on the production bundle.
 * Run after `npm run build` and `npm run setup`:
 *   node qa/product-ui/settings-navigation-smoke.mjs
 *
 * Uses a temporary SQLite DB, a dedicated localhost port and a test account.
 * Never touches a live Patzer installation or another agent's QA database.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = Number(process.env.PATZER_PRODUCT_UI_QA_PORT || 8896);
const base = `http://127.0.0.1:${port}`;
const workdir = mkdtempSync(join(tmpdir(), 'patzer-settings-browser-'));
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';
process.env.DB_PATH = join(workdir, 'qa.db');

let browser;
const errors = [];

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'GET' ? {} : { 'X-Requested-With': 'patzer' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12_000),
  });
  return { status: response.status, data: await response.json() };
}

try {
  await import('../../server/dist/index.js');
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { ready = (await api('/api/health')).status === 200; } catch { /* booting */ }
    if (ready) break;
    await sleep(250);
  }
  assert.ok(ready, 'disposable server failed to start');
  const setup = await api('/api/setup/init', {
    method: 'POST',
    body: { username: 'qaproduct', password: 'local-qa-password-123', display_name: 'Initial QA Player', language: 'en' },
  });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/login');
  await page.locator('#login-username').fill('qaproduct');
  await page.locator('#login-password').fill('local-qa-password-123');
  await page.locator('#login-password').press('Enter');
  await page.waitForURL((url) => url.pathname !== '/login', { timeout: 15000 });

  await page.goto(base + '/settings');
  const name = page.locator('#settings-display-name');
  await name.waitFor({ state: 'visible' });
  await name.fill('Draft that must not disappear');
  await page.getByRole('link', { name: 'Home' }).first().click();
  const dialog = page.getByRole('alertdialog', { name: 'Leave without saving?' });
  await dialog.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).pathname, '/settings', 'navigation must be blocked');
  assert.equal(await name.inputValue(), 'Draft that must not disappear');
  console.log('PASS unsaved navigation shows accessible confirmation');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await name.inputValue(), 'Draft that must not disappear');
  await page.getByRole('link', { name: 'Home' }).first().click();
  await dialog.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, '/settings');
  assert.equal(await name.inputValue(), 'Draft that must not disappear');
  console.log('PASS Escape and Keep editing preserve the draft');

  await page.getByRole('link', { name: 'Home' }).first().click();
  await dialog.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  await page.goto(base + '/settings');
  await name.waitFor({ state: 'visible' });
  assert.equal(await name.inputValue(), 'Initial QA Player', 'discard must not write to the server');
  console.log('PASS Discard changes navigates without saving');

  await name.fill('QA Saved Player');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('link', { name: 'Home' }).first().click();
  await page.waitForURL((url) => url.pathname === '/');
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  // Use a client-side Link for the final history round-trip. A page.goto()
  // creates a separate document history entry; SPA blockers do not intercept
  // cross-document navigation (the native beforeunload handler owns that).
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await page.waitForURL((url) => url.pathname === '/settings');
  await name.waitFor({ state: 'visible' });
  assert.equal(await name.inputValue(), 'QA Saved Player');
  console.log('PASS a saved profile navigates without prompting and remains persisted');

  await name.fill('Draft for browser back');
  await page.evaluate(() => window.history.back());
  await dialog.waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).pathname, '/settings');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await name.inputValue(), 'Draft for browser back');
  console.log('PASS browser Back respects unsaved Settings changes');

  assert.deepEqual(errors, [], 'uncaught browser exceptions');
  console.log('Settings browser QA: 5 PASS, 0 FAIL');
} catch (error) {
  console.error('Settings browser QA FAILED:', error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  rmSync(workdir, { recursive: true, force: true });
  // The imported server has a listener and workers; end this disposable test
  // process explicitly after closing the browser and deleting the database.
  process.exit(process.exitCode || 0);
}
