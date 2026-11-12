import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, BarChart3, BookMarked, BookOpen, ChevronDown, ChevronRight, GraduationCap, Home, Keyboard,
  ListChecks, LogOut, Menu, Microscope, Search, Server, Link2, Settings as SettingsIcon,
  Swords, Target, UserRound, Users, X, type LucideIcon,
} from 'lucide-react';
import { api } from '../api';
import UpdateNotice from './UpdateNotice';
import { useAuth } from '../state/auth';
import { cn } from '../lib/utils';
import ChangelogModal from './ChangelogModal';
import { LogoMark, LogoLockup } from './Logo';
import { LANGUAGES, normalizeLanguage } from '../lib/languages';
import { endSession } from '../lib/logout';

interface LayoutProps {
  onOpenPalette?: () => void;
  onOpenShortcuts?: () => void;
}

type Destination = {
  to: string;
  icon: LucideIcon;
  key: string;
  fallback: string;
};

// Keep routing in App.tsx authoritative. These links preserve every existing
// destination, including nested review/player routes and both admin screens.
const PRIMARY_DESTINATIONS: readonly Destination[] = [
  { to: '/', icon: Home, key: 'app.home', fallback: 'Home' },
  { to: '/play', icon: Swords, key: 'home.playTitle', fallback: 'Play' },
  { to: '/review', icon: BookOpen, key: 'home.reviewTitle', fallback: 'Review' },
  { to: '/insights', icon: BarChart3, key: 'insights.title', fallback: 'Insights' },
  { to: '/train', icon: Target, key: 'train.nav', fallback: 'Training' },
  { to: '/learn', icon: GraduationCap, key: 'learn.nav', fallback: 'Learning' },
  { to: '/openings', icon: BookMarked, key: 'openings.nav', fallback: 'Openings' },
  { to: '/plan', icon: ListChecks, key: 'plan.nav', fallback: 'Plans' },
  { to: '/players', icon: Users, key: 'players.nav', fallback: 'Players' },
  { to: '/lab', icon: Microscope, key: 'lab.nav', fallback: 'Lab' },
];

const SETTINGS_DESTINATION: Destination = { to: '/settings', icon: SettingsIcon, key: 'common.settings', fallback: 'Settings' };

const ADMIN_DESTINATIONS: readonly Destination[] = [
  { to: '/admin/users', icon: Users, key: 'admin.users', fallback: 'Users' },
  { to: '/admin/system', icon: Server, key: 'admin.system', fallback: 'System' },
  { to: '/admin/mcp', icon: Link2, key: 'mcp.title', fallback: 'ChatGPT / MCP' },
];

function isDestinationActive(pathname: string, to: string): boolean {
  return pathname === to || (to !== '/' && pathname.startsWith(to + '/'));
}

