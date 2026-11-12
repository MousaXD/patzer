// Browser certification for shared command palette and keyboard shortcuts.
// Runs only the local frontend with fixture auth; does not touch game data.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const origin = 'http://127.0.0.1:4192';
const output = resolve(root, 'artifacts/agent-02');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let browser;
let theme = 'light';
let profilePatchMode = 'success';
let patchAttempts = 0;

const profile = {
  user_id: 1, display_name: 'Sample Player', avatar_emoji: '',
  language: 'en', audience: 'intermediate', chesscom_username: null, lichess_username: null,
  coach_behavior: 'on_demand', tts_enabled: 0, tts_voice: null, tts_rate: 1,
  tts_pitch: 1, board_theme: 'green', piece_set: 'cburnett', site_theme: 'light',
  blunder_warning: 1, sound_enabled: 0, sound_set: 'soft', move_sound_set: 'board',
  kid_piece_emotions: 0,
};

async function visit(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-shell]').waitFor();
  await page.getByRole('button', { name: /Command palette/ }).waitFor();
}

async function assertInside(page, dialog, label) {
  const ok = await dialog.evaluate((el) => el.contains(document.activeElement));
  if (!ok) throw new Error(label + ': keyboard focus escaped the dialog');
}

async function assertContrast(page, dialog, label) {
  const ratio = await dialog.evaluate((panel) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
      if (!channels || channels.length !== 3) return NaN;
      const v = channels.map((x) => {
        const s = x / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
    };
    const samples = [...panel.querySelectorAll('.text-ui-mutedText')];
    return Math.min(...samples.map((element) => {
      let surface = element.parentElement;
      while (surface && getComputedStyle(surface).backgroundColor === 'rgba(0, 0, 0, 0)') {
        surface = surface.parentElement;
      }
      const a = luminance(getComputedStyle(element).color);
      const b = luminance(getComputedStyle(surface ?? panel).backgroundColor);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    }));
  });
  if (!Number.isFinite(ratio) || ratio < 4.5) {
    throw new Error(label + ': unreadable dialog secondary text (' + ratio + ':1)');
  }
}

async function assertNoOverflow(page, label) {
  const width = await page.evaluate(() => ({
    viewport: innerWidth, body: document.body.scrollWidth, html: document.documentElement.scrollWidth,
  }));
  if (width.body > width.viewport + 1 || width.html > width.viewport + 1) {
    throw new Error(label + ': horizontal overflow ' + JSON.stringify(width));
  }
}

