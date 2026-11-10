import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Trophy, Frown, Equal, BookOpen, Inbox, Settings as SettingsIcon, Star, Search, X, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { fmtAccuracy, fmtTimeControl } from '../lib/utils';
import { cn } from '../lib/utils';
import type { GameRow } from '../types';

type ImportSource = 'chesscom' | 'lichess';

// The platform branch supports stable offset pagination; keep the legacy
// cumulative-limit fallback until its API is integrated into main.
const PAGE_SIZE = 40;
const LEGACY_MAX_VISIBLE = 200;
const MAX_SEARCH_LENGTH = 120;
type GamePage = { games: GameRow[]; total: number; offset?: number; has_more?: boolean };
type PageRequest = { offset: number; limit: number };

function isOwnGameQuery(queryKey: readonly unknown[], accountId: number | undefined): boolean {
  return accountId != null && queryKey[0] === 'games' &&
    (queryKey[1] === 'home' || queryKey[1] === 'library') && queryKey[2] === accountId;
}

function updateBookmarkInCache(value: unknown, id: number, bookmarked: number): unknown {
  if (!value || typeof value !== 'object') return value;
  if ('pages' in value && Array.isArray(value.pages)) {
    return { ...value, pages: value.pages.map((page) => updateBookmarkInCache(page, id, bookmarked)) };
  }
  if ('games' in value && Array.isArray(value.games)) {
    return {
      ...value,
      games: (value.games as GameRow[]).map((game) => game.id === id ? { ...game, bookmarked } : game),
    };
  }
  return value;
}

