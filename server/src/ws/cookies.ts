import type { IncomingMessage } from 'node:http';
import { getSetting } from '../db.js';

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const rawVal = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(rawVal);
    } catch {
      // Malformed percent-encoding in an unrelated cookie must not crash upgrade.
      out[key] = rawVal;
    }
  }
  return out;
}

/** Validate the browser Origin header on WebSocket upgrade requests to prevent
 *  Cross-Site WebSocket Hijacking (CSWSH). Non-browser clients that omit Origin
 *  are permitted because they cannot carry ambient browser session cookies. */
export function isAllowedWsOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const reqHost = req.headers.host?.toLowerCase();
  if (reqHost && parsed.host.toLowerCase() === reqHost) return true;
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return true;
  const configured = getSetting('public_base_url') || process.env.PUBLIC_BASE_URL;
  if (configured) {
    try {
      if (new URL(configured).origin.toLowerCase() === parsed.origin.toLowerCase()) return true;
    } catch { /* ignore invalid setting */ }
  }
  return false;
}
