import { afterEach, describe, expect, it, vi } from 'vitest';
import { postReviewAnalysis } from './reviewAnalysisRequest';

afterEach(() => vi.unstubAllGlobals());

describe('cancellable Game Review engine requests', () => {
  it('preserves authentication headers and response data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ lines: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const ac = new AbortController();
    await expect(postReviewAnalysis('/api/analyze/position', { fen: 'demo' }, ac.signal))
      .resolves.toEqual({ lines: [] });
    const init = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'patzer', Accept: 'application/json' });
    expect(init.signal).toBe(ac.signal);
  });

  it('actually aborts an ongoing network request when the position becomes obsolete', async () => {
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      observedSignal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }));
    const ac = new AbortController();
    const pending = postReviewAnalysis('/api/analyze/variation-move', { move_uci: 'e2e4' }, ac.signal);
    ac.abort();
    await expect(pending).rejects.toHaveProperty('name', 'AbortError');
    expect(observedSignal?.aborted).toBe(true);
  });

  it('retains the engine-busy status and avoids leaking raw non-JSON error bodies', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{"error":"engine_busy"}', { status: 429 }))
      .mockResolvedValueOnce(new Response('proxy temporarily unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    await expect(postReviewAnalysis('/api/analyze', {}, signal))
      .rejects.toMatchObject({ message: 'engine_busy', status: 429 });
    await expect(postReviewAnalysis('/api/analyze', {}, signal))
      .rejects.toMatchObject({ message: 'HTTP 503', status: 503 });
  });
});