function NavigationItem({
  item, label, mobile = false, onNavigate,
}: {
  item: Destination;
  label: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      aria-label={mobile ? undefined : label}
      title={mobile ? undefined : label}
      className={({ isActive }) => cn(
        'group relative flex shrink-0 items-center rounded-xl font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2',
        'dark:focus-visible:ring-offset-chesscom-900 motion-reduce:transition-none',
        mobile
          ? 'min-h-11 w-full gap-3 px-3 py-2.5 text-sm'
          : 'mx-auto min-h-[53px] w-[64px] flex-col justify-center gap-1 px-1.5 py-1.5 text-[10px] select-none',
        isActive
          ? 'bg-green-500/10 text-green-700 dark:bg-green-500/20 dark:text-green-100'
          : 'text-chesscom-600 hover:bg-chesscom-100 hover:text-chesscom-900 dark:text-chesscom-300 dark:hover:bg-chesscom-800 dark:hover:text-white',
      )}
    >
      {({ isActive }) => (
        <>
          {!mobile && isActive && (
            <span aria-hidden="true" className="absolute -left-2 h-7 w-[3px] rounded-r-full bg-green-500" />
          )}
          <Icon aria-hidden="true" className={cn('shrink-0', mobile ? 'h-[19px] w-[19px]' : 'h-[20px] w-[20px]')} />
          <span className={cn('min-w-0', mobile ? 'flex-1' : 'block w-full break-words text-center leading-[0.9rem] line-clamp-2')}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function LanguageSelector({ value, label, onChange, mobile = false }: {
  value: string;
  label: string;
  onChange: (value: string) => void;
  mobile?: boolean;
}) {
  return (
    <div className={cn('relative min-w-0', mobile ? 'w-full' : 'w-[108px] shrink-0')}>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-9 w-full cursor-pointer appearance-none rounded-lg border border-chesscom-200 bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-chesscom-700',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:border-chesscom-700 dark:bg-chesscom-900 dark:text-chesscom-100',
        )}
      >
        {LANGUAGES.map((language) => (
          <option value={language.code} key={language.code}>{language.native}</option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chesscom-500" />
    </div>
  );
}

export default function Layout({ onOpenPalette, onOpenShortcuts }: LayoutProps) {
  const { t, i18n } = useTranslation();
  const uiLang = normalizeLanguage(i18n.language);
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [version, setVersion] = useState('');
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastFocusedPathRef = useRef(location.pathname);

  const primaryLabel = t('navigation.primary', { defaultValue: 'Primary navigation' });
  const mobileLabel = t('navigation.mobile', { defaultValue: 'Mobile navigation' });
  const adminLabel = t('common.admin', { defaultValue: 'Admin' });
  const closeMenuLabel = t('navigation.close', { defaultValue: 'Close menu' });
  const openMenuLabel = t('navigation.open', { defaultValue: 'Open menu' });
  const languageLabel = t('navigation.language', { defaultValue: 'Language' });
  const isAnalysis = isDestinationActive(location.pathname, '/review') && location.pathname !== '/review';
  const activeItem = [...PRIMARY_DESTINATIONS, SETTINGS_DESTINATION, ...(user?.role === 'admin' ? ADMIN_DESTINATIONS : [])]
    .find((item) => isDestinationActive(location.pathname, item.to));
  const pageTitle = activeItem ? t(activeItem.key, { defaultValue: activeItem.fallback }) : t('app.name');
  const nestedSection = location.pathname.startsWith('/review/')
    ? t('home.reviewTitle', { defaultValue: 'Review' })
    : location.pathname.startsWith('/players/')
      ? t('players.nav', { defaultValue: 'Players' })
      : null;
  const nestedTitle = location.pathname.startsWith('/review/')
    ? t('navigation.gameAnalysis', { defaultValue: 'Game analysis' })
    : location.pathname.startsWith('/players/')
      ? t('navigation.playerProfile', { defaultValue: 'Player profile' })
      : null;

  useEffect(() => {
    api.get<{ version: string }>('/api/meta')
      .then((response) => setVersion(response.version))
      .catch(() => setVersion(''));
  }, []);

  // Navigation never leaves a stale drawer over the newly selected route.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // In an SPA the old navigation link remains focused after a pathname
  // change. From the mobile drawer its focus trap even restores focus to
  // "Open menu". Move focus to the new named main landmark *after* the drawer
  // is dismissed, so keyboard and screen-reader users know where they landed.
  // Preserve query-only state changes within Play/Review and browser back
  // scroll positions; only fresh navigations start at the top.
  useEffect(() => {
    if (lastFocusedPathRef.current === location.pathname || drawerOpen) return;
    lastFocusedPathRef.current = location.pathname;
    const frame = window.requestAnimationFrame(() => {
      if (navigationType !== 'POP') window.scrollTo(0, 0);
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, drawerOpen, navigationType]);

  // A drawer opened on mobile must release focus when the viewport becomes
  // desktop-sized. Otherwise a CSS-hidden dialog could keep trapping Tab.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawerOpen(false);
    };
    desktop.addEventListener('change', onChange);
    return () => desktop.removeEventListener('change', onChange);
  }, []);

  // Prevent background scrolling while the mobile navigation is modal.
  useEffect(() => {
    if (!drawerOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = oldOverflow; };
  }, [drawerOpen]);

  // The mobile drawer behaves as a modal: Escape closes, Tab stays inside,
  // and closing returns keyboard focus to the menu trigger.
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    drawer.querySelector<HTMLButtonElement>('[data-close-menu]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawerOpen(false);
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      menuTriggerRef.current?.focus();
    };
  }, [drawerOpen]);

  async function logout() {
    if (await endSession()) return;
    await refresh();
    navigate('/login');
  }

  const searchLabel = t('palette.open', { defaultValue: 'Open command palette' });
  const shortcutsLabel = t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' });
  const profileLabel = t('common.settings', { defaultValue: 'Settings' });
  const logoutLabel = t('common.logout', { defaultValue: 'Log out' });

  return (
    <div className="flex min-h-dvh min-w-0 bg-white text-chesscom-900 dark:bg-chesscom-950 dark:text-chesscom-100" data-app-shell>
      <a href="#patzer-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-chesscom-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-gold-500 dark:focus:bg-chesscom-900 dark:focus:text-white">
        {t('navigation.skip', { defaultValue: 'Skip to main content' })}
      </a>
      {/* Width is stable: no collapsed/expanded rail resizing the chessboard. */}
      <aside
        className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col border-r border-chesscom-200 bg-white dark:border-chesscom-700 dark:bg-chesscom-900 md:flex"
        aria-label={primaryLabel}
        data-navigation-rail
      >
        <NavLink
          to="/"
          className="flex h-[68px] shrink-0 items-center justify-center border-b border-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-500 dark:border-chesscom-800"
          aria-label={t('app.name')}
          title={t('app.name')}
        >
          <LogoMark size={33} />
        </NavLink>
        <nav aria-label={primaryLabel} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2" data-primary-navigation>
          {PRIMARY_DESTINATIONS.map((item) => (
            <NavigationItem key={item.to} item={item} label={t(item.key, { defaultValue: item.fallback })} />
          ))}
          {user?.role === 'admin' && (
            <div className="mt-2 space-y-0.5 border-t border-chesscom-200 pt-2 dark:border-chesscom-700" aria-label={adminLabel}>
              <span className="sr-only">{adminLabel}</span>
              {ADMIN_DESTINATIONS.map((item) => (
                <NavigationItem key={item.to} item={item} label={t(item.key, { defaultValue: item.fallback })} />
              ))}
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-chesscom-200 px-2 py-2 dark:border-chesscom-700">
          <NavigationItem
            item={SETTINGS_DESTINATION}
            label={profileLabel}
          />
          {version && (
            <button type="button" onClick={() => setShowChangelog(true)}
              className="mt-1 w-full rounded-md px-1 py-1 text-center text-[10px] text-chesscom-500 hover:text-chesscom-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:text-white"
              title={t('common.viewChangelog')} aria-label={`Patzer version ${version}, view changelog`}>
              v{version}
            </button>
          )}
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col" data-workspace={isAnalysis ? 'analysis' : 'default'}>
        <UpdateNotice />
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-chesscom-200 bg-white/95 px-3 shadow-sm backdrop-blur-md dark:border-chesscom-700 dark:bg-chesscom-900/95 sm:gap-2 sm:px-5" data-workspace-header>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2.5">
            <NavLink to="/" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 md:hidden" aria-label={t('app.name')}>
              <LogoMark size={27} />
            </NavLink>
            {nestedSection && nestedTitle ? (
              <nav aria-label={t('navigation.breadcrumb', { defaultValue: 'Breadcrumb' })} className="flex min-w-0 items-center gap-1 text-sm sm:text-base" data-current-section>
                <Link
                  to={location.pathname.startsWith('/review/') ? '/review' : '/players'}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded px-1 font-medium text-chesscom-500 hover:bg-chesscom-100 hover:text-chesscom-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:text-chesscom-300 dark:hover:bg-chesscom-800 dark:hover:text-white md:h-auto md:w-auto md:py-1"
                  title={nestedSection}
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4 md:hidden" />
                  <span className="sr-only md:not-sr-only">{nestedSection}</span>
                </Link>
                <ChevronRight aria-hidden="true" className="hidden h-4 w-4 shrink-0 text-chesscom-400 md:block" />
                <span className="min-w-0 truncate font-semibold" aria-current="page" title={nestedTitle}>{nestedTitle}</span>
              </nav>
            ) : (
              <span className="truncate text-sm font-semibold tracking-tight sm:text-base" data-current-section>{pageTitle}</span>
            )}
          </div>
          {onOpenPalette && (
            <button
              type="button"
              onClick={onOpenPalette}
              className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-chesscom-200 bg-chesscom-50 px-2 text-chesscom-600 transition-colors hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-200 dark:hover:bg-chesscom-700 sm:h-9 sm:min-w-9 sm:px-3"
              aria-label={searchLabel}
              title={searchLabel}
            >
              <Search aria-hidden="true" className="h-[17px] w-[17px]" />
              <span className="hidden text-xs font-medium lg:inline">{t('palette.search', { defaultValue: 'Search' })}</span>
              <kbd className="hidden rounded border border-chesscom-200 px-1.5 py-0.5 text-[10px] dark:border-chesscom-600 xl:inline">Ctrl K</kbd>
            </button>
          )}
          {onOpenShortcuts && (
            <button
              type="button"
              onClick={onOpenShortcuts}
              aria-label={shortcutsLabel}
              title={shortcutsLabel}
              className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-chesscom-600 transition-colors hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:text-chesscom-200 dark:hover:bg-chesscom-800 sm:flex"
            >
              <Keyboard aria-hidden="true" className="h-[18px] w-[18px]" />
            </button>
          )}
          <div className="hidden md:block"><LanguageSelector value={uiLang} label={languageLabel} onChange={(value) => { void i18n.changeLanguage(value); }} /></div>
          <NavLink
            to="/settings"
            className="hidden h-9 max-w-44 shrink-0 items-center gap-2 rounded-lg border border-transparent px-2 text-xs transition-colors hover:border-chesscom-200 hover:bg-chesscom-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:border-chesscom-700 dark:hover:bg-chesscom-800 sm:flex"
            aria-label={profileLabel}
            title={profileLabel}
          >
            <UserRound aria-hidden="true" className="h-[19px] w-[19px] shrink-0" />
            <span className="hidden min-w-0 truncate font-semibold xl:inline">{user?.profile.display_name ?? user?.username}</span>
          </NavLink>
          <button
            type="button"
            onClick={() => { void logout(); }}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-chesscom-600 transition-colors hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:text-chesscom-200 dark:hover:bg-chesscom-800 md:flex"
            title={logoutLabel}
            aria-label={logoutLabel}
          >
            <LogOut aria-hidden="true" className="h-[18px] w-[18px]" />
          </button>
          <button
            type="button"
            ref={menuTriggerRef}
            onClick={() => setDrawerOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-chesscom-700 hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:text-chesscom-100 dark:hover:bg-chesscom-800 md:hidden"
            aria-label={openMenuLabel}
            aria-expanded={drawerOpen}
            aria-controls="patzer-mobile-drawer"
          >
            <Menu aria-hidden="true" className="h-5 w-5" />
          </button>
        </header>

        {/* No global max-width on the analysis route. This is Agent 03's
            predictable full-width, min-w-0 flex workspace contract. */}
        <main ref={mainRef} id="patzer-main" tabIndex={-1} aria-label={nestedTitle ?? pageTitle}
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col" data-shell-main>
          <div className={cn(
            'mx-auto flex w-full min-h-0 min-w-0 flex-1 flex-col px-3 py-4 sm:px-5 sm:py-5',
            isAnalysis ? 'max-w-none' : 'max-w-[1440px]',
          )} data-workspace-content>
            <Suspense fallback={
              <div role="status" aria-live="polite" className="flex min-h-60 flex-col items-center justify-center gap-4 text-sm text-chesscom-600 dark:text-chesscom-300" data-page-loading>
                <LogoMark size={36} />
                <span className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-3 w-3 animate-pulse rounded-full bg-green-500 motion-reduce:animate-none" />
                  {t('navigation.loading', { defaultValue: 'Loading page…' })}
                </span>
              </div>
            }>
              <Outlet />
            </Suspense>
          </div>
        </main>

      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 h-full w-full bg-black/55"
            onClick={() => setDrawerOpen(false)}
            aria-label={closeMenuLabel}
            tabIndex={-1}
          />
          <aside
            ref={drawerRef}
            id="patzer-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={mobileLabel}
            className="absolute inset-y-0 right-0 flex h-full w-[min(340px,90vw)] flex-col overflow-y-auto border-l border-chesscom-200 bg-white p-4 text-chesscom-900 shadow-2xl dark:border-chesscom-700 dark:bg-chesscom-900 dark:text-chesscom-100"
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-chesscom-200 pb-3 dark:border-chesscom-700">
              <LogoLockup size={27} />
              <button
                type="button"
                data-close-menu
                onClick={() => setDrawerOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:bg-chesscom-800"
                aria-label={closeMenuLabel}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            {user && (
              <NavLink
                to="/settings"
                onClick={() => setDrawerOpen(false)}
                className="mb-3 flex min-w-0 items-center gap-3 rounded-xl bg-chesscom-50 px-3 py-3 hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:bg-chesscom-800 dark:hover:bg-chesscom-700"
              >
                <UserRound aria-hidden="true" className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{user.profile.display_name}</span>
                  <span className="block truncate text-xs text-chesscom-500 dark:text-chesscom-300">@{user.username}</span>
                </span>
              </NavLink>
            )}
            <nav aria-label={mobileLabel} className="space-y-1">
              {PRIMARY_DESTINATIONS.map((item) => (
                <NavigationItem
                  key={item.to} item={item} label={t(item.key, { defaultValue: item.fallback })}
                  mobile onNavigate={() => setDrawerOpen(false)}
                />
              ))}
              <NavigationItem
                item={SETTINGS_DESTINATION}
                label={profileLabel} mobile onNavigate={() => setDrawerOpen(false)}
              />
              {user?.role === 'admin' && (
                <div className="mt-3 space-y-1 border-t border-chesscom-200 pt-3 dark:border-chesscom-700">
                  <p className="px-3 pb-1 text-xs font-semibold text-chesscom-500 dark:text-chesscom-300">{adminLabel}</p>
                  {ADMIN_DESTINATIONS.map((item) => (
                    <NavigationItem
                      key={item.to} item={item} label={t(item.key, { defaultValue: item.fallback })}
                      mobile onNavigate={() => setDrawerOpen(false)}
                    />
                  ))}
                </div>
              )}
            </nav>
            <div className="mt-auto space-y-3 border-t border-chesscom-200 pt-4 dark:border-chesscom-700">
              <LanguageSelector mobile value={uiLang} label={languageLabel} onChange={(value) => { void i18n.changeLanguage(value); }} />
              {version && (
                <button type="button" onClick={() => { setDrawerOpen(false); setShowChangelog(true); }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-chesscom-500 hover:bg-chesscom-100 dark:hover:bg-chesscom-800"
                  title={t('common.viewChangelog')}>
                  Patzer v{version} · {t('common.viewChangelog')}
                </button>
              )}
              {onOpenShortcuts && (
                <button
                  type="button"
                  onClick={() => { setDrawerOpen(false); onOpenShortcuts(); }}
                  className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:bg-chesscom-800"
                >
                  <Keyboard aria-hidden="true" className="h-5 w-5" />{shortcutsLabel}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setDrawerOpen(false); void logout(); }}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:bg-chesscom-800"
              >
                <LogOut aria-hidden="true" className="h-5 w-5" />{logoutLabel}
              </button>
            </div>
          </aside>
        </div>
      )}
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </div>
  );
}
