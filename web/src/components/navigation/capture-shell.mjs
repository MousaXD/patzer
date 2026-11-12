// Real Chromium smoke and reproducible screenshots of the authenticated shell.
// API responses are mocked for visual fixtures, not for backend certification.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = resolve(root, 'artifacts/agent-02');
const origin = 'http://127.0.0.1:4186';
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

// Verify the real, computed colors of secondary text on activity cards.
// `text-chesscom-500` used to be near-invisible on dark surfaces (about 2:1),
// despite screenshots and unit tests otherwise looking healthy.
async function checkHomeCardContrast(page, label) {
  const result = await page.evaluate(() => {
    function luminance(color) {
      const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
      if (channels.length !== 3) return NaN;
      const linear = channels.map((channel) => {
        const unit = channel / 255;
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }
    const candidates = [...document.querySelectorAll('a.card-hover .text-ui-mutedText')];
    const contrasts = candidates.map((element) => {
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(element.closest('a.card-hover')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    return { count: candidates.length, minimum: Math.min(...contrasts) };
  });
  if (result.count < 4 || result.minimum < 4.5) {
    const state = await page.evaluate(() => ({
      body: document.querySelector('main')?.innerText.slice(0, 800),
      cards: document.querySelectorAll('a.card-hover').length,
      muted: document.querySelectorAll('.text-ui-mutedText').length,
    }));
    throw new Error(`${label}: insufficient activity text contrast ${JSON.stringify({ ...result, ...state })}`);
  }
}

async function openWithFixture(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-shell]').waitFor({ timeout: 20000 });
  await page.locator('[data-navigation-rail]').waitFor({ state: 'attached' });
  // Allow the home cards' Framer Motion entrance transitions and local fonts
  // to settle before judging contrast, layout or capturing screenshots.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1100);
  await checkNoHorizontalOverflow(page, viewport.width + 'x' + viewport.height);
  await checkHomeCardContrast(page, `${theme} ${viewport.width}x${viewport.height}`);
  const onboarding = page.locator('[data-home-onboarding]');
  if ((await onboarding.locator('a[href="/play"]').count()) !== 1 ||
      (await onboarding.locator('a[href="/review"]').count()) !== 1) {
    throw new Error('First-run dashboard lost its Play / Game Review entry points');
  }
  if (viewport.width <= 390) {
    const onboardingY = await onboarding.evaluate((element) => element.getBoundingClientRect().top);
    const activityY = await page.getByRole('heading', { name: 'Continue improving' }).evaluate((element) => element.getBoundingClientRect().top);
    if (onboardingY >= activityY) {
      throw new Error(`${viewport.width}px: onboarding is hidden below continuation tiles`);
    }
  }
}

try {
  await mkdir(output, { recursive: true });
  // Launch Vite directly instead of through npm's shell wrapper, which can
  // leave an orphaned dev server after the capture process exits.
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4186', '--strictPort'], {
    cwd: resolve(root, 'web'), stdio: 'inherit', env: { ...process.env, CI: '1' },
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
    const missingFixture = url.pathname === '/api/players/42' || url.pathname === '/api/games/42';
    await route.fulfill({
      status: missingFixture ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(missingFixture ? { error: 'Not found' } : fixtures(url.pathname)),
    });
  });

  await openWithFixture(page, { width: 1440, height: 900 });
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  for (const to of paths) {
    if ((await rail.locator('a[href="' + to + '"]').count()) !== 1) throw new Error('Missing rail destination ' + to);
  }
  await page.screenshot({ path: resolve(output, 'desktop-light.png') });
  await openWithFixture(page, { width: 1024, height: 768 });
  await page.screenshot({ path: resolve(output, 'laptop-light.png') });

  // Full responsive matrix, including the narrowest supported viewport.
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ];
  for (const nextTheme of ['light', 'dark']) {
    theme = nextTheme;
    for (const viewport of viewports) {
      await openWithFixture(page, viewport);
      await page.waitForFunction((mode) => document.documentElement.classList.contains('dark') === (mode === 'dark'), nextTheme);
      await page.screenshot({ path: resolve(output, `${nextTheme}-${viewport.width}x${viewport.height}.png`) });
      if (viewport.width <= 390) {
        const open = page.getByRole('button', { name: 'Open menu' });
        await open.click();
        const mobileDrawer = page.getByRole('dialog', { name: 'Mobile navigation' });
        await mobileDrawer.waitFor();
        for (const to of paths) {
          if ((await mobileDrawer.locator('a[href="' + to + '"]').count()) !== 1) {
            throw new Error(`${nextTheme} ${viewport.width}: missing mobile route ${to}`);
          }
        }
        await page.keyboard.press('Escape');
        await mobileDrawer.waitFor({ state: 'detached' });
        await checkNoHorizontalOverflow(page, `${nextTheme} ${viewport.width} after drawer`);
      }
    }
  }

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

  // A keyboard-only user needs a visible path past the persistent shell.
  role = 'user';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-app-shell]').waitFor();
  await page.keyboard.press('Tab');
  const focusedHref = await page.evaluate(() => document.activeElement?.getAttribute('href'));
  if (focusedHref !== '#patzer-main') throw new Error(`Skip link was not first in tab order: ${focusedHref}`);

  // Nested section headers must remain usable at 320px with longer translated
  // labels. 404 fixture responses are intentional: no game or user data is
  // needed to certify the independent global navigation shell.
  theme = 'light';
  profile.language = 'de';
  await page.setViewportSize({ width: 320, height: 700 });
  for (const nested of [
    { path: '/players/42', parent: '/players', current: 'Spielerprofil' },
    { path: '/review/42', parent: '/review', current: 'Partiedetails' },
  ]) {
    await page.goto(origin + nested.path, { waitUntil: 'domcontentloaded' });
    const breadcrumb = page.getByRole('navigation', { name: 'Navigationspfad' });
    await breadcrumb.waitFor();
    if ((await breadcrumb.locator(`a[href="${nested.parent}"]`).count()) !== 1) {
      throw new Error(`Missing nested parent link for ${nested.path}`);
    }
    if ((await breadcrumb.locator('[aria-current="page"]').textContent()) !== nested.current) {
      throw new Error(`Wrong translated breadcrumb for ${nested.path}`);
    }
    const currentWidth = await breadcrumb.locator('[aria-current="page"]').evaluate((element) => ({
      visible: element.clientWidth,
      content: element.scrollWidth,
    }));
    if (currentWidth.content > currentWidth.visible + 1) {
      throw new Error(`320px breadcrumb title was clipped: ${nested.path} ${JSON.stringify(currentWidth)}`);
    }
    const parent = breadcrumb.locator(`a[href="${nested.parent}"]`);
    if ((await parent.locator('svg').count()) !== 1) {
      throw new Error(`320px breadcrumb missing mobile back affordance: ${nested.path}`);
    }
    await checkNoHorizontalOverflow(page, `German breadcrumb ${nested.path}`);
    await page.screenshot({ path: resolve(output, `breadcrumb-${nested.path.split('/')[1]}-320-de.png`) });
    await parent.click();
    await page.waitForURL((url) => url.pathname === nested.parent);
  }
  profile.language = 'en';

  // A route selected from the mobile drawer must announce the new workspace
  // to a keyboard user, rather than leaving focus on the menu toggle. The
  // page should also start at the top instead of inheriting the old scroll.
  await openWithFixture(page, { width: 320, height: 700 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const previousScroll = await page.evaluate(() => window.scrollY);
  if (previousScroll < 100) throw new Error('Home fixture not tall enough for route scroll test');
  await page.getByRole('button', { name: 'Open menu' }).click();
  const transitionDrawer = page.getByRole('dialog', { name: 'Mobile navigation' });
  await transitionDrawer.locator('a[href="/review"]').click();
  await page.waitForURL((url) => url.pathname === '/review');
  await transitionDrawer.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.id === 'patzer-main');
  const mobileTransition = await page.evaluate(() => ({
    focus: document.activeElement?.getAttribute('id') || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
    scroll: window.scrollY,
  }));
  if (mobileTransition.focus !== 'patzer-main' || mobileTransition.scroll > 2) {
    throw new Error('Mobile navigation did not focus and reset new workspace: ' + JSON.stringify(mobileTransition));
  }

  // With a keyboard-driven rail link, the destination (not the old link)
  // must become the primary focus context without a full browser refresh.
  await openWithFixture(page, { width: 1440, height: 900 });
  const reviewRailLink = page.getByRole('navigation', { name: 'Primary navigation' })
    .locator('a[href="/review"]');
  await reviewRailLink.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname === '/review');
  await page.waitForFunction(() => document.activeElement?.id === 'patzer-main');
  const desktopFocus = await page.evaluate(() => document.activeElement?.getAttribute('id'));
  if (desktopFocus !== 'patzer-main') {
    throw new Error('Desktop navigation left keyboard focus on stale link: ' + desktopFocus);
  }
  await page.screenshot({ path: resolve(output, 'desktop-navigation-focus.png') });
  console.log('Agent 02 shell: responsive Chromium smoke and screenshots passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
