// Agent B: local-only Chromium regression for Recent Games at 100%-200% text.
// All API results are synthetic; no production game records are touched.
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
let language = 'en';
let theme = 'light';
let checked = 0;
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Recent Games fixture Vite stopped');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* loading */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Recent Games fixture Vite unavailable');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' });
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const profile = { user_id: 1, display_name: 'Sample Player', avatar_emoji: '♟', language,
      site_theme: theme, audience: 'intermediate' };
    const games = [
      { id: 103, white: 'sample-player', black: 'OpponentWithALongName', user_color: 'white',
        result: 'win', end_time: '2026-11-12T12:00:00Z', time_control: '600', analyzed: true,
        accuracy_white: 81.4, accuracy_black: 67.8 },
      { id: 104, white: 'AnotherLongOpponent', black: 'sample-player', user_color: 'black',
        result: 'loss', end_time: '2026-11-11T16:00:00Z', time_control: '300+2', analyzed: false },
    ];
    const responses = {
      '/api/setup/status': { setup_required: false },
      '/api/auth/me': { user: { id: 1, username: 'sample-player', role: 'user', created_at: '2026-01-01', profile } },
      '/api/meta': { version: '7.19.0' },
      '/api/meta/update': { enabled: false, updateAvailable: false },
      '/api/games': { games },
      '/api/stats/me': { total: 2, wins: 1, losses: 1, draws: 0, avg_accuracy: 75, streak: null },
      '/api/plan': { goals: [] },
      '/api/achievements': { achievements: [] },
    };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responses[pathname] ?? {}) });
  });
  for (theme of ['light', 'dark']) for (language of ['en', 'de', 'es', 'ru', 'bg'])
    for (const width of [320, 390]) for (const font of [16, 24, 32]) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 844 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const card = page.locator('ul:has(a[href="/review/103"])');
      await card.waitFor({ state: 'visible' });
      await page.waitForFunction(lang => document.documentElement.lang === lang, language);
      await page.addStyleTag({ content: `html { font-size: ${font}px !important; }` });
      await page.evaluate(() => document.fonts.ready);
      const data = await card.evaluate(root => {
        const rect = node => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, width: r.width, height: r.height };
        };
        const bounds = root.getBoundingClientRect();
        const visibleTextFraction = el => {
          const text = el?.firstChild;
          if (!text || text.nodeType !== Node.TEXT_NODE) return null;
          const area = el.getBoundingClientRect();
          let total = 0, visible = 0;
          for (let i = 0; i < text.length; i++) {
            if (!/\S/.test(text.textContent[i])) continue;
            total++;
            const range = document.createRange();
            range.setStart(text, i);
            range.setEnd(text, i + 1);
            const r = range.getBoundingClientRect();
            if (r.left >= area.left - 1 && r.right <= area.right + 1 &&
                r.top >= area.top - 1 && r.bottom <= area.bottom + 1) visible++;
          }
          return { visible, total, fraction: total ? visible / total : 0 };
        };
        const overflows = [...root.querySelectorAll('*')].filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.left < bounds.left - 1 || r.right > bounds.right + 1);
        }).slice(0, 8).map(el => ({ text: el.textContent?.trim().slice(0, 50), ...rect(el) }));
        const rows = [...root.querySelectorAll('li a[href]')].map(link => {
          const opponent = link.querySelector('[data-home-recent-opponent]');
          const badge = link.querySelector('[role="img"]');
          const time = link.querySelector('[data-home-recent-time-control]');
          return {
            href: link.getAttribute('href'), rect: rect(link),
            opponent: visibleTextFraction(opponent), badge: { ...rect(badge), label: badge.getAttribute('aria-label') },
            time: visibleTextFraction(time),
            date: visibleTextFraction(link.querySelector('[data-home-recent-date]')),
            unreviewed: visibleTextFraction(link.querySelector('[data-home-recent-unreviewed]')),
            selfAccuracy: link.querySelector('[data-home-accuracy-self]')?.textContent?.trim(),
            opponentAccuracy: link.querySelector('[data-home-accuracy-opponent]')?.textContent?.trim(),
          };
        });
        return { card: rect(root), overflows, rows,
          overflow: document.documentElement.scrollWidth - window.innerWidth };
      });
      const invalid = data.overflows.length || data.overflow > 1 || data.rows.length !== 2 ||
        data.rows.some(row => row.rect.width < 44 || row.rect.height < 44 ||
          row.opponent?.fraction < 0.75 || !row.badge.label ||
          row.badge.width < 28 || row.badge.height < 28 || row.time?.fraction < 1 ||
          row.date?.fraction < 1 || row.unreviewed?.fraction < 1 ||
          row.rect.right > data.card.right + 1) ||
        data.rows[0]?.href !== '/review/103' || data.rows[1]?.href !== '/review/104' ||
        data.rows[0]?.selfAccuracy !== '81.4%' || data.rows[0]?.opponentAccuracy !== '67.8%';
      if (invalid) throw new Error(`Recent Games ${theme}/${language}/${width}px/font${font}: ${JSON.stringify(data)}`);
      if (font === 32 && width === 320 && language === 'de') {
        const first = card.locator('a[href="/review/103"]');
        let focused = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          await page.keyboard.press('Tab');
          if (await first.evaluate(node => node === document.activeElement && node.matches(':focus-visible'))) {
            focused = true;
            break;
          }
        }
        if (!focused) throw new Error(`Recent Games link is not keyboard accessible: ${theme}`);
        await card.screenshot({ path: resolve(root, `artifacts/agent-02/home-recent-verified-${theme}-320-font32.png`) });
      }
      checked++;
    }
  console.log(`Agent B zoomed Recent Games: ${checked} Chromium cases passed.`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
