import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConflictDialog } from './ConflictDialog';
import { Dialog } from './Dialog';
import { SaveIndicator } from './SaveIndicator';
import { Field, StatusChip } from './Ui';

describe('SaveIndicator', () => {
  it('states the save status in text, not colour alone', () => {
    const { rerender } = render(<SaveIndicator state="saving" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving');

    rerender(<SaveIndicator state="saved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    rerender(<SaveIndicator state="conflict" />);
    expect(screen.getByRole('status')).toHaveTextContent('Conflict');

    rerender(<SaveIndicator state="unsaved" />);
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved');
  });
});

describe('StatusChip', () => {
  it('always carries a readable label alongside its tone', () => {
    render(<StatusChip tone="success">Passed</StatusChip>);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('hides the decorative glyph from assistive technology', () => {
    const { container } = render(<StatusChip tone="danger">Not yet</StatusChip>);
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon).not.toBeNull();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('associates the label and the error with the control', () => {
    render(
      <Field label="Repository URL" htmlFor="repo" error="That URL is not valid">
        <input id="repo" />
      </Field>,
    );
    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('That URL is not valid');
  });
});

describe('Dialog', () => {
  it('is a modal dialog labelled by its title and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open title="Delete this note?" onClose={onClose}>
        <button type="button">Inside</button>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Delete this note?')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('moves focus into the dialog when it opens', () => {
    render(
      <Dialog open title="Focus test" onClose={() => undefined}>
        <button type="button">First action</button>
      </Dialog>,
    );
    expect(screen.getByRole('button', { name: 'First action' })).toHaveFocus();
  });

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} title="Hidden" onClose={() => undefined}>
        <span>content</span>
      </Dialog>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('ConflictDialog', () => {
  const props = {
    open: true,
    documentLabel: 'This note',
    localText: 'my local words',
    serverText: 'their server words',
    serverUpdatedAt: '2026-09-09T10:00:00.000Z',
    onKeepServer: vi.fn(),
    onKeepLocal: vi.fn(),
    onMerge: vi.fn(),
    onDismiss: vi.fn(),
  };

  it('shows BOTH versions so neither is lost', () => {
    render(<ConflictDialog {...props} />);
    expect(screen.getByText('my local words')).toBeInTheDocument();
    expect(screen.getByText('their server words')).toBeInTheDocument();
  });

  it('offers keep-server, keep-mine and manual merge', async () => {
    const user = userEvent.setup();
    const onKeepServer = vi.fn();
    const onKeepLocal = vi.fn();
    render(<ConflictDialog {...props} onKeepServer={onKeepServer} onKeepLocal={onKeepLocal} />);

    expect(screen.getByRole('button', { name: /merge manually/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /keep server version/i }));
    expect(onKeepServer).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /save my version/i }));
    expect(onKeepLocal).toHaveBeenCalled();
  });

  it('seeds the manual merge with the local text', async () => {
    const user = userEvent.setup();
    render(<ConflictDialog {...props} />);

    await user.click(screen.getByRole('button', { name: /merge manually/i }));
    expect(screen.getByLabelText('Merged text')).toHaveValue('my local words');
  });
});
