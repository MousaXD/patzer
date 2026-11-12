// Tactic Trainer — solve puzzles extracted from your own analyzed games.
// The point: chess.com puzzles are generic. Patzer's are *yours* — every
// position is a real moment from your own play where you missed something.
// A second tab (?tab=puzzles) has general puzzles for when you've run out of
// your own, or have no analyzed games yet (components/TacticsPuzzles.tsx).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker, useSearchParams, type BlockerFunction } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Chess } from 'chess.js';
import { Target, RotateCcw, ArrowRight, Lightbulb, Check, X, Trophy, BookOpen, Zap, Eye, Loader2, Repeat } from 'lucide-react';
import BetaBadge from '../components/BetaBadge';
import TacticsPuzzles from '../components/TacticsPuzzles';
import ChessBoard from '../components/ChessBoard';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { localDay } from '../lib/openingTrainer';
import { positionAt, sanAt, type TacticsPuzzle } from '../lib/tactics';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { coachRequest, playedMoveArrow, type GamePuzzle as Puzzle } from '../lib/gamePuzzle';
import CoachPanel from '../components/CoachPanel';


interface Stats {
  total: number; solved: number; failed: number; accuracy: number; due: number;
  current_total?: number; current_solved?: number; current_accuracy?: number | null; outdated_attempts?: number;
}

export default function Train() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'puzzles' ? 'puzzles' : 'mine';
  const setTab = (next: 'mine' | 'puzzles') => setParams(next === 'puzzles' ? { tab: 'puzzles' } : {}, { replace: true });
  const tabClass = (active: boolean) => `tab-pill flex items-center gap-1.5 ${active ? 'is-active' : ''}`;

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-4">
      <div role="tablist" className="flex gap-1 border-b border-chesscom-200 dark:border-chesscom-700">
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')} className={tabClass(tab === 'mine')}>
          <Target className="h-4 w-4" /> {t('train.tabs.mine')}
        </button>
        <button role="tab" aria-selected={tab === 'puzzles'} onClick={() => setTab('puzzles')} className={tabClass(tab === 'puzzles')}>
          <Zap className="h-4 w-4" /> {t('train.tabs.puzzles')}
          <BetaBadge />
        </button>
      </div>
      {tab === 'puzzles' ? (
        <>
          <header>
            <h1 className="page-h1 flex items-center gap-2"><Zap className="h-6 w-6 text-gold-600" />{t('train.tabs.puzzles')}</h1>
            <p className="page-sub">{t('train.puzzles.intro')}</p>
          </header>
          <TacticsPuzzles
            daily={params.get('daily') === '1'}
            onLeaveDaily={() => setParams({ tab: 'puzzles' }, { replace: true })}
          />
          <footer className="pt-2 text-center text-xs text-chesscom-400">
            {t('train.puzzles.credit')}{' '}
            <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-chesscom-600 dark:hover:text-chesscom-200">database.lichess.org</a>
          </footer>
        </>
      ) : <FromYourGames onPuzzles={() => setTab('puzzles')} />}
    </div>
  );
}

