import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ChessBoard from '../ChessBoard';
import { postReviewAnalysis } from './reviewAnalysisRequest';
import { reviewVariationScoringRequest } from './reviewPosition';
import { createPracticeAttempt, describePracticePosition, legalPracticeSquareMoves, verifiedPracticeQuality, type PracticeAttempt } from './mistakePractice';
import type { VariationMoveQuality } from '../../lib/classification';

interface Props {
  /** Exact position before the selected saved mistake. */
  fenBefore: string;
  orientation: 'white' | 'black';
  onExit: () => void;
  exitLabel?: string;
  boardTheme?: string;
}

/** Isolated practice surface: the analysis graph, best move, PGN and hints are
 * deliberately NOT mounted until the student has made an attempt. */
export default function MistakePractice({ fenBefore, orientation, onExit, exitLabel, boardTheme = 'green' }: Props) {
  const { t } = useTranslation();
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [quality, setQuality] = useState<VariationMoveQuality | null>(null);
  // Store an error *key*, not translated text. Switching UI language while
  // Stockfish is scoring must update the message without aborting/restarting
  // the chess computation.
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [typedMove, setTypedMove] = useState('');
  const [fromSquare, setFromSquare] = useState('');
  const [toSquare, setToSquare] = useState('');
  const [promotion, setPromotion] = useState('');
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const displayedFen = attempt?.fenAfter ?? fenBefore;
  const positionSummary = useMemo(() => describePracticePosition(displayedFen), [displayedFen]);
  const pieceName = (type: string) => t(`practice.piece.${type}`);
  const pieceDescription = (piece: { type: string; square: string }) =>
    t('practice.pieceOn', { piece: pieceName(piece.type), square: piece.square });
  const choices = useMemo(() => legalPracticeSquareMoves(fenBefore), [fenBefore]);
  const origins = useMemo(() => Array.from(new Map(choices.map((move) => [
    move.from, { square: move.from, piece: move.piece },
  ])).values()), [choices]);
  const destinations = Array.from(new Set(choices.filter((move) => move.from === fromSquare).map((move) => move.to)));
  const promotions = choices.filter((move) => move.from === fromSquare && move.to === toSquare && move.promotion)
    .map((move) => move.promotion!);
  const canPlaySquares = Boolean(fromSquare && toSquare && (promotions.length === 0 || promotions.includes(promotion)));

  useEffect(() => { headingRef.current?.focus(); }, []);
  useEffect(() => {
    if (!attempt) return;
    const controller = new AbortController();
    let active = true;
    setPending(true);
    setError('');
    setQuality(null);
    void postReviewAnalysis<{ quality: VariationMoveQuality }>(
      '/api/analyze/variation-move', reviewVariationScoringRequest(attempt), controller.signal,
    ).then((result) => {
      if (!active) return;
      const verified = verifiedPracticeQuality(result.quality, attempt);
      if (verified) setQuality(verified);
      else setError('scoreMismatch');
    }).catch((err: unknown) => {
      if (!active || controller.signal.aborted) return;
      const status = (err as { status?: number } | null)?.status;
      setError(status === 429 ? 'engineBusy' : 'engineUnavailable');
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); };
  }, [attempt, retry]);

  const submitMove = (notation: string) => {
    if (attempt) return;
    const legal = createPracticeAttempt(fenBefore, notation);
    if (legal) { setError(''); setPending(true); setAttempt(legal); }
    else setError('illegalMove');
  };
  const reset = () => {
    setTypedMove(''); setFromSquare(''); setToSquare(''); setPromotion('');
    setAttempt(null); setQuality(null); setError(''); setPending(false); headingRef.current?.focus();
  };
  const exit = () => { onExit(); };

  return (
    <main data-practice-mode="true" className="mx-auto w-full max-w-3xl rounded-xl bg-white p-4 shadow-soft dark:bg-chesscom-800 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 tabIndex={-1} ref={headingRef} className="text-xl font-bold focus:outline-none">{t('practice.learnHeading')}</h1>
          <p className="mt-1 text-sm text-chesscom-600 dark:text-chesscom-300">
            {t(attempt ? 'practice.attemptOnly' : 'practice.beforePrompt')}
          </p>
        </div>
        <button type="button" className="btn-secondary min-h-11" onClick={exit}>{exitLabel ?? t('practice.returnSaved')}</button>
      </div>
      <div className="mx-auto w-full" style={{ maxWidth: 'min(72dvh, 560px, calc(100vw - 3.5rem))' }}>
        <div role="group" className={`aspect-square w-full board-theme-${boardTheme}`} aria-label={t('practice.boardLabel')}>
          <ChessBoard key={attempt ? 'attempt' : 'blind'} fen={attempt?.fenAfter ?? fenBefore}
            orientation={orientation} analysisMode={!attempt} onMove={submitMove} />
        </div>
      </div>
      <details className="mx-auto mt-3 max-w-xl rounded-lg border border-chesscom-200 p-3 text-sm dark:border-chesscom-700">
        <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
          {t('practice.readBoard')}
        </summary>
        {positionSummary ? <div role="group" className="mt-2 space-y-2" aria-label={t('practice.currentPosition')}>
          <p>{t(`practice.${positionSummary.toMove === 'White'
            ? (positionSummary.inCheck ? 'whiteInCheck' : 'toMoveWhite')
            : (positionSummary.inCheck ? 'blackInCheck' : 'toMoveBlack')}`)}</p>
          <p><strong>{t('practice.whitePieces')}</strong> {positionSummary.white.map(pieceDescription).join(', ')}.</p>
          <p><strong>{t('practice.blackPieces')}</strong> {positionSummary.black.map(pieceDescription).join(', ')}.</p>
          <p className="text-xs text-chesscom-500">{t('practice.pieceLocationsOnly')}</p>
        </div> : <p className="mt-2" role="status">{t('practice.positionUnavailable')}</p>}
      </details>
      {!attempt && <div className="mt-4 space-y-3">
        <p className="text-center text-sm" role="status">{t('practice.makeMoveHint')}</p>
        <form className="flex flex-wrap items-end justify-center gap-2" onSubmit={(event) => { event.preventDefault(); submitMove(typedMove.trim()); }}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="practice-move-input">
            {t('practice.moveInput')}
            <input id="practice-move-input" autoComplete="off" spellCheck={false} value={typedMove}
              onChange={(event) => { setTypedMove(event.target.value); setError(''); }} maxLength={15}
              className="min-h-11 rounded-lg border border-chesscom-300 bg-white px-3 font-mono text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100" />
          </label>
          <button type="submit" className="btn-primary min-h-11">{t('practice.submitMove')}</button>
        </form>
        <details className="mx-auto max-w-md rounded-lg border border-chesscom-200 p-3 text-sm dark:border-chesscom-700">
          <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">
            {t('practice.chooseCoordinates')}
          </summary>
          <p id="practice-choices-help" className="mt-2 text-xs text-chesscom-500">
            {t('practice.coordsHelp')}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <label htmlFor="practice-from" className="flex flex-col gap-1">
              {t('practice.pieceSelectLabel')}
              <select id="practice-from" aria-describedby="practice-choices-help" value={fromSquare}
                onChange={(event) => { setFromSquare(event.target.value); setToSquare(''); setPromotion(''); setError(''); }}
                className="min-h-11 w-full rounded-lg border border-chesscom-300 bg-white px-3 text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100">
                <option value="">{t('practice.piecePlaceholder')}</option>
                {origins.map((origin) => <option key={origin.square} value={origin.square}>
                  {pieceDescription({ type: origin.piece, square: origin.square })}
                </option>)}
              </select>
            </label>
            <label htmlFor="practice-to" className="flex flex-col gap-1">
              {t('practice.destinationLabel')}
              <select id="practice-to" disabled={!fromSquare} value={toSquare}
                onChange={(event) => { setToSquare(event.target.value); setPromotion(''); setError(''); }}
                className="min-h-11 w-full rounded-lg border border-chesscom-300 bg-white px-3 text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100">
                <option value="">{t('practice.destinationPlaceholder')}</option>
                {destinations.map((square) => <option key={square} value={square}>{square}</option>)}
              </select>
            </label>
            {promotions.length > 0 && <label htmlFor="practice-promotion" className="flex flex-col gap-1">
              {t('practice.promoteLabel')}
              <select id="practice-promotion" value={promotion}
                onChange={(event) => { setPromotion(event.target.value); setError(''); }}
                className="min-h-11 w-full rounded-lg border border-chesscom-300 bg-white px-3 text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100">
                <option value="">{t('practice.promotePlaceholder')}</option>
                {promotions.map((piece) => <option key={piece} value={piece}>{pieceName(piece)}</option>)}
              </select>
            </label>}
            <button type="button" className="btn-secondary min-h-11" disabled={!canPlaySquares}
              onClick={() => submitMove(fromSquare + toSquare + promotion)}>{t('practice.playChosen')}</button>
          </div>
        </details>
      </div>}
      {!attempt && error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{t(`practice.${error}`)}</p>}
      {attempt && <div className="mt-4 space-y-3 rounded-lg border border-chesscom-200 p-3 dark:border-chesscom-700">
        <p className="text-sm">{t('practice.yourMove')} <strong className="font-mono">{attempt.san}</strong></p>
        {pending && <p role="status" aria-live="polite" className="text-sm">{t('practice.checking')}</p>}
        {error && <div role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {t(`practice.${error}`)} <button type="button" className="ml-2 min-h-11 underline underline-offset-2" onClick={() => { setPending(true); setRetry((value) => value + 1); }}>{t('practice.retryScoring')}</button>
        </div>}
        {quality && <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p><strong>{t('practice.assessment')}</strong> {t(`classification.${quality.classification}`)}. {t('practice.winChanceLoss', { drop: quality.win_pct_drop.toFixed(1), depth: quality.depth_before })}</p>
          {quality.is_best ? <p>{t('practice.engineTopMatch')}</p>
            : ['good', 'excellent', 'great', 'brilliant', 'best'].includes(quality.classification)
              ? <p>{t('practice.soundAlternative')}</p>
              : <p>{t('practice.compare')}</p>}
          {quality.best_move_san && <p>{t('practice.enginePreferred')} <strong className="font-mono">{quality.best_move_san}</strong></p>}
          {quality.best_pv.length > 0 && <p>{t('practice.continuation')} <span className="font-mono">{quality.best_pv.slice(0, 6).join(' ')}</span></p>}
          <p className="text-xs text-chesscom-500">{t('practice.engineCaveat')}</p>
        </div>}
        <button type="button" className="btn-secondary min-h-11" onClick={reset}>
          {t(pending ? 'practice.cancelTry' : 'practice.tryAgain')}
        </button>
      </div>}
    </main>
  );
}
