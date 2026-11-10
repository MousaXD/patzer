// @vitest-environment happy-dom
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
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
    read: vi.fn(async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      if (index >= chunks.length) return { done: true };
      return { done: false, value: encoder.encode(chunks[index++]!) };
    }),
  };
  return { ok: true, body: { getReader: () => reader } };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

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

  it('shows a recoverable error when the server closes without a done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(
      'event: progress\ndata: {"done":1,"total":2}\n\n',
    )));
    render(<GameReportPanel gameId={2} initial={null} />);
    fireEvent.click(screen.getByText('Write AI report'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('connection ended'));
    expect(screen.getByText('Write AI report')).toBeTruthy();
  });

  it('shows a regeneration failure while keeping the previously completed report', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('event: error\ndata: busy\n\n')));
    render(<GameReportPanel gameId={3} initial={review} />);
    fireEvent.click(screen.getByText('Write it again'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('busy'));
    expect(screen.getByText('A completed chess report')).toBeTruthy();
  });
});
