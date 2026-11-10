// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import Insights from './Insights';

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Insights /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Insights data states', () => {
  it('does not disguise a failed statistics request as no games', async () => {
    let offline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url.includes('/api/achievements')) return Promise.resolve({ achievements: [] });
      return offline
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ games_total: 0, games_analyzed: 0 });
    });
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Insights are temporarily unavailable');
    expect(screen.queryByText('No insights yet')).toBeNull();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No insights yet')).toBeTruthy();
  });
});
