import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Home, RefreshCw } from 'lucide-react';
import { LogoMark } from './Logo';

/**
 * The last-resort route boundary. Never render technical error objects or
 * stack traces in the UI: they may contain paths, query strings or secrets.
 * Keep this component independent of app/auth state so it still works if
 * rendering that state caused the original failure.
 */
export default function GlobalRouterError() {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { headingRef.current?.focus(); }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ui-bg px-4 py-10 text-ui-foreground sm:px-6">
      <div className="w-full max-w-md">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <LogoMark size={56} />
          <span className="text-xl font-bold tracking-tight">{t('app.name')}</span>
        </div>
        <div className="ui-card space-y-5 p-5 shadow-ui-soft sm:p-7">
          <div role="alert" aria-label={t('routerError.alertLabel', { defaultValue: 'Page unavailable' })}
            className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-ui-border bg-ui-muted">
              <AlertTriangle aria-hidden="true" className="h-5 w-5 text-ui-danger" />
            </div>
            <div className="min-w-0">
              <h1 ref={headingRef} tabIndex={-1} className="router-error-heading text-xl font-semibold tracking-tight">
                {t('routerError.title', { defaultValue: 'This page could not load' })}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-ui-mutedText">
                {t('routerError.description', { defaultValue: 'Something interrupted Patzer. Try reloading the page or returning home.' })}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => window.location.reload()} className="btn-primary min-h-11 w-full">
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t('routerError.reload', { defaultValue: 'Reload page' })}
            </button>
            <a href="/" className="btn-secondary min-h-11 w-full">
              <Home aria-hidden="true" className="h-4 w-4" />
              {t('routerError.home', { defaultValue: 'Go home' })}
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
