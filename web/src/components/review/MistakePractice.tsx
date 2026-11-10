import { useEffect, useMemo, useRef, useState } from 'react';
import ChessBoard from '../ChessBoard';
import { postReviewAnalysis } from './reviewAnalysisRequest';
import { reviewVariationScoringRequest } from './reviewPosition';
import { createPracticeAttempt, legalPracticeChoices, verifiedPracticeQuality, type PracticeAttempt } from './mistakePractice';
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
export default function MistakePractice({ fenBefore, orientation, onExit, exitLabel = 'Return to saved game', boardTheme = 'green' }: Props) {
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [quality, setQuality] = useState<VariationMoveQuality | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [typedMove, setTypedMove] = useState('');
  const [selectedMove, setSelectedMove] = useState('');
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const choices = useMemo(() => legalPracticeChoices(fenBefore), [fenBefore]);

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
      else setError('The engine response did not match your attempt. No result has been assigned.');
    }).catch((err: unknown) => {
      if (!active || controller.signal.aborted) return;
      const status = (err as { status?: number } | null)?.status;
      setError(status === 429 ? 'The engine is busy. Try scoring again.' : 'The engine could not score this attempt. Try again.');
    }).finally(() => { if (active) setPending(false); });
    return () => { active = false; controller.abort(); };
  }, [attempt, retry]);

  const submitMove = (notation: string) => {
    if (attempt) return;
    const legal = createPracticeAttempt(fenBefore, notation);
    if (legal) { setError(''); setPending(true); setAttempt(legal); }
    else setError('That move is not legal in this position. Try another.');
  };
  const reset = () => { setTypedMove(''); setSelectedMove(''); setAttempt(null); setQuality(null); setError(''); setPending(false); headingRef.current?.focus(); };
  const exit = () => { onExit(); };

  return (
    <main data-practice-mode="true" className="mx-auto w-full max-w-3xl rounded-xl bg-white p-4 shadow-soft dark:bg-chesscom-800 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 tabIndex={-1} ref={headingRef} className="text-xl font-bold focus:outline-none">Learn from this mistake</h1>
          <p className="mt-1 text-sm text-chesscom-600 dark:text-chesscom-300">
            {attempt ? 'Your attempt is saved only in this practice view.' : 'You are back before the mistake. Find a better move without hints.'}
          </p>
        </div>
        <button type="button" className="btn-secondary min-h-11" onClick={exit}>{exitLabel}</button>
      </div>
      <div className="mx-auto w-full" style={{ maxWidth: 'min(72dvh, 560px, calc(100vw - 3.5rem))' }}>
        <div className={`aspect-square w-full board-theme-${boardTheme}`} aria-label="Practice chessboard">
          <ChessBoard key={attempt ? 'attempt' : 'blind'} fen={attempt?.fenAfter ?? fenBefore}
            orientation={orientation} analysisMode={!attempt} onMove={submitMove} />
        </div>
      </div>
      {!attempt && <div className="mt-4 space-y-3">
        <p className="text-center text-sm" role="status">Make one legal move on the board. The engine suggestion is hidden until you try.</p>
        <form className="flex flex-wrap items-end justify-center gap-2" onSubmit={(event) => { event.preventDefault(); submitMove(typedMove.trim()); }}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="practice-move-input">
            Type a legal chess move (e.g. e4, Nf3 or e2e4)
            <input id="practice-move-input" autoComplete="off" spellCheck={false} value={typedMove}
              onChange={(event) => { setTypedMove(event.target.value); setError(''); }} maxLength={15}
              className="min-h-11 rounded-lg border border-chesscom-300 bg-white px-3 font-mono text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100" />
          </label>
          <button type="submit" className="btn-primary min-h-11">Submit move</button>
        </form>
        <details className="mx-auto max-w-md rounded-lg border border-chesscom-200 p-3 text-sm dark:border-chesscom-700">
          <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-500">Or choose from all legal moves (keyboard accessible)</summary>
          <p id="practice-choices-help" className="mt-2 text-xs text-chesscom-500">These are legal moves only, not engine recommendations.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label htmlFor="practice-choice" className="flex min-w-0 flex-1 flex-col gap-1">Legal move
              <select id="practice-choice" aria-describedby="practice-choices-help" value={selectedMove}
                onChange={(event) => { setSelectedMove(event.target.value); setError(''); }}
                className="min-h-11 w-full rounded-lg border border-chesscom-300 bg-white px-3 text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100">
                <option value="">Select a move</option>
                {choices.map((move) => <option key={move.uci} value={move.uci}>{move.san} ({move.uci})</option>)}
              </select>
            </label>
            <button type="button" className="btn-secondary min-h-11" disabled={!selectedMove}
              onClick={() => submitMove(selectedMove)}>Play selected move</button>
          </div>
        </details>
      </div>}
      {!attempt && error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
      {attempt && <div className="mt-4 space-y-3 rounded-lg border border-chesscom-200 p-3 dark:border-chesscom-700">
        <p className="text-sm">Your move: <strong className="font-mono">{attempt.san}</strong></p>
        {pending && <p role="status" aria-live="polite" className="text-sm">Checking your move with Stockfish…</p>}
        {error && <div role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {error} <button type="button" className="ml-2 min-h-11 underline underline-offset-2" onClick={() => { setPending(true); setRetry((value) => value + 1); }}>Retry scoring</button>
        </div>}
        {quality && <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p><strong>Engine assessment:</strong> {quality.classification}. Estimated win-chance loss: {quality.win_pct_drop.toFixed(1)} percentage points (depth {quality.depth_before}).</p>
          {quality.is_best ? <p>Your move matches the engine's top candidate at this depth.</p>
            : ['good', 'excellent', 'great', 'brilliant', 'best'].includes(quality.classification)
              ? <p>This may be a sound alternative, even though the engine ranked another move first at this depth.</p>
              : <p>Review the engine's preferred continuation and compare the consequences. Its ranking can change with deeper analysis.</p>}
          {quality.best_move_san && <p>Engine-preferred move: <strong className="font-mono">{quality.best_move_san}</strong></p>}
          {quality.best_pv.length > 0 && <p>Suggested continuation: <span className="font-mono">{quality.best_pv.slice(0, 6).join(' ')}</span></p>}
          <p className="text-xs text-chesscom-500">An engine assessment is not proof that only one move works. Other moves may be equally good.</p>
        </div>}
        <button type="button" className="btn-secondary min-h-11" onClick={reset}>{pending ? 'Cancel check and try another move' : 'Try another move'}</button>
      </div>}
    </main>
  );
}
