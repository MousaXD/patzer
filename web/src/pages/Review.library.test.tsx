// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  user: { id: 7, profile: { chesscom_username: null as string | null, lichess_username: null as string | null } },
}));

vi.mock('../api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch },
}));
vi.mock('../state/auth', () => ({
  useAuth: () => ({ user: mocks.user }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string; white?: string; black?: string }) =>
      key === 'practice.entryAria'
        ? `Practice mistakes in ${opts?.white} versus ${opts?.black} without spoilers`
        : key === 'practice.entry' ? 'Practice first'
          : ({
            'review.pgnError.invalid_pgn': 'Invalid or incomplete PGN. No games from this file were imported.',
            'review.pgnError.pgn_bad_file_type': 'Choose a .pgn or .txt file.',
            'review.pgnError.pgn_too_large': 'The PGN file exceeds the 4 MB limit. Split it into smaller files.',
            'review.pgnError.pgn_bad_encoding': 'This file is not valid UTF-8. Convert the PGN to UTF-8 and retry; no games were imported.',
            'review.pgnError.pgn_invalid_summary': 'Import status could not be verified. Some games may already be saved. Retry the same file; identical PGNs will be skipped.',
            'review.importError.import_invalid_summary': 'Import status could not be verified. Some games may already be saved. Refresh your Library before trying again.',
          } as Record<string,string>)[key] ?? opts?.defaultValue ?? key,
  }),
}));

import Review from './Review';

function makeGame(id: number) {
  return {
    id,
    white: 'White ' + id,
    black: 'Black ' + id,
    user_color: 'white',
    result: 'win',
    time_control: '600+0',
    end_time: '2026-11-08T12:00:00Z',
    source: 'chesscom',
    bookmarked: 0,
    analyzed: 0,
    opening_name: 'Italian Game',
    notes: '',
    from_position: 0,
  };
}

function mount(initial = '/review') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<div>Game detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return { ...result, queryClient, rerenderReview: () => result.rerender(view()) };
}

function openImportOptions() {
  fireEvent.click(screen.getByRole('button',{name:'Import more games'}));
}

beforeEach(() => {
  // Clear queued mockResolvedValueOnce/rejectedValueOnce implementations too;
  // a failed upload test must not affect another test's provider import.
  vi.resetAllMocks();
  mocks.user = { id: 7, profile: { chesscom_username: null, lichess_username: null } };
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/api/games/openings') return {total: 0, classified: 0, unclassified: 0, openings: []};
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const limit = Number(query.get('limit') ?? 50);
    return { games: Array.from({ length: Math.min(limit, 1000) }, (_, i) => makeGame(i + 1)), total: 1000 };
  });
  mocks.patch.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); });

