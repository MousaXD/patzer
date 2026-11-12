import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, FileClock, RefreshCw, X } from 'lucide-react';
import { renderMarkdown } from '../lib/markdown';
import { useDialogFocus } from './useDialogFocus';

interface Props { onClose: () => void }
type LoadState = 'loading' | 'ready' | 'empty' | 'error';

/** A reusable release-notes dialog for desktop version labels and mobile menus. */
export default function ChangelogModal({ onClose }: Props) {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<LoadState>('loading');
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);

  useDialogFocus(true, dialogRef, onClose, closeRef);

  const loadNotes = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus('loading');
    fetch('/api/meta/changelog', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Release notes request failed: ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (controller.signal.aborted) return;
        setContent(text);
        setStatus(text.trim() ? 'ready' : 'empty');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus('error');
      });
  }, []);

  useEffect(() => {
    loadNotes();
    return () => requestRef.current?.abort();
  }, [loadNotes]);

  const title = t('changelog.title', { defaultValue: 'Release notes' });
  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose}
        className="absolute inset-0 bg-ui-overlay" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="patzer-changelog-title" tabIndex={-1}
        className="relative flex max-h-[85dvh] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-ui-border bg-ui-surface text-ui-foreground shadow-lift sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-ui-border px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <FileClock aria-hidden="true" className="h-5 w-5 shrink-0 text-ui-primary" />
            <h2 id="patzer-changelog-title" className="truncate text-base font-semibold tracking-tight sm:text-lg">{title}</h2>
          </div>
          <button type="button" ref={closeRef} aria-label={t('common.close')} onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ui-mutedText hover:bg-ui-hover hover:text-ui-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-5 sm:p-6" aria-busy={status === 'loading'}>
          {status === 'loading' && (
            <div role="status" aria-live="polite" className="flex min-h-32 flex-col items-center justify-center gap-3 text-sm text-ui-mutedText">
              <span aria-hidden="true" className="h-7 w-7 animate-pulse rounded-full border-2 border-ui-border border-t-ui-primary motion-reduce:animate-none" />
              {t('changelog.loading', { defaultValue: 'Loading release notes…' })}
            </div>
          )}
          {status === 'error' && (
            <div role="alert" className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <AlertCircle aria-hidden="true" className="h-7 w-7 text-ui-danger" />
              <p className="max-w-sm text-sm text-ui-mutedText">{t('changelog.error', { defaultValue: 'Release notes could not be loaded right now.' })}</p>
              <button type="button" onClick={loadNotes} className="btn-secondary min-h-11">
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                {t('changelog.retry', { defaultValue: 'Try again' })}
              </button>
            </div>
          )}
          {status === 'empty' && (
            <div role="status" data-changelog-empty className="flex min-h-32 flex-col items-center justify-center gap-3 text-center text-ui-mutedText">
              <FileClock aria-hidden="true" className="h-7 w-7" />
              <p className="max-w-sm text-sm">{t('changelog.empty', { defaultValue: 'No release notes are available yet.' })}</p>
            </div>
          )}
          {status === 'ready' && (
            <div className="release-notes-content text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          )}
        </div>
      </div>
    </div>
  );
}
