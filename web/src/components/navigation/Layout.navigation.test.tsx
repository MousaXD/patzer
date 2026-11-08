// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const harness = vi.hoisted(() => ({
  role: 'user' as 'user' | 'admin',
  language: 'en',
  longLabels: false,
  changeLanguage: vi.fn(async (_language: string) => undefined),
  refresh: vi.fn(async () => undefined),
  endSession: vi.fn(async () => false),
  openPalette: vi.fn(),
  openShortcuts: vi.fn(),
}));

const labels: Record<string, string> = {
  'app.name': 'Patzer',
  'app.home': 'Home',
  'home.playTitle': 'Play',
  'home.reviewTitle': 'Review',
  'insights.title': 'Insights',
  'train.nav': 'Training',
  'learn.nav': 'Learning',
  'openings.nav': 'Openings',
  'plan.nav': 'Plans',
  'players.nav': 'Players',
  'lab.nav': 'Lab',
  'common.settings': 'Settings',
  'common.logout': 'Log out',
  'common.admin': 'Admin',
  'admin.users': 'Users',
  'admin.system': 'System',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      harness.longLabels && key === 'players.nav'
        ? 'Spieler und ausführliche Langbezeichnungen für die Navigation'
        : labels[key] ?? options?.defaultValue ?? key,
    i18n: { language: harness.language, changeLanguage: harness.changeLanguage },
  }),
}));

vi.mock('../../state/auth', () => ({
  useAuth: () => ({
    user: {
      username: 'sample-player',
      role: harness.role,
      profile: { display_name: 'Sample Player', avatar_emoji: 'old-avatar-value' },
    },
    refresh: harness.refresh,
  }),
}));
vi.mock('../../api', () => ({
  api: { get: vi.fn(async () => ({ version: '7.19.0' })) },
}));
vi.mock('../../lib/logout', () => ({ endSession: harness.endSession }));
vi.mock('../UpdateNotice', () => ({ default: () => null }));
vi.mock('../ChangelogModal', () => ({ default: () => null }));
vi.mock('../GitHubStar', () => ({ default: () => null }));

import Layout from '../Layout';

const paths = [
  '/', '/play', '/review', '/review/42', '/insights', '/train', '/learn',
  '/openings', '/plan', '/players', '/players/42', '/lab', '/settings',
  '/admin/users', '/admin/system',
];

function mount(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<Layout onOpenPalette={harness.openPalette} onOpenShortcuts={harness.openShortcuts} />}>
          {paths.map((route) => <Route key={route} path={route} element={<div data-testid="route-content">{route}</div>} />)}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const destinations = [
  ['Home', '/'], ['Play', '/play'], ['Review', '/review'], ['Insights', '/insights'],
  ['Training', '/train'], ['Learning', '/learn'], ['Openings', '/openings'],
  ['Plans', '/plan'], ['Players', '/players'], ['Lab', '/lab'],
] as const;

beforeEach(() => {
  harness.role = 'user';
  harness.language = 'en';
  harness.longLabels = false;
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); });

