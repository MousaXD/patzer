import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Loader2, Swords, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useLobby, type Challenge } from '../state/lobby';
import { useAuth } from '../state/auth';

export default function IncomingChallengeModal() {
  const { t } = useTranslation();
  const accountId = useAuth((s) => s.user?.id ?? null);
  const nav = useNavigate();
  const incoming = useLobby((s) => s.incoming);
  const activePlaySession = useLobby((s) => s.activePlaySession);
  const pendingAcceptedNav = useLobby((s) => s.pendingAcceptedNav);
  const refresh = useLobby((s) => s.refreshChallenges);
  const forgetChallenge = useLobby((s) => s.forgetChallenge);
  const [error, setError] = useState<'accept' | 'decline' | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [snoozedChallengeId, setSnoozedChallengeId] = useState<number | null>(null);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const inFlight = useRef(false);
  const actionSession = useRef({ account: accountId, generation: 0 });
  if (actionSession.current.account !== accountId) {
    actionSession.current = { account: accountId, generation: actionSession.current.generation + 1 };
  }
  useEffect(() => {
    inFlight.current = false;
    setBusy(null);
    setError(null);
    setUnavailable(false);
    setSnoozedChallengeId(null);
    return () => { actionSession.current.generation += 1; };
  }, [accountId]);
  useEffect(() => {
    if (!unavailable) return;
    const timeout = setTimeout(() => setUnavailable(false), 8000);
    return () => clearTimeout(timeout);
  }, [unavailable]);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Show only the most-recent
  const c: Challenge | undefined = incoming[0];
  useEffect(() => {
    setError(null);
    if (c?.id === undefined || activePlaySession) return;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (priorFocus?.isConnected) priorFocus.focus(); };
  }, [c?.id, activePlaySession]);

  // The invitation lives in the global lobby store. Only remove it after the
  // server accepts a mutation; otherwise a failed request must remain visible
  // and retryable. A failed follow-up list refresh must not undo success.
  async function act(action: 'accept' | 'decline', id: number) {
    if (inFlight.current) return;
    const generation = actionSession.current.generation;
    inFlight.current = true;
    setBusy(action);
    setError(null);
    try {
      if (action === 'accept') {
        const result = await api.post<{ game_id: number }>(`/api/challenges/${id}/accept`);
        if (actionSession.current.generation !== generation) return;
        forgetChallenge('incoming', id);
        nav(`/play?game=${result.game_id}`);
      } else {
        await api.post(`/api/challenges/${id}/decline`);
        if (actionSession.current.generation !== generation) return;
        forgetChallenge('incoming', id);
      }
      void refresh().catch(() => {});
    } catch (err) {
      if (actionSession.current.generation !== generation) return;
      const failure = err as { status?: number; data?: { error?: string } };
      if (failure.status === 409 && failure.data?.error === 'not_pending') {
        // The invitation may have expired while this tab was open, or the
        // opponent changed it elsewhere. It is not a network error to retry.
        forgetChallenge('incoming', id);
        setUnavailable(true);
        void refresh().catch(() => {});
      } else {
        setError(action);
      }
    } finally {
      if (actionSession.current.generation === generation) {
        inFlight.current = false;
        setBusy(null);
      }
    }
  }

  const accept = (id: number) => { void act('accept', id); };
  const decline = (id: number) => { void act('decline', id); };

  return (
    <>
      {c && activePlaySession && !pendingAcceptedNav && snoozedChallengeId !== c.id && (
        <div role="status" className="pointer-events-none fixed bottom-28 right-4 z-[55] flex w-[min(90vw,20rem)] items-start gap-2 rounded-xl border border-ink-200 bg-white p-3 text-sm text-chesscom-800 shadow-lift sm:bottom-4 dark:border-ink-700 dark:bg-chesscom-900 dark:text-chesscom-100">
          <span className="flex-1">{t('challenge.whilePlaying', {
            name: c.from.display_name,
            defaultValue: `New challenge from ${c.from.display_name}. Check it after your game if it's still available.`,
          })}</span>
          <button type="button" aria-label={t('common.close')} className="btn-ghost pointer-events-auto min-h-11 min-w-11 p-2"
            onClick={() => setSnoozedChallengeId(c.id)}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
      {unavailable && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[65] flex w-[min(92vw,28rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-amber-500/40 bg-white p-3 text-sm text-chesscom-800 shadow-lift dark:bg-chesscom-900 dark:text-chesscom-100">
          <span className="flex-1">{t('challenge.noLongerAvailable', { defaultValue: 'This invitation has expired or is no longer available.' })}</span>
          <button type="button" className="btn-ghost min-h-11 min-w-11 p-2"
            aria-label={t('common.close')} onClick={() => setUnavailable(false)}>
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
      <AnimatePresence>
      {c && !activePlaySession && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          role="dialog" aria-modal="true" aria-labelledby="challenge-dialog-title"
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first?.focus();
            }
          }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ y: 20, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: 0.95 }}
            className="card w-full max-w-md overflow-hidden shadow-lift"
          >
            <div className="flex items-center gap-3 border-b border-ink-100 bg-accent-500/10 px-5 py-3 dark:border-ink-700">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
                <Swords className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div id="challenge-dialog-title" className="font-semibold leading-tight">{t('challenge.incoming')}</div>
                <div className="text-xs text-ink-500">{t('challenge.someoneChallenges')}</div>
              </div>
              <button type="button" onClick={() => decline(c.id)} disabled={busy !== null}
                aria-label={t('challenge.decline')} className="btn-ghost min-h-11 min-w-11 p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-2xl dark:bg-ink-700">
                  {c.from.avatar_emoji}
                </div>
                <div>
                  <div className="font-semibold">{c.from.display_name}</div>
                  <div className="text-xs text-ink-500">@{c.from.username}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500">{t('play.color')}</div>
                  <div className="font-medium capitalize">{c.color === 'random' ? t('play.random') : t(`play.${c.color}`)}</div>
                </div>
                <div className="rounded-lg bg-ink-100 px-3 py-2 dark:bg-ink-800">
                  <div className="text-[11px] uppercase tracking-wide text-ink-500">{t('play.timeControl')}</div>
                  <div className="font-medium">{t(`play.tc.${c.time_control}`)}</div>
                </div>
              </div>
              {error && <p role="alert" className="rounded-md border border-move-mistake/40 bg-move-mistake/5 px-3 py-2 text-sm text-chesscom-800 dark:text-chesscom-100">
                {t(`challenge.error.${error}`, { defaultValue: error === 'accept'
                  ? 'Could not accept this challenge. Try again.'
                  : 'Could not decline this challenge. Try again.' })}
              </p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => decline(c.id)} disabled={busy !== null} className="btn-secondary min-h-11 flex-1">{t('challenge.decline')}</button>
                <button type="button" onClick={() => accept(c.id)} disabled={busy !== null} className="btn-primary min-h-11 flex-1">
                  {busy === 'accept' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('challenge.accept')}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </>
  );
}
