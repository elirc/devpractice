/**
 * MISSION checks — these FAIL on a fresh checkout. That is the assignment.
 *
 * They describe behaviour a user can observe, not implementation details, so
 * there are several correct ways to make them pass.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockTicketApi, SEED_TICKET_COUNT } from '../src/api/mockApi.js';
import { App } from '../src/App.js';

function renderApp(api: ReturnType<typeof createMockTicketApi>) {
  return render(<App api={api} />);
}

describe('ticket list', () => {
  let api: ReturnType<typeof createMockTicketApi>;

  beforeEach(() => {
    api = createMockTicketApi();
  });

  it('shows every seeded ticket once loaded', async () => {
    renderApp(api);
    const list = await screen.findByTestId('ticket-list');
    await waitFor(() => {
      expect(within(list).getAllByRole('listitem')).toHaveLength(SEED_TICKET_COUNT);
    });
    expect(within(list).getByText(/card reader rejects every chip payment/i)).toBeInTheDocument();
  });

  it('shows a loading state before the data arrives', async () => {
    api.setLatency(50);
    renderApp(api);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    await screen.findByTestId('ticket-list');
  });

  it('shows an error state when the request fails', async () => {
    api.setFailure(new Error('network down'));
    renderApp(api);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not|error|failed/i);
  });

  it('shows an empty state, distinct from loading, when there are no tickets', async () => {
    const emptyApi = createMockTicketApi({ startEmpty: true });
    renderApp(emptyApi);
    expect(await screen.findByTestId('ticket-list-empty')).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });
});

describe('status filter', () => {
  it('narrows the list without losing the other tickets', async () => {
    const user = userEvent.setup({ delay: null });
    const api = createMockTicketApi();
    renderApp(api);
    await screen.findByTestId('ticket-list');

    const filter = screen.getByRole('combobox', { name: /filter by status/i });
    await user.selectOptions(filter, 'open');
    await waitFor(() => {
      const items = within(screen.getByTestId('ticket-list')).getAllByRole('listitem');
      expect(items).toHaveLength(2);
    });

    await user.selectOptions(filter, 'all');
    await waitFor(() => {
      expect(
        within(screen.getByTestId('ticket-list')).getAllByRole('listitem'),
      ).toHaveLength(SEED_TICKET_COUNT);
    });
  });
});

describe('create ticket form', () => {
  let api: ReturnType<typeof createMockTicketApi>;

  beforeEach(() => {
    api = createMockTicketApi();
  });

  it('rejects a whitespace-only title and associates the error with the field', async () => {
    const user = userEvent.setup({ delay: null });
    renderApp(api);
    await screen.findByTestId('ticket-list');

    const title = screen.getByLabelText(/summary/i);
    await user.type(title, '   ');
    await user.type(screen.getByLabelText(/customer/i), 'Brightleaf Bakery');
    await user.click(screen.getByRole('button', { name: /create ticket/i }));

    expect(title).toHaveAttribute('aria-invalid', 'true');
    const describedBy = title.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(/enter a short summary/i);

    // Nothing was created.
    expect(await api.listTickets()).toHaveLength(SEED_TICKET_COUNT);
  });

  it('creates a ticket and shows it in the list', async () => {
    const user = userEvent.setup({ delay: null });
    renderApp(api);
    await screen.findByTestId('ticket-list');

    await user.type(screen.getByLabelText(/summary/i), 'Scanner feeds two pages at once');
    await user.type(screen.getByLabelText(/customer/i), 'Marlow Print');
    await user.type(screen.getByLabelText(/details/i), 'Happens on the flatbed feeder only.');
    await user.click(screen.getByRole('button', { name: /create ticket/i }));

    await waitFor(() => {
      expect(
        within(screen.getByTestId('ticket-list')).getByText(/scanner feeds two pages at once/i),
      ).toBeInTheDocument();
    });
  });

  it('disables the submit button while the request is in flight', async () => {
    const user = userEvent.setup({ delay: null });
    api.setLatency(80);
    renderApp(api);
    await screen.findByTestId('ticket-list');

    await user.type(screen.getByLabelText(/summary/i), 'Duplicate submission guard');
    await user.type(screen.getByLabelText(/customer/i), 'Orrin Cycles');

    const submit = screen.getByRole('button', { name: /create ticket/i });
    await user.click(submit);
    expect(submit).toBeDisabled();

    await waitFor(() => expect(submit).toBeEnabled(), { timeout: 3000 });

    // Exactly one ticket was created, not two.
    const tickets = await api.listTickets();
    expect(tickets.filter((t) => t.title === 'Duplicate submission guard')).toHaveLength(1);
  });
});

describe('ticket detail', () => {
  it('opens a ticket and shows its body and comments', async () => {
    const user = userEvent.setup({ delay: null });
    const api = createMockTicketApi();
    renderApp(api);
    await screen.findByTestId('ticket-list');

    await user.click(screen.getByRole('link', { name: /card reader rejects every chip payment/i }));

    const detail = await screen.findByTestId('ticket-detail');
    expect(within(detail).getByText(/till 3 shows/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(detail).getByText(/tried three cards/i)).toBeInTheDocument();
    });
  });
});
