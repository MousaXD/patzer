import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** No authentication method can be inferred when the server capability probe fails. */
export default function AuthOptionsUnavailable({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" data-auth-options-error>
      <div role="alert" aria-label={t('authShell.optionsUnavailable', { defaultValue: 'Sign-in options unavailable' })}
        className="flex items-start gap-3 rounded-xl border border-ui-border bg-ui-muted p-4">
        <AlertCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ui-danger" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-ui-foreground">
            {t('authShell.optionsUnavailable', { defaultValue: 'Sign-in options unavailable' })}
          </p>
          <p className="text-sm leading-relaxed text-ui-mutedText">
            {t('authShell.optionsHelp', { defaultValue: 'Patzer could not check the sign-in methods supported by this server. Try again to continue.' })}
          </p>
        </div>
      </div>
      <button type="button" onClick={onRetry} className="btn-primary min-h-11 w-full">
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
        {t('authShell.optionsRetry', { defaultValue: 'Try again' })}
      </button>
    </div>
  );
}
