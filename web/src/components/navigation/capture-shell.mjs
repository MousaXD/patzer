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
let logoutMode = 'success';
let signedIn = true;
let homeGamesMode = 'empty';
let homeFailureMode = false;
let fixtureUsername = 'sample-player';
let fixtureGameResult = 'win';
let fixtureUserColor = 'white';
let fixtureAnalyzed = false;

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
    user: signedIn ? { id: 1, username: fixtureUsername, role, created_at: '2026-01-01', profile: { ...profile, site_theme: theme } } : null,
  };
  if (pathname === '/api/meta') return { version: '7.19.0' };
  if (pathname === '/api/meta/update') return { enabled: false, updateAvailable: false, current: '7.19.0', latest: null };
  if (pathname === '/api/games') return { games: homeGamesMode === 'recent' ? [{
    id: 103, white: fixtureUserColor === 'white' ? fixtureUsername : 'OpponentWithALongName',
    black: fixtureUserColor === 'white' ? 'OpponentWithALongName' : fixtureUsername,
    user_color: fixtureUserColor, end_time: '2026-11-12T12:00:00.000Z',
    result: fixtureGameResult, time_control: '600', opening_name: 'Italian Game',
    analyzed: fixtureAnalyzed, accuracy_white: 99.9, accuracy_black: 100,
  }] : [] };
  if (pathname === '/api/stats/me') return homeGamesMode === 'recent'
    ? { total: 1, wins: 1, losses: 0, draws: 0, avg_accuracy: null, streak: null }
    : { total: 0, wins: 0, losses: 0, draws: 0, avg_accuracy: null, streak: null };
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

