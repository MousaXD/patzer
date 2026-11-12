// Train → Puzzles: tactic puzzles from the Lichess puzzle database (CC0) that
// ship with Patzer, picked close to your puzzle rating. Like on chess.com: the
// first try counts — a wrong move or a hint and the puzzle is lost for the
// rating, but you can still find the rest of the solution.
//
// With ?daily=1 (the Home card) it shows the puzzle of the day instead: the
// same puzzle all day, and a streak of the days in a row you did it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBlocker, type BlockerFunction } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Eye, Flame, Lightbulb, RotateCcw, Trophy, TrendingDown, TrendingUp, X, Zap } from 'lucide-react';
import ChessBoard from './ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { isRightMove, playerOf, positionAt, sanAt, type TacticsPuzzle } from '../lib/tactics';
import { localDay } from '../lib/openingTrainer';

interface Stats {
  rating: number;
  provisional: boolean;
  best: number;
  played: number;
  solved: number;
  recent: { solved: boolean; rating: number }[];
  total: number;
}
interface Attempt { rated: boolean; rating_before: number; rating_after: number; streak?: number }
interface Daily { day: string; puzzle: TacticsPuzzle | null; done: { solved: boolean } | null; streak: number }

const THEMES = ['mate', 'fork', 'pin', 'discovered', 'sacrifice', 'hanging', 'defence', 'endgame'] as const;
const STATS_KEY = ['tactics-stats'];
/** The Home card's query — refreshed once the puzzle of the day is done. */
const DAILY_KEY = ['tactics-daily'];

// 'play': your move; 'wrong': a wrong try, the board went back; 'solved': the
// line is done; 'shown': "show me" played the rest for you.
type Status = 'play' | 'wrong' | 'solved' | 'shown';
type AttemptSaveState = 'idle' | 'pending' | 'saved' | 'error';
interface AttemptBody { id: string; solved: boolean; daily?: string }

