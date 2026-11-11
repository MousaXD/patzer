// @vitest-environment happy-dom
import { cleanup, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GameReportPanel, { type GameReviewProse } from './GameReportPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _ }),
}));
vi.mock('../lib/markdown', () => ({
  renderMarkdown: (v: string) => v,
  stripReasoning: (v: string) => v,
}));

const review = {
  version: 1, language: 'en', audience: 'player', opening: null,
  summary: 'A completed chess report', skill_assessment: 'Careful play',
  phases: { opening: null, middlegame: null, endgame: null }, key_moments: [],
} as GameReviewProse;

function reply(...chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;
  const reader = {
    cancel: vi.fn().mockResolvedValue(undefined),
    read: vi.fn(async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (index >= chunks.length) return { done: true };
      return { done: false, value: encoder.encode(chunks[index++]!) };
    }),
  };
  return { ok: true, body: { getReader: () => reader } };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Game Review report stream lifecycle', () => {
  it('handles a done event spanning multiple CRLF chunks', async () => {
    const onGenerated = vi.fn();
    const done = 'event: done\r\ndata: ' + JSON.stringify({ review }) + '\r\n\r\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(done.slice(0, 22), done.slice(22))));
    render(<GameReportPanel gameId={1} initial={null} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText('Write AI report'));
    await waitFor(() => expect(screen.getByText('A completed chess report')).toBeTruthy());
    expect(onGenerated).toHaveBeenCalledWith(review);
  });

  it('finishes immediately after done even if the server never closes its stream', async () => {
    const onGenerated = vi.fn();
    const encoder = new TextEncoder();
    const done = encoder.encode('event: done\ndata: ' + JSON.stringify({ review }) + '\n\n');
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockResolvedValueOnce({ done: false, value: done })
      .mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, body: { getReader: () => ({ read, cancel }) },
    }));

    render(<GameReportPanel gameId={11} initial={null} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText('Write AI report'));
    await waitFor(() => expect(screen.getByText('A completed chess report')).toBeTruthy());
    await waitFor(() => expect((screen.getByText('Write it again') as HTMLButtonElement).disabled).toBe(false));
    expect(read).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onGenerated).toHaveBeenCalledOnce();
  });

  it('shows a recoverable error when the server closes without a done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(
      'event: progress\ndata: {"done":1,"total":2}\n\n',
    )));
    render(<GameReportPanel gameId={2} initial={null} />);
    fireEvent.click(screen.getByText('Write AI report'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not generate'));
    expect(screen.getByText('Write AI report')).toBeTruthy();
  });

  it('shows a regeneration failure while keeping the previously completed report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('event: error\ndata: busy\n\n')));
    render(<GameReportPanel gameId={3} initial={review} />);
    fireEvent.click(screen.getByText('Write it again'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not generate'));
    expect(screen.getByRole('alert').textContent).not.toContain('busy');
    expect(screen.getByText('A completed chess report')).toBeTruthy();
  });

  it('lets the user cancel an unfinished report without accepting late data', async () => {
    const onGenerated = vi.fn();
    const fetcher = vi.fn((_: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<GameReportPanel gameId={4} initial={null} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByText('Write AI report'));
    await waitFor(() => expect(screen.getByText('Cancel generation')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel generation'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('cancelled'));
    expect(screen.getByText('Write AI report')).toBeTruthy();
    expect((fetcher.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it('preserves the previous report when a regeneration is cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn((_: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    })));
    render(<GameReportPanel gameId={5} initial={review} />);
    fireEvent.click(screen.getByText('Write it again'));
    fireEvent.click(screen.getByText('Cancel generation'));
    expect(screen.getByText('A completed chess report')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('cancelled');
    expect((screen.getByText('Write it again') as HTMLButtonElement).disabled).toBe(false);
  });
});
