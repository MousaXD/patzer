// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  accountId: 7,
  get: vi.fn(),
  curriculum: null as unknown,
  lessonMounts: 0,
}));

vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: { id: mocks.accountId } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../learn/content', () => ({
  loadCurriculum: () => mocks.curriculum ? Promise.resolve(mocks.curriculum) : new Promise(() => undefined),
  loadLearnTexts: () => mocks.curriculum ? Promise.resolve() : new Promise(() => undefined),
}));
vi.mock('../components/learn/LessonPlayer', async () => {
  const { createElement, useState } = await import('react');
  return {
    default: () => {
      const [instance] = useState(() => ++mocks.lessonMounts);
      return createElement('div', { 'data-testid': 'lesson-instance' }, String(instance));
    },
    LEARN_QUERY_KEY: ['learn-progress'],
  };
});

import Learn from './Learn';

beforeEach(() => {
  mocks.accountId = 7;
  mocks.curriculum = null;
  mocks.lessonMounts = 0;
  mocks.get.mockReset();
  mocks.get.mockImplementation(async () => ({ lessons: [{ lesson_id: `player-${mocks.accountId}`, stars: 3 }] }));
});
afterEach(() => { cleanup(); });

describe('Learn account-scoped progress', () => {
  it('fetches fresh progress when a different player signs in, without reusing earned stars', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter><Learn /></MemoryRouter>
      </QueryClientProvider>
    );
    const page = render(view());
    await screen.findByText('common.loading');
    await waitFor(() => expect(client.getQueryData<{ lessons: { lesson_id: string }[] }>(['learn-progress', 7])?.lessons[0]?.lesson_id).toBe('player-7'));

    mocks.accountId = 101;
    act(() => { page.rerender(view()); });
    await waitFor(() => expect(client.getQueryData<{ lessons: { lesson_id: string }[] }>(['learn-progress', 101])?.lessons[0]?.lesson_id).toBe('player-101'));

    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(client.getQueryData<{ lessons: { lesson_id: string }[] }>(['learn-progress', 7])?.lessons[0]?.lesson_id).toBe('player-7');
  });

  it('remounts a stateful lesson when another account with cached progress opens the same lesson', async () => {
    const ref = { lesson: { id: 'intro', steps: [{ type: 'info' }] }, order: 0, course: { id: 'basics' } };
    mocks.curriculum = { byId: new Map([['intro', ref]]), lessons: [ref] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['learn-progress', 7], { lessons: [] });
    client.setQueryData(['learn-progress', 101], { lessons: [] });
    const view = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/learn?lesson=intro']}><Learn /></MemoryRouter>
      </QueryClientProvider>
    );
    const page = render(view());
    await waitFor(() => expect(screen.getByTestId('lesson-instance').textContent).toBe('1'));

    mocks.accountId = 101;
    act(() => { page.rerender(view()); });
    await waitFor(() => expect(screen.getByTestId('lesson-instance').textContent).toBe('2'));
    expect(mocks.lessonMounts).toBe(2);
  });
});
