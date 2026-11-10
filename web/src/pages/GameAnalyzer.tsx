import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Sparkles, Settings as SettingsIcon, Copy, Download, Check, ListOrdered, FileText, X, Star, Share2, FlipVertical2, NotebookPen, Search, Loader2 } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import { visibleEngineLines, bestMoveForDisplayedBoard, reviewVariationScoringRequest, reviewVariationScoringKey, verifiedPositionEngineLines } from '../components/review/reviewPosition';
import { postReviewAnalysis } from '../components/review/reviewAnalysisRequest';
import { moveSideForPly } from '../components/review/moveHistoryModel';
import { decodeStoredReviewJson, needsFreshReviewAnalysis } from '../components/review/storedReview';
import { parseReviewGamePositions } from '../components/review/reviewGamePositions';
import { buildSavedReviewTimeline } from '../components/review/reviewTimeline';
import { reconcileReviewNotesDraft } from '../components/review/reviewNotes';
import { reviewAnalysisErrorMessage } from '../components/review/reviewAnalysisErrors';
import { isCompleteReviewPayload } from '../components/review/reviewStream';
import MoveList from '../components/MoveList';
import CoachPanel from '../components/CoachPanel';
import GameReportCard, { type MovePick } from '../components/GameReportCard';
import MoveExplanation from '../components/MoveExplanation';
import GameReportPanel, { type GameReviewProse } from '../components/GameReportPanel';
import KeyMomentsList from '../components/KeyMomentsList';
import OpeningBanner from '../components/OpeningBanner';
import ClassificationBadge from '../components/ClassificationBadge';
import CapturedPieces from '../components/CapturedPieces';
import ThreatPanel from '../components/ThreatPanel';
import ExplorerPanel from '../components/ExplorerPanel';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { useAnalysisVariations } from '../lib/useAnalysisVariations';
import { legalAnalysisMove } from '../lib/analysisVariations';
import { qualityMatchesPosition, type VariationMoveQuality } from '../lib/classification';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { parseFromPosition, playFromPosition, playFromUrl } from '../lib/fromPosition';
import type { AnalysisResult, AnalyzedMove } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null; eco?: string | null; opening_name?: string | null; bookmarked?: number | null; notes?: string | null; start_fen?: string | null };
  analysis: {
    depth: number; accuracy_white: number; accuracy_black: number;
    estimated_elo_white: number | null; estimated_elo_black: number | null;
    performance_white: number | null; performance_black: number | null;
    opening_eco: string | null; opening_name: string | null;
    key_moments_json: string | null;
    phase_split_json: string | null;
    moves_json: string;
  } | null;
  analysis_stale?: boolean;
}

interface EngineLine {
  uci: string;
  san: string;
  pv_san: string[];
  cp: number | null;
  mate: number | null;
  multipv: number;
}

function fmtCp(cp: number | null | undefined): string {
  if (cp == null) return '0.00';
  if (cp >= 9000) return '#';
  if (cp <= -9000) return '-#';
  const sign = cp > 0 ? '+' : cp < 0 ? '−' : '';
  return `${sign}${(Math.abs(cp) / 100).toFixed(2)}`;
}

type Tab = 'moves' | 'report' | 'moments';

/** Route parameter changes can reuse the same React element. Key the complete
 * review workspace so pending requests/state from game A cannot reappear in B.
 */
export default function GameAnalyzer() {
  const { id } = useParams<{ id: string }>();
  return <GameAnalyzerView key={id} />;
}