function FromYourGames({ onPuzzles }: { onPuzzles: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [run, setRun] = useState(0);
  // Only suppress attempts the player explicitly chose to leave unsaved.
  // This is an account-scoped, in-memory queue filter, NOT saved progress.
  const [skipState, setSkipState] = useState<{ userId: number | null; keys: string[] }>({ userId: null, keys: [] });
  const skipped = skipState.userId === user?.id ? skipState.keys : [];
  const skipParam = skipped.join(',');
  const today = localDay();

  function leaveUnsaved(puzzle: Puzzle) {
    const key = `${puzzle.game_id}:${puzzle.ply}`;
    setSkipState((prev) => {
      const keys = prev.userId === user?.id ? prev.keys : [];
      return { userId: user?.id ?? null, keys: [...new Set([...keys, key])].slice(-200) };
    });
    setRun((r) => r + 1);
  }

  const { data, isLoading, isError, refetch } = useQuery({
    // A personal puzzle contains the player's private game position. Never
    // reuse it across accounts on a shared browser or after the day changes.
    queryKey: ['train-next', user?.id, today, run, skipParam],
    enabled: user?.id != null,
    queryFn: () => api.get<{ puzzle: Puzzle | null; due: number; awaiting_analysis?: number }>(
      `/api/train/next?today=${today}${skipParam ? `&skip=${encodeURIComponent(skipParam)}` : ''}`,
    ),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const { data: stats, isError: statsError, refetch: retryStats } = useQuery({
    queryKey: ['train-stats', user?.id, today],
    enabled: user?.id != null,
    queryFn: () => api.get<Stats>(`/api/train/stats?today=${today}`),
  });

  const puzzle = data?.puzzle ?? null;
  const header = (
    <header className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="page-h1 flex items-center gap-2"><Target className="h-6 w-6 text-board-dark" />{t('train.title', { defaultValue: 'Tactic Trainer' })}</h1>
        <p className="page-sub">{t('train.intro', { defaultValue: 'Personal puzzles drawn from your own analyzed games.' })}</p>
      </div>
      {stats && stats.total > 0 && (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-3 text-xs text-chesscom-500">
            <Stat label={t('train.mine.currentSolved', { defaultValue: 'Current solves' })}
              value={stats.current_solved ?? stats.solved} tone="text-board-dark" />
            <Stat label={t('train.mine.dueLabel')} value={stats.due} tone={stats.due > 0 ? 'text-gold-600' : undefined} />
            <Stat label={t('train.mine.solveRate', { defaultValue: 'Puzzle solve rate' })}
              value={(stats.current_total ?? stats.total) > 0
                ? `${stats.current_accuracy ?? stats.accuracy}%`
                : '—'} />
          </div>
          {(stats.outdated_attempts ?? 0) > 0 && (
            <p className="max-w-sm text-right text-[11px] leading-relaxed text-chesscom-600 dark:text-chesscom-300">
              {t('train.mine.historicalAttempts', {
                count: stats.outdated_attempts,
                defaultValue: '{{count}} previous practice attempts are kept in your history but no longer match current game analysis.',
              })}
            </p>
          )}
        </div>
      )}
      {statsError && (
        <div role="alert" className="flex items-center gap-2 text-xs text-chesscom-500">
          <span>{t('train.statsUnavailable', { defaultValue: 'Practice totals are unavailable.' })}</span>
          <button type="button" onClick={() => void retryStats()} className="underline underline-offset-2">{t('common.retry', { defaultValue: 'Retry' })}</button>
        </div>
      )}
    </header>
  );

  if (isLoading || user?.id == null) return <div role="status" className="card p-10 text-center text-sm text-chesscom-500">{t('common.loading')}</div>;

  if (isError || !data) return (
    <div className="mx-auto max-w-2xl space-y-4">
      {header}
      <div role="alert" className="card flex flex-col items-center gap-3 p-8 text-center">
        <div className="text-base font-semibold">{t('train.loadFailed', { defaultValue: 'Your personal puzzles could not be loaded' })}</div>
        <p className="max-w-md text-sm text-chesscom-500">{t('train.loadFailedDesc', { defaultValue: 'This is a loading problem, not a completed practice queue. Your games and earlier attempts are safe.' })}</p>
        <button type="button" onClick={() => void refetch()} className="btn-primary text-sm">{t('common.retry', { defaultValue: 'Retry' })}</button>
      </div>
    </div>
  );

  if (!puzzle) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        {header}
        <div className="card flex flex-col items-center gap-3 p-10 text-center">
          {skipped.length > 0
            ? <RotateCcw className="h-8 w-8 text-chesscom-500" aria-hidden="true" />
            : (data.awaiting_analysis ?? 0) > 0
              ? <BookOpen className="h-8 w-8 text-board-dark" aria-hidden="true" />
            : <Trophy className="h-8 w-8 text-gold-500" aria-hidden="true" />}
          <div className="text-base font-semibold">{skipped.length
            ? t('train.mine.sessionSkippedTitle', { defaultValue: 'No more unskipped puzzles in this session' })
            : (data.awaiting_analysis ?? 0) > 0
              ? t('train.mine.needsAnalysisTitle', { defaultValue: 'Your games have more lessons to uncover' })
            : t('train.allClear', { defaultValue: "Nothing to train — you're caught up." })}</div>
          <p className="max-w-md text-sm text-chesscom-600 dark:text-chesscom-300">{skipped.length
            ? t('train.mine.sessionSkippedDesc', {
              defaultValue: 'You chose to continue without recording {{count}} attempts. They are still available when you retry or return later.',
              count: skipped.length,
            })
            : (data.awaiting_analysis ?? 0) > 0
              ? t('train.mine.needsAnalysisDesc', {
                count: data.awaiting_analysis,
                defaultValue: '{{count}} saved games still need a current analysis before Patzer can find personal puzzles in them.',
              })
            : t('train.allClearDesc', { defaultValue: 'Play more games and analyze them to unlock new puzzles. Every blunder you fix here is a pattern you stop repeating in real games.' })}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {skipped.length > 0 && (
              <button type="button" onClick={() => { setSkipState({ userId: user?.id ?? null, keys: [] }); setRun((r) => r + 1); }} className="btn-primary text-sm">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('train.mine.retrySkipped', { defaultValue: 'Retry skipped puzzles' })}
              </button>
            )}
            {skipped.length === 0 && (data.awaiting_analysis ?? 0) > 0 && (
              <Link to="/review" className="btn-primary text-sm">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                {t('train.mine.analyzeGames', { defaultValue: 'Analyze your games' })}
              </Link>
            )}
            <button onClick={onPuzzles}
              className={`${skipped.length === 0 && (data.awaiting_analysis ?? 0) > 0 ? 'btn-secondary' : 'btn-primary'} text-sm`}>
              <Zap className="h-4 w-4" /> {t('train.tabs.puzzles')}
            </button>
            <Link to="/play" className="btn-secondary text-sm">{t('home.playTitle')}</Link>
            {(skipped.length > 0 || !(data.awaiting_analysis ?? 0)) && (
              <Link to="/review" className="btn-secondary text-sm">{t('review.title')}</Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl">
      {header}
      <OwnPuzzle key={`${user.id}:${puzzle.game_id}:${puzzle.ply}:${run}`} puzzle={puzzle}
        onNext={() => setRun((r) => r + 1)} onLeaveUnsaved={() => leaveUnsaved(puzzle)} />
    </div>
  );
}

// 'play': your move; 'checking': the engine looks at a move that isn't the
// line's; 'wrong': a wrong try, the board went back; 'solved': done;
// 'shown': "show me" plays the rest of the line.
type Status = 'play' | 'checking' | 'wrong' | 'solved' | 'shown';

interface AttemptResult { counted: boolean; done: boolean; due_on: string | null }
interface AttemptPayload {
  game_id: number; ply: number; source_revision: number; analysis_generation: number;
  solved: boolean; attempted_uci?: string; today: string;
}
type AttemptSaveState = 'idle' | 'pending' | 'saved' | 'error' | 'stale';

function isObsoletePuzzleError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 409;
}

function OwnPuzzle({ puzzle, onNext, onLeaveUnsaved }: { puzzle: Puzzle; onNext: () => void; onLeaveUnsaved: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  // The line in the shape of a Lichess puzzle, for the shared board helpers.
  const line = useMemo<TacticsPuzzle>(() => ({ id: '', fen: puzzle.fen, moves: puzzle.line, rating: 0, themes: [] }), [puzzle]);
  const ownMoves = Math.ceil(puzzle.line.length / 2);
  // How many moves of the line are on the board; yours are the even ones.
  const [n, setN] = useState(0);
  const [status, setStatus] = useState<Status>('play');
  // The first try: lost with the first wrong move or hint (sent once).
  const [clean, setClean] = useState(true);
  const [hint, setHint] = useState<'none' | 'piece' | 'move'>('none');
  const [boardKey, setBoardKey] = useState(0);
  // A different move the engine found just as good: where it left the board.
  const [alt, setAlt] = useState<{ san: string; fen: string; lastMove: [string, string] } | null>(null);
  // The move the engine is looking at stays on the board meanwhile.
  const [trying, setTrying] = useState<{ fen: string; lastMove: [string, string] } | null>(null);
  const [saveState, setSaveState] = useState<AttemptSaveState>('idle');
  // The first try is authoritative. A retry must resend that same attempt,
  // not overwrite a failed first move with a later corrected move.
  const attemptRef = useRef<AttemptPayload | null>(null);

  function persist(body: AttemptPayload) {
    setSaveState('pending');
    void api.post<AttemptResult>('/api/train/attempt', body)
      .then(() => {
        setSaveState('saved');
        void qc.invalidateQueries({ queryKey: ['train-stats', user?.id] });
      })
      .catch((error: unknown) => {
        if (isObsoletePuzzleError(error)) {
          setSaveState('stale');
          void qc.invalidateQueries({ queryKey: ['train-stats', user?.id] });
        } else setSaveState('error');
      });
  }

  const retrySave = () => {
    if (saveState !== 'error' || !attemptRef.current) return;
    persist(attemptRef.current);
  };

  const unsaved = saveState === 'pending' || saveState === 'error';
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (!unsaved || user?.id == null) return false;
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

  const pos = useMemo(() => positionAt(line, n), [line, n]);
  const done = n >= puzzle.line.length;
  const yourTurn = !done && saveState !== 'stale' && n % 2 === 0 && (status === 'play' || status === 'wrong');

  function send(solved: boolean, attempted?: string) {
    if (attemptRef.current) return;
    const body: AttemptPayload = {
      game_id: puzzle.game_id, ply: puzzle.ply,
      source_revision: puzzle.source_revision, analysis_generation: puzzle.analysis_generation,
      solved, attempted_uci: attempted, today: localDay(),
    };
    attemptRef.current = body;
    persist(body);
  }
  function lose(attempted?: string) {
    if (!clean) return;
    setClean(false);
    send(false, attempted);
  }
  function solve() {
    setStatus('solved');
    if (clean) send(true, puzzle.line[0]);
  }

  // The opponent's replies after a short pause — and, after "show me", yours.
  useEffect(() => {
    if (done || status === 'solved' || status === 'checking') return;
    if (n % 2 === 0 && status !== 'shown') return;
    const id = window.setTimeout(() => {
      soundForMove(inferMoveFlagsFromSan(sanAt(line, n)));
      setN(n + 1);
    }, status === 'shown' ? 700 : 450);
    return () => window.clearTimeout(id);
  }, [n, done, status, line]);

  function isLineMove(uci: string): boolean {
    const want = puzzle.line[n];
    if (!want) return false;
    if (uci === want) return true;
    // The board sends a promotion with its piece; a missing one means a queen.
    if (want.length === 5 && want.endsWith('q') && uci === want.slice(0, 4)) return true;
    // Any checkmate is right.
    const chess = new Chess(pos.fen);
    try {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    } catch {
      return false;
    }
    return chess.isCheckmate();
  }

  function wrong(uci: string) {
    setTrying(null);
    setBoardKey((k) => k + 1);
    setStatus('wrong');
    lose(n === 0 ? uci : undefined);
  }

  function onMove(uci: string) {
    if (!yourTurn) { setBoardKey((k) => k + 1); return; }
    if (isLineMove(uci)) {
      soundForMove(inferMoveFlagsFromSan(sanAt(line, n)));
      setHint('none');
      if (n + 1 >= puzzle.line.length) {
        setN(puzzle.line.length);
        solve();
      } else {
        setStatus('play');
        setN(n + 1);
      }
      return;
    }
    // Your move from the game is never the answer.
    if (n === 0 && uci === puzzle.played_uci) { wrong(uci); return; }
    // Not the line's move — maybe just as good: ask the engine.
    const chess = new Chess(pos.fen);
    let m;
    try {
      m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    } catch {
      wrong(uci);
      return;
    }
    const tried = { san: m.san, fen: chess.fen(), lastMove: [m.from, m.to] as [string, string] };
    setTrying(tried);
    setStatus('checking');
    api.post<{ ok: boolean }>('/api/train/check', {
      game_id: puzzle.game_id, ply: puzzle.ply,
      source_revision: puzzle.source_revision, analysis_generation: puzzle.analysis_generation,
      step: n, uci,
    })
      .then((r) => {
        if (!r.ok) { wrong(uci); return; }
        soundForMove(inferMoveFlagsFromSan(tried.san));
        setTrying(null);
        setAlt(tried);
        setHint('none');
        solve();
      })
      .catch((error: unknown) => {
        if (isObsoletePuzzleError(error)) {
          setTrying(null);
          setStatus('play');
          setBoardKey((k) => k + 1);
          setSaveState('stale');
          void qc.invalidateQueries({ queryKey: ['train-stats', user?.id] });
        } else wrong(uci);
      });
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

  const finished = status === 'solved' || (status === 'shown' && done);
  const shown = alt ?? trying;
  // The move you played in the game stays on the board as a red arrow while
  // the puzzle position is, so you don't have to work out which move it was.
  const played = playedMoveArrow(puzzle, n === 0 && !shown);

  const arrows = useMemo(() => {
    const own = played ? [played] : [];
    if (!yourTurn || hint === 'none') return own;
    const uci = puzzle.line[n]!;
    return [...own, hint === 'piece'
      ? { orig: uci.slice(0, 2), brush: 'paleBlue' }
      : { orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'paleBlue' }];
  }, [played, yourTurn, hint, puzzle, n]);

  const { data: coach } = useQuery({
    queryKey: ['coach-status'],
    queryFn: () => api.get<{ configured: boolean }>('/api/coach/status'),
    staleTime: 5 * 60_000,
  });
  const boardFen = shown?.fen ?? pos.fen;
  const lastMove = shown?.lastMove ?? pos.lastMove;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className={`mx-auto w-full min-w-0 lg:flex-1 lg:max-w-[640px] board-theme-${user?.profile.board_theme ?? 'green'}`}>
        <div className="mb-2 flex items-center justify-between rounded-md bg-white px-3 py-2 text-xs shadow-soft dark:bg-chesscom-800">
          <span className="font-medium text-chesscom-700 dark:text-chesscom-200">
            {puzzle.side_to_move === 'white' ? t('train.whiteToMove', { defaultValue: 'White to move' }) : t('train.blackToMove', { defaultValue: 'Black to move' })}
          </span>
          <span className="font-mono text-xs tabular-nums text-chesscom-500">
            {t('train.fromYourGame', { defaultValue: 'From your game · {{w}} vs {{b}}', w: puzzle.white, b: puzzle.black })}
          </span>
        </div>
        <ChessBoard
          fen={boardFen}
          orientation={puzzle.side_to_move}
          turnColor={pos.turn}
          movable={yourTurn}
          onMove={onMove}
          lastMove={lastMove as never}
          arrows={arrows as never}
          resetKey={boardKey}
        />
      </div>

      <aside className="min-w-0 space-y-3 lg:w-[340px] lg:shrink-0">
        <div className="card p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-wider text-chesscom-500">{t('train.taskTitle', { defaultValue: 'Find the move you missed' })}</div>
            {puzzle.review && <span className="badge bg-gold-500/15 text-gold-700 dark:text-gold-400"><Repeat className="h-3 w-3" /> {t('train.mine.review')}</span>}
          </div>
          <div className="mt-1 text-sm text-chesscom-700 dark:text-chesscom-200">
            {t('train.taskBody', { defaultValue: 'In the actual game you played {{played}}. Find a stronger move.', played: puzzle.played_san })}
            {ownMoves > 1 && <> {t('train.mine.moves', { count: ownMoves })}</>}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs text-chesscom-500">
            {/* The colour of the board's red arrow (chessground's `red` brush). */}
            <span aria-hidden="true" className="h-1 w-5 shrink-0 rounded bg-[#882020]" />
            {t('train.mine.playedArrow', { played: puzzle.played_san })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-chesscom-500">
            <span className={`badge ${tagTone(puzzle.classification)}`}>{puzzle.classification}</span>
            {puzzle.centipawn_loss > 0 && <span>−{(puzzle.centipawn_loss / 100).toFixed(1)} pawn equivalent</span>}
          </div>
        </div>

        <div className={`card p-4 ${status === 'wrong' ? 'border-move-mistake bg-move-mistake/5' : finished && status === 'solved' ? 'border-board-dark bg-board-dark/5' : ''}`}>
          {status === 'play' && (
            <div className="text-sm font-semibold text-chesscom-900 dark:text-chesscom-100">
              {n === 0 ? t('train.mine.yourMove') : t('train.mine.goOn')}
            </div>
          )}
          {status === 'checking' && (
            <div className="flex items-center gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <Loader2 className="h-4 w-4 animate-spin text-chesscom-400" /> {t('train.mine.checking')}
            </div>
          )}
          {status === 'wrong' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <X className="mt-0.5 h-4 w-4 shrink-0 text-move-mistake" /> <span>{t('train.puzzles.wrong')}</span>
            </div>
          )}
          {status === 'solved' && (
            <div className="space-y-1">
              <div className="flex items-start gap-2 text-sm font-semibold">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-board-dark" />
                {alt ? t('train.mine.alsoGood', { best: puzzle.line_san[n] ?? puzzle.best_san }) : t('train.correct', { defaultValue: 'Correct!' })}
              </div>
              {clean && puzzle.review && saveState === 'saved' && <div className="text-xs text-chesscom-500">{t('train.mine.learned')}</div>}
            </div>
          )}
          {status === 'shown' && (
            <div className="flex items-start gap-2 text-sm text-chesscom-700 dark:text-chesscom-200">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" /> {done ? t('train.puzzles.shownDone') : t('train.puzzles.showing')}
            </div>
          )}
          {!clean && saveState === 'saved' && (finished || status === 'wrong') && (
            <div className="mt-1 text-xs text-chesscom-500">{t('train.mine.comesBack')}</div>
          )}

          {saveState === 'pending' && (
            <div role="status" className="mt-3 flex items-center gap-2 text-xs text-chesscom-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('train.mine.savingAttempt', { defaultValue: 'Saving your practice result…' })}
            </div>
          )}
          {saveState === 'error' && (
            <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-move-mistake/40 bg-move-mistake/5 p-3 text-xs">
              <span className="text-chesscom-700 dark:text-chesscom-200">
                {t('train.mine.saveFailed', { defaultValue: 'Your first attempt was not saved. Retry before moving on, or it may appear again.' })}
              </span>
              <button type="button" onClick={retrySave} className="btn-secondary min-h-10 text-xs">
                {t('train.mine.retrySave', { defaultValue: 'Retry saving' })}
              </button>
            </div>
          )}
          {saveState === 'stale' && (
            <div role="alert" className="mt-3 space-y-2 rounded-md border border-gold-500/40 bg-gold-500/5 p-3 text-xs">
              <p className="text-chesscom-700 dark:text-chesscom-200">
                {t('train.mine.puzzleChanged', { defaultValue: 'This game was updated while you practiced. Your attempt was not recorded for the new position.' })}
              </p>
              <button type="button" onClick={onNext} className="btn-primary min-h-10 text-xs">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {t('train.mine.loadUpdated', { defaultValue: 'Load updated puzzle' })}
              </button>
            </div>
          )}

          {finished && (
            <div className="mt-2 text-xs text-chesscom-500">
              {t('train.mine.solution')} <span className="font-mono">{puzzle.line_san.join(' ')}</span>
            </div>
          )}

          {!finished && saveState !== 'stale' && status !== 'shown' && status !== 'checking' && (
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
                <button onClick={() => { setN(0); setStatus('play'); setBoardKey((k) => k + 1); }} className="btn-secondary flex-1 text-sm">
                  <RotateCcw className="h-4 w-4" /> {t('train.puzzles.tryIt')}
                </button>
              )}
              <button onClick={onNext} disabled={(!done && !alt) || unsaved || saveState === 'stale'} className="btn-primary flex-1 text-sm">
                {t('train.nextPuzzle', { defaultValue: 'Next puzzle' })} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
          {finished && saveState === 'error' && (
            <button type="button" onClick={onLeaveUnsaved} className="mt-2 min-h-10 w-full text-xs text-chesscom-600 underline underline-offset-2 dark:text-chesscom-300">
              {t('train.mine.continueUnsaved', { defaultValue: 'Continue without saving (this puzzle may repeat)' })}
            </button>
          )}
        </div>

        {/* Once it's over (never before — it would give the answer away): the
            coach on why the engine's move beats the one you played. */}
        {finished && (
          <div className="card p-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-chesscom-500">
              {t('train.mine.coachTitle', { best: puzzle.best_san, played: puzzle.played_san })}
            </div>
            <CoachPanel
              systemConfigured={coach?.configured ?? false}
              request={() => coachRequest(puzzle)}
              autoPlay
              triggerKey={`${puzzle.game_id}:${puzzle.ply}`}
              compact
            />
          </div>
        )}

        <Link to={`/review/${puzzle.game_id}?ply=${puzzle.ply}`} className="card-hover flex items-center gap-2 p-3 text-xs">
          <BookOpen className="h-4 w-4 text-chesscom-400" />
          <span className="text-chesscom-600 dark:text-chesscom-200">{t('train.openInReview', { defaultValue: 'Open this position in the full review' })}</span>
        </Link>
      </aside>
      {blocker.state === 'blocked' && (
        <div role="presentation" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" onClick={() => blocker.reset()}>
          <div role="alertdialog" aria-modal="true" aria-label={t('train.mine.unsavedTitle', { defaultValue: 'Your practice attempt is not saved yet' })}
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
            <h2 className="text-base font-semibold text-chesscom-900 dark:text-chesscom-100">
              {t('train.mine.unsavedTitle', { defaultValue: 'Your practice attempt is not saved yet' })}
            </h2>
            <p className="text-sm text-chesscom-600 dark:text-chesscom-300">
              {t('train.mine.unsavedDesc', { defaultValue: 'You can stay while it saves, retry a failed save, or leave without recording this attempt.' })}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" autoFocus onClick={() => blocker.reset()} className="btn-primary min-h-11 flex-1 text-sm">
                {t('train.mine.stay', { defaultValue: 'Stay here' })}
              </button>
              {saveState === 'error' && <button type="button" onClick={retrySave} className="btn-secondary min-h-11 flex-1 text-sm">
                {t('train.mine.retrySave', { defaultValue: 'Retry saving' })}
              </button>}
              <button type="button" onClick={() => blocker.proceed()} className="btn-secondary min-h-11 flex-1 text-sm">
                {t('train.mine.leaveUnsaved', { defaultValue: 'Leave without saving' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-chesscom-400">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone ?? 'text-chesscom-700 dark:text-chesscom-200'}`}>{value}</span>
    </div>
  );
}

function tagTone(c: string): string {
  if (c === 'blunder') return 'bg-mistake/15 text-mistake';
  if (c === 'mistake') return 'bg-gold-500/15 text-gold-700 dark:text-gold-400';
  if (c === 'miss') return 'bg-mistake/10 text-mistake';
  return 'bg-chesscom-100 text-chesscom-600 dark:bg-chesscom-700/40 dark:text-chesscom-300';
}