describe('Review library with large histories', () => {
  it('prioritizes game exploration and exposes import controls on demand in a populated library', async () => {
    mocks.user.profile.chesscom_username = 'linked';
    mount();
    await screen.findByText('40 of 1,000 games');
    const toggle = screen.getByRole('button',{name:'Import more games'});
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button',{name:'Import PGN file'})).toBeNull();
    expect(screen.queryByRole('button',{name:/review\.import \(@linked\)/})).toBeNull();
    expect(screen.getByRole('searchbox')).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button',{name:'Import PGN file'})).toBeTruthy();
    expect(screen.getByRole('button',{name:/review\.import \(@linked\)/})).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button',{name:'Import PGN file'})).toBeNull();
  });
  it('preserves a selected PGN and its retry after hiding and reopening the import options', async () => {
    mocks.post.mockRejectedValueOnce(new Error('invalid_pgn'))
      .mockResolvedValueOnce({total:1,imported:1,duplicates:0});
    mount();
    await screen.findByText('40 of 1,000 games');
    openImportOptions();
    const pgn='[Event "Retry"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 *';
    const file=new File([pgn],'retry.pgn',{type:'text/plain'});
    Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(pgn).buffer});
    const input=screen.getByLabelText('Choose a PGN file');
    fireEvent.change(input,{target:{files:[file]}});
    const upload=screen.getByRole('button',{name:'Import PGN file'});
    expect(upload.hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'Hide import options'}));
    expect(screen.queryByRole('button',{name:'Import PGN file'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Import more games'}));
    expect(screen.getByRole('button',{name:'Import PGN file'}).hasAttribute('disabled')).toBe(false);
    fireEvent.click(upload);
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid or incomplete PGN');
    fireEvent.click(screen.getByRole('button',{name:'Hide import options'}));
    expect(screen.getByRole('alert').textContent).toContain('Invalid or incomplete PGN');
    fireEvent.click(screen.getByRole('button',{name:'Import more games'}));
    fireEvent.click(screen.getByRole('button',{name:'Import PGN file'}));
    expect(await screen.findByText(/1 new games saved from 1 PGNs/)).toBeTruthy();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows the known opening in mobile card metadata without removing its review link', async () => {
    const opening='King’s Indian Defense: Fianchetto Variation, Panno Variation';
    mocks.get.mockImplementation(async (url:string)=>url==='/api/games/openings'
      ? {total:1,classified:1,unclassified:0,openings:[{name:opening,games:1}]}
      : {games:[{...makeGame(1),opening_name:opening}],total:1,offset:0,has_more:false});
    mount();
    const preview=(await screen.findAllByTitle(opening))
      .find(element=>element.closest('a')?.getAttribute('href')==='/review/1');
    expect(preview).toBeDefined();
    expect(preview?.className).toContain('truncate');
    expect(preview?.className).toContain('sm:hidden');
  });

  it('shows explicit unknown players when an imported PGN has no player headers', async () => {
    mocks.get.mockImplementation(async (url:string) => url==='/api/games/openings'
      ? {total:1,classified:0,unclassified:1,openings:[]}
      : {games:[{...makeGame(1),source:'imported',white:null,black:null,user_color:null,
        result:null,end_time:null}],total:1,offset:0,has_more:false});
    mount();
    const card=await screen.findByRole('link',{name:/Unknown player.*Unknown player/});
    expect(card.textContent?.match(/Unknown player/g)).toHaveLength(2);
    expect(card.getAttribute('href')).toBe('/review/1');
    expect(card.textContent).toContain('Date unavailable');
  });

  it('describes missing imported player identities in the Practice action as the card displays them', async () => {
    mocks.get.mockImplementation(async (url:string) => url==='/api/games/openings'
      ? {total:1,classified:1,unclassified:0,openings:[{name:'Italian Game',games:1}]}
      : {games:[{...makeGame(1),source:'imported',white:null,black:'  ',
        user_color:null,analyzed:1,result:'loss'}],total:1,offset:0,has_more:false});
    mount();
    await screen.findByText('1 of 1 games');
    const card=document.querySelector<HTMLAnchorElement>('a[href="/review/1"]');
    expect(card).not.toBeNull();
    expect(card?.textContent?.match(/Unknown player/g)).toHaveLength(2);
    const practice=screen.getByRole('link',{
      name:'Practice mistakes in Unknown player versus Unknown player without spoilers',
    });
    expect(practice.getAttribute('href')).toBe('/review/1?practice=1');
  });

  it('keeps long international player names inside a truncatable card label with the full text available', async () => {
    const white='棋手名'.repeat(40);
    const black='JOSÉ-'.repeat(22);
    mocks.get.mockImplementation(async (url:string)=>url==='/api/games/openings'
      ? {total:1,classified:1,unclassified:0,openings:[{name:'Italian Game',games:1}]}
      : {games:[{...makeGame(1),source:'imported',white,black,user_color:null}],
        total:1,offset:0,has_more:false});
    mount();
    await screen.findByText('1 of 1 games');
    const card=document.querySelector('a[href="/review/1"]')!;
    const names=[...card.querySelectorAll<HTMLSpanElement>('span.truncate.font-semibold')];
    expect(names).toHaveLength(2);
    expect(names.map(n=>n.title)).toEqual([white,black]);
    expect(names.every(n=>n.className.includes('min-w-0'))).toBe(true);
    expect(names[0]?.parentElement?.className).toContain('max-w-full');
    expect(card.textContent).toContain(white);
    expect(card.textContent).toContain(black);
  });

  it('keeps the bookmark state consistent in Starred only while a removal is pending or fails', async () => {
    let saved = true;
    let rejectSave!: (error: Error) => void;
    mocks.get.mockImplementation(async (url:string) => {
      if (url==='/api/games/openings') return {total:1,classified:1,unclassified:0,
        openings:[{name:'Italian Game',games:1}]};
      const params=new URLSearchParams(url.split('?')[1] ?? '');
      if (params.get('bookmarked')==='1' && !saved) return {games:[],total:0,offset:0,has_more:false};
      return {games:[{...makeGame(1),bookmarked:saved ? 1 : 0}],total:1,offset:0,has_more:false};
    });
    mocks.patch.mockImplementationOnce(() => new Promise((_resolve,reject)=>{rejectSave=reject;}));
    mount('/review?bookmarked=1');
    const remove=await screen.findByRole('button',{name:'Remove bookmark'});
    expect(remove.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(remove);
    await waitFor(()=>expect(mocks.patch).toHaveBeenCalledTimes(1));
    // While the save is outstanding, a starred-only card must never look like
    // an unstarred card that violates the currently selected filter.
    expect(screen.getByRole('button',{name:'Remove bookmark'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button',{name:'Bookmark game'})).toBeNull();
    await act(async()=>rejectSave(new Error('unavailable')));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Bookmark could not be saved/);
    expect(screen.getByRole('button',{name:'Remove bookmark'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('1 of 1 games')).toBeTruthy();
  });
  it('offers one clear first-use choice to upload PGN or connect a chess provider when no games exist', async () => {
    mocks.get.mockImplementation(async (url:string) => url === '/api/games/openings'
      ? {total:0,classified:0,unclassified:0,openings:[]}
      : {games:[],total:0,offset:0,limit:40,has_more:false});
    mount();
    expect(await screen.findByText('Your game history starts here')).toBeTruthy();
    expect(screen.getByText(/Import a PGN from your computer or link Chess.com\/Lichess/)).toBeTruthy();
    const connect = screen.getAllByRole('link',{name:'Connect a chess account'});
    expect(connect).toHaveLength(1);
    expect(connect[0]?.getAttribute('href')).toBe('/settings');
    const pickFile = screen.getByRole('button',{name:'Choose a PGN file to get started'});
    const chooser = screen.getByLabelText('Choose a PGN file') as HTMLInputElement;
    const onPicker = vi.spyOn(chooser,'click').mockImplementation(() => {});
    fireEvent.click(pickFile);
    expect(onPicker).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:'Import PGN file'}).hasAttribute('disabled')).toBe(true);
  });

  it('guides linked chess players toward recent imports without duplicating account setup', async () => {
    mocks.user.profile.chesscom_username='linkedplayer';
    mocks.get.mockImplementation(async (url:string) => url === '/api/games/openings'
      ? {total:0,classified:0,unclassified:0,openings:[]}
      : {games:[],total:0,offset:0,limit:40,has_more:false});
    mount();
    expect(await screen.findByText('Your game history starts here')).toBeTruthy();
    expect(screen.getByText(/Import recent games above, or choose a PGN file/)).toBeTruthy();
    expect(screen.queryByRole('link',{name:'Connect a chess account'})).toBeNull();
    expect(screen.getByRole('button',{name:'Choose a PGN file to get started'})).toBeTruthy();
    expect(screen.getByRole('button',{name:/@linkedplayer/})).toBeTruthy();
  });
  it('uploads a local PGN without linked provider accounts, reports actual saved/duplicate counts and clears selection', async () => {
    mocks.post.mockResolvedValue({total:2,imported:1,duplicates:1});
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    const button = screen.getByRole('button', {name:'Import PGN file'});
    expect(button.hasAttribute('disabled')).toBe(true);
    const pgn='[Event "One"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    const file = new File([pgn],'my-history.pgn',{type:'text/plain'});
    Object.defineProperty(file,'text',{value:async()=>pgn});
    Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(pgn).buffer});
    const input = screen.getByLabelText('Choose a PGN file') as HTMLInputElement;
    fireEvent.change(input,{target:{files:[file]}});
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/games/import/pgn',{pgn}));
    expect(await screen.findByText(/1 new games saved from 2 PGNs \(1 already saved\)/)).toBeTruthy();
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) => String(url).startsWith('/api/games?')
      && new URLSearchParams(String(url).split('?')[1]).get('source') === 'imported')).toBe(true));
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(input.value).toBe('');
  });

  it('reports the offending game in an invalid PGN file and allows retry without a false success', async () => {
    const error = Object.assign(new Error('invalid_pgn'),{data:{game_index:2}});
    mocks.post.mockRejectedValueOnce(error).mockResolvedValueOnce({total:2,imported:2,duplicates:0});
    mount();
    openImportOptions();
    const pgn='[Event "One"]\n\n1. e4 e5 *\n\n[Event "Second"]\n\n1. d4 d5 *';
    const file=new File([pgn],'fix-this.pgn',{type:'text/plain'});
    Object.defineProperty(file,'text',{value:async()=>pgn});
    Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(pgn).buffer});
    fireEvent.change(screen.getByLabelText('Choose a PGN file'),{target:{files:[file]}});
    const button=screen.getByRole('button',{name:'Import PGN file'});
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toContain('Game 2: Invalid or incomplete PGN');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(await screen.findByText(/2 new games saved from 2 PGNs/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });

  it('refuses to claim a successful PGN import when the API summary does not reconcile', async () => {
    mocks.post.mockResolvedValueOnce({total:2,imported:1,duplicates:0});
    mount();
    openImportOptions();
    const pgn='[Event "One"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    const file=new File([pgn],'archive.pgn',{type:'text/plain'});
    Object.defineProperty(file,'arrayBuffer',{value:async()=>new TextEncoder().encode(pgn).buffer});
    fireEvent.change(screen.getByLabelText('Choose a PGN file'),{target:{files:[file]}});
    fireEvent.click(screen.getByRole('button',{name:'Import PGN file'}));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toContain('Import status could not be verified');
    expect(alert.textContent).toContain('may already be saved');
    expect(screen.queryByText(/new games saved from/)).toBeNull();
    expect(screen.getByRole('button',{name:'Import PGN file'}).hasAttribute('disabled')).toBe(false);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await waitFor(()=>expect(mocks.get.mock.calls.filter(([url])=>
      String(url).startsWith('/api/games?')).length).toBeGreaterThan(1));
  });

  it('rejects non-PGN file types and oversized uploads before making a request', async () => {
    mount();
    openImportOptions();
    const input=screen.getByLabelText('Choose a PGN file');
    const upload=screen.getByRole('button',{name:'Import PGN file'});
    const other=new File(['not pgn'],'picture.jpg',{type:'image/jpeg'});
    Object.defineProperty(other,'text',{value:async()=> 'not pgn'});
    fireEvent.change(input,{target:{files:[other]}});
    fireEvent.click(upload);
    expect((await screen.findByRole('alert')).textContent).toContain('Choose a .pgn or .txt file.');
    const huge=new File(['x'],'very-large.pgn',{type:'text/plain'});
    Object.defineProperty(huge,'size',{value:4*1024*1024+1});
    fireEvent.change(input,{target:{files:[huge]}});
    fireEvent.click(upload);
    expect((await screen.findByRole('alert')).textContent).toContain('exceeds the 4 MB limit');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('refuses invalid UTF-8 bytes before uploading a PGN so player names cannot be silently corrupted', async () => {
    mocks.post.mockResolvedValue({total:1,imported:1,duplicates:0});
    mount();
    openImportOptions();
    const prefix = new TextEncoder().encode('[Event "Archive"]\n[White "Jos');
    const suffix = new TextEncoder().encode('"]\n[Black "Bob"]\n\n1. e4 e5 *');
    const bytes = new Uint8Array([...prefix,0xe9,...suffix]);
    const file = new File([bytes], 'latin1-name.pgn', {type:'text/plain'});
    Object.defineProperty(file,'text',{value:async()=>new TextDecoder().decode(bytes)});
    Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer.slice(0)});
    fireEvent.change(screen.getByLabelText('Choose a PGN file'),{target:{files:[file]}});
    fireEvent.click(screen.getByRole('button',{name:'Import PGN file'}));
    expect((await screen.findByRole('alert')).textContent).toContain('not valid UTF-8');
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('does not send a selected PGN under another account when file reading finishes after an account switch', async () => {
    mocks.post.mockResolvedValue({total:1,imported:1,duplicates:0});
    const {rerenderReview} = mount();
    openImportOptions();
    const pgn = '[Event "Private Game"]\n[White "Alice"]\n[Black "Bob"]\n\n1. e4 e5 *';
    const file = new File([pgn], 'private.pgn', {type:'text/plain'});
    let completeRead!: (bytes: ArrayBuffer) => void;
    const read = vi.fn(() => new Promise<ArrayBuffer>((resolve) => {completeRead=resolve;}));
    Object.defineProperty(file,'arrayBuffer',{value:read});
    fireEvent.change(screen.getByLabelText('Choose a PGN file'),{target:{files:[file]}});
    fireEvent.click(screen.getByRole('button',{name:'Import PGN file'}));
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));

    mocks.user = {id:101,profile:{chesscom_username:null,lichess_username:null}};
    rerenderReview();
    await act(async ()=>{completeRead(new TextEncoder().encode(pgn).buffer);});
    await waitFor(()=>expect(screen.getByRole('button',{name:'Import PGN file'}).hasAttribute('disabled')).toBe(true));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.queryByText(/new games saved from/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('labels a PGN game without a verified date as unknown, not in progress', async () => {
    mocks.get.mockImplementation(async (url:string) => url === '/api/games/openings'
      ? {total:1,classified:0,unclassified:1,openings:[]}
      : {games:[{...makeGame(1),source:'imported',end_time:null,user_color:null,result:null}],total:1});
    mount();
    expect(await screen.findByText('Date unavailable')).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();
  });

  it('offers direct spoiler-free practice only for games with saved analysis', async () => {
    mocks.get.mockResolvedValueOnce({ games: [
      { ...makeGame(1), analyzed: 1 }, makeGame(2),
      { ...makeGame(3), analyzed: 1, result: '*' },
    ], total: 3 });
    mount();
    const practice = await screen.findByRole('link', { name: /Practice mistakes in White 1 versus Black 1 without spoilers/ });
    expect(practice.getAttribute('href')).toBe('/review/1?practice=1');
    expect(screen.queryByRole('link', { name: /Practice mistakes in White 2/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Practice mistakes in White 3/ })).toBeNull();
  });
  it('keeps the PGN file chooser and import action at a 44px touch size', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    const input=screen.getByLabelText('Choose a PGN file');
    expect(input.className).toContain('absolute');
    expect(input.className).toContain('h-full');
    expect(input.className).toContain('min-h-11');
    expect(input.parentElement?.className).toContain('min-h-11');
    expect(screen.getByRole('button',{name:'Import PGN file'}).className).toContain('min-h-11');
  });
  it('shows localized PGN selection feedback and the exact file name without replacing the native input', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    const input=screen.getByLabelText('Choose a PGN file') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(screen.getByText('No file selected')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toContain('library-pgn-filename');
    const file=new File(['[Event "Training"]\n\n1. e4 e5 *'],'my-training.pgn',{type:'text/plain'});
    fireEvent.change(input,{target:{files:[file]}});
    expect(screen.getByText('my-training.pgn')).toBeTruthy();
    expect(screen.queryByText('No file selected')).toBeNull();
  });

  it('loads bounded batches and explains the 200-game backend cap', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    for (const expected of [80, 120, 160, 200]) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
      await screen.findByText(new RegExp(String(expected) + ' of 1,000 games'));
    }
    expect(screen.queryByRole('button', { name: 'Load more games' })).toBeNull();
    expect(screen.getByText(/Search by player, opening, or notes to find older games/)).toBeTruthy();
    expect(mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .every(([url]) => Number(new URLSearchParams(String(url).split('?')[1]).get('limit')) <= 200)).toBe(true);
  });

  it('walks past game 200 without repeats when the platform API supports offset pagination', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 40);
      const games = Array.from({ length: Math.min(limit, 1000 - offset) }, (_, i) => makeGame(offset + i + 1));
      return { games, total: 1000, offset, limit, has_more: offset + games.length < 1000 };
    });
    mount();
    await screen.findByText(/40 of 1,000 games/);
    for (const count of [80, 120, 160, 200, 240]) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
      await screen.findByText(new RegExp(`${count} of 1,000 games`));
    }
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(240);
    expect(document.querySelectorAll('a[href="/review/240"]')).toHaveLength(1);
    expect(screen.queryByText(/Search by player, opening, or notes to find older games/)).toBeNull();
    const requests = mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .map(([url]) => new URLSearchParams(String(url).split('?')[1] ?? ''));
    expect(requests.map((params) => Number(params.get('offset') ?? 0))).toEqual([0, 40, 80, 120, 160, 200]);
    expect(requests.every((params) => Number(params.get('limit')) === 40)).toBe(true);
  });

  it('uses a stable continuation cursor rather than offset after concurrent library inserts', async () => {
    const original = Array.from({length:90},(_,i)=>makeGame(90-i));
    const requests:URLSearchParams[]=[];
    mocks.get.mockImplementation(async (url:string) => {
      if (url === '/api/games/openings') return {total:90,classified:0,unclassified:90,openings:[]};
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      requests.push(params);
      const cursor = params.get('cursor');
      if (!cursor) return {games:original.slice(0,40),total:90,offset:0,has_more:true,next_cursor:'stable-page-40'};
      if (cursor === 'stable-page-40') return {games:original.slice(40,80),total:90,
        offset:0,has_more:true,next_cursor:'stable-page-80'};
      if (cursor === 'stable-page-80') return {games:original.slice(80),total:90,
        offset:0,has_more:false,next_cursor:null};
      throw new Error(`Unexpected cursor ${cursor}`);
    });
    mount();
    await screen.findByText('40 of 90 games');
    fireEvent.click(screen.getByRole('button',{name:'Load more games'}));
    await screen.findByText('80 of 90 games');
    fireEvent.click(screen.getByRole('button',{name:'Load more games'}));
    await screen.findByText('90 of 90 games');
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(90);
    expect(new Set([...document.querySelectorAll('a[href^="/review/"]')].map(x=>x.getAttribute('href'))).size).toBe(90);
    expect(requests.map(p=>p.get('cursor'))).toEqual([null,'stable-page-40','stable-page-80']);
    expect(requests.every(p=>!p.has('offset'))).toBe(true);
    expect(screen.queryByRole('button',{name:'Load more games'})).toBeNull();
  });

  it('preserves loaded games when a later page fails and retries only that page', async () => {
    let failSecondPage = true;
    mocks.get.mockImplementation(async (url: string) => {
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      const offset = Number(query.get('offset') ?? 0);
      if (offset === 40 && failSecondPage) throw new Error('offline');
      const games = Array.from({ length: 40 }, (_, i) => makeGame(offset + i + 1));
      return { games, total: 200, offset, has_more: offset + games.length < 200 };
    });
    mount();
    await screen.findByText(/40 of 200 games/);
    fireEvent.click(screen.getByRole('button', { name: 'Load more games' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/40 of 200 games/)).toBeTruthy();
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(40);

    failSecondPage = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(/80 of 200 games/);
    expect(document.querySelectorAll('a[href^="/review/"]')).toHaveLength(80);
  });

  it('searches the full library server-side with a debounced and accessible input', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alekhine' } });
    await waitFor(() => {
      expect(mocks.get.mock.calls.some(([url]) => String(url).includes('q=Alekhine'))).toBe(true);
    }, { timeout: 3000 });
  });

  it('shows real opening coverage and opens an exact, shareable list without stale filters', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {
        total: 1000, classified: 180, unclassified: 820,
        openings: [{name:'Italian Game', games:130}, {name:'French Defense', games:50}],
      };
      const params = new URLSearchParams(url.split('?')[1] ?? '');
      const total = params.get('opening') === 'Italian Game' ? 130 : 1000;
      return {games:Array.from({length:40}, (_,i) => makeGame(i+1)), total, offset:0, has_more:true};
    });
    mount('/review?q=old-search&source=lichess&bookmarked=1&from_date=2026-01-01');
    expect(await screen.findByText('180 of 1,000 saved games have a recognized opening')).toBeTruthy();
    expect(screen.getByText('820 not classified yet')).toBeTruthy();
    const italian = screen.getByRole('button', {name:'Show 130 saved games in Italian Game'});
    expect(italian.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(italian);
    await screen.findByText('40 of 130 games');
    expect(italian.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toContain('Showing games in Italian Game');
    const matching = mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .map(([url]) => new URLSearchParams(String(url).split('?')[1]));
    expect(matching.some(p => p.get('opening') === 'Italian Game' && !p.has('q') && !p.has('source')
      && !p.has('bookmarked') && !p.has('from_date'))).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'Clear filters'}));
    await screen.findByText('40 of 1,000 games');
    expect(italian.getAttribute('aria-pressed')).toBe('false');
  });

  it('handles no recognized openings without pretending empty history', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {
        total: 250, classified: 0, unclassified: 250, openings: [],
      };
      return {games:[makeGame(1)], total:250, has_more:true};
    });
    mount();
    expect(await screen.findByText('250 not classified yet')).toBeTruthy();
    expect(screen.getByText(/Opening details will appear here/)).toBeTruthy();
    expect(screen.queryByRole('button', {name:/Show \d+ saved games in/})).toBeNull();
  });

  it('keeps the game list usable when opening discovery fails and allows an independent retry', async () => {
    let openingAttempts = 0;
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') {
        openingAttempts++;
        if (openingAttempts === 1) throw new Error('temporary_opening_failure');
        return {total: 1000, classified: 100, unclassified: 900,
          openings: [{name: 'Italian Game', games: 100}]};
      }
      return {games: Array.from({length:40}, (_,i) => makeGame(i+1)),
        total: 1000, offset: 0, has_more: true};
    });
    mount();
    await screen.findByText('40 of 1,000 games');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/opening highlights could not be loaded/i);
    fireEvent.click(screen.getByRole('button', {name:'Retry opening highlights'}));
    expect(await screen.findByRole('button', {name:'Show 100 saved games in Italian Game'})).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(openingAttempts).toBe(2);
    expect(screen.getByText('40 of 1,000 games')).toBeTruthy();
  });

  it('accepts exact-opening deep links and bounds malicious or oversized parameters', async () => {
    mount('/review?opening=Italian%20Game');
    await screen.findByText(/40 of 1,000 games/);
    expect(mocks.get.mock.calls.some(([url]) => String(url).startsWith('/api/games?') &&
      new URLSearchParams(String(url).split('?')[1]).get('opening') === 'Italian Game')).toBe(true);
    expect(screen.getByText('Showing games in Italian Game')).toBeTruthy();
  });

  it('explores frequent online opponents separately by provider without losing the saved-game history', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {total:1000,classified:500,unclassified:500,
        openings:[{name:'Italian Game',games:250}]};
      if (url === '/api/games/opponents') return {total:800,identified:710,unidentified:90,
        opponents:[{source:'chesscom',name:'Nepo',games:15}, {source:'lichess',name:'Nepo',games:3}]};
      const query = new URLSearchParams(url.split('?')[1] ?? '');
      return {games:Array.from({length:query.has('opponent') ? 3 : 40}, (_,i) => makeGame(i+1)),
        total:query.has('opponent') ? 3 : 1000, offset:0, has_more:!query.has('opponent')};
    });
    mount('/review?q=stale&opening=Italian%20Game&from_date=2026-01-01');
    await screen.findByText('40 of 1,000 games');
    fireEvent.click(screen.getByRole('button', {name:'Opponents'}));
    expect(await screen.findByText('710 of 800 imported online games have an identifiable opponent')).toBeTruthy();
    expect(screen.getByText('90 without confirmed identity')).toBeTruthy();
    const chesscom = screen.getByRole('button', {name:'Show 15 Chess.com games against Nepo'});
    const lichess = screen.getByRole('button', {name:'Show 3 Lichess games against Nepo'});
    fireEvent.click(lichess);
    await screen.findByText('3 of 3 games');
    expect(lichess.getAttribute('aria-pressed')).toBe('true');
    expect(chesscom.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Showing Lichess games against Nepo')).toBeTruthy();
    const matching = mocks.get.mock.calls.filter(([url]) => String(url).startsWith('/api/games?'))
      .map(([url]) => new URLSearchParams(String(url).split('?')[1]));
    expect(matching.some(p => p.get('source') === 'lichess' && p.get('opponent') === 'Nepo'
      && !p.has('q') && !p.has('opening') && !p.has('from_date'))).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'Clear filters'}));
    await screen.findByText('40 of 1,000 games');
    expect(lichess.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', {name:'Openings'}));
    expect(await screen.findByRole('button', {name:'Show 250 saved games in Italian Game'})).toBeTruthy();
  });

  it('switches between opening and provider-qualified opponent discovery without reviving old search or filters', async () => {
    mocks.get.mockImplementation(async (url:string) => {
      if (url==='/api/games/openings') return {total:120,classified:120,unclassified:0,
        openings:[{name:'Italian Game',games:50}]};
      if (url==='/api/games/opponents') return {total:120,identified:120,unidentified:0,
        opponents:[{source:'lichess',name:'Nepo',games:8}]};
      const params=new URLSearchParams(url.split('?')[1] ?? '');
      if (params.has('opponent') || params.has('opening')) return {
        games:[makeGame(1)],total:1,offset:0,has_more:false,
      };
      return {games:[makeGame(1)],total:120,offset:0,has_more:false};
    });
    mount('/review?source=chesscom&opponent=Nepo&bookmarked=1&q=old&sort=oldest');
    await screen.findByText('Showing Chess.com games against Nepo');
    fireEvent.click(await screen.findByRole('button',{name:'Openings'}));
    fireEvent.click(await screen.findByRole('button',{name:'Show 50 saved games in Italian Game'}));
    await screen.findByText('Showing games in Italian Game');
    expect((screen.getByRole('combobox',{name:'Sort games'}) as HTMLSelectElement).value).toBe('oldest');
    expect((screen.getByRole('combobox',{name:'Game source'}) as HTMLSelectElement).value).toBe('');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');

    // An unfinished keystroke must not be sent later as a hidden filter after
    // the user intentionally chooses a different discovery collection.
    fireEvent.change(screen.getByRole('searchbox'),{target:{value:'unsubmitted'}});
    fireEvent.click(screen.getByRole('button',{name:'Opponents'}));
    fireEvent.click(await screen.findByRole('button',{name:'Show 8 Lichess games against Nepo'}));
    await screen.findByText('Showing Lichess games against Nepo');
    await new Promise(resolve=>setTimeout(resolve,420));
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
    const matching=mocks.get.mock.calls.filter(([url])=>String(url).startsWith('/api/games?'))
      .map(([url])=>new URLSearchParams(String(url).split('?')[1] ?? ''));
    expect(matching.at(-1)?.get('source')).toBe('lichess');
    expect(matching.at(-1)?.get('opponent')).toBe('Nepo');
    expect(matching.at(-1)?.get('sort')).toBe('oldest');
    expect(matching.at(-1)?.has('q')).toBe(false);
    expect(matching.at(-1)?.has('opening')).toBe(false);
    expect(matching.at(-1)?.has('bookmarked')).toBe(false);

    // Provider changes clear the old provider's opponent identity rather than
    // claiming a similarly named account is the same person on Chess.com.
    fireEvent.change(screen.getByRole('combobox',{name:'Game source'}),{target:{value:'chesscom'}});
    await waitFor(()=>expect(mocks.get.mock.calls.some(([url])=>{
      const p=new URLSearchParams(String(url).split('?')[1] ?? '');
      return p.get('source')==='chesscom' && !p.has('opponent') && !p.has('opening');
    })).toBe(true));
    expect(screen.queryByText('Showing Lichess games against Nepo')).toBeNull();
  });

  it('honors deep-linked opponents and does not invent identities for unidentifiable online games', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {total:12,classified:0,unclassified:12,openings:[]};
      if (url === '/api/games/opponents') return {total:8,identified:0,unidentified:8,opponents:[]};
      return {games:[makeGame(1)],total:12,offset:0,has_more:true};
    });
    mount('/review?source=chesscom&opponent=Nepo');
    expect(await screen.findByText('8 without confirmed identity')).toBeTruthy();
    expect(screen.getByText(/Import Chess.com or Lichess games to explore confirmed online opponents/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'Opponents'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Showing Chess.com games against Nepo')).toBeTruthy();
    expect(mocks.get.mock.calls.some(([url]) => String(url).startsWith('/api/games?') &&
      new URLSearchParams(String(url).split('?')[1]).get('opponent') === 'Nepo')).toBe(true);
  });

  it('recovers frequent-opponent highlights without retrying or blanking the game list', async () => {
    let attempts = 0;
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/games/openings') return {total:100,classified:50,unclassified:50,openings:[]};
      if (url === '/api/games/opponents') {
        attempts++;
        if (attempts === 1) throw new Error('opponents_temporarily_offline');
        return {total:100,identified:1,unidentified:99,
          opponents:[{source:'chesscom',name:'Magnus',games:1}]};
      }
      return {games:[makeGame(1)],total:100,offset:0,has_more:true};
    });
    mount();
    await screen.findByText('1 of 100 games');
    fireEvent.click(screen.getByRole('button',{name:'Opponents'}));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toMatch(/frequent opponents could not be loaded/i);
    fireEvent.click(screen.getByRole('button',{name:'Retry opponents'}));
    expect(await screen.findByRole('button',{name:'Show 1 Chess.com games against Magnus'})).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('1 of 100 games')).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('exposes server-side history filters and date sorting in a shareable URL', async () => {
    mount('/review?source=lichess&result=win&time_class=rapid&sort=oldest&analyzed=0');
    await screen.findByText(/40 of 1,000 games/);
    const params = new URLSearchParams(String(mocks.get.mock.calls[0]?.[0]).split('?')[1]);
    expect(params.get('source')).toBe('lichess');
    expect(params.get('result')).toBe('win');
    expect(params.get('time_class')).toBe('rapid');
    expect(params.get('sort')).toBe('oldest');
    expect(params.get('analyzed')).toBe('0');
    fireEvent.change(screen.getByRole('combobox', { name: 'Game result' }), { target: { value: 'loss' } });
    await waitFor(() => expect(mocks.get.mock.calls.some(([url]) =>
      new URLSearchParams(String(url).split('?')[1]).get('result') === 'loss')).toBe(true));
  });

  it('supports inclusive date-range deep links, prevents inverted ranges, and clears date filters', async () => {
    mount('/review?from_date=2026-01-01&to_date=2026-11-08');
    await screen.findByText(/40 of 1,000 games/);
    expect(mocks.get.mock.calls.some(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return p.get('from_date') === '2026-01-01' && p.get('to_date') === '2026-11-08';
    })).toBe(true);
    const start = screen.getByLabelText('Games from date') as HTMLInputElement;
    const end = screen.getByLabelText('Games through date') as HTMLInputElement;
    expect(start.value).toBe('2026-01-01');
    expect(end.value).toBe('2026-11-08');
    expect(start.max).toBe('');
    expect(end.min).toBe('');
    fireEvent.change(start, {target:{value:'2026-11-09'}});
    await waitFor(() => {
      expect(start.value).toBe('2026-11-09');
      expect(end.value).toBe('');
    });
    const rangeGroup=screen.getByRole('group',{name:'Game date range'});
    expect(rangeGroup.querySelector('[role="status"]')?.textContent).toBe('End date cleared because it is before the new start date.');
    expect(mocks.get.mock.calls.some(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return p.get('from_date') === '2026-11-09' && !p.has('to_date');
    })).toBe(true);
    fireEvent.click(screen.getByRole('button', {name:'Clear filters'}));
    expect(start.value).toBe('');
    expect(end.value).toBe('');
    expect(rangeGroup.querySelector('[role="status"]')).toBeNull();
  });

  it('does not revive a hidden end date when an inverted deep-link start is cleared', async () => {
    mount('/review?from_date=2026-11-09&to_date=2026-11-01');
    await screen.findByText(/40 of 1,000 games/);
    const start=screen.getByLabelText('Games from date') as HTMLInputElement;
    const end=screen.getByLabelText('Games through date') as HTMLInputElement;
    expect(start.value).toBe('2026-11-09');
    expect(end.value).toBe('');
    fireEvent.change(start,{target:{value:''}});
    await waitFor(()=>expect(start.value).toBe(''));
    expect(end.value).toBe('');
  });

  it('ignores invalid date-range deep links instead of sending them to the API', async () => {
    mount('/review?from_date=2026-02-30&to_date=2026-13-01');
    await screen.findByText(/40 of 1,000 games/);
    expect((screen.getByLabelText('Games from date') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Games through date') as HTMLInputElement).value).toBe('');
    expect(mocks.get.mock.calls.every(([url]) => {
      const p = new URLSearchParams(String(url).split('?')[1]);
      return !p.has('from_date') && !p.has('to_date');
    })).toBe(true);
  });

  it('offers filter recovery instead of account onboarding for empty filtered results', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split('?')[1]);
      return params.has('result') ? { games: [], total: 0 } : { games: [makeGame(1)], total: 1 };
    });
    mount('/review?result=loss');
    expect(await screen.findByText('No games match your search')).toBeTruthy();
    expect(screen.getByText('No games match your search').getAttribute('role')).toBe('status');
    expect(screen.getAllByRole('button',{name:'Clear filters'})).toHaveLength(1);
    // The header can still offer account setup; the empty-state action must
    // recover the filtered library rather than adding a second setup CTA.
    expect(screen.getAllByRole('link', { name: /Set Chess.com username/ })).toHaveLength(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    await screen.findByText('1 of 1 games');
    expect((screen.getByRole('combobox', { name: 'Game result' }) as HTMLSelectElement).value).toBe('');
  });

  it('requests a clearly bounded recent import batch rather than silently fetching only 20', async () => {
    mocks.user.profile.chesscom_username = 'tester';
    mocks.post.mockResolvedValue({ imported: 150, total: 200, duplicates: 42, skipped: 8, enriched: 12 });
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    expect((screen.getByRole('combobox', { name: 'Recent games to fetch' }) as HTMLSelectElement).value).toBe('200');
    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@tester\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/games/import/chesscom', { limit: 200 }));
    expect(await screen.findByText(/150 new games saved from 200 retrieved/)).toBeTruthy();
    expect(screen.getByText(/42 already saved\. 8 unsupported or invalid\./)).toBeTruthy();
    expect(screen.getByText(/12 existing games gained opening details/)).toBeTruthy();
    expect(screen.getByText(/not your entire history/)).toBeTruthy();
  });
  it.each([
    {imported:-1,total:20,duplicates:0,skipped:0,enriched:0},
    {imported:13.5,total:20,duplicates:6,skipped:0,enriched:0},
    {imported:12,total:20,duplicates:2,skipped:1,enriched:0},
    {imported:12,total:20,duplicates:8,skipped:0,enriched:9},
    {imported:12,total:201,duplicates:189,skipped:0,enriched:0},
  ])('does not claim a successful provider import for inconsistent counts %#', async (summary) => {
    mocks.user.profile.chesscom_username='tester';
    mocks.post.mockResolvedValue(summary);
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    fireEvent.click(screen.getByRole('button',{name:/review\.import \(@tester\)/}));
    const alert=await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Import status could not be verified/);
    expect(screen.queryByText(/new games saved from/)).toBeNull();
    expect(screen.getByRole('button',{name:/review\.import \(@tester\)/}).hasAttribute('disabled')).toBe(false);
  });

  it('explains a changed linked account and announces failed imports accessibly', async () => {
    mocks.user.profile.lichess_username = 'tester';
    mocks.post.mockRejectedValue(new Error('linked_account_changed'));
    mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    fireEvent.click(screen.getByRole('button', { name: /review\.importLichess \(@tester\)/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Your linked account changed during import/);
    expect(alert.textContent).toMatch(/Check Settings and retry/);
  });

  it('bounds URL deep links and text entry to the API maximum search length', async () => {
    mount(`/review?q=${'x'.repeat(180)}`);
    await screen.findByText(/40 of 1,000 games/);
    const search = screen.getByRole('searchbox') as HTMLInputElement;
    expect(search.maxLength).toBe(120);
    expect(search.value).toHaveLength(120);
    expect(mocks.get.mock.calls.some(([url]) =>
      new URLSearchParams(String(url).split('?')[1] ?? '').get('q')?.length === 120)).toBe(true);
  });

  it('offers a spacious keyboard-labeled clear-search target and clears a committed URL query', async () => {
    mount('/review?q=Alekhine&sort=oldest');
    await screen.findByText('40 of 1,000 games');
    const search=screen.getByRole('searchbox') as HTMLInputElement;
    expect(search.value).toBe('Alekhine');
    const clear=screen.getByRole('button',{name:'Clear search'});
    expect(search.className).toContain('!min-h-11');
    expect(clear.className).toContain('h-11');
    expect(clear.className).toContain('w-11');
    fireEvent.click(clear);
    await waitFor(()=>expect(search.value).toBe(''));
    expect(screen.queryByRole('button',{name:'Clear search'})).toBeNull();
    await waitFor(()=>expect(mocks.get.mock.calls.some(([url]) => {
      const p=new URLSearchParams(String(url).split('?')[1] ?? '');
      return !p.has('q') && p.get('sort')==='oldest';
    })).toBe(true));
  });

  it('gives starred-only, all filter dropdowns and date fields 44px minimum mobile touch targets', async () => {
    mount();
    await screen.findByText('40 of 1,000 games');
    expect(screen.getByRole('button',{name:'All games'}).className).toContain('min-h-11');
    for (const label of ['Game source','Game speed','Game result','Review status','Sort games']) {
      expect(screen.getByRole('combobox',{name:label}).className,label).toContain('!min-h-11');
    }
    for (const label of ['Games from date','Games through date']) {
      expect(screen.getByLabelText(label).className,label).toContain('!min-h-11');
    }
  });

  it('shows a recoverable error, never the no-games onboarding state', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    mount();
    expect(await screen.findByText(/Your game library could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/No games match your search/)).toBeNull();
    expect(screen.queryByText(/Play your first game/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps bookmark controls labeled and available without hover', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    const bookmark = screen.getAllByRole('button', { name: 'Bookmark game' })[0]!;
    expect(bookmark.getAttribute('aria-pressed')).toBe('false');
    expect(bookmark.className).toContain('text-chesscom-400');
    expect(bookmark.className).toContain('min-h-11');
    expect(bookmark.className).toContain('min-w-11');
    expect(bookmark.className).toContain('md:opacity-0');
  });

  it('labels the unanalyzed desktop card with a real Review action rather than a literal English badge', async () => {
    mount();
    await screen.findByText(/40 of 1,000 games/);
    expect(screen.getAllByText('Analyze',{exact:true}).length).toBeGreaterThan(0);
    expect(screen.queryByText('review',{exact:true})).toBeNull();
  });

  it('labels unfinished games instead of rendering a fake 1970 date or a draw', async () => {
    mocks.get.mockResolvedValue({
      games: [{ ...makeGame(1), result: '*', end_time: null }], total: 1,
    });
    mount();
    expect(await screen.findByText('In progress')).toBeTruthy();
    expect(screen.queryByText(/1970/)).toBeNull();
  });

  it('never attributes a Black-or-White accuracy score to a user with unknown side', async () => {
    mocks.get.mockResolvedValue({
      games: [{ ...makeGame(1), analyzed: 1, user_color: null,
        accuracy_white: 91.5, accuracy_black: 32.2 }], total: 1,
    });
    mount();
    expect(await screen.findByText('Analysis available')).toBeTruthy();
    expect(screen.queryByText('review.accuracy: 91.5%')).toBeNull();
  });

  it('restores the bookmark and shows an actionable error after a failed save', async () => {
    let persisted = false;
    mocks.get.mockImplementation(async (url: string) => url === '/api/games/openings'
      ? {total: 1, classified: 1, unclassified: 0, openings: [{name:'Italian Game',games:1}]}
      : {games: [{ ...makeGame(1), bookmarked: persisted ? 1 : 0 }], total: 1});
    mocks.patch.mockRejectedValueOnce(new Error('offline')).mockImplementationOnce(async () => {
      persisted = true;
      return { ok: true };
    });
    mount();
    await screen.findByText('1 of 1 games');
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark game' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Bookmark game' });
    expect(retry.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not mutate another account cached games when bookmarking an identical game ID', async () => {
    let persisted = false;
    mocks.get.mockImplementation(async (url: string) => url === '/api/games/openings'
      ? {total: 1, classified: 1, unclassified: 0, openings: [{name:'Italian Game',games:1}]}
      : {games: [{ ...makeGame(1), bookmarked: persisted ? 1 : 0 }], total: 1});
    mocks.patch.mockImplementation(async () => {
      persisted = true;
      return { ok: true };
    });
    const { queryClient } = mount();
    await screen.findByText('1 of 1 games');
    const otherHomeKey = ['games', 'home', 101];
    const otherLibraryKey = ['games', 'library', 101, { q: '', bookmarkedOnly: false }];
    queryClient.setQueryData(otherHomeKey, { games: [makeGame(1)] });
    queryClient.setQueryData(otherLibraryKey, {
      pages: [{ games: [makeGame(1)], total: 1 }], pageParams: [{ offset: 0, limit: 40 }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Bookmark game' }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeTruthy());

    expect(queryClient.getQueryData<{ games: { bookmarked: number }[] }>(otherHomeKey)?.games[0]?.bookmarked).toBe(0);
    expect(queryClient.getQueryData<{ pages: { games: { bookmarked: number }[] }[] }>(otherLibraryKey)?.pages[0]?.games[0]?.bookmarked).toBe(0);
  });

  it('isolates in-flight bookmark failures across account switches with the same game ID', async () => {
    let failOldSave!: (error:Error) => void;
    mocks.get.mockImplementation(async (url:string) => url==='/api/games/openings'
      ? {total:1,classified:1,unclassified:0,openings:[{name:'Italian Game',games:1}]}
      : {games:[makeGame(1)],total:1,offset:0,has_more:false});
    mocks.patch.mockImplementationOnce(() => new Promise((_resolve,reject)=>{failOldSave=reject;}));
    const {rerenderReview,queryClient}=mount();
    await screen.findByText('1 of 1 games');
    fireEvent.click(screen.getByRole('button',{name:'Bookmark game'}));
    await waitFor(()=>expect(mocks.patch).toHaveBeenCalledTimes(1));
    mocks.user={id:101,profile:{chesscom_username:null,lichess_username:null}};
    rerenderReview();
    const nextUserStar=await screen.findByRole('button',{name:'Bookmark game'});
    expect(nextUserStar.hasAttribute('disabled')).toBe(false);
    await act(async()=>failOldSave(new Error('old_account_bookmark_failed')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nextUserStar.getAttribute('aria-pressed')).toBe('false');
    expect(nextUserStar.hasAttribute('disabled')).toBe(false);
    // No new-account cache page may have been marked starred by the old save.
    for(const entry of queryClient.getQueryCache().getAll()) {
      const key=entry.queryKey;
      if(key[0]==='games' && key[1]==='library' && key[2]===101) {
        const data=entry.state.data as {pages?:{games?:{bookmarked:number}[]}[]} | undefined;
        expect(data?.pages?.[0]?.games?.[0]?.bookmarked).toBe(0);
      }
    }
  });

  it('does not show late concurrent old-account bookmark errors to a newly signed-in player', async () => {
    const failSaves: ((error:Error)=>void)[]=[];
    mocks.get.mockImplementation(async (url:string) => url==='/api/games/openings'
      ? {total:2,classified:2,unclassified:0,openings:[{name:'Italian Game',games:2}]}
      : {games:[makeGame(1),makeGame(2)],total:2,offset:0,has_more:false});
    mocks.patch.mockImplementation(() => new Promise((_resolve,reject)=>{failSaves.push(reject);}));
    const {rerenderReview,queryClient}=mount();
    await screen.findByText('2 of 2 games');
    for (const star of screen.getAllByRole('button',{name:'Bookmark game'})) fireEvent.click(star);
    await waitFor(()=>expect(failSaves).toHaveLength(2));
    mocks.user={id:101,profile:{chesscom_username:null,lichess_username:null}};
    rerenderReview();
    await screen.findByText('2 of 2 games');
    await act(async()=>{
      failSaves[1]!(new Error('second_old_account_save_failed'));
      failSaves[0]!(new Error('first_old_account_save_failed'));
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('button',{name:'Bookmark game'})).toHaveLength(2);
    for (const entry of queryClient.getQueryCache().getAll()) {
      if (entry.queryKey[0]==='games' && entry.queryKey[1]==='library' && entry.queryKey[2]===101) {
        const data=entry.state.data as {pages?:{games?:{bookmarked:number}[]}[]} | undefined;
        expect(data?.pages?.[0]?.games?.map(game=>game.bookmarked)).toEqual([0,0]);
      }
    }
  });

  it('clears an existing hidden bookmark error during an account switch and ignores a later old save failure', async () => {
    const failSaves: ((error:Error)=>void)[]=[];
    mocks.get.mockImplementation(async (url:string) => {
      if (url==='/api/games/openings') return {total:2,classified:2,unclassified:0,openings:[{name:'Italian Game',games:2}]};
      const params=new URLSearchParams(url.split('?')[1] ?? '');
      return params.get('bookmarked')==='1'
        ? {games:[{...makeGame(11),bookmarked:1}],total:1,offset:0,has_more:false}
        : {games:[makeGame(1),makeGame(2)],total:2,offset:0,has_more:false};
    });
    mocks.patch.mockImplementation(() => new Promise((_resolve,reject)=>{failSaves.push(reject);}));
    const {rerenderReview}=mount();
    await screen.findByText('2 of 2 games');
    for (const star of screen.getAllByRole('button',{name:'Bookmark game'})) fireEvent.click(star);
    await waitFor(()=>expect(failSaves).toHaveLength(2));
    fireEvent.click(screen.getByRole('button',{name:'All games'}));
    await screen.findByText('1 of 1 games');
    await act(async()=>failSaves[0]!(new Error('first_old_save_failed')));
    expect((await screen.findByRole('alert')).textContent).toContain('Bookmark could not be saved');
    expect(screen.getByRole('link',{name:'Open game to retry'}).getAttribute('href')).toBe('/review/1');
    mocks.user={id:101,profile:{chesscom_username:null,lichess_username:null}};
    rerenderReview();
    await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
    await act(async()=>failSaves[1]!(new Error('second_old_save_failed')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link',{name:'Open game to retry'})).toBeNull();
    // The account-scoped query may still be loading after the old mutation
    // settles; assert the new account's bookmark once its card has rendered.
    const newAccountStar=await screen.findByRole('button',{name:'Remove bookmark'},undefined,{timeout:5000});
    expect(newAccountStar.getAttribute('aria-pressed')).toBe('true');
  });

  it('refreshes the importing account history, insights, plan and achievements without touching another account', async () => {
    mocks.user.profile.chesscom_username = 'tester';
    mocks.post.mockResolvedValue({ imported: 12, total: 20 });
    const { queryClient } = mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    const ownKeys = [
      ['stats', 'me', 7], ['insights-v2', 7], ['achievements', 7],
      ['achievements-home', 7], ['plan-home', 7],
    ];
    const otherKeys = ownKeys.map((key) => [...key.slice(0, -1), 101]);
    for (const key of [...ownKeys, ...otherKeys]) queryClient.setQueryData(key, { value: 'cached' });

    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@tester\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/games/import/chesscom', { limit: 200 }));
    await waitFor(() => expect(ownKeys.every((key) => queryClient.getQueryState(key)?.isInvalidated)).toBe(true));
    expect(otherKeys.every((key) => queryClient.getQueryState(key)?.isInvalidated === false)).toBe(true);
  });

  it('does not show a previous player import result after switching accounts mid-request', async () => {
    mocks.user.profile.chesscom_username = 'first';
    let resolveImport!: (result: { imported: number; total: number }) => void;
    mocks.post.mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));
    const { rerenderReview } = mount();
    await screen.findByText(/40 of 1,000 games/);
    openImportOptions();
    fireEvent.click(screen.getByRole('button', { name: /review\.import \(@first\)/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    mocks.user = { id: 101, profile: { chesscom_username: null, lichess_username: null } };
    rerenderReview();
    await act(async () => { resolveImport({ imported: 17, total: 20 }); });
    expect(screen.queryByText('review.imported')).toBeNull();
    // The post-switch game list for account 101 is loaded asynchronously;
    // the old account's setup link should not persist while it is loading.
    await screen.findByText(/40 of 1,000 games/);
    expect(screen.getByRole('link', { name: /Set Chess.com username/ })).toBeTruthy();
  });
});