function GameAnalyzerView() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gameId = Number(id);

  const { data, refetch, isLoading, isError, error: loadError } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => api.get<GameDetail>(`/api/games/${gameId}`),
    enabled: Number.isSafeInteger(gameId) && gameId > 0,
  });

  const [analyzing, setAnalyzing] = useState(false);
  const analysisRequestRef = useRef<AbortController | null>(null);
  useEffect(() => () => analysisRequestRef.current?.abort(), []);
  const [analysisError, setAnalysisError] = useState('');
  // Bind the cached/local analysis to its game ID. Otherwise moving rapidly
  // between game routes can briefly display the previous opponent's analysis.
  const [analysisSnapshot, setAnalysisSnapshot] = useState<{ gameId: number; value: AnalysisResult | null }>({
    gameId, value: null,
  });
  const analysis = analysisSnapshot.gameId === gameId ? analysisSnapshot.value : null;
  const setAnalysis = useCallback((value: AnalysisResult | null) => {
    setAnalysisSnapshot({ gameId, value });
  }, [gameId]);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [requestedDepth, setRequestedDepth] = useState(16);
  const [showDepthControl, setShowDepthControl] = useState(false);
  const [reviewProse, setReviewProse] = useState<GameReviewProse | null>(null);
  const [tab, setTab] = useState<Tab>('moves');
  // A category picked in the Game Report table (e.g. Black's misses): those
  // moves stand out in the move list and the arrows below step through them.
  const [pick, setPick] = useState<MovePick | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // Local UI state for new features.
  const [flipped, setFlipped] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  // Replaying a PGN is work proportional to game length. Rebuild only when
  // its text changes (not when notes/bookmarks or cached analysis refresh).
  // A corrupted PGN is represented as an empty result, not a render-time throw.
  const positions = useMemo(
    () => data ? (parseReviewGamePositions(data.game.pgn) ?? []) : [],
    [data?.game.pgn],
  );
  const timeline = useMemo(
    () => buildSavedReviewTimeline(positions, analysis?.moves),
    [positions, analysis?.moves],
  );

  // Decode at most once per fetched analysis record, and use the same verdict
  // for both rendering and deciding whether a retry may safely use cache.
  const decodedStoredReview = useMemo(
    () => data?.analysis ? decodeStoredReviewJson(data.analysis, positions) : null,
    [data?.analysis, positions],
  );
  const cachedAnalysisInvalid = needsFreshReviewAnalysis(data?.analysis, decodedStoredReview);

  useEffect(() => {
    if (!data) return;
    if (data.analysis) {
      const a = data.analysis;
      const stored = decodedStoredReview;
      if (stored) {
        setAnalysis({
          depth: a.depth,
          accuracy_white: a.accuracy_white,
          accuracy_black: a.accuracy_black,
          estimated_elo_white: a.estimated_elo_white,
          estimated_elo_black: a.estimated_elo_black,
          performance_white: a.performance_white ?? null,
          performance_black: a.performance_black ?? null,
          opening_eco: a.opening_eco,
          opening_name: a.opening_name,
          ...stored,
        });
        setAnalysisError('');
        setRequestedDepth(Math.max(16, a.depth));
      } else {
        // A failed cached JSON decode must not crash the whole Game Review.
        // Keep the saved PGN and let the user explicitly rerun analysis.
        setAnalysis(null);
        setAnalysisError('Stored engine analysis could not be read. Run engine analysis again to restore this report.');
      }
    } else {
      setAnalysis(null);
      setAnalysisError('');
    }
    if (data.analysis_stale && !analyzing) {
      void analyze(16, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Load any cached AI prose for this game
  useEffect(() => {
    // A slower request for a previous game must never replace this game's
    // review text after navigating between library entries.
    let active = true;
    setReviewProse(null);
    if (Number.isSafeInteger(gameId) && gameId > 0) {
      api.get<{ review: GameReviewProse | null }>(`/api/games/${gameId}/review`)
        .then((r) => { if (active) setReviewProse(isCompleteReviewPayload(r) ? r.review : null); })
        .catch(() => { if (active) setReviewProse(null); });
    }
    return () => { active = false; };
  }, [gameId]);

  useEffect(() => {
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => setCoachConfigured(s.configured))
      .catch(() => setCoachConfigured(false));
  }, []);

  // Read initial ?ply= from the URL so deep-links to a specific position
  // open at that move on first render. After that we keep them in sync.
  const initialPly = (() => {
    const v = Number(searchParams.get('ply'));
    return Number.isFinite(v) && v >= 0 ? v : 0;
  })();
  // One source of truth for saved-game replay and local exploratory branches.
  // Branches are ephemeral: no game/PGN writes and no broken mainline state.
  const variations = useAnalysisVariations({ positions, initialPly, gameKey: `${gameId}:${data?.game.pgn ?? ''}` });
  const ply = variations.originalPly;
  const selectOriginalPly = variations.selectOriginalPly;
  const setPly = useCallback((value: number | ((previous: number) => number)) => {
    selectOriginalPly(typeof value === 'function' ? value(ply) : value);
  }, [selectOriginalPly, ply]);
  const isVariation = variations.activeVariationId !== null;
  const branchMove = isVariation ? variations.playedVariationMoves.at(-1) : undefined;
  const qualityKey = branchMove ? reviewVariationScoringKey(gameId, branchMove) : null;
  const [qualityCache, setQualityCache] = useState<Record<string, VariationMoveQuality>>({});
  const [qualityError, setQualityError] = useState('');
  const [qualityRetry, setQualityRetry] = useState(0);
  const variationQuality = qualityKey && qualityMatchesPosition(qualityCache[qualityKey], variations.currentFen)
    ? qualityCache[qualityKey] : null;
  const displayedPly = isVariation ? variations.basePly + variations.playedVariationMoves.length : ply;
  // A branch is an ephemeral sequence, not part of the saved game's PGN.
  // Share the exact displayed board in Lab, not a misleading original-game URL.
  const shareCurrentPosition = () => isVariation
    ? `${window.location.origin}/lab#${encodeURI(variations.currentFen)}`
    : window.location.href;
  const displayedLastMove = variations.lastMove;

  // Each exploratory move is classified by the existing authenticated engine
  // endpoint. A response for a deselected branch is cached but never rendered
  // against another FEN; failed/429 searches never invent a label.
  useEffect(() => {
    if (!qualityKey || !branchMove || qualityCache[qualityKey]) return;
    const controller = new AbortController();
    let cancelled = false;
    let retry: number | undefined;
    setQualityError('');
    const evaluate = async (attempt: number) => {
      try {
        const result = await postReviewAnalysis<{quality: VariationMoveQuality}>(
          '/api/analyze/variation-move', reviewVariationScoringRequest(branchMove), controller.signal,
        );
        if (!cancelled) {
          if (qualityMatchesPosition(result.quality, branchMove.fenAfter)) {
            setQualityCache((previous) => ({ ...previous, [qualityKey]: result.quality }));
          } else {
            setQualityError('The engine response did not match this position. Retry scoring.');
          }
        }
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        const status = (e as Error & {status?: number}).status;
        if (status === 429 && attempt === 0) {
          retry = window.setTimeout(() => void evaluate(1), 1100);
        } else {
          setQualityError('Move not scored — the Stockfish engine is unavailable or busy.');
        }
      }
    };
    const start = window.setTimeout(() => void evaluate(0), 250);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(start); if (retry) window.clearTimeout(retry); };
  // qualityKey and fen are the selection identity; avoid replaying a search
  // just because the controller produces a new view object on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityKey, variations.currentFen, qualityRetry]);
  useEffect(() => { setQualityCache({}); setQualityError(''); }, [gameId]);

  const onAnalysisMove = (uci: string) => {
    const move = legalAnalysisMove(variations.currentFen, uci);
    // A move matching the saved PGN advances originalPly, whose effect plays
    // the cue. Only free variations need their own sound here.
    const savedNext = !isVariation && positions[ply + 1]?.uci === move?.uci;
    if (variations.submitMove(uci) && move && !savedNext) soundForMove(inferMoveFlagsFromSan(move.san));
  };
  const backward = () => variations.stepBackward();
  const forward = () => variations.stepForward();
  const first = () => isVariation && variations.activeVariationId
    ? variations.selectVariation(variations.activeVariationId, 0) : setPly(0);
  const last = () => isVariation && variations.activeVariationId
    ? variations.selectVariation(variations.activeVariationId) : setPly(positions.length - 1);

  // Keep ?ply= in the URL so refresh + share work. Replace, don't push.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (ply > 0) next.set('ply', String(ply)); else next.delete('ply');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ply]);

  const prevPlyRef = useRef(ply);
  useEffect(() => {
    if (ply === prevPlyRef.current) return;
    if (ply > 0 && positions[ply]?.san) {
      const flags = inferMoveFlagsFromSan(positions[ply]!.san!);
      soundForMove(flags);
    }
    prevPlyRef.current = ply;
  }, [ply, positions]);

  // Attach the keyboard listener once. Moving a ply rerenders the review,
  // so closures captured in the listener must read the latest controller
  // rather than tearing down/re-attaching between rapid key events.
  const shortcutActions = useRef({ backward, forward, first, last, shareCurrentPosition });
  shortcutActions.current = { backward, forward, first, last, shareCurrentPosition };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target instanceof Element ? e.target : null;
      // Never hijack editing, focused sliders/menus, a tablist's arrow keys,
      // or a modal/command palette. Arrow/Home/End are native controls there.
      if (target?.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="slider"], [role="tablist"], [role="listbox"], [role="menu"]')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      const key = e.key;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End') {
        e.preventDefault();
        if (key === 'ArrowLeft') shortcutActions.current.backward();
        else if (key === 'ArrowRight') shortcutActions.current.forward();
        else if (key === 'Home') shortcutActions.current.first();
        else shortcutActions.current.last();
      } else if (!e.repeat && (key === 'f' || key === 'F')) {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (!e.repeat && (key === 's' || key === 'S')) {
        e.preventDefault();
        void navigator.clipboard?.writeText(shortcutActions.current.shareCurrentPosition()).then(() => {
          setLinkCopied(true);
          setTimeout(() => setLinkCopied(false), 1400);
        }).catch(() => undefined);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function analyze(depth: number, force = false) {
    if (analysisRequestRef.current || analyzing) return;
    const controller = new AbortController();
    analysisRequestRef.current = controller;
    setAnalyzing(true);
    setAnalysisError('');
    try {
      const r = await postReviewAnalysis<{ analysis: AnalysisResult; cached: boolean }>(
        '/api/analyze', { game_id: gameId, depth, force }, controller.signal,
      );
      if (controller.signal.aborted) return;
      setAnalysis(r.analysis);
      await refetch();
    } catch (error) {
      if (!controller.signal.aborted) setAnalysisError(reviewAnalysisErrorMessage(error));
    } finally {
      if (analysisRequestRef.current === controller) analysisRequestRef.current = null;
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  }

  // Top engine lines panel (multiPV) — fetched on demand, debounced when enabled.
  // These hooks live BEFORE the loading early-return below so hook order stays
  // stable across the loading → loaded transition (React error #310).
  const [linesEnabled, setLinesEnabled] = useState(false);
  const [lines, setLines] = useState<EngineLine[]>([]);
  const [linesFen, setLinesFen] = useState('');
  const [linesRetry, setLinesRetry] = useState(0);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState<'busy' | 'unavailable' | null>(null);
  const [linesHover, setLinesHover] = useState<EngineLine | null>(null);
  const [explorerHover, setExplorerHover] = useState<string | null>(null);
  const pos = data ? (positions[ply] ?? positions[0]) : undefined;
  const currentFen = variations.currentFen || pos?.fen || '';
  const freshLines = visibleEngineLines(lines, linesFen, currentFen);
  useEffect(() => {
    if (!linesEnabled || !currentFen) return;
    const controller = new AbortController();
    let cancelled = false;
    setLinesError(null);
    setLinesLoading(true);
    const handle = window.setTimeout(() => {
      postReviewAnalysis<{ fen: string; depth: number; lines: EngineLine[] }>(
        '/api/analyze/position', { fen: currentFen, depth: 18, lines: 3 }, controller.signal,
      )
        .then((r) => {
          if (cancelled) return;
          const checked = verifiedPositionEngineLines<EngineLine>(r, currentFen);
          setLines(checked ?? []);
          setLinesFen(currentFen);
          setLinesError(checked === null ? 'unavailable' : null);
          setLinesLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled || controller.signal.aborted) return;
          setLinesError((err as { status?: number } | null)?.status === 429 ? 'busy' : 'unavailable');
          setLines([]);
          setLinesFen(currentFen);
          setLinesLoading(false);
        });
    }, 400);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(handle); };
  }, [linesEnabled, currentFen, linesRetry]);
  useEffect(() => { setLinesHover(null); setExplorerHover(null); }, [currentFen]);

  if (isLoading) return <AnalyzerSkeleton />;
  if (!Number.isSafeInteger(gameId) || gameId <= 0 || isError || !data || positions.length === 0) {
    return (
      <div role="alert" className="mx-auto max-w-xl rounded-xl border border-red-500/30 bg-white p-6 text-chesscom-900 shadow-soft dark:bg-chesscom-800 dark:text-chesscom-100">
        <h1 className="text-lg font-semibold">Game Review unavailable</h1>
        <p className="mt-2 text-sm text-chesscom-500">
          {!Number.isSafeInteger(gameId) || gameId <= 0
            ? 'The game link is invalid.'
            : data && positions.length === 0 ? 'This game has an invalid or unreadable saved PGN.'
            : loadError instanceof Error ? loadError.message : 'This game could not be loaded.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {Number.isSafeInteger(gameId) && gameId > 0 && <button type="button" className="btn-primary" onClick={() => void refetch()}>Retry loading</button>}
          <Link to="/review" className="btn-secondary">Back to games</Link>
        </div>
      </div>
    );
  }

  // The PGN may contain more moves than a partial/legacy engine result.
  // Never confuse an unscored played move with the starting position.
  const evaluatedMove = analysis?.moves[ply - 1];
  const move: AnalyzedMove | undefined = !isVariation && evaluatedMove?.uci === pos?.uci
    ? evaluatedMove : undefined;
  const startFen = positions[0]?.fen;
  const reviewedMoveSide = moveSideForPly(ply, startFen);
  const userColor = data.game.user_color ?? 'white';
  // "Play from here" (in the move card): the position on the board, at any
  // move — you keep your colour and Patzer takes the other side. To redo a
  // slip, you pick the move before it. Not once the game is over.
  const playOnFrom = playFromPosition(positions, ply + 1);
  const playOnColor = data.game.user_color ?? undefined;
  const playOn = playOnFrom && parseFromPosition(playOnFrom.fen, playOnFrom.moves.join(','), playOnColor ?? null)
    ? playFromUrl(playOnFrom, playOnColor) : null;
  const orientation: 'white' | 'black' = flipped
    ? (userColor === 'white' ? 'black' : 'white')
    : userColor;
  // Never claim a drawn (0.00) position when a variation has not been scored.
  const currentEvalCp = isVariation ? (variationQuality?.eval_after_cp ?? null) : (move?.eval_after_cp ?? null);

  const historySoFar = analysis?.moves.slice(0, ply - 1).map((m) => m.san) ?? [];
  const coachReq = move ? () => ({
    url: '/api/coach/explain',
    body: {
      fen: move.fen_before,
      player: reviewedMoveSide === 'white' ? 'White' : 'Black',
      played_san: move.san,
      best_san: move.best_move_san,
      classification: move.classification,
      cp_loss: move.centipawn_loss,
      // Sending eval before/after lets the server build win-probability and
      // a natural-language eval state into FACTS — strong grounding so a
      // small local model stops inventing winning attacks from training data.
      eval_before_cp: move.eval_before_cp,
      eval_after_cp: move.eval_after_cp,
      pv_san: move.best_pv,
      history: historySoFar,
      // Your own moves get "you" and your history (past mistakes of the same
      // kind, weakest phase, the opening trainer); the opponent's get neither.
      user_perspective: !!data.game.user_color && reviewedMoveSide === data.game.user_color,
    },
  }) : null;

  // Scores refer to the position before a move. Only the NEXT move's
  // suggestion (or a fresh live line) is legal on the displayed board.
  const bestUci = bestMoveForDisplayedBoard({
    ply,
    isVariation,
    mainline: analysis?.moves,
    liveLines: freshLines,
    liveReady: linesEnabled && !linesLoading && !linesError,
  });
  const baseArrow = bestUci ? [{
    orig: bestUci.slice(0, 2) as never,
    dest: bestUci.slice(2, 4) as never,
    brush: 'paleBlue',
  }] : [];
  const hoverUci = linesHover?.uci ?? explorerHover;
  const hoverArrow = hoverUci ? [{
    orig: hoverUci.slice(0, 2) as never,
    dest: hoverUci.slice(2, 4) as never,
    brush: 'paleGreen',
  }] : [];
  const arrow = [...baseArrow, ...hoverArrow];

  const pickedPlies = pick && analysis
    ? analysis.moves
      .filter((m) => m.classification === pick.classification && (pick.side === 'both' || moveSideForPly(m.ply, startFen) === pick.side))
      .map((m) => m.ply)
    : [];
  const pickedSet = pick ? new Set(pickedPlies) : null;
  const pickIndex = pickedPlies.indexOf(ply);
  const stepPick = (dir: 1 | -1) => {
    if (pickedPlies.length === 0) return;
    // From a move outside the category, go to the nearest one in that direction.
    const next = dir === 1
      ? (pickedPlies.find((p) => p > ply) ?? pickedPlies[0]!)
      : ([...pickedPlies].reverse().find((p) => p < ply) ?? pickedPlies[pickedPlies.length - 1]!);
    setPly(next);
  };
  const onPick = (p: MovePick) => {
    if (pick && pick.classification === p.classification && pick.side === p.side) { setPick(null); return; }
    setPick(p);
    setTab('moves');
    const first = analysis?.moves.find((m) => m.classification === p.classification && (p.side === 'both' || moveSideForPly(m.ply, startFen) === p.side));
    if (first) setPly(first.ply);
    // Bring the move list into view inside the right rail.
    requestAnimationFrame(() => {
      const tabEl = tabsRef.current;
      const rail = tabEl?.closest('[data-review-side-rail]');
      if (!tabEl || !(rail instanceof HTMLElement)) return;
      const offset = tabEl.getBoundingClientRect().top - rail.getBoundingClientRect().top;
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      if (rail.scrollHeight > rail.clientHeight && getComputedStyle(rail).overflowY !== 'visible') {
        rail.scrollBy({ top: offset, behavior });
      } else {
        // Normal page scrolling is now the sole desktop scroll surface.
        tabEl.scrollIntoView({ behavior, block: 'nearest' });
      }
    });
  };

  const eco = analysis?.opening_eco ?? data.game.eco ?? null;
  const openingName = analysis?.opening_name ?? data.game.opening_name ?? null;

  return (
    <div className="mx-auto w-full max-w-none" data-analysis-workspace="true">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link to="/review" className="btn-ghost text-sm shrink-0"><ChevronLeft className="h-4 w-4" />{t('common.back')}</Link>
        <div className="min-w-0 truncate text-right text-sm text-chesscom-500">
          <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{data.game.white}</span> vs{' '}
          <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{data.game.black}</span>
          <span className="ml-2">· {data.game.result}</span>
          {data.game.start_fen && <span className="ml-2 rounded-full bg-chesscom-100 px-2 py-0.5 text-[11px] dark:bg-chesscom-800">{t('review.fromPosition')}</span>}
        </div>
      </div>

      {/* Responsive cockpit: center board + rail together on desktop. The page
          can scroll naturally; clipping the workspace hid useful information. */}
      <div
        className="review-workspace"
        data-review-workspace
        style={{ gridTemplateColumns: 'minmax(0, min(72dvh, 760px, calc(48% - 12px))) minmax(0, min(760px, calc(52% - 12px)))' }}
      >
        {/* BOARD COLUMN — viewport-aware fluid width; at desktop sizes the
            grid centers this square and the right rail as a single cockpit. */}
        <div className="review-board-column">
          <PlayerHeader
            name={orientation === 'white' ? data.game.black : data.game.white}
            accuracy={orientation === 'white' ? analysis?.accuracy_black : analysis?.accuracy_white}
            elo={orientation === 'white' ? analysis?.estimated_elo_black : analysis?.estimated_elo_white}
            side={orientation === 'white' ? 'black' : 'white'}
            fen={currentFen}
          />
          {/* The board fills its responsive grid track. Page-level scrolling
              replaces a short viewport's clipped workspace. */}
          <div className="relative my-2 flex items-stretch justify-center gap-2">
            <EvalBar cp={currentEvalCp} orientation={orientation} />
            <div
              className={`review-board-square relative aspect-square w-full min-w-0 board-theme-${user?.profile.board_theme ?? 'green'}`}
            >
              <ChessBoard
                fen={currentFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'}
                analysisMode
                onMove={onAnalysisMove}
                orientation={orientation}
                lastMove={displayedLastMove ? [displayedLastMove.from as never, displayedLastMove.to as never] : undefined}
                arrows={arrow as never[]}
              />
              {!isVariation && move && pos?.to && (
                <ClassificationBadge classification={move.classification} square={pos.to} orientation={orientation} />
              )}
              {isVariation && variationQuality && (
                <ClassificationBadge classification={variationQuality.classification} square={variationQuality.to} orientation={orientation} evaluatedFenAfter={variationQuality.fen_after} activeFen={currentFen} />
              )}
            </div>
          </div>
          {bestUci && (
            <p className="mb-1 text-[11px] text-chesscom-500" role="note">
              Blue arrow: best continuation from the displayed board position.
            </p>
          )}
          <PlayerHeader
            name={orientation === 'white' ? data.game.white : data.game.black}
            accuracy={orientation === 'white' ? analysis?.accuracy_white : analysis?.accuracy_black}
            elo={orientation === 'white' ? analysis?.estimated_elo_white : analysis?.estimated_elo_black}
            side={orientation}
            fen={currentFen}
            highlighted
          />

          <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-soft dark:bg-chesscom-800">
            <div className="min-w-0 truncate text-chesscom-500">
              {isVariation ? (
                <><span className="font-medium text-amber-600">Variation {branchMove?.san ?? 'starting position'}</span>
                  {variationQuality && <span className="ml-2 text-xs text-chesscom-500">{t(`classification.${variationQuality.classification}`)}</span>}
                </>
              ) : ply > 0 && pos?.san ? (
                <>
                  <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{reviewedMoveSide === 'white' ? t('review.sideShort.white') : t('review.sideShort.black')}: {pos.san}</span>
                  {move?.best_move_san && move.best_move_san !== pos.san && (
                    <span className="ml-2 text-xs text-chesscom-400">{t('review.best', { san: move.best_move_san })}</span>
                  )}
                </>
              ) : <span className="italic">{t('review.startingPosition')}</span>}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums" aria-live="polite" aria-label={currentEvalCp === null ? 'Position evaluation unavailable' : `Evaluation ${fmtCp(currentEvalCp)}`}>
              {currentEvalCp === null ? (isVariation && branchMove && !qualityError ? 'Analyzing…' : '—') : fmtCp(currentEvalCp)}
            </div>
          </div>
          <div className="mt-3 flex select-none items-center justify-center gap-1.5 sm:gap-2" data-move-transport aria-label="Game move navigation">
            <button type="button" onClick={first} disabled={isVariation ? variations.variationCursor === 0 : ply === 0} aria-label={t('review.first')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.first')}><ChevronsLeft className="h-5 w-5" /></button>
            <button type="button" onClick={backward} disabled={!isVariation && ply === 0} aria-label={t('review.prev')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.prev')}><ChevronLeft className="h-5 w-5" /></button>
            <div className="flex h-10 min-w-[5rem] items-center justify-center rounded-xl bg-chesscom-100 px-3 text-sm font-mono tabular-nums dark:bg-chesscom-800 sm:h-12 sm:min-w-[5.5rem]">
              {isVariation ? `${displayedPly} · var` : ply} / {positions.length - 1}
            </div>
            <button type="button" onClick={forward} disabled={isVariation ? variations.variationCursor >= (variations.variations.find((v) => v.id === variations.activeVariationId)?.moves.length ?? 0) : ply >= positions.length - 1} aria-label={t('review.next')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.next')}><ChevronRight className="h-5 w-5" /></button>
            <button type="button" onClick={last} disabled={isVariation ? variations.variationCursor >= (variations.variations.find((v) => v.id === variations.activeVariationId)?.moves.length ?? 0) : ply >= positions.length - 1} aria-label={t('review.last')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.last')}><ChevronsRight className="h-5 w-5" /></button>
          </div>
          <p className="mt-1 text-center text-[11px] text-chesscom-500">
            Left / Right: step through moves · Home / End: jump to start / end · F: flip board
          </p>

        </div>

        {/* RIGHT RAIL — one natural document scroll rather than a separate
            clipped scroll island; analysis cards remain reachable at any size. */}
        <div className="review-side-rail min-w-0 space-y-3" data-review-side-rail>
          <section className="card p-3" aria-label="Analysis variations">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Interactive analysis</div>
                <p className="text-xs text-chesscom-500">Move any piece to explore legal moves. Your saved game is never changed.</p>
              </div>
              <button type="button" className="btn-secondary shrink-0 px-2 py-1 text-xs" onClick={() => variations.restoreOriginalGame()} disabled={!isVariation}>
                Return to game
              </button>
            </div>
            {variations.variations.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
              {variations.variations.map((branch, index) => (
                <button type="button" key={branch.id} aria-pressed={variations.activeVariationId === branch.id}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium ${variations.activeVariationId === branch.id ? 'bg-amber-500 text-chesscom-950' : 'bg-chesscom-100 text-chesscom-700 dark:bg-chesscom-700 dark:text-chesscom-100'}`}
                  onClick={() => variations.selectVariation(branch.id)} title={`Variation ${index + 1}, ${branch.moves.length} moves, from game ply ${branch.basePly}`}>
                  Variation {index + 1} · {branch.moves.length} moves
                </button>
              ))}
            </div>}
            {isVariation && <div role="status" className="mt-2 text-sm">
              <span className="font-mono text-xs text-chesscom-500">{variations.playedVariationMoves.map((m) => m.san).join(' ') || 'Branch point'}</span>
              {qualityError && <div role="status" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-600">
                <span>{qualityError}</span>
                <button type="button" className="rounded border border-amber-500/40 px-2 py-1 font-semibold hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
                  onClick={() => setQualityRetry((previous) => previous + 1)}>Retry scoring</button>
              </div>}
            </div>}
            {variations.error && <p role="alert" className="mt-2 text-xs text-red-600">{variations.error}</p>}
          </section>
          {analysisError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{analysisError}</div>}
          {!analysis && (
            <button onClick={() => void analyze(requestedDepth, cachedAnalysisInvalid)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing
                ? t('review.analyzing', { progress: '…' })
                : t('review.runEngine', { defaultValue: 'Run engine analysis' })}
            </button>
          )}

          {analysis && (
            <>
              <OpeningBanner eco={eco} name={openingName} prose={reviewProse?.opening?.prose} />

              {/* During exploratory play this is still the original game timeline,
                  not a fabricated analysis of the unscored hypothetical branch. */}
              <div className="card p-2">
                {isVariation && <p className="mb-2 text-xs text-chesscom-500">Original game timeline · select a move to return to the saved line.</p>}
                <EvalGraph
                  evals={timeline.evals}
                  current={isVariation ? undefined : ply}
                  onClick={(p) => setPly(p)}
                  markers={analysis.moves
                    .filter((m) => ['blunder','mistake','inaccuracy','miss','brilliant','great'].includes(m.classification))
                    .map((m) => ({ ply: m.ply, classification: m.classification }))}
                />
              </div>

              {/* Tabbed workspace — Moves / AI report / Key moments / Engine / Coach.
                  This is the ONLY tabbed surface on the page: engine lines moved in
                  here (previously a peer card) so there is one mental model, not three. */}
              <div ref={tabsRef} className="card overflow-hidden scroll-mt-2">
                <div role="tablist" aria-label="Review detail sections" onKeyDown={(event) => {
                  if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return;
                  const tabs: Tab[] = ['moves', 'report', 'moments'];
                  const index = tabs.indexOf(tab);
                  let next: Tab;
                  if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length]!;
                  else if (event.key === 'ArrowLeft') next = tabs[(index + tabs.length - 1) % tabs.length]!;
                  else if (event.key === 'Home') next = tabs[0]!;
                  else if (event.key === 'End') next = tabs[tabs.length - 1]!;
                  else return;
                  event.preventDefault(); event.stopPropagation();
                  setTab(next);
                  requestAnimationFrame(() => document.getElementById(`review-tab-${next}`)?.focus());
                }} className="flex items-center gap-0.5 border-b border-chesscom-100 bg-chesscom-50/40 px-1 dark:border-chesscom-700 dark:bg-chesscom-900/40 sm:gap-1 sm:px-2">
                  <TabBtn id="review-tab-moves" active={tab === 'moves'} onClick={() => setTab('moves')} icon={ListOrdered} label={t('review.moves', { defaultValue: 'Moves' })} />
                  <TabBtn id="review-tab-report" active={tab === 'report'} onClick={() => setTab('report')} icon={FileText} label={t('review.gameReport', { defaultValue: 'AI report' })} />
                  <TabBtn id="review-tab-moments" active={tab === 'moments'} onClick={() => setTab('moments')} icon={Sparkles} label={t('review.keyMoments', { defaultValue: 'Key moments' })} />
                  <button onClick={() => setShowDepthControl((s) => !s)} aria-label={t('review.depth', { defaultValue: 'Engine depth settings' })} aria-expanded={showDepthControl} className="btn-ghost ml-auto p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500" title={t('review.depth')}>
                    <SettingsIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div id="review-tabpanel" role="tabpanel" aria-labelledby={`review-tab-${tab}`} className="p-3">
                  {tab === 'moves' && pick && (
                    <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-50/60 px-2 py-1.5 text-xs dark:bg-gold-700/10">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{t(`classification.${pick.classification}`)}</span>
                        <span className="text-chesscom-500"> · {pick.side === 'both' ? t('review.pickBoth', { defaultValue: 'both sides' }) : t(`review.${pick.side}`)}</span>
                      </span>
                      <span className="font-mono tabular-nums text-chesscom-500">{pickIndex >= 0 ? pickIndex + 1 : '–'}/{pickedPlies.length}</span>
                      <button onClick={() => stepPick(-1)} className="btn-ghost p-1" title={t('review.prev')}><ChevronLeft className="h-4 w-4" /></button>
                      <button onClick={() => stepPick(1)} className="btn-ghost p-1" title={t('review.next')}><ChevronRight className="h-4 w-4" /></button>
                      <button onClick={() => setPick(null)} className="btn-ghost p-1" title={t('common.close', { defaultValue: 'Close' })}><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  {tab === 'moves' && move && (
                    <MoveExplanation
                      move={move}
                      userColor={data.game.user_color}
                      coachConfigured={coachConfigured}
                      coachRequest={coachReq}
                      playFrom={playOn ?? undefined}
                    />
                  )}
                  {tab === 'moves' && ply > 0 && !isVariation && !move && (
                    <div role="status" className="mb-2 rounded-lg border border-chesscom-200 bg-chesscom-50 px-3 py-2 text-xs text-chesscom-600 dark:border-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-300">
                      This move is saved in the game but has no engine evaluation yet.
                      <button type="button" className="ml-1 font-semibold underline underline-offset-2" onClick={() => setShowDepthControl(true)}>Reanalyze the full game</button>
                    </div>
                  )}
                  {tab === 'moves' && (
                    <MoveList
                      moves={timeline.moves}
                      current={isVariation ? -1 : ply}
                      onSelect={setPly}
                      phaseSplit={analysis.phase_split}
                      startFen={positions[0]?.fen}
                      highlight={pickedSet}

                    />
                  )}
                  {tab === 'report' && (
                    <GameReportPanel
                      key={gameId}
                      gameId={gameId}
                      initial={reviewProse}
                      onMomentJump={setPly}
                      onGenerated={setReviewProse}
                      userColor={data.game.user_color}
                      startFen={startFen}
                    />
                  )}
                  {tab === 'moments' && (
                    <KeyMomentsList
                      items={analysis.key_moments.map((m) => {
                        const proseHit = reviewProse?.key_moments.find((p) => p.ply === m.ply);
                        return {
                          ply: m.ply,
                          side: m.side,
                          san: m.san,
                          classification: m.classification,
                          cp_loss: m.cp_loss,
                          win_pct_delta: m.win_pct_delta,
                          best_san: m.best_san,
                          title: proseHit?.title,
                          prose: proseHit?.prose,
                          mine: data.game.user_color ? m.side === data.game.user_color : undefined,
                        };
                      })}
                      current={ply}
                      onSelect={setPly}
                    />
                  )}
                </div>
              </div>

              {showDepthControl && (
                <div className="card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="label" htmlFor="review-analysis-depth">{t('review.depth')}</label>
                    <span className="font-mono text-sm font-semibold tabular-nums">{requestedDepth}</span>
                  </div>
                  <input
                    id="review-analysis-depth" type="range" min={8} max={22} step={1}
                    value={requestedDepth}
                    onChange={(e) => setRequestedDepth(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-chesscom-400">
                    <span>{t('review.depthFast')}</span>
                    <span>{t('review.depthQuality')}</span>
                    <span>{t('review.depthDeep')}</span>
                  </div>
                  <button
                    onClick={() => void analyze(requestedDepth, true)}
                    disabled={analyzing}
                    className="btn-primary mt-3 w-full text-sm"
                  >
                    <Sparkles className="h-4 w-4" />
                    {analyzing ? t('review.analyzing', { progress: '…' }) : `${t('review.reanalyze')} (depth ${requestedDepth})`}
                  </button>
                </div>
              )}

              <LinesPanel
                enabled={linesEnabled}
                onToggle={() => setLinesEnabled((s) => !s)}
                lines={freshLines}
                loading={linesLoading}
                error={linesError}
                onRetry={() => setLinesRetry((n) => n + 1)}
                playedUci={!isVariation ? positions[ply + 1]?.uci ?? null : null}
                onAdvance={forward}
                onTryMove={onAnalysisMove}
                onHover={setLinesHover}
              />

              <GameReportCard
                whiteName={data.game.white}
                blackName={data.game.black}
                accuracyW={analysis.accuracy_white}
                accuracyB={analysis.accuracy_black}
                eloW={analysis.estimated_elo_white}
                eloB={analysis.estimated_elo_black}
                perfW={analysis.performance_white}
                perfB={analysis.performance_black}
                moves={analysis.moves}
                phaseSplit={analysis.phase_split}
                userColor={userColor}
                startFen={startFen}
                onPick={onPick}
                picked={pick}
              />

              <ThreatPanel fen={currentFen} currentCpWhite={currentEvalCp} />

              <ExplorerPanel fen={currentFen} onPreview={setExplorerHover} />

              <GameMetaToolbar
                key={gameId}
                gameId={gameId}
                bookmarked={!!data.game.bookmarked}
                notes={data.game.notes ?? ''}
                onFlip={() => setFlipped((f) => !f)}
                linkCopied={linkCopied}
                sharingVariation={isVariation}
                onShare={() => {
                  const url = shareCurrentPosition();
                  navigator.clipboard?.writeText(url).then(() => {
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1400);
                  }).catch(() => undefined);
                }}
              />

              <ExportRow
                pgn={data.game.pgn}
                fen={currentFen}
                fileBase={`${(data.game.white || 'white').replace(/[^A-Za-z0-9]+/g, '_')}_vs_${(data.game.black || 'black').replace(/[^A-Za-z0-9]+/g, '_')}`}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GameMetaToolbar({ gameId, bookmarked, notes, onFlip, onShare, linkCopied, sharingVariation }: { gameId: number; bookmarked: boolean; notes: string; onFlip: () => void; onShare: () => void; linkCopied: boolean; sharingVariation: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const confirmedNotesRef = useRef(notes);
  useEffect(() => {
    setDraft((current) => reconcileReviewNotesDraft(current, confirmedNotesRef.current, notes));
    confirmedNotesRef.current = notes;
  }, [notes]);

  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${gameId}/bookmark`, { bookmarked: next }),
    onError: () => setStarred(bookmarked),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['game', gameId] });
    },
  });
  const [isStarred, setStarred] = useState(bookmarked);
  useEffect(() => { setStarred(bookmarked); }, [bookmarked]);

  const saveNotes = useMutation({
    // Rapid blur/save events may overlap. Serialize them so an older PATCH
    // cannot overwrite a newer note on the server.
    scope: { id: `review-notes:${gameId}` },
    mutationFn: (text: string) => api.patch(`/api/games/${gameId}/notes`, { notes: text }),
    onSuccess: () => {
      setSaveError('');
      setSavedAt(Date.now()); setTimeout(() => setSavedAt(null), 1400);
      void queryClient.invalidateQueries({ queryKey: ['games'] });
      void queryClient.invalidateQueries({ queryKey: ['game', gameId] });
    },
    onError: () => setSaveError('Could not save your notes. Your draft is still here; try again.'),
  });

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => { const next = !isStarred; setStarred(next); star.mutate(next); }}
          className={`btn-ghost px-2 py-1 text-xs ${isStarred ? 'text-gold-600 dark:text-gold-400' : ''}`}
          title={t('shortcuts.bookmark', { defaultValue: 'Toggle bookmark' })}
        >
          <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-gold-500' : ''}`} />
          {isStarred ? t('review.starred', { defaultValue: 'Starred' }) : t('review.star', { defaultValue: 'Star' })}
        </button>
        <button onClick={onFlip} className="btn-ghost px-2 py-1 text-xs" title={t('shortcuts.flipBoard', { defaultValue: 'Flip board' })}>
          <FlipVertical2 className="h-3.5 w-3.5" /> {t('review.flip', { defaultValue: 'Flip' })}
        </button>
        <button onClick={onShare} className="btn-ghost px-2 py-1 text-xs" title={sharingVariation ? 'Share this variation position in Lab' : t('shortcuts.share', { defaultValue: 'Copy link to position' })}>
          {linkCopied ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Share2 className="h-3.5 w-3.5" />}
          {linkCopied ? t('common.copied') : (sharingVariation ? 'Share branch FEN' : t('review.share', { defaultValue: 'Share position' }))}
        </button>
        <button
          onClick={() => setShowNotes((s) => !s)}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${showNotes ? 'text-chesscom-900 dark:text-chesscom-100' : ''}`}
          title={t('review.notes', { defaultValue: 'Notes' })}
        >
          <NotebookPen className="h-3.5 w-3.5" />
          {t('review.notes', { defaultValue: 'Notes' })}
          {notes && !showNotes && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-500" />}
        </button>
      </div>
      {showNotes && (
        <div className="border-t border-chesscom-200 p-2 dark:border-chesscom-700">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== notes) saveNotes.mutate(draft); }}
            maxLength={4000}
            placeholder={t('review.notesPlaceholder', { defaultValue: 'Your private notes on this game…' })}
            className="input min-h-[88px] w-full resize-y text-sm"
          />
          {saveError && <div role="alert" className="mt-2 flex items-center justify-between gap-2 text-xs text-red-600 dark:text-red-300">
                <span>{saveError}</span>
                <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => saveNotes.mutate(draft)}>Retry</button>
              </div>}
              <div className="mt-1 flex items-center justify-between text-[11px] text-chesscom-400">
                <span>{t('review.notesPrivate', { defaultValue: 'Only you can see this.' })}</span>
            <span>{saveNotes.isPending ? t('common.saving', { defaultValue: 'Saving…' }) : draft !== notes ? t('review.notesUnsaved', { defaultValue: 'Click outside to save' }) : savedAt ? t('common.saved', { defaultValue: 'Saved' }) : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerHeader({ name, accuracy, elo, side, fen, highlighted }: { name: string; accuracy?: number; elo?: number | null; side: 'white' | 'black'; fen: string; highlighted?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-3 py-2 shadow-soft transition-colors ${
        highlighted
          ? 'border-l-4 border-gold-500 bg-white dark:bg-chesscom-800 text-chesscom-900 dark:text-chesscom-100'
          : 'bg-white text-chesscom-900 dark:bg-chesscom-800/70 dark:text-chesscom-100'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${side === 'white' ? 'bg-white border border-chesscom-300' : 'bg-chesscom-900 border border-chesscom-700'}`} />
        <span className="truncate text-sm font-semibold">{name}</span>
        {elo != null && <span className="font-mono text-xs font-semibold tabular-nums text-chesscom-500">({elo})</span>}
      </div>
      <div className="flex items-center gap-3">
        <CapturedPieces fen={fen} side={side} />
        {accuracy != null && (
          <span className="font-mono text-sm font-bold tabular-nums">{accuracy.toFixed(1)}<span className="text-xs opacity-70">%</span></span>
        )}
      </div>
    </div>
  );
}

function TabBtn({ id, active, onClick, icon: Icon, label }: { id: string; active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      id={id} type="button" role="tab" aria-selected={active}
      aria-controls="review-tabpanel" tabIndex={active ? 0 : -1}
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative flex items-center gap-1 px-2 py-2 text-xs font-medium transition-colors sm:gap-1.5 sm:px-3 ${active ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500 hover:text-chesscom-900 dark:hover:text-chesscom-100'}`}
    >
      <Icon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
      <span className="hidden sm:inline">{label}</span>
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gold-500 sm:inset-x-2" />}
    </button>
  );
}

function ExportRow({ pgn, fen, fileBase }: { pgn: string; fen: string; fileBase: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'fen' | 'pgn' | null>(null);

  async function copy(kind: 'fen' | 'pgn', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard API may be denied; silently no-op.
    }
  }

  function downloadPgn() {
    const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileBase}.pgn`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="card flex flex-wrap items-center gap-2 p-2 text-xs">
      <button onClick={() => copy('fen', fen)} className="btn-ghost px-2 py-1 text-xs" title={t('review.copyFenTitle')}>
        {copied === 'fen' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'fen' ? t('common.copied') : `${t('common.copy')} FEN`}
      </button>
      <button onClick={() => copy('pgn', pgn)} className="btn-ghost px-2 py-1 text-xs" title={t('review.copyPgnTitle')}>
        {copied === 'pgn' ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Copy className="h-3.5 w-3.5" />}
        {copied === 'pgn' ? t('common.copied') : `${t('common.copy')} PGN`}
      </button>
      <button onClick={downloadPgn} className="btn-ghost px-2 py-1 text-xs" title={t('review.downloadPgnTitle')}>
        <Download className="h-3.5 w-3.5" />
        {t('common.download')}
      </button>
    </div>
  );
}

function LinesPanel({ enabled, onToggle, lines, loading, error, onRetry, playedUci, onAdvance, onTryMove, onHover }: {
  enabled: boolean;
  onToggle: () => void;
  lines: EngineLine[];
  loading: boolean;
  error: 'busy' | 'unavailable' | null;
  onRetry: () => void;
  playedUci: string | null;
  onAdvance: () => void;
  onTryMove: (uci: string) => void;
  onHover: (l: EngineLine | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-chesscom-100 bg-chesscom-50/40 px-3 py-2 dark:border-chesscom-700 dark:bg-chesscom-900/40">
        <Search className="h-3.5 w-3.5 text-chesscom-500" />
        <span className="text-xs font-semibold uppercase tracking-wider text-chesscom-500 dark:text-chesscom-300">
          {t('review.lines', { defaultValue: 'Engine lines' })}
        </span>
        <button
          onClick={onToggle}
          className={`btn-ghost ml-auto px-2 py-1 text-xs ${enabled ? 'text-board-dark' : ''}`}
        >
          {enabled
            ? t('review.linesHide', { defaultValue: 'Hide' })
            : t('review.linesShow', { defaultValue: 'Show top engine lines' })}
        </button>
      </div>
      {enabled && (
        <div className="space-y-1 p-2">
          {loading && lines.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-chesscom-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('review.linesFetching', { defaultValue: 'fetching…' })}
            </div>
          )}
          {!loading && !error && lines.length === 0 && (
            <div className="px-2 py-3 text-xs text-chesscom-400">—</div>
          )}
          {error && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-2 py-3 text-xs text-chesscom-500">
              <span>{error === 'busy' ? 'Stockfish is busy with another request.' : 'Engine lines are unavailable.'}</span>
              <button type="button" onClick={onRetry} disabled={loading} className="btn-secondary px-2 py-1 text-xs">Retry</button>
            </div>
          )}
          {lines.map((l) => {
            const isPlayed = playedUci != null && l.uci === playedUci;
            const pv = l.pv_san.slice(0, 6).join(' ');
            return (
              <button
                key={l.multipv}
                type="button"
                disabled={loading}
                onClick={() => { if (isPlayed) onAdvance(); else onTryMove(l.uci); }}
                aria-label={`${isPlayed ? 'Follow played move' : 'Try engine move'} ${l.san}`}
                onMouseEnter={() => onHover(l)}
                onMouseLeave={() => onHover(null)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                  isPlayed
                    ? 'cursor-pointer bg-board-dark/10 hover:bg-board-dark/15'
                    : 'cursor-pointer hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40'
                }`}
              >
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  l.multipv === 1 ? 'bg-gold-500/20 text-gold-600' : 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-800'
                }`}>{l.multipv}</span>
                <span className="w-12 shrink-0 font-mono text-xs font-semibold tabular-nums">
                  {l.mate != null ? (l.mate > 0 ? `#${l.mate}` : `-#${Math.abs(l.mate)}`) : fmtCp(l.cp)}
                </span>
                <span className="w-12 shrink-0 truncate font-mono font-semibold text-chesscom-900 dark:text-chesscom-100">{l.san}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-chesscom-500">{pv}</span>
                {isPlayed && <span className="shrink-0 text-[10px] uppercase text-board-dark">{t('review.linesPlayed', { defaultValue: 'played' })}</span>}
              </button>
            );
          })}
          {loading && lines.length > 0 && (
            <div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-chesscom-400">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('review.linesRefreshing', { defaultValue: 'refreshing…' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalyzerSkeleton() {
  return (
    <div className="mx-auto max-w-7xl animate-pulse">
      <div className="mb-4 h-7 w-40 rounded bg-chesscom-200/70 dark:bg-chesscom-700/70" />
      <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
        <div className="lg:flex-1 lg:max-w-[760px]">
          <div className="aspect-square w-full rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="mt-3 h-12 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
        </div>
        <div className="space-y-3 lg:w-[380px]">
          <div className="h-24 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="h-32 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
          <div className="h-48 rounded-xl bg-chesscom-200/70 dark:bg-chesscom-700/70" />
        </div>
      </div>
    </div>
  );
}