export default function TacticsPuzzles({ daily = false, onLeaveDaily }: { daily?: boolean; onLeaveDaily?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [theme, setTheme] = useState<string | null>(null);
  const [run, setRun] = useState(0);
  const [attemptBusy, setAttemptBusy] = useState(false);
  useEffect(() => { setAttemptBusy(false); }, [user?.id, daily, theme, run]);
  const todayKey = localDay();
  const { data: stats } = useQuery({
    queryKey: [...STATS_KEY, user?.id],
    enabled: user?.id != null,
    queryFn: () => api.get<Stats>('/api/tactics/stats'),
  });
  const { data: today, isLoading: dailyLoading, isError: dailyError, refetch: retryDaily } = useQuery({
    queryKey: ['tactics-daily-play', user?.id, todayKey, run],
    queryFn: () => api.get<Daily>(`/api/tactics/daily?today=${todayKey}`),
    enabled: daily && user?.id != null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const { data: next, isLoading, isError, refetch: retryNext } = useQuery({
    queryKey: ['tactics-next', user?.id, theme, run],
    queryFn: () => api.get<{ puzzle: TacticsPuzzle | null }>(`/api/tactics/next${theme ? `?theme=${theme}` : ''}`),
    enabled: !daily && user?.id != null,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = daily ? today : next;
  const loading = user?.id == null || (daily ? dailyLoading : isLoading);

  if (daily && dailyError) return (
    <div role="alert" className="card flex flex-col items-center gap-3 p-8 text-center">
      <p className="text-sm text-chesscom-600 dark:text-chesscom-200">{t('train.puzzles.loadError')}</p>
      <button type="button" onClick={() => void retryDaily()} className="btn-primary text-sm">{t('common.retry', { defaultValue: 'Retry' })}</button>
    </div>
  );

  if (daily && today) {
    return (
      <div className="space-y-3">
        <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">{t('train.puzzles.daily.title')}</div>
          <div className="flex items-center gap-3 text-xs text-chesscom-500">
            {today.streak > 0 && <span className="flex items-center gap-1"><Flame className="h-3.5 w-3.5 text-gold-600" />{t('home.dailyStreak', { count: today.streak })}</span>}
            <button onClick={onLeaveDaily} className="underline-offset-2 hover:underline">{t('train.puzzles.daily.more')}</button>
          </div>
        </div>
        {today.done && <div className="px-1 text-xs text-chesscom-500">{t('train.puzzles.daily.already')}</div>}
        {!today.puzzle && (
          <div className="card flex flex-col items-center gap-2 p-10 text-center">
            <Trophy className="h-8 w-8 text-gold-500" />
            <div className="text-base font-semibold">{t('train.puzzles.allDone')}</div>
          </div>
        )}
        {today.puzzle && (
          <Puzzle key={`${user?.id}:${today.puzzle.id}-${run}`} puzzle={today.puzzle} stats={stats ?? null} daily={today.day} onNext={() => onLeaveDaily?.()} onBusyChange={setAttemptBusy} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <ThemeChip active={theme === null} disabled={attemptBusy} onClick={() => { setTheme(null); setRun((r) => r + 1); }} label={t('train.puzzles.themes.all')} />
        {THEMES.map((th) => (
          <ThemeChip key={th} active={theme === th} disabled={attemptBusy} onClick={() => { setTheme(th); setRun((r) => r + 1); }} label={t(`train.puzzles.themes.${th}`)} />
        ))}
      </div>

      {loading && <div role="status" className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>}
      {!daily && isError && (
        <div role="alert" className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-chesscom-600 dark:text-chesscom-200">{t('train.puzzles.loadError')}</p>
          <button type="button" onClick={() => void retryNext()} className="btn-primary text-sm">{t('common.retry', { defaultValue: 'Retry' })}</button>
        </div>
      )}
      {data && !data.puzzle && (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Trophy className="h-8 w-8 text-gold-500" />
          <div className="text-base font-semibold">{t('train.puzzles.allDone')}</div>
          {theme && <button onClick={() => setTheme(null)} className="btn-secondary mt-2 text-sm">{t('train.puzzles.themes.all')}</button>}
        </div>
      )}
      {data?.puzzle && (
        <Puzzle key={`${user?.id}:${data.puzzle.id}-${run}`} puzzle={data.puzzle} stats={stats ?? null} onNext={() => setRun((r) => r + 1)} onBusyChange={setAttemptBusy} />
      )}
    </div>
  );
}

function ThemeChip({ active, onClick, label, disabled = false }: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'border-board-dark bg-board-dark/10 font-semibold text-chesscom-900 dark:text-chesscom-100'
          : 'border-chesscom-200 text-chesscom-600 hover:bg-chesscom-100 dark:border-chesscom-700 dark:text-chesscom-300 dark:hover:bg-chesscom-700/40'
      }`}
    >
      {label}
    </button>
  );
}

function Puzzle({ puzzle, stats, daily, onNext, onBusyChange }: { puzzle: TacticsPuzzle; stats: Stats | null; daily?: string; onNext: () => void; onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const player = playerOf(puzzle);
  // How many moves of the line are on the board. 0: the opponent's first
  // move is still to come.
  const [n, setN] = useState(0);
  const [status, setStatus] = useState<Status>('play');
  // The first try: lost with the first wrong move or hint (sent once).
  const [clean, setClean] = useState(true);
  const [hint, setHint] = useState<'none' | 'piece' | 'move'>('none');
  const [result, setResult] = useState<Attempt | null>(null);
  const [boardKey, setBoardKey] = useState(0);
  const [saveState, setSaveState] = useState<AttemptSaveState>('idle');
  const attemptRef = useRef<AttemptBody | null>(null);
  const leavingExplicitlyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; onBusyChange(false); };
  }, [onBusyChange]);

  const unsaved = saveState === 'pending' || saveState === 'error';
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (!unsaved || leavingExplicitlyRef.current || user?.id == null) return false;
    if (['/login', '/setup', '/signup', '/forgot-password', '/reset-password', '/verify-email'].includes(nextLocation.pathname)) return false;
    return currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search;
  }, [unsaved, user?.id]);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (saveState === 'saved' && blocker.state === 'blocked') blocker.proceed();
  }, [saveState, blocker]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  const pos = useMemo(() => positionAt(puzzle, n), [puzzle, n]);
  const done = n >= puzzle.moves.length;
  const yourTurn = !done && n % 2 === 1 && (status === 'play' || status === 'wrong');

  function persist(body: AttemptBody) {
    setSaveState('pending');
    onBusyChange(true);
    void api.post<Attempt>('/api/tactics/attempt', body)
      .then((r) => {
        if (!mountedRef.current) return;
        setResult(r);
        setSaveState('saved');
        onBusyChange(false);
        void qc.invalidateQueries({ queryKey: STATS_KEY });
        if (daily) void qc.invalidateQueries({ queryKey: DAILY_KEY });
      })
      .catch(() => { if (mountedRef.current) setSaveState('error'); });
  }
  function send(solved: boolean) {
    // The first try is the only rated one. Retry must resend that *same*
    // result, even if the player found the full line after a failed request.
    if (attemptRef.current) return;
    const body: AttemptBody = { id: puzzle.id, solved, ...(daily ? { daily } : {}) };
    attemptRef.current = body;
    persist(body);
  }
  function retrySave() {
    if (saveState === 'error' && attemptRef.current) persist(attemptRef.current);
  }
  function continueUnsaved() {
    leavingExplicitlyRef.current = true;
    onBusyChange(false);
    onNext();
  }
  function lose() {
    if (!clean) return;
    setClean(false);
    send(false);
  }

  // The opponent's moves (the first one, and each reply) after a short pause.
  useEffect(() => {
    if (done || n % 2 === 1 || status === 'solved') return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setN(n + 1);
    }, n === 0 ? 700 : 450);
    return () => window.clearTimeout(id);
  }, [n, done, status, puzzle]);

  // "Show me": play the rest of the line, one move at a time.
  useEffect(() => {
    if (status !== 'shown' || done || n % 2 === 0) return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setN(n + 1);
    }, 700);
    return () => window.clearTimeout(id);
  }, [status, n, done, puzzle]);

  function onMove(uci: string) {
    if (!yourTurn) { setBoardKey((k) => k + 1); return; }
    if (isRightMove(puzzle, n, uci)) {
      soundForMove(inferMoveFlagsFromSan(sanAt(puzzle, n)));
      setHint('none');
      setStatus('play');
      if (n + 1 >= puzzle.moves.length) {
        setN(puzzle.moves.length);
        setStatus('solved');
        if (clean) send(true);
      } else {
        setN(n + 1);
      }
      return;
    }
    setBoardKey((k) => k + 1);
    setStatus('wrong');
    lose();
  }

  function showHint() {
    lose();
    setHint(hint === 'none' ? 'piece' : 'move');
  }

  function showSolution() {
    lose();
    setHint('none');
    setStatus('shown');
  }

  const arrows = useMemo(() => {
    if (!yourTurn || hint === 'none') return [];
    const uci = puzzle.moves[n]!;
    return hint === 'piece'
      ? [{ orig: uci.slice(0, 2), brush: 'paleBlue' }]
      : [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'paleBlue' }];
  }, [yourTurn, hint, puzzle, n]);

  const finished = status === 'solved' || (status === 'shown' && done);
  const delta = result?.rated ? result.rating_after - result.rating_before : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full lg:max-w-[640px] lg:flex-1 board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <ChessBoard
          fen={pos.fen}
          orientation={player}
          turnColor={pos.turn}
          movable={yourTurn}
          onMove={onMove}
          lastMove={pos.lastMove as never}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="space-y-3 lg:w-[340px]">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('train.puzzles.yourRating')}</div>
            {stats && <div className="text-[11px] text-chesscom-400">{t('train.puzzles.solvedOf', { solved: stats.solved, played: stats.played })}</div>}
          </div>
          <div className="mt-1 flex items-end gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-chesscom-900 dark:text-chesscom-100">
              {result?.rated ? result.rating_after : stats?.rating ?? '—'}{stats?.provisional && '?'}
            </span>
            {delta !== null && (
              <span className={`mb-1 flex items-center gap-0.5 font-mono text-sm font-semibold ${delta >= 0 ? 'text-board-dark' : 'text-move-mistake'}`}>
                {delta >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {delta >= 0 ? `+${delta}` : delta}
              </span>
            )}
          </div>
          {stats?.provisional && <div className="mt-1 text-[11px] text-chesscom-400">{t('train.puzzles.provisional')}</div>}
        </div>

        <div className={`card p-4 ${status === 'wrong' ? 'border-move-mistake bg-move-mistake/5' : finished && status === 'solved' ? 'border-board-dark bg-board-dark/5' : ''}`}>
          {!finished && status !== 'wrong' && (
            <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {n === 0 ? t('train.puzzles.watch') : player === 'white' ? t('train.puzzles.findWhite') : t('train.puzzles.findBlack')}
            </div>
          )}
          {status === 'wrong' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" /> <span>{t('train.puzzles.wrong')}</span>
            </div>
          )}
          {finished && status === 'solved' && (
            <div className="flex items-start gap-2 text-sm font-semibold">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" /> {clean || saveState !== 'saved' ? t('train.puzzles.solved') : t('train.puzzles.solvedLate')}
            </div>
          )}
          {status === 'shown' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" /> {done ? t('train.puzzles.shownDone') : t('train.puzzles.showing')}
            </div>
          )}
          {!clean && saveState === 'saved' && !finished && status !== 'shown' && <div className="mt-1 text-xs text-chesscom-500">{t('train.puzzles.notRated')}</div>}
          {daily && finished && result?.streak !== undefined && result.streak > 0 && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-gold-700 dark:text-gold-400">
              <Flame className="h-3.5 w-3.5" /> {t('home.dailyStreak', { count: result.streak })}
            </div>
          )}

          {saveState === 'pending' && (
            <div role="status" className="mt-3 flex items-center gap-2 text-xs text-chesscom-500">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-chesscom-300 border-t-board-dark motion-reduce:animate-none" aria-hidden="true" />
              {t('train.puzzles.savingAttempt', { defaultValue: 'Saving your puzzle result…' })}
            </div>
          )}
          {saveState === 'error' && (
            <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-move-mistake/40 bg-move-mistake/5 p-3 text-xs">
              <span className="text-chesscom-700 dark:text-chesscom-200">
                {t('train.puzzles.saveFailed', { defaultValue: 'Your first puzzle attempt was not confirmed. Retry to record your rating and daily progress.' })}
              </span>
              <button type="button" onClick={retrySave} className="btn-secondary min-h-10 text-xs">
                {t('train.puzzles.retrySave', { defaultValue: 'Retry saving' })}
              </button>
            </div>
          )}

          {!finished && status !== 'shown' && n > 0 && (
            <div className="mt-3 flex gap-2">
              <button onClick={showHint} disabled={hint === 'move'} className="btn-secondary flex-1 text-sm">
                <Lightbulb className="h-4 w-4" /> {hint === 'none' ? t('train.puzzles.hint') : t('train.puzzles.hintMove')}
              </button>
              <button onClick={showSolution} className="btn-secondary flex-1 text-sm">
                <Eye className="h-4 w-4" /> {t('train.puzzles.solution')}
              </button>
            </div>
          )}
          {(finished || status === 'shown') && (
            <div className="mt-3 flex gap-2">
              {status === 'shown' && done && (
                <button onClick={() => { setN(1); setStatus('play'); setBoardKey((k) => k + 1); }} className="btn-secondary flex-1 text-sm">
                  <RotateCcw className="h-4 w-4" /> {t('train.puzzles.tryIt')}
                </button>
              )}
              <button onClick={onNext} disabled={!done || unsaved} className="btn-primary flex-1 text-sm">
                {daily ? t('train.puzzles.daily.more') : t('train.puzzles.next')} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {finished && saveState === 'error' && (
            <button type="button" onClick={continueUnsaved} className="mt-2 min-h-10 w-full text-xs text-chesscom-600 underline underline-offset-2 dark:text-chesscom-300">
              {t('train.puzzles.continueUnsaved', { defaultValue: 'Continue without saving (result may not count)' })}
            </button>
          )}
        </div>

        <div className="card flex items-center justify-between p-3 text-xs text-chesscom-500">
          <span className="flex items-center gap-1.5"><Zap className="h-3.5 w-3.5 text-gold-600" /> {t('train.puzzles.puzzleRating', { rating: puzzle.rating })}</span>
          {finished && (
            <a href={`https://lichess.org/training/${puzzle.id}`} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">
              {t('train.puzzles.onLichess')}
            </a>
          )}
        </div>
        {!finished && status !== 'shown' && <div className="px-1 text-[11px] leading-relaxed text-chesscom-400">{t('train.puzzles.rules')}</div>}
      </aside>
      {blocker.state === 'blocked' && (
        <div role="presentation" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" onClick={() => blocker.reset()}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="tactics-unsaved-title" aria-describedby="tactics-unsaved-description"
            className="card w-full max-w-md space-y-3 p-5 shadow-lift"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); blocker.reset(); }
              if (event.key === 'Tab') {
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
              }
              event.stopPropagation();
            }}>
            <h2 id="tactics-unsaved-title" className="text-base font-semibold text-chesscom-900 dark:text-chesscom-100">
              {t('train.puzzles.unsavedTitle', { defaultValue: 'Your puzzle attempt is not saved yet' })}
            </h2>
            <p id="tactics-unsaved-description" className="text-sm text-chesscom-600 dark:text-chesscom-300">
              {t('train.puzzles.unsavedDesc', { defaultValue: 'You can wait, retry saving, or leave before the result is confirmed.' })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" autoFocus onClick={() => blocker.reset()} className="btn-primary min-h-11 flex-1 text-sm">
                {t('train.puzzles.stay', { defaultValue: 'Stay here' })}
              </button>
              {saveState === 'error' && <button type="button" onClick={retrySave} className="btn-secondary min-h-11 flex-1 text-sm">
                {t('train.puzzles.retrySave', { defaultValue: 'Retry saving' })}
              </button>}
              <button type="button" onClick={() => blocker.proceed()} className="btn-secondary min-h-11 flex-1 text-sm">
                {t('train.puzzles.leaveUnsaved', { defaultValue: 'Leave without confirmation' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
