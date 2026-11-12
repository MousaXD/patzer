import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Swords, X } from 'lucide-react';
import { useLobby } from '../state/lobby';

/** The sender's half of a friend challenge is a real saved game as soon as the
 * recipient accepts. Never switch away from an ongoing game without consent. */
export default function AcceptedChallengeNotice() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const accepted = useLobby((s) => s.pendingAcceptedNav);
  const queuedCount = useLobby((s) => s.queuedAcceptedNavs.length);
  const activePlaySession = useLobby((s) => s.activePlaySession);
  const consume = useLobby((s) => s.consumeAcceptedNav);

  useEffect(() => {
    if (!accepted || accepted.deferred || activePlaySession) return;
    const ready = consume();
    if (ready) navigate(`/play?game=${ready.game_id}`);
  }, [accepted, activePlaySession, consume, navigate]);

  if (!accepted || !accepted.deferred) return null;

  function join() {
    const ready = consume();
    if (ready) navigate(`/play?game=${ready.game_id}`);
  }

  return (
    <div role="status" className="pointer-events-none fixed bottom-28 right-4 z-[56] w-[min(90vw,21rem)] rounded-xl border border-emerald-500/40 bg-white p-3 text-sm text-chesscom-800 shadow-lift sm:bottom-4 dark:bg-chesscom-900 dark:text-chesscom-100">
      <div className="flex items-start gap-2">
        <Swords aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1">{t('challenge.acceptedWhilePlaying', {
          defaultValue: 'Your friend accepted the challenge. Your new game is ready when you are.',
        })}</span>
        <button type="button" aria-label={t('common.close')} className="btn-ghost pointer-events-auto min-h-11 min-w-11 shrink-0 p-2"
          onClick={() => consume()}>
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-chesscom-600 dark:text-chesscom-200" aria-live="polite">
          {queuedCount > 0 ? t('challenge.moreAccepted', {
            count: queuedCount,
            defaultValue: `${queuedCount} more accepted`,
          }) : null}
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => consume()} className="btn-secondary pointer-events-auto min-h-11 text-xs">
            {t('challenge.joinLater', { defaultValue: 'Not now' })}
          </button>
          <button type="button" onClick={join} className="btn-primary pointer-events-auto min-h-11 text-xs">
            {t('challenge.joinAccepted', { defaultValue: 'Join game' })}
          </button>
        </div>
      </div>
    </div>
  );
}
