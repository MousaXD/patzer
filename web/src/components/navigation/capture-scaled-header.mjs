// Local-only Chromium regression for the authenticated mobile header at 100%,
// 150% and 200% root text scaling. API responses are synthetic.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4186';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4186', '--strictPort'], {
  cwd: resolve(root, 'web'), stdio: 'ignore',
});
let browser;
let theme = 'light';
let language = 'en';
let cases = 0;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Header fixture Vite exited');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Header fixture Vite did not start');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 700 }, locale: 'en-US', reducedMotion: 'reduce' });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const profile = { user_id: 1, display_name: 'International Long Name', avatar_emoji: '♟', language, audience: 'intermediate', site_theme: theme };
    const responses = {
      '/api/setup/status': { setup_required: false },
      '/api/auth/me': { user: { id: 1, username: 'sample-player', role: 'user', created_at: '2026-01-01', profile } },
      '/api/meta': { version: '7.19.0' },
      '/api/meta/update': { enabled: false, updateAvailable: false },
      '/api/games': { games: [] },
      '/api/stats/me': { total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null },
      '/api/plan': { goals: [] },
      '/api/achievements': { achievements: [] },
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[pathname] ?? {}) });
  });
  for (theme of ['light', 'dark']) for (language of ['en', 'de', 'es', 'ru', 'bg']) for (const width of [320, 390]) for (const font of [16, 24, 32]) {
    await page.setViewportSize({ width, height: width === 320 ? 700 : 844 });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const header = page.locator('[data-workspace-header]');
    await header.waitFor();
    await page.waitForFunction(code => document.documentElement.lang === code, language);
    await page.addStyleTag({ content: `html { font-size: ${font}px !important }` });
    await page.evaluate(() => document.fonts.ready);
    const result = await header.evaluate(element => {
      const bounds = node => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      };
      const title = element.querySelector('[data-current-section]');
      const logo = element.querySelector('a[aria-label="Patzer"]');
      const search = element.querySelector('button[title]');
      const menu = element.querySelector('button[aria-controls="patzer-mobile-drawer"]');
      const links = [logo, search, menu].filter(Boolean).map(node => ({ name: node.getAttribute('aria-label'), ...bounds(node) }));
      const titleBounds = bounds(title);
      return {
        title: { ...titleBounds, text: title.textContent?.trim(), scrollWidth: title.scrollWidth, clientWidth: title.clientWidth },
        links,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        headerOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    const invalid = result.overflow > 1 || result.headerOverflow > 1 || result.title.width < 30 ||
      result.title.scrollWidth > result.title.clientWidth + 1 ||
      result.links.length !== 3 || result.links.some(control =>
        control.width < 44 || control.height < 44 || control.left < 0 || control.right > width + 1);
    if (invalid) throw new Error(`Scaled mobile header ${theme}/${language}/${width}px/font${font}: ${JSON.stringify(result)}`);
    const searchButton = page.getByRole('button', { name: /command palette|befehlspalette|командная|palette/i });
    const menuButton = page.locator('button[aria-controls="patzer-mobile-drawer"]');
    await searchButton.focus();
    if (!await searchButton.evaluate(node => node === document.activeElement && node.matches(':focus-visible'))) {
      throw new Error(`Scaled header search keyboard focus not visible: ${theme}/${language}/${width}px/font${font}`);
    }
    await menuButton.focus();
    await page.keyboard.press('Enter');
    await page.locator('#patzer-mobile-drawer').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.locator('#patzer-mobile-drawer').waitFor({ state: 'detached' });
    if (!await menuButton.evaluate(node => node === document.activeElement)) {
      throw new Error(`Scaled header menu focus not restored: ${theme}/${language}/${width}px/font${font}`);
    }
    if (language === 'de' && width === 320 && font === 32) {
      await page.screenshot({ path: resolve(root, `artifacts/agent-02/mobile-header-verified-${theme}-de-320-font32.png`) });
    }
    cases++;
  }
  console.log(`Agent B scaled mobile header: ${cases} Chromium cases passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
