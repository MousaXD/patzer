import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Upload, Trophy, Frown, Equal, BookOpen, Inbox, Settings as SettingsIcon, Star, Search, X, RefreshCw } from 'lucide-react';
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
const MAX_PGN_FILE_BYTES = 4 * 1024 * 1024;
const IMPORT_BATCH_SIZES = [20, 100, 200] as const;
const FILTER_OPTIONS = {
  source: [['', 'All sources'], ['chesscom', 'Chess.com'], ['lichess', 'Lichess'], ['played', 'Played'], ['pvp', 'Friends'], ['imported', 'PGN import']],
  time_class: [['', 'All speeds'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['daily', 'Daily']],
  result: [['', 'All results'], ['win', 'Wins'], ['draw', 'Draws'], ['loss', 'Losses']],
  analyzed: [['', 'Any status'], ['1', 'Analyzed'], ['0', 'Not analyzed']],
  sort: [['newest', 'Newest first'], ['oldest', 'Oldest first']],
} as const;
type FilterName = keyof typeof FILTER_OPTIONS;
function validFilter<K extends FilterName>(key: K, value: string | null): string {
  return FILTER_OPTIONS[key].some(([candidate]) => candidate === value)
    ? value! : FILTER_OPTIONS[key][0][0];
}
function validCalendarDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const year = Number(value.slice(0, 4));
  if (year < 1000 || year > 9998) return '';
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
}
type GamePage = { games: GameRow[]; total: number; offset?: number; has_more?: boolean; next_cursor?: string | null };
type OpeningSummary = {
  total: number;
  classified: number;
  unclassified: number;
  openings: { name: string; games: number }[];
};
type OpponentSummary = {
  total: number;
  identified: number;
  unidentified: number;
  opponents: { source: 'chesscom' | 'lichess'; name: string; games: number }[];
};
type ExploreMode = 'openings' | 'opponents';
type PageRequest = { offset: number; limit: number; cursor?: string };

function isOwnGameQuery(queryKey: readonly unknown[], accountId: number | undefined): boolean {
  return accountId != null && queryKey[0] === 'games' &&
    (queryKey[1] === 'home' || queryKey[1] === 'library') && queryKey[2] === accountId;
}

