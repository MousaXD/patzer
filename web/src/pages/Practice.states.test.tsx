// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ account: 1, get: vi.fn(), post: vi.fn() }));
vi.mock('../api', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('../state/auth', () => ({ useAuth: () => ({ user: { id: mocks.account, profile: { board_theme: 'green' } } }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, args?: { defaultValue?: string }) => args?.defaultValue ?? key }),
}));

import Plan from './Plan';
import Train from './Train';

function mount(Component: typeof Plan | typeof Train) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter><Component /></MemoryRouter>
    </QueryClientProvider>
  );
  const mounted = render(view());
  return { ...mounted, rerenderPage: () => mounted.rerender(view()) };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.account = 1; });

describe('private practice and plan data states', () => {
  it('distinguishes games awaiting analysis from completed training and labels old practice as history', async () => {
    mocks.get.mockImplementation((url: string) => {
      if (url.startsWith('/api/train/stats')) return Promise.resolve({
        total: 1, solved: 1, failed: 0, accuracy: 100, due: 0,
        current_total: 0, current_solved: 0, current_accuracy: null, outdated_attempts: 1,
      });
      if (url.startsWith('/api/train/next')) return Promise.resolve({ puzzle: null, due: 0, awaiting_analysis: 2 });
      throw new Error(`Unexpected request: ${url}`);
    });
    mount(Train);
    expect(await screen.findByText('Your games have more lessons to uncover')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Analyze your games' }).getAttribute('href')).toBe('/review');
    expect(screen.queryByText(/Nothing to train/)).toBeNull();
    expect(screen.getByText('Current solves').parentElement?.textContent).toContain('0');
    expect(screen.getByText('Puzzle solve rate').parentElement?.textContent).toContain('—');
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText(/previous practice attempts are kept in your history/)).toBeTruthy();
  });

  it('shows an explicit retry instead of pretending a failed personal puzzle load is complete', async () => {
    let offline = true;
    mocks.get.mockImplementation((url: string) => {
      if (url.startsWith('/api/train/stats')) return Promise.resolve({ total: 0 });
      if (url.startsWith('/api/train/next')) return offline ? Promise.reject(new Error('offline')) : Promise.resolve({ puzzle: null, due: 0 });
      throw new Error(`Unexpected request: ${url}`);
    });
    mount(Train);
    expect((await screen.findByRole('alert')).textContent).toContain('Your personal puzzles could not be loaded');
    expect(screen.queryByText(/Nothing to train/)).toBeNull();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Nothing to train/)).toBeTruthy();
  });

  it('does not reuse one account’s personal puzzle queue while another account is loading', async () => {
    let release!: (value: { puzzle: null; due: number }) => void;
    const pending = new Promise<{ puzzle: null; due: number }>((resolve) => { release = resolve; });
    mocks.get.mockImplementation((url: string) => {
      if (url.startsWith('/api/train/stats')) return Promise.resolve({ total: 0 });
      if (url.startsWith('/api/train/next')) return mocks.account === 1 ? Promise.resolve({ puzzle: null, due: 0 }) : pending;
      throw new Error(`Unexpected request: ${url}`);
    });
    const page = mount(Train);
    expect(await screen.findByText(/Nothing to train/)).toBeTruthy();
    mocks.account = 2;
    page.rerenderPage();
    expect(screen.queryByText(/Nothing to train/)).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
    release({ puzzle: null, due: 0 });
    expect(await screen.findByText(/Nothing to train/)).toBeTruthy();
  });

  it('separates an unavailable improvement plan from an empty plan and supports retry', async () => {
    let offline = true;
    mocks.get.mockImplementation(() => offline ? Promise.reject(new Error('offline')) : Promise.resolve({ goals: [] }));
    mount(Plan);
    expect((await screen.findByRole('alert')).textContent).toContain('Your improvement plan is unavailable');
    expect(screen.queryByText(/No goals yet/)).toBeNull();
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No goals yet/)).toBeTruthy();
  });

  it('does not show a prior account’s plan to a newly signed-in player', async () => {
    let release!: (value: { goals: never[] }) => void;
    const pending = new Promise<{ goals: never[] }>((resolve) => { release = resolve; });
    const privateGoal = {
      id: 12, kind: 'review_games', title: 'Private study goal', description: 'Review games', target: 2,
      progress: 0, status: 'active', icon: 'Target', created_at: '2026-11-01', completes_at: '2026-11-30', metadata: null,
    };
    mocks.get.mockImplementation(() => mocks.account === 1 ? Promise.resolve({ goals: [privateGoal] }) : pending);
    const page = mount(Plan);
    expect(await screen.findByText('Private study goal')).toBeTruthy();
    mocks.account = 2;
    page.rerenderPage();
    expect(screen.queryByText('Private study goal')).toBeNull();
    release({ goals: [] });
    expect(await screen.findByText(/No goals yet/)).toBeTruthy();
  });
});
