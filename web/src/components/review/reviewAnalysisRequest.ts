/** A cancellable, authenticated analysis request. Review navigation abandons
 * obsolete Stockfish work at the network boundary so the backend can release
 * its bounded engine slots, not merely ignore late React state updates.
 * The headers/error shape match the shared api helper without changing it. */
export async function postReviewAnalysis<T>(
  path: string,
  payload: unknown,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Requested-With': 'patzer',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { /* No JSON on some proxies. */ }
    const message = body && typeof body === 'object' && 'error' in body
      && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}
