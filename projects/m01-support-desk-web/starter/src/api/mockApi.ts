import {
  TicketNotFoundError,
  TicketValidationError,
  type CreateTicketInput,
  type Ticket,
  type TicketApi,
  type TicketComment,
  type TicketStatus,
} from './types.js';

/**
 * In-memory implementation of TicketApi.
 *
 * Deliberately imperfect in the ways a real network is imperfect: it is
 * asynchronous, it can be told to be slow, and it validates on the "server"
 * side so the interface cannot simply trust its own form state.
 *
 * All records are fictional.
 */

const SEED_TICKETS: Ticket[] = [
  {
    id: 'T-1001',
    title: 'Card reader rejects every chip payment',
    body: 'Since this morning the reader at till 3 shows "card not read" for chip payments. Contactless still works.',
    status: 'open',
    customerName: 'Brightleaf Bakery',
    createdAt: '2026-08-31T09:12:00.000Z',
  },
  {
    id: 'T-1002',
    title: 'Monthly invoice shows last month total',
    body: 'The September invoice repeats the August figure. The line items look right, only the total is wrong.',
    status: 'pending',
    customerName: 'Halden Legal',
    createdAt: '2026-09-01T14:03:00.000Z',
  },
  {
    id: 'T-1003',
    title: 'Cannot add a second delivery address',
    body: 'The save button does nothing when I add a second address. No error appears.',
    status: 'open',
    customerName: 'Orrin Cycles',
    createdAt: '2026-09-02T08:47:00.000Z',
  },
  {
    id: 'T-1004',
    title: 'Password reset email never arrives',
    body: 'Two of our staff requested a reset yesterday. Nothing arrived, including in junk.',
    status: 'closed',
    customerName: 'Vellum Studio',
    createdAt: '2026-08-20T16:30:00.000Z',
  },
  {
    id: 'T-1005',
    title: 'Export produces an empty spreadsheet',
    body: 'The CSV export downloads but contains only the header row, even with a wide date range.',
    status: 'pending',
    customerName: 'Kestrel Freight',
    createdAt: '2026-09-03T11:15:00.000Z',
  },
];

const SEED_COMMENTS: TicketComment[] = [
  {
    id: 'C-1',
    ticketId: 'T-1001',
    author: 'Dispatcher',
    body: 'Asked the customer to try a different card to rule out one damaged chip.',
    createdAt: '2026-08-31T09:40:00.000Z',
  },
  {
    id: 'C-2',
    ticketId: 'T-1001',
    author: 'Brightleaf Bakery',
    body: 'Tried three cards, same message on all of them.',
    createdAt: '2026-08-31T10:05:00.000Z',
  },
  {
    id: 'C-3',
    ticketId: 'T-1002',
    author: 'Dispatcher',
    body: 'Reproduced on our side. Raising with billing.',
    createdAt: '2026-09-01T15:20:00.000Z',
  },
];

export interface MockApiOptions {
  /** Artificial latency in ms, so loading states are visible in tests. */
  latencyMs?: number;
  /** When set, every call rejects with this error. Used for error states. */
  failWith?: Error;
  /** Start with no tickets at all, so the empty state can be exercised. */
  startEmpty?: boolean;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMockTicketApi(options: MockApiOptions = {}): TicketApi & {
  reset(): void;
  setLatency(ms: number): void;
  setFailure(error: Error | null): void;
} {
  let tickets = options.startEmpty ? [] : clone(SEED_TICKETS);
  let comments = options.startEmpty ? [] : clone(SEED_COMMENTS);
  let latencyMs = options.latencyMs ?? 0;
  let failure: Error | null = options.failWith ?? null;
  let nextId = 1006;

  const settle = async <T>(produce: () => T): Promise<T> => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (failure) throw failure;
    return produce();
  };

  return {
    async listTickets(listOptions) {
      return settle(() => {
        const status = listOptions?.status;
        // Callers receive copies: mutating the result must never corrupt the store.
        const source = status ? tickets.filter((ticket) => ticket.status === status) : tickets;
        return clone(source);
      });
    },

    async getTicket(id) {
      return settle(() => {
        const found = tickets.find((ticket) => ticket.id === id);
        if (!found) throw new TicketNotFoundError(id);
        return clone(found);
      });
    },

    async createTicket(input) {
      return settle(() => {
        const fieldErrors: Record<string, string> = {};
        if (input.title.trim() === '') fieldErrors.title = 'Enter a short summary of the problem.';
        if (input.title.trim().length > 120) fieldErrors.title = 'Keep the summary under 120 characters.';
        if (input.customerName.trim() === '') fieldErrors.customerName = 'Enter the customer name.';
        if (Object.keys(fieldErrors).length > 0) throw new TicketValidationError(fieldErrors);

        const ticket: Ticket = {
          id: `T-${nextId++}`,
          title: input.title.trim(),
          body: input.body.trim(),
          status: 'open',
          customerName: input.customerName.trim(),
          createdAt: new Date().toISOString(),
        };
        tickets = [ticket, ...tickets];
        return clone(ticket);
      });
    },

    async listComments(ticketId) {
      return settle(() => clone(comments.filter((comment) => comment.ticketId === ticketId)));
    },

    reset() {
      tickets = clone(SEED_TICKETS);
      comments = clone(SEED_COMMENTS);
      nextId = 1006;
      failure = null;
      latencyMs = 0;
    },
    setLatency(ms) {
      latencyMs = ms;
    },
    setFailure(error) {
      failure = error;
    },
  };
}

export const SEED_TICKET_COUNT = SEED_TICKETS.length;
export { SEED_TICKETS };
