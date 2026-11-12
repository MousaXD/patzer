// Command Palette — ⌘K / Ctrl+K. Global quick-search for navigation,
// recent games, and high-level actions. Patzer's killer-app UX detail
// over chess.com (which has no equivalent).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Search, Home, Swords, BookOpen, BarChart3, Settings as SettingsIcon, Target,
  Trophy, Frown, Equal, Users, Server, Sun, Moon, Globe, LogOut, Star,
  BookMarked, ListChecks, Microscope, GraduationCap, X,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import type { GameRow } from '../types';
import { cn } from '../lib/utils';
import { LANGUAGES, type Language } from '../lib/languages';
import { endSession } from '../lib/logout';
import { saveInterfaceLanguage } from '../lib/saveInterfaceLanguage';
import { useDialogFocus } from './useDialogFocus';

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ElementType;
  group: 'nav' | 'action' | 'game';
  run: () => void | Promise<void>;
  keywords?: string;
}

interface Props { open: boolean; onClose: () => void }

// Native names remain visible so users can always find their own language,
// but English names and common Latin transliterations improve search when
// the current UI language is unfamiliar.
const LANGUAGE_SEARCH_ALIASES: Record<Language, string> = {
  en: 'english',
  bg: 'bulgarian bulgarski',
  es: 'spanish espanol',
  de: 'german',
  ru: 'russian russkiy russkii',
};

