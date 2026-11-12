// @vitest-environment happy-dom
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
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
const nextRef = {
  lesson: { id: 'rook', icon: 'rook', steps: [{ id: 'intro', type: 'info' }] },
  course: { id: 'pieces' }, level: { id: 'basics' }, order: 1,
} as unknown as LessonRef;

function LessonHarness({ next, onExit, onOpenLesson }: {
  next: LessonRef | null;
  onExit: ReturnType<typeof vi.fn>;
  onOpenLesson: ReturnType<typeof vi.fn>;
}) {
  const navigate = useNavigate();
  return <>
    <Link to="/home">Global Home</Link>
    <LessonPlayer refInfo={refInfo} resume={{ step: 0, flawed: 0 }} bestStars={0} totalStars={0}
      next={next} onOpenLesson={(id) => { onOpenLesson(id); void navigate(`/learn?lesson=${id}`); }}
      onExit={() => { onExit(); void navigate('/learn?course=pieces'); }} />
  </>;
}

function mount(next: LessonRef | null = null, onExit = vi.fn(), onOpenLesson = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/learn', element: <LessonHarness next={next} onExit={onExit} onOpenLesson={onOpenLesson} /> },
    { path: '/home', element: <div>Home page</div> },
  ], { initialEntries: ['/learn?lesson=board'] });
  const page = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...page, onExit, onOpenLesson, router };
}

afterEach(() => { cleanup(); mocks.post.mockReset(); });

describe('LessonPlayer saved progress', () => {
  it('shows a provisional score while saving or offline, and celebrates earned stars only after acknowledgment', async () => {
    let confirm!: () => void;
    mocks.post.mockImplementationOnce(() => new Promise<void>((resolve) => { confirm = resolve; }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    expect((await screen.findByText('Lesson result awaiting save')).textContent).toContain('awaiting save');
    expect(screen.queryByText('learn.lessonDone')).toBeNull();
    expect(screen.queryByText('learn.starsGained')).toBeNull();
    expect(screen.getByText('0 / 5 ★')).toBeTruthy();

    confirm();
    expect(await screen.findByText('learn.lessonDone')).toBeTruthy();
    expect(screen.getByText('3 / 5 ★')).toBeTruthy();
    expect(screen.getByText('learn.starsGained')).toBeTruthy();
    expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/learn/board', { stars: 3 });
  });

  it('never announces earned stars after a failed save and shows them when the player retries successfully', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ stars: 3 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    await screen.findByRole('alert');
    expect(screen.getByText('Lesson result awaiting save')).toBeTruthy();
    expect(screen.queryByText('learn.lessonDone')).toBeNull();
    expect(screen.queryByText('learn.starsGained')).toBeNull();
    expect(screen.getByText('0 / 5 ★')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    expect(await screen.findByText('learn.lessonDone')).toBeTruthy();
    expect(screen.getByText('3 / 5 ★')).toBeTruthy();
    expect(screen.getByText('learn.starsGained')).toBeTruthy();
  });

  it('still saves after StrictMode effect cleanup, and can retry a failed finish', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ stars: 3 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    expect((await screen.findByRole('alert')).textContent).toContain("Your latest lesson progress couldn't be saved.");
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/api/learn/board', { stars: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('waits for an acknowledged final result before continuing to the next lesson', async () => {
    let saved!: () => void;
    mocks.post.mockImplementation(() => new Promise<void>((resolve) => { saved = resolve; }));
    const { onOpenLesson, router } = mount(nextRef);
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    expect(screen.getByRole('status').textContent).toContain('Saving your lesson result');
    fireEvent.click(screen.getByRole('button', { name: /learn.nextLesson/i }));
    expect(screen.getByRole('alertdialog', { name: 'Your progress is not saved yet' })).toBeTruthy();
    expect(router.state.location.search).toBe('?lesson=board');
    expect(onOpenLesson).toHaveBeenCalledExactlyOnceWith('rook'); // attempted, but blocked
    saved();
    await waitFor(() => expect(router.state.location.search).toBe('?lesson=rook'));
    expect(onOpenLesson).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('lets a player retry a failed result before leaving the course, or cancel with Escape', async () => {
    mocks.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ stars: 3 });
    const { onExit, router } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'learn.toCourse' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Your progress is not saved yet' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(router.state.location.search).toBe('?lesson=board');
    fireEvent.click(screen.getByRole('button', { name: 'learn.toCourse' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry saving' }).at(-1)!);
    await waitFor(() => expect(router.state.location.search).toBe('?course=pieces'));
    expect(onExit).toHaveBeenCalledTimes(2); // each exit attempt is handled once
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit choice to leave while a save has failed', async () => {
    mocks.post.mockRejectedValue(new Error('offline'));
    const { onExit, router } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'learn.toCourse' }));
    expect(router.state.location.search).toBe('?lesson=board');
    fireEvent.click(screen.getByRole('button', { name: 'Leave without saving' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(router.state.location.search).toBe('?course=pieces'));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('blocks global navigation and resumes it after the pending save completes', async () => {
    let saved!: () => void;
    mocks.post.mockImplementation(() => new Promise<void>((resolve) => { saved = resolve; }));
    const { router } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'learn.finish' }));
    fireEvent.click(screen.getByRole('link', { name: 'Global Home' }));
    expect(router.state.location.pathname).toBe('/learn');
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    saved();
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'));
    expect(screen.getByText('Home page')).toBeTruthy();
  });
});
