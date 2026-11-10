// AI-written Game Review panel. Renders the chess.com-style "Game Report"
// prose that comes from POST /api/games/:id/review (SSE streaming).

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Loader2 } from 'lucide-react';
import { renderMarkdown, stripReasoning } from '../lib/markdown';
import type { Language } from '../lib/languages';
import { moveNumberForPly, moveSideForPly } from './review/moveHistoryModel';
import { isCompleteReviewPayload, parseReviewProgress, takeReviewEvents, type ReviewProgressEvent } from './review/reviewStream';

export interface GameReviewProse {
  version: number;
  /** Historic prose was written using the old, inflated accuracy model. */
  accuracy_model_version?: number;
  language: Language;
  audience: string;
  opening: { eco: string; name: string; prose: string } | null;
  summary: string;
  skill_assessment: string;
  phases: {
    opening: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
    middlegame: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
    endgame: { from_ply: number; to_ply: number; accuracy: number; acpl: number; prose: string } | null;
  };
  key_moments: Array<{
    ply: number; side: 'white' | 'black'; san: string;
    classification: string; cp_loss: number; win_pct_delta: number;
    best_san: string | null; title: string; prose: string;
    /** v4+: whether it was the player's own move. */
    by_user?: boolean;
  }>;
}

interface Props {
  gameId: number;
  /** Existing cached review, if any. */
  initial: GameReviewProse | null;
  /** Reports back when a moment is clicked so the parent can move the board. */
  onMomentJump?: (ply: number) => void;
  /** Called when prose is freshly generated; parent caches in component state. */
  onGenerated?: (review: GameReviewProse) => void;
  /** The player's colour — older reports don't say whose move a moment was. */
  userColor?: 'white' | 'black' | null;
  startFen?: string;
}

