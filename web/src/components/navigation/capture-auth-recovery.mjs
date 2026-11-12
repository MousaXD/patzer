// Local-only Chromium verification for public recovery screen touch targets.
// Request responses are synthetic; this does not send email or mutate accounts.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(root, 'artifacts/agent-02');
const origin = 'http://127.0.0.1:4186';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const scenarios = [
  { name: 'forgot-form', path: '/forgot-password' },
  { name: 'forgot-sent', path: '/forgot-password', action: 'forgot' },
  { name: 'reset-form', path: '/reset-password?token=fixture-token' },
  { name: 'reset-done', path: '/reset-password?token=fixture-token', action: 'reset' },
  { name: 'reset-missing-token', path: '/reset-password' },
  { name: 'verify-resend-form', path: '/verify-email' },
  { name: 'verify-resend-sent', path: '/verify-email', action: 'resend' },
  { name: 'verify-token-ok', path: '/verify-email?token=fixture-token' },
  { name: 'verify-token-failed', path: '/verify-email?token=fixture-token', verificationFails: true },
];

let server;
let browser;
try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
    { cwd: resolve(root, 'web'), stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Recovery fixture Vite process exited');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* server starting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Recovery fixture Vite did not start');
  browser = await chromium.launch({ headless: true });
  let checked = 0;
  for (const scenario of scenarios) {
    for (const theme of ['light', 'dark']) {
      for (const language of ['en', 'de']) {
        for (const { width, font } of [
          { width: 320, font: 16 }, { width: 320, font: 24 }, { width: 1440, font: 16 },
        ]) {
          const page = await browser.newPage({ viewport: { width, height: width === 320 ? 700 : 900 },
            locale: 'en-US', reducedMotion: 'reduce' });
          try {
            await page.addInitScript(([mode, lang]) => {
              localStorage.setItem('patzer-site-theme', mode);
              localStorage.setItem('lang', lang);
            }, [theme, language]);
            await page.route('**/api/**', async (route) => {
              const pathname = new URL(route.request().url()).pathname;
              const base = {
                '/api/setup/status': { setup_required: false },
                '/api/auth/me': { user: null },
              };
              const failed = pathname === '/api/auth/verify' && scenario.verificationFails;
              await route.fulfill({ status: failed ? 400 : 200, contentType: 'application/json',
                body: JSON.stringify(failed ? { error: 'expired' } : (base[pathname] ?? { success: true })) });
            });
            await page.goto(origin + scenario.path, { waitUntil: 'domcontentloaded' });
            await page.locator('[data-auth-shell]').waitFor({ state: 'visible' });
            await page.waitForFunction((lang) => document.documentElement.lang === lang, language);
            await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
            await page.addStyleTag({ content: `html { font-size: ${font}px !important; }` });
            if (scenario.action) {
              if (scenario.action === 'reset') {
                await page.locator('#reset-password').fill('strong-password-123');
                await page.locator('#reset-confirm').fill('strong-password-123');
              } else {
                await page.locator(scenario.action === 'forgot' ? '#forgot-email' : '#verify-email-address')
                  .fill('fixture@example.org');
              }
              const submit = page.locator('form button[type="submit"]');
              await submit.focus();
              await page.keyboard.press('Enter');
              await submit.waitFor({ state: 'detached' });
            } else if (scenario.name.startsWith('verify-token')) {
              await page.locator(scenario.verificationFails
                ? 'a[href="/verify-email"]' : 'a[href="/login"]').waitFor({ state: 'visible' });
            } else {
              await page.locator('[data-auth-shell] input, [data-auth-shell] a[href]').first().waitFor();
            }
            await page.evaluate(() => document.fonts.ready);
            const state = await page.locator('[data-auth-shell]').evaluate((shell) => {
              const nodes = [...shell.querySelectorAll('input, form button[type="submit"], a[href]')];
              return {
                targets: nodes.map((node) => {
                  const rect = node.getBoundingClientRect();
                  return { label: node.getAttribute('id') || node.textContent.trim(),
                    width: rect.width, height: rect.height, href: node.getAttribute('href') };
                }),
                overflow: document.documentElement.scrollWidth - window.innerWidth,
                pageLanguage: document.documentElement.lang,
              };
            });
            if (!state.targets.length || state.targets.some((target) => target.height < 44 || target.width < 44) ||
                state.overflow > 1 || state.pageLanguage !== language) {
              throw new Error(`Recovery ${scenario.name}/${theme}/${language}/${width}px/root${font}: ${JSON.stringify(state)}`);
            }
            const resultScreen = Boolean(scenario.action) || scenario.name === 'reset-missing-token' ||
              scenario.name.startsWith('verify-token');
            if (resultScreen) {
              const resultHeading = page.locator('[data-auth-result-heading]');
              await resultHeading.waitFor({ state: 'visible' });
              const result = await resultHeading.evaluate((heading) => ({
                focused: document.activeElement === heading,
                tabbable: heading.tabIndex,
                visibleFocus: heading.matches(':focus-visible'),
              }));
              const expectAlert = scenario.name === 'reset-missing-token' || scenario.verificationFails;
              const announcedResult = page.locator(expectAlert ? '[data-auth-shell] [role="alert"]' :
                '[data-auth-shell] [role="status"]');
              if (!result.focused || result.tabbable !== -1 ||
                  (Boolean(scenario.action) && !result.visibleFocus) ||
                  !(await announcedResult.isVisible())) {
                throw new Error(`Recovery result focus/announcement ${scenario.name}/${theme}/${language}/${width}px/root${font}: ${JSON.stringify(result)}`);
              }
              // A real keyboard user's next Tab should reach the remaining
              // recovery action, not leave them stranded on a removed form.
              await page.keyboard.press('Tab');
              const nextAction = await page.evaluate(() => ({
                tag: document.activeElement?.tagName,
                href: document.activeElement?.getAttribute('href'),
                focusVisible: document.activeElement?.matches(':focus-visible'),
              }));
              if (nextAction.tag !== 'A' || !nextAction.href || !nextAction.focusVisible) {
                throw new Error(`Recovery ${scenario.name} next keyboard action unavailable: ${JSON.stringify(nextAction)}`);
              }
            }
            if (width === 320 && font === 16 && language === 'en') {
              await page.screenshot({ path: resolve(output, `auth-recovery-${scenario.name}-${theme}-320.png`) });
            }
            checked++;
          } finally { await page.close(); }
        }
      }
    }
  }
  console.log(`Agent B auth recovery: ${checked} Chromium route/theme/language/text-size cases passed.`);
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
