// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LessonRef } from '../../learn/content';

const mocks = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../api', () => ({ api: { post: mocks.post } }));
vi.mock('../../state/auth', () => ({ useAuth: () => ({ user: { id: 17, profile: { audience: 'beginner', tts_enabled: 0 } } }) }));
vi.mock('../../i18n', () => ({ default: { language: 'en', exists: () => true, hasResourceBundle: () => true } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));
vi.mock('../../lib/tts', () => ({ speak: vi.fn(), cancel: vi.fn() }));
vi.mock('../../lib/sounds', () => ({ playSound: vi.fn(), soundForMove: vi.fn() }));
vi.mock('../Logo', () => ({ LogoMark: () => null }));
vi.mock('./LessonBoard', () => ({ default: () => <div data-testid="lesson-board" /> }));
vi.mock('./LessonIcon', () => ({
  default: () => <span>Lesson</span>,
  PieceIcon: () => <span>Piece</span>,
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_target, tag: string) => ({
      children, initial, animate, exit, transition, ...props
    }: Record<string, unknown>) => {
      void initial; void animate; void exit; void transition;
      return React.createElement(tag, props, children as React.ReactNode);
    },
  });
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

import LessonPlayer from './LessonPlayer';

const refInfo = {
  lesson: { id: 'board', icon: 'board', steps: [{ id: 'intro', type: 'info' }] },
  course: { id: 'pieces' }, level: { id: 'basics' }, order: 0,
} as unknown as LessonRef;

afterEach(() => { cleanup(); mocks.post.mockReset(); });

describe('LessonPlayer saved progress', () => {
  it('still saves after StrictMode effect cleanup, and can retry a failed finish', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ stars: 3 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <LessonPlayer refInfo={refInfo} resume={{ step: 0, flawed: 0 }} bestStars={0} totalStars={0} next={null}
            onOpenLesson={() => {}} onExit={() => {}} />
        </QueryClientProvider>
      </StrictMode>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Your latest lesson progress couldn't be saved.");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/api/learn/board', { stars: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
