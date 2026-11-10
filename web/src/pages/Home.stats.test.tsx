// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: { profile: { display_name: 'Player', avatar_emoji: '♟' } } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));
vi.mock('./Learn', () => ({
  useLearnContent: () => ({ cur: null }),
  fetchLearnProgress: () => Promise.resolve({ lessons: [] }),
  suggestedLesson: () => null,
}));
vi.mock('../components/learn/LessonPlayer', () => ({ LEARN_QUERY_KEY: ['learn-progress'] }));
vi.mock('../lib/openingTrainer', () => ({ localDay: () => '2026-11-10' }));

import Home from './Home';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Home /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Home statistics failure', () => {
  it('shows a retryable error instead of the no-games tagline after a failed stats request', async () => {
    let offline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url === '/api/stats/me') return offline
        ? Promise.reject(new Error('unavailable'))
        : Promise.resolve({
            total: 42, wins: 25, losses: 12, draws: 5,
            avg_accuracy: 78, streak: null,
          });
      if (url.startsWith('/api/games')) return Promise.resolve({ games: [] });
      if (url === '/api/plan') return Promise.resolve({ goals: [] });
      if (url === '/api/achievements') return Promise.resolve({ achievements: [] });
      if (url.startsWith('/api/tactics/daily')) return Promise.resolve({ puzzle: null, done: null, streak: 0 });
      return Promise.resolve({});
    });

    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your statistics could not be loaded.');
    expect(screen.queryByText('app.tagline')).toBeNull();

    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.queryByText('Your statistics could not be loaded.')).toBeNull();
  });
});
