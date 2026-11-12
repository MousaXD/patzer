import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'patzer-challenge-expiry-'));
process.env.DB_PATH = join(scratch, 'expiry.db');

let db: typeof import('../src/db.js')['db'];
let challenges: typeof import('../src/routes/challenges.js')['default'];
let cookieA: string;
let cookieB: string;

beforeAll(async () => {
  ({ db } = await import('../src/db.js'));
  challenges = (await import('../src/routes/challenges.js')).default;
  const { createSession, SESSION_COOKIE_NAME } = await import('../src/auth/sessions.js');
  db.prepare(`INSERT INTO users(id, username, password_hash, role)
    VALUES (1,'a','x','user'), (2,'b','x','user')`).run();
  db.prepare("INSERT INTO profiles(user_id, display_name) VALUES (1,'Player A'),(2,'Player B')").run();
  cookieA = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(1))}`;
  cookieB = `${SESSION_COOKIE_NAME}=${encodeURIComponent(createSession(2))}`;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(scratch, { recursive: true, force: true });
});

function insert(from: number, to: number, ageMinutes: number): number {
  const row = db.prepare(`INSERT INTO challenges
    (from_user_id, to_user_id, color, time_control, created_at)
    VALUES (?, ?, 'white', 'rapid', datetime('now', ?))`)
    .run(from, to, `-${ageMinutes} minutes`);
  return Number(row.lastInsertRowid);
}

async function action(path: string, cookie: string, method = 'POST') {
  const res = await challenges.request(path, {
    method,
    headers: { Cookie: cookie, 'X-Requested-With': 'patzer' },
  });
  return { status: res.status, body: await res.json() };
}

describe('pending invitation expiry on write paths', () => {
  it('rejects an expired acceptance without a preceding list refresh or new PvP game', async () => {
    const old = insert(2, 1, 16);
    expect(await action(`/${old}/accept`, cookieA)).toMatchObject({
      status: 409, body: { error: 'not_pending' },
    });
    expect(db.prepare('SELECT status FROM challenges WHERE id = ?').get(old))
      .toEqual({ status: 'expired' });
    expect((db.prepare("SELECT COUNT(*) AS n FROM games WHERE source = 'pvp'").get() as { n: number }).n).toBe(0);

    const fresh = insert(2, 1, 0);
    expect(await action(`/${fresh}/accept`, cookieA)).toMatchObject({ status: 200 });
    expect(db.prepare('SELECT status FROM challenges WHERE id = ?').get(fresh))
      .toEqual({ status: 'accepted' });
    expect((db.prepare("SELECT COUNT(*) AS n FROM games WHERE source = 'pvp'").get() as { n: number }).n).toBe(2);
  });

  it('rejects expired declines and cancellations without any list lookup', async () => {
    const declineId = insert(2, 1, 17);
    const cancelId = insert(1, 2, 17);
    expect(await action(`/${declineId}/decline`, cookieA)).toMatchObject({
      status: 409, body: { error: 'not_pending' },
    });
    expect(await action(`/${cancelId}`, cookieA, 'DELETE')).toMatchObject({
      status: 409, body: { error: 'not_pending' },
    });
    expect(db.prepare('SELECT id, status FROM challenges WHERE id IN (?, ?) ORDER BY id').all(declineId, cancelId))
      .toEqual([{ id: declineId, status: 'expired' }, { id: cancelId, status: 'expired' }]);
    // The challenger may not accept an expired invite on the recipient's behalf.
    expect(await action(`/${declineId}/accept`, cookieB)).toMatchObject({
      status: 403, body: { error: 'forbidden' },
    });
  });
});
