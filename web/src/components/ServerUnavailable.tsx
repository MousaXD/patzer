import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, WifiOff } from 'lucide-react';
import AuthShell from './AuthShell';

interface Props {
  onRetry: () => Promise<void>;
}

/** Connection failures must not masquerade as an unauthenticated session. */
export default function ServerUnavailable({ onRetry }: Props) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <AuthShell
      title={t('bootstrap.title', { defaultValue: 'Server unavailable' })}
      subtitle={t('bootstrap.subtitle', { defaultValue: 'Patzer could not reach its server.' })}
    >
      <div role="alert" aria-label={t('bootstrap.alertLabel', { defaultValue: 'Server unavailable' })}
        className="flex items-start gap-3 rounded-xl border border-ui-border bg-ui-muted p-4">
        <WifiOff aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ui-danger" />
        <p className="text-sm leading-relaxed text-ui-mutedText">
          {t('bootstrap.help', { defaultValue: 'Check that Patzer is running and try connecting again.' })}
        </p>
      </div>
      <button type="button" onClick={() => { void retry(); }} disabled={retrying}
        className="btn-primary min-h-11 w-full">
        <RefreshCw aria-hidden="true" className={`h-4 w-4 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {retrying
          ? t('bootstrap.reconnecting', { defaultValue: 'Reconnecting…' })
          : t('bootstrap.retry', { defaultValue: 'Try again' })}
      </button>
    </AuthShell>
  );
}
