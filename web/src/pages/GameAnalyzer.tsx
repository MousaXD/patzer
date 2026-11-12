import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUp, Sparkles, Settings as SettingsIcon, Copy, Download, Check, ListOrdered, FileText, X, Star, Share2, FlipVertical2, NotebookPen, Search, Loader2 } from 'lucide-react';
import ChessBoard from '../components/ChessBoard';
import EvalBar from '../components/EvalBar';
import EvalGraph from '../components/EvalGraph';
import { visibleEngineLines, bestMoveForDisplayedBoard, reviewVariationScoringRequest, reviewVariationScoringKey, verifiedPositionEngineLines, verifiedBestAlternative, verifiedSavedBestMove, verifiedSavedBestContinuation, reviewTerminalPosition } from '../components/review/reviewPosition';
import { postReviewAnalysis } from '../components/review/reviewAnalysisRequest';
import { moveSideForPly } from '../components/review/moveHistoryModel';
import { decodeStoredReviewJson, needsFreshReviewAnalysis } from '../components/review/storedReview';
import { parseReviewGamePositions } from '../components/review/reviewGamePositions';
import { buildSavedReviewTimeline } from '../components/review/reviewTimeline';
import { practiceCandidates } from '../components/review/practiceCandidates';
import { reconcileReviewNotesDraft } from '../components/review/reviewNotes';
import { reviewAnalysisErrorKind } from '../components/review/reviewAnalysisErrors';
import { isCompleteReviewPayload } from '../components/review/reviewStream';
import { reviewSourceKey } from '../components/review/reviewSource';
import MoveList from '../components/MoveList';
import ReviewClassificationGuide from '../components/review/ReviewClassificationGuide';
import { displayableMate, formatReviewMate } from '../components/review/reviewMateScore';
import { formatReviewEngineLineScore } from '../components/review/reviewEngineLineScore';
import CoachPanel from '../components/CoachPanel';
import GameReportCard, { type MovePick } from '../components/GameReportCard';
import MoveExplanation from '../components/MoveExplanation';
import ReviewUnavailable, { reviewUnavailableReason } from '../components/review/ReviewUnavailable';
import ReviewDisclosureHeader from '../components/ReviewDisclosureHeader';
import MistakePractice from '../components/review/MistakePractice';
import GameReportPanel, { type GameReviewProse } from '../components/GameReportPanel';
import KeyMomentsList from '../components/KeyMomentsList';
import OpeningBanner from '../components/OpeningBanner';
import ClassificationBadge from '../components/ClassificationBadge';
import CapturedPieces from '../components/CapturedPieces';
import ThreatPanel from '../components/ThreatPanel';
import ExplorerPanel from '../components/ExplorerPanel';
import { soundForMove, inferMoveFlagsFromSan } from '../lib/sounds';
import { useAnalysisVariations } from '../lib/useAnalysisVariations';
import { legalAnalysisMove, analysisVariationPreview, analysisVariationTrail } from '../lib/analysisVariations';
import { qualityMatchesVariationMove, type VariationMoveQuality } from '../lib/classification';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { parseFromPosition, playFromPosition, playFromUrl } from '../lib/fromPosition';
import type { AnalysisResult, AnalyzedMove } from '../types';

interface GameDetail {
  game: { id: number; pgn: string; white: string; black: string; result: string; user_color: 'white' | 'black' | null; eco?: string | null; opening_name?: string | null; bookmarked?: number | null; notes?: string | null; start_fen?: string | null; source_revision: number };
  analysis: {
    scoring_version: number; source_hash: string | null;
    source_revision: number | null; analysis_generation: number;
    depth: number; accuracy_white: number; accuracy_black: number;
    estimated_elo_white: number | null; estimated_elo_black: number | null;
    performance_white: number | null; performance_black: number | null;
    opening_eco: string | null; opening_name: string | null;
    key_moments_json: string | null;
    phase_split_json: string | null;
    moves_json: string;
  } | null;
  analysis_stale?: boolean;
  analysis_unverified?: boolean;
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

/** A failed background refetch can replace the practice board without an
 * explicit click. Announce the recovery destination to keyboard/screen-reader
 * users instead of leaving focus on a detached practice control. */
function PracticeUnavailable({ practicePicker, onExit }: { practicePicker: boolean; onExit: () => void }) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  return <section role="alert" aria-labelledby="practice-unavailable-heading"
    className="mx-auto max-w-xl rounded-lg border border-amber-500/40 p-4">
    <h1 id="practice-unavailable-heading" ref={headingRef} tabIndex={-1}
      className="font-semibold focus:outline-none">{t('practice.unavailableHeading')}</h1>
    <p className="mt-2 text-sm">{t('practice.unavailableReason')}</p>
    <button type="button" className="btn-secondary mt-3 min-h-11" onClick={onExit}>
      {t(practicePicker ? 'practice.backChoices' : 'practice.returnSaved')}
    </button>
  </section>;
}

