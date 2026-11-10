import { useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { api } from '../../api';

type UpdateInfo = {
  latestSha: string;
  deployedSha: string;
  updateAvailable: boolean;
  ready: boolean;
  status: 'up_to_date' | 'available' | 'waiting_for_ci' | 'manual_review_required';
  checkedAt: string;
  automaticSchedule: 'Every 12 hours';
};

function summary(status: UpdateInfo): string {
  switch (status.status) {
    case 'up_to_date': return 'Patzer is up to date.';
    case 'available': return 'A newer, CI-verified update is ready to install.';
    case 'waiting_for_ci': return 'A newer commit exists, but its checks have not passed yet.';
    case 'manual_review_required': return 'This update changes database code and requires manual review.';
  }
}

export default function AppUpdates() {
  const [status, setStatus] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  async function check() {
    setChecking(true);
    setError('');
    try {
      setStatus(await api.get<UpdateInfo>('/api/admin/local-updates/check'));
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : 'Unable to check for updates.');
    } finally { setChecking(false); }
  }

  async function install() {
    setInstalling(true);
    setError('');
    try {
      await api.post('/api/admin/local-updates/install');
      // A successful request starts an independently-running systemd service.
      // This page may briefly disconnect while the backend restarts.
    } catch (e) {
      setInstalling(false);
      setError(e instanceof Error ? e.message : 'Could not start the update.');
    }
  }

  return (
    <section className="card overflow-hidden" aria-label="Application updates">
      <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-500/15 text-accent-600">
          <Download className="h-4 w-4" />
        </div>
        <div>
          <h2 className="font-semibold">Application updates</h2>
          <p className="text-xs text-ink-500">GitHub main · automatic checks every 12 hours</p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <p className="text-sm text-ink-500 dark:text-ink-300">
          Check for a new version anytime. Checking never installs an update; only verified commits can be installed.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-secondary" disabled={checking || installing} onClick={() => void check()}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {checking ? 'Checking…' : 'Check for updates'}
          </button>
          {status?.ready && !installing && (
            <button type="button" className="btn-primary" onClick={() => void install()}>
              <Download className="h-4 w-4" /> Install verified update
            </button>
          )}
        </div>
        <div aria-live="polite" aria-atomic="true" className="space-y-1 text-sm">
          {status && !installing && (
            <div className="flex items-start gap-2 text-ink-600 dark:text-ink-300">
              {status.status === 'up_to_date' || status.ready
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
                : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
              <div>
                <p>{summary(status)}</p>
                <p className="mt-1 text-xs text-ink-500">
                  Installed: <code>{status.deployedSha.slice(0, 8)}</code>
                  {status.updateAvailable && <> · Latest: <code>{status.latestSha.slice(0, 8)}</code></>}
                </p>
              </div>
            </div>
          )}
          {installing && (
            <p role="status" className="flex items-start gap-2 text-ink-600 dark:text-ink-300">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              Update requested. Patzer may restart briefly. Refresh this page after the update finishes.
            </p>
          )}
          {error && <p role="alert" className="flex items-start gap-2 text-bad"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        </div>
      </div>
    </section>
  );
}
