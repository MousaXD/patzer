// @vitest-environment happy-dom
import { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocus } from './useDialogFocus';

function Fixture() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogFocus(open, dialogRef, () => setOpen(false), inputRef);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open search</button>
      {open && (
        <div role="dialog" aria-label="Search" ref={dialogRef} tabIndex={-1}>
          <input ref={inputRef} aria-label="Search input" />
          <button onClick={() => setOpen(false)}>Close search</button>
        </div>
      )}
    </>
  );
}

beforeEach(() => {
  // Happy DOM does not perform layout, so its default getClientRects is empty.
  // This stub models visible focusable controls; real layout is exercised by
  // capture-global-dialogs.mjs in Chromium.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('global dialog keyboard focus', () => {
  it('autofocuses inside and traps Shift+Tab and Tab at the boundaries', async () => {
    render(<Fixture />);
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    const input = screen.getByRole('textbox', { name: 'Search input' });
    const last = screen.getByRole('button', { name: 'Close search' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('Escape dismisses the dialog and restores focus to the original control', async () => {
    render(<Fixture />);
    const opener = screen.getByRole('button', { name: 'Open search' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search input' })));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });
});
