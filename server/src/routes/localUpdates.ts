/** Optional, admin-only local Patzer updater control.
 *
 * Reads the same CI-gated status used by the systemd updater. The only allowed
 * write action starts the *fixed* systemd unit (not an arbitrary command or
 * branch). The regular timer continues to update twice daily independently.
 * No GitHub credentials, filesystem paths, or shell arguments come from users.
 */
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin } from '../auth/middleware.js';
import { config } from '../config.js';

function runCommand(binary: string, args: string[], timeout: number, maxBuffer: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout, maxBuffer }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
const router = new Hono();
const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const updater = join(homedir(), '.local/bin/patzer-github-updater');
const statusSchema = z.object({
  latestSha: z.string().regex(/^[0-9a-f]{40}$/),
  deployedSha: z.string().regex(/^[0-9a-f]{40}$/),
  updateAvailable: z.boolean(),
  ready: z.boolean(),
  status: z.enum(['up_to_date', 'available', 'waiting_for_ci', 'manual_review_required']),
  checkedAt: z.string(),
  automaticSchedule: z.literal('Every 12 hours'),
});

router.use('*', requireAdmin);
router.use('*', async (c, next) => {
  // Only the local, loopback-bound app may control its OS service. Even a
  // forwarded administrator session through a proxy must not expose updates.
  if (!localHosts.has(config.host) || !localHosts.has(new URL(c.req.url).hostname)) {
    return c.json({ error: 'Local update controls require Patzer on localhost.' }, 403);
  }
  await next();
});

async function checkUpdates() {
  const stdout = await runCommand(updater, ['--status-json'], 30_000, 32 * 1024);
  return statusSchema.parse(JSON.parse(stdout));
}

router.get('/check', async (c) => {
  try { return c.json(await checkUpdates()); }
  catch (error) {
    console.warn('[local-updates] unable to check:', error instanceof Error ? error.name : 'unknown');
    return c.json({ error: 'Unable to check GitHub updates. Verify the local updater service and network connection.' }, 503);
  }
});

router.post('/install', async (c) => {
  try {
    const status = await checkUpdates();
    if (!status.updateAvailable || !status.ready) {
      return c.json({ error: status.updateAvailable ? 'Update is not yet verified by CI.' : 'Patzer is already up to date.' }, 409);
    }
    // Starts the existing CI-validated, backup-and-rollback deployment. Never
    // await full deployment here: Patzer itself will restart during the job.
    await runCommand('/usr/bin/systemctl', ['--user', 'start', '--no-block', 'patzer-github-update.service'], 8_000, 8 * 1024);
    return c.json({ started: true, targetSha: status.latestSha });
  } catch (error) {
    console.warn('[local-updates] unable to start:', error instanceof Error ? error.name : 'unknown');
    return c.json({ error: 'Unable to start the local update service.' }, 503);
  }
});

export default router;
