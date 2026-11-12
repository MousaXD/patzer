// Local-only Chromium coverage for the authenticated 768px/1024px app shell
// at 100%, 150% and 200% text scaling. All API data is synthetic.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4186';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1', '--port', '4186', '--strictPort'],
{ cwd: resolve(root, 'web'), stdio: 'ignore' });
let browser;
let theme = 'light';
let language = 'en';
let checked = 0;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Tablet fixture Vite stopped');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Tablet fixture Vite did not start');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 },
    reducedMotion: 'reduce', locale: 'en-US' });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const profile = { user_id: 1, display_name: 'Long Player Name', language,
      audience: 'intermediate', site_theme: theme };
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
  for (theme of ['light', 'dark']) for (language of ['en', 'de', 'es', 'ru', 'bg'])
    for (const width of [768, 1024]) for (const font of [16, 24, 32]) {
      await page.setViewportSize({ width, height: width === 768 ? 1024 : 768 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const header = page.locator('[data-workspace-header]');
      await header.waitFor();
      await page.waitForFunction(lang => document.documentElement.lang === lang, language);
      await page.waitForFunction(dark => document.documentElement.classList.contains('dark') === dark, theme === 'dark');
      await page.addStyleTag({ content: `html { font-size:${font}px !important; }` });
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => {
        const bounds = el => {
          const r = el.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const h = document.querySelector('[data-workspace-header]');
        const rail = document.querySelector('[data-navigation-rail]');
        const title = h.querySelector('[data-current-section]');
        const controls = [...h.querySelectorAll('button,select,a[href]')]
          .filter(el => el.getBoundingClientRect().width > 0)
          .map(el => ({ name: el.getAttribute('aria-label') || el.title, ...bounds(el) }));
        const select = h.querySelector('select[data-shell-language]');
        const s = getComputedStyle(select);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = s.font;
        const textWidth = ctx.measureText(select.selectedOptions[0]?.text ?? '').width;
        const horizontalPadding = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight);
        const verticalPadding = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
        const availableTextWidth = select.clientWidth - horizontalPadding;
        return {
          rail: { ...bounds(rail), scrollOverflow: rail.scrollWidth - rail.clientWidth },
          header: { ...bounds(h), scrollOverflow: h.scrollWidth - h.clientWidth },
          title: { ...bounds(title), scrollWidth: title.scrollWidth, clientWidth: title.clientWidth },
          controls,
          language: { selected: select.selectedOptions[0]?.text, availableTextWidth, textWidth,
            contentHeight: parseFloat(s.lineHeight) + verticalPadding, height: select.getBoundingClientRect().height,
            backgroundImage: s.backgroundImage },
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      if (state.rail.width !== 80 || state.rail.scrollOverflow > 1 ||
          state.title.width < 35 || state.title.scrollWidth > state.title.clientWidth + 1 ||
          state.header.height !== 56 || state.header.scrollOverflow > 1 || state.overflow > 1 ||
          state.controls.length !== 5 || state.controls.some(c => c.width < 44 || c.height < 44 || c.right > width + 1) ||
          !state.language.selected || state.language.textWidth > state.language.availableTextWidth + 1 ||
          state.language.contentHeight + 2 > state.language.height || state.language.backgroundImage !== 'none') {
        throw new Error(`Scaled tablet shell ${theme}/${language}/${width}px/font${font}: ${JSON.stringify(state)}`);
      }
      const selector = header.locator('select[data-shell-language]');
      await selector.focus();
      if (!await selector.evaluate(el => document.activeElement === el && el.matches(':focus-visible'))) {
        throw new Error(`Tablet language selector has no visible keyboard focus: ${theme}/${language}/${width}px/font${font}`);
      }
      if (language === 'de' && font === 32) {
        await page.screenshot({ path: resolve(root,
          `artifacts/agent-02/tablet-shell-verified-${theme}-${width}-font${font}.png`) });
      }
      checked++;
    }
  console.log(`Agent B scaled tablet shell: ${checked} Chromium cases passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
