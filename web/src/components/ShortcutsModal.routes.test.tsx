// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import ShortcutsModal from './ShortcutsModal';

afterEach(cleanup);

describe('shared keyboard shortcuts help', () => {
  it('documents every global G navigation route in a named, accessible section', async () => {
    await i18n.changeLanguage('en');
    render(<ShortcutsModal open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const section of ['Global', 'Navigation', 'Game Review']) {
      expect(within(dialog).getByRole('heading', { name: section })).toBeTruthy();
    }

    const section = within(dialog).getByRole('heading', { name: 'Navigation' }).closest('section');
    expect(section).not.toBeNull();
    const documented = [
      ['G H', 'Go to Home'],
      ['G P', 'Go to Play'],
      ['G R', 'Go to Review'],
      ['G I', 'Go to Insights'],
      ['G T', 'Go to Tactic Trainer'],
      ['G E', 'Go to Learn'],
      ['G S', 'Go to Settings'],
      ['G O', 'Go to Openings'],
      ['G N', 'Go to Improvement Plan'],
      ['G L', 'Go to Lab'],
      ['G U', 'Go to Players'],
    ];
    for (const [keys, destination] of documented) {
      expect(within(section!).getByText(keys)).toBeTruthy();
      expect(within(section!).getByText(destination)).toBeTruthy();
    }
    expect(section!.querySelectorAll('kbd')).toHaveLength(documented.length);
  });

  it('hides the modal when closed', () => {
    render(<ShortcutsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