function GameAnalyzerView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gameId = Number(id);

  const { data, refetch, isLoading, isFetching, isError, error: loadError } = useQuery({
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
  const runAnalysisButtonRef = useRef<HTMLButtonElement>(null);
  const missingMoveRetryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The native disabled state stops duplicate engine requests, but can drop
    // keyboard focus to BODY while Stockfish runs. Restore the enabled retry
    // after failure only when focus was lost, not when the user navigated to
    // a different control during the request.
    if (!analyzing && analysisError && document.activeElement === document.body) {
      (missingMoveRetryRef.current ?? runAnalysisButtonRef.current)?.focus({ preventScroll: true });
    }
  }, [analyzing, analysisError, analysis]);
  const [coachConfigured, setCoachConfigured] = useState(false);
  const [requestedDepth, setRequestedDepth] = useState(16);
  const [showDepthControl, setShowDepthControl] = useState(false);
  const [storedProse, setStoredProse] = useState<{ source: string; prose: GameReviewProse } | null>(null);
  const [tab, setTab] = useState<Tab>('moves');
  // An in-review retry is transient. A blind attempt entered from the
  // library uses a separate URL history entry so Back returns to its
  // spoiler-free picker instead of unexpectedly leaving the saved game.
  const [reviewPracticePly, setReviewPracticePly] = useState<number | null>(null);
  // A category picked in the Game Report table (e.g. Black's misses): those
  // moves stand out in the move list and the arrows below step through them.
  const [pick, setPick] = useState<MovePick | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const boardFocusRef = useRef<HTMLDivElement | null>(null);
  const moveSummaryRef = useRef<HTMLDivElement | null>(null);
  const variationTrailRef = useRef<HTMLElement | null>(null);
  // Local UI state for new features.
  const [flipped, setFlipped] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shareCopyFailed, setShareCopyFailed] = useState(false);
  useEffect(() => { setShareCopyFailed(false); }, [gameId]);
  const [searchParams, setSearchParams] = useSearchParams();
  const practicePicker = searchParams.get('practice') === '1';
  const routeAttempt = searchParams.get('practicePly');
  const routePracticePly = practicePicker && routeAttempt !== null && /^[1-9]\d*$/.test(routeAttempt)
    ? Number(routeAttempt) : null;
  const practicePly = practicePicker
    ? routePracticePly !== null && Number.isSafeInteger(routePracticePly) ? routePracticePly : null
    : reviewPracticePly;
  // Blind practice must not compete with a previously started full-game
  // reanalysis, whether entered through the library or from normal Review.
  useEffect(() => {
    if ((practicePicker || practicePly !== null) && analysisRequestRef.current) {
      analysisRequestRef.current.abort();
      analysisRequestRef.current = null;
      setAnalyzing(false);
    }
  }, [practicePicker, practicePly]);
  // Replaying a PGN is work proportional to game length. Rebuild only when
  // its text changes (not when notes/bookmarks or cached analysis refresh).
  // A corrupted PGN is represented as an empty result, not a render-time throw.
  const positions = useMemo(
    () => data ? (parseReviewGamePositions(data.game.pgn) ?? []) : [],
    [data?.game.pgn],
  );
  // React Router does not automatically hand keyboard/screen-reader focus to
  // this new page. Focus its heading only on first entry, never after a
  // background refetch or on return from an attempted move (which restores
  // focus to the chosen practice moment instead).
  const pickerHeadingFocusedRef = useRef(false);
  const lastDirectAttemptRef = useRef<number | null>(null);
  const returnToChoiceRef = useRef<number | null>(null);
  const restoringPickerFocusRef = useRef(false);
  useEffect(() => {
    const previous = lastDirectAttemptRef.current;
    lastDirectAttemptRef.current = practicePicker ? practicePly : null;
    // Browser Back should focus the picker heading; the explicit exit button
    // returns focus to the selected moment. Never focus a detached board.
    if (!practicePicker || practicePly !== null || previous === null) return;
    const id = returnToChoiceRef.current === previous
      ? `practice-move-${previous}` : 'practice-picker-heading';
    returnToChoiceRef.current = null;
    restoringPickerFocusRef.current = true;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (target) { target.focus(); pickerHeadingFocusedRef.current = true; }
      restoringPickerFocusRef.current = false;
    });
    return () => { cancelAnimationFrame(frame); restoringPickerFocusRef.current = false; };
  }, [practicePicker, practicePly]);
  useEffect(() => {
    if (!practicePicker) {
      pickerHeadingFocusedRef.current = false;
      return;
    }
    if (practicePly !== null || positions.length === 0
      || pickerHeadingFocusedRef.current || restoringPickerFocusRef.current) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById('practice-picker-heading');
      if (heading) {
        heading.focus();
        pickerHeadingFocusedRef.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [practicePicker, practicePly, positions.length]);
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
  // A report must cover this entire saved game. A valid prefix-only legacy
  // analysis is useful for the Moves tab, but not evidence for an AI summary.
  const fullEngineEvidence = !!decodedStoredReview
    && decodedStoredReview.moves.length === positions.length - 1
    && decodedStoredReview.moves.every((move, index) =>
      move.fen_before === positions[index]?.fen && move.fen_after === positions[index + 1]?.fen);
  const sourceKey = !cachedAnalysisInvalid && fullEngineEvidence && data
    ? reviewSourceKey(gameId, data.game.pgn, data.analysis, data.analysis_stale, data.game.source_revision) : null;
  // This ref is updated DURING render, not in an effect: a late promise from
  // the prior commit must never win the race before effect cleanup runs.
  const currentSourceRef = useRef(sourceKey);
  currentSourceRef.current = sourceKey;
  const reviewProse = storedProse?.source === sourceKey ? storedProse.prose : null;
  // The initial loading state has no source; going from null to the FIRST
  // verified analysis is not a game update. Preserve the last valid source
  // through temporary invalid/no-analysis states so A -> null -> B is still
  // recognized as a change (and never accepts A's cached prose for B).
  const lastValidSourceRef = useRef<string | null>(null);
  const sourceChanged = lastValidSourceRef.current !== null
    && lastValidSourceRef.current !== sourceKey;
  const [sourceNotice, setSourceNotice] = useState(false);
  useEffect(() => {
    if (sourceChanged) setSourceNotice(true);
    if (sourceKey) lastValidSourceRef.current = sourceKey;
  }, [sourceKey, sourceChanged]);

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
        setAnalysisError('review.storedAnalysisUnreadable');
      }
    } else {
      setAnalysis(null);
      setAnalysisError('');
    }
  }, [data, decodedStoredReview, setAnalysis]);

  // Stale data can arrive while a player is trying a mistake (for example,
  // a bookmark update invalidates the game-detail query). Never start a
  // hidden full-game Stockfish job during either blind-practice surface.
  // Re-check on leaving practice so explicit full Review still refreshes
  // stale analysis. Deliberately exclude 'analyzing': a failed request must
  // not create an immediate retry loop on the same stale snapshot.
  useEffect(() => {
    if (!data?.analysis_stale || data.analysis_unverified || analyzing || practicePicker || practicePly !== null) return;
    void analyze(16, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, practicePicker, practicePly]);

  // Load prose only for the source that was observed at request admission.
  // Game-detail refetches can arrive without remounting the route. Do not
  // refetch prose for harmless notes/bookmark changes.
  useEffect(() => {
    let active = true;
    // Cached AI prose contains conclusions/engine lines; neither mount nor
    // request it in the blind exercise. Fetch it only in the full review.
    if (!practicePicker && sourceKey && Number.isSafeInteger(gameId) && gameId > 0) {
      api.get<{ review: GameReviewProse | null }>(`/api/games/${gameId}/review`)
        .then((r) => {
          if (!active || currentSourceRef.current !== sourceKey) return;
          if (isCompleteReviewPayload(r)) {
            // A backend without provenance cannot establish that previously
            // cached prose matches a NEW source. Fail closed on refresh.
            if (!sourceChanged) setStoredProse((previous) =>
              previous?.source === sourceKey ? previous : { source: sourceKey, prose: r.review as GameReviewProse });
          } else setStoredProse(null);
        })
        .catch(() => { if (active && currentSourceRef.current === sourceKey) setStoredProse(null); });
    }
    return () => { active = false; };
  }, [gameId, practicePicker, sourceKey]);

  useEffect(() => {
    if (practicePicker) { setCoachConfigured(false); return; }
    let active = true;
    api.get<{ configured: boolean }>('/api/coach/status')
      .then((s) => { if (active) setCoachConfigured(s.configured); })
      .catch(() => { if (active) setCoachConfigured(false); });
    return () => { active = false; };
  }, [practicePicker]);

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
  const enterPracticePly = (selected: number) => {
    if (practicePicker) {
      const next = new URLSearchParams(searchParams);
      next.set('practicePly', String(selected));
      setSearchParams(next, { state: { fromBlindPracticePicker: true } });
      // Push one history entry for browser Back/Forward and mark its actual
      // origin. A bookmarked attempt URL has no guaranteed picker to pop to.
    } else {
      setReviewPracticePly(selected);
    }
  };
  const leavePractice = (restoreSelectedMove: boolean) => {
    if (practicePicker) {
      returnToChoiceRef.current = restoreSelectedMove ? practicePly : null;
      if ((location.state as { fromBlindPracticePicker?: boolean } | null)?.fromBlindPracticePicker) {
        navigate(-1); // Return to the actual picker, not a duplicate history entry.
      } else {
        // Direct/bookmarked exercise URL with no known picker behind it.
        const next = new URLSearchParams(searchParams);
        next.delete('practicePly');
        setSearchParams(next, { replace: true });
      }
    } else {
      if (restoreSelectedMove && practicePly !== null) setPly(practicePly);
      setReviewPracticePly(null);
      requestAnimationFrame(() => document.getElementById(
        restoreSelectedMove ? 'learn-from-mistake' : 'full-game-review-heading',
      )?.focus());
    }
  };
  const isVariation = variations.activeVariationId !== null;
  const activeBranch = isVariation
    ? variations.variations.find((branch) => branch.id === variations.activeVariationId)
    : null;
  const activeTrail = activeBranch ? analysisVariationTrail(activeBranch, variations.variations) : [];
  useEffect(() => {
    const nav = variationTrailRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !current) return;
    // Only scroll the horizontal move strip. scrollIntoView() also shifts the
    // document vertically, stealing the chessboard from mobile players who
    // are stepping through moves using the board or transport controls.
    const container = nav.getBoundingClientRect();
    const selected = current.getBoundingClientRect();
    const edge = 6;
    if (selected.right > container.right - edge) {
      nav.scrollLeft += selected.right - container.right + edge;
    } else if (selected.left < container.left + edge) {
      nav.scrollLeft -= container.left - selected.left + edge;
    }
  }, [activeBranch?.id, variations.variationCursor, activeTrail.length]);
  const branchMove = isVariation ? variations.playedVariationMoves.at(-1) : undefined;
  const qualityKey = branchMove ? reviewVariationScoringKey(gameId, branchMove) : null;
  const [qualityCache, setQualityCache] = useState<Record<string, VariationMoveQuality>>({});
  // A failed branch must not contaminate another branch whose source-matched
  // score is already cached. The effect below is skipped on cache hits, so a
  // global error string would otherwise survive every branch switch.
  const [qualityFailure, setQualityFailure] = useState<{
    key: string; reason: 'source_mismatch' | 'engine_unavailable';
  } | null>(null);
  const qualityError = qualityKey && qualityFailure?.key === qualityKey ? qualityFailure.reason : '';
  const [qualityRetry, setQualityRetry] = useState(0);
  const retryVariationScoring = () => {
    setQualityFailure(null);
    setQualityRetry((previous) => previous + 1);
    // Retry hides its own button while a new score is loading. Without a
    // durable focus target, keyboard users are thrown back to document BODY.
    requestAnimationFrame(() => moveSummaryRef.current?.focus({ preventScroll: true }));
  };
  const variationQuality = qualityKey && qualityMatchesVariationMove(qualityCache[qualityKey], branchMove)
    ? qualityCache[qualityKey] : null;
  // A branch is an ephemeral sequence, not part of the saved game's PGN.
  // Share the exact displayed board in Lab, not a misleading original-game URL.
  const shareCurrentPosition = () => isVariation
    ? `${window.location.origin}/lab#${encodeURI(variations.currentFen)}`
    : window.location.href;
  // Both the toolbar button and the S keyboard shortcut must share the same
  // copy success/error feedback. A denied clipboard still offers a manual URL.
  const copySharePosition = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(shareCurrentPosition());
      setShareCopyFailed(false);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1400);
    } catch {
      setLinkCopied(false);
      setShareCopyFailed(true);
    }
  };
  const displayedLastMove = variations.lastMove;

  // Each exploratory move is classified by the existing authenticated engine
  // endpoint. A response for a deselected branch is cached but never rendered
  // against another FEN; failed/429 searches never invent a label.
  useEffect(() => {
    if (practicePicker || practicePly !== null || !qualityKey || !branchMove || qualityCache[qualityKey]) return;
    const controller = new AbortController();
    let cancelled = false;
    let retry: number | undefined;
    setQualityFailure(null);
    const evaluate = async (attempt: number) => {
      try {
        const result = await postReviewAnalysis<{quality: VariationMoveQuality}>(
          '/api/analyze/variation-move', reviewVariationScoringRequest(branchMove), controller.signal,
        );
        if (!cancelled) {
          if (qualityMatchesVariationMove(result.quality, branchMove)) {
            setQualityCache((previous) => ({ ...previous, [qualityKey]: result.quality }));
          } else {
            setQualityFailure({ key: qualityKey, reason: 'source_mismatch' });
          }
        }
      } catch (e) {
        if (cancelled || controller.signal.aborted) return;
        const status = (e as Error & {status?: number}).status;
        if (status === 429 && attempt === 0) {
          retry = window.setTimeout(() => void evaluate(1), 1100);
        } else {
          setQualityFailure({ key: qualityKey, reason: 'engine_unavailable' });
        }
      }
    };
    const start = window.setTimeout(() => void evaluate(0), 250);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(start); if (retry) window.clearTimeout(retry); };
  // qualityKey and fen are the selection identity; avoid replaying a search
  // just because the controller produces a new view object on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityKey, variations.currentFen, qualityRetry, practicePicker, practicePly]);
  useEffect(() => { setQualityCache({}); setQualityFailure(null); }, [gameId]);

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
    ? variations.selectVariation(variations.activeVariationId, activeBranch?.moves.length ?? 0)
    : setPly(positions.length - 1);

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
  const shortcutActions = useRef({ backward, forward, first, last, copySharePosition });
  shortcutActions.current = { backward, forward, first, last, copySharePosition };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Practice is an isolated blind exercise; review shortcuts must not reveal or move its position.
      if (document.querySelector('[data-practice-mode], [data-practice-picker]')) return;
      const target = e.target instanceof Element ? e.target : null;
      // Never hijack editing, focused sliders/menus, the move-symbol guide's
      // native disclosure summary, a tablist's arrows, or a modal. Review's
      // global Home/End would otherwise jump away from the position while
      // someone is using keyboard navigation to read the legend.
      if (target?.closest('input, textarea, select, summary, [contenteditable], [role="textbox"], [role="slider"], [role="tablist"], [role="listbox"], [role="menu"]')) return;
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
        void shortcutActions.current.copySharePosition();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function analyze(depth: number, force = false) {
    // A saved PGN with no played moves has no move classifications, accuracy,
    // or learning report to compute. Keep position exploration available,
    // but never launch an expensive full-game job for an empty history.
    if (positions.length <= 1) return;
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
      if (!controller.signal.aborted) setAnalysisError(`review.analysisError.${reviewAnalysisErrorKind(error)}`);
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
  const [linesHover, setLinesHover] = useState<{ fen: string; uci: string } | null>(null);
  const [explorerHover, setExplorerHover] = useState<string | null>(null);
  const pos = data ? (positions[ply] ?? positions[0]) : undefined;
  const currentFen = variations.currentFen || pos?.fen || '';
  const freshLines = visibleEngineLines(lines, linesFen, currentFen);
  useEffect(() => {
    if (practicePly !== null || practicePicker || !linesEnabled || !currentFen) return;
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
  }, [linesEnabled, currentFen, linesRetry, practicePly, practicePicker]);
  useEffect(() => { setLinesHover(null); setExplorerHover(null); }, [currentFen]);

  if (isLoading) return <AnalyzerSkeleton />;
  if (!Number.isSafeInteger(gameId) || gameId <= 0 || isError || !data || positions.length === 0) {
    const validId = Number.isSafeInteger(gameId) && gameId > 0;
    const status = (loadError as (Error & { status?: number }) | null)?.status;
    const reason = reviewUnavailableReason({
      gameId, hasGame: !!data, positionsLength: positions.length, status,
    });
    return <ReviewUnavailable reason={reason} retrying={isFetching}
      onRetry={reason === 'loadFailed' && validId ? () => { void refetch(); } : undefined} />;
  }

  // The PGN may contain more moves than a partial/legacy engine result.
  // Never confuse an unscored played move with the starting position.
  const evaluatedMove = analysis?.moves[ply - 1];
  const move: AnalyzedMove | undefined = !isVariation && evaluatedMove?.uci === pos?.uci
    ? evaluatedMove : undefined;
  const currentSavedBest = move ? verifiedSavedBestMove(move, positions[ply - 1]?.fen) : null;
  const startFen = positions[0]?.fen;
  // A partially imported / still-running game is not an eligible blind drill.
  const eligiblePractice = !data.analysis_stale && !cachedAnalysisInvalid
    && data.game.result && data.game.result !== '*' && data.game.result !== 'ongoing'
    ? practiceCandidates(positions, analysis?.moves) : [];
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
  // Saved and source-matched exploratory reports use White-perspective mate
  // signs. Zero is ambiguous after checkmate, so leave that to the signed cp
  // fallback rather than mistakenly showing a Black mate.
  const currentMate = displayableMate(isVariation ? variationQuality?.mate_after : move?.mate_after, currentEvalCp);
  const variationScorePending = isVariation && !!branchMove && !qualityError && !variationQuality;
  const currentScoreLabel = formatReviewMate(currentMate) ?? (currentEvalCp === null ? null : fmtCp(currentEvalCp));
  const evalStatusText = currentScoreLabel ?? (variationScorePending ? t('review.variationAnalyzing') : '—');
  const evalStatusAccessible = currentScoreLabel === null
    ? (variationScorePending ? t('review.variationAnalyzing') : t('review.variationEvalUnavailable'))
    : t('review.variationEvalLabel', { score: currentScoreLabel });
  const evalBarAriaLabel = currentMate !== null
    ? t(currentMate > 0 ? 'review.evalBarMateWhite' : 'review.evalBarMateBlack', { count: Math.abs(currentMate) })
    : currentScoreLabel === null
      ? (variationScorePending ? t('review.variationAnalyzing') : t('review.variationEvalUnavailable'))
      : t('review.evalBarScoreWhite', { score: currentScoreLabel });

  const historySoFar = analysis?.moves.slice(0, ply - 1).map((m) => m.san) ?? [];
  const coachReq = move ? () => ({
    url: '/api/coach/explain',
    body: {
      fen: move.fen_before,
      player: reviewedMoveSide === 'white' ? 'White' : 'Black',
      played_san: move.san,
      // The displayed coaching card and the model's FACTS must agree: an
      // unsupported cached best SAN/PV cannot be smuggled into LLM context
      // after the visible advice was suppressed by source verification.
      best_san: currentSavedBest?.san ?? null,
      classification: move.classification,
      cp_loss: move.centipawn_loss,
      // Sending eval before/after lets the server build win-probability and
      // a natural-language eval state into FACTS — strong grounding so a
      // small local model stops inventing winning attacks from training data.
      eval_before_cp: move.eval_before_cp,
      eval_after_cp: move.eval_after_cp,
      pv_san: verifiedSavedBestContinuation(move, positions[ply - 1]?.fen),
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
    displayedFen: currentFen,
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
  // A hover/focus preview is valid only for the FEN from which that engine
  // line was verified. Moving to another saved ply or exploratory branch may
  // unmount the old button without a mouseleave event; never draw its arrow
  // on an unrelated position, even if the same UCI happens to be legal.
  const activeLinesHoverUci = linesEnabled && !linesLoading && !linesError
    && linesHover?.fen === currentFen
    && freshLines.some((candidate) => candidate.uci === linesHover.uci)
    ? linesHover.uci : null;
  const hoverUci = activeLinesHoverUci ?? explorerHover;
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
        // 'nearest' may leave a focused tab hidden beneath the fixed app
        // header at laptop widths. The card already has scroll-mt-16 to
        // expose the tablist without obscuring it under the header.
        tabEl.scrollIntoView({ behavior, block: 'start' });
      }
      // The clicked summary button can end up far below the filtered move
      // results after scrolling. Give keyboard/screen-reader users a stable
      // destination instead of leaving focus in the offscreen report card.
      document.getElementById('review-tab-moves')?.focus({ preventScroll: true });
    });
  };

  // On narrow screens the board and its explanation cannot fit together.
  // Make the journey two-way without duplicating game state or introducing a
  // fixed overlay over the chessboard. Focusing the destination also helps
  // keyboard/screen-reader users understand where the jump landed.
  const jumpToReviewSection = () => {
    setTab('moves');
    requestAnimationFrame(() => {
      tabsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      document.getElementById('review-tab-moves')?.focus({ preventScroll: true });
    });
  };
  const jumpToBoard = () => {
    boardFocusRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    boardFocusRef.current?.focus({ preventScroll: true });
  };
  // Engine suggestions are buttons tied to one exact FEN. Playing a line
  // changes that position and unmounts the focused button; send keyboard
  // users to the updated board instead of leaving focus on document BODY.
  const focusBoardAfterEngineLine = () => requestAnimationFrame(() => {
    if (window.matchMedia('(max-width: 959px)').matches) jumpToBoard();
    else boardFocusRef.current?.focus({ preventScroll: true });
  });
  /** A mobile tap in the rail should reveal the board that changed above.
   * Keep focus in the rail for keyboard/assistive selections so successive
   * moves can be compared without losing the active control. */
  const selectSavedFromRail = (selectedPly: number, input: 'keyboard' | 'pointer') => {
    setPly(selectedPly);
    if (input === 'pointer' && window.matchMedia('(max-width: 959px)').matches) {
      requestAnimationFrame(jumpToBoard);
    }
  };
  // In the stacked/mobile layout the board is above the analysis rail.
  // Merely updating the ply after selecting a Key Moment leaves the actual
  // position off-screen. Move focus and scroll to the board on narrow screens;
  // preserve desktop's fast, stationary side-by-side review workflow.
  const selectMoment = (selectedPly: number) => {
    setPly(selectedPly);
    if (window.matchMedia('(max-width: 959px)').matches) {
      requestAnimationFrame(jumpToBoard);
    }
  };

  // Keep every engine hint, graph, move list and AI explanation UNMOUNTED during
  // blind practice. The original PGN is read-only; attempts use a separate board.
  if (practicePly !== null) {
    const selected = analysis?.moves[practicePly - 1];
    const saved = positions[practicePly];
    if (eligiblePractice.some((candidate) => candidate.ply === practicePly)
      && selected && saved?.uci === selected.uci && saved.fen === selected.fen_after
      && selected.fen_before === positions[practicePly - 1]?.fen) {
      return <MistakePractice key={`${gameId}:${practicePly}:${selected.fen_before}`} fenBefore={selected.fen_before}
        orientation={moveSideForPly(practicePly, startFen)}
        boardTheme={user?.profile.board_theme ?? 'green'}
        exitLabel={t(practicePicker ? 'practice.backChoices' : 'practice.returnSaved')}
        onExit={() => leavePractice(true)} />;
    }
    // A stale/corrupt analysis or a background refetch must not silently
    // drop blind mode and expose the original move or its engine hint.
    return <PracticeUnavailable practicePicker={practicePicker} onExit={() => leavePractice(false)} />;
  }

  // This route is linked directly from the saved-game library. No chessboard,
  // SAN, PV, engine arrow, move list or report is ever mounted before choosing
  // a blind attempt, including during slow/stale engine analysis.
  if (practicePicker) {
    const openReview = () => {
      const next = new URLSearchParams(searchParams);
      next.delete('practice');
      next.delete('practicePly');
      setReviewPracticePly(null);
      setSearchParams(next, { replace: true });
      requestAnimationFrame(() => document.getElementById('full-game-review-heading')?.focus());
    };
    return <main data-practice-picker="true" className="mx-auto w-full max-w-2xl space-y-4 rounded-xl bg-white p-4 shadow-soft dark:bg-chesscom-800 sm:p-6">
      <Link to="/review" className="btn-ghost text-sm"><ChevronLeft className="h-4 w-4" />Back to saved games</Link>
      <h1 id="practice-picker-heading" tabIndex={-1} className="text-xl font-bold focus:outline-none">{t('practice.pickerHeading')}</h1>
      <p className="text-sm text-chesscom-600 dark:text-chesscom-300">
        {t('practice.pickerDescription')}
      </p>
      {eligiblePractice.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2" aria-label="Mistakes to practice">
          {eligiblePractice.map((candidate, index) => (
            <button key={candidate.ply} type="button" id={`practice-move-${candidate.ply}`}
              className="min-h-12 rounded-lg border border-chesscom-200 bg-chesscom-50 px-3 py-3 text-left text-sm font-medium hover:border-gold-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 dark:border-chesscom-700 dark:bg-chesscom-900"
              onClick={() => enterPracticePly(candidate.ply)}>
              {t('practice.pickerMoment', { index: index + 1, side: t(`review.${candidate.side}`), move: candidate.moveNumber })}
              <span className="block text-xs font-normal text-chesscom-500">{t('practice.answerHidden')}</span>
            </button>
          ))}
        </div>
      ) : <p role="status" className="rounded-lg border border-chesscom-200 p-3 text-sm dark:border-chesscom-700">
        {data.analysis_stale || cachedAnalysisInvalid
          ? t('practice.staleAnalysis')
          : analyzing || (data.analysis && !analysis && !analysisError)
          ? t('practice.preparing')
          : t('practice.noMistakes')}
      </p>}
      <button type="button" className="btn-secondary min-h-11" onClick={openReview}>{t('practice.openFull')}</button>
    </main>;
  }

  const eco = analysis?.opening_eco ?? data.game.eco ?? null;
  const openingName = analysis?.opening_name ?? data.game.opening_name ?? null;

  return (
    <div className="mx-auto w-full max-w-none" data-analysis-workspace="true">
      <h1 id="full-game-review-heading" tabIndex={-1} className="sr-only focus:outline-none">
        {t('review.title')} — {data.game.white} versus {data.game.black}
      </h1>
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
            <EvalBar cp={currentEvalCp} mate={currentMate} orientation={orientation} ariaLabel={evalBarAriaLabel} />
            <div
              ref={boardFocusRef}
              role="group"
              tabIndex={-1}
              aria-label={t('review.boardLabel', { defaultValue: 'Chessboard' })}
              data-review-live-preview-uci={activeLinesHoverUci ?? undefined}
              className={`review-board-square relative aspect-square w-full min-w-0 scroll-mt-16 board-theme-${user?.profile.board_theme ?? 'green'}`}
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
            <p className="mb-1 text-[11px] text-chesscom-500 dark:text-chesscom-300" role="note" data-review-best-arrow-note>
              {t('review.bestArrowNote')}
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

          <div ref={moveSummaryRef} data-review-move-summary tabIndex={-1}
            className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm shadow-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 dark:bg-chesscom-800">
            <div className="min-w-0 truncate text-chesscom-500">
              {isVariation ? (
                <><span className="font-medium text-amber-600">{t('review.variationMove', { san: branchMove?.san ?? t('review.startingPosition') })}</span>
                  {variationQuality && <span data-review-variation-quality className="ml-2 text-xs text-chesscom-500">{t(`classification.${variationQuality.classification}`)}</span>}
                </>
              ) : ply > 0 && pos?.san ? (
                <>
                  <span className="font-medium text-chesscom-900 dark:text-chesscom-100">{reviewedMoveSide === 'white' ? t('review.sideShort.white') : t('review.sideShort.black')}: {pos.san}</span>
                  {currentSavedBest && currentSavedBest.san !== pos.san && (
                    <span className="ml-2 text-xs text-chesscom-400">{t('review.best', { san: currentSavedBest.san })}</span>
                  )}
                </>
              ) : <span className="italic">{t('review.startingPosition')}</span>}
            </div>
            <div className="font-mono text-base font-semibold tabular-nums" aria-live="polite" aria-label={evalStatusAccessible}>
              {evalStatusText}
            </div>
          </div>
          {/* Scoring feedback belongs beside the move it describes, not below
              the lengthy variation selector. On phones the previous warning
              was entirely below the viewport while the board showed '—'. */}
          {isVariation && qualityError && (
            <div data-review-variation-scoring-feedback role="status"
              className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <span className="min-w-0 flex-1">
                {t(qualityError === 'source_mismatch' ? 'review.variationSourceMismatch' : 'review.variationEngineUnavailable')}
              </span>
              <button type="button" className="min-h-11 shrink-0 rounded border border-amber-500/50 px-3 py-2 font-semibold hover:bg-amber-500/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500"
                onClick={retryVariationScoring}>
                {t('review.variationRetryScoring')}
              </button>
            </div>
          )}
          <div className="mt-3 flex select-none items-center justify-center gap-1.5 sm:gap-2" data-move-transport
            aria-label={t(isVariation ? 'review.variationMoveNavigation' : 'review.moveNavigation')}>
            <button type="button" onClick={first} disabled={isVariation ? variations.variationCursor === 0 : ply === 0} aria-label={t('review.first')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.first')}><ChevronsLeft className="h-5 w-5" /></button>
            <button type="button" onClick={backward} disabled={!isVariation && ply === 0} aria-label={t('review.prev')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.prev')}><ChevronLeft className="h-5 w-5" /></button>
            <div data-review-move-progress role="status"
              className="flex h-10 min-w-[5rem] items-center justify-center rounded-xl bg-chesscom-100 px-3 text-sm font-mono tabular-nums dark:bg-chesscom-800 sm:h-12 sm:min-w-[5.5rem]">
              {isVariation
                ? t('review.variationProgress', { current: variations.variationCursor, total: activeBranch?.moves.length ?? 0 })
                : `${ply} / ${positions.length - 1}`}
            </div>
            <button type="button" onClick={forward} disabled={isVariation ? variations.variationCursor >= (activeBranch?.moves.length ?? 0) : ply >= positions.length - 1} aria-label={t('review.next')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.next')}><ChevronRight className="h-5 w-5" /></button>
            <button type="button" onClick={last} disabled={isVariation ? variations.variationCursor >= (activeBranch?.moves.length ?? 0) : ply >= positions.length - 1} aria-label={t('review.last')} className="btn-secondary h-10 w-10 p-0 sm:h-12 sm:w-12" title={t('review.last')}><ChevronsRight className="h-5 w-5" /></button>
          </div>
          {analysis && !isVariation && (
            <button type="button" data-review-jump-to-details
              className="review-mobile-jump btn-secondary mt-2 min-h-11 w-full justify-center text-sm"
              onClick={jumpToReviewSection}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              {t('review.jumpToMoveDetails')}
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <p className="review-desktop-shortcuts mt-1 text-center text-[11px] text-chesscom-500 dark:text-chesscom-300" data-review-keyboard-shortcuts>
            {t('review.keyboardShortcuts')}
          </p>

        </div>

        {/* RIGHT RAIL — one natural document scroll rather than a separate
            clipped scroll island; analysis cards remain reachable at any size. */}
        <div className="review-side-rail min-w-0 space-y-3" data-review-side-rail>
          <section className="card px-3 py-2.5" aria-label={t('review.variationTitle')}>
            {isVariation || variations.variations.length > 0 ? (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-[190px] flex-1">
                  <div className="text-sm font-semibold">{t('review.variationTitle')}</div>
                  <p className="text-xs text-chesscom-500 dark:text-chesscom-300">{t('review.variationHelp')}</p>
                </div>
                <button type="button" className="btn-secondary min-h-11 shrink-0 px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500"
                  onClick={() => {
                    variations.restoreOriginalGame();
                    // This button becomes disabled as soon as its branch is
                    // exited. Return the keyboard user to the saved board
                    // instead of leaving focus on a disabled action/BODY.
                    requestAnimationFrame(jumpToBoard);
                  }} disabled={!isVariation}>
                  {t('review.variationReturn')}
                </button>
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-chesscom-500 dark:text-chesscom-300" data-review-explore-hint>
                <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">{t('review.exploreLabel')} </span>
                {t('review.exploreHint')}
              </p>
            )}
            {variations.variations.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">
              {variations.variations.map((branch, index) => {
                const parentIndex = variations.variations.findIndex(other => other.id === branch.parentId);
                const descriptionId = `review-variation-description-${branch.id}`;
                return <button type="button" key={branch.id} aria-pressed={variations.activeVariationId === branch.id}
                  aria-label={t('review.variationOption', { number: index + 1, moves: branch.moves.length })}
                  aria-describedby={descriptionId}
                  className={`inline-flex min-h-14 min-w-[9.5rem] max-w-full flex-[1_1_9.5rem] flex-col items-start justify-center gap-1 rounded-md px-3 py-2 text-left text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 ${variations.activeVariationId === branch.id ? 'bg-amber-500 text-chesscom-950' : 'bg-chesscom-100 text-chesscom-700 dark:bg-chesscom-700 dark:text-chesscom-100'}`}
                  onClick={() => {
                    variations.selectVariation(branch.id);
                    // The branch picker sits below the board on phones. The
                    // changed position would otherwise remain out of view;
                    // preserve the in-place, side-by-side workflow on desktop.
                    if (window.matchMedia('(max-width: 959px)').matches) {
                      requestAnimationFrame(jumpToBoard);
                    }
                  }} title={t('review.variationOptionTitle', { number: index + 1, moves: branch.moves.length, ply: branch.basePly })}>
                  <span>{t('review.variationOption', { number: index + 1, moves: branch.moves.length })}</span>
                  <span id={descriptionId} className="block w-full min-w-0">
                    <span className="block truncate font-mono text-[11px]">{analysisVariationPreview(branch, variations.variations)}</span>
                    {parentIndex >= 0 && (
                      <span className="block text-[10px] opacity-85">
                        {t('review.variationForkOf', { number: parentIndex + 1 })}
                      </span>
                    )}
                  </span>
                </button>;
              })}
            </div>}
            {isVariation && activeBranch && <div className="mt-3 min-w-0" data-review-variation-trail>
              <p className="mb-1 text-xs font-semibold text-chesscom-600 dark:text-chesscom-300">
                {t('review.variationMoveTrail')}
              </p>
              <nav ref={variationTrailRef} aria-label={t('review.variationMoveTrail')}
                className="flex max-w-full gap-1.5 overflow-x-auto pb-2">
                <button type="button" aria-current={variations.variationCursor === 0 ? 'step' : undefined}
                  aria-label={t('review.variationJumpFork')}
                  onClick={() => {
                    variations.selectVariation(activeBranch.id, 0);
                    if (window.matchMedia('(max-width: 959px)').matches) requestAnimationFrame(jumpToBoard);
                  }}
                  className={`min-h-11 shrink-0 rounded-md border px-2.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 ${variations.variationCursor === 0 ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'border-chesscom-300 text-chesscom-600 hover:bg-chesscom-100 dark:border-chesscom-600 dark:text-chesscom-200 dark:hover:bg-chesscom-700'}`}>
                  {t('review.variationBranchPoint')}
                </button>
                {activeTrail.map((step) => {
                  const number = variations.variations.findIndex((v) => v.id === step.branchId) + 1;
                  const current = step.branchId === activeBranch.id && step.cursor === variations.variationCursor;
                  return <button type="button" key={`${step.branchId}-${step.cursor}`}
                    data-review-trail-move aria-current={current ? 'step' : undefined}
                    aria-label={t('review.variationJumpMove', { san: step.move.san, number })}
                    onClick={() => {
                      variations.selectVariation(step.branchId, step.cursor);
                      if (window.matchMedia('(max-width: 959px)').matches) requestAnimationFrame(jumpToBoard);
                    }}
                    className={`min-h-11 min-w-11 shrink-0 rounded-md border px-2.5 font-mono text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 ${current ? 'border-amber-500 bg-amber-500 text-chesscom-950' : 'border-chesscom-300 text-chesscom-700 hover:bg-chesscom-100 dark:border-chesscom-600 dark:text-chesscom-100 dark:hover:bg-chesscom-700'}`}>
                    {step.move.san}
                  </button>;
                })}
              </nav>
            </div>}
            {variations.error && <p role="alert" className="mt-2 text-xs text-red-600">{variations.error}</p>}
          </section>
          {analysisError && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">{t(analysisError)}</div>}
          {data.analysis_unverified && <p role="status" className="text-sm text-chesscom-600 dark:text-chesscom-300">{t('review.legacyEvidence')}</p>}
          {!analysis && positions.length > 1 && (
            <button ref={runAnalysisButtonRef} onClick={() => void analyze(requestedDepth, cachedAnalysisInvalid)} disabled={analyzing} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {analyzing
                ? t('review.analyzing', { progress: '…' })
                : t('review.runEngine', { defaultValue: 'Run engine analysis' })}
            </button>
          )}

          {/* Engine scores are optional; a legal saved PGN is still a usable
              replay. Never hide its actual move history behind Stockfish
              availability, and never imply that unscored moves are equal. */}
          {!analysis && (
            <div className="card p-3">
              <h2 id="review-unscored-moves-heading" className="text-sm font-semibold">{t('review.moves')}</h2>
              <p role="status" className="mb-3 mt-1 text-xs text-chesscom-500 dark:text-chesscom-300">
                {positions.length > 1 ? t('review.savedMovesWithoutAnalysis') : t('review.noMovesToAnalyze')}
              </p>
              <MoveList moves={timeline.moves} current={isVariation ? -1 : ply}
                onSelect={selectSavedFromRail} startFen={positions[0]?.fen} />
            </div>
          )}

          {analysis && (
            <>
              <OpeningBanner eco={eco} name={openingName} prose={reviewProse?.opening?.prose} />

              {/* During exploratory play this is still the original game timeline,
                  not a fabricated analysis of the unscored hypothetical branch. */}
              <div className="card p-2">
                {isVariation && <p className="mb-2 text-xs text-chesscom-500 dark:text-chesscom-300">{t('review.variationTimelineHint')}</p>}
                <EvalGraph
                  evals={timeline.evals}
                  current={isVariation ? undefined : ply}
                  onClick={selectSavedFromRail}
                  markers={analysis.moves
                    .filter((m) => ['blunder','mistake','inaccuracy','miss','brilliant','great'].includes(m.classification))
                    .map((m) => ({ ply: m.ply, classification: m.classification }))}
                />
              </div>

              {/* Tabbed workspace — Moves / AI report / Key moments / Engine / Coach.
                  This is the ONLY tabbed surface on the page: engine lines moved in
                  here (previously a peer card) so there is one mental model, not three. */}
              <div ref={tabsRef} className="card overflow-hidden scroll-mt-16">
                <div className="review-mobile-jump flex items-center justify-between gap-2 border-b border-chesscom-100 px-3 py-1.5 text-xs text-chesscom-500 dark:border-chesscom-700">
                  <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">{t('review.jumpToMoveDetails')}</span>
                  <button type="button" data-review-jump-to-board onClick={jumpToBoard}
                    className="btn-ghost min-h-9 px-2 py-1 text-xs">
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> {t('review.returnToBoard')}
                  </button>
                </div>
                <div role="tablist" aria-label={t('review.detailSections')} onKeyDown={(event) => {
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
                  <button onClick={() => setShowDepthControl((s) => !s)} aria-label={t('review.depth', { defaultValue: 'Engine depth settings' })} aria-expanded={showDepthControl} className="btn-ghost ml-auto flex min-h-11 min-w-9 shrink-0 items-center justify-center p-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500" title={t('review.depth')}>
                    <SettingsIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div id="review-tabpanel" role="tabpanel" aria-labelledby={`review-tab-${tab}`} className="p-3">
                  {tab === 'moves' && pick && (
                    <div className="mb-2 flex min-w-0 items-center gap-1 rounded-lg border border-gold-500/40 bg-gold-50/60 px-1.5 py-1 text-xs dark:bg-gold-700/10 sm:gap-1.5 sm:px-2">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{t(`classification.${pick.classification}`)}</span>
                        <span className="text-chesscom-500"> · {pick.side === 'both' ? t('review.pickBoth', { defaultValue: 'both sides' }) : t(`review.${pick.side}`)}</span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-chesscom-500">{pickIndex >= 0 ? pickIndex + 1 : '–'}/{pickedPlies.length}</span>
                      <button type="button" onClick={() => stepPick(-1)}
                        className="btn-ghost h-11 w-11 shrink-0 p-0" title={t('review.prev')}
                        aria-label={t('review.filterPrev')}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" onClick={() => stepPick(1)}
                        className="btn-ghost h-11 w-11 shrink-0 p-0" title={t('review.next')}
                        aria-label={t('review.filterNext')}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
                      <button type="button" onClick={() => setPick(null)}
                        className="btn-ghost h-11 w-11 shrink-0 p-0" title={t('common.close', { defaultValue: 'Close' })}
                        aria-label={t('review.filterClear')}><X className="h-4 w-4" aria-hidden="true" /></button>
                    </div>
                  )}
                  {tab === 'moves' && move && eligiblePractice.some((candidate) => candidate.ply === ply) && (
                    <div className="mb-3 rounded-lg border border-gold-500/40 p-3">
                      <p className="mb-2 text-sm text-chesscom-600 dark:text-chesscom-300">{t('practice.retryDescription')}</p>
                      <button type="button" className="btn-primary min-h-11 w-full"
                        id="learn-from-mistake" onClick={() => enterPracticePly(ply)}>{t('practice.retryAction')}</button>
                    </div>
                  )}
                  {tab === 'moves' && move && (
                    <MoveExplanation
                      // A different authoritative engine generation can
                      // change the meaning of the *same* ply. Remount the
                      // coach to cancel its old request, clear old narration
                      // and fetch fresh source-bound facts. Notes/bookmarks
                      // leave reviewSourceKey stable and do not retrigger it.
                      key={JSON.stringify([sourceKey ?? [gameId, data.game.source_revision,
                        data.analysis?.analysis_generation, move.fen_before, move.fen_after,
                        move.classification, move.eval_before_cp, move.eval_after_cp,
                        move.best_move_uci, move.best_move_san, move.best_pv], move.ply])}
                      move={move}
                      startFen={startFen}
                      userColor={data.game.user_color}
                      coachConfigured={coachConfigured}
                      coachRequest={coachReq}
                      playFrom={playOn ?? undefined}
                      onShowBestMove={!isVariation && verifiedBestAlternative(move, positions[ply - 1]?.fen)
                        ? () => {
                            setPly(move.ply - 1);
                            requestAnimationFrame(() => {
                              if (window.matchMedia('(max-width: 959px)').matches) jumpToBoard();
                              else {
                                boardFocusRef.current?.scrollIntoView({ block: 'nearest' });
                                boardFocusRef.current?.focus({ preventScroll: true });
                              }
                            });
                          }
                        : undefined}
                    />
                  )}
                  {tab === 'moves' && ply > 0 && !isVariation && !move && (
                    <div role="status" className="mb-2 rounded-lg border border-chesscom-200 bg-chesscom-50 px-3 py-2 text-xs text-chesscom-600 dark:border-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-300">
                      <p>{t('review.partialMoveUnavailable')}</p>
                      <button ref={missingMoveRetryRef} type="button" data-review-partial-retry="true"
                        className="btn-secondary mt-2 min-h-11 px-3 py-2 text-xs"
                        disabled={analyzing} onClick={() => void analyze(requestedDepth, true)}>
                        {analyzing ? t('review.analyzing', { progress: '…' }) : t('review.partialReanalyze')}
                      </button>
                    </div>
                  )}
                  {tab === 'moves' && (
                    <>
                      <ReviewClassificationGuide moves={timeline.moves} />
                      <MoveList
                        moves={timeline.moves}
                        current={isVariation ? -1 : ply}
                        onSelect={selectSavedFromRail}
                        phaseSplit={analysis.phase_split}
                        startFen={positions[0]?.fen}
                        highlight={pickedSet}
                      />
                    </>
                  )}
                  {tab === 'report' && (
                    <GameReportPanel
                      key={sourceKey ?? `unavailable:${gameId}`}
                      gameId={gameId}
                      initial={reviewProse}
                      sourceReady={!!sourceKey && !data.analysis_stale && !cachedAnalysisInvalid}
                      sourceChanged={sourceNotice}
                      onMomentJump={selectMoment}
                      onGenerated={(prose) => {
                        if (sourceKey && currentSourceRef.current === sourceKey) {
                          setStoredProse({ source: sourceKey, prose });
                          setSourceNotice(false);
                        }
                      }}
                      userColor={data.game.user_color}
                      startFen={startFen}
                    />
                  )}
                  {tab === 'moments' && (
                    <KeyMomentsList
                      items={analysis.key_moments.map((m) => {
                        const proseHit = reviewProse?.key_moments.find((p) => p.ply === m.ply);
                        const measuredMove = analysis.moves.find((source) => source.ply === m.ply);
                        return {
                          ply: m.ply,
                          side: moveSideForPly(m.ply, startFen),
                          san: m.san,
                          classification: m.classification,
                          cp_loss: m.cp_loss,
                          win_pct_delta: m.win_pct_delta,
                          best_san: verifiedSavedBestMove(measuredMove, positions[m.ply - 1]?.fen)?.san ?? null,
                          title: proseHit?.title,
                          prose: proseHit?.prose,
                          mine: data.game.user_color ? moveSideForPly(m.ply, startFen) === data.game.user_color : undefined,
                          hasWinChanceEvidence: measuredMove?.eval_before_cp != null && measuredMove.eval_after_cp != null
                            && Number.isFinite(measuredMove.eval_before_cp) && Number.isFinite(measuredMove.eval_after_cp),
                        };
                      })}
                      current={ply}
                      onSelect={selectMoment}
                      startFen={startFen}
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
                terminalPosition={reviewTerminalPosition(currentFen)}
                scoreTurn={currentFen.split(' ')[1] === 'b' ? 'b' : 'w'}
                loading={linesLoading}
                error={linesError}
                onRetry={() => setLinesRetry((n) => n + 1)}
                playedUci={!isVariation ? positions[ply + 1]?.uci ?? null : null}
                onAdvance={() => { forward(); focusBoardAfterEngineLine(); }}
                onTryMove={(uci) => { onAnalysisMove(uci); focusBoardAfterEngineLine(); }}
                onHover={(line) => setLinesHover(line ? { fen: currentFen, uci: line.uci } : null)}
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
                shareCopyFailed={shareCopyFailed}
                sharingVariation={isVariation}
                shareUrl={shareCurrentPosition()}
                onShare={copySharePosition}
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

function GameMetaToolbar({ gameId, bookmarked, notes, onFlip, onShare, shareUrl, linkCopied, shareCopyFailed, sharingVariation }: { gameId: number; bookmarked: boolean; notes: string; onFlip: () => void; onShare: () => Promise<void>; shareUrl: string; linkCopied: boolean; shareCopyFailed: boolean; sharingVariation: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [draft, setDraft] = useState(notes);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [bookmarkRetryTarget, setBookmarkRetryTarget] = useState<boolean | null>(null);
  const confirmedNotesRef = useRef(notes);
  useEffect(() => {
    setDraft((current) => reconcileReviewNotesDraft(current, confirmedNotesRef.current, notes));
    confirmedNotesRef.current = notes;
  }, [notes]);

  const star = useMutation({
    mutationFn: (next: boolean) => api.patch(`/api/games/${gameId}/bookmark`, { bookmarked: next }),
    onMutate: (next: boolean) => { setBookmarkRetryTarget(null); setStarred(next); },
    onError: (_error, attempted) => {
      setStarred(bookmarked);
      // Retry the original intent; toggling again could target the wrong state.
      setBookmarkRetryTarget(attempted);
    },
    onSuccess: () => setBookmarkRetryTarget(null),
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
    onError: () => setSaveError('review.notesSaveFailed'),
  });

  return (
    <div className="card overflow-hidden" data-review-meta-toolbar>
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          aria-pressed={isStarred}
          disabled={star.isPending}
          onClick={() => star.mutate(!isStarred)}
          className={`btn-ghost min-h-11 px-2 py-2 text-xs ${isStarred ? 'text-gold-600 dark:text-gold-400' : ''}`}
          title={t('shortcuts.bookmark', { defaultValue: 'Toggle bookmark' })}
        >
          <Star className={`h-3.5 w-3.5 ${isStarred ? 'fill-gold-500' : ''}`} />
          {isStarred ? t('review.starred', { defaultValue: 'Starred' }) : t('review.star', { defaultValue: 'Star' })}
        </button>
        <button type="button" onClick={onFlip} className="btn-ghost min-h-11 px-2 py-2 text-xs" title={t('shortcuts.flipBoard', { defaultValue: 'Flip board' })}>
          <FlipVertical2 className="h-3.5 w-3.5" /> {t('review.flip', { defaultValue: 'Flip' })}
        </button>
        <button type="button" onClick={() => { void onShare(); }} className="btn-ghost min-h-11 px-2 py-2 text-xs" title={sharingVariation ? t('review.shareBranchTitle') : t('shortcuts.share', { defaultValue: 'Copy link to position' })}>
          {linkCopied ? <Check className="h-3.5 w-3.5 text-board-dark" /> : <Share2 className="h-3.5 w-3.5" />}
          {linkCopied ? t('common.copied') : (sharingVariation ? t('review.shareBranch') : t('review.share', { defaultValue: 'Share position' }))}
        </button>
        <button
          type="button"
          onClick={() => setShowNotes((s) => !s)}
          aria-expanded={showNotes}
          aria-controls={`review-notes-${gameId}`}
          className={`btn-ghost ml-auto min-h-11 px-2 py-2 text-xs ${showNotes ? 'text-chesscom-900 dark:text-chesscom-100' : ''}`}
          title={t('review.notes', { defaultValue: 'Notes' })}
        >
          <NotebookPen className="h-3.5 w-3.5" />
          {t('review.notes', { defaultValue: 'Notes' })}
          {notes && !showNotes && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-gold-500" />}
        </button>
      </div>
      {bookmarkRetryTarget !== null && <div data-review-bookmark-error role="alert"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-red-500/30 px-3 py-2 text-xs text-red-700 dark:text-red-200">
        <span>{t('review.bookmarkSaveFailed')}</span>
        <button type="button" className="btn-secondary min-h-11 px-3 py-2 text-xs"
          disabled={star.isPending}
          onClick={() => star.mutate(bookmarkRetryTarget)}>{t('review.bookmarkRetry')}</button>
      </div>}
      {shareCopyFailed && <ClipboardManualFallback
        label={sharingVariation ? t('review.shareBranchTitle') : t('shortcuts.share')}
        value={shareUrl}
      />}
      {showNotes && (
        <div id={`review-notes-${gameId}`} className="border-t border-chesscom-200 p-2 dark:border-chesscom-700">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (draft !== notes) saveNotes.mutate(draft); }}
            maxLength={4000}
            placeholder={t('review.notesPlaceholder', { defaultValue: 'Your private notes on this game…' })}
            className="input min-h-[88px] w-full resize-y text-sm"
          />
          {saveError && <div role="alert" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-red-600 dark:text-red-300">
                <span>{t(saveError)}</span>
                <button type="button" className="btn-secondary min-h-11 px-3 py-2 text-xs" disabled={saveNotes.isPending}
                  onClick={() => saveNotes.mutate(draft)}>{t('review.notesRetrySave')}</button>
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
      className={`relative flex min-h-11 min-w-0 items-center gap-1 whitespace-nowrap px-1.5 py-2 text-xs font-medium transition-colors sm:gap-1.5 sm:px-2 ${active ? 'text-chesscom-900 dark:text-chesscom-100' : 'text-chesscom-500 hover:text-chesscom-900 dark:text-chesscom-300 dark:hover:text-chesscom-100'}`}
    >
      {/* Narrow cockpit rails need full text destinations, not clipped titles.
          Use icons only when the wider desktop rail has room for both. */}
      <Icon className="hidden h-3.5 w-3.5 shrink-0 xl:block" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-gold-500 sm:inset-x-2" />}
    </button>
  );
}

function ExportRow({ pgn, fen, fileBase }: { pgn: string; fen: string; fileBase: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'fen' | 'pgn' | null>(null);
  const [manualCopy, setManualCopy] = useState<'fen' | 'pgn' | null>(null);

  async function copy(kind: 'fen' | 'pgn', text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setManualCopy(null);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard can be unavailable on self-hosted HTTP or denied by the
      // browser. Show the exact source text without altering the saved game.
      setManualCopy(kind);
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
    <div className="card grid grid-cols-3 gap-1 p-2 text-xs" data-review-export-row>
      <button type="button" onClick={() => copy('fen', fen)} className="btn-ghost min-h-11 min-w-0 gap-1 px-1 py-2 text-xs" title={t('review.copyFenTitle')}>
        {copied === 'fen' ? <Check className="h-3.5 w-3.5 shrink-0 text-board-dark" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{copied === 'fen' ? t('common.copied') : `${t('common.copy')} FEN`}</span>
      </button>
      <button type="button" onClick={() => copy('pgn', pgn)} className="btn-ghost min-h-11 min-w-0 gap-1 px-1 py-2 text-xs" title={t('review.copyPgnTitle')}>
        {copied === 'pgn' ? <Check className="h-3.5 w-3.5 shrink-0 text-board-dark" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 truncate">{copied === 'pgn' ? t('common.copied') : `${t('common.copy')} PGN`}</span>
      </button>
      <button type="button" onClick={downloadPgn} className="btn-ghost min-h-11 min-w-0 gap-1 px-1 py-2 text-xs" title={t('review.downloadPgnTitle')}>
        <Download className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 truncate">{t('common.download')}</span>
      </button>
      {manualCopy && <div className="col-span-3 min-w-0">
        <ClipboardManualFallback label={t(manualCopy === 'fen' ? 'review.copyFenTitle' : 'review.copyPgnTitle')}
          value={manualCopy === 'fen' ? fen : pgn} />
      </div>}
    </div>
  );
}

/** Browser clipboard permissions may be denied on a self-hosted origin.
 * A native read-only field keeps the user in control of the exact data. */
function ClipboardManualFallback({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // The S keyboard shortcut can be used from the board, far above this
    // footer. Bring the recovery field into view and select it immediately.
    // Avoid smooth scrolling while the user is trying to copy the value.
    const field = inputRef.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.select();
    field.scrollIntoView({ block: 'center', behavior: 'auto' });
  }, []);
  return (
    <div data-review-clipboard-fallback role="alert"
      className="min-w-0 border-t border-amber-500/30 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
      <p>{t('review.clipboardUnavailable')}</p>
      <textarea ref={inputRef} aria-label={label} readOnly value={value} rows={value.length > 180 ? 3 : 1}
        onFocus={(event) => event.currentTarget.select()}
        className="input mt-2 min-h-11 w-full min-w-0 resize-y font-mono text-xs" />
    </div>
  );
}

function LinesPanel({ enabled, onToggle, lines, terminalPosition, scoreTurn, loading, error, onRetry, playedUci, onAdvance, onTryMove, onHover }: {
  enabled: boolean;
  onToggle: () => void;
  lines: EngineLine[];
  terminalPosition: 'checkmate' | 'stalemate' | null;
  scoreTurn: 'w' | 'b';
  loading: boolean;
  error: 'busy' | 'unavailable' | null;
  onRetry: () => void;
  playedUci: string | null;
  onAdvance: () => void;
  onTryMove: (uci: string) => void;
  onHover: (l: EngineLine | null) => void;
}) {
  const { t } = useTranslation();
  const linesContentRef = useRef<HTMLDivElement>(null);
  const retryLines = () => {
    onRetry();
    // Retry disappears when a new engine request starts. Focus this persistent
    // content region rather than dropping keyboard users back to document BODY.
    requestAnimationFrame(() => linesContentRef.current?.focus({ preventScroll: true }));
  };
  return (
    <div className="card overflow-hidden">
      <ReviewDisclosureHeader icon={Search} label={t('review.lines', { defaultValue: 'Engine lines' })}
        expanded={enabled} onToggle={onToggle} controlsId="review-engine-lines-content"
        title={enabled ? t('review.linesHide', { defaultValue: 'Hide' }) : t('review.linesShow', { defaultValue: 'Show top engine lines' })} />
      <div ref={linesContentRef} id="review-engine-lines-content" role="region"
        aria-label={t('review.lines')} tabIndex={-1} hidden={!enabled}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          const focused = event.target instanceof HTMLElement
            ? event.target.closest<HTMLButtonElement>('button[data-review-engine-line]') : null;
          if (!focused || !event.currentTarget.contains(focused)) return;
          const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-review-engine-line]:not(:disabled)')];
          const index = choices.indexOf(focused);
          if (index < 0) return;
          let next = index;
          if (event.key === 'ArrowDown') next = Math.min(choices.length - 1, index + 1);
          else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = choices.length - 1;
          else if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          // This list previews moves in the *current* FEN. Global Review
          // Arrow/Home/End shortcuts must never step the saved game while a
          // candidate has focus. Vertical keys compare candidates instead.
          event.preventDefault();
          event.stopPropagation();
          if (next !== index) choices[next]?.focus({ preventScroll: true });
        }}
        className="space-y-1 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
        {enabled && (
          <>
          {lines.length > 0 && <p className="px-2 text-[11px] text-chesscom-500 dark:text-chesscom-300">
            {t('review.linesScorePerspective')}
          </p>}
          {loading && lines.length === 0 && (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-chesscom-500 dark:text-chesscom-200">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('review.linesFetching', { defaultValue: 'fetching…' })}
            </div>
          )}
          {!loading && !error && lines.length === 0 && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-2 py-3 text-xs text-chesscom-600 dark:text-chesscom-200">
              <span>{t(terminalPosition === 'checkmate' ? 'review.linesCheckmate'
                : terminalPosition === 'stalemate' ? 'review.linesStalemate' : 'review.linesNoMoves')}</span>
              {terminalPosition === null && (
                <button type="button" onClick={retryLines}
                  className="btn-secondary min-h-11 min-w-11 px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
                  {t('review.linesRetry')}
                </button>
              )}
            </div>
          )}
          {error && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 px-2 py-3 text-xs text-chesscom-600 dark:text-chesscom-200">
              <span>{t(error === 'busy' ? 'review.linesBusy' : 'review.linesUnavailable')}</span>
              <button type="button" onClick={retryLines} disabled={loading}
                className="btn-secondary min-h-11 min-w-11 px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">{t('review.linesRetry')}</button>
            </div>
          )}
          {lines.map((l, index) => {
            const isPlayed = playedUci != null && l.uci === playedUci;
            const pv = l.pv_san.slice(0, 6).join(' ');
            const scoreId = `review-engine-line-score-${index}`;
            const pvId = `review-engine-line-pv-${index}`;
            return (
              <button
                key={`${l.multipv}-${l.uci}`}
                data-review-engine-line
                type="button"
                disabled={loading}
                onClick={() => { if (isPlayed) onAdvance(); else onTryMove(l.uci); }}
                aria-label={t(isPlayed ? 'review.linesFollowMove' : 'review.linesTryMove', { san: l.san })}
                aria-describedby={`${scoreId} ${pvId}`}
                onMouseEnter={() => onHover(l)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(l)}
                onBlur={() => onHover(null)}
                className={`flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500 ${
                  isPlayed
                    ? 'cursor-pointer bg-board-dark/10 hover:bg-board-dark/15'
                    : 'cursor-pointer hover:bg-chesscom-50 dark:hover:bg-chesscom-900/40'
                }`}
              >
                <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  l.multipv === 1 ? 'bg-gold-500/20 text-gold-600' : 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-800'
                }`}>{l.multipv}</span>
                <span id={scoreId} data-review-engine-line-score className="w-12 shrink-0 font-mono text-xs font-semibold tabular-nums">
                  {formatReviewEngineLineScore(l, scoreTurn)}
                </span>
                <span className="w-12 shrink-0 truncate font-mono font-semibold text-chesscom-900 dark:text-chesscom-100">{l.san}</span>
                <span id={pvId} className="min-w-0 flex-1 truncate font-mono text-[11px] text-chesscom-600 dark:text-chesscom-200">{pv}</span>
                {isPlayed && <span className="shrink-0 text-[10px] uppercase text-board-dark dark:text-chesscom-200">{t('review.linesPlayed', { defaultValue: 'played' })}</span>}
              </button>
            );
          })}
          {loading && lines.length > 0 && (
            <div className="flex items-center gap-2 px-2 pt-1 text-[11px] text-chesscom-500 dark:text-chesscom-200">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('review.linesRefreshing', { defaultValue: 'refreshing…' })}
            </div>
          )}
          </>
        )}
      </div>
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
