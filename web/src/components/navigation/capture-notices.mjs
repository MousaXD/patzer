// Browser checks for the authenticated shell's release notice and changelog.
// Runs only the local web app with fixture responses; no production services.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4194';
const output = resolve(root, 'artifacts/agent-02');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let server;
let browser;
let theme = 'light';
let changelogMode = 'ready';
let role = 'user';
let latestVersion = '7.20.0';
const profile = {
  user_id: 1, display_name: 'Sample Player', avatar_emoji: '', language: 'en',
  audience: 'intermediate', chesscom_username: null, lichess_username: null,
  coach_behavior: 'on_demand', tts_enabled: 0, tts_voice: null, tts_rate: 1,
  tts_pitch: 1, board_theme: 'green', piece_set: 'cburnett', site_theme: 'light',
  blunder_warning: 1, sound_enabled: 0, sound_set: 'soft', move_sound_set: 'board',
};

async function noOverflow(page, label) {
  const widths = await page.evaluate(() => ({
    html: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: innerWidth,
  }));
  if (widths.body > widths.viewport + 1 || widths.html > widths.viewport + 1) {
    throw new Error(label + ' horizontal overflow: ' + JSON.stringify(widths));
  }
}

async function visit(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-shell]').waitFor();
  await page.getByText(/Patzer 7.20.0 is out/).waitFor();
  await noOverflow(page, 'home + update notice');
}

async function openChangelog(page, mobile) {
  if (mobile) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Mobile navigation' });
    await drawer.getByRole('button', { name: /Patzer v7.19.0/ }).click();
  } else {
    await page.getByRole('button', { name: /Patzer version 7.19.0, view changelog/ }).click();
  }
  return page.getByRole('dialog', { name: /release notes/i });
}

async function assertInside(page, dialog, label) {
  if (!await dialog.evaluate((node) => node.contains(document.activeElement))) {
    throw new Error(label + ': dialog lacks keyboard focus');
  }
}

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4194', '--strictPort'], {
    cwd: resolve(root, 'web'), stdio: 'inherit', env: { ...process.env, CI: '1' },
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw new Error('Vite exited unexpectedly');
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await sleep(250);
  }
  if (!ready) throw new Error('Vite did not start');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(6000);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/meta/changelog') {
      if (changelogMode === 'pending') await sleep(500);
      if (changelogMode === 'error') {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Unavailable' });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/markdown', body: changelogMode === 'empty'
          ? '' : changelogMode === 'long'
            ? '# Patzer 7.20.0\n\n' + Array.from({ length: 80 }, (_, i) => '- Improvement ' + (i + 1)).join('\n')
            : '# Patzer 7.20.0\n\n- Improved learning paths\n- Smoother review navigation' });
      }
      return;
    }
    const payload = path === '/api/setup/status' ? { setup_required: false }
      : path === '/api/auth/me' ? { user: { id: 1, username: 'sample-player', role,
        created_at: '2026-01-01', profile: { ...profile, site_theme: theme } } }
      : path === '/api/meta' ? { version: '7.19.0' }
      : path === '/api/meta/update' ? { enabled: true, updateAvailable: true, current: '7.19.0',
        latest: latestVersion, url: 'https://example.com/patzer/releases/7.20.0', checkedAt: null }
      : path === '/api/games' ? { games: [] }
      : path === '/api/stats/me' ? { total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null }
      : path === '/api/plan' ? { goals: [] }
      : path === '/api/achievements' ? { achievements: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });

  for (const color of ['light', 'dark']) {
    theme = color;
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      changelogMode = 'ready';
      await visit(page, viewport.width, viewport.height);
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
      const technicalHelp = await page.getByText(/Pull the new image/).count();
      if (technicalHelp) throw new Error('Regular players should not receive administrator deployment steps');
      if (viewport.width <= 390) {
        const targetSize = await page.getByRole('button', { name: 'Dismiss until the next release' }).boundingBox();
        if (!targetSize || targetSize.width < 44 || targetSize.height < 44) {
          throw new Error('Mobile release-dismiss target is smaller than 44px');
        }
      }
      await page.screenshot({ path: resolve(output, `release-notice-${color}-${viewport.width}.png`) });
      const dialog = await openChangelog(page, viewport.width < 768);
      await dialog.waitFor();
      await dialog.getByText('Improved learning paths').waitFor();
      await assertInside(page, dialog, color + ' changelog');
      await noOverflow(page, color + ' changelog ' + viewport.width);
      await page.screenshot({ path: resolve(output, `changelog-${color}-${viewport.width}.png`) });
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        await assertInside(page, dialog, 'Changelog Tab ' + i);
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      if (viewport.width >= 768) {
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        if (!focused?.includes('Patzer version 7.19.0')) {
          throw new Error('Desktop changelog did not restore focus to its version trigger');
        }
      } else {
        const mobileFocus = await page.getByRole('button', { name: 'Open menu' }).evaluate((el) => document.activeElement === el);
        if (!mobileFocus) throw new Error('Mobile changelog did not return focus to menu trigger');
      }
    }
  }
  theme = 'light';
  await visit(page, 1440, 900);
  for (const mode of ['error', 'empty']) {
    changelogMode = mode;
    const dialog = await openChangelog(page, false);
    await dialog.waitFor();
    if (mode === 'error') {
      await dialog.getByRole('alert').waitFor();
    } else {
      await dialog.locator('[data-changelog-empty]').waitFor();
    }
    if (mode === 'error') {
      changelogMode = 'ready';
      await dialog.getByRole('button', { name: /try again/i }).click();
      await dialog.getByText('Improved learning paths').waitFor();
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  }
  changelogMode = 'long';
  await visit(page, 320, 700);
  const longDialog = await openChangelog(page, true);
  await longDialog.getByText('Improvement 80').waitFor();
  const scrollable = await longDialog.locator('.overflow-y-auto').evaluate((node) => node.scrollHeight > node.clientHeight);
  if (!scrollable) throw new Error('Long release notes cannot be scrolled on narrow mobile');
  await page.keyboard.press('Escape');
  await longDialog.waitFor({ state: 'detached' });

  role = 'admin';
  await visit(page, 1440, 900);
  await page.getByText(/Pull the new image/).waitFor();
  role = 'user';
  await visit(page, 1440, 900);
  await page.getByRole('button', { name: 'Dismiss until the next release' }).click();
  await page.getByText(/Patzer 7.20.0 is out/).waitFor({ state: 'detached' });
  await page.reload();
  if (await page.getByText(/Patzer 7.20.0 is out/).count()) {
    throw new Error('Dismissed release notice reappeared after reload');
  }
  latestVersion = '7.21.0';
  await page.reload();
  await page.getByText(/Patzer 7.21.0 is out/).waitFor();
  console.log('Agent B release notices and changelog: real Chromium checks passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
