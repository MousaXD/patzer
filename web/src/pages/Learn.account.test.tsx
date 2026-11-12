// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  accountId: 7,
  get: vi.fn(),
  curriculum: null as unknown,
  lessonMounts: 0,
  contentFailures: 0,
  textFailures: 0,
}));

vi.mock('../api', () => ({ api: { get: mocks.get } }));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: { id: mocks.accountId } }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
// The lesson overview animates its progress and hero. The state tests do not
// exercise motion, and happy-dom rejects canceled Web Animations on teardown.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => ({ children, initial, animate, exit, transition, ...props }: Record<string, unknown>) => {
      void initial; void animate; void exit; void transition;
      return React.createElement(tag, props, children as React.ReactNode);
    },
  });
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) };
});
vi.mock('../learn/content', () => ({
  loadCurriculum: () => {
    if (mocks.contentFailures > 0) {
      mocks.contentFailures--;
      return Promise.reject(new Error('chunk offline'));
    }
    return mocks.curriculum ? Promise.resolve(mocks.curriculum) : new Promise(() => undefined);
  },
  loadLearnTexts: () => {
    if (mocks.textFailures > 0) {
      mocks.textFailures--;
      return Promise.reject(new Error('translation offline'));
    }
    return mocks.curriculum ? Promise.resolve() : new Promise(() => undefined);
  },
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

import Learn, { canResumeLesson, suggestedLesson, type LessonProgress } from './Learn';
import type { Curriculum, LessonRef } from '../learn/content';

beforeEach(() => {
  mocks.accountId = 7;
  mocks.curriculum = null;
  mocks.lessonMounts = 0;
  mocks.contentFailures = 0;
  mocks.textFailures = 0;
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

describe('Learn load recovery', () => {
  function renderOverview() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><Learn /></MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const emptyCurriculum = () => ({ levels: [], lessons: [], byId: new Map(), courseById: new Map() });

  it('recovers from a transient progress API failure without reloading the page', async () => {
    mocks.curriculum = emptyCurriculum();
    mocks.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ lessons: [] });
    renderOverview();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('learn.allDone')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('learn.allDone')).toBeTruthy();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('retries lesson curriculum imports after an initial chunk failure', async () => {
    mocks.curriculum = emptyCurriculum();
    mocks.contentFailures = 1;
    renderOverview();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('learn.allDone')).toBeTruthy();
  });

  it('retries lesson translation assets after an initial chunk failure', async () => {
    mocks.curriculum = emptyCurriculum();
    mocks.textFailures = 1;
    renderOverview();
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('learn.allDone')).toBeTruthy();
  });
});

describe('next lesson recommendations', () => {
  const reference = (id: string, order: number): LessonRef => ({
    lesson: { id, steps: [{ type: 'info' }, { type: 'quiz' }, { type: 'info' }] },
    course: { id: 'pieces' }, order,
  } as unknown as LessonRef);
  const board = reference('board', 0);
  const rook = reference('rook', 1);
  const bishop = reference('bishop', 2);
  const cur = {
    lessons: [board, rook, bishop],
    byId: new Map([board, rook, bishop].map((r) => [r.lesson.id, r])),
  } as unknown as Curriculum;
  const row = (lesson_id: string, step: number, completed_at: string | null, updated_at: string): LessonProgress => ({
    lesson_id, step, completed_at, updated_at, stars: completed_at ? 3 : 0, flawed: 0,
  });

  it('prefers genuinely unfinished progress over a more recently replayed completed lesson', () => {
    const progress = new Map([
      ['board', row('board', 2, '2026-11-10', '2026-11-12')],
      ['rook', row('rook', 1, null, '2026-11-11')],
    ]);
    expect(suggestedLesson(cur, progress)?.lesson.id).toBe('rook');
    expect(canResumeLesson(board, progress.get('board'))).toBe(true); // replay remains accessible
  });

  it('uses the first uncompleted lesson if a previous step index is no longer valid', () => {
    const progress = new Map([
      ['rook', row('rook', 42, null, '2026-11-12')],
      ['board', row('board', 0, '2026-11-10', '2026-11-10')],
    ]);
    expect(suggestedLesson(cur, progress)?.lesson.id).toBe('rook');
    expect(canResumeLesson(rook, progress.get('rook'))).toBe(false);
  });

  it('does not offer a finished replay as the next lesson when all lessons are complete', () => {
    const progress = new Map([
      ['board', row('board', 1, '2026-11-10', '2026-11-12')],
      ['rook', row('rook', 0, '2026-11-11', '2026-11-11')],
      ['bishop', row('bishop', 0, '2026-11-11', '2026-11-11')],
    ]);
    expect(suggestedLesson(cur, progress)).toBeNull();
  });
});
