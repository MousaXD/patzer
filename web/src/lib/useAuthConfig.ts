import { useEffect, useState } from 'react';
import { api } from '../api';

export interface AuthConfig {
  signup_enabled: boolean;
  signup_mode: 'open' | 'invite' | 'closed';
  email_enabled: boolean;
  // Single sign-on: show the SSO button; hide the password form (oidc_only);
  // the button label set by the operator (null = translated default).
  oidc_enabled: boolean;
  oidc_only: boolean;
  oidc_button_text: string | null;
}

type ConfigStatus = 'loading' | 'ready' | 'error';
const CAPABILITY_TIMEOUT_MS = 8_000;

const FALLBACK_CONFIG: AuthConfig = {
  signup_enabled: false,
  signup_mode: 'closed',
  email_enabled: false,
  oidc_enabled: false,
  oidc_only: false,
  oidc_button_text: null,
};

function isAuthConfig(value: unknown): value is AuthConfig {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as Record<string, unknown>;
  return typeof config.signup_enabled === 'boolean'
    && (config.signup_mode === 'open' || config.signup_mode === 'invite' || config.signup_mode === 'closed')
    && typeof config.email_enabled === 'boolean'
    && typeof config.oidc_enabled === 'boolean'
    && typeof config.oidc_only === 'boolean'
    && (config.oidc_button_text === null || typeof config.oidc_button_text === 'string');
}

// Public capability probe (GET /api/auth/config). A failed/invalid response
// must never become a guessed password form: SSO-only installations cannot
// authenticate with passwords. Keep controls hidden until capabilities are
// authoritative, and offer an in-place retry on transient failures.
export function useAuthConfig(): {
  config: AuthConfig;
  loaded: boolean;
  error: boolean;
  retry: () => void;
} {
  const [config, setConfig] = useState<AuthConfig>(FALLBACK_CONFIG);
  const [status, setStatus] = useState<ConfigStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let expired = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      expired = true;
      controller.abort();
      if (alive) setStatus('error');
    }, CAPABILITY_TIMEOUT_MS);
    setStatus('loading');
    api.get<unknown>('/api/auth/config', { signal: controller.signal })
      .then((response) => {
        if (!alive || expired) return;
        if (!isAuthConfig(response)) throw new Error('Invalid auth capabilities');
        setConfig(response);
        setStatus('ready');
      })
      .catch(() => {
        if (alive && !expired) setStatus('error');
      })
      .finally(() => window.clearTimeout(timeoutId));
    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [attempt]);
  return {
    config,
    loaded: status !== 'loading',
    error: status === 'error',
    retry: () => { setStatus('loading'); setAttempt((current) => current + 1); },
  };
}