function normalizeSearchTerm(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export default function CommandPalette({ open, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const actionRunningRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialogRef, onClose, inputRef);

  // Recent games are private to the signed-in account. Never reuse this
  // query's cache across account switches in the same browser session.
  // Navigation/actions stay usable even if the endpoint is unavailable.
  const { data: gamesData, isLoading: gamesLoading, isError: gamesError,
    isFetching: gamesFetching, refetch: refetchGames } = useQuery({
    queryKey: ['palette-games', user?.id],
    queryFn: async ({ signal }) => {
      const response = await api.get<{ games: GameRow[] }>('/api/games?limit=30', { signal });
      if (!Array.isArray(response?.games)) throw new Error('Invalid recent games response');
      return response;
    },
    enabled: open && user?.id != null,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setActionError('');
    }
  }, [open]);

  const actions = useMemo<Action[]>(() => {
    const base: Action[] = [
      { id: 'nav-home', label: t('app.home'), icon: Home, group: 'nav', run: () => { nav('/'); onClose(); } },
      { id: 'nav-play', label: t('home.playTitle'), icon: Swords, group: 'nav', run: () => { nav('/play'); onClose(); } },
      { id: 'nav-review', label: t('review.title'), icon: BookOpen, group: 'nav', run: () => { nav('/review'); onClose(); } },
      { id: 'nav-insights', label: t('insights.title', { defaultValue: 'Insights' }), icon: BarChart3, group: 'nav', run: () => { nav('/insights'); onClose(); } },
      { id: 'nav-train', label: t('train.title', { defaultValue: 'Tactic Trainer' }), icon: Target, group: 'nav', keywords: 'puzzle tactic train practice', run: () => { nav('/train'); onClose(); } },
      { id: 'nav-learn', label: t('learn.title'), icon: GraduationCap, group: 'nav', keywords: 'learn lesson course rules basics tactics endgame', run: () => { nav('/learn'); onClose(); } },
      { id: 'nav-openings', label: t('openings.title', { defaultValue: 'Openings' }), icon: BookMarked, group: 'nav', keywords: 'opening repertoire tree eco', run: () => { nav('/openings'); onClose(); } },
      { id: 'nav-plan', label: t('plan.title', { defaultValue: 'Improvement plan' }), icon: ListChecks, group: 'nav', keywords: 'plan goals weekly improvement', run: () => { nav('/plan'); onClose(); } },
      { id: 'nav-lab', label: t('lab.title', { defaultValue: 'Lab' }), icon: Microscope, group: 'nav', keywords: 'lab sandbox engine analyze stockfish position', run: () => { nav('/lab'); onClose(); } },
      { id: 'nav-players', label: t('players.title', { defaultValue: 'Players' }), icon: Users, group: 'nav', keywords: 'players people friends social leaderboard profile challenge', run: () => { nav('/players'); onClose(); } },
      { id: 'nav-settings', label: t('common.settings'), icon: SettingsIcon, group: 'nav', run: () => { nav('/settings'); onClose(); } },
      { id: 'nav-bookmarks', label: t('palette.bookmarks', { defaultValue: 'Starred games' }), icon: Star, group: 'nav', run: () => { nav('/review?bookmarked=1'); onClose(); } },
    ];
    if (user?.role === 'admin') {
      base.push({ id: 'nav-admin-users', label: t('admin.users'), icon: Users, group: 'nav', run: () => { nav('/admin/users'); onClose(); } });
      base.push({ id: 'nav-admin-system', label: t('admin.system'), icon: Server, group: 'nav', run: () => { nav('/admin/system'); onClose(); } });
    }
    base.push(
      ...LANGUAGES.map((l) => ({ id: `lang-${l.code}`, label: `${t('palette.switchLanguage', { defaultValue: 'Switch to' })} ${l.native}`, icon: Globe, group: 'action' as const, keywords: `language ${l.native} ${l.code} ${LANGUAGE_SEARCH_ALIASES[l.code]}`, run: async () => { await saveInterfaceLanguage(l.code); onClose(); } })),
      { id: 'theme-light', label: t('palette.themeLight', { defaultValue: 'Light theme' }), icon: Sun, group: 'action', run: async () => { await api.patch('/api/settings/profile', { site_theme: 'light' }); await refresh(); onClose(); } },
      { id: 'theme-dark', label: t('palette.themeDark', { defaultValue: 'Dark theme' }), icon: Moon, group: 'action', run: async () => { await api.patch('/api/settings/profile', { site_theme: 'dark' }); await refresh(); onClose(); } },
      { id: 'logout', label: t('common.logout'), icon: LogOut, group: 'action', run: async () => {
        // Do not dismiss the palette before the server confirms sign-out:
        // a rejected request must leave an accessible, retryable error.
        if (await endSession()) { onClose(); return; }
        await refresh();
        onClose();
        nav('/login');
      } },
    );
    // Recent games as actions
    for (const g of (gamesData?.games ?? []).slice(0, 12)) {
      const opp = g.user_color === 'white' ? g.black : g.white;
      const ResultIcon = g.result === 'win' ? Trophy : g.result === 'loss' ? Frown : Equal;
      base.push({
        id: `game-${g.id}`,
        label: `vs ${opp}`,
        hint: `${g.time_control ?? ''} · ${new Date(g.end_time).toLocaleDateString()} · ${g.result}`,
        icon: ResultIcon,
        group: 'game',
        keywords: `${g.white} ${g.black} ${g.opening_name ?? ''}`,
        run: () => { nav(`/review/${g.id}`); onClose(); },
      });
    }
    return base;
  }, [t, i18n, user, nav, onClose, gamesData, refresh]);

  const filtered = useMemo(() => {
    const s = normalizeSearchTerm(q.trim());
    if (!s) return actions;
    return actions.filter((a) => {
      const hay = normalizeSearchTerm(`${a.label} ${a.hint ?? ''} ${a.keywords ?? ''}`);
      return hay.includes(s);
    });
  }, [actions, q]);

  useEffect(() => { setActive(0); }, [q]);

  async function executeAction(action?: Action) {
    if (!action || actionRunningRef.current) return;
    actionRunningRef.current = true;
    setActionError('');
    setPendingAction(action.id);
    try {
      await action.run();
    } catch {
      // Avoid leaking API errors or stack traces; users can retry the action.
      setActionError(t('palette.actionFailed', { defaultValue: 'That action could not be completed. Please try again.' }));
    } finally {
      actionRunningRef.current = false;
      setPendingAction(null);
    }
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void executeAction(filtered[active]);
    }
  }

  // Keep the active item in view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[min(12vh,5rem)] sm:px-4 [@media(max-height:500px)]:pb-3 [@media(max-height:500px)]:pt-3" data-global-palette>
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t('palette.search', { defaultValue: 'Search' })} aria-busy={pendingAction !== null} tabIndex={-1}
        className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl min-h-0 flex-col overflow-hidden rounded-xl border border-ui-border bg-ui-surface text-ui-foreground shadow-lift motion-safe:animate-fade-in">
        <div className="flex shrink-0 items-center gap-2 border-b border-ui-border px-3 py-2">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-mutedText" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActionError(''); }}
            onKeyDown={onSearchKeyDown}
            placeholder={t('palette.placeholder', { defaultValue: 'Type to search nav, actions, games…' })}
            role="combobox"
            aria-label={t('palette.search', { defaultValue: 'Search' })}
            aria-controls="patzer-palette-results"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={filtered.length > 0 ? `patzer-palette-option-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ui-foreground outline-none placeholder:text-ui-mutedText"
          />
          <kbd className="hidden rounded border border-ui-border px-1.5 py-0.5 text-[11px] text-ui-mutedText sm:inline">{t('palette.esc')}</kbd>
          <button type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ui-mutedText hover:bg-ui-hover hover:text-ui-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus sm:h-9 sm:w-9">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div id="patzer-palette-results" role="listbox" aria-label={t('palette.navGroup', { defaultValue: 'Navigate' })}
          ref={listRef} className="min-h-0 max-h-[min(60dvh,32rem)] flex-1 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ui-mutedText">
              {t('palette.empty', { defaultValue: 'No matches.' })}
            </div>
          ) : (
            <PaletteSection items={filtered} active={active} setActive={setActive}
              busy={pendingAction !== null} onExecute={(action) => { void executeAction(action); }} />
          )}
        </div>
        {gamesLoading && !gamesData && !gamesError && (
          <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 border-t border-ui-border px-3 py-2 text-xs text-ui-mutedText">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-ui-primary motion-reduce:animate-none" />
            {t('palette.recentGamesLoading', { defaultValue: 'Loading recent games…' })}
          </div>
        )}
        {gamesError && (
          <div role="alert" aria-label={t('palette.recentGamesUnavailable', { defaultValue: 'Recent games unavailable' })}
            aria-busy={gamesFetching}
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-ui-border bg-ui-muted px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 text-ui-mutedText">
              {t('palette.recentGamesUnavailable', { defaultValue: 'Recent games unavailable' })}
            </span>
            <button type="button" disabled={gamesFetching} onClick={() => { void refetchGames(); }}
              className="min-h-11 rounded-lg px-3 font-semibold text-ui-foreground hover:bg-ui-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus disabled:cursor-wait disabled:opacity-60">
              {gamesFetching
                ? t('palette.recentGamesLoading', { defaultValue: 'Loading recent games…' })
                : t('palette.recentGamesRetry', { defaultValue: 'Retry recent games' })}
            </button>
          </div>
        )}
        {!gamesLoading && !gamesError && gamesData?.games.length === 0 && (
          <p className="shrink-0 border-t border-ui-border px-3 py-2 text-xs text-ui-mutedText">
            {t('palette.recentGamesEmpty', { defaultValue: 'No recent games yet.' })}
          </p>
        )}
        {pendingAction !== null && (
          <div role="status" aria-live="polite" className="shrink-0 border-t border-ui-border px-3 py-2 text-xs text-ui-mutedText">
            {t('palette.actionBusy', { defaultValue: 'Applying change…' })}
          </div>
        )}
        {actionError && (
          <div role="alert" className="shrink-0 border-t border-ui-border bg-ui-muted px-3 py-2 text-xs text-ui-danger">
            {actionError}
          </div>
        )}
        <div className="flex shrink-0 items-center justify-between border-t border-ui-border bg-ui-muted px-3 py-2 text-[11px] text-ui-mutedText">
          <div className="flex items-center gap-3">
            <span><kbd className="rounded border border-ui-border px-1">↑</kbd> <kbd className="rounded border border-ui-border px-1">↓</kbd> {t('palette.navigate', { defaultValue: 'navigate' })}</span>
            <span><kbd className="rounded border border-ui-border px-1">↵</kbd> {t('palette.select', { defaultValue: 'select' })}</span>
          </div>
          <span className="hidden sm:inline">{t('palette.tip', { defaultValue: '⌘K / Ctrl+K to open · ? for shortcuts' })}</span>
        </div>
      </div>
    </div>
  );
}

function PaletteSection({ items, active, setActive, busy, onExecute }: {
  items: Action[];
  active: number;
  setActive: (i: number) => void;
  busy: boolean;
  onExecute: (action: Action) => void;
}) {
  const { t } = useTranslation();
  const groups: Record<Action['group'], Action[]> = { nav: [], action: [], game: [] };
  for (const a of items) groups[a.group].push(a);
  const labels: Record<Action['group'], string> = { nav: t('palette.navGroup'), action: t('palette.actionGroup'), game: t('palette.gameGroup') };
  let runningIndex = 0;
  return (
    <>
      {(['nav', 'action', 'game'] as const).map((key) => {
        const list = groups[key];
        if (list.length === 0) return null;
        return (
          <div key={key} role="group" aria-label={labels[key]} className="mb-1">
            <div aria-hidden="true" className="px-3 pb-0.5 pt-2 text-[11px] uppercase tracking-wide text-ui-mutedText">{labels[key]}</div>
            {list.map((a) => {
              const i = runningIndex++;
              const isActive = i === active;
              return (
                <button
                  key={a.id}
                  data-i={i}
                  id={`patzer-palette-option-${i}`}
                  role="option"
                  aria-selected={isActive}
                  disabled={busy}
                  onMouseMove={() => setActive(i)}
                  onClick={() => onExecute(a)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-focus',
                    isActive ? 'bg-ui-pressed text-ui-foreground' : 'text-ui-foreground hover:bg-ui-hover',
                  )}
                >
                  <a.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-ui-mutedText" />
                  <span className="flex-1 truncate">{a.label}</span>
                  {a.hint && <span className="truncate text-xs text-ui-mutedText">{a.hint}</span>}
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