try {
  await mkdir(output, { recursive: true });
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', '4192', '--strictPort'], {
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
  page.setDefaultTimeout(5000);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings/profile' && route.request().method() === 'PATCH') {
      patchAttempts += 1;
      if (profilePatchMode === 'error') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily unavailable"}' });
        return;
      }
      if (profilePatchMode === 'slow') await sleep(600);
      const update = route.request().postDataJSON();
      theme = update.site_theme;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(update) });
      return;
    }
    const result = path === '/api/setup/status' ? { setup_required: false }
      : path === '/api/auth/me' ? { user: { id: 1, username: 'sample-player', role: 'user', created_at: '2026-01-01',
        profile: { ...profile, site_theme: theme } } }
      : path === '/api/games' ? { games: [] }
      : path === '/api/stats/me' ? { total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null }
      : path === '/api/meta' ? { version: '7.19.0' }
      : path === '/api/meta/update' ? { enabled: false, updateAvailable: false, current: '7.19.0', latest: null }
      : path === '/api/plan' ? { goals: [] }
      : path === '/api/achievements' ? { achievements: [] } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });

  for (const color of ['light', 'dark']) {
    theme = color;
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      await visit(page, size.width, size.height);
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
      const opener = page.getByRole('button', { name: /Command palette/ });
      await opener.click();
      const palette = page.getByRole('dialog', { name: 'Search' });
      await palette.waitFor();
      await page.getByRole('combobox', { name: 'Search' }).waitFor();
      await assertInside(page, palette, 'initial palette focus');
      await assertNoOverflow(page, 'palette ' + color + ' ' + size.width);
      await assertContrast(page, palette, 'palette ' + color + ' ' + size.width);
      const standardRect = await palette.boundingBox();
      if (!standardRect || standardRect.y < -1 || standardRect.y + standardRect.height > size.height - 2) {
        throw new Error(`Standard palette extends outside ${color} ${size.width}x${size.height}: ${JSON.stringify(standardRect)}`);
      }
      await page.screenshot({ path: resolve(output, 'palette-' + color + '-' + size.width + '.png') });
      if (size.width <= 390) {
        const closeButton = palette.getByRole('button', { name: 'Close' });
        await closeButton.waitFor();
        const rect = await closeButton.boundingBox();
        if (!rect || rect.width < 44 || rect.height < 44) {
          throw new Error(`Palette mobile close target too small: ${JSON.stringify(rect)}`);
        }
        await closeButton.click();
        await palette.waitFor({ state: 'detached' });
        if (!(await opener.evaluate((el) => el === document.activeElement))) {
          throw new Error('Mobile palette close did not restore focus to opener');
        }
        await opener.click();
        await palette.waitFor();
      }
      for (let i = 0; i < 32; i++) {
        await page.keyboard.press('Tab');
        await assertInside(page, palette, 'palette Tab ' + i);
      }
      await page.keyboard.press('Escape');
      await palette.waitFor({ state: 'detached' });
      if (!(await opener.evaluate(el => el === document.activeElement))) {
        throw new Error('Palette failed to restore focus to the opener');
      }
      await opener.click();
      await palette.waitFor();
      const input = page.getByRole('combobox', { name: 'Search' });
      await input.fill('zzzz-unknown-action');
      if ((await palette.getByText('No matches.').count()) !== 1) throw new Error('Palette empty search not explained');
      if (await input.getAttribute('aria-activedescendant')) throw new Error('Empty search points to an old option');
      await input.fill('');
      await page.keyboard.press('ArrowDown');
      if ((await palette.locator('[role="option"][aria-selected="true"]').count()) !== 1) {
        throw new Error('Arrow navigation failed to expose the active option');
      }
      await input.press('Escape');
      await palette.waitFor({ state: 'detached' });
      await opener.click();
      await palette.waitFor();
      await page.getByRole('combobox', { name: 'Search' }).fill('train');
      await page.keyboard.press('Enter');
      await page.waitForURL((url) => url.pathname === '/train');
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      await page.waitForFunction(() => document.activeElement?.id === 'patzer-main');
    }
  }

  theme = 'light';
  await visit(page, 1440, 900);
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  const shortcutsOpener = page.getByRole('button', { name: 'Keyboard shortcuts' });
  await shortcutsOpener.click();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await shortcuts.waitFor();
  await assertInside(page, shortcuts, 'initial shortcuts focus');
  await assertContrast(page, shortcuts, 'shortcuts dialog');
  await assertNoOverflow(page, 'shortcuts dialog');
  await page.screenshot({ path: resolve(output, 'shortcuts-light-1440.png') });
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    await assertInside(page, shortcuts, 'shortcuts Tab ' + i);
  }
  await page.keyboard.press('Escape');
  await shortcuts.waitFor({ state: 'detached' });
  if (!(await shortcutsOpener.evaluate(el => el === document.activeElement))) {
    throw new Error('Shortcuts failed to restore focus to the opener');
  }
  await shortcutsOpener.click();
  await shortcuts.waitFor();
  // Ctrl+K must switch global overlays, not stack two aria-modal dialogs.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search' }).waitFor();
  if ((await page.getByRole('dialog').count()) !== 1) {
    throw new Error('Global hotkey stacked two blocking modal dialogs');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  for (const color of ['light', 'dark']) {
    theme = color;
    await visit(page, 320, 700);
    await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Mobile navigation' });
    await drawer.getByRole('button', { name: 'Keyboard shortcuts' }).click();
    const mobileShortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await mobileShortcuts.waitFor();
    const close = mobileShortcuts.getByRole('button', { name: 'Close' });
    const closeRect = await close.boundingBox();
    if (!closeRect || closeRect.width < 44 || closeRect.height < 44) {
      throw new Error(`Mobile shortcuts close target too small: ${JSON.stringify(closeRect)}`);
    }
    await assertInside(page, mobileShortcuts, 'mobile shortcuts initial focus');
    await assertContrast(page, mobileShortcuts, 'mobile shortcuts ' + color);
    await assertNoOverflow(page, 'mobile shortcuts ' + color);
    await page.screenshot({ path: resolve(output, 'shortcuts-' + color + '-320.png') });
    await close.click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const menuOpener = page.getByRole('button', { name: 'Open menu' });
    if (!(await menuOpener.evaluate((element) => element === document.activeElement))) {
      const focus = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label'),
      }));
      throw new Error('Mobile shortcuts close left keyboard focus outside the shell controls: ' + JSON.stringify(focus));
    }
  }
  // Landscape phones have enough width for the palette but very little height.
  // Dialog controls and the footer must remain inside the visual viewport.
  for (const color of ['light', 'dark']) {
    theme = color;
    for (const size of [{ width: 844, height: 390 }, { width: 568, height: 320 }]) {
      await visit(page, size.width, size.height);
      await page.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, color === 'dark');
      await page.getByRole('button', { name: /Command palette/ }).click();
      const palette = page.getByRole('dialog', { name: 'Search' });
      await palette.waitFor();
      const rect = await palette.boundingBox();
      if (!rect || rect.y < -1 || rect.y + rect.height > size.height - 2) {
        throw new Error(`Landscape palette clips outside viewport ${color} ${size.width}x${size.height}: ${JSON.stringify(rect)}`);
      }
      await assertNoOverflow(page, `landscape palette ${color} ${size.width}`);
      await page.screenshot({ path: resolve(output, `palette-landscape-${color}-${size.width}.png`) });
      await page.getByRole('button', { name: 'Close' }).click();
      await palette.waitFor({ state: 'detached' });

      if (size.width >= 640) {
        await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
      } else {
        await page.getByRole('button', { name: 'Open menu' }).click();
        await page.getByRole('dialog', { name: 'Mobile navigation' })
          .getByRole('button', { name: 'Keyboard shortcuts' }).click();
      }
      const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await shortcuts.waitFor();
      const shortcutRect = await shortcuts.boundingBox();
      if (!shortcutRect || shortcutRect.y < -1 || shortcutRect.y + shortcutRect.height > size.height - 2) {
        throw new Error(`Landscape shortcuts clip outside viewport ${color} ${size.width}x${size.height}: ${JSON.stringify(shortcutRect)}`);
      }
      await page.screenshot({ path: resolve(output, `shortcuts-landscape-${color}-${size.width}.png`) });
      await shortcuts.getByRole('button', { name: 'Close' }).click();
      await shortcuts.waitFor({ state: 'detached' });
    }
  }

  // Global theme actions perform server writes. An unavailable settings
  // endpoint must provide a visible retry state rather than an unhandled
  // rejection while the dialog silently remains open.
  theme = 'light';
  profilePatchMode = 'error';
  patchAttempts = 0;
  await visit(page, 390, 844);
  await page.getByRole('button', { name: /Command palette/ }).click();
  const themePalette = page.getByRole('dialog', { name: 'Search' });
  const themeQuery = themePalette.getByRole('combobox', { name: 'Search' });
  await themeQuery.fill('Dark theme');
  await themeQuery.press('Enter');
  await themePalette.getByRole('alert').waitFor();
  await assertNoOverflow(page, 'failed theme action at 390px');
  await page.screenshot({ path: resolve(output, 'palette-theme-action-error-390.png') });
  if (patchAttempts !== 1) throw new Error('Theme action did not submit exactly one server request');
  await themeQuery.fill('Dark theme');
  profilePatchMode = 'slow';
  await themeQuery.press('Enter');
  await themePalette.getByRole('status').waitFor();
  if (!(await themePalette.getByRole('option', { name: 'Dark theme' }).isDisabled())) {
    throw new Error('Busy palette did not disable duplicate action submission');
  }
  await themeQuery.press('Enter');
  await themePalette.waitFor({ state: 'detached' });
  if (patchAttempts !== 2) throw new Error('Duplicate submissions occurred while a theme update was in progress');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));

  // Users may know a language by its English name or type it without an
  // accent; native-language-only commands must still be discoverable.
  await visit(page, 320, 700);
  await page.getByRole('button', { name: /Command palette/ }).click();
  const languagePalette = page.getByRole('dialog', { name: 'Search' });
  const languageInput = languagePalette.getByRole('combobox', { name: 'Search' });
  for (const [search, native] of [
    ['German', 'Deutsch'],
    ['Russian', 'Русский'],
    ['Spanish', 'Español'],
    ['espanol', 'Español'],
    ['Bulgarian', 'Български'],
  ]) {
    await languageInput.fill(search);
    await languagePalette.getByRole('option', { name: new RegExp(native) }).waitFor();
  }
  await languageInput.fill('German');
  await languagePalette.getByRole('option', { name: /Deutsch/ }).click();
  await languagePalette.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /Befehlspalette/ }).waitFor();

  console.log('Agent B: global dialog browser focus, keyboard and responsive checks passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