export default function Review() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [importMsg, setImportMsg] = useState<{ text: string; error?: boolean } | null>(null);
  // Platform Backend validates the server-side query at 120 characters.
  // Bound both typed searches and hand-edited/deep-linked URLs consistently.
  const q = (searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH);
  const [searchDraft, setSearchDraft] = useState(q);
  const bookmarkedOnly = searchParams.get('bookmarked') === '1';

  // URL state survives navigating into a game and back; network search is
  // debounced while typing and covers the full library on the server.
  useEffect(() => { setSearchDraft(q); }, [q]);
  useEffect(() => {
    if (searchDraft.trim() === q) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (searchDraft.trim()) next.set('q', searchDraft.trim()); else next.delete('q');
      setSearchParams(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft, q, searchParams, setSearchParams]);

  const {
    data, isLoading, isFetching, isError, isFetchingNextPage,
    isFetchNextPageError, hasNextPage, fetchNextPage, refetch,
  } = useInfiniteQuery({
    // Never reuse another account's cached library after a logout/login.
    queryKey: ['games', 'library', user?.id, { bookmarkedOnly, q }],
    enabled: user?.id != null,
    initialPageParam: { offset: 0, limit: PAGE_SIZE } satisfies PageRequest,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageParam.limit) });
      if (pageParam.offset) params.set('offset', String(pageParam.offset));
      if (bookmarkedOnly) params.set('bookmarked', '1');
      if (q.trim()) params.set('q', q.trim());
      return api.get<GamePage>(`/api/games?${params.toString()}`);
    },
    getNextPageParam: (lastPage, _pages, lastRequest): PageRequest | undefined => {
      if (typeof lastPage.has_more === 'boolean') {
        if (!lastPage.has_more || lastPage.games.length === 0) return undefined;
        const nextOffset = (lastPage.offset ?? lastRequest.offset) + lastPage.games.length;
        return nextOffset <= 1_000_000 ? { offset: nextOffset, limit: PAGE_SIZE } : undefined;
      }
      // Older servers ignore offset and expose neither offset nor has_more.
      // Grow only the requested limit, never append duplicate pages or imply
      // that older results past the 200-record cap are accessible.
      if (lastRequest.limit >= LEGACY_MAX_VISIBLE ||
          lastPage.games.length < lastRequest.limit ||
          lastPage.games.length >= lastPage.total) return undefined;
      return { offset: 0, limit: Math.min(LEGACY_MAX_VISIBLE, lastRequest.limit + PAGE_SIZE) };
    },
  });

  const importMut = useMutation({
    mutationFn: (source: ImportSource) =>
      api.post<{ imported: number; total: number }>(`/api/games/import/${source}`, { limit: 20 }),
    onSuccess: (r) => {
      setImportMsg({ text: t('review.imported', { n: r.imported }) });
      qc.invalidateQueries({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, user?.id) });
      setTimeout(() => setImportMsg(null), 3000);
    },
    onError: (e) => {
      const code = (e as Error).message;
      setImportMsg({ text: t(`review.importError.${code}`, { defaultValue: t('review.importError.generic') }), error: true });
      setTimeout(() => setImportMsg(null), 6000);
    },
  });
  const sources: { source: ImportSource; username: string | null | undefined; label: string }[] = [
    { source: 'chesscom', username: user?.profile.chesscom_username, label: t('review.import') },
    { source: 'lichess', username: user?.profile.lichess_username, label: t('review.importLichess') },
  ];
  const linked = sources.filter((s) => s.username);

  const pages = data?.pages ?? [];
  const paginated = typeof pages[0]?.has_more === 'boolean';
  const lastPage = pages[pages.length - 1];
  const games = paginated
    ? [...new Map(pages.flatMap((page) => page.games).map((game) => [game.id, game])).values()]
    : (lastPage?.games ?? []);
  const total = lastPage?.total ?? 0;
  const initialError = isError && games.length === 0;

  function toggleBookmarkedOnly() {
    const next = new URLSearchParams(searchParams);
    if (bookmarkedOnly) next.delete('bookmarked'); else next.set('bookmarked', '1');
    setSearchParams(next);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1">{t('review.title')}</h1>
          <p className="page-sub">{t('review.subtitle', { defaultValue: 'Browse, analyze and learn from your games.' })}</p>
        </div>
        {linked.length > 0 ? (
          <div className="flex flex-wrap gap-2 self-start sm:self-auto">
            {linked.map((s) => (
              <button key={s.source} onClick={() => importMut.mutate(s.source)} disabled={importMut.isPending} className="btn-primary">
                <Download className="h-4 w-4" />
                {importMut.isPending && importMut.variables === s.source ? t('review.importing') : `${s.label} (@${s.username})`}
              </button>
            ))}
          </div>
        ) : (
          <Link to="/settings" className="btn-secondary text-sm">
            <SettingsIcon className="h-4 w-4" /> {t('review.setUsername', { defaultValue: 'Set Chess.com username' })}
          </Link>
        )}
      </header>

      {importMsg && (
        <div className={cn('rounded-md border px-4 py-2 text-sm', importMsg.error
          ? 'border-bad/30 bg-bad/10 text-bad'
          : 'border-board-dark/30 bg-board-dark/10 text-board-dark dark:text-chesscom-100')}>
          {importMsg.text}
        </div>
      )}

      {/* Filter bar — search + starred-only toggle. */}
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label={t('review.searchPlaceholder', { defaultValue: 'Search saved games' })}>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chesscom-400" />
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            type="search"
            maxLength={MAX_SEARCH_LENGTH}
            aria-label={t('review.searchPlaceholder', { defaultValue: 'Search players, opening, notes…' })}
            placeholder={t('review.searchPlaceholder', { defaultValue: 'Search players, opening, notes…' })}
            className="input pl-8 pr-8 text-sm"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={() => setSearchDraft('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-chesscom-400 hover:bg-chesscom-100 dark:hover:bg-chesscom-700"
              aria-label={t('review.clearSearch')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          onClick={toggleBookmarkedOnly}
          aria-pressed={bookmarkedOnly}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
            bookmarkedOnly
              ? 'border-gold-500 bg-gold-500/10 text-gold-700 dark:text-gold-400'
              : 'border-chesscom-200 bg-white text-chesscom-600 hover:bg-chesscom-50 dark:border-chesscom-700 dark:bg-chesscom-800 dark:text-chesscom-300',
          )}
          title={t('review.starredOnly', { defaultValue: 'Starred only' })}
        >
          <Star className={cn('h-3.5 w-3.5', bookmarkedOnly && 'fill-gold-500')} />
          {bookmarkedOnly ? t('review.starredFilterOn', { defaultValue: 'Starred only' }) : t('review.starredFilterOff', { defaultValue: 'All games' })}
        </button>
        <span className="text-xs text-chesscom-500" aria-live="polite" aria-atomic="true">
          {isLoading ? t('common.loading', { defaultValue: 'Loading games…' }) : initialError
            ? t('review.loadError', { defaultValue: 'Could not load games' })
            : `${games.length.toLocaleString()} of ${total.toLocaleString()} ${t('review.games', { defaultValue: 'games' })}`}
          {isFetching && !isLoading && <span className="sr-only"> · Updating</span>}
        </span>
      </div>

      {initialError && (
        <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 border-bad/30 p-4">
          <p className="text-sm text-bad">{t('review.loadError', { defaultValue: 'Your game library could not be loaded. Please try again.' })}</p>
          <button type="button" onClick={() => void refetch()} className="btn-secondary text-sm">
            <RefreshCw className="h-4 w-4" />{t('common.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      )}
      {isLoading && !initialError && (
        <div role="status" aria-label={t('common.loading', { defaultValue: 'Loading games' })} className="grid gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card flex h-16 animate-pulse items-center gap-3 p-3">
              <div className="h-10 w-10 rounded-lg bg-chesscom-200 dark:bg-chesscom-700" />
              <div className="flex-1 space-y-1">
                <div className="h-3 w-1/3 rounded bg-chesscom-200 dark:bg-chesscom-700" />
                <div className="h-2 w-1/4 rounded bg-chesscom-100 dark:bg-chesscom-800" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !initialError && games.length === 0 && (
        <div className="card flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-chesscom-100 text-chesscom-400 dark:bg-chesscom-800">
            <Inbox className="h-6 w-6" />
          </div>
          <div className="text-base font-semibold">
            {q ? t('review.noMatches', { defaultValue: 'No games match your search' }) : bookmarkedOnly ? t('review.noStarred', { defaultValue: 'No starred games yet' }) : t('review.noGames')}
          </div>
          {q ? (
            <button type="button" onClick={() => setSearchDraft('')} className="btn-secondary text-sm">
              {t('review.clearSearch', { defaultValue: 'Clear search' })}
            </button>
          ) : bookmarkedOnly ? (
            <button onClick={toggleBookmarkedOnly} className="btn-secondary text-sm">{t('review.showAll', { defaultValue: 'Show all games' })}</button>
          ) : (
            linked.length === 0 && (
              <Link to="/settings" className="btn-secondary text-sm">
                <SettingsIcon className="h-4 w-4" /> {t('review.noUsername')}
              </Link>
            )
          )}
        </div>
      )}

      {!isLoading && !initialError && games.length > 0 && (
        <div className="grid gap-2" aria-busy={isFetching}>
          {games.map((g) => <GameCard key={g.id} g={g} accountId={user?.id} />)}
        </div>
      )}
      {!isLoading && !initialError && isFetchNextPageError && (
        <div role="alert" className="card flex flex-wrap items-center justify-center gap-3 border-bad/30 p-3">
          <span className="text-sm text-bad">{t('review.moreFailed', { defaultValue: 'Could not load more games. Your loaded games are still available.' })}</span>
          <button type="button" className="btn-secondary text-sm" onClick={() => void fetchNextPage()}>
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      )}
      {!isLoading && !initialError && hasNextPage && !isFetchNextPageError && (
        <div className="flex justify-center">
          <button type="button" className="btn-secondary min-h-11 px-5 text-sm" disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}>
            {isFetchingNextPage ? t('common.loading', { defaultValue: 'Loading games…' }) : t('review.loadMore', { defaultValue: 'Load more games' })}
          </button>
        </div>
      )}
      {!isLoading && !initialError && !paginated && total > games.length && games.length >= LEGACY_MAX_VISIBLE && (
        <p className="text-center text-xs leading-relaxed text-chesscom-500 dark:text-chesscom-400">
          {t('review.searchOlderGames', { defaultValue: 'Showing the 200 most recent matches. Search by player, opening, or notes to find older games across your entire library.' })}
        </p>
      )}
    </div>
  );
}

function GameCard({ g, accountId }: { g: GameRow; accountId: number | undefined }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [bookmarkError, setBookmarkError] = useState(false);
  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${g.id}/bookmark`, { bookmarked: next }),
    onMutate: async (next: boolean) => {
      setBookmarkError(false);
      await qc.cancelQueries({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) });
      qc.setQueriesData({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) },
        (old) => updateBookmarkInCache(old, g.id, next ? 1 : 0));
    },
    onError: (_error, next) => {
      qc.setQueriesData({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) },
        (old) => updateBookmarkInCache(old, g.id, next ? 0 : 1));
      setBookmarkError(true);
    },
    onSettled: () => qc.invalidateQueries({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) }),
  });
  const isStarred = !!g.bookmarked;

  return (
    <div className="card-hover group relative flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
      <Link to={`/review/${g.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 sm:gap-4">
        <ResultIcon r={g.result} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={cn('truncate font-semibold', g.user_color === 'white' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{g.white}</span>
            <span className="text-chesscom-400">{t('players.vs')}</span>
            <span className={cn('truncate font-semibold', g.user_color === 'black' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{g.black}</span>
            <span className="text-xs text-chesscom-400">· {fmtTimeControl(g.time_control, t)}</span>
            {g.opening_name && <span className="hidden truncate text-xs text-chesscom-400 sm:inline">· {g.opening_name}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-chesscom-500">
            <span>{g.end_time ? new Date(g.end_time).toLocaleDateString() : t('review.inProgress', { defaultValue: 'In progress' })}</span>
            <span>·</span>
            <span>{t(`review.source.${g.source}`, { defaultValue: g.source })}</span>
            {!!g.from_position && <span className="rounded-full bg-chesscom-100 px-2 py-0.5 text-[11px] dark:bg-chesscom-800">{t('review.fromPosition')}</span>}
            {g.notes && <span className="ml-1 italic text-chesscom-400">· {t('review.hasNote')}</span>}
          </div>
        </div>
        {g.analyzed ? (
          <div className="text-right text-xs">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-400">{t('review.accuracy')}</div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_white)}</span>
              <span className="mx-1 text-chesscom-400">/</span>
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_black)}</span>
            </div>
          </div>
        ) : (
          <span className="badge gap-1 bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">
            <BookOpen className="h-3 w-3" /> review
          </span>
        )}
      </Link>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); star.mutate(!isStarred); }}
        title={isStarred ? t('review.unstar', { defaultValue: 'Remove bookmark' }) : t('review.star', { defaultValue: 'Bookmark game' })}
        aria-label={isStarred ? t('review.unstar', { defaultValue: 'Remove bookmark' }) : t('review.star', { defaultValue: 'Bookmark game' })}
        aria-pressed={isStarred}
        disabled={star.isPending || accountId == null}
        className={cn(
          'min-h-10 min-w-10 shrink-0 rounded-md p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          isStarred
            ? 'text-gold-500 hover:bg-gold-500/15'
            : 'text-chesscom-400 hover:bg-chesscom-100 hover:text-gold-500 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 dark:hover:bg-chesscom-700',
        )}
      >
        <Star className={cn('h-4 w-4', isStarred && 'fill-gold-500')} />
      </button>
      {bookmarkError && (
        <span role="alert" className="absolute bottom-0 right-12 rounded bg-cream px-2 text-xs text-bad dark:bg-chesscom-900">
          {t('review.bookmarkFailed', { defaultValue: 'Bookmark could not be saved. Try again.' })}
        </span>
      )}
    </div>
  );
}

function ResultIcon({ r }: { r: string }) {
  if (r === 'win') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-board-dark/15 text-board-dark"><Trophy className="h-4 w-4" /></div>;
  if (r === 'loss') return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mistake/15 text-mistake"><Frown className="h-4 w-4" /></div>;
  return <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300">
    {r === 'draw' ? <Equal className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
  </div>;
}
