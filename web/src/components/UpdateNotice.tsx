import { useEffect, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';

// Tells you when the box you're running is behind the latest release. A
// self-hosted app can't update itself — and shouldn't — but it can stop you
// finding out six months late that the thing you wanted was fixed in July.
//
// Deliberately quiet: one line, dismissible, and once you dismiss a version
// you never see that version again (per browser). The server does the actual
// checking, at most once every six hours, and it can be turned off entirely
// in Admin → System.

interface UpdateResponse {
  enabled: boolean;
  updateAvailable: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  checkedAt: string | null;
}

const DISMISS_KEY = 'update.dismissed';

interface Props {
  onKeyboardDismiss?: () => void;
}

export default function UpdateNotice({ onKeyboardDismiss }: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [info, setInfo] = useState<UpdateResponse | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return localStorage.getItem(DISMISS_KEY); } catch { return null; }
  });

  useEffect(() => {
    api.get<UpdateResponse>('/api/meta/update')
      .then(setInfo)
      .catch(() => { /* an update check is never worth an error in the UI */ });
  }, []);

  if (!info?.enabled || !info.updateAvailable || !info.latest) return null;
  if (dismissed === info.latest) return null;

  function dismiss(event: MouseEvent<HTMLButtonElement>) {
    const v = info?.latest ?? null;
    setDismissed(v);
    try { if (v) localStorage.setItem(DISMISS_KEY, v); } catch { /* ignore */ }
    // Keyboard/assistive-tech button activation has detail=0. The dismiss
    // control is unmounted immediately, so hand focus to a persistent shell
    // control rather than dropping the user back to the document body.
    if (event.detail === 0) onKeyboardDismiss?.();
  }

  return (
    <div role="status" className="border-b border-gold-500/30 bg-gold-500/10 px-3 py-1.5 text-sm text-chesscom-900 dark:text-chesscom-100 sm:px-6">
      <div className="mx-auto flex max-w-[1920px] items-center gap-2 sm:gap-3">
        <ArrowUpCircle aria-hidden="true" className="h-4 w-4 shrink-0 text-gold-600 dark:text-gold-400" />
        <span className="min-w-0 flex-1">
          {t('update.available', {
            latest: info.latest,
            current: info.current,
            defaultValue: 'Patzer {{latest}} is out — you are running {{current}}.',
          })}{' '}
          {info.url && (
            <a href={info.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-gold-700">
              {t('update.whatsNew', { defaultValue: "What's new" })}
            </a>
          )}
          {user?.role === 'admin' && <span className="hidden text-ui-mutedText sm:inline">
            {' · '}
            {t('update.how', { defaultValue: 'Pull the new image and recreate the container.' })}
          </span>}
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-chesscom-600 hover:bg-black/5 hover:text-chesscom-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 dark:text-chesscom-200 dark:hover:bg-white/10 dark:hover:text-white"
          title={t('update.dismiss', { defaultValue: 'Dismiss until the next release' })}
          aria-label={t('update.dismiss', { defaultValue: 'Dismiss until the next release' })}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
