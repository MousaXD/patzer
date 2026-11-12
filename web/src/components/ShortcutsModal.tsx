// Shortcuts modal — opened by ?
import { useTranslation } from 'react-i18next';
import { useRef } from 'react';
import { X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

interface Props { open: boolean; onClose: () => void }

export default function ShortcutsModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(open, dialogRef, onClose, closeRef);

  if (!open) return null;

  const groups: { title: string; rows: [string, string][] }[] = [
    {
      title: t('shortcuts.global', { defaultValue: 'Global' }),
      rows: [
        ['⌘ K · Ctrl K', t('shortcuts.openPalette', { defaultValue: 'Command palette' })],
        ['?', t('shortcuts.openShortcuts', { defaultValue: 'Show this dialog' })],
        ['G H', t('shortcuts.goHome', { defaultValue: 'Go to Home' })],
        ['G P', t('shortcuts.goPlay', { defaultValue: 'Go to Play' })],
        ['G R', t('shortcuts.goReview', { defaultValue: 'Go to Review' })],
        ['G I', t('shortcuts.goInsights', { defaultValue: 'Go to Insights' })],
        ['G T', t('shortcuts.goTrain', { defaultValue: 'Go to Tactic Trainer' })],
        ['G E', t('shortcuts.goLearn')],
        ['Esc', t('shortcuts.closeDialog', { defaultValue: 'Close any dialog' })],
      ],
    },
    {
      title: t('shortcuts.review', { defaultValue: 'Game Review' }),
      rows: [
        ['←  →', t('shortcuts.prevNext', { defaultValue: 'Previous / Next move' })],
        [t('shortcuts.homeEnd'), t('shortcuts.firstLast', { defaultValue: 'First / Last position' })],
        ['F', t('shortcuts.flipBoard', { defaultValue: 'Flip board' })],
        ['B', t('shortcuts.bookmark', { defaultValue: 'Toggle bookmark' })],
        ['S', t('shortcuts.share', { defaultValue: 'Copy link to position' })],
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
      <button type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-sm" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="patzer-shortcuts-title" tabIndex={-1}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-ui-border bg-ui-surface text-ui-foreground shadow-lift motion-safe:animate-fade-in">
        <div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
          <h2 id="patzer-shortcuts-title" className="text-sm font-semibold">{t('shortcuts.title', { defaultValue: 'Keyboard shortcuts' })}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ui-mutedText hover:bg-ui-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 space-y-5">
          {groups.map((g) => (
            <section key={g.title}>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ui-mutedText">{g.title}</div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 rounded-md bg-ui-muted px-3 py-1.5 text-xs">
                    <span className="text-ui-foreground">{v}</span>
                    <kbd className="shrink-0 font-mono text-xs text-ui-mutedText">{k}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
