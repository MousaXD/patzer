import type { Context } from 'hono';
import { config } from './config.js';
import { getSetting } from './db.js';

// Reject host values that could inject paths, credentials, whitespace, or schemes.
function sanitizeHost(raw: string | undefined): string | null {
  if (!raw) return null;
  const host = raw.split(',')[0]!.trim();
  if (!host || /[\s/\\@?#]/.test(host)) return null;
  try {
    const u = new URL(`http://${host}`);
    return u.host || null;
  } catch {
    return null;
  }
}

// Public base URL used to build absolute links (emails, invite links). Prefer
// an explicit operator setting (handles reverse-proxy / public-hostname deploys
// where the request's Host header is the internal one), then env, then the
// incoming request. Forwarded headers are only honored when TRUST_PROXY is on.
// Trailing slash trimmed.
export function publicBaseUrl(c: Context): string {
  const fromSetting = getSetting('public_base_url');
  if (fromSetting) return fromSetting.replace(/\/+$/, '');
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const trustProxy = config.trustProxy || /^(1|true|yes|on)$/i.test(process.env.TRUST_PROXY ?? '');
  const rawProto = trustProxy ? c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() : undefined;
  const proto = rawProto === 'https' || rawProto === 'http' ? rawProto : (new URL(c.req.url).protocol === 'https:' ? 'https' : 'http');
  const host = sanitizeHost(trustProxy ? (c.req.header('x-forwarded-host') || c.req.header('host')) : c.req.header('host'));
  if (host) return `${proto}://${host}`;
  return new URL(c.req.url).origin;
}
