// Real Chromium smoke of Patzer's public auth shell. A local Vite instance and
// mocked auth capabilities keep credentials, live services and data untouched.
// Optional runtime dependency: playwright (not part of the production bundle).
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(root, 'artifacts/agent-02');
const origin = 'http://127.0.0.1:4188';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let browser;
let server;
let ssoOnly = false;
let slowConfig = false;
let configProbe = 'ok';

async function assertNoOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (Math.max(metrics.html, metrics.body) > metrics.viewport + 1) {
    throw new Error(`${label}: horizontal overflow ${JSON.stringify(metrics)}`);
  }
}

async function assertAuthTextContrast(page, label) {
  const metrics = await page.evaluate(() => {
    function luminance(color) {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      if (channels.length !== 3) return NaN;
      const linear = channels.map((channel) => {
        const unit = channel / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    const card = document.querySelector('.auth-shell .ui-card');
    if (!card) return { count: 0, min: NaN };
    const background = luminance(getComputedStyle(card).backgroundColor);
    const targets = [...card.querySelectorAll('.text-ink-400,.text-ink-500,.text-ink-600,.text-accent-600,.text-bad')];
    return {
      count: targets.length,
      min: Math.min(...targets.map((node) => {
        const foreground = luminance(getComputedStyle(node).color);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      })),
    };
  });
  if (metrics.count > 0 && metrics.min < 4.5) {
    throw new Error(`${label}: unreadable auth helper/link text ${JSON.stringify(metrics)}`);
  }
}

async function captureLogin(page, colorScheme, viewport) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.setViewportSize(viewport);
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  await page.getByRole('textbox', { name: 'Username' }).waitFor();
  await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, colorScheme === 'dark');
  await page.evaluate(() => document.fonts.ready);
  await assertNoOverflow(page, `login ${colorScheme} ${viewport.width}`);
  await assertAuthTextContrast(page, `login ${colorScheme} ${viewport.width}`);
  const language = page.getByRole('navigation', { name: 'Language' });
  if ((await language.locator('button[aria-pressed="true"]').count()) !== 1 ||
      (await language.locator('button').count()) !== 5) {
    throw new Error('Language selector is not a single-select five-language control');
  }
  if (viewport.width >= 1024) {
    await page.getByRole('region', { name: 'About Patzer' }).waitFor();
  }
  await page.screenshot({ path: resolve(output, `auth-login-${colorScheme}-${viewport.width}.png`), fullPage: true });
}

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4188', '--strictPort'], {
    cwd: resolve(root, 'web'),
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error(`Vite exited ${server.exitCode}`);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* booting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Vite did not start');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
  page.setDefaultTimeout(6500);
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/auth/config' && slowConfig) await sleep(350);
    if (pathname === '/api/auth/config' && configProbe === 'error') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily_unavailable"}' });
      return;
    }
    if (pathname === '/api/auth/config' && configProbe === 'invalid') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"signup_enabled":false}' });
      return;
    }
    const payload = pathname === '/api/setup/status' ? { setup_required: false }
      : pathname === '/api/auth/me' ? { user: null }
      : pathname === '/api/auth/config' ? {
        signup_enabled: !ssoOnly, signup_mode: ssoOnly ? 'closed' : 'open',
        email_enabled: !ssoOnly, oidc_enabled: ssoOnly, oidc_only: ssoOnly,
        oidc_button_text: null,
      } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await captureLogin(page, colorScheme, viewport);
    }
  }

  // Shared account journeys use the same auth shell and remain accessible at
  // narrow widths. Never follow credential/token links or submit real data.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 320, height: 700 });
  for (const route of ['/signup', '/forgot-password', '/reset-password', '/verify-email']) {
    await page.goto(origin + route, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Patzer' }).waitFor();
    if (route === '/signup') {
      await page.getByRole('textbox', { name: 'Username' }).waitFor();
      await page.getByRole('textbox', { name: 'Display name' }).waitFor();
      await page.getByLabel('Password', { exact: true }).waitFor();
    } else if (route === '/forgot-password' || route === '/verify-email') {
      await page.getByRole('textbox', { name: 'Email' }).waitFor();
    }
    await assertNoOverflow(page, route);
    await assertAuthTextContrast(page, route);
    if ((await page.locator('a[href*="github.com"]').count()) !== 0) {
      throw new Error(`${route} unexpectedly links to third-party promotions`);
    }
    await page.screenshot({ path: resolve(output, `auth-${route.slice(1)}-dark-320.png`), fullPage: true });
  }
  await page.goto(origin + '/reset-password?token=browser-fixture-not-real', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('New password').waitFor();
  await page.getByLabel('Confirm password').waitFor();
  await assertNoOverflow(page, 'reset password form');
  await assertAuthTextContrast(page, 'reset password form');

  // The anonymous UI should respond to OS theme changes without a refresh.
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Username' }).waitFor();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));

  // A slow capability probe must never flash username/password on an SSO-only
  // server. The same card must explain that sign-in options are loading.
  ssoOnly = true;
  slowConfig = true;
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-auth-config-loading]').waitFor();
  if ((await page.locator('#login-password').count()) !== 0) throw new Error('Password form flashed before auth config loaded');
  await page.getByRole('link', { name: 'Sign in with SSO' }).waitFor();
  if ((await page.locator('#login-password').count()) !== 0) throw new Error('SSO-only mode exposed password form');
  await assertNoOverflow(page, 'SSO-only login');

  await page.goto(origin + '/signup', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-auth-config-loading]').waitFor();
  if ((await page.locator('#signup-username').count()) !== 0) throw new Error('Signup form flashed before auth config loaded');
  await page.getByRole('link', { name: 'Back to sign in' }).waitFor();
  if ((await page.locator('#signup-username').count()) !== 0) throw new Error('Closed signup still rendered registration inputs');

  // An unavailable or malformed capability probe must not silently fall back
  // to password login on an SSO-only installation. Recheck without reload.
  for (const colorScheme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 320, height: 700 }]) {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize(viewport);
      for (const mode of ['error', 'invalid']) {
        configProbe = mode;
        slowConfig = false;
        ssoOnly = true;
        await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
        await page.getByRole('alert', { name: 'Sign-in options unavailable' }).waitFor();
        if (await page.locator('#login-username, #login-password').count()) {
          throw new Error(`${colorScheme} ${viewport.width} ${mode}: password login exposed with unknown capabilities`);
        }
        if (await page.locator('a[href="/api/auth/oidc/start"]').count()) {
          throw new Error('SSO affordance must not be guessed from a failed probe');
        }
        await assertNoOverflow(page, `${colorScheme} ${viewport.width} ${mode} capability failure`);
        await page.screenshot({ path: resolve(output, `auth-config-${mode}-${colorScheme}-${viewport.width}.png`), fullPage: true });
        configProbe = 'ok';
        await page.getByRole('button', { name: 'Try again' }).click();
        await page.getByRole('link', { name: 'Sign in with SSO' }).waitFor();
        if (await page.locator('#login-password').count()) {
          throw new Error('Retry into SSO-only capabilities still exposed password fields');
        }
      }
    }
  }

  // On /signup, a failed capability probe should offer retry in place, not
  // claim that registration is disabled. After recovery honor open signup.
  await page.setViewportSize({ width: 320, height: 700 });
  configProbe = 'error';
  ssoOnly = false;
  await page.goto(origin + '/signup', { waitUntil: 'domcontentloaded' });
  await page.getByRole('alert', { name: 'Sign-in options unavailable' }).waitFor();
  if (await page.locator('#signup-username').count()) throw new Error('Signup exposed an unverified registration form');
  if (await page.getByText('Sign-up is currently disabled.').count()) throw new Error('Probe outage misreported as closed registration');
  configProbe = 'ok';
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('textbox', { name: 'Username' }).waitFor();

  // Unavailable-sign-in messaging remains understandable when changed to a
  // longer supported language on the narrowest mobile viewport.
  configProbe = 'error';
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('alert', { name: 'Sign-in options unavailable' }).waitFor();
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await page.getByRole('alert', { name: 'Anmeldeoptionen nicht verfügbar' }).waitFor();
  await assertNoOverflow(page, 'German 320px failed sign-in capability probe');
  await page.screenshot({ path: resolve(output, 'auth-config-error-dark-320-de.png'), fullPage: true });
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('alert', { name: 'Sign-in options unavailable' }).waitFor();

  // A remembered preference should survive sign-out, independent of OS mode.
  ssoOnly = false;
  slowConfig = false;
  configProbe = 'ok';
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => localStorage.setItem('patzer-site-theme', 'dark'));
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Username' }).waitFor();
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.evaluate(() => localStorage.removeItem('patzer-site-theme'));

  console.log('Agent B auth shell: Chromium public-page, theme, mobile, language and SSO-only checks passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
