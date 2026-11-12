import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { useAuthConfig } from '../lib/useAuthConfig';
import { humanizeError } from '../lib/errors';
import AuthShell from '../components/AuthShell';
import AuthOptionsUnavailable from '../components/AuthOptionsUnavailable';

// /login?sso_error=<code> after a failed single sign-on (see server/src/auth/oidc.ts).
const SSO_ERROR_KEYS: Record<string, string> = {
  unavailable: 'sso.errUnavailable',
  expired: 'sso.errExpired',
  denied: 'sso.errDenied',
  not_provisioned: 'sso.errNotProvisioned',
  conflict: 'sso.errConflict',
  admin_first: 'sso.errAdminFirst',
  rate_limited: 'auth.errRateLimited',
};

export default function Login() {
  const { t } = useTranslation();
  const { refresh } = useAuth();
  const { config, loaded, error: configError, retry: retryConfig } = useAuthConfig();
  const [params] = useSearchParams();
  const ssoError = params.get('sso_error');
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unverified, setUnverified] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(''); setUnverified(false);
    try {
      await api.post('/api/auth/login', { username, password });
      await refresh();
      nav('/');
    } catch (err) {
      const code = (err as { data?: { error?: string } })?.data?.error;
      if (code === 'email_unverified') {
        setUnverified(true);
        setError(t('auth.errEmailUnverified'));
      } else if (code && code !== 'invalid_credentials') {
        setError(humanizeError(err, t));
      } else {
        setError(t('login.invalid'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={t('login.title')} variant="welcome">
      {!loaded ? (
        <div role="status" aria-live="polite" className="space-y-3" data-auth-config-loading>
          <div aria-hidden="true" className="ui-skeleton h-10 w-full motion-reduce:animate-none" />
          <div aria-hidden="true" className="ui-skeleton h-10 w-full motion-reduce:animate-none" />
          <p className="text-sm text-ui-mutedText">
            {t('authShell.loadingAuth', { defaultValue: 'Checking sign-in options…' })}
          </p>
        </div>
      ) : configError ? (
        <AuthOptionsUnavailable onRetry={retryConfig} />
      ) : (
        <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
          {ssoError && (
            <div role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
              {t(SSO_ERROR_KEYS[ssoError] ?? 'sso.errFailed')}
            </div>
          )}
          {config.oidc_enabled && (
            // A real link preserves the provider redirect contract.
            <a href="/api/auth/oidc/start" className={`${config.oidc_only ? 'btn-primary' : 'btn-secondary'} w-full`}>
              <KeyRound aria-hidden="true" className="h-4 w-4" />
              {config.oidc_button_text || t('sso.signIn')}
            </a>
          )}
          {config.oidc_enabled && !config.oidc_only && (
            <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ui-mutedText">
              <span className="h-px flex-1 bg-ui-border" />
              {t('sso.or')}
              <span className="h-px flex-1 bg-ui-border" />
            </div>
          )}
          {!config.oidc_only && (
            <>
              <div>
                <label className="label mb-1 block" htmlFor="login-username">{t('common.username')}</label>
                <input id="login-username" className="input" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block" htmlFor="login-password">{t('common.password')}</label>
                <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {error && (
                <div role="alert" aria-live="assertive" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
                  {error}
                  {unverified && (
                    <Link to="/verify-email" className="mt-1 block font-medium underline">{t('auth.resendVerification')}</Link>
                  )}
                </div>
              )}
              <button type="submit" disabled={busy || !username || !password} className="btn-primary min-h-11 w-full">
                <LogIn aria-hidden="true" className="h-4 w-4" />
                {busy ? t('login.submitting') : t('login.submit')}
              </button>
              {(config.signup_enabled || config.email_enabled) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
                  {config.signup_enabled
                    ? <Link to="/signup" className="inline-flex min-h-11 max-w-full items-center font-medium text-ui-primary hover:underline">
                        {config.signup_mode === 'invite' ? t('auth.haveInvite') : t('auth.createAccount')}
                      </Link>
                    : <span />}
                  {config.email_enabled && (
                    <Link to="/forgot-password" className="inline-flex min-h-11 max-w-full items-center text-ui-mutedText hover:text-ui-foreground hover:underline">{t('auth.forgotPassword')}</Link>
                  )}
                </div>
              )}
            </>
          )}
        </form>
      )}
    </AuthShell>
  );
}
