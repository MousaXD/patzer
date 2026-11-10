import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));
const folder = mkdtempSync(join(tmpdir(), 'patzer-updates-test-'));
process.env.DB_PATH = join(folder, 'patzer.db');
process.env.HOST = '127.0.0.1';
let router: { request: (url: string, init?: RequestInit) => Response | Promise<Response> };
let db: typeof import('../src/db.js')['db'];
let adminCookie = '';
let userCookie = '';
const ready = {
  latestSha: 'a'.repeat(40), deployedSha: 'b'.repeat(40), updateAvailable: true,
  ready: true, status: 'available', checkedAt: '2026-11-11T00:00:00Z', automaticSchedule: 'Every 12 hours',
};

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  router = (await import('../src/routes/localUpdates.js')).default;
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (1,'admin','x','admin')").run();
  db.prepare("INSERT INTO users (id,username,password_hash,role) VALUES (2,'user','x','user')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (1,'Admin')").run();
  db.prepare("INSERT INTO profiles (user_id,display_name) VALUES (2,'User')").run();
  adminCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  userCookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
});
afterAll(() => { db.close(); rmSync(folder, { force: true, recursive: true }); });
beforeEach(() => {
  execFile.mockReset();
  execFile.mockImplementation((file: string, args: string[], _options: unknown, callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    if (file.endsWith('patzer-github-updater') && args.join(' ') === '--status-json') callback(null, JSON.stringify(ready), '');
    else if (file === '/usr/bin/systemctl' && args.join(' ') === '--user start --no-block patzer-github-update.service') callback(null, '', '');
    else callback(new Error('Unexpected command invocation'));
  });
});

describe('Admin-only local GitHub updater API', () => {
  it('rejects anonymous and non-admin callers before running any command', async () => {
    for (const path of ['/check', '/install']) {
      const method = path === '/check' ? 'GET' : 'POST';
      expect((await router.request(path, { method })).status).toBe(401);
      expect((await router.request(path, { method, headers: { Cookie: userCookie } })).status).toBe(403);
    }
    expect(execFile).not.toHaveBeenCalled();
  });
  it('does not expose service management through an untrusted hostname', async () => {
    const res = await router.request('http://evil.example/check', { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(403);
    expect(execFile).not.toHaveBeenCalled();
  });
  it('checks for updates without starting an installation', async () => {
    const res = await router.request('/check', { headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(ready);
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile.mock.calls[0][1]).toEqual(['--status-json']);
  });
  it('does not run the install unit when already current or when CI is pending', async () => {
    for (const update of [
      { updateAvailable: false, ready: false, status: 'up_to_date' },
      { updateAvailable: true, ready: false, status: 'waiting_for_ci' },
    ]) {
      execFile.mockImplementationOnce((_bin: unknown, _args: unknown, _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
        cb(null, JSON.stringify({ ...ready, ...update }));
      });
      const res = await router.request('/install', { method: 'POST', headers: { Cookie: adminCookie } });
      expect(res.status).toBe(409);
    }
    expect(execFile.mock.calls.every((c: unknown[]) => String(c[0]).endsWith('patzer-github-updater'))).toBe(true);
  });
  it('allows verified install only by starting the fixed systemd unit', async () => {
    const res = await router.request('/install', { method: 'POST', headers: { Cookie: adminCookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ started: true, targetSha: ready.latestSha });
    expect(execFile.mock.calls.map((c: unknown[]) => c[1])).toEqual([
      ['--status-json'], ['--user', 'start', '--no-block', 'patzer-github-update.service'],
    ]);
  });
});
