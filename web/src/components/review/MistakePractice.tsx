import { useEffect, useRef, useState } from 'react';
import ChessBoard from '../ChessBoard';
import { postReviewAnalysis } from './reviewAnalysisRequest';
import { reviewVariationScoringRequest } from './reviewPosition';
import { createPracticeAttempt, verifiedPracticeQuality, type PracticeAttempt } from './mistakePractice';
import type { VariationMoveQuality } from '../../lib/classification';

interface Props {
  /** Exact position before the selected saved mistake. */
  fenBefore: string;
  orientation: 'white' | 'black';
  onExit: () => void;
}

/** Isolated practice surface: the analysis graph, best move, PGN and hints are
 * deliberately NOT mounted until the student has made an attempt. */
export default function MistakePractice({ fenBefore, orientation, onExit }: Props) {
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [quality, setQuality] = useState<VariationMoveQuality | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [typedMove, setTypedMove] = useState('');
  const [retry, setRetry] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

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

  const submitMove = (uci: string) => {
    if (attempt) return;
    const legal = createPracticeAttempt(fenBefore, uci);
    if (legal) setAttempt(legal);
    else setError('That move is not legal in this position. Try another.');
  };
  const reset = () => { setTypedMove(''); setAttempt(null); setQuality(null); setError(''); setPending(false); headingRef.current?.focus(); };
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
        <button type="button" className="btn-secondary min-h-11" onClick={exit}>Return to saved game</button>
      </div>
      <div className="mx-auto w-full max-w-[min(72dvh,560px)]">
        <div className="aspect-square w-full" aria-label="Practice chessboard">
          <ChessBoard key={attempt ? 'attempt' : 'blind'} fen={attempt?.fenAfter ?? fenBefore}
            orientation={orientation} analysisMode={!attempt} onMove={submitMove} />
        </div>
      </div>
      {!attempt && <div className="mt-4 space-y-3">
        <p className="text-center text-sm" role="status">Make one legal move on the board. The engine suggestion is hidden until you try.</p>
        <form className="flex flex-wrap items-end justify-center gap-2" onSubmit={(event) => { event.preventDefault(); submitMove(typedMove.trim()); }}>
          <label className="flex flex-col gap-1 text-sm" htmlFor="practice-move-input">
            Keyboard alternative: enter a move in UCI notation (e.g. e2e4)
            <input id="practice-move-input" autoComplete="off" spellCheck={false} value={typedMove}
              onChange={(event) => setTypedMove(event.target.value)} maxLength={5}
              className="min-h-11 rounded-lg border border-chesscom-300 bg-white px-3 font-mono text-chesscom-900 dark:border-chesscom-600 dark:bg-chesscom-900 dark:text-chesscom-100" />
          </label>
          <button type="submit" className="btn-primary min-h-11">Submit move</button>
        </form>
      </div>}
      {!attempt && error && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">{error}</p>}
      {attempt && <div className="mt-4 space-y-3 rounded-lg border border-chesscom-200 p-3 dark:border-chesscom-700">
        <p className="text-sm">Your move: <strong className="font-mono">{attempt.san}</strong></p>
        {pending && <p role="status" aria-live="polite" className="text-sm">Checking your move with Stockfish…</p>}
        {error && <div role="alert" className="text-sm text-amber-700 dark:text-amber-300">
          {error} <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setRetry((value) => value + 1)}>Retry scoring</button>
        </div>}
        {quality && <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <p><strong>Engine assessment:</strong> {quality.classification}. Estimated win-chance loss: {quality.win_pct_drop.toFixed(1)} percentage points (depth {quality.depth_before}).</p>
          {quality.best_move_san && <p>Engine-preferred move: <strong className="font-mono">{quality.best_move_san}</strong>{quality.is_best ? ' — your move matches the engine preference.' : ' — compare it with your attempt.'}</p>}
          {quality.best_pv.length > 0 && <p>Suggested continuation: <span className="font-mono">{quality.best_pv.slice(0, 6).join(' ')}</span></p>}
          <p className="text-xs text-chesscom-500">An engine assessment is not proof that only one move works. Other moves may be equally good.</p>
        </div>}
        <button type="button" className="btn-secondary min-h-11" onClick={reset}>Try another move</button>
      </div>}
    </main>
  );
}