// Importing games also changes the player's history-derived statistics and
// achievements. Refresh them without touching another account's cached data.
function isOwnHistoryQuery(queryKey: readonly unknown[], accountId: number | undefined): boolean {
  if (accountId == null) return false;
  return isOwnGameQuery(queryKey, accountId) ||
    (queryKey[0] === 'games' && queryKey[1] === 'openings' && queryKey[2] === accountId) ||
    (queryKey[0] === 'games' && queryKey[1] === 'opponents' && queryKey[2] === accountId) ||
    (queryKey[0] === 'stats' && queryKey[1] === 'me' && queryKey[2] === accountId) ||
    (queryKey[0] === 'insights-v2' && queryKey[1] === accountId) ||
    ((queryKey[0] === 'achievements' || queryKey[0] === 'achievements-home' ||
      queryKey[0] === 'plan-home') && queryKey[1] === accountId);
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
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const accountIdRef = useRef(user?.id);
  accountIdRef.current = user?.id;
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [exploreMode, setExploreMode] = useState<ExploreMode>(searchParams.has('opponent') ? 'opponents' : 'openings');
  const [importMsg, setImportMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [importLimit, setImportLimit] = useState<(typeof IMPORT_BATCH_SIZES)[number]>(200);
  const [importPanelOpen, setImportPanelOpen] = useState(false);
  const [pgnFile, setPgnFile] = useState<File | null>(null);
  const pgnInputRef = useRef<HTMLInputElement | null>(null);
  const importMessageTimer = useRef<number | null>(null);
  useEffect(() => {
    // A previously signed-in account's import result must not remain visible
    // when another account begins using this browser.
    setImportMsg(null);
    setPgnFile(null);
    if (pgnInputRef.current) pgnInputRef.current.value = '';
    return () => {
      if (importMessageTimer.current != null) window.clearTimeout(importMessageTimer.current);
      importMessageTimer.current = null;
    };
  }, [user?.id]);

  function showImportResult(result: { text: string; error?: boolean }, durationMs: number) {
    if (importMessageTimer.current != null) window.clearTimeout(importMessageTimer.current);
    setImportMsg(result);
    importMessageTimer.current = window.setTimeout(() => {
      importMessageTimer.current = null;
      setImportMsg(null);
    }, durationMs);
  }
  // Platform Backend validates the server-side query at 120 characters.
  // Bound both typed searches and hand-edited/deep-linked URLs consistently.
  const q = (searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH);
  const [searchDraft, setSearchDraft] = useState(q);
  const bookmarkedOnly = searchParams.get('bookmarked') === '1';
  const filters = {
    source: validFilter('source', searchParams.get('source')),
    time_class: validFilter('time_class', searchParams.get('time_class')),
    result: validFilter('result', searchParams.get('result')),
    analyzed: validFilter('analyzed', searchParams.get('analyzed')),
    sort: validFilter('sort', searchParams.get('sort')),
  };
  const fromDate = validCalendarDate(searchParams.get('from_date'));
  const rawOpening = searchParams.get('opening') ?? '';
  const selectedOpening = rawOpening.trim() && rawOpening.length <= 200 ? rawOpening : '';
  const rawOpponent = searchParams.get('opponent') ?? '';
  const selectedOpponent = rawOpponent.trim().length >= 2 && rawOpponent.length <= 40 &&
    !/[\u0000-\u001f\u007f]/.test(rawOpponent) &&
    (filters.source === 'chesscom' || filters.source === 'lichess') ? rawOpponent : '';
  const requestedToDate = validCalendarDate(searchParams.get('to_date'));
  const toDate = fromDate && requestedToDate && fromDate > requestedToDate ? '' : requestedToDate;
  const filterSignature = [...Object.values(filters), fromDate, toDate, selectedOpening, selectedOpponent].join('|');
  const activeFilters = !!fromDate || !!toDate || !!selectedOpening || !!selectedOpponent ||
    Object.entries(filters).some(([key, value]) => value && !(key === 'sort' && value === 'newest'));

  function updateFilter(key: FilterName, value: string) {
    const next = new URLSearchParams(searchParams);
    if (!value || (key === 'sort' && value === 'newest')) next.delete(key);
    else next.set(key, value);
    // The opponent username belongs to a particular provider. Changing that
    // provider must never silently reapply the old username to a new source.
    if (key === 'source' && value !== filters.source) next.delete('opponent');
    setSearchParams(next);
  }
  function updateDateFilter(key: 'from_date' | 'to_date', input: string) {
    const value = validCalendarDate(input);
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    // Editing one boundary beyond the other clears the incompatible older
    // boundary rather than sending an invalid range to the server.
    const other = key === 'from_date' ? 'to_date' : 'from_date';
    const otherValue = validCalendarDate(next.get(other));
    if (value && otherValue &&
        (key === 'from_date' ? value > otherValue : value < otherValue)) next.delete(other);
    setSearchParams(next);
  }
  function clearLibraryFilters() {
    const next = new URLSearchParams(searchParams);
    for (const key of [...Object.keys(FILTER_OPTIONS), 'bookmarked', 'q', 'from_date', 'to_date', 'opening', 'opponent']) next.delete(key);
    setSearchDraft('');
    setSearchParams(next);
  }
  function clearLibrarySearch() {
    // The in-field X is a committed clear, unlike keystrokes that are debounced.
    // Preserve every other filter while removing the current server query now.
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    setSearchDraft('');
    setSearchParams(next, { replace: true });
    searchInputRef.current?.focus();
  }
  function browseOpening(name: string) {
    // The opening pill promises *all* games of that opening, not just games
    // matching stale date/search/source filters from a previous exploration.
    const next = new URLSearchParams();
    next.set('opening', name);
    if (filters.sort !== 'newest') next.set('sort', filters.sort);
    setSearchDraft('');
    setExploreMode('openings');
    setSearchParams(next);
  }
  function browseOpponent(source: 'chesscom' | 'lichess', name: string) {
    // Provider + username is the stable encounter key. Do not conflate a
    // Chess.com username with a Lichess account using the same spelling.
    const next = new URLSearchParams({source, opponent: name});
    if (filters.sort !== 'newest') next.set('sort', filters.sort);
    setSearchDraft('');
    setExploreMode('opponents');
    setSearchParams(next);
  }

  useEffect(() => {
    if (selectedOpponent) setExploreMode('opponents');
    else if (selectedOpening) setExploreMode('openings');
  }, [selectedOpponent, selectedOpening]);

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
    queryKey: ['games', 'library', user?.id, { bookmarkedOnly, q, filterSignature }],
    enabled: user?.id != null,
    initialPageParam: { offset: 0, limit: PAGE_SIZE } as PageRequest,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(pageParam.limit) });
      if (pageParam.cursor) params.set('cursor', pageParam.cursor);
      else if (pageParam.offset) params.set('offset', String(pageParam.offset));
      if (bookmarkedOnly) params.set('bookmarked', '1');
      if (q.trim()) params.set('q', q.trim());
      for (const [key, value] of Object.entries(filters)) {
        if (value && !(key === 'sort' && value === 'newest')) params.set(key, value);
      }
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      if (selectedOpening) params.set('opening', selectedOpening);
      if (selectedOpponent) params.set('opponent', selectedOpponent);
      return api.get<GamePage>(`/api/games?${params.toString()}`);
    },
    getNextPageParam: (lastPage, _pages, lastRequest): PageRequest | undefined => {
      if (typeof lastPage.has_more === 'boolean') {
        if (!lastPage.has_more || lastPage.games.length === 0) return undefined;
        // New servers issue a stable continuation cursor. Keep offset
        // compatibility with older deployments that omit next_cursor.
        if (typeof lastPage.next_cursor === 'string' && lastPage.next_cursor) {
          return {cursor:lastPage.next_cursor, offset:lastRequest.offset + lastPage.games.length,
            limit:PAGE_SIZE};
        }
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

  const {
    data: openingSummary,
    isError: openingSummaryError,
    isFetching: openingSummaryFetching,
    refetch: retryOpeningSummary,
  } = useQuery({
    queryKey: ['games', 'openings', user?.id],
    queryFn: async () => {
      const summary = await api.get<OpeningSummary>('/api/games/openings');
      // A partial/malformed API reply must not crash the working game list.
      // Treat it as a retryable discovery-only error instead.
      if (!summary || !Number.isFinite(summary.total) ||
          !Number.isFinite(summary.classified) || !Number.isFinite(summary.unclassified) ||
          !Array.isArray(summary.openings)) throw new Error('invalid_opening_summary');
      return summary;
    },
    enabled: user?.id != null,
    staleTime: 60_000,
    retry: false,
  });

  const {
    data: opponentSummary,
    isError: opponentSummaryError,
    isFetching: opponentSummaryFetching,
    refetch: retryOpponentSummary,
  } = useQuery({
    queryKey: ['games', 'opponents', user?.id],
    queryFn: async () => {
      const summary = await api.get<OpponentSummary>('/api/games/opponents');
      if (!summary || !Number.isFinite(summary.total) ||
          !Number.isFinite(summary.identified) || !Number.isFinite(summary.unidentified) ||
          !Array.isArray(summary.opponents)) throw new Error('invalid_opponent_summary');
      return summary;
    },
    enabled: user?.id != null && exploreMode === 'opponents',
    staleTime: 60_000,
    retry: false,
  });

  const importMut = useMutation({
    mutationFn: ({ source, limit }: { source: ImportSource; accountId: number; limit: number }) =>
      api.post<{ imported: number; total: number; skipped?: number; duplicates?: number; enriched?: number }>(`/api/games/import/${source}`, { limit }),
    onSuccess: (r, { accountId }) => {
      void qc.invalidateQueries({ predicate: ({ queryKey }) => isOwnHistoryQuery(queryKey, accountId) });
      if (accountIdRef.current !== accountId) return;
      // Keep each optional server count explicit while letting every locale
      // own its full sentence rather than concatenating English grammar.
      const sentences = [t('review.providerImportSaved', {
        imported:r.imported,total:r.total,
        defaultValue:`${r.imported} new games saved from ${r.total} retrieved.`,
      })];
      if (r.duplicates) sentences.push(t('review.providerImportDuplicates', {
        count:r.duplicates,defaultValue:`${r.duplicates} already saved.`,
      }));
      if (r.skipped) sentences.push(t('review.providerImportSkipped', {
        count:r.skipped,defaultValue:`${r.skipped} unsupported or invalid.`,
      }));
      if (r.enriched) sentences.push(t('review.providerImportEnriched', {
        count:r.enriched,defaultValue:`${r.enriched} existing games gained opening details.`,
      }));
      sentences.push(t('review.providerImportRecentOnly', {
        defaultValue:'This imports recent games only, not your entire history.',
      }));
      showImportResult({ text: sentences.join(' ') }, 9000);
    },
    onError: (e, { accountId }) => {
      if (accountIdRef.current !== accountId) return;
      const code = (e as Error).message;
      const guidance = code === 'linked_account_changed' || code === 'linked_account_mismatch'
        ? t('review.importError.linked_account_changed', { defaultValue: 'Your linked account changed during import. Check Settings and retry.' })
        : t(`review.importError.${code}`, { defaultValue: t('review.importError.generic') });
      showImportResult({ text: guidance, error: true }, 6000);
    },
  });
  const pgnMut = useMutation({
    mutationFn: async ({file, accountId}: {file: File; accountId: number}) => {
      if (accountIdRef.current !== accountId) throw new Error('account_changed');
      if (file.size > MAX_PGN_FILE_BYTES) throw new Error('pgn_too_large');
      if (!/\.(pgn|txt)$/i.test(file.name)) throw new Error('pgn_bad_file_type');
      // File.text() silently replaces malformed UTF-8 with U+FFFD. That can
      // change original player names and comments yet report a successful
      // archive import. Refuse undecodable bytes instead of corrupting PGNs.
      const bytes = await file.arrayBuffer();
      let pgn: string;
      try { pgn = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
      catch { throw new Error('pgn_bad_encoding'); }
      if (new TextEncoder().encode(pgn).byteLength > MAX_PGN_FILE_BYTES) throw new Error('pgn_too_large');
      // Reading a large local PGN is asynchronous. If the signed-in account
      // changed meanwhile, never submit the old account's selected file using
      // the new account's authentication cookie/session.
      if (accountIdRef.current !== accountId) throw new Error('account_changed');
      const summary = await api.post<{total:number;imported:number;duplicates:number}>(
        '/api/games/import/pgn', {pgn});
      // A malformed/partial HTTP success must never be announced as a
      // confirmed complete upload. The server import is idempotent, so the
      // user can safely retry even if some games were already committed.
      if (!summary || !Number.isSafeInteger(summary.total) ||
          !Number.isSafeInteger(summary.imported) ||
          !Number.isSafeInteger(summary.duplicates) ||
          summary.total < 1 || summary.total > 1000 ||
          summary.imported < 0 || summary.duplicates < 0 ||
          summary.imported + summary.duplicates !== summary.total) {
        throw new Error('pgn_invalid_summary');
      }
      return summary;
    },
    onSuccess: (result, {accountId}) => {
      void qc.invalidateQueries({predicate:({queryKey})=>isOwnHistoryQuery(queryKey, accountId)});
      if (accountIdRef.current !== accountId) return;
      showImportResult({text: t('review.pgnImportSuccess', {
        total:result.total, imported:result.imported, duplicates:result.duplicates,
        defaultValue:`${result.imported} new games saved from ${result.total} PGNs (${result.duplicates} already saved). No player identity or result was assumed.`,
      })}, 12_000);
      setPgnFile(null);
      if (pgnInputRef.current) pgnInputRef.current.value = '';
      // Undated PGNs sort after dated provider games. Show the imported
      // collection immediately instead of making users hunt at page 200+.
      setSearchDraft('');
      setSearchParams(new URLSearchParams({source:'imported'}));
    },
    onError: (error, {accountId}) => {
      const code = error instanceof Error ? error.message : 'generic';
      // The HTTP request may have committed games before an inconsistent
      // summary reached the client. Refresh only this owner's views without
      // claiming success or discarding the retryable source file.
      if (code === 'pgn_invalid_summary') {
        void qc.invalidateQueries({predicate:({queryKey})=>isOwnHistoryQuery(queryKey,accountId)});
      }
      if (accountIdRef.current !== accountId) return;
      const index = (error as {data?:{game_index?:unknown}})?.data?.game_index;
      const gameLabel = Number.isSafeInteger(index) && Number(index) > 0
        ? `${t('review.pgnGameIndex', {index, defaultValue:`Game ${index}`})}: ` : '';
      showImportResult({error:true,text:`${gameLabel}${t(`review.pgnError.${code}`, {
        defaultValue:t('review.pgnError.generic', {defaultValue:'Could not import the PGN file. Check the file and retry.'}),
      })}`}, 12_000);
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
  const firstUseEmpty = !isLoading && !initialError && games.length === 0 &&
    !q && !activeFilters && !bookmarkedOnly;
  const emptyFilteredResults = !isLoading && !initialError && games.length === 0 && !firstUseEmpty;
  const importControlsVisible = firstUseEmpty || importPanelOpen;

  function toggleBookmarkedOnly() {
    const next = new URLSearchParams(searchParams);
    if (bookmarkedOnly) next.delete('bookmarked'); else next.set('bookmarked', '1');
    setSearchParams(next);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-[calc(100vw-24px)] space-y-5 lg:max-w-5xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-h1">{t('review.title')}</h1>
          <p className="page-sub">{t('review.subtitle', { defaultValue: 'Browse, analyze and learn from your games.' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {linked.length === 0 && (total > 0 || !!q || activeFilters || bookmarkedOnly || initialError) && (
            <Link to="/settings" className="btn-secondary min-h-10 text-sm">
              <SettingsIcon className="h-4 w-4" /> {t('review.setUsername', { defaultValue: 'Set Chess.com username' })}
            </Link>
          )}
          {!firstUseEmpty && (
            <button type="button" className="btn-secondary min-h-10 text-sm"
              aria-controls="library-import-controls" aria-expanded={importControlsVisible}
              onClick={() => setImportPanelOpen((open) => !open)}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {importPanelOpen ? t('review.hideImportOptions', {defaultValue:'Hide import options'})
                : t('review.importMoreGames', {defaultValue:'Import more games'})}
            </button>
          )}
        </div>
      </header>

      <div id="library-import-controls" hidden={!importControlsVisible} className="space-y-5">
      {linked.length > 0 && (
        <section className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
          aria-labelledby="library-recent-import-title" aria-describedby="library-recent-import-help">
          <div className="min-w-0 sm:max-w-48">
            <h2 id="library-recent-import-title" className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {t('review.libraryRecentImportTitle', {defaultValue:'Import recent games'})}
            </h2>
            <p id="library-recent-import-help" className="text-xs leading-relaxed text-chesscom-500 dark:text-chesscom-300">
              {t('review.libraryRecentImportHelp', {defaultValue:'Choose a batch size; existing games are not overwritten.'})}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label htmlFor="library-import-limit" className="text-xs text-chesscom-500 dark:text-chesscom-300">
              {t('review.libraryRecentImportLimit', {defaultValue:'Recent games to fetch'})}
            </label>
            <select id="library-import-limit" aria-describedby="library-recent-import-help"
              className="input !min-h-11 w-auto text-sm" value={importLimit} disabled={importMut.isPending}
              onChange={(e) => setImportLimit(Number(e.target.value) as typeof importLimit)}>
              {IMPORT_BATCH_SIZES.map((limit) => <option key={limit} value={limit}>{limit}</option>)}
            </select>
            {linked.map((s) => (
              <button key={s.source} onClick={() => user && importMut.mutate({ source: s.source, accountId: user.id, limit: importLimit })} disabled={importMut.isPending || !user} className="btn-primary min-h-11">
                <Download aria-hidden="true" className="h-4 w-4" />
                {importMut.isPending && importMut.variables?.source === s.source ? t('review.importing') : `${s.label} (@${s.username})`}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card flex min-w-0 flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label={t('review.pgnImportHeading', {defaultValue:'Import a PGN file'})}>
        <div className="min-w-0 sm:max-w-64">
          <h2 className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
            {t('review.pgnImportHeading', {defaultValue:'Import a PGN file'})}
          </h2>
          <p id="library-pgn-help" className="text-xs leading-relaxed text-chesscom-500 dark:text-chesscom-300">
            {t('review.pgnImportHelp', {
              defaultValue:'Import up to 1,000 standard games from a .pgn or .txt file (4 MB max). Existing identical PGNs are not overwritten.',
            })}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <input id="library-pgn-file" ref={pgnInputRef} type="file" accept=".pgn,.txt,text/plain"
            aria-label={t('review.pgnChooseFile', {defaultValue:'Choose a PGN file'})}
            aria-describedby="library-pgn-help"
            className="input block w-full min-w-0 max-w-full text-xs sm:w-56"
            disabled={pgnMut.isPending}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0] ?? null;
              setPgnFile(file);
            }} />
          <button type="button" className="btn-primary min-h-10 shrink-0 text-sm"
            disabled={!pgnFile || pgnMut.isPending || !user}
            onClick={() => {if (pgnFile && user) pgnMut.mutate({file:pgnFile,accountId:user.id});}}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {pgnMut.isPending ? t('review.pgnImporting', {defaultValue:'Importing PGNs…'})
              : t('review.pgnImportButton', {defaultValue:'Import PGN file'})}
          </button>
        </div>
      </section>
      </div>

      {importMsg && (
        <div role={importMsg.error ? 'alert' : 'status'} className={cn('rounded-md border px-4 py-2 text-sm', importMsg.error
          ? 'border-bad/30 bg-bad/10 text-bad'
          : 'border-board-dark/30 bg-board-dark/10 text-ui-success')}>
          {importMsg.text}
        </div>
      )}

      {firstUseEmpty && (
        <section aria-labelledby="library-first-use-title" className="card flex flex-col items-center justify-center gap-3 p-5 text-center sm:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-800">
            <Inbox className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 id="library-first-use-title" className="text-base font-semibold">
            {t('review.firstUseTitle', {defaultValue:'Your game history starts here'})}
          </h2>
          <p className="max-w-lg text-sm leading-relaxed text-chesscom-500 dark:text-chesscom-300">
            {linked.length === 0
              ? t('review.firstUseUnlinked', {defaultValue:'Import a PGN from your computer or link Chess.com/Lichess to bring in recent games.'})
              : t('review.firstUseLinked', {defaultValue:'Import recent games above, or choose a PGN file from your computer.'})}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="btn-primary min-h-11 text-sm"
              onClick={() => pgnInputRef.current?.click()} disabled={pgnMut.isPending}>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t('review.firstUsePickPgn', {defaultValue:'Choose a PGN file to get started'})}
            </button>
            {linked.length === 0 && (
              <Link to="/settings" className="btn-secondary min-h-11 text-sm">
                <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                {t('review.firstUseConnect', {defaultValue:'Connect a chess account'})}
              </Link>
            )}
          </div>
        </section>
      )}

      {openingSummaryError && exploreMode === 'openings' && (
        <div role="alert" className="card flex flex-wrap items-center justify-between gap-3 border-bad/30 p-3 sm:p-4">
          <p className="text-sm text-bad">
            {t('review.libraryOpeningsLoadError', {
              defaultValue: 'Opening highlights could not be loaded. Your saved games are still available.',
            })}
          </p>
          <button type="button" className="btn-secondary min-h-10 text-sm"
            disabled={openingSummaryFetching} onClick={() => void retryOpeningSummary()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('review.libraryRetryOpenings', {defaultValue: 'Retry opening highlights'})}
          </button>
        </div>
      )}

      {(total > 0 || (openingSummary?.total ?? 0) > 0 || (opponentSummary?.total ?? 0) > 0) && (
        <section className="card space-y-3 p-3 sm:p-4" aria-labelledby="library-explore-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="library-explore-title" className="flex items-center gap-2 text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              <BookOpen className="h-4 w-4 text-chesscom-500" aria-hidden="true" />
              {t('review.libraryExplore', {defaultValue: 'Explore your game history'})}
            </h2>
            <div role="group" aria-label={t('review.libraryExploreBy', {defaultValue: 'Explore saved games by'})}
              className="inline-flex flex-wrap gap-1 rounded-lg border border-chesscom-200 p-1 dark:border-chesscom-700">
              {(['openings', 'opponents'] as ExploreMode[]).map((mode) => (
                <button type="button" key={mode} aria-pressed={exploreMode === mode}
                  className={cn('min-h-8 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                    exploreMode === mode ? 'bg-chesscom-100 text-chesscom-900 dark:bg-chesscom-700 dark:text-chesscom-100'
                      : 'text-chesscom-500 hover:bg-chesscom-50 dark:text-chesscom-300 dark:hover:bg-chesscom-800')}
                  onClick={() => setExploreMode(mode)}>
                  {mode === 'openings' ? t('review.libraryExploreOpenings', {defaultValue: 'Openings'})
                    : t('review.libraryExploreOpponents', {defaultValue: 'Opponents'})}
                </button>
              ))}
            </div>
          </div>

          {exploreMode === 'openings' ? (
            <>
              {openingSummary && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-chesscom-500 dark:text-chesscom-300">
                  <p>{t('review.libraryOpeningCoverage', {
                    classified: openingSummary.classified, total: openingSummary.total,
                    defaultValue: `${openingSummary.classified.toLocaleString()} of ${openingSummary.total.toLocaleString()} saved games have a recognized opening`,
                  })}</p>
                  {openingSummary.unclassified > 0 && <span>{t('review.libraryUnclassified', {
                    count: openingSummary.unclassified,
                    defaultValue: `${openingSummary.unclassified.toLocaleString()} not classified yet`,
                  })}</span>}
                </div>
              )}
              {openingSummary && Array.isArray(openingSummary.openings) && openingSummary.openings.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {openingSummary.openings.map(({name, games: count}) => (
                    <button key={name} type="button" onClick={() => browseOpening(name)}
                      aria-pressed={selectedOpening === name}
                      aria-label={t('review.libraryOpenOpening', {name, count, defaultValue: `Show ${count} saved games in ${name}`})}
                      className={cn('min-w-0 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                        selectedOpening === name
                          ? 'border-gold-500 bg-gold-500/10 text-chesscom-900 dark:text-chesscom-100'
                          : 'border-chesscom-200 bg-white hover:border-chesscom-400 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:border-chesscom-500')}>
                      <span className="block truncate text-xs font-semibold" title={name}>{name}</span>
                      <span className="mt-1 block text-xs text-chesscom-500 dark:text-chesscom-300">
                        {t('review.libraryOpeningGames', {count, defaultValue: `${count.toLocaleString()} games`})}
                      </span>
                    </button>
                  ))}
                </div>
              ) : openingSummary ? (
                <p className="text-xs text-chesscom-500 dark:text-chesscom-300">
                  {t('review.libraryOpeningEmpty', {defaultValue: 'Opening details will appear here as games are recognized during import or review.'})}
                </p>
              ) : !openingSummaryError && (
                <p role="status" className="text-xs text-chesscom-500 dark:text-chesscom-300">
                  {t('review.libraryLoadingOpenings', {defaultValue: 'Loading opening highlights…'})}
                </p>
              )}
            </>
          ) : opponentSummaryError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-bad">
              <span>{t('review.libraryOpponentsLoadError', {
                defaultValue: 'Your frequent opponents could not be loaded. Your saved games are still available.',
              })}</span>
              <button type="button" className="btn-secondary min-h-10 text-xs"
                disabled={opponentSummaryFetching} onClick={() => void retryOpponentSummary()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t('review.libraryRetryOpponents', {defaultValue: 'Retry opponents'})}
              </button>
            </div>
          ) : opponentSummary ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-chesscom-500 dark:text-chesscom-300">
                <p>{t('review.libraryOpponentCoverage', {
                  identified: opponentSummary.identified, total: opponentSummary.total,
                  defaultValue: `${opponentSummary.identified.toLocaleString()} of ${opponentSummary.total.toLocaleString()} imported online games have an identifiable opponent`,
                })}</p>
                {opponentSummary.unidentified > 0 && <span>{t('review.libraryOpponentUnknown', {
                  count: opponentSummary.unidentified,
                  defaultValue: `${opponentSummary.unidentified.toLocaleString()} without confirmed identity`,
                })}</span>}
              </div>
              {Array.isArray(opponentSummary.opponents) && opponentSummary.opponents.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {opponentSummary.opponents.map(({source, name, games: count}) => {
                    const provider = source === 'chesscom' ? 'Chess.com' : 'Lichess';
                    const active = selectedOpponent.trim().toLowerCase() === name.trim().toLowerCase() && filters.source === source;
                    return (
                      <button key={`${source}:${name.toLowerCase()}`} type="button" onClick={() => browseOpponent(source, name)}
                        aria-pressed={active}
                        aria-label={t('review.libraryOpenOpponent', {name, count, provider,
                          defaultValue: `Show ${count} ${provider} games against ${name}`})}
                        className={cn('min-w-0 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
                          active ? 'border-gold-500 bg-gold-500/10 text-chesscom-900 dark:text-chesscom-100'
                            : 'border-chesscom-200 bg-white hover:border-chesscom-400 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:border-chesscom-500')}>
                        <span className="block truncate text-xs font-semibold" title={name}>{name}</span>
                        <span className="mt-1 block text-xs leading-snug text-chesscom-500 dark:text-chesscom-300">
                          {t('review.libraryOpponentGames', {provider, count,
                            defaultValue: `${provider} · ${count.toLocaleString()} games`})}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-chesscom-500 dark:text-chesscom-300">
                  {t('review.libraryOpponentEmpty', {defaultValue: 'Import Chess.com or Lichess games to explore confirmed online opponents.'})}
                </p>
              )}
            </>
          ) : (
            <p role="status" className="text-xs text-chesscom-500 dark:text-chesscom-300">
              {t('review.libraryLoadingOpponents', {defaultValue: 'Loading frequent opponents…'})}
            </p>
          )}
        </section>
      )}

      {/* Filter bar — search + starred-only toggle. */}
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label={t('review.searchPlaceholder', { defaultValue: 'Search saved games' })}>
        <div className="relative min-w-[12rem] flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-chesscom-400" />
          <input
            ref={searchInputRef}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            type="search"
            maxLength={MAX_SEARCH_LENGTH}
            aria-label={t('review.searchPlaceholder', { defaultValue: 'Search players, opening, notes…' })}
            placeholder={t('review.searchPlaceholder', { defaultValue: 'Search players, opening, notes…' })}
            className="input !min-h-11 pl-8 pr-12 text-sm"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={clearLibrarySearch}
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-chesscom-500 hover:bg-chesscom-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:hover:bg-chesscom-700"
              aria-label={t('review.libraryClearSearch', {defaultValue: 'Clear search'})}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={toggleBookmarkedOnly}
          aria-pressed={bookmarkedOnly}
          className={cn(
            'inline-flex min-h-11 items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
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
            : t('review.libraryVisibleCount', {
              visible: games.length.toLocaleString(i18n?.language || 'en'),
              total: total.toLocaleString(i18n?.language || 'en'),
              defaultValue: `${games.length.toLocaleString()} of ${total.toLocaleString()} ${t('review.games', { defaultValue: 'games' })}`,
            })}
          {isFetching && !isLoading && <span className="sr-only"> · {t('review.libraryUpdating', {defaultValue:'Updating'})}</span>}
        </span>
      </div>

      {emptyFilteredResults && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4">
          <div className="flex min-w-0 items-center gap-2">
            <Inbox aria-hidden="true" className="h-5 w-5 shrink-0 text-chesscom-400" />
            <div role="status" className="min-w-0 text-sm font-semibold">
              {q || activeFilters
                ? t('review.noMatches', { defaultValue: 'No games match your search' })
                : t('review.noStarred', { defaultValue: 'No starred games yet' })}
            </div>
          </div>
          {q || activeFilters ? (
            <button type="button" onClick={clearLibraryFilters} className="btn-secondary min-h-11 text-sm">
              {t('review.clearLibraryFilters', { defaultValue: 'Clear filters' })}
            </button>
          ) : (
            <button type="button" onClick={toggleBookmarkedOnly} className="btn-secondary min-h-11 text-sm">
              {t('review.showAll', { defaultValue: 'Show all games' })}
            </button>
          )}
        </div>
      )}

      <div id="library-filters" role="group" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center"
        aria-label={t('review.libraryFilterGroup', { defaultValue: 'Filter and sort games' })}>
        {(Object.keys(FILTER_OPTIONS) as FilterName[]).map((key) => {
          const filterLabel = t(`review.libraryFilterLabel.${key}`, { defaultValue: {
            source: 'Game source', time_class: 'Game speed', result: 'Game result',
            analyzed: 'Review status', sort: 'Sort games',
          }[key] });
          return <label key={key} className="block min-w-0 text-xs text-chesscom-500 sm:w-auto">
            <span className="sr-only">{filterLabel}</span>
            <select aria-label={filterLabel}
              className="input !min-h-11 w-full min-w-0 text-xs sm:w-auto" value={filters[key]}
              onChange={(e) => updateFilter(key, e.target.value)}>
              {FILTER_OPTIONS[key].map(([value, label]) => <option key={value} value={value}>
                {t(`review.libraryFilterOptions.${key}.${value || 'all'}`, { defaultValue: label })}
              </option>)}
            </select>
          </label>;
        })}
        <div role="group" aria-label={t('review.dateRange', {defaultValue: 'Game date range'})} className="col-span-2 grid min-w-0 grid-cols-2 gap-2 sm:flex sm:items-center">
          <label className="block min-w-0 text-xs text-chesscom-500 dark:text-chesscom-300">
            <span className="mb-1 block">{t('review.fromDate', {defaultValue: 'From date'})}</span>
            <input aria-label={t('review.gamesFromDate', {defaultValue: 'Games from date'})} type="date" value={fromDate}
              max={toDate || undefined} onChange={(e) => updateDateFilter('from_date', e.target.value)}
              className="input !min-h-11 w-full min-w-0 text-xs sm:w-40" />
          </label>
          <label className="block min-w-0 text-xs text-chesscom-500 dark:text-chesscom-300">
            <span className="mb-1 block">{t('review.throughDate', {defaultValue: 'Through date'})}</span>
            <input aria-label={t('review.gamesThroughDate', {defaultValue: 'Games through date'})} type="date" value={toDate}
              min={fromDate || undefined} onChange={(e) => updateDateFilter('to_date', e.target.value)}
              className="input !min-h-11 w-full min-w-0 text-xs sm:w-40" />
          </label>
        </div>
        {(activeFilters || bookmarkedOnly || q) && !emptyFilteredResults && <button type="button" className="btn-secondary col-span-2 text-xs sm:w-auto"
          onClick={clearLibraryFilters}>{t('review.clearLibraryFilters', { defaultValue: 'Clear filters' })}</button>}
      </div>

      {selectedOpening && (
        <p className="text-xs text-chesscom-500 dark:text-chesscom-300" role="status">
          {t('review.libraryFilteredOpening', {name: selectedOpening, defaultValue: `Showing games in ${selectedOpening}`})}
        </p>
      )}
      {selectedOpponent && (
        <p className="text-xs text-chesscom-500 dark:text-chesscom-300" role="status">
          {t('review.libraryFilteredOpponent', {
            name: selectedOpponent, provider: filters.source === 'chesscom' ? 'Chess.com' : 'Lichess',
            defaultValue: `Showing ${filters.source === 'chesscom' ? 'Chess.com' : 'Lichess'} games against ${selectedOpponent}`,
          })}
        </p>
      )}

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

      {!isLoading && !initialError && games.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-2" aria-busy={isFetching}>
          {games.map((g) => <GameCard key={g.id} g={g} accountId={user?.id} starredOnly={bookmarkedOnly} />)}
        </div>
      )}
      {!isLoading && !initialError && isFetchNextPageError && (
        <div role="alert" className="card flex flex-wrap items-center justify-center gap-3 border-bad/30 p-3">
          <span className="text-sm text-bad">{t('review.moreFailed', { defaultValue: 'Could not load more games. Your loaded games are still available.' })}</span>
          <button type="button" className="btn-secondary min-h-11 shrink-0 text-sm" onClick={() => void fetchNextPage()}>
            {t('review.retryMore', { defaultValue: 'Retry' })}
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

function GameCard({ g, accountId, starredOnly }: { g: GameRow; accountId: number | undefined; starredOnly: boolean }) {
  const { t, i18n } = useTranslation();
  // The same display identities must be announced by the Practice action:
  // imported PGNs can have missing or whitespace-only White/Black headers.
  const unknownPlayer = t('review.unknownPlayer', {defaultValue:'Unknown player'});
  const whiteName = g.white?.trim() || unknownPlayer;
  const blackName = g.black?.trim() || unknownPlayer;
  const qc = useQueryClient();
  const [bookmarkError, setBookmarkError] = useState(false);
  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${g.id}/bookmark`, { bookmarked: next }),
    onMutate: async (next: boolean) => {
      setBookmarkError(false);
      await qc.cancelQueries({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) });
      // A pending removal in Starred only must not display an unstarred card
      // inside the filtered list. Keep it visible and starred until the
      // server confirms; that also preserves the card's retryable error UI.
      if (!(starredOnly && !next)) {
        qc.setQueriesData({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) },
          (old) => updateBookmarkInCache(old, g.id, next ? 1 : 0));
      }
    },
    onError: (_error, next) => {
      if (!(starredOnly && !next)) {
        qc.setQueriesData({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) },
          (old) => updateBookmarkInCache(old, g.id, next ? 0 : 1));
      }
      setBookmarkError(true);
    },
    onSettled: () => qc.invalidateQueries({ predicate: ({ queryKey }) => isOwnGameQuery(queryKey, accountId) }),
  });
  const isStarred = !!g.bookmarked;

  return (
    <div className="card-hover group relative flex flex-col items-stretch gap-2 p-3 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
      <Link to={`/review/${g.id}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 sm:items-center sm:gap-4">
        <ResultIcon r={g.result} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="inline-flex max-w-full min-w-0 items-baseline gap-x-2">
              <span title={g.white?.trim() || undefined} className={cn('min-w-0 font-semibold', g.white?.trim() ? 'truncate' : 'whitespace-normal break-words text-xs leading-snug', g.user_color === 'white' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{whiteName}</span>
              <span className="shrink-0 text-chesscom-400">{t('players.vs')}</span>
              <span title={g.black?.trim() || undefined} className={cn('min-w-0 font-semibold', g.black?.trim() ? 'truncate' : 'whitespace-normal break-words text-xs leading-snug', g.user_color === 'black' ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-700 dark:text-chesscom-200')}>{blackName}</span>
            </span>
            <span className="text-xs text-chesscom-400">· {fmtTimeControl(g.time_control, t)}</span>
            {g.opening_name && <span className="hidden truncate text-xs text-chesscom-400 sm:inline">· {g.opening_name}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-chesscom-500">
            <span>{g.end_time ? new Date(g.end_time).toLocaleDateString(i18n?.language || undefined)
              : g.source === 'imported' ? t('review.pgnUnknownDate', {defaultValue:'Date unavailable'})
                : t('review.inProgress', { defaultValue: 'In progress' })}</span>
            <span>·</span>
            <span>{t(`review.source.${g.source}`, { defaultValue: g.source })}</span>
            {!!g.from_position && <span className="rounded-full bg-chesscom-100 px-2 py-0.5 text-[11px] dark:bg-chesscom-800">{t('review.fromPosition')}</span>}
            {g.notes && <span className="ml-1 italic text-chesscom-400">· {t('review.hasNote')}</span>}
          </div>
          {g.opening_name && (
            <div className="mt-1 max-w-full truncate text-xs text-chesscom-500 dark:text-chesscom-300 sm:hidden"
              title={g.opening_name}>
              {g.opening_name}
            </div>
          )}
        </div>
        {g.analyzed ? (
          <div className="hidden shrink-0 text-right text-xs sm:block">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-400" title="Stockfish-based Patzer accuracy estimate; not Chess.com CAPS2.">{t('review.accuracy')} <span className="normal-case tracking-normal">· Patzer</span></div>
            <div className="font-mono text-sm font-semibold tabular-nums">
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_white)}</span>
              <span className="mx-1 text-chesscom-400">/</span>
              <span className="text-chesscom-700 dark:text-chesscom-200">{fmtAccuracy(g.accuracy_black)}</span>
            </div>
          </div>
        ) : (
          <span className="badge hidden shrink-0 gap-1 bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300 sm:inline-flex">
            <BookOpen aria-hidden="true" className="h-3 w-3" /> {t('review.analyze', { defaultValue: 'Analyze' })}
          </span>
        )}
      </Link>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-chesscom-200 pt-2 dark:border-chesscom-700 sm:contents sm:border-0 sm:pt-0">
        <span className="min-w-0 truncate text-xs text-chesscom-500 dark:text-chesscom-300 sm:hidden">
          {g.analyzed && g.user_color
            ? `${t('review.accuracy')}: ${fmtAccuracy(g.user_color === 'black' ? g.accuracy_black : g.accuracy_white)}`
            : g.analyzed ? t('review.analysisReady', { defaultValue: 'Analysis available' })
              : t('review.notAnalyzed', { defaultValue: 'Not reviewed yet' })}
        </span>
      {g.analyzed && g.end_time && g.result !== '*' && g.result !== 'ongoing' ? (
        <Link to={`/review/${g.id}?practice=1`}
          aria-label={t('practice.entryAria', { white: whiteName, black: blackName })}
          className="btn-secondary min-h-11 shrink-0 px-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 sm:px-3">
          {t('practice.entry')}
        </Link>
      ) : null}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); star.mutate(!isStarred); }}
        title={isStarred ? t('review.removeBookmark', { defaultValue: 'Remove bookmark' }) : t('review.bookmarkGame', { defaultValue: 'Bookmark game' })}
        aria-label={isStarred ? t('review.removeBookmark', { defaultValue: 'Remove bookmark' }) : t('review.bookmarkGame', { defaultValue: 'Bookmark game' })}
        aria-pressed={isStarred}
        disabled={star.isPending || accountId == null}
        className={cn(
          'min-h-11 min-w-11 shrink-0 rounded-md p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500',
          isStarred
            ? 'text-gold-500 hover:bg-gold-500/15'
            : 'text-chesscom-400 hover:bg-chesscom-100 hover:text-gold-500 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus:opacity-100 dark:hover:bg-chesscom-700',
        )}
      >
        <Star className={cn('h-4 w-4', isStarred && 'fill-gold-500')} />
      </button>
      {bookmarkError && (
        <span role="alert" className="basis-full rounded bg-cream px-2 py-1 text-xs leading-snug text-bad dark:bg-chesscom-900 sm:absolute sm:bottom-0 sm:right-12 sm:basis-auto sm:py-0">
          {t('review.bookmarkFailed', { defaultValue: 'Bookmark could not be saved. Try again.' })}
        </span>
      )}
      </div>
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