describe('Patzer navigation rail', () => {
  it('retains all ten destinations, settings and functional route changes', () => {
    mount();
    const rail = screen.getByRole('navigation', { name: 'Primary navigation' });
    for (const [label, to] of destinations) {
      const link = within(rail).getByRole('link', { name: label });
      expect(link.getAttribute('href')).toBe(to);
      expect(link.getAttribute('title')).toBe(label);
    }
    expect(screen.getAllByRole('link', { name: 'Settings' })[0].getAttribute('href')).toBe('/settings');
    fireEvent.click(within(rail).getByRole('link', { name: 'Review' }));
    expect(screen.getByTestId('route-content').textContent).toBe('/review');
    expect(within(rail).getByRole('link', { name: 'Review' }).getAttribute('aria-current')).toBe('page');
  });

  it('marks parent destinations active on nested review and player pages', () => {
    const { unmount } = mount('/review/42');
    expect(screen.getByRole('link', { name: 'Review' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[data-workspace]')?.getAttribute('data-workspace')).toBe('analysis');
    expect(document.querySelector('[data-workspace-content]')?.className).toContain('max-w-none');
    expect(document.querySelector('[data-shell-main]')?.className).toContain('min-w-0');
    unmount();
    mount('/players/42');
    expect(screen.getByRole('link', { name: 'Players' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('[data-workspace]')?.getAttribute('data-workspace')).toBe('default');
  });

  it('is stable-width and exposes distinct desktop/mobile navigation semantics', () => {
    mount();
    expect(document.querySelector('[data-navigation-rail]')?.className).toContain('w-20');
    expect(document.querySelector('[data-navigation-rail]')?.className).toContain('md:flex');
    expect(document.querySelector('[data-app-shell]')?.className).toContain('min-w-0');
    expect(document.querySelector('[data-workspace-content]')?.className).toContain('max-w-[1440px]');
    expect(screen.getByRole('button', { name: 'Open menu' }).className).toContain('md:hidden');
    expect(screen.queryByText('old-avatar-value')).toBeNull();
  });

  it('does not leak administrator destinations to ordinary users', () => {
    mount();
    expect(screen.queryByRole('link', { name: 'System' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('makes both administrator destinations available on desktop and mobile', () => {
    harness.role = 'admin';
    mount('/admin/users');
    const rail = screen.getByRole('navigation', { name: 'Primary navigation' });
    expect(within(rail).getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBe('page');
    expect(within(rail).getByRole('link', { name: 'System' }).getAttribute('href')).toBe('/admin/system');
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Mobile navigation' });
    expect(within(drawer).getByRole('link', { name: 'Users' }).getAttribute('href')).toBe('/admin/users');
    expect(within(drawer).getByRole('link', { name: 'System' }).getAttribute('href')).toBe('/admin/system');
  });

  it('closes its modal drawer with Escape, traps Tab and restores trigger focus', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'Mobile navigation' });
    const close = within(drawer).getByRole('button', { name: 'Close menu' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Log out' }));
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Mobile navigation' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('releases mobile focus containment when resized to the desktop breakpoint', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false, media: '(min-width: 768px)',
      addEventListener: (_event: string, fn: (event: MediaQueryListEvent) => void) => { listeners.add(fn); },
      removeEventListener: (_event: string, fn: (event: MediaQueryListEvent) => void) => { listeners.delete(fn); },
    })));
    try {
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(screen.getByRole('dialog', { name: 'Mobile navigation' })).toBeTruthy();
      act(() => {
        for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent);
      });
      expect(screen.queryByRole('dialog', { name: 'Mobile navigation' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('navigates from a small-screen drawer and closes the overlay', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Mobile navigation' });
    for (const [label, to] of destinations) {
      expect(within(drawer).getByRole('link', { name: label }).getAttribute('href')).toBe(to);
    }
    fireEvent.click(within(drawer).getByRole('link', { name: 'Play' }));
    expect(screen.getByTestId('route-content').textContent).toBe('/play');
    expect(screen.queryByRole('dialog', { name: 'Mobile navigation' })).toBeNull();
  });

  it('preserves both global controls, language switching, profile, logout and changelog', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }));
    expect(harness.openPalette).toHaveBeenCalledTimes(1);
    expect(harness.openShortcuts).toHaveBeenCalledTimes(1);
    const language = screen.getByRole('combobox', { name: 'Language' });
    expect(within(language).getAllByRole('option')).toHaveLength(5);
    fireEvent.change(language, { target: { value: 'de' } });
    expect(harness.changeLanguage).toHaveBeenCalledWith('de');
    expect(screen.getAllByRole('link', { name: 'Settings' })[0].getAttribute('href')).toBe('/settings');
    // Check the footer before logout redirects outside this isolated router.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Patzer v7.19.0' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(harness.endSession).toHaveBeenCalledTimes(1));
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  it('retains full translated names as accessible labels without expanding the rail', () => {
    harness.longLabels = true;
    mount('/players');
    const translated = 'Spieler und ausführliche Langbezeichnungen für die Navigation';
    const link = screen.getByRole('link', { name: translated });
    expect(link.getAttribute('title')).toBe(translated);
    expect(link.querySelector('span:last-child')?.className).toContain('line-clamp-2');
    expect(document.querySelector('[data-navigation-rail]')?.className).toContain('w-20');
  });

  it('styles the same accessible shell in either theme without inline color overrides', () => {
    document.documentElement.classList.add('dark');
    const { unmount } = mount();
    expect(document.querySelector('[data-app-shell]')?.className).toContain('dark:bg-chesscom-950');
    expect(document.querySelector('[data-workspace-header]')?.className).toContain('dark:bg-chesscom-900/95');
    unmount();
    document.documentElement.classList.remove('dark');
    mount();
    expect(document.querySelector('[data-app-shell]')?.className).toContain('bg-white');
  });
});
