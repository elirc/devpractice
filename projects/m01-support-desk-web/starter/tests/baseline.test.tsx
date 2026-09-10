/**
 * BASELINE checks — these MUST pass on a fresh checkout.
 *
 * They prove the toolchain, the test environment and the mock API all work.
 * If these fail, your environment is broken; that is not part of the mission.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockTicketApi, SEED_TICKET_COUNT } from '../src/api/mockApi.js';
import { TicketNotFoundError, TicketValidationError } from '../src/api/types.js';
import { App } from '../src/App.js';

describe('scaffold', () => {
  it('renders the application shell', () => {
    const api = createMockTicketApi();
    render(<App api={api} />);
    expect(screen.getByRole('heading', { name: /support desk/i })).toBeInTheDocument();
  });
});

describe('mock ticket api', () => {
  let api: ReturnType<typeof createMockTicketApi>;

  beforeEach(() => {
    api = createMockTicketApi();
  });

  it('lists the seeded tickets', async () => {
    const tickets = await api.listTickets();
    expect(tickets).toHaveLength(SEED_TICKET_COUNT);
    expect(tickets[0]).toHaveProperty('status');
  });

  it('filters by status without changing the store', async () => {
    const open = await api.listTickets({ status: 'open' });
    expect(open.every((ticket) => ticket.status === 'open')).toBe(true);
    expect(await api.listTickets()).toHaveLength(SEED_TICKET_COUNT);
  });

  it('returns copies so a caller cannot corrupt the store', async () => {
    const first = await api.listTickets();
    first[0]!.title = 'mutated by the caller';
    const second = await api.listTickets();
    expect(second[0]!.title).not.toBe('mutated by the caller');
  });

  it('creates a ticket and includes it in later lists', async () => {
    const created = await api.createTicket({
      title: 'Printer jams on duplex',
      body: 'Only when printing double sided.',
      customerName: 'Marlow Print',
    });
    expect(created.id).toMatch(/^T-\d+$/);
    expect(created.status).toBe('open');
    const tickets = await api.listTickets();
    expect(tickets).toHaveLength(SEED_TICKET_COUNT + 1);
  });

  it('rejects a whitespace-only title from the server side', async () => {
    await expect(
      api.createTicket({ title: '   ', body: 'x', customerName: 'Marlow Print' }),
    ).rejects.toBeInstanceOf(TicketValidationError);
  });

  it('reports an unknown ticket', async () => {
    await expect(api.getTicket('T-does-not-exist')).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('lists comments for one ticket only', async () => {
    const comments = await api.listComments('T-1001');
    expect(comments.length).toBeGreaterThan(0);
    expect(comments.every((comment) => comment.ticketId === 'T-1001')).toBe(true);
  });
});
