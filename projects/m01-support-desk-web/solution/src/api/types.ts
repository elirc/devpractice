/**
 * The API adapter contract.
 *
 * M01 runs against the in-memory mock. M02 replaces the implementation with one
 * that talks HTTP to a real backend. Components must depend on THIS interface
 * and never on the mock directly, otherwise the swap in M02 means rewriting the
 * interface layer instead of just the adapter.
 */

export type TicketStatus = 'open' | 'pending' | 'closed';

export interface Ticket {
  id: string;
  title: string;
  body: string;
  status: TicketStatus;
  customerName: string;
  createdAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface CreateTicketInput {
  title: string;
  body: string;
  customerName: string;
}

/** Thrown for input the server rejected, keyed by field name. */
export class TicketValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super('The ticket was rejected.');
    this.name = 'TicketValidationError';
  }
}

export class TicketNotFoundError extends Error {
  constructor(id: string) {
    super(`No ticket with id ${id}.`);
    this.name = 'TicketNotFoundError';
  }
}

export interface TicketApi {
  listTickets(options?: { status?: TicketStatus }): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket>;
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  listComments(ticketId: string): Promise<TicketComment[]>;
}