// A tiny W/L/D glyph must contrast against its own tinted badge surface,
// not against the surrounding card. The Win/Loss backgrounds are alpha blends.
async function checkRecentResultContrast(page, label) {
  const measured = await page.locator('main a[href="/review/103"] [role="img"]').evaluate((badge) => {
    const channels = (color) => color.match(/[\d.]+/g).map(Number);
    const foreground = channels(getComputedStyle(badge).color);
    const base = channels(getComputedStyle(badge.closest('ul')).backgroundColor);
    const backdrop = channels(getComputedStyle(badge).backgroundColor);
    const alpha = backdrop[3] ?? 1;
    const composite = backdrop.slice(0, 3).map((value, i) => value * alpha + base[i] * (1 - alpha));
    const luminance = (rgb) => rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const text = luminance(foreground);
    const background = luminance(composite);
    return {
      name: badge.getAttribute('aria-label'),
      ratio: (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05),
    };
  });
  if (measured.ratio < 4.5) {
    throw new Error(`Recent games ${label}: ${measured.name} result glyph contrast ${measured.ratio.toFixed(2)}:1 is below 4.5:1`);
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
  const heroHeading = page.getByRole('heading', { level: 1, name: 'Sample Player' });
  const heroAvatar = await heroHeading.evaluate((heading) =>
    heading.closest('section')?.querySelector('[data-home-hero-avatar]')?.textContent?.trim() ?? '');
  const hero = page.locator('main section').first();
  const actionSizes = [];
  for (const [name, path] of [['Play', '/play'], ['Game Review', '/review']]) {
    const link = hero.locator(`a[href="${path}"]`);
    const bounds = await link.boundingBox();
    actionSizes.push({ name, width: bounds?.width ?? 0, height: bounds?.height ?? 0 });
  }
  const undersized = actionSizes.filter((action) => action.height < 44 || action.width < 44);
  if (!heroAvatar || undersized.length) {
    throw new Error(`${theme} ${viewport.width}px homepage hero lacks identity/touch targets: ${JSON.stringify({ heroAvatar, undersized })}`);
  }
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
    if (homeFailureMode && [
      '/api/stats/me', '/api/games', '/api/plan', '/api/achievements',
    ].includes(url.pathname)) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily unavailable"}' });
      return;
    }
    if (url.pathname === '/api/auth/logout' && route.request().method() === 'POST') {
      if (logoutMode === 'error') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"temporarily unavailable"}' });
      } else if (logoutMode === 'unconfirmed') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false}' });
      } else {
        signedIn = false;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return;
    }
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
    { width: 768, height: 1024 },
    { width: 640, height: 900 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
  ];
  for (const nextTheme of ['light', 'dark']) {
    theme = nextTheme;
    for (const viewport of viewports) {
      await openWithFixture(page, viewport);
      await page.waitForFunction((mode) => document.documentElement.classList.contains('dark') === (mode === 'dark'), nextTheme);
      await page.screenshot({ path: resolve(output, `${nextTheme}-${viewport.width}x${viewport.height}.png`) });
      if (viewport.width >= 640 && viewport.width <= 1024) {
        const tabletControls = [
          ['Search', page.getByRole('button', { name: /Command palette/ })],
          ['Keyboard shortcuts', page.getByRole('button', { name: 'Keyboard shortcuts' })],
          ['Profile', page.locator('[data-workspace-header] a[href="/settings"]')],
        ];
        if (viewport.width >= 768) {
          tabletControls.push(
            ['Language', page.getByRole('combobox', { name: 'Language' })],
            ['Log out', page.getByRole('button', { name: 'Log out' })],
            ['Version & changelog', page.locator('[data-navigation-rail] button[aria-label^="Patzer version"]')],
          );
        }
        for (const [name, control] of tabletControls) {
          const rect = await control.boundingBox();
          if (!rect || rect.height < 44 || rect.width < 44) {
            throw new Error(`${nextTheme} ${viewport.width}px: tablet header touch target ${name} is undersized ${JSON.stringify(rect)}`);
          }
        }
      }
      if (viewport.width <= 390) {
        const open = page.getByRole('button', { name: 'Open menu' });
        const touchControls = [
          ['Open menu', open],
          ['Search', page.getByRole('button', { name: /Command palette/ })],
          ['Patzer logo', page.locator('[data-workspace-header] a[href="/"]')],
        ];
        for (const [name, control] of touchControls) {
          const rect = await control.boundingBox();
          if (!rect || rect.height < 44 || rect.width < 44) {
            throw new Error(`${nextTheme} ${viewport.width}: undersized mobile header touch target ${name} ${JSON.stringify(rect)}`);
          }
        }
        await open.click();
        const mobileDrawer = page.getByRole('dialog', { name: 'Mobile navigation' });
        await mobileDrawer.waitFor();
        const closeRect = await mobileDrawer.getByRole('button', { name: 'Close menu' }).boundingBox();
        if (!closeRect || closeRect.width < 44 || closeRect.height < 44) {
          throw new Error(`${nextTheme} ${viewport.width}: undersized mobile drawer close target ${JSON.stringify(closeRect)}`);
        }
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

  // Some provider-created profiles legitimately have no display name or
  // avatar emoji. The homepage must still introduce the signed-in player.
  profile.display_name = '   ';
  profile.avatar_emoji = '   ';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'sample-player' }).waitFor();
  const defaultAvatar = await page.getByRole('heading', { level: 1, name: 'sample-player' })
    .evaluate((heading) => heading.closest('section')?.querySelector('[data-home-hero-avatar]')?.textContent?.trim() ?? '');
  if (!defaultAvatar) throw new Error('Homepage hero has no fallback avatar for an empty profile');
  await page.screenshot({ path: resolve(output, 'home-missing-profile-390.png') });
  profile.display_name = 'Sample Player';
  profile.avatar_emoji = '';

  // Long first-use names were visually reduced to "Gran..." at 320px and
  // to just a few letters with enlarged type: the name shared the avatar's
  // narrow row and used a single-line ellipsis. Keep two readable lines
  // across the full hero width without displacing the primary actions.
  const longDisplayName = 'GrandmasterCandidateAccountWithAnExtraordinarilyLongDisplayName2026';
  profile.display_name = longDisplayName;
  for (const longNameTheme of ['light', 'dark']) {
    theme = longNameTheme;
    for (const viewport of [
      { width: 320, height: 700 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
    ]) {
      for (const rootFont of [16, 24]) {
        await page.setViewportSize(viewport);
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const heading = page.getByRole('heading', { level: 1, name: longDisplayName });
        await heading.waitFor();
        await page.waitForFunction((dark) =>
          document.documentElement.classList.contains('dark') === dark, longNameTheme === 'dark');
        await page.addStyleTag({ content: `html { font-size: ${rootFont}px !important; }` });
        await page.evaluate(() => document.fonts.ready);
        const state = await heading.evaluate((element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          const hero = element.closest('section');
          const heroBounds = hero.getBoundingClientRect();
          const actions = [...hero.querySelectorAll('a[href="/play"], a[href="/review"]')].map((link) => {
            const box = link.getBoundingClientRect();
            return { width: box.width, height: box.height,
              withinHero: box.left >= heroBounds.left - 1 && box.right <= heroBounds.right + 1,
              aboveFold: box.bottom <= window.innerHeight + 1 };
          });
          return {
            title: element.getAttribute('title'), clamp: style.webkitLineClamp,
            lines: bounds.height / parseFloat(style.lineHeight),
            width: bounds.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            actions,
          };
        });
        if (state.title !== longDisplayName || state.clamp !== '2' || state.lines > 2.05 ||
            state.scrollWidth > state.clientWidth + 1 ||
            (viewport.width <= 390 && state.width < 200) ||
            state.actions.length !== 2 ||
            state.actions.some((action) => action.width < 44 || action.height < 44 ||
              !action.withinHero || !action.aboveFold)) {
          throw new Error(`Long Home identity ${longNameTheme}/${viewport.width}px/root${rootFont}: ${JSON.stringify(state)}`);
        }
        await checkNoHorizontalOverflow(page, `long Home identity ${longNameTheme}/${viewport.width}px/root${rootFont}`);
        await page.screenshot({ path: resolve(output, `home-long-identity-${longNameTheme}-${viewport.width}-font${rootFont}.png`) });
      }
    }
  }
  profile.display_name = 'Sample Player';
  theme = 'light';

  // A returning player should be able to touch View all in the recent-games
  // header, or jump into a game row, on the narrowest supported phone.
  homeGamesMode = 'recent';
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const viewAllGames = page.getByRole('link', { name: /View all/ });
  await viewAllGames.waitFor();
  const recentTargets = [];
  for (const [label, locator] of [
    ['View all', viewAllGames],
    ['Recent game', page.locator('main a[href="/review/103"]')],
  ]) {
    const rect = await locator.boundingBox();
    recentTargets.push({ label, width: rect?.width ?? 0, height: rect?.height ?? 0 });
  }
  const tooSmall = recentTargets.filter(({ width, height }) => width < 44 || height < 44);
  if (tooSmall.length) {
    throw new Error('Recent games mobile touch targets are undersized: ' + JSON.stringify(tooSmall));
  }
  const outcomeBadge = page.locator('main a[href="/review/103"]').getByRole('img', { name: 'Win' });
  if (!(await outcomeBadge.count())) {
    throw new Error('Recent-game W result badge does not announce the Win outcome accessibly');
  }
  // Check the full returning-player layout across both themes, both player
  // colors, narrow phones, tablet and desktop. The mobile opponent must stay
  // beside the "vs" prefix rather than orphaning its first line.
  for (const recentTheme of ['light', 'dark']) {
    theme = recentTheme;
    for (const color of ['white', 'black']) {
      fixtureUserColor = color;
      for (const viewport of [
        { width: 320, height: 700 }, { width: 390, height: 844 },
        { width: 768, height: 1024 }, { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const row = page.locator('main a[href="/review/103"]');
        await row.waitFor();
        await page.waitForFunction((expected) =>
          document.documentElement.classList.contains('dark') === expected, recentTheme === 'dark');
        await page.evaluate(() => document.fonts.ready);
        if (viewport.width < 640) {
          const opponent = row.locator('[data-home-recent-opponent]');
          await opponent.waitFor({ state: 'visible' });
          const result = await opponent.evaluate((element) => {
            const label = element.previousElementSibling;
            const box = element.getBoundingClientRect();
            const labelBox = label?.getBoundingClientRect();
            const containerBox = element.parentElement?.getBoundingClientRect();
            return {
              name: element.textContent?.trim(),
              width: Math.min(box.width, containerBox?.width ?? box.width),
              height: box.height,
              labelY: labelBox?.y,
              opponentY: box.y,
              clamp: getComputedStyle(element).webkitLineClamp,
            };
          });
          if (result.name !== 'OpponentWithALongName' || result.width < 44 ||
              result.height > 42 || result.clamp !== '2' ||
              Math.abs((result.labelY ?? -100) - result.opponentY) > 4) {
            throw new Error(`Recent games ${recentTheme}/${color}/${viewport.width}px: opponent not legible beside vs: ${JSON.stringify(result)}`);
          }
        } else {
          const names = row.locator('[data-home-recent-desktop-matchup]');
          await names.waitFor({ state: 'visible' });
          const value = await names.innerText();
          if (!value.includes('sample-player') || !value.includes('OpponentWithALongName')) {
            throw new Error(`Recent games ${recentTheme}/${color}/${viewport.width}px: desktop matchup incomplete: ${value}`);
          }
          const statusContrast = await row.locator('.tracking-wider').evaluate((status) => {
            const components = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
            const luminance = (values) => values.map((value) => {
              const channel = value / 255;
              return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
            }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
            const foreground = luminance(components(getComputedStyle(status).color));
            const background = luminance(components(getComputedStyle(status.closest('ul')).backgroundColor));
            return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
          });
          if (statusContrast < 4.5) {
            throw new Error(`Recent games ${recentTheme}/${color}/${viewport.width}px: Unreviewed status below 4.5:1 contrast: ${statusContrast}`);
          }
        }
        await checkNoHorizontalOverflow(page, `recent games ${recentTheme}/${color}/${viewport.width}px`);
        await page.screenshot({ path: resolve(output, `home-recent-${recentTheme}-${color}-${viewport.width}.png`) });
      }
    }
  }
  // A very long signed-in player's name previously consumed the desktop
  // matchup line at 640px, completely hiding the opponent (0px visible).
  // Keep both sides on the line while protecting the opponent's space.
  fixtureUsername = 'AccountOwnerWithVeryLongNameIndeed1234567890';
  profile.language = 'de';
  for (const recentTheme of ['light', 'dark']) {
    theme = recentTheme;
    for (const color of ['white', 'black']) {
      fixtureUserColor = color;
      for (const width of [640, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const row = page.locator('main a[href="/review/103"]');
        const opponent = row.locator('[data-home-recent-desktop-opponent]');
        await opponent.waitFor({ state: 'visible' });
        await page.waitForFunction((dark) =>
          document.documentElement.classList.contains('dark') === dark, recentTheme === 'dark');
        await page.evaluate(() => document.fonts.ready);
        const visible = await opponent.evaluate((element) => {
          const opponentBox = element.getBoundingClientRect();
          const lineBox = element.closest('[data-home-recent-desktop-matchup]').getBoundingClientRect();
          return {
            opponent: element.textContent?.trim(),
            width: Math.max(0, Math.min(opponentBox.right, lineBox.right) -
              Math.max(opponentBox.left, lineBox.left)),
          };
        });
        if (visible.opponent !== 'OpponentWithALongName' || visible.width < 100) {
          throw new Error(`Recent games ${recentTheme}/${color}/${width}px: long owner crowds out the opponent: ${JSON.stringify(visible)}`);
        }
        await checkNoHorizontalOverflow(page, `long owner recent games ${recentTheme}/${color}/${width}px`);
        await page.screenshot({ path: resolve(output, `home-recent-long-owner-${recentTheme}-${color}-${width}.png`) });
      }
    }
  }
  fixtureUsername = 'sample-player';
  profile.language = 'en';
  // The rounded Recent Games list clips a regular outline drawn outside its
  // linked rows. Drive real Tab navigation and require an inset focus ring
  // visible inside the link, across desktop/mobile and both themes.
  for (const focusTheme of ['light', 'dark']) {
    theme = focusTheme;
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      const recentRow = page.locator('main a[href="/review/103"]');
      await recentRow.waitFor();
      await page.waitForFunction((dark) =>
        document.documentElement.classList.contains('dark') === dark, focusTheme === 'dark');
      let focused = false;
      for (let step = 0; step < 40; step++) {
        await page.keyboard.press('Tab');
        if (await recentRow.evaluate((row) => document.activeElement === row)) {
          focused = true;
          break;
        }
      }
      const evidence = await recentRow.evaluate((row) => ({
        focusVisible: row.matches(':focus-visible'),
        insetRing: getComputedStyle(row).boxShadow.includes('inset'),
        parentClips: getComputedStyle(row.closest('ul')).overflow === 'hidden',
      }));
      if (!focused || !evidence.focusVisible || !evidence.insetRing || !evidence.parentClips) {
        throw new Error(`Recent games ${focusTheme}/${width}px: focused row outline is clipped without inset indication: ${JSON.stringify({ focused, ...evidence })}`);
      }
      await page.screenshot({ path: resolve(output, `home-recent-focus-${focusTheme}-${width}.png`) });
    }
  }
  theme = 'light';
  fixtureUserColor = 'white';
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('main a[href="/review/103"] [data-home-recent-opponent]').waitFor();
  await checkNoHorizontalOverflow(page, 'recent games at 320px');
  await page.screenshot({ path: resolve(output, 'home-recent-games-mobile-320.png') });
  for (const { result, label } of [
    { result: 'loss', label: 'Loss' },
    { result: 'draw', label: 'Draw' },
    { result: 'ongoing', label: 'In progress' },
  ]) {
    fixtureGameResult = result;
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const row = page.locator('main a[href="/review/103"]');
    await row.getByRole('img', { name: label }).waitFor();
    if (!(await page.getByRole('link', { name: new RegExp(label, 'i') }).count())) {
      throw new Error(result + ' result missing from accessible game link name');
    }
  }
  // WCAG-sized contrast applies to the small W/L/D/bullet text on the tinted
  // badge itself. The former green/red text measured below 3.3:1, and dark
  // Draw/In progress measured 4.24:1. Exercise all outcomes in both themes.
  for (const outcomeTheme of ['light', 'dark']) {
    theme = outcomeTheme;
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
      for (const { result, label } of [
        { result: 'win', label: 'Win' },
        { result: 'loss', label: 'Loss' },
        { result: 'draw', label: 'Draw' },
        { result: 'ongoing', label: 'In progress' },
      ]) {
        fixtureGameResult = result;
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        await page.locator('main a[href="/review/103"]').getByRole('img', { name: label }).waitFor();
        await page.waitForFunction((dark) =>
          document.documentElement.classList.contains('dark') === dark, outcomeTheme === 'dark');
        await checkRecentResultContrast(page, `${outcomeTheme}/${width}px/${result}`);
        if (width === 320 && ['win', 'loss'].includes(result)) {
          await page.screenshot({ path: resolve(output, `home-result-${outcomeTheme}-${result}-320.png`) });
        }
      }
    }
  }
  theme = 'light';
  await page.setViewportSize({ width: 320, height: 700 });
  profile.language = 'es';
  fixtureGameResult = 'win';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('main a[href="/review/103"]').getByRole('img', { name: 'Victoria' }).waitFor();
  profile.language = 'en';
  fixtureGameResult = 'win';
  // Analyzed games previously put both accuracy values beside the opponent
  // on 320px phones, shrinking its name to 107px. Separate, labeled mobile
  // accuracies must leave a readable opponent and preserve both scores.
  fixtureAnalyzed = true;
  fixtureUsername = 'AccountOwnerWithVeryLongNameIndeed1234567890';
  for (const analyzedTheme of ['light', 'dark']) {
    theme = analyzedTheme;
    for (const color of ['white', 'black']) {
      fixtureUserColor = color;
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: width <= 390 ? 700 : 900 });
        await page.goto(origin, { waitUntil: 'domcontentloaded' });
        const row = page.locator('main a[href="/review/103"]');
        await row.waitFor();
        await page.waitForFunction((dark) =>
          document.documentElement.classList.contains('dark') === dark, analyzedTheme === 'dark');
        await page.evaluate(() => document.fonts.ready);
        if (width < 640) {
          const mobile = row.locator('[data-home-mobile-accuracy]');
          await mobile.waitFor({ state: 'visible' });
          const actual = await row.evaluate((link) => ({
            nameWidth: link.querySelector('[data-home-recent-opponent]').getBoundingClientRect().width,
            selfScore: link.querySelector('[data-home-accuracy-self]').textContent.trim(),
            opponentScore: link.querySelector('[data-home-accuracy-opponent]').textContent.trim(),
            labels: link.querySelector('[data-home-mobile-accuracy]').textContent,
            desktopScoreVisible: !!link.querySelector('.font-mono.text-xs.tabular-nums')?.getBoundingClientRect().width,
          }));
          const expectedSelf = color === 'white' ? '99.9%' : '100.0%';
          const expectedOpponent = color === 'white' ? '100.0%' : '99.9%';
          if (actual.nameWidth < 150 || actual.selfScore !== expectedSelf ||
              actual.opponentScore !== expectedOpponent ||
              !actual.labels.includes('You') || !actual.labels.includes('Opponent') ||
              actual.desktopScoreVisible) {
            throw new Error(`Analyzed games ${analyzedTheme}/${color}/${width}px: opponent/accuracy regression: ${JSON.stringify(actual)}`);
          }
        } else {
          const score = row.locator('.font-mono.text-xs.tabular-nums');
          await score.waitFor({ state: 'visible' });
          const actual = await score.evaluate((element) => {
            const separator = element.querySelector('.mx-1.text-ui-mutedText');
            const rgb = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
            const luminance = (values) => values.map((x) => {
              const unit = x / 255;
              return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
            }).reduce((total, x, index) => total + x * [0.2126, 0.7152, 0.0722][index], 0);
            const fg = luminance(rgb(getComputedStyle(separator).color));
            const bg = luminance(rgb(getComputedStyle(element.closest('ul')).backgroundColor));
            return {
              text: element.textContent.replace(/\s/g, ''),
              separatorContrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
            };
          });
          if (actual.text !== '99.9%/100.0%' || actual.separatorContrast < 4.5) {
            throw new Error(`Analyzed games ${analyzedTheme}/${color}/${width}px: score regression: ${JSON.stringify(actual)}`);
          }
        }
        await checkNoHorizontalOverflow(page, `analyzed games ${analyzedTheme}/${color}/${width}px`);
        await page.screenshot({ path: resolve(output, `home-analyzed-${analyzedTheme}-${color}-${width}.png`) });
      }
    }
  }
  profile.language = 'de';
  theme = 'light';
  fixtureUserColor = 'white';
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const localizedAccuracy = page.locator('main a[href="/review/103"] [data-home-mobile-accuracy]');
  await localizedAccuracy.waitFor();
  const germanLabels = await localizedAccuracy.innerText();
  if (!germanLabels.includes('Du') || !germanLabels.includes('Gegner')) {
    throw new Error('German analyzed-game mobile accuracy labels fell back to English: ' + germanLabels);
  }
  await checkNoHorizontalOverflow(page, 'German analyzed game 320px');

  // The account's selected language, not the browser's English locale, must
  // determine the recent-game date order and punctuation. Previously every
  // locale displayed 11/12/2026 even after Home itself was translated.
  for (const { language, expected, width } of [
    { language: 'en', expected: '11/12/2026', width: 320 },
    { language: 'de', expected: '12.11.2026', width: 320 },
    { language: 'es', expected: '12/11/2026', width: 320 },
    { language: 'ru', expected: '12.11.2026', width: 320 },
    { language: 'bg', expected: '12.11.2026 г.', width: 320 },
    { language: 'de', expected: '12.11.2026', width: 1440 },
  ]) {
    profile.language = language;
    await page.setViewportSize({ width, height: width === 320 ? 700 : 900 });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const row = page.locator('main a[href="/review/103"]');
    await row.waitFor();
    await page.waitForFunction(
      (code) => localStorage.getItem('lang') === code, language, { timeout: 6000 },
    );
    const pageLang = await page.evaluate(() => document.documentElement.lang);
    if (pageLang !== language) {
      throw new Error(`Recent games ${language}/${width}px: HTML language ${pageLang} disagrees with selected interface language`);
    }
    const actual = await row.locator('[data-home-recent-date]').innerText();
    if (actual.trim() !== expected) {
      throw new Error(`Recent games ${language}/${width}px: wrong localized date ${JSON.stringify({ actual, expected })}`);
    }
    await checkNoHorizontalOverflow(page, `recent game date ${language}/${width}px`);
    if (language === 'de' || language === 'en') {
      await page.screenshot({ path: resolve(output, `home-recent-date-${language}-${width}.png`) });
    }
  }
  profile.language = 'en';
  fixtureUsername = 'sample-player';
  fixtureUserColor = 'white';
  fixtureAnalyzed = false;
  theme = 'light';
  homeGamesMode = 'empty';

  // Broken API dependencies must not strand a touch user with microscopic
  // retry targets. Exercise the real failure paths in the homepage only.
  homeFailureMode = true;
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('Your statistics could not be loaded.').waitFor();
  await page.getByText('Recent games could not be loaded.').waitFor();
  await page.getByRole('button', { name: 'Retry Achievements' }).waitFor();
  const retrySizes = await page.locator('main button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent?.trim(),
        width: rect.width, height: rect.height };
    }));
  if (retrySizes.length < 4) throw new Error('Homepage outage fixture did not render its recovery actions');
  const smallRetries = retrySizes.filter(({ width, height }) => width < 44 || height < 44);
  if (smallRetries.length) {
    throw new Error('Homepage retry actions fail 44px touch targets: ' + JSON.stringify(smallRetries));
  }
  await checkNoHorizontalOverflow(page, 'home outage at 320px');
  await page.screenshot({ path: resolve(output, 'home-error-recovery-mobile-320.png') });
  homeFailureMode = false;

  // A first-use player should not fall back to English for essential greeting,
  // recovery and continuation controls after selecting another app language.
  // Check actual 320px layouts and both healthy and outage journeys.
  for (const locale of [
    {
      code: 'de', firstGame: 'Spiel deine erste Partie', play: 'Spielen',
      review: 'Partieanalyse', greeting: ['Guten Morgen', 'Guten Tag', 'Guten Abend'],
      statsFailure: 'Deine Statistiken konnten nicht geladen werden.',
      recentFailure: 'Deine letzten Partien konnten nicht geladen werden.',
      retry: 'Erneut versuchen', continue: 'Weiter trainieren',
    },
    {
      code: 'es', firstGame: 'Juega tu primera partida', play: 'Jugar',
      review: 'Análisis de partida', greeting: ['Buenos días', 'Buenas tardes', 'Buenas noches'],
      statsFailure: 'No se pudieron cargar tus estadísticas.',
      recentFailure: 'No se pudieron cargar tus partidas recientes.',
      retry: 'Reintentar', continue: 'Sigue mejorando',
    },
  ]) {
    profile.language = locale.code;
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: locale.firstGame }).waitFor();
    if (await page.evaluate(() => document.documentElement.lang) !== locale.code) {
      throw new Error(locale.code + ' translated first-use Home without updating its HTML language');
    }
    const hero = page.locator('main section').first();
    const text = await hero.innerText();
    if (!locale.greeting.some((greeting) =>
      text.toLocaleLowerCase(locale.code).includes(greeting.toLocaleLowerCase(locale.code)))) {
      throw new Error(locale.code + ' home greeting fell back to English: ' + text.slice(0, 150));
    }
    const heroRect = await hero.boundingBox();
    for (const [label, target] of [
      ['Play', hero.locator('a[href="/play"]')],
      ['Game Review', hero.locator('a[href="/review"]')],
    ]) {
      const bounds = await target.boundingBox();
      if (!bounds || bounds.width < 44 || bounds.height < 44 ||
        bounds.x < heroRect.x - 1 || bounds.x + bounds.width > heroRect.x + heroRect.width + 1) {
        throw new Error(locale.code + ' ' + label + ' CTA clipped or too small at 320px: ' + JSON.stringify(bounds));
      }
    }
    await page.getByRole('heading', { name: locale.continue }).waitFor();
    await checkNoHorizontalOverflow(page, locale.code + ' first-use home 320px');
    await page.screenshot({ path: resolve(output, 'home-first-use-' + locale.code + '-320.png') });

    homeFailureMode = true;
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByText(locale.statsFailure).waitFor();
    await page.getByText(locale.recentFailure).waitFor();
    const retryButtons = page.getByRole('button', { name: locale.retry, exact: true });
    if (await retryButtons.count() < 2) {
      throw new Error(locale.code + ' outage uses untranslated retry actions');
    }
    await checkNoHorizontalOverflow(page, locale.code + ' failure home 320px');
    await page.screenshot({ path: resolve(output, 'home-error-' + locale.code + '-320.png') });
    homeFailureMode = false;
  }
  profile.language = 'en';

  // The existing first-use fallback must remain visible if a newly
  // provisioned profile has neither a display name nor a username.
  fixtureUsername = '';
  profile.display_name = '  ';
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1, name: 'Patzer' }).waitFor();
  await checkNoHorizontalOverflow(page, 'new account without username at 320px');
  fixtureUsername = 'sample-player';
  profile.display_name = 'Sample Player';

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
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'patzer-main');

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
  // Verify actual localized shell navigation instead of relying on English
  // fallback labels on touch-sized tablets. Keep feature pages untouched.
  for (const locale of [
    { code: 'es', width: 768, primary: 'Navegación principal', learn: 'Aprender', review: 'Análisis de partida',
      versionLabel: 'Patzer versión 7.19.0: ver novedades', notesTitle: 'Notas de la versión', closeLabel: 'Cerrar' },
    { code: 'bg', width: 640, primary: 'Мобилна навигация', menu: 'Отвори менюто', learn: 'Обучение', review: 'Преглед на игри',
      versionLabel: 'Patzer версия 7.19.0: виж промените', notesTitle: 'Бележки по версията', closeLabel: 'Затвори' },
  ]) {
    profile.language = locale.code;
    await page.setViewportSize({ width: locale.width, height: 900 });
    await page.goto(origin + '/review', { waitUntil: 'domcontentloaded' });
    if (locale.width >= 768) {
      await page.getByRole('navigation', { name: locale.primary }).waitFor({ timeout: 8000 });
    } else {
      await page.getByRole('button', { name: locale.menu }).waitFor({ timeout: 8000 });
    }
    const htmlLanguage = await page.evaluate(() => document.documentElement.lang);
    if (htmlLanguage !== locale.code) {
      throw new Error(`Localized navigation ${locale.code}/${locale.width}px has incorrect document language ${htmlLanguage}`);
    }
    const sectionHeading = page.locator('[data-workspace-header] [data-current-section]');
    await sectionHeading.getByText(locale.review).waitFor({ timeout: 8000 });
    const sizing = await sectionHeading.evaluate((node) => ({
      visible: node.clientWidth, full: node.scrollWidth,
      header: node.getBoundingClientRect().right,
      search: document.querySelector('[data-workspace-header] button[aria-label*="palette"]')?.getBoundingClientRect().left,
    }));
    if (sizing.full > sizing.visible + 1) {
      throw new Error(`${locale.code} review heading clipped at ${locale.width}px: ${JSON.stringify(sizing)}`);
    }
    await page.goto(origin + '/learn', { waitUntil: 'domcontentloaded' });
    if (locale.width < 768) {
      await page.getByRole('button', { name: locale.menu }).click();
    }
    const navigation = page.getByRole('navigation', { name: locale.primary });
    await navigation.waitFor({ timeout: 8000 });
    await navigation.locator('a[href="/learn"]').getByText(locale.learn).waitFor({ timeout: 8000 });
    await page.locator('[data-current-section]').getByText(locale.learn).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: locale.versionLabel }).waitFor({ timeout: 8000 });
    if (locale.width >= 768) {
      const labelsTooNarrow = await page.locator('[data-navigation-rail] nav a > span:last-child').evaluateAll((labels) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Unable to measure navigation label text');
        return labels.flatMap((label) => {
          const style = getComputedStyle(label);
          context.font = style.font || style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
          const available = label.clientWidth;
          const words = (label.textContent ?? '').trim().split(/\s+/);
          const widest = Math.max(0, ...words.map((word) => context.measureText(word).width));
          return widest > available + 1 ? [{ label: label.textContent?.trim(), available, widest }] : [];
        });
      });
      if (labelsTooNarrow.length > 0) {
        throw new Error(`${locale.code} rail breaks words into orphaned letters at ${locale.width}px: ${JSON.stringify(labelsTooNarrow)}`);
      }
    }
    await checkNoHorizontalOverflow(page, `${locale.code} tablet shell ${locale.width}px`);
    await page.screenshot({ path: resolve(output, `localized-nav-${locale.code}-${locale.width}.png`) });
    const versionButton = page.getByRole('button', { name: locale.versionLabel });
    await versionButton.click();
    const notesDialog = page.getByRole('dialog', { name: locale.notesTitle });
    await notesDialog.waitFor();
    if ((await page.getByRole('dialog').count()) !== 1) {
      throw new Error(`${locale.code} changelog opened alongside another modal`);
    }
    await notesDialog.getByRole('button', { name: locale.closeLabel }).click();
    await notesDialog.waitFor({ state: 'detached' });
    if (locale.width < 768) {
      await page.getByRole('dialog', { name: locale.primary }).waitFor({ state: 'detached' });
      const menuTrigger = page.getByRole('button', { name: locale.menu });
      if (!(await menuTrigger.evaluate((button) => button === document.activeElement))) {
        throw new Error(`${locale.code} changelog closed without restoring focus to the mobile menu trigger`);
      }
    } else if (!(await versionButton.evaluate((button) => button === document.activeElement))) {
      throw new Error(`${locale.code} changelog did not restore focus to its desktop version trigger`);
    }
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

  // Browser Back should return to a long page at the position users left.
  // It must not force them to find their former place in the dashboard again.
  await openWithFixture(page, { width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction(() => window.scrollY > 100);
  const beforeHistory = await page.evaluate(() => window.scrollY);
  // Navigate using the documented keyboard shortcut. Clicking the header's
  // menu via a headless test can scroll that trigger into view first, which
  // legitimately changes the position before the route is left.
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await page.waitForURL((url) => url.pathname === '/review');
  await page.waitForFunction(() => document.activeElement?.id === 'patzer-main');
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByRole('heading', { name: 'Continue improving' }).waitFor();
  await page.waitForTimeout(350);
  const afterHistory = await page.evaluate(() => window.scrollY);
  if (Math.abs(afterHistory - beforeHistory) > 20) {
    throw new Error(`Back navigation failed to restore dashboard scroll: before=${beforeHistory} after=${afterHistory}`);
  }
  await page.goForward();
  await page.waitForURL((url) => url.pathname === '/review');
  await page.goBack();
  await page.waitForURL((url) => url.pathname === '/');
  await page.getByRole('heading', { name: 'Continue improving' }).waitFor();
  await page.waitForTimeout(300);
  const secondReturn = await page.evaluate(() => window.scrollY);
  if (Math.abs(secondReturn - beforeHistory) > 20) {
    throw new Error(`Repeated Back navigation lost the dashboard position: before=${beforeHistory} after=${secondReturn}`);
  }

  logoutMode = 'error';
  await openWithFixture(page, { width: 1440, height: 900 });
  const logoutButton = page.getByRole('button', { name: 'Log out' });
  await logoutButton.click();
  const logoutError = page.locator('[data-logout-error]');
  await logoutError.waitFor();
  await page.screenshot({ path: resolve(output, 'shell-logout-error-1440.png') });
  if (!signedIn || !(await page.locator('[data-app-shell]').isVisible())) {
    throw new Error('Failed logout incorrectly removed the authenticated shell');
  }
  logoutMode = 'unconfirmed';
  await logoutButton.click();
  await logoutError.waitFor();
  if (!signedIn) throw new Error('Unconfirmed logout incorrectly removed the authenticated shell');
  logoutMode = 'success';
  await logoutButton.click();
  await page.waitForURL((url) => url.pathname === '/login');
  if (signedIn || (await page.locator('[data-app-shell]').count())) {
    throw new Error('Successful logout left the authenticated workspace visible');
  }

  signedIn = true;
  logoutMode = 'error';
  await openWithFixture(page, { width: 320, height: 700 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Log out' }).click();
  const mobileLogoutError = page.locator('[data-logout-error]');
  await mobileLogoutError.waitFor();
  const errorClose = mobileLogoutError.getByRole('button', { name: 'Close' });
  const errorCloseRect = await errorClose.boundingBox();
  if (!errorCloseRect || errorCloseRect.width < 44 || errorCloseRect.height < 44) {
    throw new Error('Mobile sign-out error close target is under 44px: ' + JSON.stringify(errorCloseRect));
  }
  const errorWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  if (errorWidth > 321) throw new Error('Mobile logout failure caused horizontal overflow');
  await page.screenshot({ path: resolve(output, 'shell-logout-error-mobile-320.png') });
  await errorClose.click();
  logoutMode = 'success';
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog', { name: 'Mobile navigation' })
    .getByRole('button', { name: 'Log out' }).click();
  await page.waitForURL((url) => url.pathname === '/login');
  if (signedIn || (await page.locator('[data-app-shell]').count())) {
    throw new Error('Mobile logout retry left the authenticated workspace visible');
  }
  console.log('Agent 02 shell: responsive Chromium smoke and screenshots passed.');
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
}