export default function GameReportPanel({ gameId, initial, onMomentJump, onGenerated, userColor, startFen }: Props) {
  const { t } = useTranslation();
  const [review, setReview] = useState<GameReviewProse | null>(initial);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ReviewProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { setReview(initial); }, [initial]);
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  function cancelGeneration() {
    const pending = abortRef.current;
    if (!pending || pending.signal.aborted) return;
    pending.abort();
    abortRef.current = null;
    setBusy(false);
    setProgress(null);
    setError('Report generation cancelled. You can try again.');
  }

  async function generate() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true); setError(null); setProgress(null);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const res = await fetch(`/api/games/${gameId}/review`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? `HTTP ${res.status}`);
        setBusy(false);
        return;
      }
      reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let complete = false;
      let failed = false;
      while (true) {
        const { done, value } = await reader.read();
        if (ac.signal.aborted) return;
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parsed = takeReviewEvents(buf);
        buf = parsed.rest;
        for (const event of parsed.events) {
          if (ac.signal.aborted) return;
          if (event.type === 'progress') {
            try {
              const update = parseReviewProgress(JSON.parse(event.data));
              if (update) setProgress(update);
            } catch { /* ignore invalid progress */ }
          } else if (event.type === 'done') {
            try {
              const payload: unknown = JSON.parse(event.data);
              if (!isCompleteReviewPayload(payload)) throw new Error('missing or invalid report');
              const result = payload.review as unknown as GameReviewProse;
              setReview(result);
              onGenerated?.(result);
              complete = true;
            } catch (err) {
              failed = true;
              setError(`Report returned an invalid result: ${(err as Error).message}. Please retry.`);
            }
          } else if (event.type === 'error') {
            failed = true;
            setError(event.data || 'The report generator failed. Please retry.');
          }
        }
        // A valid terminal SSE event is sufficient. Waiting for a proxy to
        // close the HTTP stream can leave the button spinning indefinitely.
        if (complete || failed) break;
      }
      if (!complete && !failed && !ac.signal.aborted) {
        setError('The AI report connection ended before the report was complete. Please retry.');
      }
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
    } finally {
      // Close the response body even when it ends with an error or a valid
      // `done` event; otherwise an SSE connection can keep a server slot open.
      if (reader) void reader.cancel().catch(() => undefined);
      if (abortRef.current === ac) abortRef.current = null;
      if (!ac.signal.aborted) setBusy(false);
    }
  }

  // No outer card / header here — this panel is mounted INSIDE a tab labelled
  // "AI report" in the analyzer's tab strip. A second header inside is what
  // gave the page a "analysis within analysis" feel.
  if (!review && !busy) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-chesscom-500">{t('review.gameReportDesc', { defaultValue: 'A written breakdown of the game by the AI coach. Highlights phases, key moments, and a skill estimate.' })}</p>
        <button onClick={generate} className="btn-primary w-full text-sm">
          <Sparkles className="h-4 w-4" />
          {t('review.generateReport', { defaultValue: 'Write AI report' })}
        </button>
        {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
      </div>
    );
  }

  if (busy && !review) {
    const stepLabel = progress?.step ?? '...';
    const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-gold-500" />
          <span className="text-sm font-semibold">{t('review.generating', { defaultValue: 'Writing AI report…' })}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-800">
          <div className="h-full bg-gold-500 transition-all duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-xs text-chesscom-500">{stepLabel} · {progress?.done ?? 0}/{progress?.total ?? '?'}</div>
        <button type="button" onClick={cancelGeneration} className="btn-ghost self-start px-2 py-1 text-xs">
          {t('review.cancelGeneration', { defaultValue: 'Cancel generation' })}
        </button>
      </div>
    );
  }

  if (!review) return null;

  return (
    <div className="flex flex-col gap-3">
      {review.accuracy_model_version !== undefined && review.accuracy_model_version < 10 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-chesscom-800 dark:text-chesscom-200">
          <p>This AI report uses the old accuracy formula, so the percentages in its text may be outdated. Your game analysis is preserved.</p>
          <button type="button" className="btn-secondary self-start text-xs" disabled={busy} onClick={() => void generate()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Regenerate this report
          </button>
          {error && <p role="alert" className="text-bad">{error}</p>}
        </div>
      )}
      <div
        className="coach-md text-sm text-chesscom-800 dark:text-chesscom-100"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(stripReasoning(review.summary)) }}
      />
      <div className="rounded-lg bg-chesscom-50 px-3 py-2 text-xs italic text-chesscom-700 dark:bg-chesscom-900/40 dark:text-chesscom-200">
        {review.skill_assessment}
      </div>
      {review.opening && (
        <div className="text-xs text-chesscom-500">
          <span className="font-semibold text-chesscom-700 dark:text-chesscom-200">{review.opening.name}</span>
          {review.opening.eco && <span className="ml-1 font-mono">({review.opening.eco})</span>} — {review.opening.prose}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {(['opening', 'middlegame', 'endgame'] as const).map((k) => {
          const p = review.phases[k];
          if (!p) return null;
          return (
            <div key={k} className="rounded-lg bg-chesscom-50 p-2 text-xs dark:bg-chesscom-900/40">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold capitalize">{t(`review.${k}`, { defaultValue: k })}</span>
                <span className="font-mono text-chesscom-500">{p.accuracy.toFixed(1)}%</span>
              </div>
              <div className="mt-1 leading-relaxed">{p.prose}</div>
            </div>
          );
        })}
      </div>
      {review.key_moments.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-chesscom-500">{t('review.keyMoments')}</div>
          {review.key_moments.map((m) => {
            const side = moveSideForPly(m.ply, startFen);
            const mine = userColor ? side === userColor : (m.by_user ?? true);
            return (
            <button key={m.ply}
              onClick={() => onMomentJump?.(m.ply)}
              className="block w-full rounded-lg border border-chesscom-200 bg-white px-3 py-2 text-left text-xs hover:border-gold-500/40 hover:bg-gold-50/40 dark:border-chesscom-700 dark:bg-chesscom-800 dark:hover:bg-chesscom-900/40">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] tabular-nums text-chesscom-500">#{moveNumberForPly(m.ply, startFen)}{side === 'black' ? '…' : '.'}</span>
                <span className="font-semibold">{m.title}</span>
                <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${mine ? 'bg-gold-500/15 text-gold-700 dark:text-gold-300' : 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300'}`}>
                  {mine ? t('review.why.yourMove') : t('review.why.opponentMove')}
                </span>
              </div>
              <div className="mt-0.5 leading-relaxed text-chesscom-700 dark:text-chesscom-200">{m.prose}</div>
            </button>
            );
          })}
        </div>
      )}
      {error && <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
      {busy && <p role="status" className="text-xs text-chesscom-500">Updating the AI report…</p>}
      {busy && <button type="button" onClick={cancelGeneration} className="btn-ghost self-start px-2 py-1 text-xs">
        {t('review.cancelGeneration', { defaultValue: 'Cancel generation' })}
      </button>}
      <button onClick={generate} disabled={busy} className="btn-ghost self-start px-2 py-1 text-xs">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {t('review.regenerateReport', { defaultValue: 'Write it again' })}
      </button>
    </div>
  );
}
