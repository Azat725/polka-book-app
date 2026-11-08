import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReaderDialog } from './ReaderDialog';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('reader dialogs', () => {
  it('focuses the field and restores focus to the invoking control after dismissal', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const close = vi.fn();
    const view = render(
      <ReaderDialog title="Password" onClose={close}>
        <label>
          Password
          <input aria-label="PDF password" />
        </label>
      </ReaderDialog>,
    );
    const input = screen.getByLabelText('PDF password');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('traps keyboard focus and preserves it when a callback changes', () => {
    const view = render(
      <ReaderDialog title="Note" onClose={vi.fn()}>
        <label>
          Text
          <input aria-label="Note text" />
        </label>
        <button>Save</button>
      </ReaderDialog>,
    );
    const input = screen.getByLabelText('Note text');
    view.rerender(
      <ReaderDialog title="Note" onClose={vi.fn()}>
        <label>
          Text
          <input aria-label="Note text" />
        </label>
        <button>Save</button>
      </ReaderDialog>,
    );
    expect(input).toHaveFocus();
    const last = screen.getByRole('button', { name: 'Save' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'cancel' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('does not silently choose a position when a progress conflict is dismissed', () => {
    const close = vi.fn();
    render(
      <ReaderDialog title="Conflict" onClose={close} dismissible={false}>
        <button>Keep local</button>
        <button>Use server</button>
      </ReaderDialog>,
    );
    expect(screen.queryByRole('button', { name: 'cancel' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep local' }), { key: 'Escape' });
    fireEvent.pointerDown(screen.getByRole('dialog').parentElement!);
    expect(close).not.toHaveBeenCalled();
  });
});
