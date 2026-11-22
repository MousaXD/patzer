import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Hono } from 'hono';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-security-hardening-'));
process.env.DB_PATH = join(scratch, 'security.db');

let db: typeof import('../src/db.js')['db'];
let sessions: typeof import('../src/auth/sessions.js');
let tokens: typeof import('../src/auth/tokens.js');
let wsCookies: typeof import('../src/ws/cookies.js');
let mailer: typeof import('../src/email/mailer.js');
let adminRouter: typeof import('../src/routes/admin.js')['default'];
let publicUrlMod: typeof import('../src/publicUrl.js');
let adminCookie: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  sessions = await import('../src/auth/sessions.js');
  tokens = await import('../src/auth/tokens.js');
  wsCookies = await import('../src/ws/cookies.js');
  mailer = await import('../src/email/mailer.js');
  adminRouter = (await import('../src/routes/admin.js')).default;
  publicUrlMod = await import('../src/publicUrl.js');

  db.prepare(`INSERT INTO users(id, username, password_hash, role)
    VALUES (1,'admin1','x','admin'), (2,'admin2','x','admin'), (3,'alice','x','user')`).run();
  db.prepare(`INSERT INTO profiles(user_id, display_name)
    VALUES (1,'Admin One'), (2,'Admin Two'), (3,'Alice')`).run();
  adminCookie = `${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(sessions.createSession(1))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(scratch, { recursive: true, force: true });
});

describe('session & token hardening', () => {
  it('returns null instead of throwing RangeError on 64 non-hex signature chars', () => {
    const nonHexSig = 'z'.repeat(64);
    expect(() => sessions.lookupUser(`abc123.${nonHexSig}`)).not.toThrow();
    expect(sessions.lookupUser(`abc123.${nonHexSig}`)).toBeNull();
  });

  it('rejects ISO-8601 sessions expired minutes ago on the same UTC day', () => {
    const signed = sessions.createSession(3);
    const rawToken = signed.split('.')[0]!;
    const fiveMinAgoIso = new Date(Date.now() - 5 * 60_000).toISOString();
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(fiveMinAgoIso, rawToken);
    expect(sessions.lookupUser(signed)).toBeNull();
  });

  it('rejects ISO-8601 auth tokens expired minutes ago on the same UTC day', () => {
    const raw = tokens.issueToken(3, 'reset');
    const fiveMinAgoIso = new Date(Date.now() - 5 * 60_000).toISOString();
    db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE user_id = 3').run(fiveMinAgoIso);
    expect(tokens.consumeToken(raw, 'reset')).toBeNull();
  });

  it('accepts valid unexpired auth tokens once', () => {
    const raw = tokens.issueToken(3, 'verify');
    expect(tokens.consumeToken(raw, 'verify')).toBe(3);
    expect(tokens.consumeToken(raw, 'verify')).toBeNull();
  });
});

describe('WebSocket cookie & origin hardening', () => {
  it('parses malformed percent-encoded cookies without throwing URIError', () => {
    expect(() => wsCookies.parseCookies('bad=%E0%A4%A; chess_session=abc.123')).not.toThrow();
    const parsed = wsCookies.parseCookies('bad=%ZZ; chess_session=abc.123');
    expect(parsed.chess_session).toBe('abc.123');
    expect(parsed.bad).toBe('%ZZ');
  });

  it('validates Origin header on WebSocket upgrades', () => {
    const makeReq = (origin?: string, host = 'chess.local:8800') =>
      ({ headers: { host, ...(origin !== undefined ? { origin } : {}) } }) as unknown as IncomingMessage;
    expect(wsCookies.isAllowedWsOrigin(makeReq(undefined))).toBe(true);
    expect(wsCookies.isAllowedWsOrigin(makeReq('https://chess.local:8800'))).toBe(true);
    expect(wsCookies.isAllowedWsOrigin(makeReq('http://localhost:5173'))).toBe(true);
    expect(wsCookies.isAllowedWsOrigin(makeReq('https://evil.example'))).toBe(false);
    expect(wsCookies.isAllowedWsOrigin(makeReq('not-a-url'))).toBe(false);
  });
});

describe('email HTML escaping', () => {
  it('escapes HTML tags and attributes in transactional templates', () => {
    const tpl = mailer.adminNewUserTemplate('Admin', '<script>alert(1)</script>', 'a"b@c.com');
    expect(tpl.html).not.toContain('<script>');
    expect(tpl.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(tpl.html).toContain('a&quot;b@c.com');

    const verify = mailer.verifyEmailTemplate('<b>Bob</b>', 'https://example.com/?a="x"');
    expect(verify.html).not.toContain('<b>Bob</b>');
    expect(verify.html).toContain('&lt;b&gt;Bob&lt;/b&gt;');
    expect(verify.html).toContain('href="https://example.com/?a=&quot;x&quot;"');
  });
});

describe('admin SSRF, DeepSeek key protection & session revocation', () => {
  it('blocks metadata SSRF and mismatched DeepSeek host on /test/ollama', async () => {
    const ssrfRes = await adminRouter.request('/test/ollama', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
      body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data', provider: 'ollama' }),
    });
    expect(ssrfRes.status).toBe(400);
    expect((await ssrfRes.json() as { error: string }).error).toBe('blocked_host');

    const dsRes = await adminRouter.request('/test/ollama', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
      body: JSON.stringify({ url: 'https://evil.example', provider: 'deepseek' }),
    });
    expect(dsRes.status).toBe(400);
    expect((await dsRes.json() as { error: string }).error).toBe('deepseek_host_mismatch');
  });

  it('revokes target user sessions on password reset and admin demotion', async () => {
    const aliceCookie = sessions.createSession(3);
    expect(sessions.lookupUser(aliceCookie)).not.toBeNull();

    const pwRes = await adminRouter.request('/users/3', {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
      body: JSON.stringify({ password: 'new-strong-password-123' }),
    });
    expect(pwRes.status).toBe(200);
    expect(sessions.lookupUser(aliceCookie)).toBeNull();

    const admin2Session = sessions.createSession(2);
    expect(sessions.lookupUser(admin2Session)).not.toBeNull();

    const demoteRes = await adminRouter.request('/users/2', {
      method: 'PATCH',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json', 'X-Requested-With': 'patzer' },
      body: JSON.stringify({ role: 'user' }),
    });
    expect(demoteRes.status).toBe(200);
    expect(sessions.lookupUser(admin2Session)).toBeNull();
  });
});

describe('publicBaseUrl proxy header gating', () => {
  it('ignores forged X-Forwarded-Host when TRUST_PROXY is off', async () => {
    const prev = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      const app = new Hono();
      app.get('/u', (c) => c.json({ url: publicUrlMod.publicBaseUrl(c) }));
      const res = await app.request('http://localhost:8800/u', {
        headers: {
          Host: 'localhost:8800',
          'X-Forwarded-Host': 'evil.example',
          'X-Forwarded-Proto': 'https',
        },
      });
      expect((await res.json() as { url: string }).url).toBe('http://localhost:8800');
    } finally {
      if (prev !== undefined) process.env.TRUST_PROXY = prev;
    }
  });
});
