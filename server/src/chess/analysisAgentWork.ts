/**
 * Process-wide, fail-fast admission control for CPU-heavy chess analysis.
 * No waiting queue: rapid board navigation must not accumulate stale searches.
 */
export class AnalysisAdmission {
  private active = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('analysis slot limit must be positive');
  }

  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }

  get inUse(): number { return this.active; }
}

/** Short-lived, bounded successful-result cache. Rejected searches are never cached. */
export class AnalysisResultCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries = 128,
    private readonly ttlMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('invalid analysis cache bounds');
    }
  }

  get(key: string): V | undefined {
    const found = this.entries.get(key);
    if (!found) return undefined;
    if (found.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, found); // refresh LRU, not TTL
    return found.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get size(): number { return this.entries.size; }
}

/**
 * Shut down an engine when its owning HTTP request disappears.
 * Returns an idempotent listener cleanup, also safe when the request
 * was already aborted before engine allocation.
 */
export function stopEngineOnAbort(
  signal: AbortSignal,
  engine: { quit(): Promise<void> },
): () => void {
  const stop = () => { void engine.quit().catch(() => undefined); };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  return () => signal.removeEventListener('abort', stop);
}
