// Real Chromium smoke and reproducible screenshots of the authenticated shell.
// API responses are mocked for visual fixtures, not for backend certification.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(root, 'artifacts/agent-02');
const origin = 'http://127.0.0.1:4173';
const paths = ['/', '/play', '/review', '/insights', '/train', '/learn', '/openings', '/plan', '/players', '/lab'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let server;
let browser;
let theme = 'light';
let role = 'user';

const profile = {
  user_id: 1, display_name: 'Sample Player', avatar_emoji: '', language: 'en',
  audience: 'intermediate', chesscom_username: null, lichess_username: null,
  coach_behavior: 'on_demand', tts_enabled: 0, tts_voice: null, tts_rate: 1,
  tts_pitch: 1, board_theme: 'green', piece_set: 'cburnett', site_theme: 'light',
  blunder_warning: 1, sound_enabled: 0, sound_set: 'soft', move_sound_set: 'board',
  kid_piece_emotions: 0,
};

const fixtures = (pathname) => {
  if (pathname === '/api/setup/status') return { setup_required: false };
  if (pathname === '/api/auth/me') return {
    user: { id: 1, username: 'sample-player', role, created_at: '2026-01-01', profile: { ...profile, site_theme: theme } },
  };
  if (pathname === '/api/meta') return { version: '7.19.0' };
  if (pathname === '/api/meta/update') return { enabled: false, updateAvailable: false, current: '7.19.0', latest: null };
  if (pathname === '/api/games') return { games: [] };
  if (pathname === '/api/stats/me') return { total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null };
  if (pathname === '/api/plan') return { goals: [] };
  if (pathname === '/api/achievements') return { achievements: [] };
  return {};
};

async function checkNoHorizontalOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (widths.html > widths.viewport + 1 || widths.body > widths.viewport + 1) {
    throw new Error(label + ': horizontal overflow ' + JSON.stringify(widths));
  }
}

async function openWithFixture(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-shell]').waitFor({ timeout: 20000 });
  await page.locator('[data-navigation-rail]').waitFor({ state: 'attached' });
  await checkNoHorizontalOverflow(page, viewport.width + 'x' + viewport.height);
}

try {
  await mkdir(output, { recursive: true });
  server = spawn('npm', ['run', 'dev', '-w', 'web', '--', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CI: '1' },
  });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Vite terminated with code ' + server.exitCode);
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* booting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Vite failed to become ready');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixtures(url.pathname)) });
  });

  await openWithFixture(page, { width: 1440, height: 900 });
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const to of paths) {
    if ((await rail.locator('a[href="' + to + '"]').count()) !== 1) throw new Error('Missing rail destination ' + to);
  }
  await page.screenshot({ path: resolve(output, 'desktop-light.png') });
  await openWithFixture(page, { width: 1024, height: 768 });
  await page.screenshot({ path: resolve(output, 'laptop-light.png') });

  theme = 'dark';
  await openWithFixture(page, { width: 1440, height: 900 });
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: resolve(output, 'desktop-dark.png') });

  theme = 'light';
  await openWithFixture(page, { width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Mobile navigation' });
  await drawer.waitFor();
  for (const to of paths) {
    if ((await drawer.locator('a[href="' + to + '"]').count()) !== 1) throw new Error('Missing mobile destination ' + to);
  }
  await page.screenshot({ path: resolve(output, 'mobile-menu-light.png') });
  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  await checkNoHorizontalOverflow(page, '390x844 after drawer');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await drawer.waitFor();
  await page.setViewportSize({ width: 1024, height: 768 });
  await drawer.waitFor({ state: 'detached' });
  await checkNoHorizontalOverflow(page, '1024x768 after mobile-to-desktop resize');

  role = 'admin';
  await openWithFixture(page, { width: 1440, height: 900 });
  for (const to of ['/admin/users', '/admin/system']) {
    if ((await rail.locator('a[href="' + to + '"]').count()) !== 1) throw new Error('Missing admin destination ' + to);
  }
  await page.screenshot({ path: resolve(output, 'desktop-admin.png') });
  console.log('Agent 02 shell: responsive Chromium smoke and screenshots passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
